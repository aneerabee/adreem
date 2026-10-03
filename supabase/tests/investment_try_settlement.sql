\set ON_ERROR_STOP on
-- Run only on a disposable database with migrations through 20261003090000 applied.
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create procedure pg_temp.expect_investment_error(p_statement text, p_expected text)
language plpgsql as $$
begin
  begin
    execute p_statement;
    set constraints all immediate;
    raise exception 'ADREEM_TEST_EXPECTED_ERROR';
  exception when others then
    if sqlerrm = 'ADREEM_TEST_EXPECTED_ERROR' or position(p_expected in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$$;

insert into auth.users (id, email, raw_app_meta_data)
values ('22222222-2222-4222-8222-222222222222', 'investment-test@invalid.local',
  '{"adreem_member":true,"adreem_disabled":false}');

insert into public.adreem_investment_platforms
  (ledger_id, owner_id, record_id, name, kind, status, payload)
select ledger.id, ledger.owner_id, platform.id, platform.id, 'platform', 'active', '{}'::jsonb
from public.adreem_ledgers as ledger
cross join (values ('platform'), ('other-platform')) as platform(id)
where ledger.owner_id = '22222222-2222-4222-8222-222222222222';

insert into public.adreem_accounts
  (ledger_id, owner_id, record_id, name, account_type, value_kind,
   currency_kind, balance_usd, balance_try, payload)
select ledger.id, ledger.owner_id, account.id, account.id, 'cash', 'cash',
  account.currency, account.usd, account.lira, '{}'::jsonb
from public.adreem_ledgers as ledger
cross join (values ('cash-usd', 'USD', 1000::numeric, 0::numeric),
  ('cash-try', 'TRY', 0::numeric, 1000::numeric))
  as account(id, currency, usd, lira)
where ledger.owner_id = '22222222-2222-4222-8222-222222222222';

insert into public.adreem_investment_holdings
  (ledger_id, owner_id, record_id, platform_id, name, symbol, asset_type,
   quote_currency, status, payload)
select ledger.id, ledger.owner_id, holding.id, 'platform', holding.id,
  holding.symbol, 'stock', holding.currency, 'active', jsonb_build_object(
    'platformId', 'platform', 'symbol', holding.symbol, 'assetType', 'stock',
    'quoteCurrency', holding.currency, 'status', 'active',
    'providerSymbol', holding.symbol, 'lastPriceUsdMicros', 1000000,
    'lastPriceNativeMicros', 1000000)
from public.adreem_ledgers as ledger
cross join (values ('usd', 'OLD', 'USD'), ('try', 'TRYX', 'TRY'))
  as holding(id, symbol, currency)
where ledger.owner_id = '22222222-2222-4222-8222-222222222222';

insert into public.adreem_movements
  (ledger_id, owner_id, record_id, movement_type, status, amount, currency,
   source_account_id, payload)
select ledger.id, ledger.owner_id, movement.id, 'investment_deposit', 'posted',
  movement.amount, movement.currency, movement.account_id,
  jsonb_build_object('investmentPlatformId', 'platform')
from public.adreem_ledgers as ledger
cross join (values ('fund-usd', 100::numeric, 'USD', 'cash-usd'),
  ('fund-try', 100::numeric, 'TRY', 'cash-try'))
  as movement(id, amount, currency, account_id)
where ledger.owner_id = '22222222-2222-4222-8222-222222222222';

insert into public.adreem_investment_trades
  (ledger_id, owner_id, record_id, platform_id, holding_id, trade_type, status,
   quantity_units, price_usd_micros, fee_usd_micros, payload)
select ledger.id, ledger.owner_id, trade.id, 'platform', trade.holding,
  'buy', 'active', 100000000, trade.price_usd, trade.fee_usd, trade.payload
from public.adreem_ledgers as ledger
cross join (values
  ('old-usd', 'usd', 10000000::bigint, 0::bigint,
    '{"quantityUnits":100000000,"priceUsdMicros":10000000,"feeUsdMicros":0}'::jsonb),
  ('settled-try', 'try', 10000000::bigint, 1000000::bigint,
    '{"settlementCurrency":"TRY","quantityUnits":100000000,"priceNativeMicros":300000000,"feeNativeMicros":30000000,"fxTryPerUsdMicros":30000000,"priceUsdMicros":10000000,"feeUsdMicros":1000000}'::jsonb)
) as trade(id, holding, price_usd, fee_usd, payload)
where ledger.owner_id = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_ledger uuid;
begin
  select id into v_ledger from public.adreem_ledgers
  where owner_id = '22222222-2222-4222-8222-222222222222';
  if adreem_private.investment_cash_micros(v_ledger,
    '22222222-2222-4222-8222-222222222222', 'platform', 'USD') <> 90000000
    or adreem_private.investment_cash_micros(v_ledger,
      '22222222-2222-4222-8222-222222222222', 'platform', 'TRY') <> -230000000 then
    raise exception 'ADREEM_TEST_CURRENCY_CASH_MISMATCH';
  end if;
  if (select delta from public.adreem_entries_for_movement(
    '{"type":"investment_deposit","status":"posted","amount":5,"currency":"TRY","sourceAccountId":"source"}'::jsonb)) <> -5 then
    raise exception 'ADREEM_TEST_TRY_POSTING_MISSING';
  end if;
end;
$$;

call pg_temp.expect_investment_error(
  $$select * from public.adreem_entries_for_movement('{"type":"investment_deposit","status":"posted","amount":5,"currency":"EUR","sourceAccountId":"source"}'::jsonb)$$,
  'ADREEM_INVALID_INVESTMENT_DEPOSIT');

call pg_temp.expect_investment_error(
  $$select adreem_private.require_investment_cash((select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'), '22222222-2222-4222-8222-222222222222', 'ADREEM_TEST_NEGATIVE_CASH')$$,
  'ADREEM_TEST_NEGATIVE_CASH');

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  0,
  '{"movements":[{"id":"fund-more-try","type":"investment_deposit","status":"posted","amount":300,"currency":"TRY","sourceAccountId":"cash-try","investmentPlatformId":"platform","createdAt":"2026-10-03T00:00:00Z"}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  1,
  '{"movements":[{"id":"withdraw-try","type":"investment_withdrawal","status":"posted","amount":50,"currency":"TRY","destinationAccountId":"cash-try","investmentPlatformId":"platform","createdAt":"2026-10-03T00:00:00Z"}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  2,
  '{"investmentTrades":[{"id":"rpc-try-trade","platformId":"platform","holdingId":"try","type":"buy","status":"active","quantityUnits":50000000,"priceNativeMicros":30000000,"feeNativeMicros":3000000,"fxTryPerUsdMicros":30000000,"priceUsdMicros":1000000,"feeUsdMicros":100000,"settlementCurrency":"TRY","occurredAt":"2026-10-03T00:00:00Z","createdAt":"2026-10-03T00:00:00Z","updatedAt":"2026-10-03T00:00:00Z"}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

do $$
begin
  if adreem_private.investment_cash_micros(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
    '22222222-2222-4222-8222-222222222222', 'platform', 'TRY') <> 2000000 then
    raise exception 'ADREEM_TEST_TRY_TRADE_CASH_MISMATCH';
  end if;
end;
$$;

call pg_temp.expect_investment_error(
  $$select * from public.adreem_apply_ledger_delta_v2(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'), 3,
    '{"investmentTrades":[{"id":"rpc-try-trade","platformId":"platform","holdingId":"try","type":"buy","status":"active","quantityUnits":50000000,"priceNativeMicros":30000000,"feeNativeMicros":3000001,"fxTryPerUsdMicros":30000000,"priceUsdMicros":1000000,"feeUsdMicros":100000,"settlementCurrency":"TRY","occurredAt":"2026-10-03T00:00:00Z","createdAt":"2026-10-03T00:00:00Z","updatedAt":"2026-10-03T01:00:00Z"}]}'::jsonb,
    '22222222-2222-4222-8222-222222222222')$$,
  'ADREEM_INVESTMENT_TRADE_AUDIT_REQUIRED');

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  3,
  '{"investmentTrades":[{"id":"rpc-try-trade","platformId":"platform","holdingId":"try","type":"buy","status":"active","quantityUnits":50000000,"priceNativeMicros":30000000,"feeNativeMicros":3000001,"fxTryPerUsdMicros":30000000,"priceUsdMicros":1000000,"feeUsdMicros":100000,"settlementCurrency":"TRY","occurredAt":"2026-10-03T00:00:00Z","createdAt":"2026-10-03T00:00:00Z","updatedAt":"2026-10-03T01:00:00Z"}],"auditEvents":[{"id":"audit-try-fee","action":"investment.trade.updated","createdAt":"2026-10-03T01:00:00Z","details":{"tradeId":"rpc-try-trade","holdingId":"try","platformId":"platform","before":{"quantityUnits":50000000,"priceUsdMicros":1000000,"feeUsdMicros":100000,"feeNativeMicros":3000000,"settlementCurrency":"TRY","note":""},"after":{"quantityUnits":50000000,"priceUsdMicros":1000000,"feeUsdMicros":100000,"feeNativeMicros":3000001,"settlementCurrency":"TRY","note":""},"priceNativeBeforeMicros":30000000,"priceNativeAfterMicros":30000000,"fxTryPerUsdMicros":30000000}}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  4,
  '{"investmentTrades":[{"id":"rpc-try-sell","platformId":"platform","holdingId":"try","type":"sell","status":"active","quantityUnits":10000000,"priceNativeMicros":30000000,"feeNativeMicros":1000000,"fxTryPerUsdMicros":30000000,"priceUsdMicros":1000000,"feeUsdMicros":33333,"settlementCurrency":"TRY","occurredAt":"2026-10-03T02:00:00Z","createdAt":"2026-10-03T02:00:00Z","updatedAt":"2026-10-03T02:00:00Z"}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

do $$
begin
  if adreem_private.investment_cash_micros(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
    '22222222-2222-4222-8222-222222222222', 'platform', 'TRY') <> 3999999 then
    raise exception 'ADREEM_TEST_TRY_SELL_CASH_MISMATCH';
  end if;
end;
$$;

select * from public.adreem_apply_ledger_delta_v2(
  (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
  5,
  '{"investmentTrades":[{"id":"legacy-try-quote","platformId":"platform","holdingId":"try","type":"buy","status":"active","quantityUnits":10000000,"priceNativeMicros":30000000,"fxTryPerUsdMicros":30000000,"priceUsdMicros":1000000,"feeUsdMicros":0,"occurredAt":"2026-10-03T03:00:00Z","createdAt":"2026-10-03T03:00:00Z","updatedAt":"2026-10-03T03:00:00Z"}]}'::jsonb,
  '22222222-2222-4222-8222-222222222222');

do $$
begin
  if adreem_private.investment_cash_micros(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
    '22222222-2222-4222-8222-222222222222', 'platform', 'TRY') <> 3999999
    or adreem_private.investment_cash_micros(
      (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'),
      '22222222-2222-4222-8222-222222222222', 'platform', 'USD') <> 89900000 then
    raise exception 'ADREEM_TEST_LEGACY_USD_CASH_MISMATCH';
  end if;
end;
$$;

call pg_temp.expect_investment_error(
  $$select * from public.adreem_apply_ledger_delta_v2(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'), 6,
    '{"movements":[{"id":"overdraw-usd","type":"investment_withdrawal","status":"posted","amount":95,"currency":"USD","destinationAccountId":"cash-usd","investmentPlatformId":"platform","createdAt":"2026-10-03T00:00:00Z"}]}'::jsonb,
    '22222222-2222-4222-8222-222222222222')$$,
  'ADREEM_INVESTMENT_CASH_NEGATIVE');

call pg_temp.expect_investment_error(
  $$select * from public.adreem_apply_ledger_delta_v2(
    (select id from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'), 6,
    '{"movements":[{"id":"overdraw-try","type":"investment_withdrawal","status":"posted","amount":5,"currency":"TRY","destinationAccountId":"cash-try","investmentPlatformId":"platform","createdAt":"2026-10-03T00:00:00Z"}]}'::jsonb,
    '22222222-2222-4222-8222-222222222222')$$,
  'ADREEM_INVESTMENT_CASH_NEGATIVE');

call pg_temp.expect_investment_error(
  $$insert into public.adreem_investment_transfers
    (ledger_id, owner_id, record_id, from_platform_id, to_platform_id, asset,
     status, amount_usd_micros, occurred_at, created_at, payload)
    select id, owner_id, 'overdraw-transfer', 'platform', 'other-platform',
      'USD', 'active', 95000000, now(), now(),
      '{"id":"overdraw-transfer","asset":"USD","fromPlatformId":"platform","toPlatformId":"other-platform","status":"active"}'::jsonb
    from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'$$,
  'ADREEM_INVESTMENT_TRANSFER_CASH_NEGATIVE');

call pg_temp.expect_investment_error(
  $$update public.adreem_investment_trades set payload = payload || '{"settlementCurrency":"TRY","updatedAt":"2026-10-03T00:00:00Z"}'::jsonb where record_id = 'old-usd'$$,
  'ADREEM_INVESTMENT_TRADE_PAYLOAD_IMMUTABLE');

call pg_temp.expect_investment_error(
  $$insert into public.adreem_investment_trades
    (ledger_id, owner_id, record_id, platform_id, holding_id, trade_type, status,
     quantity_units, price_usd_micros, fee_usd_micros, payload)
    select id, owner_id, 'wrong-fx', 'platform', 'try', 'buy', 'active',
      100000000, 10000000, 0,
      '{"settlementCurrency":"TRY","priceNativeMicros":300000000,"feeNativeMicros":0,"fxTryPerUsdMicros":20000000}'::jsonb
    from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'$$,
  'ADREEM_INVALID_INVESTMENT_SETTLEMENT');

call pg_temp.expect_investment_error(
  $$insert into public.adreem_investment_trades
    (ledger_id, owner_id, record_id, platform_id, holding_id, trade_type, status,
     quantity_units, price_usd_micros, fee_usd_micros, payload)
    select id, owner_id, 'wrong-holding', 'platform', 'usd', 'buy', 'active',
      100000000, 10000000, 0,
      '{"settlementCurrency":"TRY","priceNativeMicros":300000000,"feeNativeMicros":0,"fxTryPerUsdMicros":30000000}'::jsonb
    from public.adreem_ledgers where owner_id = '22222222-2222-4222-8222-222222222222'$$,
  'ADREEM_INVALID_INVESTMENT_SETTLEMENT');

select 'investment currency database checks passed' as result;
rollback;
