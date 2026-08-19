alter table public.ml_state
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.ml_state
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now())
where created_at is null
   or updated_at is null;

alter table public.ml_state
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

notify pgrst, 'reload schema';
