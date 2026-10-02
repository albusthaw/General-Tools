-- Clinical Scribe: app settings and secret storage.
-- Service keys live only in Supabase Vault. The browser never receives them; admins
-- see the last four characters and when they were changed.

create table public.app_settings (
  id boolean primary key default true check (id),

  -- Transcription
  transcription_provider text not null default 'elevenlabs'
    check (transcription_provider in ('elevenlabs', 'gemini')),
  elevenlabs_model text not null default 'scribe_v2_medical'
    check (app_private.is_model_name(elevenlabs_model)),
  gemini_transcription_model text not null default 'gemini-3.5-transcribe'
    check (app_private.is_model_name(gemini_transcription_model)),
  transcription_language text not null default ''
    check (transcription_language ~ '^([a-z]{2,3}(-[A-Z]{2})?)?$'),
  elevenlabs_zero_retention boolean not null default false,

  -- Notes
  note_provider text not null default 'gemini' check (note_provider in ('gemini', 'deepseek')),
  gemini_note_model text not null default 'gemini-3.8-flash'
    check (app_private.is_model_name(gemini_note_model)),
  deepseek_note_model text not null default 'deepseek-flash'
    check (app_private.is_model_name(deepseek_note_model)),
  note_reasoning boolean not null default false,
  note_spelling text not null default 'en-GB' check (note_spelling in ('en-GB', 'en-US')),

  -- Template builder (one service)
  template_provider text not null default 'gemini' check (template_provider in ('gemini', 'deepseek')),
  gemini_template_model text not null default 'gemini-3.8-flash'
    check (app_private.is_model_name(gemini_template_model)),
  deepseek_template_model text not null default 'deepseek-flash'
    check (app_private.is_model_name(deepseek_template_model)),

  -- Recording and sessions
  audio_retention_days integer not null default 7 check (audio_retention_days in (-1, 0, 7, 30)),
  max_recording_minutes integer not null default 120 check (max_recording_minutes between 5 and 600),
  idle_signout_minutes integer not null default 30 check (idle_signout_minutes in (0, 15, 30, 60, 120)),

  -- Google sign-in (the client secret is passed straight to Supabase Auth, never stored here)
  google_enabled boolean not null default false,
  google_client_id text not null default '' check (char_length(google_client_id) <= 200),

  -- Email (SMTP): saved, not used by anything yet
  smtp_host text not null default '' check (char_length(smtp_host) <= 200),
  smtp_port integer not null default 587 check (smtp_port between 1 and 65535),
  smtp_security text not null default 'starttls' check (smtp_security in ('ssl', 'starttls', 'none')),
  smtp_username text not null default '' check (char_length(smtp_username) <= 200),
  smtp_sender_name text not null default '' check (char_length(smtp_sender_name) <= 120),
  smtp_sender_email text not null default '' check (char_length(smtp_sender_email) <= 200),
  smtp_updated_at timestamptz,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create trigger app_settings_touch
before update on public.app_settings
for each row execute function app_private.touch_updated_at();

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;
grant select, update on table public.app_settings to service_role;

-- Which secrets exist, without their values.
create table app_private.secret_meta (
  name text primary key
    check (name in ('gemini_api_key', 'elevenlabs_api_key', 'deepseek_api_key', 'smtp_password', 'management_token')),
  last4 text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function app_private.secret_vault_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name not in ('gemini_api_key', 'elevenlabs_api_key', 'deepseek_api_key', 'smtp_password',
                    'management_token', 'worker_secret') then
    raise exception 'Unknown secret name.';
  end if;
  return 'clinical_scribe_' || p_name;
end;
$$;

create or replace function app_private.secret_is_set(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app_private.secret_meta m where m.name = p_name);
$$;

revoke execute on function app_private.secret_vault_name(text) from public;
revoke execute on function app_private.secret_is_set(text) from public;

-- Read a secret. Only the server (service_role) can call this.
create or replace function public.svc_get_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  select ds.decrypted_secret into v_value
  from vault.decrypted_secrets ds
  where ds.name = app_private.secret_vault_name(p_name)
  limit 1;
  return v_value;
end;
$$;

-- Save or replace a secret. The value is never logged or returned.
create or replace function public.svc_set_secret(p_name text, p_value text, p_actor uuid, p_user_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vault_name text := app_private.secret_vault_name(p_name);
  v_id uuid;
  v_value text := btrim(coalesce(p_value, ''));
begin
  if p_name = 'worker_secret' then
    raise exception 'This secret is managed by the database.';
  end if;
  if char_length(v_value) < 8 or char_length(v_value) > 4000 then
    perform app_private.fail('invalid_secret', 'That value does not look right. Check it and try again.');
  end if;

  select id into v_id from vault.secrets where name = v_vault_name limit 1;
  if v_id is null then
    perform vault.create_secret(v_value, v_vault_name, 'Clinical Scribe');
  else
    perform vault.update_secret(v_id, v_value, v_vault_name, 'Clinical Scribe');
  end if;

  insert into app_private.secret_meta (name, last4, updated_at, updated_by)
  values (p_name, right(v_value, 4), now(), p_actor)
  on conflict (name) do update
    set last4 = excluded.last4, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  perform app_private.audit(p_actor, 'secret.saved', null, null, null, '',
    jsonb_build_object('secret', p_name), p_user_agent);
end;
$$;

create or replace function public.svc_delete_secret(p_name text, p_actor uuid, p_user_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_name = 'worker_secret' then
    raise exception 'This secret is managed by the database.';
  end if;
  delete from vault.secrets where name = app_private.secret_vault_name(p_name);
  delete from app_private.secret_meta where name = p_name;
  perform app_private.audit(p_actor, 'secret.removed', null, null, null, '',
    jsonb_build_object('secret', p_name), p_user_agent);
end;
$$;

revoke execute on function public.svc_get_secret(text) from public, anon, authenticated;
revoke execute on function public.svc_set_secret(text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.svc_delete_secret(text, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_get_secret(text) to service_role;
grant execute on function public.svc_set_secret(text, text, uuid, text) to service_role;
grant execute on function public.svc_delete_secret(text, uuid, text) to service_role;

-- Worker secret: generated here, never leaves the server. The database sends it
-- when it wakes the worker; the worker compares it before doing anything.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'clinical_scribe_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'clinical_scribe_worker_secret',
      'Clinical Scribe worker'
    );
  end if;
end;
$$;

create or replace function public.svc_get_worker_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret from vault.decrypted_secrets ds
  where ds.name = 'clinical_scribe_worker_secret' limit 1;
$$;

revoke execute on function public.svc_get_worker_secret() from public, anon, authenticated;
grant execute on function public.svc_get_worker_secret() to service_role;

-- Where the Edge Functions live. Set by the deploy script; local development sets
-- it in seed.sql.
create or replace function public.svc_set_functions_url(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_url !~ '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._~/-]*)?$' then
    raise exception 'That does not look like a functions address.';
  end if;
  insert into app_private.runtime_config (key, value) values ('functions_url', rtrim(p_url, '/'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke execute on function public.svc_set_functions_url(text) from public, anon, authenticated;
grant execute on function public.svc_set_functions_url(text) to service_role;

-- Public sign-in page settings.
create or replace function public.get_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_enabled', s.google_enabled,
    'server_version', (select value from app_private.app_meta where key = 'schema_version')
  )
  from public.app_settings s
  where s.id;
$$;

revoke execute on function public.get_public_config() from public;
grant execute on function public.get_public_config() to anon, authenticated, service_role;
