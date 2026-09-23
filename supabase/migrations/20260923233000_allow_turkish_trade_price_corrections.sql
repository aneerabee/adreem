-- Preserve the original FX snapshot while permitting an audited TRY price correction.
create or replace function adreem_private.protect_investment_trade_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'voided' and row(
    old.ledger_id, old.owner_id, old.record_id, old.platform_id, old.holding_id,
    old.trade_type, old.status, old.quantity_units, old.price_usd_micros,
    old.fee_usd_micros, old.occurred_at, old.payload, old.created_at
  ) is distinct from row(
    new.ledger_id, new.owner_id, new.record_id, new.platform_id, new.holding_id,
    new.trade_type, new.status, new.quantity_units, new.price_usd_micros,
    new.fee_usd_micros, new.occurred_at, new.payload, new.created_at
  ) then
    raise exception 'ADREEM_VOIDED_INVESTMENT_TRADE_IMMUTABLE' using errcode = '23514';
  end if;

  if row(
    old.ledger_id, old.owner_id, old.record_id, old.platform_id, old.holding_id,
    old.trade_type, old.status, old.occurred_at, old.created_at
  ) is distinct from row(
    new.ledger_id, new.owner_id, new.record_id, new.platform_id, new.holding_id,
    new.trade_type, new.status, new.occurred_at, new.created_at
  ) then
    raise exception 'ADREEM_INVESTMENT_TRADE_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;

  if new.quantity_units <= 0
    or new.price_usd_micros <= 0
    or new.fee_usd_micros < 0
    or char_length(coalesce(new.payload ->> 'note', '')) > 300
    or (new.payload ->> 'quantityUnits')::bigint is distinct from new.quantity_units
    or (new.payload ->> 'priceUsdMicros')::bigint is distinct from new.price_usd_micros
    or coalesce(nullif(new.payload ->> 'feeUsdMicros', '')::bigint, 0) is distinct from new.fee_usd_micros
    or nullif(new.payload ->> 'updatedAt', '')::timestamptz is null
  then
    raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
  end if;

  if old.payload - array['quantityUnits', 'priceUsdMicros', 'priceNativeMicros', 'feeUsdMicros', 'note', 'updatedAt']
    is distinct from
    new.payload - array['quantityUnits', 'priceUsdMicros', 'priceNativeMicros', 'feeUsdMicros', 'note', 'updatedAt']
  then
    raise exception 'ADREEM_INVESTMENT_TRADE_PAYLOAD_IMMUTABLE' using errcode = '23514';
  end if;

  if old.payload ->> 'priceNativeMicros' is distinct from new.payload ->> 'priceNativeMicros'
    and old.price_usd_micros is not distinct from new.price_usd_micros
  then
    raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_FX' using errcode = '23514';
  end if;

  if old.payload ? 'priceNativeMicros' or new.payload ? 'priceNativeMicros' then
    if not (old.payload ? 'priceNativeMicros' and new.payload ? 'priceNativeMicros')
      or coalesce(new.payload ->> 'priceNativeMicros', '') !~ '^[0-9]+$'
      or coalesce(new.payload ->> 'fxTryPerUsdMicros', '') !~ '^[0-9]+$'
      or (new.payload ->> 'priceNativeMicros')::numeric <= 0
      or (new.payload ->> 'fxTryPerUsdMicros')::numeric <= 0
      or (new.payload ->> 'priceNativeMicros')::numeric > 9007199254740991
      or (new.payload ->> 'fxTryPerUsdMicros')::numeric > 9007199254740991
      or floor(
        ((new.payload ->> 'priceNativeMicros')::numeric * 1000000
          + (new.payload ->> 'fxTryPerUsdMicros')::numeric / 2)
        / nullif((new.payload ->> 'fxTryPerUsdMicros')::numeric, 0)
      ) is distinct from new.price_usd_micros
    then
      raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_FX' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function adreem_private.protect_investment_trade_history() from public, anon, authenticated, service_role;
grant execute on function adreem_private.protect_investment_trade_history() to service_role;
