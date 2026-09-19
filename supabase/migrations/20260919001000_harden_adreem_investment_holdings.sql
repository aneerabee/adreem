-- Keep investment identity stable after history exists and reject hidden active data.

create or replace function adreem_private.protect_investment_holding_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_trades boolean := false;
  v_provider_symbol text := upper(btrim(coalesce(new.payload ->> 'providerSymbol', '')));
begin
  if nullif(new.payload ->> 'platformId', '') is distinct from new.platform_id
    or upper(coalesce(new.payload ->> 'symbol', '')) is distinct from upper(new.symbol)
    or nullif(new.payload ->> 'assetType', '') is distinct from new.asset_type
    or nullif(new.payload ->> 'quoteCurrency', '') is distinct from new.quote_currency
    or nullif(new.payload ->> 'status', '') is distinct from new.status then
    raise exception 'ADREEM_INVESTMENT_HOLDING_PAYLOAD_MISMATCH' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.adreem_investment_platforms as platform
    where platform.ledger_id = new.ledger_id
      and platform.record_id = new.platform_id
      and platform.owner_id = new.owner_id
      and platform.status = 'active'
  ) then
    raise exception 'ADREEM_ACTIVE_INVESTMENT_PLATFORM_REQUIRED' using errcode = '23514';
  end if;

  if v_provider_symbol = '' or v_provider_symbol !~ '^[A-Z0-9./_-]+(:[A-Z0-9._ -]+)?$' then
    raise exception 'ADREEM_INVALID_INVESTMENT_PROVIDER_SYMBOL' using errcode = '23514';
  end if;

  if coalesce(new.payload ->> 'lastPriceUsdMicros', '') !~ '^\d+$'
    or coalesce(new.payload ->> 'lastPriceNativeMicros', '') !~ '^\d+$'
    or (new.payload ->> 'lastPriceUsdMicros')::numeric > 9007199254740991
    or (new.payload ->> 'lastPriceNativeMicros')::numeric > 9007199254740991 then
    raise exception 'ADREEM_INVALID_INVESTMENT_PRICE' using errcode = '23514';
  end if;

  if nullif(new.payload ->> 'lastPriceAt', '') is not null then
    begin
      perform (new.payload ->> 'lastPriceAt')::timestamptz;
    exception when others then
      raise exception 'ADREEM_INVALID_INVESTMENT_PRICE_DATE' using errcode = '23514';
    end;
  end if;

  if tg_op = 'UPDATE' then
    select exists (
      select 1
      from public.adreem_investment_trades as trade
      where trade.ledger_id = old.ledger_id
        and trade.holding_id = old.record_id
    ) into v_has_trades;

    if v_has_trades and row(
      old.platform_id,
      upper(old.symbol),
      old.asset_type,
      old.quote_currency,
      upper(coalesce(old.payload ->> 'providerSymbol', '')),
      upper(coalesce(old.payload ->> 'exchange', ''))
    ) is distinct from row(
      new.platform_id,
      upper(new.symbol),
      new.asset_type,
      new.quote_currency,
      upper(coalesce(new.payload ->> 'providerSymbol', '')),
      upper(coalesce(new.payload ->> 'exchange', ''))
    ) then
      raise exception 'ADREEM_INVESTMENT_HOLDING_IDENTITY_IMMUTABLE' using errcode = '23514';
    end if;

    if v_has_trades and new.status = 'inactive' then
      raise exception 'ADREEM_INVESTMENT_HOLDING_IN_USE' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function adreem_private.protect_investment_holding_identity() from public, anon, authenticated, service_role;
grant execute on function adreem_private.protect_investment_holding_identity() to service_role;

drop trigger if exists zz_adreem_protect_investment_holding_identity on public.adreem_investment_holdings;
create trigger zz_adreem_protect_investment_holding_identity
before insert or update on public.adreem_investment_holdings
for each row execute function adreem_private.protect_investment_holding_identity();

create or replace function adreem_private.protect_investment_platform_retirement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'inactive' and new.status = 'inactive' and (
    exists (
      select 1 from public.adreem_investment_holdings as holding
      where holding.ledger_id = old.ledger_id and holding.platform_id = old.record_id
    )
    or exists (
      select 1 from public.adreem_investment_trades as trade
      where trade.ledger_id = old.ledger_id and trade.platform_id = old.record_id
    )
    or exists (
      select 1 from public.adreem_movements as movement
      where movement.ledger_id = old.ledger_id
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

create or replace function adreem_private.validate_investment_trade_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.adreem_investment_holdings as holding
    join public.adreem_investment_platforms as platform
      on platform.ledger_id = holding.ledger_id
      and platform.record_id = holding.platform_id
      and platform.owner_id = holding.owner_id
    where holding.ledger_id = new.ledger_id
      and holding.record_id = new.holding_id
      and holding.platform_id = new.platform_id
      and holding.owner_id = new.owner_id
      and holding.status = 'active'
      and platform.status = 'active'
  ) then
    raise exception 'ADREEM_ACTIVE_INVESTMENT_HOLDING_REQUIRED' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function adreem_private.validate_investment_trade_links() from public, anon, authenticated, service_role;
grant execute on function adreem_private.validate_investment_trade_links() to service_role;

drop trigger if exists zz_adreem_validate_investment_trade_links on public.adreem_investment_trades;
create trigger zz_adreem_validate_investment_trade_links
before insert on public.adreem_investment_trades
for each row execute function adreem_private.validate_investment_trade_links();
