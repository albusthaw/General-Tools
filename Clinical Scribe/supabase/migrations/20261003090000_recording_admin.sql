-- Clinical Scribe 1.1: the admin "Recording" page.
-- Admins can see every recording and whether its audio is still kept. To listen
-- to or download audio they give a reason; each opening and each download is
-- written to the audit log. Audio never has a public address: it is passed
-- through the admin function only, under a short-lived access grant.
-- This file only adds things; no existing data is changed.

-- Recordings that were deleted, kept as a short record so admins see that they
-- existed. Holds no audio, transcript, note or label.
create table app_private.deleted_recordings (
  scribe_id uuid primary key,
  owner_id uuid not null,
  owner_name text not null default '',
  owner_email text not null default '',
  recorded_at timestamptz not null,
  duration_seconds integer not null default 0,
  segment_count integer not null default 0,
  reason text not null check (reason in ('person', 'account_removed')),
  deleted_at timestamptz not null default now()
);

create index deleted_recordings_recorded_idx on app_private.deleted_recordings (recorded_at desc);
create index deleted_recordings_owner_idx on app_private.deleted_recordings (owner_id);

-- When a recording with saved audio is deleted, by its owner or by the clean-up of
-- recordings left unfinished. A recording stopped before any audio was saved
-- leaves nothing behind.
create or replace function app_private.remember_deleted_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
begin
  if old.segment_count = 0 then
    return old;
  end if;
  select * into v_p from public.profiles where id = old.owner_id;
  insert into app_private.deleted_recordings
    (scribe_id, owner_id, owner_name, owner_email, recorded_at, duration_seconds, segment_count, reason)
  values
    (old.id, old.owner_id, coalesce(v_p.full_name, ''), coalesce(v_p.email, ''), old.started_at,
     old.duration_seconds, old.segment_count, case when v_p.id is null then 'account_removed' else 'person' end)
  on conflict (scribe_id) do nothing;
  return old;
end;
$$;

create trigger scribes_remember_deleted
after delete on public.scribes
for each row execute function app_private.remember_deleted_recording();

-- When an account is removed, its recordings go with it; keep their short records,
-- with the person's name, before the cascade removes them.
create or replace function app_private.remember_removed_person_recordings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.deleted_recordings
    (scribe_id, owner_id, owner_name, owner_email, recorded_at, duration_seconds, segment_count, reason)
  select s.id, s.owner_id, coalesce(old.full_name, ''), coalesce(old.email, ''), s.started_at,
         s.duration_seconds, s.segment_count, 'account_removed'
  from public.scribes s
  where s.owner_id = old.id and s.segment_count > 0
  on conflict (scribe_id) do nothing;
  return old;
end;
$$;

create trigger profiles_remember_recordings
before delete on public.profiles
for each row execute function app_private.remember_removed_person_recordings();

-- Short-lived permission for one admin to fetch one recording's audio.
create table app_private.recording_access (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  scribe_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index recording_access_lookup_idx on app_private.recording_access (admin_id, scribe_id, expires_at);

-- The list for the Recording page: who recorded when, for how long, and whether the
-- audio is kept. No labels, transcripts or notes.
create or replace function public.admin_list_recordings(
  p_person uuid default null,
  p_audio text default '',
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  scribe_id uuid,
  owner_id uuid,
  owner_name text,
  owner_email text,
  recorded_at timestamptz,
  duration_seconds integer,
  segment_count integer,
  status text,
  audio_state text,
  keep_until timestamptz,
  deleted_at timestamptz,
  deleted_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_days integer;
begin
  perform app_private.require_admin();
  if coalesce(p_audio, '') not in ('', 'kept', 'deleted') then
    perform app_private.fail('invalid_input', 'Unknown filter.');
  end if;
  select s.audio_retention_days into v_days from public.app_settings s where s.id;

  return query
  select r.scribe_id, r.owner_id, r.owner_name, r.owner_email, r.recorded_at, r.duration_seconds,
         r.segment_count, r.status, r.audio_state, r.keep_until, r.deleted_at, r.deleted_reason
  from (
    select
      s.id as scribe_id,
      s.owner_id,
      p.full_name as owner_name,
      p.email as owner_email,
      s.started_at as recorded_at,
      s.duration_seconds,
      s.segment_count,
      s.status,
      case
        when s.audio_deleted_at is not null then 'deleted'
        when not exists (
          select 1 from public.scribe_segments g where g.scribe_id = s.id and not g.audio_deleted
        ) then 'none'
        else 'kept'
      end as audio_state,
      case
        when s.audio_deleted_at is not null then null
        when s.status = 'transcribed' and v_days >= 0 then s.transcribed_at + make_interval(days => v_days)
        when s.status = 'failed' then s.updated_at + interval '30 days'
        else null
      end as keep_until,
      s.audio_deleted_at as deleted_at,
      case when s.audio_deleted_at is not null then 'retention' end as deleted_reason
    from public.scribes s
    join public.profiles p on p.id = s.owner_id
    where p_person is null or s.owner_id = p_person
    union all
    select d.scribe_id, d.owner_id, d.owner_name, d.owner_email, d.recorded_at, d.duration_seconds,
           d.segment_count, 'deleted', 'deleted', null, d.deleted_at, d.reason
    from app_private.deleted_recordings d
    where p_person is null or d.owner_id = p_person
  ) r
  where (p_before is null or r.recorded_at < p_before)
    and (
      coalesce(p_audio, '') = ''
      or (p_audio = 'kept' and r.audio_state = 'kept')
      or (p_audio = 'deleted' and r.audio_state = 'deleted')
    )
  order by r.recorded_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Called by the admin function when an admin asks to open a recording's audio.
-- Writes the audit entry with the reason and grants access for 15 minutes.
create or replace function public.svc_recording_unlock(
  p_admin uuid,
  p_scribe_id uuid,
  p_reason text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_s public.scribes%rowtype;
  v_owner public.profiles%rowtype;
  v_parts jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and status = 'active') then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  if char_length(v_reason) < 10 then
    perform app_private.fail('reason_needed', 'Give a reason of at least 10 characters.');
  end if;
  if char_length(v_reason) > 500 then
    perform app_private.fail('invalid_input', 'Keep the reason to 500 characters.');
  end if;
  select * into v_s from public.scribes where id = p_scribe_id;
  if not found then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_s.audio_deleted_at is not null then
    perform app_private.fail('audio_deleted', 'The audio of this recording has been deleted.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', g.seq, 'duration_seconds', g.duration_seconds, 'mime_type', g.mime_type, 'byte_size', g.byte_size
         ) order by g.seq), '[]'::jsonb)
  into v_parts
  from public.scribe_segments g
  where g.scribe_id = p_scribe_id and not g.audio_deleted;
  if jsonb_array_length(v_parts) = 0 then
    perform app_private.fail('no_audio', 'This recording has no audio to play.');
  end if;
  select * into v_owner from public.profiles where id = v_s.owner_id;

  delete from app_private.recording_access where expires_at < now() - interval '1 day';
  insert into app_private.recording_access (admin_id, scribe_id, reason, expires_at)
  values (p_admin, p_scribe_id, v_reason, now() + interval '15 minutes');

  perform app_private.audit(p_admin, 'recording.opened', v_s.owner_id, p_scribe_id, null, v_reason,
    jsonb_build_object('title', v_s.title, 'recorded_at', v_s.started_at, 'parts', jsonb_array_length(v_parts)),
    p_user_agent);

  return jsonb_build_object(
    'owner_name', coalesce(nullif(v_owner.full_name, ''), v_owner.email, ''),
    'title', v_s.title,
    'recorded_at', v_s.started_at,
    'duration_seconds', v_s.duration_seconds,
    'parts', v_parts
  );
end;
$$;

-- Called by the admin function for each part it passes on. Needs a current grant
-- from svc_recording_unlock; a download is written to the audit log too.
create or replace function public.svc_recording_part(
  p_admin uuid,
  p_scribe_id uuid,
  p_seq integer,
  p_download boolean,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access app_private.recording_access%rowtype;
  v_g public.scribe_segments%rowtype;
  v_s public.scribes%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and status = 'active') then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  select * into v_access from app_private.recording_access
  where admin_id = p_admin and scribe_id = p_scribe_id and expires_at > now()
  order by created_at desc
  limit 1;
  if not found then
    perform app_private.fail('access_needed', 'Open the recording again and give a reason.');
  end if;
  select * into v_g from public.scribe_segments where scribe_id = p_scribe_id and seq = p_seq;
  if not found or v_g.audio_deleted then
    perform app_private.fail('audio_deleted', 'This part of the audio is no longer kept.');
  end if;
  select * into v_s from public.scribes where id = p_scribe_id;
  if coalesce(p_download, false) then
    perform app_private.audit(p_admin, 'recording.downloaded', v_s.owner_id, p_scribe_id, null, v_access.reason,
      jsonb_build_object('part', p_seq, 'title', v_s.title, 'recorded_at', v_s.started_at), p_user_agent);
  end if;
  return jsonb_build_object(
    'storage_path', v_g.storage_path,
    'mime_type', v_g.mime_type,
    'recorded_at', v_s.started_at
  );
end;
$$;

revoke execute on function app_private.remember_deleted_recording() from public;
revoke execute on function app_private.remember_removed_person_recordings() from public;
revoke execute on function public.admin_list_recordings(uuid, text, timestamptz, integer) from public, anon;
revoke execute on function public.svc_recording_unlock(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.svc_recording_part(uuid, uuid, integer, boolean, text) from public, anon, authenticated;

grant execute on function public.admin_list_recordings(uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.svc_recording_unlock(uuid, uuid, text, text) to service_role;
grant execute on function public.svc_recording_part(uuid, uuid, integer, boolean, text) to service_role;
