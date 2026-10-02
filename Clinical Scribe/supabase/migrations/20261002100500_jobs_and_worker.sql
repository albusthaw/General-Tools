-- Clinical Scribe: background jobs.
-- Work is queued here and done by the "worker" Edge Function. The database wakes
-- the worker when jobs are added and every 30 seconds while work is due, so
-- processing never depends on a browser staying open.

create table public.jobs (
  id bigint generated always as identity primary key,
  kind text not null
    check (kind in ('transcribe_segment', 'finalize_transcript', 'generate_note', 'cleanup', 'delete_files')),
  scribe_id uuid references public.scribes (id) on delete cascade,
  segment_id uuid references public.scribe_segments (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  last_error text not null default '' check (char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_due_idx on public.jobs (run_after, id) where status in ('queued', 'running');
create index jobs_scribe_idx on public.jobs (scribe_id);
create unique index jobs_one_live_segment on public.jobs (segment_id)
  where kind = 'transcribe_segment' and status in ('queued', 'running');
create unique index jobs_one_live_finalize on public.jobs (scribe_id)
  where kind = 'finalize_transcript' and status in ('queued', 'running');
create unique index jobs_one_live_note on public.jobs (note_id)
  where kind = 'generate_note' and status in ('queued', 'running');

alter table public.jobs enable row level security;
revoke all on table public.jobs from anon, authenticated;
grant select, insert, update, delete on table public.jobs to service_role;

-- Wake the worker. Failure here must never stop data being saved; the tick retries.
create or replace function app_private.kick_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_private.runtime_config where key = 'functions_url';
  if v_url is null then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
  where name = 'clinical_scribe_worker_secret' limit 1;
  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url || '/worker',
    body := jsonb_build_object('reason', 'wake'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'Clinical Scribe could not wake the worker: %', sqlerrm;
end;
$$;

revoke execute on function app_private.kick_worker() from public;

create or replace function app_private.jobs_wake_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.kick_worker();
  return null;
end;
$$;

create trigger jobs_wake_worker
after insert on public.jobs
for each statement execute function app_private.jobs_wake_worker();

-- Every 30 seconds: queue the hourly clean-up, and wake the worker if work is due.
create or replace function app_private.cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs
    where kind = 'cleanup' and (status in ('queued', 'running') or created_at > now() - interval '1 hour')
  ) then
    insert into public.jobs (kind, max_attempts) values ('cleanup', 3);
    return;
  end if;

  if exists (
    select 1 from public.jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running' and locked_until < now())
  ) then
    perform app_private.kick_worker();
  end if;
end;
$$;

revoke execute on function app_private.cron_tick() from public;

select cron.schedule('clinical-scribe-tick', '30 seconds', 'select app_private.cron_tick()');

-- Worker API (service_role only) -------------------------------------------------

-- Claim due jobs. A job whose lease ran out (the worker was stopped) counts as a
-- failed attempt and is picked up again.
create or replace function public.svc_claim_jobs(
  p_worker text,
  p_limit integer,
  p_lease_seconds integer,
  p_kinds text[] default null
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.jobs j
    where ((j.status = 'queued' and j.run_after <= now())
        or (j.status = 'running' and j.locked_until < now()))
      and (p_kinds is null or j.kind = any (p_kinds))
    order by j.run_after, j.id
    limit greatest(1, least(coalesce(p_limit, 1), 10))
    for update skip locked
  )
  update public.jobs j
  set status = 'running',
      locked_by = p_worker,
      locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
      attempts = j.attempts + case when j.status = 'running' then 1 else 0 end,
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.svc_job_done(p_id bigint, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'done', finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
  where id = p_id and locked_by = p_worker and status = 'running';
  return found;
end;
$$;

-- Put a job back in the queue to continue later (for example, to check on work a
-- service is still doing). This is not a failure.
create or replace function public.svc_job_reschedule(
  p_id bigint,
  p_worker text,
  p_delay_seconds integer,
  p_state jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'queued',
      run_after = now() + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 5), 3600))),
      state = coalesce(p_state, state),
      locked_by = null,
      locked_until = null,
      updated_at = now()
  where id = p_id and locked_by = p_worker and status = 'running';
  return found;
end;
$$;

-- Save progress without giving up the job.
create or replace function public.svc_job_save_state(p_id bigint, p_worker text, p_state jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs set state = coalesce(p_state, '{}'::jsonb), updated_at = now()
  where id = p_id and locked_by = p_worker and status = 'running';
  return found;
end;
$$;

revoke execute on function public.svc_claim_jobs(text, integer, integer, text[]) from public, anon, authenticated;
revoke execute on function public.svc_job_done(bigint, text) from public, anon, authenticated;
revoke execute on function public.svc_job_reschedule(bigint, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.svc_job_save_state(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_claim_jobs(text, integer, integer, text[]) to service_role;
grant execute on function public.svc_job_done(bigint, text) to service_role;
grant execute on function public.svc_job_reschedule(bigint, text, integer, jsonb) to service_role;
grant execute on function public.svc_job_save_state(bigint, text, jsonb) to service_role;
