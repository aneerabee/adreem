-- Mohammad Ledger state document

create table if not exists ml_state (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table ml_state enable row level security;

create policy "ml_state_all" on ml_state for all using (true) with check (true);
