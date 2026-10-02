-- Clinical Scribe: note templates.
-- Shared templates are made by admins and seen by everyone; personal templates are
-- seen only by their owner. Notes copy the template text when they are written,
-- so later edits never change past notes.

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('shared', 'personal')),
  owner_id uuid references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  body text not null check (char_length(body) between 10 and 12000),
  source_request text not null default '' check (char_length(source_request) <= 4000),
  is_default boolean not null default false,
  is_archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_scope_owner check (
    (scope = 'shared' and owner_id is null) or (scope = 'personal' and owner_id is not null)
  ),
  constraint templates_default_is_shared check (not is_default or (scope = 'shared' and not is_archived))
);

create unique index templates_single_default on public.templates ((true)) where is_default;
create index templates_owner_idx on public.templates (owner_id) where scope = 'personal';

create trigger templates_touch
before update on public.templates
for each row execute function app_private.touch_updated_at();

alter table public.templates enable row level security;

create policy "Signed-in people see shared templates and their own"
on public.templates for select to authenticated
using (
  (select public.is_active_user())
  and ((scope = 'shared' and not is_archived) or owner_id = (select auth.uid()))
);

revoke all on table public.templates from anon, authenticated;
grant select on table public.templates to authenticated;

insert into public.templates (scope, name, description, body, is_default)
values (
  'shared',
  'SOAP note',
  'Subjective, Objective, Assessment and Plan.',
  $soap$Subjective:
[Presenting complaint in the patient's own words. History of the presenting complaint: onset, duration, character, severity, aggravating and relieving factors, associated symptoms, and what the patient thinks or worries about. Relevant past medical history, medications, allergies, family history and social history mentioned in the consultation.]

Objective:
[Observations and vital signs, examination findings, and any test, imaging or other results mentioned. Write "Not discussed" if nothing was examined or measured.]

Assessment:
[Working diagnosis or problem list, with the clinician's reasoning and any differential diagnoses discussed.]

Plan:
[Investigations requested, treatment and prescriptions with doses as stated, referrals, advice and safety-netting given, and follow-up arrangements.]$soap$,
  true
);

-- Save a personal template (insert or update), or a shared one when the caller is
-- an admin. Returns the template id.
create or replace function public.save_template(
  p_id uuid,
  p_name text,
  p_description text,
  p_body text,
  p_source_request text,
  p_scope text
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
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_active_user() then
    perform app_private.fail('not_allowed', 'Your account cannot do this.');
  end if;
  if p_scope not in ('shared', 'personal') then
    perform app_private.fail('invalid_input', 'Choose who can use this template.');
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
    insert into public.templates (scope, owner_id, name, description, body, source_request, created_by)
    values (
      p_scope,
      case when p_scope = 'personal' then v_uid end,
      v_name,
      btrim(coalesce(p_description, '')),
      v_body,
      left(coalesce(p_source_request, ''), 4000),
      v_uid
    )
    returning id into v_id;
    if p_scope = 'shared' then
      perform app_private.audit(v_uid, 'template.shared_created', null, null, null, '',
        jsonb_build_object('template_id', v_id, 'name', v_name));
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

  update public.templates
  set name = v_name,
      description = btrim(coalesce(p_description, '')),
      body = v_body,
      source_request = case when coalesce(p_source_request, '') = '' then source_request
                            else left(p_source_request, 4000) end
  where id = p_id;

  if v_row.scope = 'shared' then
    perform app_private.audit(v_uid, 'template.shared_updated', null, null, null, '',
      jsonb_build_object('template_id', p_id, 'name', v_name));
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
    perform app_private.fail('is_default', 'Choose another default template before removing this one.');
  end if;
  update public.templates set is_archived = true where id = p_id;
  perform app_private.audit(v_uid, 'template.shared_archived', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_row.name));
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
begin
  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  update public.templates set is_archived = false
  where id = p_id and scope = 'shared'
  returning name into v_name;
  if v_name is null then
    perform app_private.fail('not_found', 'That template no longer exists.');
  end if;
  perform app_private.audit(v_uid, 'template.shared_restored', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_name));
end;
$$;

create or replace function public.set_default_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  select name into v_name from public.templates
  where id = p_id and scope = 'shared' and not is_archived
  for update;
  if v_name is null then
    perform app_private.fail('not_found', 'Only an active shared template can be the default.');
  end if;
  update public.templates set is_default = false where is_default and id <> p_id;
  update public.templates set is_default = true where id = p_id;
  perform app_private.audit(v_uid, 'template.default_changed', null, null, null, '',
    jsonb_build_object('template_id', p_id, 'name', v_name));
end;
$$;

-- Admin list of shared templates, including archived ones.
create or replace function public.admin_list_shared_templates()
returns setof public.templates
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    perform app_private.fail('not_allowed', 'Only administrators can do this.');
  end if;
  return query
    select * from public.templates where scope = 'shared'
    order by is_archived, is_default desc, name;
end;
$$;

revoke execute on function public.save_template(uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.delete_template(uuid) from public, anon;
revoke execute on function public.restore_template(uuid) from public, anon;
revoke execute on function public.set_default_template(uuid) from public, anon;
revoke execute on function public.admin_list_shared_templates() from public, anon;
grant execute on function public.save_template(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delete_template(uuid) to authenticated;
grant execute on function public.restore_template(uuid) to authenticated;
grant execute on function public.set_default_template(uuid) to authenticated;
grant execute on function public.admin_list_shared_templates() to authenticated;
