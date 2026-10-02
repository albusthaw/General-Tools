-- Clinical Scribe: what signed-in people can do with recordings and notes.
-- Every function checks the caller, validates input and keeps credit in step.

create or replace function app_private.segment_seconds()
returns integer
language sql
immutable
set search_path = ''
as $$ select 600 $$;

create or replace function app_private.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_active_user() then
    perform app_private.fail('not_allowed', 'Your account cannot do this. Ask your administrator.');
  end if;
  return v_uid;
end;
$$;

create or replace function app_private.provider_key_name(p_provider text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_provider
    when 'elevenlabs' then 'elevenlabs_api_key'
    when 'gemini' then 'gemini_api_key'
    when 'deepseek' then 'deepseek_api_key'
  end;
$$;

create or replace function app_private.credit_balance(p_profile public.profiles, p_provider text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_provider
    when 'elevenlabs' then p_profile.credit_seconds_elevenlabs
    else p_profile.credit_seconds_gemini
  end;
$$;

create or replace function app_private.template_visible(p_template uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.templates t
    where t.id = p_template
      and ((t.scope = 'shared' and not t.is_archived) or t.owner_id = p_user)
  );
$$;

create or replace function app_private.extension_for_mime(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    when 'audio/mp4' then 'm4a'
    when 'audio/x-m4a' then 'm4a'
    when 'audio/m4a' then 'm4a'
    when 'audio/aac' then 'aac'
  end;
$$;

revoke execute on function app_private.require_active_user() from public;
revoke execute on function app_private.template_visible(uuid, uuid) from public;

-- What the signed-in person needs to know to use the app.
create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_p public.profiles%rowtype;
  v_s public.app_settings%rowtype;
begin
  if v_uid is null then
    perform app_private.fail('not_signed_in', 'Please sign in again.');
  end if;
  select * into v_p from public.profiles where id = v_uid;
  if not found then
    perform app_private.fail('no_profile', 'Your account is not set up yet. Ask your administrator.');
  end if;
  select * into v_s from public.app_settings where id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_p.id, 'email', v_p.email, 'full_name', v_p.full_name,
      'role', v_p.role, 'status', v_p.status
    ),
    'credit', jsonb_build_object(
      'provider', v_s.transcription_provider,
      'unlimited', v_p.credit_unlimited,
      'seconds_left', app_private.credit_balance(v_p, v_s.transcription_provider),
      'elevenlabs_seconds', v_p.credit_seconds_elevenlabs,
      'gemini_seconds', v_p.credit_seconds_gemini
    ),
    'recording', jsonb_build_object(
      'segment_seconds', app_private.segment_seconds(),
      'max_minutes', v_s.max_recording_minutes
    ),
    'ready', jsonb_build_object(
      'transcription', app_private.secret_is_set(app_private.provider_key_name(v_s.transcription_provider)),
      'notes', app_private.secret_is_set(app_private.provider_key_name(v_s.note_provider)),
      'templates', app_private.secret_is_set(app_private.provider_key_name(v_s.template_provider))
    ),
    'idle_signout_minutes', v_s.idle_signout_minutes,
    'server_version', (select value from app_private.app_meta where key = 'schema_version')
  );
end;
$$;

create or replace function public.update_my_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if char_length(v_name) not between 1 and 120 then
    perform app_private.fail('invalid_input', 'Enter a name of up to 120 characters.');
  end if;
  update public.profiles set full_name = v_name where id = v_uid;
end;
$$;

-- Start a recording. Returns where to upload the audio parts and the limits.
create or replace function public.start_scribe(p_template_id uuid, p_title text, p_mime_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_p public.profiles%rowtype;
  v_s public.app_settings%rowtype;
  v_ext text := app_private.extension_for_mime(p_mime_type);
  v_balance integer;
  v_max integer;
  v_id uuid;
begin
  select * into v_s from public.app_settings where id;
  select * into v_p from public.profiles where id = v_uid for update;

  if not app_private.secret_is_set(app_private.provider_key_name(v_s.transcription_provider)) then
    perform app_private.fail('not_set_up', 'Transcription is not set up yet. Ask your administrator to add the service key in AI settings.');
  end if;
  if v_ext is null then
    perform app_private.fail('unsupported_audio', 'This browser records audio in a format that cannot be used. Try Chrome, Edge, Firefox or Safari.');
  end if;
  if p_template_id is not null and not app_private.template_visible(p_template_id, v_uid) then
    perform app_private.fail('not_found', 'That template is no longer available. Choose another one.');
  end if;
  if char_length(coalesce(p_title, '')) > 120 then
    perform app_private.fail('invalid_input', 'Keep the label to 120 characters.');
  end if;

  v_balance := app_private.credit_balance(v_p, v_s.transcription_provider);
  if not v_p.credit_unlimited and v_balance < 30 then
    perform app_private.fail('not_enough_credit', 'You have no transcription minutes left. Ask your administrator to add more.');
  end if;

  if (select count(*) from public.scribes
      where owner_id = v_uid and status = 'recording' and last_activity_at > now() - interval '24 hours') >= 3 then
    perform app_private.fail('too_many_open', 'You have unfinished recordings. Finish or delete them in History first.');
  end if;

  v_max := v_s.max_recording_minutes * 60;
  if not v_p.credit_unlimited then
    v_max := least(v_max, v_balance);
  end if;

  insert into public.scribes (owner_id, title, template_id, mime_type)
  values (v_uid, btrim(coalesce(p_title, '')), p_template_id, p_mime_type)
  returning id into v_id;

  return jsonb_build_object(
    'scribe_id', v_id,
    'upload_prefix', v_uid::text || '/' || v_id::text,
    'extension', v_ext,
    'segment_seconds', app_private.segment_seconds(),
    'max_seconds', v_max,
    'unlimited', v_p.credit_unlimited,
    'credit_seconds_left', case when v_p.credit_unlimited then null else v_balance end
  );
end;
$$;

-- Record that an audio part has been uploaded. The file must really be in Storage.
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

-- Queue transcription for every part that is not done yet, charging credit.
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
  v_total numeric;
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

  select coalesce(sum(duration_seconds), 0), count(*) filter (where status <> 'done')
  into v_total, v_pending
  from public.scribe_segments where scribe_id = p_scribe_id;

  -- The browser reports the length; it can never be more than the real time that passed.
  v_wall := extract(epoch from coalesce(v_scribe.finished_at, now()) - v_scribe.started_at) + 60;
  v_duration := ceil(least(v_total, v_wall))::integer;
  if v_duration < 1 then
    perform app_private.fail('too_short', 'The recording is too short to process.');
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

revoke execute on function app_private.queue_transcription(uuid, uuid) from public;

-- Finish a recording and hand it to the server.
create or replace function public.finish_scribe(p_scribe_id uuid, p_segment_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
  v_count integer;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_scribe.status <> 'recording' then
    return jsonb_build_object('status', v_scribe.status);
  end if;

  select count(*) into v_count from public.scribe_segments where scribe_id = p_scribe_id;
  if v_count = 0 then
    perform app_private.fail('too_short', 'The recording is too short to process.');
  end if;
  if p_segment_count is not null and v_count < p_segment_count then
    perform app_private.fail('parts_missing', 'Some audio is still being saved. Please wait a moment.');
  end if;

  update public.scribes set finished_at = now() where id = p_scribe_id;
  perform app_private.queue_transcription(p_scribe_id, v_uid);
  return jsonb_build_object('status', 'processing');
end;
$$;

-- Try a failed recording again.
create or replace function public.retry_scribe(p_scribe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_scribe.status <> 'failed' then
    perform app_private.fail('not_failed', 'This recording does not need to be tried again.');
  end if;
  if exists (select 1 from public.scribe_segments where scribe_id = p_scribe_id and status <> 'done' and audio_deleted) then
    perform app_private.fail('audio_gone', 'The audio for this recording has been deleted, so it cannot be processed again.');
  end if;

  perform app_private.queue_transcription(p_scribe_id, v_uid);
  return jsonb_build_object('status', 'processing');
end;
$$;

-- Throw away a recording that is still open.
create or replace function public.discard_scribe(p_scribe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.owner_id <> v_uid then
    return;
  end if;
  if v_scribe.status <> 'recording' then
    perform app_private.fail('not_recording', 'This recording has already been finished.');
  end if;
  insert into public.jobs (kind, payload, max_attempts)
  values ('delete_files', jsonb_build_object('prefix', v_uid::text || '/' || p_scribe_id::text), 10);
  delete from public.scribes where id = p_scribe_id;
end;
$$;

-- Delete a recording with its transcript and notes.
create or replace function public.delete_scribe(p_scribe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id for update;
  if not found or v_scribe.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_scribe.status = 'processing' then
    perform app_private.fail('busy', 'This recording is still being processed. You can delete it when it is ready.');
  end if;
  insert into public.jobs (kind, payload, max_attempts)
  values ('delete_files', jsonb_build_object('prefix', v_uid::text || '/' || p_scribe_id::text), 10);
  perform app_private.audit(v_uid, 'scribe.deleted', v_uid, p_scribe_id, null, '',
    jsonb_build_object('title', v_scribe.title, 'recorded_at', v_scribe.started_at,
                       'notes', (select count(*) from public.notes where scribe_id = p_scribe_id)));
  delete from public.scribes where id = p_scribe_id;
end;
$$;

create or replace function public.rename_scribe(p_scribe_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
begin
  if char_length(btrim(coalesce(p_title, ''))) > 120 then
    perform app_private.fail('invalid_input', 'Keep the label to 120 characters.');
  end if;
  update public.scribes set title = btrim(coalesce(p_title, ''))
  where id = p_scribe_id and owner_id = v_uid;
  if not found then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
end;
$$;

-- Queue a note from a transcript with the chosen template.
create or replace function app_private.queue_note(p_scribe_id uuid, p_template_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scribe public.scribes%rowtype;
  v_t public.templates%rowtype;
  v_s public.app_settings%rowtype;
  v_id uuid;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id;
  select * into v_t from public.templates where id = p_template_id;
  select * into v_s from public.app_settings where id;

  if not app_private.secret_is_set(app_private.provider_key_name(v_s.note_provider)) then
    perform app_private.fail('not_set_up', 'Note writing is not set up yet. Ask your administrator to add the service key in AI settings.');
  end if;

  insert into public.notes (scribe_id, owner_id, template_id, template_name, template_body,
                            provider, model, reasoning, spelling, requested_by)
  values (
    p_scribe_id, v_scribe.owner_id, v_t.id, v_t.name, v_t.body,
    v_s.note_provider,
    case v_s.note_provider when 'gemini' then v_s.gemini_note_model else v_s.deepseek_note_model end,
    v_s.note_reasoning, v_s.note_spelling, p_actor
  )
  returning id into v_id;

  insert into public.jobs (kind, scribe_id, note_id, max_attempts) values ('generate_note', p_scribe_id, v_id, 4);
  return v_id;
end;
$$;

revoke execute on function app_private.queue_note(uuid, uuid, uuid) from public;

create or replace function public.request_note(p_scribe_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_scribe public.scribes%rowtype;
begin
  select * into v_scribe from public.scribes where id = p_scribe_id;
  if not found or v_scribe.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That recording no longer exists.');
  end if;
  if v_scribe.status <> 'transcribed' then
    perform app_private.fail('not_ready', 'The transcript is not ready yet.');
  end if;
  if p_template_id is null or not app_private.template_visible(p_template_id, v_uid) then
    perform app_private.fail('not_found', 'That template is no longer available. Choose another one.');
  end if;
  if (select count(*) from public.notes where owner_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    perform app_private.fail('too_many', 'You have asked for a lot of notes in the last hour. Please try again a little later.');
  end if;
  return app_private.queue_note(p_scribe_id, p_template_id, v_uid);
end;
$$;

create or replace function public.retry_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_note public.notes%rowtype;
  v_s public.app_settings%rowtype;
begin
  select * into v_note from public.notes where id = p_note_id for update;
  if not found or v_note.owner_id <> v_uid then
    perform app_private.fail('not_found', 'That note no longer exists.');
  end if;
  if v_note.status <> 'failed' then
    perform app_private.fail('not_failed', 'This note does not need to be tried again.');
  end if;
  select * into v_s from public.app_settings where id;
  if not app_private.secret_is_set(app_private.provider_key_name(v_s.note_provider)) then
    perform app_private.fail('not_set_up', 'Note writing is not set up yet. Ask your administrator to add the service key in AI settings.');
  end if;

  update public.notes
  set status = 'queued',
      error_message = null,
      provider = v_s.note_provider,
      model = case v_s.note_provider when 'gemini' then v_s.gemini_note_model else v_s.deepseek_note_model end,
      reasoning = v_s.note_reasoning,
      spelling = v_s.note_spelling
  where id = p_note_id;
  insert into public.jobs (kind, scribe_id, note_id, max_attempts) values ('generate_note', v_note.scribe_id, p_note_id, 4);
end;
$$;

revoke execute on function public.get_my_context() from public, anon;
revoke execute on function public.update_my_name(text) from public, anon;
revoke execute on function public.start_scribe(uuid, text, text) from public, anon;
revoke execute on function public.register_segment(uuid, integer, numeric, text) from public, anon;
revoke execute on function public.finish_scribe(uuid, integer) from public, anon;
revoke execute on function public.retry_scribe(uuid) from public, anon;
revoke execute on function public.discard_scribe(uuid) from public, anon;
revoke execute on function public.delete_scribe(uuid) from public, anon;
revoke execute on function public.rename_scribe(uuid, text) from public, anon;
revoke execute on function public.request_note(uuid, uuid) from public, anon;
revoke execute on function public.retry_note(uuid) from public, anon;

grant execute on function public.get_my_context() to authenticated;
grant execute on function public.update_my_name(text) to authenticated;
grant execute on function public.start_scribe(uuid, text, text) to authenticated;
grant execute on function public.register_segment(uuid, integer, numeric, text) to authenticated;
grant execute on function public.finish_scribe(uuid, integer) to authenticated;
grant execute on function public.retry_scribe(uuid) to authenticated;
grant execute on function public.discard_scribe(uuid) to authenticated;
grant execute on function public.delete_scribe(uuid) to authenticated;
grant execute on function public.rename_scribe(uuid, text) to authenticated;
grant execute on function public.request_note(uuid, uuid) to authenticated;
grant execute on function public.retry_note(uuid) to authenticated;
