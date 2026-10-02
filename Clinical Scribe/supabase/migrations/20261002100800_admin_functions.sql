-- Clinical Scribe: admin functions. Every change is written to the audit log.

create or replace function app_private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  return v_uid;
end;
$$;

create or replace function app_private.other_active_admins(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.profiles
  where role = 'admin' and status = 'active' and id <> p_user;
$$;

revoke execute on function app_private.require_admin() from public;
revoke execute on function app_private.other_active_admins(uuid) from public;

-- Settings ---------------------------------------------------------------------

create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.app_settings%rowtype;
  v_keys jsonb;
begin
  perform app_private.require_admin();
  select * into v_s from public.app_settings where id;

  select coalesce(jsonb_object_agg(m.name, jsonb_build_object(
           'last4', m.last4,
           'updated_at', m.updated_at,
           'updated_by', coalesce(nullif(p.full_name, ''), p.email, '')
         )), '{}'::jsonb)
  into v_keys
  from app_private.secret_meta m
  left join public.profiles p on p.id = m.updated_by;

  return jsonb_build_object(
    'settings', to_jsonb(v_s) - 'id' - 'updated_by',
    'secrets', v_keys,
    'server_version', (select value from app_private.app_meta where key = 'schema_version'),
    'worker_connected', exists (select 1 from app_private.runtime_config where key = 'functions_url')
  );
end;
$$;

-- Change AI and recording settings. Only the listed fields can be changed here;
-- Google sign-in and email settings go through the admin Edge Function.
create or replace function public.admin_update_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_old public.app_settings%rowtype;
  v_new public.app_settings%rowtype;
  v_key text;
  v_allowed text[] := array[
    'transcription_provider', 'elevenlabs_model', 'gemini_transcription_model', 'transcription_language',
    'elevenlabs_zero_retention', 'note_provider', 'gemini_note_model', 'deepseek_note_model', 'note_reasoning',
    'note_spelling', 'template_provider', 'gemini_template_model', 'deepseek_template_model',
    'audio_retention_days', 'max_recording_minutes', 'idle_signout_minutes'
  ];
  v_changed jsonb := '{}'::jsonb;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    perform app_private.fail('invalid_input', 'Nothing to save.');
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not v_key = any (v_allowed) then
      perform app_private.fail('invalid_input', 'One of the settings cannot be changed here.');
    end if;
  end loop;

  select * into v_old from public.app_settings where id for update;
  v_new := v_old;

  begin
    if p_changes ? 'transcription_provider' then v_new.transcription_provider := p_changes ->> 'transcription_provider'; end if;
    if p_changes ? 'elevenlabs_model' then v_new.elevenlabs_model := btrim(p_changes ->> 'elevenlabs_model'); end if;
    if p_changes ? 'gemini_transcription_model' then v_new.gemini_transcription_model := btrim(p_changes ->> 'gemini_transcription_model'); end if;
    if p_changes ? 'transcription_language' then v_new.transcription_language := coalesce(p_changes ->> 'transcription_language', ''); end if;
    if p_changes ? 'elevenlabs_zero_retention' then v_new.elevenlabs_zero_retention := (p_changes ->> 'elevenlabs_zero_retention')::boolean; end if;
    if p_changes ? 'note_provider' then v_new.note_provider := p_changes ->> 'note_provider'; end if;
    if p_changes ? 'gemini_note_model' then v_new.gemini_note_model := btrim(p_changes ->> 'gemini_note_model'); end if;
    if p_changes ? 'deepseek_note_model' then v_new.deepseek_note_model := btrim(p_changes ->> 'deepseek_note_model'); end if;
    if p_changes ? 'note_reasoning' then v_new.note_reasoning := (p_changes ->> 'note_reasoning')::boolean; end if;
    if p_changes ? 'note_spelling' then v_new.note_spelling := p_changes ->> 'note_spelling'; end if;
    if p_changes ? 'template_provider' then v_new.template_provider := p_changes ->> 'template_provider'; end if;
    if p_changes ? 'gemini_template_model' then v_new.gemini_template_model := btrim(p_changes ->> 'gemini_template_model'); end if;
    if p_changes ? 'deepseek_template_model' then v_new.deepseek_template_model := btrim(p_changes ->> 'deepseek_template_model'); end if;
    if p_changes ? 'audio_retention_days' then v_new.audio_retention_days := (p_changes ->> 'audio_retention_days')::integer; end if;
    if p_changes ? 'max_recording_minutes' then v_new.max_recording_minutes := (p_changes ->> 'max_recording_minutes')::integer; end if;
    if p_changes ? 'idle_signout_minutes' then v_new.idle_signout_minutes := (p_changes ->> 'idle_signout_minutes')::integer; end if;

    update public.app_settings
    set transcription_provider = v_new.transcription_provider,
        elevenlabs_model = v_new.elevenlabs_model,
        gemini_transcription_model = v_new.gemini_transcription_model,
        transcription_language = v_new.transcription_language,
        elevenlabs_zero_retention = v_new.elevenlabs_zero_retention,
        note_provider = v_new.note_provider,
        gemini_note_model = v_new.gemini_note_model,
        deepseek_note_model = v_new.deepseek_note_model,
        note_reasoning = v_new.note_reasoning,
        note_spelling = v_new.note_spelling,
        template_provider = v_new.template_provider,
        gemini_template_model = v_new.gemini_template_model,
        deepseek_template_model = v_new.deepseek_template_model,
        audio_retention_days = v_new.audio_retention_days,
        max_recording_minutes = v_new.max_recording_minutes,
        idle_signout_minutes = v_new.idle_signout_minutes,
        updated_by = v_uid
    where id;
  exception
    when check_violation or invalid_text_representation or not_null_violation or numeric_value_out_of_range then
      perform app_private.fail('invalid_input', 'One of the settings is not valid. Check the values and try again.');
  end;

  for v_key in select unnest(v_allowed) loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object(
        'from', to_jsonb(v_old) -> v_key, 'to', to_jsonb(v_new) -> v_key));
    end if;
  end loop;

  if v_changed <> '{}'::jsonb then
    perform app_private.audit(v_uid, 'settings.ai_updated', null, null, null, '', v_changed);
  end if;
  return public.admin_get_settings();
end;
$$;

-- People -------------------------------------------------------------------------

create or replace function public.admin_list_users(
  p_search text default '',
  p_status text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  status text,
  credit_seconds_elevenlabs integer,
  credit_seconds_gemini integer,
  credit_unlimited boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
begin
  perform app_private.require_admin();
  if char_length(v_search) > 100 then
    v_search := left(v_search, 100);
  end if;
  return query
    select p.id, p.email, p.full_name, p.role, p.status,
           p.credit_seconds_elevenlabs, p.credit_seconds_gemini, p.credit_unlimited,
           p.created_at, u.last_sign_in_at,
           count(*) over () as total_count
    from public.profiles p
    left join auth.users u on u.id = p.id
    where (v_search = '' or position(v_search in lower(p.email)) > 0 or position(v_search in lower(p.full_name)) > 0)
      and (coalesce(p_status, '') = '' or p.status = p_status)
    order by (p.status = 'pending') desc, lower(coalesce(nullif(p.full_name, ''), p.email))
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_old text;
begin
  if p_role not in ('user', 'admin') then
    perform app_private.fail('invalid_input', 'Choose User or Admin.');
  end if;
  select role into v_old from public.profiles where id = p_user for update;
  if v_old is null then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;
  if v_old = p_role then
    return;
  end if;
  if v_old = 'admin' and app_private.other_active_admins(p_user) = 0 then
    perform app_private.fail('last_admin', 'There must always be at least one active administrator.');
  end if;
  update public.profiles set role = p_role where id = p_user;
  perform app_private.audit(v_uid, 'user.role_changed', p_user, null, null, '',
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- Add or set transcription minutes for one service.
create or replace function public.admin_adjust_credit(
  p_user uuid,
  p_provider text,
  p_mode text,
  p_minutes numeric,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_p public.profiles%rowtype;
  v_seconds integer;
  v_current integer;
  v_balance integer;
begin
  if p_provider not in ('elevenlabs', 'gemini') then
    perform app_private.fail('invalid_input', 'Choose ElevenLabs or Gemini.');
  end if;
  if p_mode not in ('add', 'set') then
    perform app_private.fail('invalid_input', 'Choose to add minutes or set the balance.');
  end if;
  if p_minutes is null or abs(p_minutes) > 1000000 or (p_mode = 'set' and p_minutes < 0) then
    perform app_private.fail('invalid_input', 'Enter a sensible number of minutes.');
  end if;
  if char_length(coalesce(p_note, '')) > 200 then
    perform app_private.fail('invalid_input', 'Keep the note to 200 characters.');
  end if;

  select * into v_p from public.profiles where id = p_user for update;
  if not found then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;

  v_seconds := round(p_minutes * 60)::integer;
  v_current := app_private.credit_balance(v_p, p_provider);

  if p_mode = 'add' then
    if v_seconds = 0 then
      perform app_private.fail('invalid_input', 'Enter a number of minutes other than zero.');
    end if;
    v_balance := app_private.change_credit(p_user, p_provider, v_seconds, 'grant', null, v_uid, btrim(coalesce(p_note, '')));
  else
    v_balance := app_private.change_credit(p_user, p_provider, v_seconds - v_current, 'set', null, v_uid, btrim(coalesce(p_note, '')));
  end if;

  perform app_private.audit(v_uid, 'credit.changed', p_user, null, null, '',
    jsonb_build_object('service', p_provider, 'mode', p_mode, 'minutes', p_minutes,
                       'balance_minutes', round(coalesce(v_balance, 0) / 60.0, 1), 'note', btrim(coalesce(p_note, ''))));
  return jsonb_build_object('balance_seconds', v_balance);
end;
$$;

create or replace function public.admin_set_unlimited(p_user uuid, p_unlimited boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_old boolean;
begin
  select credit_unlimited into v_old from public.profiles where id = p_user for update;
  if v_old is null then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;
  if v_old = coalesce(p_unlimited, false) then
    return;
  end if;
  update public.profiles set credit_unlimited = coalesce(p_unlimited, false) where id = p_user;
  insert into public.credit_ledger (user_id, provider, change_seconds, balance_after, kind, actor_id, note)
  select p_user, pr.provider, 0, null,
         case when p_unlimited then 'unlimited_on' else 'unlimited_off' end, v_uid, ''
  from (values ('elevenlabs'), ('gemini')) as pr(provider);
  perform app_private.audit(v_uid, 'credit.unlimited_changed', p_user, null, null, '',
    jsonb_build_object('unlimited', coalesce(p_unlimited, false)));
end;
$$;

create or replace function public.admin_credit_history(p_user uuid, p_limit integer default 50)
returns table (
  id bigint,
  provider text,
  change_seconds integer,
  balance_after integer,
  kind text,
  note text,
  actor_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();
  return query
    select l.id, l.provider, l.change_seconds, l.balance_after, l.kind, l.note,
           coalesce(nullif(a.full_name, ''), a.email, '') as actor_name, l.created_at
    from public.credit_ledger l
    left join public.profiles a on a.id = l.actor_id
    where l.user_id = p_user
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

-- Audit log ----------------------------------------------------------------------

create or replace function public.admin_list_audit(
  p_action_group text default '',
  p_person uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns setof public.audit_log
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();
  if coalesce(p_action_group, '') !~ '^[a-z_]*$' then
    perform app_private.fail('invalid_input', 'Unknown filter.');
  end if;
  return query
    select * from public.audit_log a
    where (coalesce(p_action_group, '') = '' or split_part(a.action, '.', 1) = p_action_group)
      and (p_person is null or a.actor_id = p_person or a.target_user_id = p_person)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
      and (p_before_id is null or a.id < p_before_id)
    order by a.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$$;

create or replace function public.admin_usage_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := date_trunc('month', now());
begin
  perform app_private.require_admin();
  return jsonb_build_object(
    'since', v_start,
    'recordings', (select count(*) from public.scribes where finished_at >= v_start),
    'transcribed_minutes', (select round(coalesce(sum(duration_seconds), 0) / 60.0, 1)
                            from public.scribes where transcribed_at >= v_start),
    'notes', (select count(*) from public.notes where status = 'done' and completed_at >= v_start),
    'templates_drafted', (select count(*) from public.ai_usage where kind = 'template' and created_at >= v_start),
    'failed_jobs', (select count(*) from public.jobs where status = 'failed' and finished_at >= v_start)
  );
end;
$$;

-- Service functions used by the admin Edge Function -------------------------------

create or replace function public.svc_user_created(
  p_user uuid,
  p_full_name text,
  p_role text,
  p_elevenlabs_minutes numeric,
  p_gemini_minutes numeric,
  p_unlimited boolean,
  p_actor uuid,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role not in ('user', 'admin') then
    raise exception 'Unknown role.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    insert into public.profiles (id, email)
    select u.id, lower(coalesce(u.email, '')) from auth.users u where u.id = p_user;
  end if;
  update public.profiles
  set full_name = left(btrim(coalesce(p_full_name, '')), 120),
      role = p_role,
      status = 'active',
      credit_unlimited = coalesce(p_unlimited, false)
  where id = p_user;

  if coalesce(p_elevenlabs_minutes, 0) > 0 then
    perform app_private.change_credit(p_user, 'elevenlabs', round(p_elevenlabs_minutes * 60)::integer, 'grant',
      null, p_actor, 'Starting minutes');
  end if;
  if coalesce(p_gemini_minutes, 0) > 0 then
    perform app_private.change_credit(p_user, 'gemini', round(p_gemini_minutes * 60)::integer, 'grant',
      null, p_actor, 'Starting minutes');
  end if;

  perform app_private.audit(p_actor, 'user.created', p_user, null, null, '',
    jsonb_build_object('role', p_role,
                       'elevenlabs_minutes', coalesce(p_elevenlabs_minutes, 0),
                       'gemini_minutes', coalesce(p_gemini_minutes, 0),
                       'unlimited', coalesce(p_unlimited, false)),
    p_user_agent);
end;
$$;

-- Suspend, restore or approve. Returns the old status.
create or replace function public.svc_set_user_status(p_user uuid, p_status text, p_actor uuid, p_user_agent text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.profiles%rowtype;
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Unknown status.';
  end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;
  if p_status = 'suspended' and p_user = p_actor then
    perform app_private.fail('self', 'You cannot suspend your own account.');
  end if;
  if p_status = 'suspended' and v_old.role = 'admin' and app_private.other_active_admins(p_user) = 0 then
    perform app_private.fail('last_admin', 'There must always be at least one active administrator.');
  end if;
  if v_old.status = p_status then
    return v_old.status;
  end if;
  update public.profiles set status = p_status where id = p_user;
  perform app_private.audit(p_actor,
    case when p_status = 'suspended' then 'user.suspended'
         when v_old.status = 'pending' then 'user.approved'
         else 'user.restored' end,
    p_user, null, null, '', jsonb_build_object('from', v_old.status, 'to', p_status), p_user_agent);
  return v_old.status;
end;
$$;

-- Checks before an account is removed. Returns what the audit entry needs, because
-- the profile is gone once the account is deleted.
create or replace function public.svc_check_user_removal(p_user uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
begin
  select * into v_p from public.profiles where id = p_user;
  if not found then
    perform app_private.fail('not_found', 'That person no longer exists.');
  end if;
  if p_user = p_actor then
    perform app_private.fail('self', 'You cannot remove your own account.');
  end if;
  if v_p.role = 'admin' and app_private.other_active_admins(p_user) = 0 then
    perform app_private.fail('last_admin', 'There must always be at least one active administrator.');
  end if;
  return jsonb_build_object(
    'email', v_p.email,
    'full_name', v_p.full_name,
    'role', v_p.role,
    'recordings', (select count(*) from public.scribes where owner_id = p_user)
  );
end;
$$;

-- After the account is deleted: record it and queue its audio files for deletion.
create or replace function public.svc_user_removed(p_user uuid, p_actor uuid, p_snapshot jsonb, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.jobs (kind, payload, max_attempts)
  values ('delete_files', jsonb_build_object('prefix', p_user::text), 10);

  perform app_private.audit(p_actor, 'user.removed', p_user, null, null, '',
    jsonb_build_object('role', p_snapshot ->> 'role', 'name', p_snapshot ->> 'full_name',
                       'recordings', p_snapshot -> 'recordings'),
    p_user_agent, p_snapshot ->> 'email');
end;
$$;

create or replace function public.svc_audit(
  p_actor uuid,
  p_action text,
  p_target_user uuid,
  p_details jsonb,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('user.password_changed', 'secret.checked') then
    raise exception 'Unknown audit action.';
  end if;
  perform app_private.audit(p_actor, p_action, p_target_user, null, null, '', coalesce(p_details, '{}'::jsonb), p_user_agent);
end;
$$;

-- Which secrets are saved (never their values).
create or replace function public.svc_secret_status()
returns table (name text, last4 text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.name, m.last4, m.updated_at from app_private.secret_meta m;
$$;

create or replace function public.svc_set_google(p_enabled boolean, p_client_id text, p_actor uuid, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_settings
  set google_enabled = coalesce(p_enabled, false),
      google_client_id = left(btrim(coalesce(p_client_id, '')), 200),
      updated_by = p_actor
  where id;
  perform app_private.audit(p_actor, 'signin.google_updated', null, null, null, '',
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'client_id', left(btrim(coalesce(p_client_id, '')), 200)),
    p_user_agent);
end;
$$;

create or replace function public.svc_save_smtp(
  p_host text,
  p_port integer,
  p_security text,
  p_username text,
  p_sender_name text,
  p_sender_email text,
  p_actor uuid,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.app_settings
    set smtp_host = btrim(coalesce(p_host, '')),
        smtp_port = p_port,
        smtp_security = p_security,
        smtp_username = btrim(coalesce(p_username, '')),
        smtp_sender_name = btrim(coalesce(p_sender_name, '')),
        smtp_sender_email = lower(btrim(coalesce(p_sender_email, ''))),
        smtp_updated_at = now(),
        updated_by = p_actor
    where id;
  exception when check_violation or not_null_violation then
    perform app_private.fail('invalid_input', 'One of the email settings is not valid.');
  end;
  perform app_private.audit(p_actor, 'email.settings_saved', null, null, null, '',
    jsonb_build_object('host', btrim(coalesce(p_host, '')), 'port', p_port, 'security', p_security,
                       'sender', lower(btrim(coalesce(p_sender_email, '')))),
    p_user_agent);
end;
$$;

revoke execute on function public.admin_get_settings() from public, anon;
revoke execute on function public.admin_update_settings(jsonb) from public, anon;
revoke execute on function public.admin_list_users(text, text, integer, integer) from public, anon;
revoke execute on function public.admin_set_role(uuid, text) from public, anon;
revoke execute on function public.admin_adjust_credit(uuid, text, text, numeric, text) from public, anon;
revoke execute on function public.admin_set_unlimited(uuid, boolean) from public, anon;
revoke execute on function public.admin_credit_history(uuid, integer) from public, anon;
revoke execute on function public.admin_list_audit(text, uuid, timestamptz, timestamptz, bigint, integer) from public, anon;
revoke execute on function public.admin_usage_summary() from public, anon;

grant execute on function public.admin_get_settings() to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_adjust_credit(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.admin_set_unlimited(uuid, boolean) to authenticated;
grant execute on function public.admin_credit_history(uuid, integer) to authenticated;
grant execute on function public.admin_list_audit(text, uuid, timestamptz, timestamptz, bigint, integer) to authenticated;
grant execute on function public.admin_usage_summary() to authenticated;

revoke execute on function public.svc_user_created(uuid, text, text, numeric, numeric, boolean, uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_set_user_status(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_check_user_removal(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_user_removed(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.svc_secret_status() from public, anon, authenticated;
revoke execute on function public.svc_audit(uuid, text, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.svc_set_google(boolean, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_save_smtp(text, integer, text, text, text, text, uuid, text) from public, anon, authenticated;

grant execute on function public.svc_user_created(uuid, text, text, numeric, numeric, boolean, uuid, text) to service_role;
grant execute on function public.svc_set_user_status(uuid, text, uuid, text) to service_role;
grant execute on function public.svc_check_user_removal(uuid, uuid) to service_role;
grant execute on function public.svc_user_removed(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.svc_secret_status() to service_role;
grant execute on function public.svc_audit(uuid, text, uuid, jsonb, text) to service_role;
grant execute on function public.svc_set_google(boolean, text, uuid, text) to service_role;
grant execute on function public.svc_save_smtp(text, integer, text, text, text, text, uuid, text) to service_role;
