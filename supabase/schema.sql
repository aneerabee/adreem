-- ADREEM state document

create table if not exists ml_state (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table ml_state enable row level security;

drop policy if exists "ml_state_all" on ml_state;
drop policy if exists "ml_state_adreem_main" on ml_state;
drop policy if exists "ml_state_read_adreem_migration_rows" on ml_state;
drop policy if exists "ml_state_insert_adreem_main" on ml_state;
drop policy if exists "ml_state_update_adreem_main" on ml_state;

-- No anon policies by design. Web access must go through ADREEM API with a server-side service role.
-- The service role bypasses RLS and can still migrate the old "default" row into the ADREEM row.
