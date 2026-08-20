-- The dedicated ADREEM v3 project must not retain the legacy blob store.
-- Fail closed if this migration is ever pointed at a project containing data.
do $$
declare
  legacy_state_has_rows boolean := false;
  legacy_backup_has_rows boolean := false;
begin
  if to_regclass('public.adreem_ledgers') is null then
    raise exception 'ADREEM_V3_SCHEMA_REQUIRED' using errcode = '55000';
  end if;

  if to_regclass('public.ml_state') is not null then
    execute 'lock table public.ml_state in access exclusive mode';
    execute 'select exists (select 1 from public.ml_state limit 1)'
      into legacy_state_has_rows;

    if legacy_state_has_rows then
      raise exception 'ADREEM_LEGACY_STATE_NOT_EMPTY' using errcode = '55000';
    end if;

    execute 'drop table public.ml_state';
  end if;

  if to_regclass('adreem_private.ml_state_backup_20260819') is not null then
    execute 'lock table adreem_private.ml_state_backup_20260819 in access exclusive mode';
    execute 'select exists (select 1 from adreem_private.ml_state_backup_20260819 limit 1)'
      into legacy_backup_has_rows;

    if legacy_backup_has_rows then
      raise exception 'ADREEM_LEGACY_BACKUP_NOT_EMPTY' using errcode = '55000';
    end if;

    execute 'drop table adreem_private.ml_state_backup_20260819';
  end if;
end;
$$;

notify pgrst, 'reload schema';
