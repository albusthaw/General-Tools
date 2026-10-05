-- Clinical Scribe 1.5: Voice Note.
-- A recording is either Clinical Scribe (two or more people talking, mode 'scribe')
-- or a Voice Note (one person dictating, mode 'voice'). Templates carry the same
-- Template Type. Existing recordings and templates become Clinical Scribe; SOAP
-- note stays its default and a shared "Dictated note" becomes the Voice Note default.
-- This file only adds things and replaces functions. The only stored values it sets
-- are the Clinical Scribe type on existing rows and the new template.

-- Types -----------------------------------------------------------------------

alter table public.scribes
  add column mode text not null default 'scribe' check (mode in ('scribe', 'voice'));
alter table public.templates
  add column mode text not null default 'scribe' check (mode in ('scribe', 'voice'));
alter table app_private.deleted_recordings
  add column mode text not null default 'scribe' check (mode in ('scribe', 'voice'));

-- One default template for each type instead of one in total.
drop index if exists public.templates_single_default;
create unique index templates_default_per_mode on public.templates (mode) where is_default;

create index scribes_owner_mode_idx on public.scribes (owner_id, mode, started_at desc);

-- The Voice Note default, added once.
insert into public.templates (scope, name, description, body, is_default, mode)
select
  'shared',
  'Dictated note',
  'Your dictation as a clear note: summary, details and plan.',
  $voice$Summary:
[The main point of the dictation in one or two sentences.]

Details:
[Everything the clinician dictated, as clear clinical text, in the order given. Keep drug names, doses, numbers and units exactly as dictated.]

Plan:
[Actions, tests, treatment, referrals and follow-up the clinician dictated.]$voice$,
  true,
  'voice'
where not exists (select 1 from public.templates where mode = 'voice' and is_default);

-- The name people see for a type.
create or replace function app_private.mode_label(p_mode text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mode when 'voice' then 'Voice Note' else 'Clinical Scribe' end;
$$;

-- A template the person may use for a recording of this type.
create or replace function app_private.template_fits(p_template uuid, p_user uuid, p_mode text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.templates t
    where t.id = p_template
      and t.mode = p_mode
      and ((t.scope = 'shared' and not t.is_archived) or t.owner_id = p_user)
  );
$$;

revoke execute on function app_private.mode_label(text) from public;
revoke execute on function app_private.template_fits(uuid, uuid, text) from public;

-- Recording -------------------------------------------------------------------

-- Start a recording of either type. Returns where to upload the audio parts and
-- the limits. Without a type it is a Clinical Scribe recording, as before.
drop function if exists public.start_scribe(uuid, text, text);

create or replace function public.start_scribe(p_template_id uuid, p_title text, p_mime_type text, p_mode text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_mode text := coalesce(p_mode, 'scribe');
  v_p public.profiles%rowtype;
  v_s public.app_settings%rowtype;
  v_ext text := app_private.extension_for_mime(p_mime_type);
  v_balance integer;
  v_max integer;
  v_id uuid;
begin
  if v_mode not in ('scribe', 'voice') then
    perform app_private.fail('invalid_input', 'Choose Clinical Scribe or Voice Note.');
  end if;
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
  if p_template_id is not null and not app_private.template_fits(p_template_id, v_uid, v_mode) then
    perform app_private.fail('wrong_template',
      format('That template is not a %s template. Choose another one.', app_private.mode_label(v_mode)));
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

  insert into public.scribes (owner_id, title, template_id, mime_type, mode)
  values (v_uid, btrim(coalesce(p_title, '')), p_template_id, p_mime_type, v_mode)
  returning id into v_id;

  return jsonb_build_object(
    'scribe_id', v_id,
    'mode', v_mode,
    'upload_prefix', v_uid::text || '/' || v_id::text,
    'extension', v_ext,
    'segment_seconds', app_private.segment_seconds(),
    'max_seconds', v_max,
    'unlimited', v_p.credit_unlimited,
    'credit_seconds_left', case when v_p.credit_unlimited then null else v_balance end
  );
end;
$$;

-- "Write another note": the template must be of the recording's type.
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
  if not app_private.template_fits(p_template_id, v_uid, v_scribe.mode) then
    perform app_private.fail('wrong_template',
      format('Choose a %s template for this recording.', app_private.mode_label(v_scribe.mode)));
  end if;
  if (select count(*) from public.notes where owner_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    perform app_private.fail('too_many', 'You have asked for a lot of notes in the last hour. Please try again a little later.');
  end if;
  return app_private.queue_note(p_scribe_id, p_template_id, v_uid);
end;
$$;

-- Delete a recording with its transcript and notes; the audit entry keeps the type.
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
    jsonb_build_object('title', v_scribe.title, 'recorded_at', v_scribe.started_at, 'mode', v_scribe.mode,
                       'notes', (select count(*) from public.notes where scribe_id = p_scribe_id)));
  delete from public.scribes where id = p_scribe_id;
end;
$$;

-- Join the parts, settle credit to the measured length, and queue the first note
-- with the template chosen before recording, or the default of the recording's type.
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

-- History: one page (10 recordings, newest first) of the signed-in person's own
-- recordings of one type, or of both when no type is given, searching the label,
-- the transcript, the notes and their template names.
drop function if exists public.search_my_recordings(text, integer);

create or replace function public.search_my_recordings(p_query text default '', p_page integer default 1, p_mode text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_mode text := nullif(btrim(coalesce(p_mode, '')), '');
  v_term text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 100);
  v_like text;
  v_size constant integer := 10;
  v_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
  v_total integer;
  v_items jsonb;
begin
  if v_mode is not null and v_mode not in ('scribe', 'voice') then
    perform app_private.fail('invalid_input', 'Choose Clinical Scribe or Voice Note.');
  end if;
  v_like := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select count(*) into v_total
  from public.scribes s
  where s.owner_id = v_uid
    and (v_mode is null or s.mode = v_mode)
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
        'mode', s.mode,
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
      and (v_mode is null or s.mode = v_mode)
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

-- Templates ---------------------------------------------------------------------

-- Save a personal template (insert or update), or a shared one when the caller is
-- an admin. The Template Type is chosen when the template is made and stays.
drop function if exists public.save_template(uuid, text, text, text, text, text);

create or replace function public.save_template(
  p_id uuid,
  p_name text,
  p_description text,
  p_body text,
  p_source_request text,
  p_scope text,
  p_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := public.is_admin();
  v_row public.templates%rowtype;
  v_id uuid;
  v_mode text := coalesce(p_mode, 'scribe');
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_active_user() then
    perform app_private.fail('not_allowed', 'Your account cannot do this.');
  end if;
  if p_scope not in ('shared', 'personal') then
    perform app_private.fail('invalid_input', 'Choose who can use this template.');
  end if;
  if v_mode not in ('scribe', 'voice') then
    perform app_private.fail('invalid_input', 'Choose a Template Type.');
  end if;
  if p_scope = 'shared' and not v_admin then
    perform app_private.fail('not_allowed', 'Only administrators can save shared templates.');
  end if;
  if char_length(v_name) not between 1 and 80 then
    perform app_private.fail('invalid_input', 'Give the template a name of up to 80 characters.');
  end if;
  if char_length(v_body) not between 10 and 12000 then
    perform app_private.fail('invalid_input', 'The template text must be between 10 and 12,000 characters.');
  end if;
  if char_length(coalesce(p_description, '')) > 300 then
    perform app_private.fail('invalid_input', 'Keep the description to 300 characters.');
  end if;

  if p_id is null then
    insert into public.templates (scope, owner_id, name, description, body, source_request, created_by, mode)
    values (
      p_scope,
      case when p_scope = 'personal' then v_uid end,
      v_name,
      btrim(coalesce(p_description, '')),
      v_body,
      left(coalesce(p_source_request, ''), 4000),
      v_uid,
      v_mode
    )
    returning id into v_id;
    if p_scope = 'shared' then
      perform app_private.audit(v_uid, 'template.shared_created', null, null, null, '',
        jsonb_build_object('template_id', v_id, 'name', v_name, 'mode', v_mode));
    end if;
    return v_id;
  end if;

  select * into v_row from public.templates where id = p_id for update;
  if not found then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;
  if v_row.scope = 'personal' and v_row.owner_id is distinct from v_uid then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;
  if v_row.scope = 'shared' and not v_admin then
    perform app_private.fail('not_allowed', 'Only administrators can change shared templates.');
  end if;
  if v_row.scope <> p_scope then
    perform app_private.fail('invalid_input', 'A template cannot change between shared and personal.');
  end if;
  if p_mode is not null and p_mode <> v_row.mode then
    perform app_private.fail('invalid_input', 'The Template Type cannot be changed. Make a new template instead.');
  end if;

  update public.templates
  set name = v_name,
      description = btrim(coalesce(p_description, '')),
      body = v_body,
      source_request = case when coalesce(p_source_request, '') = '' then source_request
                            else left(p_source_request, 4000) end
  where id = p_id;

  if v_row.scope = 'shared' then
    perform app_private.audit(v_uid, 'template.shared_updated', null, null, null, '',
      jsonb_build_object('template_id', p_id, 'name', v_name, 'mode', v_row.mode));
  end if;
  return p_id;
end;
$$;

-- Delete a personal template, or archive a shared one (admins).
create or replace function public.delete_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.templates%rowtype;
begin
  if not public.is_active_user() then
    perform app_private.fail('not_allowed', 'Your account cannot do this.');
  end if;
  select * into v_row from public.templates where id = p_id for update;
  if not found or (v_row.scope = 'personal' and v_row.owner_id is distinct from v_uid) then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;

  if v_row.scope = 'personal' then
    delete from public.templates where id = p_id;
    return;
  end if;

  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can remove shared templates.');
  end if;
  if v_row.is_default then
    perform app_private.fail('is_default',
      format('Choose another default %s template before removing this one.', app_private.mode_label(v_row.mode)));
  end if;
  update public.templates set is_archived = true where id = p_id;
  perform app_private.audit(v_uid, 'template.shared_archived', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_row.name, 'mode', v_row.mode));
end;
$$;

create or replace function public.restore_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_mode text;
begin
  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  update public.templates set is_archived = false
  where id = p_id and scope = 'shared'
  returning name, mode into v_name, v_mode;
  if v_name is null then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;
  perform app_private.audit(v_uid, 'template.shared_restored', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_name, 'mode', v_mode));
end;
$$;

-- Make a shared template the default of its own type.
create or replace function public.set_default_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_mode text;
begin
  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  select name, mode into v_name, v_mode from public.templates
  where id = p_id and scope = 'shared' and not is_archived
  for update;
  if v_name is null then
    perform app_private.fail('not_found', 'Only an active shared template can be the default.');
  end if;
  update public.templates set is_default = false where is_default and mode = v_mode and id <> p_id;
  update public.templates set is_default = true where id = p_id;
  perform app_private.audit(v_uid, 'template.default_changed', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_name, 'mode', v_mode));
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
    jsonb_build_object('template_id', p_id, 'name', v_row.name, 'from', 'personal', 'mode', v_row.mode));
end;
$$;

-- Admin pages ---------------------------------------------------------------------

-- Deleted recordings keep their type in the short record.
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
    (scribe_id, owner_id, owner_name, owner_email, recorded_at, duration_seconds, segment_count, reason, mode)
  values
    (old.id, old.owner_id, coalesce(v_p.full_name, ''), coalesce(v_p.email, ''), old.started_at,
     old.duration_seconds, old.segment_count, case when v_p.id is null then 'account_removed' else 'person' end, old.mode)
  on conflict (scribe_id) do nothing;
  return old;
end;
$$;

create or replace function app_private.remember_removed_person_recordings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.deleted_recordings
    (scribe_id, owner_id, owner_name, owner_email, recorded_at, duration_seconds, segment_count, reason, mode)
  select s.id, s.owner_id, coalesce(old.full_name, ''), coalesce(old.email, ''), s.started_at,
         s.duration_seconds, s.segment_count, 'account_removed', s.mode
  from public.scribes s
  where s.owner_id = old.id and s.segment_count > 0
  on conflict (scribe_id) do nothing;
  return old;
end;
$$;

-- The list for the Recording page, with each recording's type and a type filter.
drop function if exists public.admin_list_recordings(uuid, text, timestamptz, integer);

create or replace function public.admin_list_recordings(
  p_person uuid default null,
  p_audio text default '',
  p_before timestamptz default null,
  p_limit integer default 50,
  p_mode text default ''
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
  deleted_reason text,
  mode text
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
  if coalesce(p_mode, '') not in ('', 'scribe', 'voice') then
    perform app_private.fail('invalid_input', 'Unknown filter.');
  end if;
  select s.audio_retention_days into v_days from public.app_settings s where s.id;

  return query
  select r.scribe_id, r.owner_id, r.owner_name, r.owner_email, r.recorded_at, r.duration_seconds,
         r.segment_count, r.status, r.audio_state, r.keep_until, r.deleted_at, r.deleted_reason, r.mode
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
      case when s.audio_deleted_at is not null then 'retention' end as deleted_reason,
      s.mode
    from public.scribes s
    join public.profiles p on p.id = s.owner_id
    where p_person is null or s.owner_id = p_person
    union all
    select d.scribe_id, d.owner_id, d.owner_name, d.owner_email, d.recorded_at, d.duration_seconds,
           d.segment_count, 'deleted', 'deleted', null, d.deleted_at, d.reason, d.mode
    from app_private.deleted_recordings d
    where p_person is null or d.owner_id = p_person
  ) r
  where (p_before is null or r.recorded_at < p_before)
    and (
      coalesce(p_audio, '') = ''
      or (p_audio = 'kept' and r.audio_state = 'kept')
      or (p_audio = 'deleted' and r.audio_state = 'deleted')
    )
    and (coalesce(p_mode, '') = '' or r.mode = p_mode)
  order by r.recorded_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Opening a recording's audio, and each download, names its type in the audit log.
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
    jsonb_build_object('title', v_s.title, 'recorded_at', v_s.started_at, 'parts', jsonb_array_length(v_parts),
                       'mode', v_s.mode),
    p_user_agent);

  return jsonb_build_object(
    'owner_name', coalesce(nullif(v_owner.full_name, ''), v_owner.email, ''),
    'title', v_s.title,
    'mode', v_s.mode,
    'recorded_at', v_s.started_at,
    'duration_seconds', v_s.duration_seconds,
    'parts', v_parts
  );
end;
$$;

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
      jsonb_build_object('part', p_seq, 'title', v_s.title, 'recorded_at', v_s.started_at, 'mode', v_s.mode), p_user_agent);
  end if;
  return jsonb_build_object(
    'storage_path', v_g.storage_path,
    'mime_type', v_g.mime_type,
    'recorded_at', v_s.started_at
  );
end;
$$;

-- Review records: the list and an opened record carry the type.
drop function if exists public.admin_review_list(uuid);

create or replace function public.admin_review_list(p_review_id uuid)
returns table (
  id uuid,
  title text,
  status text,
  duration_seconds integer,
  started_at timestamptz,
  transcribed_at timestamptz,
  note_count bigint,
  mode text
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
           (select count(*) from public.notes n where n.scribe_id = s.id and n.status = 'done'),
           s.mode
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
    v_review.id, v_review.reason,
    jsonb_build_object('title', v_scribe.title, 'recorded_at', v_scribe.started_at, 'mode', v_scribe.mode));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'template_name', n.template_name, 'status', n.status,
           'content', n.content, 'created_at', n.created_at, 'completed_at', n.completed_at
         ) order by n.created_at desc), '[]'::jsonb)
  into v_notes
  from public.notes n
  where n.scribe_id = p_scribe_id and n.status = 'done';

  return jsonb_build_object(
    'id', v_scribe.id,
    'mode', v_scribe.mode,
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

-- Grants --------------------------------------------------------------------------

revoke execute on function public.start_scribe(uuid, text, text, text) from public, anon;
revoke execute on function public.search_my_recordings(text, integer, text) from public, anon;
revoke execute on function public.save_template(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.admin_list_recordings(uuid, text, timestamptz, integer, text) from public, anon;
revoke execute on function public.admin_review_list(uuid) from public, anon;

grant execute on function public.start_scribe(uuid, text, text, text) to authenticated;
grant execute on function public.search_my_recordings(text, integer, text) to authenticated;
grant execute on function public.save_template(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_list_recordings(uuid, text, timestamptz, integer, text) to authenticated;
grant execute on function public.admin_review_list(uuid) to authenticated;
