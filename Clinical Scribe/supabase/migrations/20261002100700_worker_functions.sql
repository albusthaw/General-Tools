-- Clinical Scribe: state changes made by the worker (service_role only).
-- Each function changes the job and the record together, so a crash can never
-- leave them out of step.

create or replace function public.svc_segment_started(p_segment_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scribe_segments set status = 'transcribing'
  where id = p_segment_id and status in ('uploaded', 'transcribing');
$$;

-- A part has its transcript. When it is the last one, queue the join.
create or replace function public.svc_segment_done(
  p_job_id bigint,
  p_worker text,
  p_segment_id uuid,
  p_transcript text,
  p_provider_duration numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scribe uuid;
begin
  update public.jobs
  set status = 'done', finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
  where id = p_job_id and locked_by = p_worker and status = 'running';
  if not found then
    return false;
  end if;

  update public.scribe_segments
  set status = 'done',
      transcript = coalesce(p_transcript, ''),
      provider_duration_seconds = p_provider_duration,
      error_message = null
  where id = p_segment_id
  returning scribe_id into v_scribe;
  if v_scribe is null then
    return true;
  end if;

  perform 1 from public.scribes where id = v_scribe for update;
  if not exists (select 1 from public.scribe_segments where scribe_id = v_scribe and status <> 'done')
     and exists (select 1 from public.scribes where id = v_scribe and status = 'processing') then
    insert into public.jobs (kind, scribe_id) values ('finalize_transcript', v_scribe)
    on conflict do nothing;
  end if;
  return true;
end;
$$;

-- Join the parts, settle credit, and queue the first note.
create or replace function public.svc_finalize_transcript(p_job_id bigint, p_worker text, p_scribe_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scribe public.scribes%rowtype;
  v_s public.app_settings%rowtype;
  v_transcript text;
  v_measured numeric;
  v_extra integer;
  v_template uuid;
begin
  update public.jobs
  set status = 'done', finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
  where id = p_job_id and locked_by = p_worker and status = 'running';
  if not found then
    return false;
  end if;

  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.status <> 'processing' then
    return true;
  end if;
  if exists (select 1 from public.scribe_segments where scribe_id = p_scribe_id and status <> 'done') then
    return true;
  end if;
  select * into v_s from public.app_settings where id;

  select string_agg(nullif(btrim(transcript), ''), E'\n\n' order by seq),
         sum(provider_duration_seconds)
  into v_transcript, v_measured
  from public.scribe_segments where scribe_id = p_scribe_id;

  -- If the services measured more audio than the browser reported, charge the difference.
  v_extra := greatest(0, ceil(coalesce(v_measured, 0))::integer - v_scribe.duration_seconds - 5);
  if v_extra > 0 then
    perform app_private.change_credit(v_scribe.owner_id, v_scribe.provider, -v_extra, 'correction',
      p_scribe_id, null, 'Measured length');
  end if;

  update public.scribes
  set status = 'transcribed',
      transcript = coalesce(v_transcript, ''),
      provider_duration_seconds = v_measured,
      charged_seconds = case when charged_seconds > 0 then charged_seconds + v_extra else 0 end,
      transcribed_at = now(),
      error_code = null,
      error_message = null
  where id = p_scribe_id;

  if v_s.audio_retention_days = 0 then
    insert into public.jobs (kind, payload, max_attempts)
    values ('delete_files', jsonb_build_object('prefix', v_scribe.owner_id::text || '/' || p_scribe_id::text,
                                               'scribe_id', p_scribe_id), 10);
  end if;

  if coalesce(btrim(v_transcript), '') = '' then
    return true;
  end if;

  v_template := v_scribe.template_id;
  if v_template is null or not app_private.template_visible(v_template, v_scribe.owner_id) then
    select id into v_template from public.templates where is_default limit 1;
  end if;
  if v_template is not null then
    begin
      perform app_private.queue_note(p_scribe_id, v_template, v_scribe.owner_id);
    exception when others then
      -- Note writing is not set up yet: the transcript is still ready and a note
      -- can be written later from History.
      null;
    end;
  end if;
  return true;
end;
$$;

create or replace function public.svc_note_started(p_note_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notes set status = 'writing' where id = p_note_id and status in ('queued', 'writing');
$$;

create or replace function public.svc_note_done(p_job_id bigint, p_worker text, p_note_id uuid, p_content text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_content), '') = '' then
    raise exception 'A note cannot be empty.';
  end if;
  update public.jobs
  set status = 'done', finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
  where id = p_job_id and locked_by = p_worker and status = 'running';
  if not found then
    return false;
  end if;
  update public.notes
  set status = 'done', content = btrim(p_content), error_message = null, completed_at = now()
  where id = p_note_id and status <> 'done';
  return true;
end;
$$;

-- A job went wrong. Temporary problems are tried again later; after the last try
-- the record is marked as failed with a plain-language message and credit is
-- returned. Returns 'retry', 'failed' or 'lost' (another worker owns the job now).
create or replace function public.svc_job_failed(
  p_job_id bigint,
  p_worker text,
  p_error text,
  p_message text,
  p_retryable boolean,
  p_delay_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_scribe public.scribes%rowtype;
  v_delay integer;
  v_message text := left(coalesce(nullif(btrim(p_message), ''), 'Something went wrong. Please try again.'), 300);
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.locked_by is distinct from p_worker or v_job.status <> 'running' then
    return 'lost';
  end if;

  if p_retryable and v_job.attempts + 1 < v_job.max_attempts then
    v_delay := coalesce(p_delay_seconds, least(600, (15 * power(2, v_job.attempts))::integer));
    update public.jobs
    set status = 'queued',
        attempts = attempts + 1,
        run_after = now() + make_interval(secs => greatest(1, least(v_delay, 3600))),
        last_error = left(coalesce(p_error, ''), 1000),
        locked_by = null,
        locked_until = null,
        updated_at = now()
    where id = p_job_id;
    return 'retry';
  end if;

  update public.jobs
  set status = 'failed',
      attempts = attempts + 1,
      last_error = left(coalesce(p_error, ''), 1000),
      finished_at = now(),
      locked_by = null,
      locked_until = null,
      updated_at = now()
  where id = p_job_id;

  if v_job.kind in ('transcribe_segment', 'finalize_transcript') and v_job.scribe_id is not null then
    if v_job.segment_id is not null then
      update public.scribe_segments set status = 'failed', error_message = v_message where id = v_job.segment_id;
    end if;
    select * into v_scribe from public.scribes where id = v_job.scribe_id for update;
    if found and v_scribe.status = 'processing' then
      -- Stop the other parts of this recording; they will run again on "Try again".
      update public.jobs
      set status = 'cancelled', finished_at = now(), updated_at = now()
      where scribe_id = v_job.scribe_id and status = 'queued' and kind in ('transcribe_segment', 'finalize_transcript');
      update public.scribe_segments set status = 'uploaded'
      where scribe_id = v_job.scribe_id and status = 'transcribing' and id is distinct from v_job.segment_id;

      if v_scribe.charged_seconds > 0 then
        perform app_private.change_credit(v_scribe.owner_id, v_scribe.provider, v_scribe.charged_seconds, 'refund',
          v_scribe.id, null, 'Processing failed');
      end if;
      update public.scribes
      set status = 'failed', charged_seconds = 0, error_code = 'processing_failed', error_message = v_message
      where id = v_scribe.id;
    end if;
  elsif v_job.kind = 'generate_note' and v_job.note_id is not null then
    update public.notes set status = 'failed', error_message = v_message
    where id = v_job.note_id and status <> 'done';
  end if;
  return 'failed';
end;
$$;

-- AI usage, for rate limits and the admin summary.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid,
  kind text not null check (kind in ('transcription', 'note', 'template', 'key_check', 'model_list')),
  provider text not null check (provider in ('elevenlabs', 'gemini', 'deepseek')),
  model text not null default '',
  input_tokens integer,
  output_tokens integer,
  audio_seconds numeric(10, 2),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index ai_usage_user_kind_idx on public.ai_usage (user_id, kind, created_at desc);
create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant select, insert on table public.ai_usage to service_role;

create or replace function public.svc_record_usage(
  p_user uuid,
  p_kind text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_audio_seconds numeric,
  p_ok boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (user_id, kind, provider, model, input_tokens, output_tokens, audio_seconds, ok)
  values (p_user, p_kind, p_provider, left(coalesce(p_model, ''), 80), p_input_tokens, p_output_tokens, p_audio_seconds, coalesce(p_ok, true));
$$;

-- How many template drafts the person has asked for in the last hour.
create or replace function public.svc_template_drafts_last_hour(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.ai_usage
  where user_id = p_user and kind = 'template' and created_at > now() - interval '1 hour';
$$;

-- Clean-up ---------------------------------------------------------------------

-- Recordings whose audio should now be deleted, and abandoned recordings to remove.
create or replace function public.svc_cleanup_targets()
returns table (scribe_id uuid, owner_id uuid, action text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  select audio_retention_days into v_days from public.app_settings where id;
  return query
    select s.id, s.owner_id, 'delete_audio'::text
    from public.scribes s
    where s.audio_deleted_at is null
      and v_days >= 0
      and s.status = 'transcribed'
      and s.transcribed_at < now() - make_interval(days => v_days)
    union all
    select s.id, s.owner_id, 'delete_audio'::text
    from public.scribes s
    where s.audio_deleted_at is null
      and s.status = 'failed'
      and s.updated_at < now() - interval '30 days'
    union all
    select s.id, s.owner_id, 'remove_abandoned'::text
    from public.scribes s
    where s.status = 'recording'
      and s.last_activity_at < now() - interval '30 days'
    limit 200;
end;
$$;

create or replace function public.svc_mark_audio_deleted(p_scribe_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.scribe_segments set audio_deleted = true where scribe_id = p_scribe_id;
  update public.scribes set audio_deleted_at = coalesce(audio_deleted_at, now()) where id = p_scribe_id;
$$;

create or replace function public.svc_remove_abandoned(p_scribe_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.scribes where id = p_scribe_id and status = 'recording';
$$;

revoke execute on function public.svc_segment_started(uuid) from public, anon, authenticated;
revoke execute on function public.svc_segment_done(bigint, text, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.svc_finalize_transcript(bigint, text, uuid) from public, anon, authenticated;
revoke execute on function public.svc_note_started(uuid) from public, anon, authenticated;
revoke execute on function public.svc_note_done(bigint, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_job_failed(bigint, text, text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.svc_record_usage(uuid, text, text, text, integer, integer, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.svc_template_drafts_last_hour(uuid) from public, anon, authenticated;
revoke execute on function public.svc_cleanup_targets() from public, anon, authenticated;
revoke execute on function public.svc_mark_audio_deleted(uuid) from public, anon, authenticated;
revoke execute on function public.svc_remove_abandoned(uuid) from public, anon, authenticated;

grant execute on function public.svc_segment_started(uuid) to service_role;
grant execute on function public.svc_segment_done(bigint, text, uuid, text, numeric) to service_role;
grant execute on function public.svc_finalize_transcript(bigint, text, uuid) to service_role;
grant execute on function public.svc_note_started(uuid) to service_role;
grant execute on function public.svc_note_done(bigint, text, uuid, text) to service_role;
grant execute on function public.svc_job_failed(bigint, text, text, text, boolean, integer) to service_role;
grant execute on function public.svc_record_usage(uuid, text, text, text, integer, integer, numeric, boolean) to service_role;
grant execute on function public.svc_template_drafts_last_hour(uuid) to service_role;
grant execute on function public.svc_cleanup_targets() to service_role;
grant execute on function public.svc_mark_audio_deleted(uuid) to service_role;
grant execute on function public.svc_remove_abandoned(uuid) to service_role;
