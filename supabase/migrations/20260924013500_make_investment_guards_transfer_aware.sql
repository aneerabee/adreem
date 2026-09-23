-- V2 inner guards must include previously moved balances. The outer RPC validates new
-- transfers after inserting them in the same transaction.
create or replace function public.adreem_apply_ledger_delta_v2_internal(
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
    p_ledger_id,
    p_expected_revision,
    p_delta - 'investmentPlatforms' - 'investmentHoldings' - 'investmentTrades',
    v_owner_id
  );

  if exists (
    select 1 from public.adreem_movements as movement
    left join public.adreem_investment_platforms as platform
      on platform.ledger_id = movement.ledger_id and platform.record_id = movement.payload ->> 'investmentPlatformId' and platform.status = 'active'
    left join public.adreem_accounts as account
      on account.ledger_id = movement.ledger_id and account.record_id = coalesce(movement.source_account_id, movement.destination_account_id)
    where movement.ledger_id = p_ledger_id and movement.owner_id = v_owner_id
      and movement.status = 'posted' and movement.movement_type in ('investment_deposit', 'investment_withdrawal')
      and (
        platform.record_id is null
        or movement.currency <> 'USD'
        or account.record_id is null
        or account.owner_id <> v_owner_id
        or (movement.movement_type = 'investment_deposit' and account.account_type not in ('cash', 'bank', 'person'))
        or (movement.movement_type = 'investment_withdrawal' and account.account_type not in ('cash', 'bank'))
      )
  ) then
    raise exception 'ADREEM_INVALID_INVESTMENT_MOVEMENT' using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select sum(case trade.trade_type when 'sell' then -trade.quantity_units else trade.quantity_units end)
        over (partition by trade.ledger_id, trade.holding_id order by trade.occurred_at, trade.record_id rows unbounded preceding) as quantity
      from public.adreem_investment_trades as trade
      where trade.ledger_id = p_ledger_id and trade.owner_id = v_owner_id and trade.status = 'active'
        and not exists (select 1 from public.adreem_investment_holdings as holding
          where holding.ledger_id = trade.ledger_id and holding.record_id = trade.holding_id
            and split_part(split_part(upper(holding.symbol), ':', 1), '/', 1) = 'USDT')
    ) as position
    where position.quantity < 0
  ) then
    raise exception 'ADREEM_INVESTMENT_POSITION_NEGATIVE' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.adreem_investment_platforms as platform
    left join lateral (
      select coalesce(sum(
        case movement.movement_type
          when 'investment_deposit' then abs(movement.amount) * 1000000
          when 'investment_withdrawal' then -abs(movement.amount) * 1000000
          else 0
        end
      ), 0) as movement_cash
      from public.adreem_movements as movement
      where movement.ledger_id = platform.ledger_id
        and movement.owner_id = platform.owner_id
        and movement.status = 'posted'
        and movement.payload ->> 'investmentPlatformId' = platform.record_id
    ) as movement_total on true
    left join lateral (
      select coalesce(sum(
        case trade.trade_type
          when 'buy' then -round((trade.quantity_units::numeric * trade.price_usd_micros::numeric) / 100000000) - trade.fee_usd_micros
          when 'sell' then round((trade.quantity_units::numeric * trade.price_usd_micros::numeric) / 100000000) - trade.fee_usd_micros
          else 0
        end
      ), 0) as trade_cash
      from public.adreem_investment_trades as trade
      where trade.ledger_id = platform.ledger_id
        and trade.platform_id = platform.record_id
        and trade.status = 'active'
    ) as trade_total on true
    where platform.ledger_id = p_ledger_id
      and platform.owner_id = v_owner_id
      and movement_total.movement_cash + trade_total.trade_cash + coalesce((select sum(case when transfer.to_platform_id = platform.record_id then transfer.amount_usd_micros else -transfer.amount_usd_micros end)
          from public.adreem_investment_transfers as transfer
          where transfer.ledger_id = platform.ledger_id and transfer.owner_id = platform.owner_id
            and transfer.asset = 'USD'
            and (transfer.from_platform_id = platform.record_id or transfer.to_platform_id = platform.record_id)), 0) < 0
  ) then
    raise exception 'ADREEM_INVESTMENT_CASH_NEGATIVE' using errcode = '23514';
  end if;

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
      v_financial_changed := v_previous.quantity_units is distinct from v_quantity::bigint
        or v_previous.price_usd_micros is distinct from v_price::bigint
        or v_previous.fee_usd_micros is distinct from v_fee::bigint;
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
        and event.value #> '{details,before}' = jsonb_build_object(
          'quantityUnits', v_previous.quantity_units,
          'priceUsdMicros', v_previous.price_usd_micros,
          'feeUsdMicros', v_previous.fee_usd_micros,
          'note', coalesce(v_previous.payload ->> 'note', '')
        )
        and event.value #> '{details,after}' = jsonb_build_object(
          'quantityUnits', v_quantity::bigint,
          'priceUsdMicros', v_price::bigint,
          'feeUsdMicros', v_fee::bigint,
          'note', coalesce(v_item ->> 'note', '')
        )
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

  if exists (
    select 1
    from public.adreem_investment_platforms as platform
    left join lateral (
      select coalesce(sum(
        case movement.movement_type
          when 'investment_deposit' then abs(movement.amount) * 1000000
          when 'investment_withdrawal' then -abs(movement.amount) * 1000000
          else 0
        end
      ), 0) as movement_cash
      from public.adreem_movements as movement
      where movement.ledger_id = platform.ledger_id
        and movement.owner_id = platform.owner_id
        and movement.status = 'posted'
        and movement.payload ->> 'investmentPlatformId' = platform.record_id
    ) as movement_total on true
    left join lateral (
      select coalesce(sum(
        case trade.trade_type
          when 'buy' then -round((trade.quantity_units::numeric * trade.price_usd_micros::numeric) / 100000000) - trade.fee_usd_micros
          when 'sell' then round((trade.quantity_units::numeric * trade.price_usd_micros::numeric) / 100000000) - trade.fee_usd_micros
          else 0
        end
      ), 0) as trade_cash
      from public.adreem_investment_trades as trade
      where trade.ledger_id = platform.ledger_id
        and trade.owner_id = platform.owner_id
        and trade.platform_id = platform.record_id
        and trade.status = 'active'
    ) as trade_total on true
    where platform.ledger_id = p_ledger_id
      and platform.owner_id = v_owner_id
      and (
        movement_total.movement_cash + trade_total.trade_cash + coalesce((select sum(case when transfer.to_platform_id = platform.record_id then transfer.amount_usd_micros else -transfer.amount_usd_micros end)
          from public.adreem_investment_transfers as transfer
          where transfer.ledger_id = platform.ledger_id and transfer.owner_id = platform.owner_id
            and transfer.asset = 'USD'
            and (transfer.from_platform_id = platform.record_id or transfer.to_platform_id = platform.record_id)), 0) < 0
        or movement_total.movement_cash + trade_total.trade_cash + coalesce((select sum(case when transfer.to_platform_id = platform.record_id then transfer.amount_usd_micros else -transfer.amount_usd_micros end)
          from public.adreem_investment_transfers as transfer
          where transfer.ledger_id = platform.ledger_id and transfer.owner_id = platform.owner_id
            and transfer.asset = 'USD'
            and (transfer.from_platform_id = platform.record_id or transfer.to_platform_id = platform.record_id)), 0) > 9007199254740991
      )
  ) then
    raise exception 'ADREEM_INVESTMENT_CASH_OUT_OF_RANGE' using errcode = '23514';
  end if;

  return query select v_result.revision, v_result.updated_at;
end;
$$;
