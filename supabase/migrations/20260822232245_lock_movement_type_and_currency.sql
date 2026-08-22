create or replace function adreem_private.protect_movement_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'posted' and (
     old.movement_type is distinct from new.movement_type or
     nullif(old.payload ->> 'type', '') is distinct from nullif(new.payload ->> 'type', '')
  ) then
    raise exception 'ADREEM_MOVEMENT_TYPE_IMMUTABLE' using errcode = '23514';
  end if;
  if old.status = 'posted' and (
     old.currency is distinct from new.currency or
     nullif(old.payload ->> 'currency', '') is distinct from nullif(new.payload ->> 'currency', '')
  ) then
    raise exception 'ADREEM_MOVEMENT_CURRENCY_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.protect_movement_identity() from public, anon, authenticated, service_role;

drop trigger if exists adreem_protect_movement_identity on public.adreem_movements;
create trigger adreem_protect_movement_identity
before update on public.adreem_movements
for each row execute function adreem_private.protect_movement_identity();
