create table if not exists public.ml_state (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create schema if not exists adreem_private;
revoke all on schema adreem_private from public, anon, authenticated;
revoke all on all tables in schema adreem_private from public, anon, authenticated;

create table if not exists adreem_private.ml_state_backup_20260819
as
select *
from public.ml_state;

revoke all on adreem_private.ml_state_backup_20260819 from public, anon, authenticated, service_role;

alter table public.ml_state enable row level security;
alter table public.ml_state force row level security;

drop policy if exists "ml_state_all" on public.ml_state;
drop policy if exists "ml_state_adreem_main" on public.ml_state;
drop policy if exists "ml_state_read_adreem_migration_rows" on public.ml_state;
drop policy if exists "ml_state_insert_adreem_main" on public.ml_state;
drop policy if exists "ml_state_update_adreem_main" on public.ml_state;

revoke all on table public.ml_state from public, anon, authenticated;
grant select, insert, update, delete on table public.ml_state to service_role;

notify pgrst, 'reload schema';
