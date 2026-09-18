-- Isolated USD investment portfolio records for every ADREEM ledger.

alter table public.adreem_movements
  drop constraint if exists adreem_movements_movement_type_check;
alter table public.adreem_movements
  add constraint adreem_movements_movement_type_check check (movement_type in (
    'opening_balance', 'transfer', 'cash_deposit', 'cash_withdrawal',
    'expense', 'truck_expense', 'truck_income', 'usd_sale',
    'usd_purchase', 'external_income', 'correction', 'record_only',
    'investment_deposit', 'investment_withdrawal'
  ));

create table public.adreem_investment_platforms (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('platform', 'bank', 'wallet', 'broker')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ledger_id, record_id),
  foreign key (ledger_id, owner_id)
    references public.adreem_ledgers(id, owner_id) on delete cascade
);

create table public.adreem_investment_holdings (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  platform_id text not null,
  name text not null check (btrim(name) <> ''),
  symbol text not null check (btrim(symbol) <> ''),
  asset_type text not null check (asset_type in ('stock', 'crypto', 'metal', 'fund', 'other')),
  quote_currency text not null default 'USD' check (quote_currency in ('USD', 'TRY', 'EUR')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ledger_id, record_id),
  foreign key (ledger_id, owner_id)
    references public.adreem_ledgers(id, owner_id) on delete cascade,
  foreign key (ledger_id, platform_id)
    references public.adreem_investment_platforms(ledger_id, record_id) on delete restrict,
  unique (ledger_id, record_id, platform_id)
);

create unique index adreem_investment_holdings_symbol_key
  on public.adreem_investment_holdings (ledger_id, platform_id, upper(symbol))
  where status = 'active';

create table public.adreem_investment_trades (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  platform_id text not null,
  holding_id text not null,
  trade_type text not null check (trade_type in ('opening', 'buy', 'sell')),
  status text not null default 'active' check (status in ('active', 'voided')),
  quantity_units bigint not null check (quantity_units > 0),
  price_usd_micros bigint not null check (price_usd_micros > 0),
  fee_usd_micros bigint not null default 0 check (fee_usd_micros >= 0),
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ledger_id, record_id),
  foreign key (ledger_id, owner_id)
    references public.adreem_ledgers(id, owner_id) on delete cascade,
  foreign key (ledger_id, platform_id)
    references public.adreem_investment_platforms(ledger_id, record_id) on delete restrict,
  foreign key (ledger_id, holding_id, platform_id)
    references public.adreem_investment_holdings(ledger_id, record_id, platform_id) on delete restrict,
  check (trade_type <> 'opening' or fee_usd_micros = 0)
);

create index adreem_investment_trades_holding_time_idx
  on public.adreem_investment_trades (ledger_id, platform_id, holding_id, occurred_at, record_id);

create trigger adreem_investment_platforms_set_updated_at
before update on public.adreem_investment_platforms
for each row execute function public.adreem_set_updated_at();
create trigger adreem_investment_holdings_set_updated_at
before update on public.adreem_investment_holdings
for each row execute function public.adreem_set_updated_at();
create trigger adreem_investment_trades_set_updated_at
before update on public.adreem_investment_trades
for each row execute function public.adreem_set_updated_at();

alter table public.adreem_investment_platforms enable row level security;
alter table public.adreem_investment_platforms force row level security;
alter table public.adreem_investment_holdings enable row level security;
alter table public.adreem_investment_holdings force row level security;
alter table public.adreem_investment_trades enable row level security;
alter table public.adreem_investment_trades force row level security;

create policy adreem_investment_platforms_own on public.adreem_investment_platforms
for select to authenticated
using (owner_id = (select auth.uid()) and (select public.adreem_current_owner_is_active()));
create policy adreem_investment_holdings_own on public.adreem_investment_holdings
for select to authenticated
using (owner_id = (select auth.uid()) and (select public.adreem_current_owner_is_active()));
create policy adreem_investment_trades_own on public.adreem_investment_trades
for select to authenticated
using (owner_id = (select auth.uid()) and (select public.adreem_current_owner_is_active()));

revoke all on table
  public.adreem_investment_platforms,
  public.adreem_investment_holdings,
  public.adreem_investment_trades
from public, anon, authenticated, service_role;
grant select on table
  public.adreem_investment_platforms,
  public.adreem_investment_holdings,
  public.adreem_investment_trades
to authenticated, service_role;

create or replace function public.adreem_entries_for_movement(p_movement jsonb)
returns table (entry_index smallint, account_id text, currency text, delta numeric(15, 0))
language plpgsql
immutable
security invoker
set search_path = ''
as $$
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
  if v_type in ('transfer', 'cash_deposit', 'cash_withdrawal', 'usd_sale', 'usd_purchase') and
     (v_source is null or v_destination is null or v_source = v_destination) then
    raise exception 'ADREEM_INVALID_MOVEMENT_ACCOUNTS' using errcode = '22023';
  end if;
  if v_type in ('expense', 'truck_expense', 'investment_deposit') and v_source is null then
    raise exception 'ADREEM_MOVEMENT_SOURCE_REQUIRED' using errcode = '22023';
  end if;
  if v_type in ('opening_balance', 'external_income', 'truck_income', 'correction', 'investment_withdrawal') and v_destination is null then
    raise exception 'ADREEM_MOVEMENT_DESTINATION_REQUIRED' using errcode = '22023';
  end if;
  if v_type = 'investment_deposit' and (v_currency <> 'USD' or v_destination is not null) then
    raise exception 'ADREEM_INVALID_INVESTMENT_DEPOSIT' using errcode = '22023';
  end if;
  if v_type = 'investment_withdrawal' and (v_currency <> 'USD' or v_source is not null) then
    raise exception 'ADREEM_INVALID_INVESTMENT_WITHDRAWAL' using errcode = '22023';
  end if;
  if (v_type = 'usd_sale' and v_currency <> 'USD') or (v_type = 'usd_purchase' and v_currency <> 'LYD') then
    raise exception 'ADREEM_INVALID_EXCHANGE_CURRENCY' using errcode = '22023';
  end if;

  case v_type
    when 'opening_balance', 'external_income', 'truck_income' then return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'expense', 'truck_expense', 'investment_deposit' then return query select 0::smallint, v_source, v_currency, -abs(round(v_amount));
    when 'investment_withdrawal' then return query select 0::smallint, v_destination, v_currency, abs(round(v_amount));
    when 'transfer', 'cash_deposit', 'cash_withdrawal' then
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

create or replace function public.adreem_apply_ledger_delta_v2(
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
      and (platform.record_id is null or movement.currency <> 'USD' or account.record_id is null or account.owner_id <> v_owner_id or account.account_type not in ('cash', 'bank'))
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
      and movement_total.movement_cash + trade_total.trade_cash < 0
  ) then
    raise exception 'ADREEM_INVESTMENT_CASH_NEGATIVE' using errcode = '23514';
  end if;

  return query select v_result.revision, v_result.updated_at;
end;
$$;

revoke all on function public.adreem_apply_ledger_delta_v2(uuid, bigint, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.adreem_apply_ledger_delta_v2(uuid, bigint, jsonb, uuid) to authenticated, service_role;
