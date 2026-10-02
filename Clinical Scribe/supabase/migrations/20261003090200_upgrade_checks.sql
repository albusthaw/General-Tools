-- Clinical Scribe 1.1: record counts for the deploy's data check.
-- The deploy reads these before and after it updates the database, and stops with
-- a clear message if any kind of record became fewer. Only counts are returned.
-- This file only adds things; no existing data is changed.

create or replace function public.svc_data_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'people', (select count(*) from public.profiles),
    'recordings', (select count(*) from public.scribes),
    'notes', (select count(*) from public.notes),
    'templates', (select count(*) from public.templates),
    'audit_entries', (select count(*) from public.audit_log),
    'credit_entries', (select count(*) from public.credit_ledger)
  );
$$;

revoke execute on function public.svc_data_summary() from public, anon, authenticated;
grant execute on function public.svc_data_summary() to service_role;
