-- Clinical Scribe: people, roles and the audit log.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('active', 'suspended', 'pending')),
  credit_seconds_elevenlabs integer not null default 0,
  credit_seconds_gemini integer not null default 0,
  credit_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_status_idx on public.profiles (role, status);

create trigger profiles_touch
before update on public.profiles
for each row execute function app_private.touch_updated_at();

alter table public.profiles enable row level security;

-- Role helpers used by policies. They read profiles with definer rights so the
-- policies on profiles itself do not recurse.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active' and p.role = 'admin'
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

create policy "People see their own profile; admins see everyone"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

-- Audit log -----------------------------------------------------------------
-- No foreign keys on purpose: entries must survive the removal of the people
-- they mention, so names and emails are copied in.
create table public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text not null default '',
  actor_name text not null default '',
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_user_id uuid,
  target_email text not null default '',
  target_name text not null default '',
  scribe_id uuid,
  review_id uuid,
  reason text not null default '' check (char_length(reason) <= 500),
  details jsonb not null default '{}'::jsonb,
  user_agent text not null default '' check (char_length(user_agent) <= 300)
);

create index audit_log_created_idx on public.audit_log (created_at desc, id desc);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index audit_log_target_idx on public.audit_log (target_user_id, created_at desc);
create index audit_log_action_idx on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

create policy "Admins read the audit log"
on public.audit_log for select to authenticated
using ((select public.is_admin()));

revoke all on table public.audit_log from anon, authenticated, service_role;
grant select on table public.audit_log to authenticated;
grant select, insert on table public.audit_log to service_role;

create or replace function app_private.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log cannot be changed or deleted.';
end;
$$;

create trigger audit_log_no_change
before update or delete on public.audit_log
for each row execute function app_private.audit_log_is_append_only();

create trigger audit_log_no_truncate
before truncate on public.audit_log
for each statement execute function app_private.audit_log_is_append_only();

-- The one way entries are written. Details must never contain secrets.
create or replace function app_private.audit(
  p_actor uuid,
  p_action text,
  p_target_user uuid default null,
  p_scribe uuid default null,
  p_review uuid default null,
  p_reason text default '',
  p_details jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_target_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_id bigint;
begin
  if p_actor is not null then
    select * into v_actor from public.profiles where id = p_actor;
  end if;
  if p_target_user is not null then
    select * into v_target from public.profiles where id = p_target_user;
  end if;

  insert into public.audit_log (
    actor_id, actor_email, actor_name, action, target_user_id, target_email, target_name,
    scribe_id, review_id, reason, details, user_agent
  ) values (
    p_actor,
    coalesce(v_actor.email, ''),
    coalesce(v_actor.full_name, ''),
    p_action,
    p_target_user,
    coalesce(v_target.email, p_target_email, ''),
    coalesce(v_target.full_name, ''),
    p_scribe,
    p_review,
    left(coalesce(p_reason, ''), 500),
    coalesce(p_details, '{}'::jsonb),
    left(coalesce(p_user_agent, app_private.request_user_agent()), 300)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function app_private.audit(uuid, text, uuid, uuid, uuid, text, jsonb, text, text) from public;

-- New accounts --------------------------------------------------------------
-- The very first account becomes the administrator. Accounts created by an admin
-- (they carry app_metadata.cs_invited) are active. Anything else, for example a
-- sign-up while public sign-up was switched on by mistake, waits for approval.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
  v_invited boolean;
  v_name text;
begin
  perform pg_advisory_xact_lock(hashtext('clinical_scribe.first_admin'));
  select not exists (select 1 from public.profiles) into v_first;
  v_invited := coalesce((new.raw_app_meta_data ->> 'cs_invited')::boolean, false);
  v_name := left(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), 120);

  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    v_name,
    case when v_first then 'admin' else 'user' end,
    case when v_first or v_invited then 'active' else 'pending' end
  );

  if v_first then
    perform app_private.audit(new.id, 'account.first_admin', new.id, null, null, '',
      jsonb_build_object('email', lower(coalesce(new.email, ''))), '');
  elsif not v_invited then
    perform app_private.audit(null, 'account.waiting_approval', new.id, null, null, '',
      jsonb_build_object('email', lower(coalesce(new.email, ''))), '');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

create or replace function app_private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(coalesce(new.email, '')) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function app_private.handle_user_email_change();
