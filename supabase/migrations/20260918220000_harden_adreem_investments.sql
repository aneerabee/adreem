-- Close legacy mutation paths and keep investment history append-only.

revoke execute on function public.adreem_apply_ledger_delta(uuid, bigint, jsonb, uuid) from authenticated;

create index if not exists adreem_investment_trades_active_position_idx
  on public.adreem_investment_trades (ledger_id, holding_id, occurred_at, record_id)
  where status = 'active';

create index if not exists adreem_movements_investment_platform_idx
  on public.adreem_movements (ledger_id, ((payload ->> 'investmentPlatformId')))
  where status = 'posted'
    and movement_type in ('investment_deposit', 'investment_withdrawal');

create or replace function adreem_private.protect_investment_trade_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.owner_id,
    old.platform_id,
    old.holding_id,
    old.trade_type,
    old.status,
    old.quantity_units,
    old.price_usd_micros,
    old.fee_usd_micros,
    old.occurred_at,
    old.payload - 'updatedAt',
    old.created_at
  ) is distinct from row(
    new.owner_id,
    new.platform_id,
    new.holding_id,
    new.trade_type,
    new.status,
    new.quantity_units,
    new.price_usd_micros,
    new.fee_usd_micros,
    new.occurred_at,
    new.payload - 'updatedAt',
    new.created_at
  ) then
    raise exception 'ADREEM_INVESTMENT_TRADE_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.protect_investment_trade_history() from public, anon, authenticated, service_role;
grant execute on function adreem_private.protect_investment_trade_history() to service_role;

drop trigger if exists zz_adreem_protect_investment_trade_history on public.adreem_investment_trades;
create trigger zz_adreem_protect_investment_trade_history
before update on public.adreem_investment_trades
for each row execute function adreem_private.protect_investment_trade_history();

create or replace function adreem_private.protect_investment_platform_retirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'inactive' and (
    exists (
      select 1 from public.adreem_investment_holdings as holding
      where holding.ledger_id = old.ledger_id and holding.platform_id = old.record_id
    )
    or exists (
      select 1 from public.adreem_movements as movement
      where movement.ledger_id = old.ledger_id
        and movement.movement_type in ('investment_deposit', 'investment_withdrawal')
        and movement.payload ->> 'investmentPlatformId' = old.record_id
    )
  ) then
    raise exception 'ADREEM_INVESTMENT_PLATFORM_IN_USE' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.protect_investment_platform_retirement() from public, anon, authenticated, service_role;
grant execute on function adreem_private.protect_investment_platform_retirement() to service_role;

drop trigger if exists zz_adreem_protect_investment_platform_retirement on public.adreem_investment_platforms;
create trigger zz_adreem_protect_investment_platform_retirement
before update on public.adreem_investment_platforms
for each row execute function adreem_private.protect_investment_platform_retirement();
