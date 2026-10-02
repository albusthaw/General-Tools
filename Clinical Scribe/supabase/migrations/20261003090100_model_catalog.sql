-- Clinical Scribe 1.1: stored AI model lists.
-- "Update model lists" in AI settings asks each AI service which models it offers
-- and keeps the result here, so the lists are current and quick to show.
-- This file only adds things; no existing data is changed.

create table app_private.model_catalog (
  provider text not null check (provider in ('elevenlabs', 'gemini', 'deepseek')),
  purpose text not null check (purpose in ('transcription', 'text')),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
  source text not null default 'service' check (source in ('service', 'built_in')),
  updated_at timestamptz not null default now(),
  primary key (provider, purpose)
);

-- Read by the admin function.
create or replace function public.svc_model_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider', c.provider, 'purpose', c.purpose, 'models', c.models, 'source', c.source, 'updated_at', c.updated_at
  )), '[]'::jsonb)
  from app_private.model_catalog c;
$$;

-- Saves fresh lists, given as [{provider, purpose, models, source}], and logs it once.
create or replace function public.svc_save_model_catalog(p_entries jsonb, p_actor uuid, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 10 then
    raise exception 'Unexpected model lists.';
  end if;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry -> 'models') <> 'array' or jsonb_array_length(v_entry -> 'models') > 200 then
      raise exception 'Unexpected model list.';
    end if;
    insert into app_private.model_catalog (provider, purpose, models, source, updated_at)
    values (v_entry ->> 'provider', v_entry ->> 'purpose', v_entry -> 'models', coalesce(v_entry ->> 'source', 'service'), now())
    on conflict (provider, purpose) do update
      set models = excluded.models, source = excluded.source, updated_at = excluded.updated_at;
    v_summary := v_summary || jsonb_build_object(
      (v_entry ->> 'provider') || '_' || (v_entry ->> 'purpose'), jsonb_array_length(v_entry -> 'models'));
  end loop;
  perform app_private.audit(p_actor, 'settings.models_refreshed', null, null, null, '', v_summary, p_user_agent);
end;
$$;

revoke execute on function public.svc_model_catalog() from public, anon, authenticated;
revoke execute on function public.svc_save_model_catalog(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_model_catalog() to service_role;
grant execute on function public.svc_save_model_catalog(jsonb, uuid, text) to service_role;
