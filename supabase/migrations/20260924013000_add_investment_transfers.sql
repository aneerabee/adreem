-- Append-only internal transfers; neither ledger cash nor USDT is created by moving it.
create table public.adreem_investment_transfers (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  from_platform_id text not null,
  to_platform_id text not null,
  asset text not null check (asset in ('USD', 'USDT')),
  status text not null check (status = 'active'),
  amount_usd_micros bigint not null default 0 check (amount_usd_micros >= 0),
  quantity_units bigint not null default 0 check (quantity_units >= 0),
  cost_basis_usd_micros bigint not null default 0 check (cost_basis_usd_micros >= 0),
  source_holding_id text,
  destination_holding_id text,
  occurred_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null,
  primary key (ledger_id, record_id),
  foreign key (ledger_id, owner_id) references public.adreem_ledgers(id, owner_id) on delete cascade,
  foreign key (ledger_id, from_platform_id) references public.adreem_investment_platforms(ledger_id, record_id),
  foreign key (ledger_id, to_platform_id) references public.adreem_investment_platforms(ledger_id, record_id),
  foreign key (ledger_id, source_holding_id, from_platform_id)
    references public.adreem_investment_holdings(ledger_id, record_id, platform_id),
  foreign key (ledger_id, destination_holding_id, to_platform_id)
    references public.adreem_investment_holdings(ledger_id, record_id, platform_id),
  check (from_platform_id <> to_platform_id),
  check ((asset = 'USD' and amount_usd_micros > 0 and quantity_units = 0 and cost_basis_usd_micros = 0
    and source_holding_id is null and destination_holding_id is null)
    or (asset = 'USDT' and amount_usd_micros = 0 and quantity_units > 0
      and source_holding_id is not null and destination_holding_id is not null)),
  check (payload ->> 'id' = record_id and payload ->> 'asset' = asset
    and payload ->> 'fromPlatformId' = from_platform_id
    and payload ->> 'toPlatformId' = to_platform_id
    and payload ->> 'status' = status)
);

create index adreem_investment_transfers_platform_time_idx
  on public.adreem_investment_transfers (ledger_id, from_platform_id, occurred_at desc);
create index adreem_investment_transfers_destination_time_idx
  on public.adreem_investment_transfers (ledger_id, to_platform_id, occurred_at desc);

create or replace function adreem_private.protect_investment_transfer_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'ADREEM_INVESTMENT_TRANSFER_IMMUTABLE' using errcode = '23514';
end;
$$;
revoke all on function adreem_private.protect_investment_transfer_history() from public, anon, authenticated, service_role;
create trigger adreem_investment_transfers_immutable
before update or delete on public.adreem_investment_transfers
for each row execute function adreem_private.protect_investment_transfer_history();

alter table public.adreem_investment_transfers enable row level security;
alter table public.adreem_investment_transfers force row level security;
create policy adreem_investment_transfers_own on public.adreem_investment_transfers
for select to authenticated
using (owner_id = (select auth.uid()) and (select public.adreem_current_owner_is_active()));
revoke all on table public.adreem_investment_transfers from public, anon, authenticated, service_role;
grant select on table public.adreem_investment_transfers to authenticated, service_role;

alter function public.adreem_apply_ledger_delta_v2(uuid, bigint, jsonb, uuid)
  rename to adreem_apply_ledger_delta_v2_before_transfers;
revoke all on function public.adreem_apply_ledger_delta_v2_before_transfers(uuid, bigint, jsonb, uuid)
  from public, anon, authenticated, service_role;

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

  for v_platform in select * from public.adreem_investment_platforms
    where ledger_id = p_ledger_id and owner_id = v_owner_id loop
    if (
      coalesce((select sum(case movement.movement_type
        when 'investment_deposit' then abs(movement.amount) * 1000000
        when 'investment_withdrawal' then -abs(movement.amount) * 1000000 else 0 end)
        from public.adreem_movements as movement
        where movement.ledger_id = p_ledger_id and movement.owner_id = v_owner_id
          and movement.status = 'posted' and movement.payload ->> 'investmentPlatformId' = v_platform.record_id), 0)
      + coalesce((select sum(case trade.trade_type
        when 'buy' then -round(trade.quantity_units::numeric * trade.price_usd_micros / 100000000) - trade.fee_usd_micros
        when 'sell' then round(trade.quantity_units::numeric * trade.price_usd_micros / 100000000) - trade.fee_usd_micros else 0 end)
        from public.adreem_investment_trades as trade
        where trade.ledger_id = p_ledger_id and trade.owner_id = v_owner_id
          and trade.platform_id = v_platform.record_id and trade.status = 'active'), 0)
      + coalesce((select sum(case when transfer.to_platform_id = v_platform.record_id then transfer.amount_usd_micros else -transfer.amount_usd_micros end)
        from public.adreem_investment_transfers as transfer
        where transfer.ledger_id = p_ledger_id and transfer.owner_id = v_owner_id
          and transfer.asset = 'USD' and (transfer.from_platform_id = v_platform.record_id or transfer.to_platform_id = v_platform.record_id)), 0)
    ) < 0 then
      raise exception 'ADREEM_INVESTMENT_TRANSFER_CASH_NEGATIVE' using errcode = '23514';
    end if;
  end loop;

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
