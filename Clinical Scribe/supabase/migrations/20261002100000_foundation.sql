-- Clinical Scribe: foundation.
-- Extensions, the private schema, safe default privileges and small shared helpers.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

-- Private schema: never exposed through the API.
create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon, authenticated;

-- New functions and tables in "public" are not reachable by the API roles unless
-- a migration grants it on purpose. Every object below carries explicit grants.
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- Version of the newest migration, shown to admins next to the web app version.
create table app_private.app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into app_private.app_meta (key, value) values ('schema_version', '1.0.0')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Runtime settings the database needs to wake the worker.
create table app_private.runtime_config (
  key text primary key check (key in ('functions_url')),
  value text not null,
  updated_at timestamptz not null default now()
);

-- Keeps updated_at current on any table that has it.
create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Friendly, machine-readable errors. The web app maps the code to plain words;
-- the message is a plain-language fallback.
create or replace function app_private.fail(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_message,
    hint = 'cs:' || p_code;
end;
$$;

-- The user agent of the current API request, if there is one.
create or replace function app_private.request_user_agent()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers json;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return '';
  end;
  return left(coalesce(v_headers ->> 'user-agent', ''), 300);
end;
$$;

-- Model names are free text so new models work without an update, but they must
-- look like a model name.
create or replace function app_private.is_model_name(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$';
$$;
