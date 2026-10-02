-- Clinical Scribe 1.2: the phone apps (the Android app and the iPhone web app).
-- Adds the clinic name the apps show when they connect, and returns it with the
-- public settings that the website and the apps read before signing in.
-- This file only adds things; no existing data is changed.

alter table public.app_settings
  add column clinic_name text not null default ''
    check (char_length(clinic_name) <= 80 and clinic_name !~ '[[:cntrl:]]');

-- Public settings, readable before sign-in: Google sign-in on or off, the server
-- version and the clinic name.
create or replace function public.get_public_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_enabled', s.google_enabled,
    'server_version', (select value from app_private.app_meta where key = 'schema_version'),
    'clinic_name', s.clinic_name
  )
  from public.app_settings s
  where s.id;
$$;

revoke execute on function public.get_public_config() from public;
grant execute on function public.get_public_config() to anon, authenticated, service_role;

-- The clinic name shown in the apps. Admins only; every change is audited.
create or replace function public.admin_set_clinic_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_admin();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_old text;
begin
  if char_length(v_name) > 80 then
    perform app_private.fail('invalid_input', 'Keep the name to 80 characters.');
  end if;
  if v_name ~ '[[:cntrl:]]' then
    perform app_private.fail('invalid_input', 'The name contains characters that cannot be used.');
  end if;
  select s.clinic_name into v_old from public.app_settings s where s.id for update;
  if v_old is distinct from v_name then
    update public.app_settings set clinic_name = v_name, updated_by = v_uid where id;
    perform app_private.audit(v_uid, 'settings.clinic_name_changed', null, null, null, '',
      jsonb_build_object('from', v_old, 'to', v_name));
  end if;
end;
$$;

revoke execute on function public.admin_set_clinic_name(text) from public, anon;
grant execute on function public.admin_set_clinic_name(text) to authenticated;
