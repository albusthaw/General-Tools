-- Clinical Scribe: recordings ("scribes"), their audio parts, notes and credit.

create table public.scribes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  status text not null default 'recording'
    check (status in ('recording', 'processing', 'transcribed', 'failed')),
  template_id uuid references public.templates (id) on delete set null,
  provider text check (provider in ('elevenlabs', 'gemini')),
  model text,
  language text not null default '',
  zero_retention boolean not null default false,
  mime_type text,
  segment_count integer not null default 0 check (segment_count >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  charged_seconds integer not null default 0 check (charged_seconds >= 0),
  provider_duration_seconds numeric(10, 2),
  transcript text,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  finished_at timestamptz,
  transcribed_at timestamptz,
  audio_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scribes_owner_created_idx on public.scribes (owner_id, created_at desc);
create index scribes_status_idx on public.scribes (status);

create trigger scribes_touch
before update on public.scribes
for each row execute function app_private.touch_updated_at();

alter table public.scribes enable row level security;

create policy "Owners see their own recordings"
on public.scribes for select to authenticated
using (owner_id = (select auth.uid()) and (select public.is_active_user()));

revoke all on table public.scribes from anon, authenticated;
grant select on table public.scribes to authenticated;

create table public.scribe_segments (
  id uuid primary key default gen_random_uuid(),
  scribe_id uuid not null references public.scribes (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  seq integer not null check (seq between 1 and 999),
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  duration_seconds numeric(8, 2) not null check (duration_seconds >= 0 and duration_seconds <= 1800),
  status text not null default 'uploaded' check (status in ('uploaded', 'transcribing', 'done', 'failed')),
  transcript text,
  provider_duration_seconds numeric(10, 2),
  error_message text,
  audio_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scribe_id, seq)
);

create index scribe_segments_owner_idx on public.scribe_segments (owner_id);

create trigger scribe_segments_touch
before update on public.scribe_segments
for each row execute function app_private.touch_updated_at();

alter table public.scribe_segments enable row level security;

create policy "Owners see their own audio parts"
on public.scribe_segments for select to authenticated
using (owner_id = (select auth.uid()) and (select public.is_active_user()));

revoke all on table public.scribe_segments from anon, authenticated;
grant select (id, scribe_id, owner_id, seq, mime_type, byte_size, duration_seconds, status, created_at)
  on table public.scribe_segments to authenticated;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  scribe_id uuid not null references public.scribes (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.templates (id) on delete set null,
  template_name text not null,
  template_body text not null,
  provider text not null check (provider in ('gemini', 'deepseek')),
  model text not null,
  reasoning boolean not null default false,
  spelling text not null default 'en-GB',
  status text not null default 'queued' check (status in ('queued', 'writing', 'done', 'failed')),
  content text,
  error_message text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index notes_scribe_idx on public.notes (scribe_id, created_at desc);
create index notes_owner_idx on public.notes (owner_id, created_at desc);

create trigger notes_touch
before update on public.notes
for each row execute function app_private.touch_updated_at();

-- A finished note is final. Nobody, not even the server, may change it.
create or replace function app_private.notes_are_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'done' then
    raise exception 'A finished note cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger notes_final
before update on public.notes
for each row execute function app_private.notes_are_final();

alter table public.notes enable row level security;

create policy "Owners see their own notes"
on public.notes for select to authenticated
using (owner_id = (select auth.uid()) and (select public.is_active_user()));

revoke all on table public.notes from anon, authenticated;
grant select (id, scribe_id, owner_id, template_id, template_name, provider, model, status, content,
              error_message, created_at, completed_at)
  on table public.notes to authenticated;

-- Credit ledger ---------------------------------------------------------------
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('elevenlabs', 'gemini')),
  change_seconds integer not null,
  balance_after integer,
  kind text not null check (kind in ('grant', 'set', 'usage', 'refund', 'correction', 'unlimited_on', 'unlimited_off')),
  scribe_id uuid references public.scribes (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;

create policy "People see their own credit history; admins see all"
on public.credit_ledger for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on table public.credit_ledger from anon, authenticated;
grant select on table public.credit_ledger to authenticated;

-- Change a balance and write the ledger line in one place. Returns the new balance
-- (null when the person has unlimited credit, which is never charged).
create or replace function app_private.change_credit(
  p_user uuid,
  p_provider text,
  p_change integer,
  p_kind text,
  p_scribe uuid default null,
  p_actor uuid default null,
  p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_unlimited boolean;
begin
  if p_provider not in ('elevenlabs', 'gemini') then
    raise exception 'Unknown credit type.';
  end if;

  select credit_unlimited into v_unlimited from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Unknown person.';
  end if;

  if v_unlimited and p_kind in ('usage', 'refund', 'correction') then
    insert into public.credit_ledger (user_id, provider, change_seconds, balance_after, kind, scribe_id, actor_id, note)
    values (p_user, p_provider, 0, null, p_kind, p_scribe, p_actor, left(coalesce(p_note, ''), 200));
    return null;
  end if;

  if p_provider = 'elevenlabs' then
    update public.profiles set credit_seconds_elevenlabs = credit_seconds_elevenlabs + p_change
    where id = p_user returning credit_seconds_elevenlabs into v_balance;
  else
    update public.profiles set credit_seconds_gemini = credit_seconds_gemini + p_change
    where id = p_user returning credit_seconds_gemini into v_balance;
  end if;

  insert into public.credit_ledger (user_id, provider, change_seconds, balance_after, kind, scribe_id, actor_id, note)
  values (p_user, p_provider, p_change, v_balance, p_kind, p_scribe, p_actor, left(coalesce(p_note, ''), 200));
  return v_balance;
end;
$$;

revoke execute on function app_private.change_credit(uuid, text, integer, text, uuid, uuid, text) from public;

-- Storage ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  52428800,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/m4a']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Uploads are allowed only as "<own user id>/<own open recording id>/<part>.<ext>".
create or replace function public.storage_can_upload_segment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_parts text[];
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}\.(webm|ogg|m4a|mp4|aac)$' then
    return false;
  end if;
  v_parts := string_to_array(p_name, '/');
  if v_parts[1] <> v_uid::text then
    return false;
  end if;
  return exists (
    select 1 from public.scribes s
    join public.profiles p on p.id = s.owner_id
    where s.id = v_parts[2]::uuid
      and s.owner_id = v_uid
      and s.status = 'recording'
      and p.status = 'active'
  );
end;
$$;

revoke execute on function public.storage_can_upload_segment(text) from public, anon;
grant execute on function public.storage_can_upload_segment(text) to authenticated;

create policy "Clinical Scribe: owners upload parts of their open recording"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.storage_can_upload_segment(name)
);
