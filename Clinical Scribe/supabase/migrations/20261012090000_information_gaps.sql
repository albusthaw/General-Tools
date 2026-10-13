-- Clinical Scribe 1.6: information gaps.
-- A call or other sound pauses a recording, and the Android app starts it again by
-- itself once the call or the sound has ended. Such a pause is a gap: nothing was
-- recorded there. The audio part recorded after a gap says how long it was and why.
-- When the parts are joined, a line marks each gap at its exact place in the
-- transcript, and the note writer must point it out in every note.
-- This file only adds columns and functions and replaces functions; it changes no
-- stored values.

-- Parts --------------------------------------------------------------------------

alter table public.scribe_segments
  add column gap_seconds numeric
    check (gap_seconds is null or (gap_seconds >= 0 and gap_seconds <= 86400)),
  add column gap_reason text
    check (gap_reason is null or gap_reason in ('call', 'other_audio', 'mic_lost', 'mic_busy', 'interrupted', 'hidden', 'media'));

-- People may read where and why their own recordings paused.
grant select (gap_seconds, gap_reason) on table public.scribe_segments to authenticated;

-- Words for the gap line ----------------------------------------------------------

-- 754 -> "12:34", 3723 -> "1:02:03", like the recording clock in the app.
create or replace function app_private.clock_text(p_seconds numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when s >= 3600 then format('%s:%s:%s', s / 3600, lpad(((s % 3600) / 60)::text, 2, '0'), lpad((s % 60)::text, 2, '0'))
    else format('%s:%s', s / 60, lpad((s % 60)::text, 2, '0'))
  end
  from (select greatest(0, floor(coalesce(p_seconds, 0)))::bigint as s) t;
$$;

-- 45 -> "45 seconds", 80 -> "1 minute 20 seconds", 3900 -> "1 hour 5 minutes".
create or replace function app_private.length_text(p_seconds numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when s < 60 then format('%s %s', s, case when s = 1 then 'second' else 'seconds' end)
    when s < 3600 then format('%s %s', s / 60, case when s / 60 = 1 then 'minute' else 'minutes' end)
      || case when s % 60 = 0 then '' else format(' %s %s', s % 60, case when s % 60 = 1 then 'second' else 'seconds' end) end
    else format('%s %s', s / 3600, case when s / 3600 = 1 then 'hour' else 'hours' end)
      || case when (s % 3600) / 60 = 0 then ''
              else format(' %s %s', (s % 3600) / 60, case when (s % 3600) / 60 = 1 then 'minute' else 'minutes' end) end
  end
  from (select greatest(1, round(coalesce(p_seconds, 0)))::bigint as s) t;
$$;

-- Why a recording paused, in words that follow "because of".
create or replace function app_private.gap_cause(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'call' then 'a phone call'
    when 'other_audio' then 'another app playing sound'
    when 'mic_lost' then 'the microphone stopping'
    when 'mic_busy' then 'another app using the microphone'
    when 'hidden' then 'the screen locking or another app opening'
    when 'media' then 'sound playing in Clinical Scribe'
    else 'an interruption'
  end;
$$;

-- The line that marks a gap in the transcript. The note writer and the app both
-- recognise it by its start: "[Information gap at <time>."
create or replace function app_private.gap_line(p_at numeric, p_seconds numeric, p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select format('[Information gap at %s. The recording paused for %s because of %s. Nothing was recorded during this time.]',
                app_private.clock_text(p_at), app_private.length_text(p_seconds), app_private.gap_cause(p_reason));
$$;

revoke execute on function app_private.clock_text(numeric) from public;
revoke execute on function app_private.length_text(numeric) from public;
revoke execute on function app_private.gap_cause(text) from public;
revoke execute on function app_private.gap_line(numeric, numeric, text) from public;

-- Recording -----------------------------------------------------------------------

-- Record that an audio part has been uploaded, with the gap it starts after when
-- the recording paused by itself before it. The file must really be in Storage, and
-- the parts may not add up to more than the longest recording allowed. A gap that
-- makes no sense is left out rather than refusing the audio; an unknown reason is
-- kept as an interruption. Without the gap it is the call older apps make.
drop function if exists public.register_segment(uuid, integer, numeric, text);

create or replace function public.register_segment(
  p_scribe_id uuid,
  p_seq integer,
  p_duration_seconds numeric,
  p_mime_type text,
  p_gap_seconds numeric default null,
  p_gap_reason text default null
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
  v_gap numeric := case when p_gap_seconds >= 0 then round(least(p_gap_seconds, 86400), 2) end;
  v_reason text;
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
  if v_gap is not null then
    v_reason := case when p_gap_reason in ('call', 'other_audio', 'mic_lost', 'mic_busy', 'interrupted', 'hidden', 'media')
                     then p_gap_reason else 'interrupted' end;
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

  insert into public.scribe_segments (scribe_id, owner_id, seq, storage_path, mime_type, byte_size, duration_seconds, gap_seconds, gap_reason)
  values (p_scribe_id, v_uid, p_seq, v_path, p_mime_type, greatest(v_size, 1), round(p_duration_seconds, 2), v_gap, v_reason)
  on conflict (scribe_id, seq) do update
    set duration_seconds = excluded.duration_seconds,
        byte_size = excluded.byte_size,
        gap_seconds = excluded.gap_seconds,
        gap_reason = excluded.gap_reason
    where public.scribe_segments.status = 'uploaded';

  select count(*) into v_count from public.scribe_segments where scribe_id = p_scribe_id;
  update public.scribes
  set segment_count = v_count, last_activity_at = now(), mime_type = p_mime_type
  where id = p_scribe_id;

  return jsonb_build_object('segment_count', v_count);
end;
$$;

revoke execute on function public.register_segment(uuid, integer, numeric, text, numeric, text) from public, anon;
grant execute on function public.register_segment(uuid, integer, numeric, text, numeric, text) to authenticated;

-- Processing ----------------------------------------------------------------------

-- Join the parts, with a line marking each gap before the part recorded after it.
-- A gap's place is the length of all the parts before it. Then settle credit to the
-- measured length, and queue the first note with the template chosen before
-- recording, or the default of the recording's type. A recording in which nothing
-- was said gets no gap lines and no note, as before.
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
  v_spoken text;
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
  select string_agg(nullif(concat_ws(E'\n\n',
                      case when gap_seconds is not null then app_private.gap_line(starts_at, gap_seconds, gap_reason) end,
                      nullif(btrim(transcript), '')), ''), E'\n\n' order by seq),
         string_agg(nullif(btrim(transcript), ''), E'\n\n' order by seq),
         sum(provider_duration_seconds),
         ceil(sum(coalesce(measured_seconds, greatest(duration_seconds, coalesce(provider_duration_seconds, 0)))))::integer
  into v_transcript, v_spoken, v_provider, v_target
  from (
    select seq, transcript, gap_seconds, gap_reason, provider_duration_seconds, measured_seconds, duration_seconds,
           coalesce(sum(coalesce(measured_seconds, duration_seconds))
                      over (order by seq rows between unbounded preceding and 1 preceding), 0) as starts_at
    from public.scribe_segments
    where scribe_id = p_scribe_id
  ) parts;

  if coalesce(btrim(v_spoken), '') = '' then
    v_transcript := '';
  end if;

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
  if v_template is null or not app_private.template_fits(v_template, v_scribe.owner_id, v_scribe.mode) then
    select id into v_template from public.templates where is_default and mode = v_scribe.mode limit 1;
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

revoke execute on function public.svc_finalize_transcript(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.svc_finalize_transcript(bigint, text, uuid) to service_role;
