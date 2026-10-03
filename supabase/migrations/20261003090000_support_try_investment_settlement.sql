-- Investment settlement remains in the movement/trade payload so historical USD rows
-- and the existing relational schema need no rewrite.
create or replace function adreem_private.investment_cash_micros(
  p_ledger_id uuid, p_owner_id uuid, p_platform_id text, p_currency text
)
returns numeric language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(case movement.movement_type
      when 'investment_deposit' then abs(movement.amount) * 1000000
      when 'investment_withdrawal' then -abs(movement.amount) * 1000000 end)
      from public.adreem_movements as movement
      where movement.ledger_id = p_ledger_id and movement.owner_id = p_owner_id
        and movement.status = 'posted'
        and movement.movement_type in ('investment_deposit', 'investment_withdrawal')
        and movement.currency = p_currency
        and movement.payload ->> 'investmentPlatformId' = p_platform_id), 0)
    + coalesce((select sum(case trade.trade_type
      when 'buy' then -round(trade.quantity_units::numeric *
        (case when p_currency = 'TRY' then (trade.payload ->> 'priceNativeMicros')::numeric
          else trade.price_usd_micros::numeric end) / 100000000)
        - (case when p_currency = 'TRY' then (trade.payload ->> 'feeNativeMicros')::numeric
          else trade.fee_usd_micros::numeric end)
      when 'sell' then round(trade.quantity_units::numeric *
        (case when p_currency = 'TRY' then (trade.payload ->> 'priceNativeMicros')::numeric
          else trade.price_usd_micros::numeric end) / 100000000)
        - (case when p_currency = 'TRY' then (trade.payload ->> 'feeNativeMicros')::numeric
          else trade.fee_usd_micros::numeric end) end)
      from public.adreem_investment_trades as trade
      where trade.ledger_id = p_ledger_id and trade.owner_id = p_owner_id
        and trade.platform_id = p_platform_id and trade.status = 'active'
        and coalesce(trade.payload ->> 'settlementCurrency', 'USD') = p_currency), 0)
    + case when p_currency = 'USD' then coalesce((select sum(case
      when transfer.to_platform_id = p_platform_id then transfer.amount_usd_micros
      else -transfer.amount_usd_micros end)
      from public.adreem_investment_transfers as transfer
      where transfer.ledger_id = p_ledger_id and transfer.owner_id = p_owner_id
        and transfer.asset = 'USD'
        and (transfer.from_platform_id = p_platform_id or transfer.to_platform_id = p_platform_id)), 0)
      else 0 end;
$$;
revoke all on function adreem_private.investment_cash_micros(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function adreem_private.require_investment_cash(
  p_ledger_id uuid, p_owner_id uuid, p_error text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_platform record;
  v_currency text;
  v_cash numeric;
begin
  for v_platform in select record_id from public.adreem_investment_platforms
    where ledger_id = p_ledger_id and owner_id = p_owner_id loop
    foreach v_currency in array array['USD', 'TRY'] loop
      v_cash := adreem_private.investment_cash_micros(
        p_ledger_id, p_owner_id, v_platform.record_id, v_currency);
      if v_cash < 0 or v_cash > 9007199254740991 then
        raise exception '%', p_error using errcode = '23514';
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function adreem_private.require_investment_cash(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- A transfer is inserted after the inner ledger RPC, so validate its USD effect
-- immediately; the outer RPC still handles USDT position and cost-basis checks.
create function adreem_private.require_investment_cash_after_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform adreem_private.require_investment_cash(
    new.ledger_id, new.owner_id, 'ADREEM_INVESTMENT_TRANSFER_CASH_NEGATIVE');
  return new;
end;
$$;
revoke all on function adreem_private.require_investment_cash_after_transfer()
  from public, anon, authenticated, service_role;
create constraint trigger adreem_investment_transfer_currency_cash
after insert on public.adreem_investment_transfers
deferrable initially deferred
for each row execute function adreem_private.require_investment_cash_after_transfer();

create or replace function public.adreem_entries_for_movement(p_movement jsonb)
returns table (entry_index smallint, account_id text, currency text, delta numeric(15, 0))
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_type text := p_movement ->> 'type';
  v_status text := coalesce(p_movement ->> 'status', 'needs_review');
  v_currency text := p_movement ->> 'currency';
  v_source text := nullif(p_movement ->> 'sourceAccountId', '');
  v_destination text := nullif(p_movement ->> 'destinationAccountId', '');
  v_note text := btrim(coalesce(p_movement ->> 'note', ''));
  v_amount numeric;
  v_rate numeric;
begin
  if v_status <> 'posted' then return; end if;
  begin
    v_amount := nullif(p_movement ->> 'amount', '')::numeric;
    v_rate := nullif(p_movement ->> 'rate', '')::numeric;
  exception when invalid_text_representation then
    raise exception 'ADREEM_INVALID_MOVEMENT_NUMBER' using errcode = '22023';
  end;
  if v_amount is null or v_amount = 0 or v_amount <> trunc(v_amount) then
    raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
  end if;
  if v_currency not in ('LYD', 'USD', 'TRY', 'EUR') then
    raise exception 'ADREEM_INVALID_MOVEMENT_CURRENCY' using errcode = '22023';
  end if;
  if v_type not in ('opening_balance', 'correction') and v_amount < 0 then
    raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
  end if;
  if v_type = 'record_only' then
    if v_source is not null or v_destination is not null then raise exception 'ADREEM_RECORD_ONLY_ACCOUNTS_NOT_ALLOWED' using errcode = '22023'; end if;
    if v_note = '' then raise exception 'ADREEM_RECORD_ONLY_NOTE_REQUIRED' using errcode = '22023'; end if;
    return;
  end if;
  if v_type = 'correction' and v_note = '' then raise exception 'ADREEM_CORRECTION_NOTE_REQUIRED' using errcode = '22023'; end if;
  if v_type in ('transfer', 'cash_deposit', 'cash_withdrawal', 'usd_sale', 'usd_purchase', 'card_charge', 'card_payment') and
     (v_source is null or v_destination is null or v_source = v_destination) then
    raise exception 'ADREEM_INVALID_MOVEMENT_ACCOUNTS' using errcode = '22023';
  end if;
  if v_type in ('expense', 'truck_expense', 'investment_deposit') and v_source is null then
    raise exception 'ADREEM_MOVEMENT_SOURCE_REQUIRED' using errcode = '22023';
  end if;
  if v_type in ('opening_balance', 'external_income', 'truck_income', 'correction', 'investment_withdrawal') and v_destination is null then
    raise exception 'ADREEM_MOVEMENT_DESTINATION_REQUIRED' using errcode = '22023';
  end if;
  if v_type = 'investment_deposit' and (v_currency not in ('USD', 'TRY') or v_destination is not null) then
    raise exception 'ADREEM_INVALID_INVESTMENT_DEPOSIT' using errcode = '22023';
  end if;
  if v_type = 'investment_withdrawal' and (v_currency not in ('USD', 'TRY') or v_source is not null) then
    raise exception 'ADREEM_INVALID_INVESTMENT_WITHDRAWAL' using errcode = '22023';
  end if;
  if (v_type = 'usd_sale' and v_currency <> 'USD') or (v_type = 'usd_purchase' and v_currency <> 'LYD') then
    raise exception 'ADREEM_INVALID_EXCHANGE_CURRENCY' using errcode = '22023';
  end if;

  case v_type
    when 'opening_balance', 'external_income', 'truck_income' then return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'expense', 'truck_expense', 'investment_deposit' then return query select 0::smallint, v_source, v_currency, -abs(round(v_amount));
    when 'investment_withdrawal' then return query select 0::smallint, v_destination, v_currency, abs(round(v_amount));
    when 'transfer', 'cash_deposit', 'cash_withdrawal', 'card_charge', 'card_payment' then
      return query select 0::smallint, v_source, v_currency, -abs(round(v_amount))
        union all select 1::smallint, v_destination, v_currency, abs(round(v_amount));
    when 'usd_sale' then
      if v_rate is null or v_rate <= 0 then raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023'; end if;
      if round(abs(v_amount) * v_rate) = 0 then raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023'; end if;
      return query select 0::smallint, v_source, 'USD'::text, -abs(round(v_amount))
        union all select 1::smallint, v_destination, 'LYD'::text, round(abs(v_amount) * v_rate);
    when 'usd_purchase' then
      if v_rate is null or v_rate <= 0 then raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023'; end if;
      if round(abs(v_amount) / v_rate) = 0 then raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023'; end if;
      return query select 0::smallint, v_source, 'LYD'::text, -abs(round(v_amount))
        union all select 1::smallint, v_destination, 'USD'::text, round(abs(v_amount) / v_rate);
    when 'correction' then return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'record_only' then return;
    else raise exception 'ADREEM_UNKNOWN_MOVEMENT_TYPE' using errcode = '22023';
  end case;
end;
$$;
revoke all on function public.adreem_entries_for_movement(jsonb) from public, anon, authenticated, service_role;

create function adreem_private.validate_investment_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_currency text := case when new.payload ? 'settlementCurrency'
    then new.payload ->> 'settlementCurrency' else 'USD' end;
  v_price numeric;
  v_fee numeric;
  v_fx numeric;
begin
  if v_currency is null or v_currency not in ('USD', 'TRY') then
    raise exception 'ADREEM_INVALID_INVESTMENT_SETTLEMENT' using errcode = '23514';
  end if;
  if v_currency = 'USD' then
    if tg_op = 'INSERT' and new.payload ? 'feeNativeMicros' then
      raise exception 'ADREEM_INVALID_INVESTMENT_SETTLEMENT' using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (select 1 from public.adreem_investment_holdings as holding
    where holding.ledger_id = new.ledger_id and holding.owner_id = new.owner_id
      and holding.record_id = new.holding_id and holding.platform_id = new.platform_id
      and holding.quote_currency = 'TRY')
    or coalesce(new.payload ->> 'priceNativeMicros', '') !~ '^[0-9]+$'
    or coalesce(new.payload ->> 'feeNativeMicros', '') !~ '^[0-9]+$'
    or coalesce(new.payload ->> 'fxTryPerUsdMicros', '') !~ '^[0-9]+$' then
    raise exception 'ADREEM_INVALID_INVESTMENT_SETTLEMENT' using errcode = '23514';
  end if;
  v_price := (new.payload ->> 'priceNativeMicros')::numeric;
  v_fee := (new.payload ->> 'feeNativeMicros')::numeric;
  v_fx := (new.payload ->> 'fxTryPerUsdMicros')::numeric;
  if v_price not between 1 and 9007199254740991
    or v_fee not between 0 and 9007199254740991
    or v_fx not between 1 and 9007199254740991
    or (new.trade_type = 'opening' and v_fee <> 0)
    or floor((v_price * 1000000 + v_fx / 2) / v_fx) is distinct from new.price_usd_micros
    or floor((v_fee * 1000000 + v_fx / 2) / v_fx) is distinct from new.fee_usd_micros then
    raise exception 'ADREEM_INVALID_INVESTMENT_SETTLEMENT' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function adreem_private.validate_investment_settlement()
  from public, anon, authenticated, service_role;
create trigger zzzz_adreem_validate_investment_settlement
before insert or update on public.adreem_investment_trades
for each row execute function adreem_private.validate_investment_settlement();

create or replace function adreem_private.protect_investment_trade_history()
returns trigger language plpgsql security definer set search_path = '' as $$
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
  if new.quantity_units <= 0 or new.price_usd_micros <= 0 or new.fee_usd_micros < 0
    or char_length(coalesce(new.payload ->> 'note', '')) > 300
    or (new.payload ->> 'quantityUnits')::bigint is distinct from new.quantity_units
    or (new.payload ->> 'priceUsdMicros')::bigint is distinct from new.price_usd_micros
    or coalesce(nullif(new.payload ->> 'feeUsdMicros', '')::bigint, 0) is distinct from new.fee_usd_micros
    or nullif(new.payload ->> 'updatedAt', '')::timestamptz is null then
    raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
  end if;
  if old.payload - array['quantityUnits', 'priceUsdMicros', 'priceNativeMicros', 'feeUsdMicros', 'feeNativeMicros', 'note', 'updatedAt']
    is distinct from new.payload - array['quantityUnits', 'priceUsdMicros', 'priceNativeMicros', 'feeUsdMicros', 'feeNativeMicros', 'note', 'updatedAt'] then
    raise exception 'ADREEM_INVESTMENT_TRADE_PAYLOAD_IMMUTABLE' using errcode = '23514';
  end if;
  if coalesce(old.payload ->> 'settlementCurrency', 'USD') = 'USD'
    and old.payload -> 'feeNativeMicros' is distinct from new.payload -> 'feeNativeMicros' then
    raise exception 'ADREEM_INVESTMENT_TRADE_PAYLOAD_IMMUTABLE' using errcode = '23514';
  end if;
  if old.payload ->> 'priceNativeMicros' is distinct from new.payload ->> 'priceNativeMicros'
    and old.price_usd_micros is not distinct from new.price_usd_micros then
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
      or floor(((new.payload ->> 'priceNativeMicros')::numeric * 1000000
          + (new.payload ->> 'fxTryPerUsdMicros')::numeric / 2)
          / nullif((new.payload ->> 'fxTryPerUsdMicros')::numeric, 0)) is distinct from new.price_usd_micros then
      raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_FX' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function adreem_private.protect_investment_trade_history()
  from public, anon, authenticated, service_role;
grant execute on function adreem_private.protect_investment_trade_history() to service_role;

create or replace function public.adreem_apply_ledger_delta_v2_internal(
  p_ledger_id uuid, p_expected_revision bigint, p_delta jsonb, p_owner_id uuid default null
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_authenticated_owner_id uuid := (select auth.uid());
  v_request_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_authenticated_member boolean := lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'adreem_member', 'false')) = 'true';
  v_owner_id uuid;
  v_item jsonb;
  v_record_id text;
  v_result record;
begin
  if v_authenticated_owner_id is not null then
    if not v_authenticated_member then raise exception 'ADREEM_MEMBERSHIP_REQUIRED' using errcode = '42501'; end if;
    if p_owner_id is not null and p_owner_id <> v_authenticated_owner_id then raise exception 'ADREEM_OWNER_MISMATCH' using errcode = '42501'; end if;
    v_owner_id := v_authenticated_owner_id;
  elsif v_request_role = 'service_role' and p_owner_id is not null then
    v_owner_id := p_owner_id;
  else
    raise exception 'ADREEM_AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_delta is null or jsonb_typeof(p_delta) <> 'object' then raise exception 'ADREEM_INVALID_DELTA' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_delta -> 'investmentPlatforms', '[]'::jsonb)) <> 'array' or
     jsonb_typeof(coalesce(p_delta -> 'investmentHoldings', '[]'::jsonb)) <> 'array' or
     jsonb_typeof(coalesce(p_delta -> 'investmentTrades', '[]'::jsonb)) <> 'array' then
    raise exception 'ADREEM_INVALID_INVESTMENT_DELTA' using errcode = '22023';
  end if;
  perform 1 from public.adreem_ledgers as ledger
  where ledger.id = p_ledger_id and ledger.owner_id = v_owner_id and ledger.revision = p_expected_revision
  for update;
  if not found then raise exception 'ADREEM_REVISION_CONFLICT' using errcode = '40001'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_delta -> 'investmentPlatforms', '[]'::jsonb)) loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then raise exception 'ADREEM_INVESTMENT_PLATFORM_ID_REQUIRED' using errcode = '22023'; end if;
    insert into public.adreem_investment_platforms (ledger_id, owner_id, record_id, name, kind, status, payload)
    values (p_ledger_id, v_owner_id, v_record_id, coalesce(nullif(btrim(v_item ->> 'name'), ''), v_record_id), coalesce(nullif(v_item ->> 'kind', ''), 'platform'), coalesce(nullif(v_item ->> 'status', ''), 'active'), v_item)
    on conflict (ledger_id, record_id) do update set name = excluded.name, kind = excluded.kind, status = excluded.status, payload = excluded.payload;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_delta -> 'investmentHoldings', '[]'::jsonb)) loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null or nullif(v_item ->> 'platformId', '') is null then raise exception 'ADREEM_INVESTMENT_HOLDING_REFERENCE_REQUIRED' using errcode = '22023'; end if;
    insert into public.adreem_investment_holdings (ledger_id, owner_id, record_id, platform_id, name, symbol, asset_type, quote_currency, status, payload)
    values (p_ledger_id, v_owner_id, v_record_id, v_item ->> 'platformId', coalesce(nullif(btrim(v_item ->> 'name'), ''), v_record_id), coalesce(nullif(btrim(v_item ->> 'symbol'), ''), v_record_id), coalesce(nullif(v_item ->> 'assetType', ''), 'other'), coalesce(nullif(v_item ->> 'quoteCurrency', ''), 'USD'), coalesce(nullif(v_item ->> 'status', ''), 'active'), v_item)
    on conflict (ledger_id, record_id) do update set platform_id = excluded.platform_id, name = excluded.name, symbol = excluded.symbol, asset_type = excluded.asset_type, quote_currency = excluded.quote_currency, status = excluded.status, payload = excluded.payload;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_delta -> 'investmentTrades', '[]'::jsonb)) loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null or nullif(v_item ->> 'platformId', '') is null or nullif(v_item ->> 'holdingId', '') is null then raise exception 'ADREEM_INVESTMENT_TRADE_REFERENCE_REQUIRED' using errcode = '22023'; end if;
    if exists (select 1 from public.adreem_investment_trades as trade where trade.ledger_id = p_ledger_id and trade.record_id = v_record_id and trade.status = 'voided' and trade.payload is distinct from v_item) then
      raise exception 'ADREEM_VOIDED_INVESTMENT_TRADE_IMMUTABLE' using errcode = '23514';
    end if;
    insert into public.adreem_investment_trades (ledger_id, owner_id, record_id, platform_id, holding_id, trade_type, status, quantity_units, price_usd_micros, fee_usd_micros, occurred_at, payload)
    values (p_ledger_id, v_owner_id, v_record_id, v_item ->> 'platformId', v_item ->> 'holdingId', v_item ->> 'type', coalesce(nullif(v_item ->> 'status', ''), 'active'), (v_item ->> 'quantityUnits')::bigint, (v_item ->> 'priceUsdMicros')::bigint, coalesce(nullif(v_item ->> 'feeUsdMicros', '')::bigint, 0), coalesce(nullif(v_item ->> 'occurredAt', '')::timestamptz, nullif(v_item ->> 'createdAt', '')::timestamptz, now()), v_item)
    on conflict (ledger_id, record_id) do update set platform_id = excluded.platform_id, holding_id = excluded.holding_id, trade_type = excluded.trade_type, status = excluded.status, quantity_units = excluded.quantity_units, price_usd_micros = excluded.price_usd_micros, fee_usd_micros = excluded.fee_usd_micros, occurred_at = excluded.occurred_at, payload = excluded.payload;
  end loop;

  select * into v_result from public.adreem_apply_ledger_delta(
    p_ledger_id, p_expected_revision,
    p_delta - 'investmentPlatforms' - 'investmentHoldings' - 'investmentTrades', v_owner_id);

  if exists (
    select 1 from public.adreem_movements as movement
    left join public.adreem_investment_platforms as platform
      on platform.ledger_id = movement.ledger_id and platform.record_id = movement.payload ->> 'investmentPlatformId' and platform.status = 'active'
    left join public.adreem_accounts as account
      on account.ledger_id = movement.ledger_id and account.record_id = coalesce(movement.source_account_id, movement.destination_account_id)
    where movement.ledger_id = p_ledger_id and movement.owner_id = v_owner_id
      and movement.status = 'posted' and movement.movement_type in ('investment_deposit', 'investment_withdrawal')
      and (platform.record_id is null or movement.currency not in ('USD', 'TRY')
        or account.record_id is null or account.owner_id <> v_owner_id
        or (movement.movement_type = 'investment_deposit' and account.account_type not in ('cash', 'bank', 'person'))
        or (movement.movement_type = 'investment_withdrawal' and account.account_type not in ('cash', 'bank')))
  ) then
    raise exception 'ADREEM_INVALID_INVESTMENT_MOVEMENT' using errcode = '23514';
  end if;

  if exists (
    select 1 from (
      select sum(case trade.trade_type when 'sell' then -trade.quantity_units else trade.quantity_units end)
        over (partition by trade.ledger_id, trade.holding_id order by trade.occurred_at, trade.record_id rows unbounded preceding) as quantity
      from public.adreem_investment_trades as trade
      where trade.ledger_id = p_ledger_id and trade.owner_id = v_owner_id and trade.status = 'active'
        and not exists (select 1 from public.adreem_investment_holdings as holding
          where holding.ledger_id = trade.ledger_id and holding.record_id = trade.holding_id
            and split_part(split_part(upper(holding.symbol), ':', 1), '/', 1) = 'USDT')
    ) as position where position.quantity < 0
  ) then
    raise exception 'ADREEM_INVESTMENT_POSITION_NEGATIVE' using errcode = '23514';
  end if;

  perform adreem_private.require_investment_cash(
    p_ledger_id, v_owner_id, 'ADREEM_INVESTMENT_CASH_NEGATIVE');
  return query select v_result.revision, v_result.updated_at;
end;
$$;


create or replace function public.adreem_apply_ledger_delta_v2_before_transfers(
  p_ledger_id uuid,
  p_expected_revision bigint,
  p_delta jsonb,
  p_owner_id uuid default null
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authenticated_owner_id uuid := (select auth.uid());
  v_request_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_authenticated_member boolean := lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'adreem_member', 'false')) = 'true';
  v_owner_id uuid;
  v_item jsonb;
  v_previous public.adreem_investment_trades%rowtype;
  v_audit jsonb;
  v_quantity numeric;
  v_price numeric;
  v_fee numeric;
  v_native_fee numeric;
  v_trade_value numeric;
  v_financial_changed boolean;
  v_values_changed boolean;
  v_result record;
begin
  if v_authenticated_owner_id is not null then
    if not v_authenticated_member then
      raise exception 'ADREEM_MEMBERSHIP_REQUIRED' using errcode = '42501';
    end if;
    if p_owner_id is not null and p_owner_id <> v_authenticated_owner_id then
      raise exception 'ADREEM_OWNER_MISMATCH' using errcode = '42501';
    end if;
    v_owner_id := v_authenticated_owner_id;
  elsif v_request_role = 'service_role' and p_owner_id is not null then
    v_owner_id := p_owner_id;
  else
    raise exception 'ADREEM_AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_delta is null or jsonb_typeof(p_delta) <> 'object'
    or jsonb_typeof(coalesce(p_delta -> 'investmentTrades', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_delta -> 'auditEvents', '[]'::jsonb)) <> 'array'
  then
    raise exception 'ADREEM_INVALID_DELTA' using errcode = '22023';
  end if;

  perform 1
  from public.adreem_ledgers as ledger
  where ledger.id = p_ledger_id
    and ledger.owner_id = v_owner_id
    and ledger.revision = p_expected_revision
  for update;
  if not found then
    raise exception 'ADREEM_REVISION_CONFLICT' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_delta -> 'auditEvents', '[]'::jsonb)) as event(value)
    where nullif(event.value ->> 'id', '') is not null
    group by event.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'ADREEM_DUPLICATE_AUDIT_ID' using errcode = '23514';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'investmentTrades', '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item ->> 'quantityUnits', '') !~ '^[0-9]+$'
      or coalesce(v_item ->> 'priceUsdMicros', '') !~ '^[0-9]+$'
      or coalesce(nullif(v_item ->> 'feeUsdMicros', ''), '0') !~ '^[0-9]+$'
    then
      raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
    end if;

    v_quantity := (v_item ->> 'quantityUnits')::numeric;
    v_price := (v_item ->> 'priceUsdMicros')::numeric;
    v_fee := coalesce(nullif(v_item ->> 'feeUsdMicros', '')::numeric, 0);
    v_trade_value := floor(((v_quantity * v_price) + 50000000) / 100000000);
    if v_quantity <= 0 or v_price <= 0 or v_fee < 0
      or v_quantity > 9007199254740991
      or v_price > 9007199254740991
      or v_fee > 9007199254740991
      or v_trade_value <= 0
      or v_trade_value > 9007199254740991
      or (v_item ->> 'type' in ('opening', 'buy') and v_trade_value + v_fee > 9007199254740991)
      or char_length(coalesce(v_item ->> 'note', '')) > 300
      or (v_item ->> 'type' = 'opening' and v_fee <> 0)
    then
      raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
    end if;

    select trade.* into v_previous
    from public.adreem_investment_trades as trade
    where trade.ledger_id = p_ledger_id
      and trade.owner_id = v_owner_id
      and trade.record_id = nullif(v_item ->> 'id', '')
    for update;

    if found then
      if coalesce(v_previous.payload ->> 'settlementCurrency', 'USD') = 'TRY' then
        if coalesce(v_item ->> 'feeNativeMicros', '') !~ '^[0-9]+$'
          or (v_item ->> 'feeNativeMicros')::numeric > 9007199254740991 then
          raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
        end if;
        v_native_fee := (v_item ->> 'feeNativeMicros')::numeric;
      else
        v_native_fee := null;
      end if;
      v_financial_changed := v_previous.quantity_units is distinct from v_quantity::bigint
        or v_previous.price_usd_micros is distinct from v_price::bigint
        or v_previous.fee_usd_micros is distinct from v_fee::bigint
        or (v_native_fee is not null and
          (v_previous.payload ->> 'feeNativeMicros')::numeric is distinct from v_native_fee);
      v_values_changed := v_financial_changed
        or coalesce(v_previous.payload ->> 'note', '') is distinct from coalesce(v_item ->> 'note', '');

      if not v_values_changed then
        if v_previous.payload is distinct from v_item then
          raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
        end if;
        continue;
      end if;

      begin
        if nullif(v_item ->> 'updatedAt', '')::timestamptz is null then
          raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'ADREEM_INVALID_INVESTMENT_TRADE_EDIT' using errcode = '23514';
      end;

      if v_previous.trade_type = 'opening' and v_financial_changed and (
        exists (
          select 1
          from public.adreem_investment_trades as later_trade
          where later_trade.ledger_id = p_ledger_id
            and later_trade.owner_id = v_owner_id
            and later_trade.holding_id = v_previous.holding_id
            and later_trade.record_id <> v_previous.record_id
            and later_trade.status <> 'voided'
            and row(later_trade.occurred_at, later_trade.record_id) > row(v_previous.occurred_at, v_previous.record_id)
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(p_delta -> 'investmentTrades', '[]'::jsonb)) as batch_trade(value)
          where batch_trade.value ->> 'holdingId' = v_previous.holding_id
            and batch_trade.value ->> 'id' <> v_previous.record_id
            and coalesce(nullif(batch_trade.value ->> 'status', ''), 'active') <> 'voided'
            and row(
              coalesce(
                nullif(batch_trade.value ->> 'occurredAt', '')::timestamptz,
                nullif(batch_trade.value ->> 'createdAt', '')::timestamptz,
                transaction_timestamp()
              ),
              batch_trade.value ->> 'id'
            ) > row(v_previous.occurred_at, v_previous.record_id)
        )
        or exists (select 1 from public.adreem_investment_transfers as transfer
          where transfer.ledger_id = p_ledger_id and transfer.owner_id = v_owner_id
            and transfer.source_holding_id = v_previous.holding_id)
      ) then
        raise exception 'ADREEM_INVESTMENT_OPENING_TRADE_LOCKED' using errcode = '23514';
      end if;

      select event.value into v_audit
      from jsonb_array_elements(coalesce(p_delta -> 'auditEvents', '[]'::jsonb)) as event(value)
      where nullif(event.value ->> 'id', '') is not null
        and event.value ->> 'action' = 'investment.trade.updated'
        and event.value #>> '{details,tradeId}' = v_previous.record_id
        and event.value #>> '{details,holdingId}' = v_previous.holding_id
        and event.value #>> '{details,platformId}' = v_previous.platform_id
        and event.value #> '{details,before}' = (jsonb_build_object(
          'quantityUnits', v_previous.quantity_units,
          'priceUsdMicros', v_previous.price_usd_micros,
          'feeUsdMicros', v_previous.fee_usd_micros,
          'note', coalesce(v_previous.payload ->> 'note', '')
        ) || case when v_native_fee is not null then jsonb_build_object(
          'feeNativeMicros', (v_previous.payload ->> 'feeNativeMicros')::bigint,
          'settlementCurrency', 'TRY') else '{}'::jsonb end)
        and event.value #> '{details,after}' = (jsonb_build_object(
          'quantityUnits', v_quantity::bigint,
          'priceUsdMicros', v_price::bigint,
          'feeUsdMicros', v_fee::bigint,
          'note', coalesce(v_item ->> 'note', '')
        ) || case when v_native_fee is not null then jsonb_build_object(
          'feeNativeMicros', v_native_fee::bigint,
          'settlementCurrency', 'TRY') else '{}'::jsonb end)
        and (v_native_fee is null or (
          event.value #>> '{details,priceNativeBeforeMicros}' = v_previous.payload ->> 'priceNativeMicros'
          and event.value #>> '{details,priceNativeAfterMicros}' = v_item ->> 'priceNativeMicros'
          and event.value #>> '{details,fxTryPerUsdMicros}' = v_previous.payload ->> 'fxTryPerUsdMicros'))
        and not exists (
          select 1
          from public.adreem_audit_events as existing_audit
          where existing_audit.ledger_id = p_ledger_id
            and existing_audit.owner_id = v_owner_id
            and existing_audit.record_id = event.value ->> 'id'
        )
      limit 1;

      if v_audit is null then
        raise exception 'ADREEM_INVESTMENT_TRADE_AUDIT_REQUIRED' using errcode = '23514';
      end if;
      begin
        if nullif(v_audit ->> 'createdAt', '')::timestamptz is null then
          raise exception 'ADREEM_INVESTMENT_TRADE_AUDIT_REQUIRED' using errcode = '23514';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'ADREEM_INVESTMENT_TRADE_AUDIT_REQUIRED' using errcode = '23514';
      end;
    end if;
  end loop;

  select result.* into v_result
  from public.adreem_apply_ledger_delta_v2_internal(
    p_ledger_id,
    p_expected_revision,
    p_delta,
    v_owner_id
  ) as result;

  if exists (
    select 1
    from (
      select
        trade.holding_id,
        sum(case trade.trade_type when 'sell' then -trade.quantity_units else trade.quantity_units end) as quantity_units,
        sum(
          case when trade.trade_type in ('opening', 'buy')
            then round((trade.quantity_units::numeric * trade.price_usd_micros::numeric) / 100000000) + trade.fee_usd_micros
            else 0
          end
        ) as gross_cost_usd_micros
      from public.adreem_investment_trades as trade
      where trade.ledger_id = p_ledger_id
        and trade.owner_id = v_owner_id
        and trade.status = 'active'
      group by trade.holding_id
    ) as holding_total
    where holding_total.quantity_units > 9007199254740991
      or holding_total.gross_cost_usd_micros > 9007199254740991
  ) then
    raise exception 'ADREEM_INVESTMENT_TOTAL_OUT_OF_RANGE' using errcode = '23514';
  end if;

  perform adreem_private.require_investment_cash(
    p_ledger_id, v_owner_id, 'ADREEM_INVESTMENT_CASH_OUT_OF_RANGE');

  return query select v_result.revision, v_result.updated_at;
end;
$$;


create or replace function public.adreem_apply_ledger_delta_v2(
  p_ledger_id uuid,
  p_expected_revision bigint,
  p_delta jsonb,
  p_owner_id uuid default null
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner_id uuid := coalesce((select auth.uid()), p_owner_id);
  v_item jsonb;
  v_result record;
  v_platform record;
  v_holding record;
  v_event record;
  v_quantity numeric;
  v_cost numeric;
  v_delta numeric;
begin
  if p_delta is null or jsonb_typeof(p_delta) <> 'object'
    or jsonb_typeof(coalesce(p_delta -> 'investmentTransfers', '[]'::jsonb)) <> 'array' then
    raise exception 'ADREEM_INVALID_INVESTMENT_TRANSFER_DELTA' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_delta -> 'investmentTransfers', '[]'::jsonb)) as item(value)
    group by item.value ->> 'id' having count(*) > 1
  ) then
    raise exception 'ADREEM_DUPLICATE_INVESTMENT_TRANSFER' using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_delta -> 'investmentTransfers', '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object'
      or nullif(v_item ->> 'id', '') is null
      or char_length(v_item ->> 'id') > 160
      or v_item ->> 'status' <> 'active'
      or v_item ->> 'asset' not in ('USD', 'USDT')
      or nullif(v_item ->> 'fromPlatformId', '') is null
      or nullif(v_item ->> 'toPlatformId', '') is null
      or v_item ->> 'fromPlatformId' = v_item ->> 'toPlatformId'
      or char_length(coalesce(v_item ->> 'note', '')) > 300
      or coalesce(v_item ->> 'createdAt', '') = ''
      or coalesce(v_item ->> 'occurredAt', '') = ''
      or (v_item ->> 'asset' = 'USD' and (
        coalesce(v_item ->> 'amountUsdMicros', '') !~ '^[0-9]+$'
        or coalesce(v_item ->> 'amountUsdMicros', '0')::numeric not between 1 and 9007199254740991
        or v_item ? 'sourceHoldingId' or v_item ? 'destinationHoldingId'
        or v_item ? 'quantityUnits' or v_item ? 'costBasisUsdMicros'))
      or (v_item ->> 'asset' = 'USDT' and (
        coalesce(v_item ->> 'quantityUnits', '') !~ '^[0-9]+$'
        or coalesce(v_item ->> 'costBasisUsdMicros', '') !~ '^[0-9]+$'
        or coalesce(v_item ->> 'quantityUnits', '0')::numeric not between 1 and 9007199254740991
        or coalesce(v_item ->> 'costBasisUsdMicros', '0')::numeric > 9007199254740991
        or nullif(v_item ->> 'sourceHoldingId', '') is null
        or nullif(v_item ->> 'destinationHoldingId', '') is null
        or v_item ? 'amountUsdMicros'))
      or not exists (
        select 1 from jsonb_array_elements(coalesce(p_delta -> 'auditEvents', '[]'::jsonb)) as audit(value)
        where audit.value ->> 'action' = 'investment.transfer.created'
          and audit.value #>> '{details,transferId}' = v_item ->> 'id'
          and audit.value #>> '{details,fromPlatformId}' = v_item ->> 'fromPlatformId'
          and audit.value #>> '{details,toPlatformId}' = v_item ->> 'toPlatformId'
          and audit.value #>> '{details,asset}' = v_item ->> 'asset'
      )
    then
      raise exception 'ADREEM_INVALID_INVESTMENT_TRANSFER' using errcode = '23514';
    end if;
  end loop;

  select * into v_result from public.adreem_apply_ledger_delta_v2_before_transfers(
    p_ledger_id, p_expected_revision, p_delta - 'investmentTransfers', p_owner_id
  );

  for v_item in select value from jsonb_array_elements(coalesce(p_delta -> 'investmentTransfers', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.adreem_investment_platforms as source
      join public.adreem_investment_platforms as destination
        on destination.ledger_id = source.ledger_id and destination.owner_id = source.owner_id
      where source.ledger_id = p_ledger_id and source.owner_id = v_owner_id
        and source.record_id = v_item ->> 'fromPlatformId' and source.status = 'active'
        and destination.record_id = v_item ->> 'toPlatformId' and destination.status = 'active'
    ) then
      raise exception 'ADREEM_INVESTMENT_TRANSFER_PLATFORM_INVALID' using errcode = '23514';
    end if;
    if v_item ->> 'asset' = 'USDT' and not exists (
      select 1 from public.adreem_investment_holdings as source
      join public.adreem_investment_holdings as destination
        on destination.ledger_id = source.ledger_id and destination.owner_id = source.owner_id
      where source.ledger_id = p_ledger_id and source.owner_id = v_owner_id
        and source.record_id = v_item ->> 'sourceHoldingId'
        and source.platform_id = v_item ->> 'fromPlatformId'
        and source.status = 'active' and source.quote_currency = 'USD'
        and split_part(split_part(upper(source.symbol), ':', 1), '/', 1) = 'USDT'
        and destination.record_id = v_item ->> 'destinationHoldingId'
        and destination.platform_id = v_item ->> 'toPlatformId'
        and destination.status = 'active' and destination.quote_currency = 'USD'
        and split_part(split_part(upper(destination.symbol), ':', 1), '/', 1) = 'USDT'
    ) then
      raise exception 'ADREEM_INVESTMENT_TRANSFER_HOLDING_INVALID' using errcode = '23514';
    end if;
    insert into public.adreem_investment_transfers (
      ledger_id, owner_id, record_id, from_platform_id, to_platform_id, asset,
      status, amount_usd_micros, quantity_units, cost_basis_usd_micros,
      source_holding_id, destination_holding_id, occurred_at, created_at, payload
    ) values (
      p_ledger_id, v_owner_id, v_item ->> 'id', v_item ->> 'fromPlatformId', v_item ->> 'toPlatformId',
      v_item ->> 'asset', 'active', coalesce(nullif(v_item ->> 'amountUsdMicros', '')::bigint, 0),
      coalesce(nullif(v_item ->> 'quantityUnits', '')::bigint, 0),
      coalesce(nullif(v_item ->> 'costBasisUsdMicros', '')::bigint, 0),
      nullif(v_item ->> 'sourceHoldingId', ''), nullif(v_item ->> 'destinationHoldingId', ''),
      (v_item ->> 'occurredAt')::timestamptz, (v_item ->> 'createdAt')::timestamptz, v_item
    );
  end loop;

  perform adreem_private.require_investment_cash(
    p_ledger_id, v_owner_id, 'ADREEM_INVESTMENT_TRANSFER_CASH_NEGATIVE');

  for v_holding in select * from public.adreem_investment_holdings
    where ledger_id = p_ledger_id and owner_id = v_owner_id
      and split_part(split_part(upper(symbol), ':', 1), '/', 1) = 'USDT' loop
    v_quantity := 0;
    v_cost := 0;
    for v_event in
      select event_type, quantity_units, price_usd_micros, fee_usd_micros, transfer_cost from (
        select trade.trade_type as event_type, trade.quantity_units::numeric, trade.price_usd_micros::numeric,
          trade.fee_usd_micros::numeric, 0::numeric as transfer_cost, trade.occurred_at as event_at, trade.record_id as event_id
        from public.adreem_investment_trades as trade
        where trade.ledger_id = p_ledger_id and trade.owner_id = v_owner_id
          and trade.holding_id = v_holding.record_id and trade.status = 'active'
        union all
        select 'transfer_out', transfer.quantity_units::numeric, 0::numeric, 0::numeric,
          transfer.cost_basis_usd_micros::numeric, transfer.occurred_at, transfer.record_id
        from public.adreem_investment_transfers as transfer
        where transfer.ledger_id = p_ledger_id and transfer.owner_id = v_owner_id
          and transfer.source_holding_id = v_holding.record_id
        union all
        select 'transfer_in', transfer.quantity_units::numeric, 0::numeric, 0::numeric,
          transfer.cost_basis_usd_micros::numeric, transfer.occurred_at, transfer.record_id
        from public.adreem_investment_transfers as transfer
        where transfer.ledger_id = p_ledger_id and transfer.owner_id = v_owner_id
          and transfer.destination_holding_id = v_holding.record_id
      ) as events order by event_at, event_id
    loop
      if v_event.event_type in ('opening', 'buy') then
        v_delta := round(v_event.quantity_units * v_event.price_usd_micros / 100000000);
        v_quantity := v_quantity + v_event.quantity_units;
        v_cost := v_cost + v_delta + v_event.fee_usd_micros;
      elsif v_event.event_type = 'transfer_in' then
        v_quantity := v_quantity + v_event.quantity_units;
        v_cost := v_cost + v_event.transfer_cost;
      else
        if v_quantity < v_event.quantity_units or v_quantity <= 0 then
          raise exception 'ADREEM_INVESTMENT_TRANSFER_POSITION_NEGATIVE' using errcode = '23514';
        end if;
        v_delta := round(v_cost * v_event.quantity_units / v_quantity);
        if v_event.event_type = 'transfer_out' and v_event.transfer_cost <> v_delta then
          raise exception 'ADREEM_INVESTMENT_TRANSFER_COST_MISMATCH' using errcode = '23514';
        end if;
        v_quantity := v_quantity - v_event.quantity_units;
        v_cost := v_cost - v_delta;
      end if;
      if v_quantity > 9007199254740991 or v_cost > 9007199254740991 or v_cost < 0 then
        raise exception 'ADREEM_INVESTMENT_TRANSFER_OVERFLOW' using errcode = '23514';
      end if;
    end loop;
  end loop;

  return query select v_result.revision, v_result.updated_at;
end;
$$;

revoke all on function public.adreem_apply_ledger_delta_v2(uuid, bigint, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.adreem_apply_ledger_delta_v2(uuid, bigint, jsonb, uuid)
  to authenticated, service_role;
