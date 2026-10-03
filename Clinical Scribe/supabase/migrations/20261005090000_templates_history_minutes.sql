-- Clinical Scribe 1.4: templates, History search, and minutes charged for the
-- real length of the audio.
-- - A finished note may lose its link to a deleted template (it keeps its own copy
--   of the template), so people can always delete their own templates.
-- - Admins can share one of their own templates with everyone.
-- - History searches every recording (label, transcript and notes), a page at a time.
-- - The worker measures each audio part before it is transcribed. A recording is
--   charged for the real length of its audio, and the server checks the longest
--   recording as well as the app. The transcripts of single parts are no longer
--   readable by people.
-- This file only adds things and replaces functions; no stored data is changed.

-- Templates -------------------------------------------------------------------

-- A finished note is final. The one change allowed is clearing the link to a
-- template that is being deleted: the note keeps its own copy of the template's
-- name and text, so nothing anyone reads changes.
create or replace function app_private.notes_are_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'done' then
    if new.template_id is null and old.template_id is not null
       and (to_jsonb(new) - 'template_id' - 'updated_at') = (to_jsonb(old) - 'template_id' - 'updated_at') then
      return new;
    end if;
    raise exception 'A finished note cannot be changed.';
  end if;
  return new;
end;
$$;

-- An admin shares one of their own personal templates with everyone.
create or replace function public.share_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_row public.templates%rowtype;
begin
  select * into v_row from public.templates where id = p_id for update;
  if not found or v_row.scope <> 'personal' or v_row.owner_id is distinct from v_uid then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;
  update public.templates set scope = 'shared', owner_id = null where id = p_id;
  perform app_private.audit(v_uid, 'template.shared_created', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_row.name, 'from', 'personal'));
end;
$$;

revoke execute on function public.share_template(uuid) from public, anon;
grant execute on function public.share_template(uuid) to authenticated;

-- History ---------------------------------------------------------------------

-- A short piece of text around the first place the term appears, on one line.
create or replace function app_private.search_extract(p_text text, p_term text)
returns text
language sql
immutable
set search_path = ''
as $$
  with found as (
    select regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g') as body,
           strpos(lower(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), lower(p_term)) as at
  )
  select case
    when p_term = '' or at = 0 then null
    else (case when at > 60 then '…' else '' end)
      || btrim(substr(body, greatest(1, at - 60), char_length(p_term) + 120))
      || (case when at + char_length(p_term) + 60 < char_length(body) then '…' else '' end)
  end
  from found;
$$;

revoke execute on function app_private.search_extract(text, text) from public;

-- One page (10 recordings, newest first) of the signed-in person's own recordings,
-- searching the label, the transcript, the notes and their template names.
create or replace function public.search_my_recordings(p_query text default '', p_page integer default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_term text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 100);
  v_like text;
  v_size constant integer := 10;
  v_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
  v_total integer;
  v_items jsonb;
begin
  v_like := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select count(*) into v_total
  from public.scribes s
  where s.owner_id = v_uid
    and (v_term = ''
      or s.title ilike v_like
      or s.transcript ilike v_like
      or exists (select 1 from public.notes n
                 where n.scribe_id = s.id and (n.content ilike v_like or n.template_name ilike v_like)));

  select coalesce(jsonb_agg(item order by started_at desc, id desc), '[]'::jsonb) into v_items
  from (
    select s.id, s.started_at,
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'status', s.status,
        'duration_seconds', s.duration_seconds,
        'started_at', s.started_at,
        'note_count', (select count(*) from public.notes n where n.scribe_id = s.id),
        'found_in', case
          when v_term = '' then null
          when s.title ilike v_like then 'label'
          when s.transcript ilike v_like then 'transcript'
          else 'note'
        end,
        'extract', case
          when v_term = '' or s.title ilike v_like then null
          when s.transcript ilike v_like then app_private.search_extract(s.transcript, v_term)
          else (select coalesce(app_private.search_extract(n.content, v_term), n.template_name)
                from public.notes n
                where n.scribe_id = s.id and (n.content ilike v_like or n.template_name ilike v_like)
                order by n.created_at desc limit 1)
        end
      ) as item
    from public.scribes s
    where s.owner_id = v_uid
      and (v_term = ''
        or s.title ilike v_like
        or s.transcript ilike v_like
        or exists (select 1 from public.notes n
                   where n.scribe_id = s.id and (n.content ilike v_like or n.template_name ilike v_like)))
    order by s.started_at desc, s.id desc
    limit v_size offset (v_page - 1) * v_size
  ) page;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'pages', greatest(1, ceil(v_total / v_size::numeric)::integer),
    'items', v_items
  );
end;
$$;

revoke execute on function public.search_my_recordings(text, integer) from public, anon;
grant execute on function public.search_my_recordings(text, integer) to authenticated;

-- Minutes ---------------------------------------------------------------------

-- The length the worker measured from the audio file itself.
alter table public.scribe_segments
  add column measured_seconds numeric(10, 2) check (measured_seconds is null or measured_seconds >= 0);

-- People read the state of their audio parts, but not the transcript of a single
-- part. A recording's transcript appears only when every part is done and its
-- minutes are settled; otherwise a recording that failed part way, and had its
-- minutes given back, could still be read part by part.
revoke select on table public.scribe_segments from authenticated;
grant select (id, scribe_id, owner_id, seq, mime_type, byte_size, duration_seconds, measured_seconds,
              status, error_message, audio_deleted, created_at, updated_at)
  on table public.scribe_segments to authenticated;

-- Record that an audio part has been uploaded. The file must really be in Storage,
-- and the parts may not add up to more than the longest recording allowed.
create or replace function public.register_segment(
  p_scribe_id uuid,
  p_seq integer,
  p_duration_seconds numeric,
  p_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
  v_ext text := app_private.extension_for_mime(p_mime_type);
  v_path text;
  v_size bigint;
  v_count integer;
  v_others numeric;
  v_max integer;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_scribe.status <> 'recording' then
    perform app_private.fail('not_recording', 'This recording has already been finished.');
  end if;
  if p_seq is null or p_seq not between 1 and 999 or v_ext is null then
    perform app_private.fail('invalid_input', 'The audio part could not be saved.');
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > app_private.segment_seconds() + 30 then
    perform app_private.fail('invalid_input', 'The audio part could not be saved.');
  end if;

  select coalesce(sum(duration_seconds), 0) into v_others
  from public.scribe_segments where scribe_id = p_scribe_id and seq <> p_seq;
  select max_recording_minutes * 60 into v_max from public.app_settings where id;
  if v_others + p_duration_seconds > v_max + 60 then
    perform app_private.fail('too_long', 'This recording is longer than the longest recording allowed.');
  end if;

  v_path := v_uid::text || '/' || p_scribe_id::text || '/' || lpad(p_seq::text, 4, '0') || '.' || v_ext;
  select coalesce((o.metadata ->> 'size')::bigint, 0) into v_size
  from storage.objects o
  where o.bucket_id = 'recordings' and o.name = v_path;
  if not found then
    perform app_private.fail('upload_missing', 'The audio part has not arrived yet. It will be sent again.');
  end if;

  insert into public.scribe_segments (scribe_id, owner_id, seq, storage_path, mime_type, byte_size, duration_seconds)
  values (p_scribe_id, v_uid, p_seq, v_path, p_mime_type, greatest(v_size, 1), round(p_duration_seconds, 2))
  on conflict (scribe_id, seq) do update
    set duration_seconds = excluded.duration_seconds,
        byte_size = excluded.byte_size
    where public.scribe_segments.status = 'uploaded';

  select count(*) into v_count from public.scribe_segments where scribe_id = p_scribe_id;
  update public.scribes
  set segment_count = v_count, last_activity_at = now(), mime_type = p_mime_type
  where id = p_scribe_id;

  return jsonb_build_object('segment_count', v_count);
end;
$$;

-- Queue transcription for every part that is not done yet, charging credit. Parts
-- already measured count with their measured length; for the others the reported
-- length is used until the worker measures them, never more than the real time
-- that passed.
create or replace function app_private.queue_transcription(p_scribe_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scribe public.scribes%rowtype;
  v_p public.profiles%rowtype;
  v_s public.app_settings%rowtype;
  v_measured numeric;
  v_reported numeric;
  v_wall numeric;
  v_duration integer;
  v_model text;
  v_pending integer;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  select * into v_s from public.app_settings where id;
  select * into v_p from public.profiles where id = v_scribe.owner_id for update;

  if not app_private.secret_is_set(app_private.provider_key_name(v_s.transcription_provider)) then
    perform app_private.fail('not_set_up', 'Transcription is not set up yet. Ask your administrator to add the service key in AI settings.');
  end if;

  select coalesce(sum(measured_seconds), 0),
         coalesce(sum(duration_seconds) filter (where measured_seconds is null), 0),
         count(*) filter (where status <> 'done')
  into v_measured, v_reported, v_pending
  from public.scribe_segments where scribe_id = p_scribe_id;

  v_wall := extract(epoch from coalesce(v_scribe.finished_at, now()) - v_scribe.started_at) + 60;
  v_duration := ceil(v_measured + least(v_reported, v_wall))::integer;
  if v_duration < 1 then
    perform app_private.fail('too_short', 'The recording is too short to process.');
  end if;
  if v_duration > v_s.max_recording_minutes * 60 + 60 then
    perform app_private.fail('too_long', 'This recording is longer than the longest recording allowed.');
  end if;

  if not v_p.credit_unlimited
     and app_private.credit_balance(v_p, v_s.transcription_provider) + 60 < v_duration then
    perform app_private.fail('not_enough_credit',
      'There are not enough transcription minutes to process this recording. Ask your administrator to add more, then process it from History.');
  end if;

  perform app_private.change_credit(v_scribe.owner_id, v_s.transcription_provider, -v_duration, 'usage',
    p_scribe_id, p_actor, 'Recording');

  v_model := case v_s.transcription_provider
    when 'elevenlabs' then v_s.elevenlabs_model
    else v_s.gemini_transcription_model
  end;

  update public.scribes
  set status = 'processing',
      provider = v_s.transcription_provider,
      model = v_model,
      language = v_s.transcription_language,
      zero_retention = v_s.elevenlabs_zero_retention,
      duration_seconds = v_duration,
      charged_seconds = case when v_p.credit_unlimited then 0 else v_duration end,
      finished_at = coalesce(finished_at, now()),
      error_code = null,
      error_message = null
  where id = p_scribe_id;

  update public.scribe_segments
  set status = 'uploaded', error_message = null
  where scribe_id = p_scribe_id and status <> 'done';

  if v_pending > 0 then
    insert into public.jobs (kind, scribe_id, segment_id)
    select 'transcribe_segment', p_scribe_id, sg.id
    from public.scribe_segments sg
    where sg.scribe_id = p_scribe_id and sg.status <> 'done'
    order by sg.seq;
  else
    insert into public.jobs (kind, scribe_id) values ('finalize_transcript', p_scribe_id)
    on conflict do nothing;
  end if;
end;
$$;

-- The worker measured an audio part before transcribing it. Returns:
--   ok                 go ahead
--   gone               the recording was deleted or stopped; nothing to do
--   changed            the file is not the one that was saved
--   unreadable         the length could not be read from the file
--   too_long           the recording is longer than the longest allowed
--   not_enough_credit  the real length needs more minutes than are left
-- Every second of audio beyond what was charged is taken here, before any
-- service is paid.
create or replace function public.svc_segment_measured(p_segment_id uuid, p_measured numeric, p_byte_size bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seg public.scribe_segments%rowtype;
  v_scribe public.scribes%rowtype;
  v_p public.profiles%rowtype;
  v_max integer;
  v_target integer;
  v_extra integer;
begin
  select * into v_seg from public.scribe_segments where id = p_segment_id;
  if not found then
    return 'gone';
  end if;
  select * into v_scribe from public.scribes where id = v_seg.scribe_id for update;
  if not found or v_scribe.status <> 'processing' then
    return 'gone';
  end if;
  if v_seg.byte_size > 1 and p_byte_size is distinct from v_seg.byte_size then
    return 'changed';
  end if;
  if p_measured is null or p_measured < 0 or p_measured > 86400 then
    return 'unreadable';
  end if;

  update public.scribe_segments set measured_seconds = round(p_measured, 2) where id = p_segment_id;

  select ceil(sum(coalesce(measured_seconds, duration_seconds)))::integer into v_target
  from public.scribe_segments where scribe_id = v_scribe.id;
  select max_recording_minutes * 60 into v_max from public.app_settings where id;
  if v_target > v_max + 60 then
    return 'too_long';
  end if;

  v_extra := v_target - v_scribe.duration_seconds;
  if v_extra <= 0 then
    return 'ok';
  end if;

  select * into v_p from public.profiles where id = v_scribe.owner_id for update;
  if not v_p.credit_unlimited and app_private.credit_balance(v_p, v_scribe.provider) < v_extra then
    return 'not_enough_credit';
  end if;
  perform app_private.change_credit(v_scribe.owner_id, v_scribe.provider, -v_extra, 'usage',
    v_scribe.id, null, 'Measured length');
  update public.scribes
  set duration_seconds = v_target,
      charged_seconds = case when v_p.credit_unlimited then 0 else charged_seconds + v_extra end
  where id = v_scribe.id;
  return 'ok';
end;
$$;

revoke execute on function public.svc_segment_measured(uuid, numeric, bigint) from public, anon, authenticated;
grant execute on function public.svc_segment_measured(uuid, numeric, bigint) to service_role;

-- Join the parts, settle credit to the measured length, and queue the first note.
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
  v_provider numeric;
  v_target integer;
  v_change integer := 0;
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

  -- The measured length of every part; a part measured by nobody counts with the
  -- longer of its reported length and the length the service reported.
  select string_agg(nullif(btrim(transcript), ''), E'\n\n' order by seq),
         sum(provider_duration_seconds),
         ceil(sum(coalesce(measured_seconds, greatest(duration_seconds, coalesce(provider_duration_seconds, 0)))))::integer
  into v_transcript, v_provider, v_target
  from public.scribe_segments where scribe_id = p_scribe_id;

  if v_target > v_scribe.duration_seconds then
    -- More audio than was charged: charge the difference.
    v_change := v_target - v_scribe.duration_seconds;
    perform app_private.change_credit(v_scribe.owner_id, v_scribe.provider, -v_change, 'correction',
      p_scribe_id, null, 'Measured length');
  elsif v_scribe.charged_seconds > 0 and v_target < v_scribe.duration_seconds - 2 then
    -- Less audio than was charged: give the difference back.
    v_change := -least(v_scribe.duration_seconds - v_target, v_scribe.charged_seconds);
    perform app_private.change_credit(v_scribe.owner_id, v_scribe.provider, -v_change, 'correction',
      p_scribe_id, null, 'Measured length');
  end if;

  update public.scribes
  set status = 'transcribed',
      transcript = coalesce(v_transcript, ''),
      provider_duration_seconds = v_provider,
      duration_seconds = case when v_change <> 0 then v_target else duration_seconds end,
      charged_seconds = case when charged_seconds > 0 then charged_seconds + v_change else 0 end,
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
