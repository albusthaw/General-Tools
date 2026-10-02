-- Clinical Scribe: admin review of other people's records.
-- Admins have no direct read access to anyone else's recordings. They must open a
-- review with a reason; every list, record and copy is written to the audit log in
-- the same transaction that returns the data.

create table public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  target_user_id uuid not null,
  reason text not null check (char_length(reason) between 10 and 500),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  ended_at timestamptz
);

create index review_sessions_admin_idx on public.review_sessions (admin_id, started_at desc);

alter table public.review_sessions enable row level security;
revoke all on table public.review_sessions from anon, authenticated;
grant select, update on table public.review_sessions to service_role;

-- Returns the open review for the caller, extending it by 30 minutes.
create or replace function app_private.use_review(p_review_id uuid)
returns public.review_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_review public.review_sessions%rowtype;
begin
  select * into v_review from public.review_sessions where id = p_review_id for update;
  if not found or v_review.admin_id <> v_uid then
    perform app_private.fail('review_closed', 'This review is not open. Start a new review.');
  end if;
  -- Expired reviews are closed and logged by the clean-up job.
  if v_review.ended_at is not null or v_review.expires_at < now() then
    perform app_private.fail('review_closed', 'This review has ended. Start a new review to continue.');
  end if;
  update public.review_sessions
  set last_seen_at = now(), expires_at = now() + interval '30 minutes'
  where id = p_review_id
  returning * into v_review;
  return v_review;
end;
$$;

revoke execute on function app_private.use_review(uuid) from public;

create or replace function public.admin_review_start(p_target_user uuid, p_reason text, p_confirmed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_target public.profiles%rowtype;
  v_id uuid;
begin
  if not coalesce(p_confirmed, false) then
    perform app_private.fail('not_confirmed', 'Confirm that you understand this review is recorded.');
  end if;
  if char_length(v_reason) < 10 then
    perform app_private.fail('reason_needed', 'Give a clear reason of at least 10 characters.');
  end if;
  if char_length(v_reason) > 500 then
    perform app_private.fail('invalid_input', 'Keep the reason to 500 characters.');
  end if;
  select * into v_target from public.profiles where id = p_target_user;
  if not found then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;

  -- One open review at a time per admin.
  update public.review_sessions set ended_at = now()
  where admin_id = v_uid and ended_at is null;

  insert into public.review_sessions (admin_id, target_user_id, reason)
  values (v_uid, p_target_user, v_reason)
  returning id into v_id;

  perform app_private.audit(v_uid, 'review.started', p_target_user, null, v_id, v_reason, '{}'::jsonb);

  return jsonb_build_object(
    'review_id', v_id,
    'target', jsonb_build_object('id', v_target.id, 'email', v_target.email, 'full_name', v_target.full_name),
    'expires_at', now() + interval '30 minutes'
  );
end;
$$;

create or replace function public.admin_review_list(p_review_id uuid)
returns table (
  id uuid,
  title text,
  status text,
  duration_seconds integer,
  started_at timestamptz,
  transcribed_at timestamptz,
  note_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.review_sessions%rowtype := app_private.use_review(p_review_id);
begin
  perform app_private.audit(v_review.admin_id, 'review.list_viewed', v_review.target_user_id, null, v_review.id,
    v_review.reason, '{}'::jsonb);
  return query
    select s.id, s.title, s.status, s.duration_seconds, s.started_at, s.transcribed_at,
           (select count(*) from public.notes n where n.scribe_id = s.id and n.status = 'done')
    from public.scribes s
    where s.owner_id = v_review.target_user_id
    order by s.started_at desc
    limit 500;
end;
$$;

create or replace function public.admin_review_open(p_review_id uuid, p_scribe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.review_sessions%rowtype := app_private.use_review(p_review_id);
  v_scribe public.scribes%rowtype;
  v_notes jsonb;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id;
  if not found or v_scribe.owner_id <> v_review.target_user_id then
    perform app_private.fail('not_found', 'That record is not part of this review.');
  end if;

  perform app_private.audit(v_review.admin_id, 'review.record_opened', v_review.target_user_id, p_scribe_id,
    v_review.id, v_review.reason, jsonb_build_object('title', v_scribe.title, 'recorded_at', v_scribe.started_at));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'template_name', n.template_name, 'status', n.status,
           'content', n.content, 'created_at', n.created_at, 'completed_at', n.completed_at
         ) order by n.created_at desc), '[]'::jsonb)
  into v_notes
  from public.notes n
  where n.scribe_id = p_scribe_id and n.status = 'done';

  return jsonb_build_object(
    'id', v_scribe.id,
    'title', v_scribe.title,
    'status', v_scribe.status,
    'duration_seconds', v_scribe.duration_seconds,
    'started_at', v_scribe.started_at,
    'transcribed_at', v_scribe.transcribed_at,
    'transcript', v_scribe.transcript,
    'notes', v_notes
  );
end;
$$;

-- Copying from a reviewed record is recorded too.
create or replace function public.admin_review_copied(p_review_id uuid, p_scribe_id uuid, p_what text, p_note_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.review_sessions%rowtype := app_private.use_review(p_review_id);
begin
  if p_what not in ('transcript', 'note') then
    perform app_private.fail('invalid_input', 'Unknown item.');
  end if;
  if not exists (select 1 from public.scribes where id = p_scribe_id and owner_id = v_review.target_user_id) then
    perform app_private.fail('not_found', 'That record is not part of this review.');
  end if;
  perform app_private.audit(v_review.admin_id, 'review.copied', v_review.target_user_id, p_scribe_id, v_review.id,
    v_review.reason, jsonb_build_object('item', p_what, 'note_id', p_note_id));
end;
$$;

create or replace function public.admin_review_end(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_review public.review_sessions%rowtype;
begin
  select * into v_review from public.review_sessions where id = p_review_id for update;
  if not found or v_review.admin_id <> v_uid or v_review.ended_at is not null then
    return;
  end if;
  update public.review_sessions set ended_at = now() where id = p_review_id;
  perform app_private.audit(v_uid, 'review.ended', v_review.target_user_id, null, p_review_id, v_review.reason,
    jsonb_build_object('minutes', round(extract(epoch from now() - v_review.started_at) / 60.0, 1)));
end;
$$;

-- The caller's open review, if any (so a page reload can continue it).
create or replace function public.admin_review_current()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_review public.review_sessions%rowtype;
  v_target public.profiles%rowtype;
begin
  select * into v_review from public.review_sessions
  where admin_id = v_uid and ended_at is null and expires_at > now()
  order by started_at desc limit 1;
  if not found then
    return null;
  end if;
  select * into v_target from public.profiles where id = v_review.target_user_id;
  return jsonb_build_object(
    'review_id', v_review.id,
    'reason', v_review.reason,
    'target', jsonb_build_object('id', v_review.target_user_id, 'email', coalesce(v_target.email, ''),
                                 'full_name', coalesce(v_target.full_name, '')),
    'expires_at', v_review.expires_at
  );
end;
$$;

-- Close reviews nobody used for 30 minutes (called by the clean-up job).
create or replace function public.svc_expire_reviews()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.review_sessions%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select * from public.review_sessions where ended_at is null and expires_at < now() for update skip locked
  loop
    update public.review_sessions set ended_at = v_row.expires_at where id = v_row.id;
    perform app_private.audit(v_row.admin_id, 'review.expired', v_row.target_user_id, null, v_row.id, v_row.reason, '{}'::jsonb, '');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Finished jobs are kept for two weeks for troubleshooting, then removed.
create or replace function public.svc_prune_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.jobs
  where status in ('done', 'failed', 'cancelled') and coalesce(finished_at, updated_at) < now() - interval '14 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.admin_review_start(uuid, text, boolean) from public, anon;
revoke execute on function public.admin_review_list(uuid) from public, anon;
revoke execute on function public.admin_review_open(uuid, uuid) from public, anon;
revoke execute on function public.admin_review_copied(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.admin_review_end(uuid) from public, anon;
revoke execute on function public.admin_review_current() from public, anon;
grant execute on function public.admin_review_start(uuid, text, boolean) to authenticated;
grant execute on function public.admin_review_list(uuid) to authenticated;
grant execute on function public.admin_review_open(uuid, uuid) to authenticated;
grant execute on function public.admin_review_copied(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.admin_review_end(uuid) to authenticated;
grant execute on function public.admin_review_current() to authenticated;

revoke execute on function public.svc_expire_reviews() from public, anon, authenticated;
revoke execute on function public.svc_prune_jobs() from public, anon, authenticated;
grant execute on function public.svc_expire_reviews() to service_role;
grant execute on function public.svc_prune_jobs() to service_role;
