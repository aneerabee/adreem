\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$$;
create schema adreem_private;

create table public.adreem_accounts (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  account_type text not null constraint adreem_accounts_account_type_check check (account_type in ('person', 'cash', 'bank')),
  value_kind text not null constraint adreem_accounts_value_kind_check check (value_kind in ('receivable', 'cash', 'bank')),
  currency_kind text not null,
  balance_dinar numeric(15, 0) not null default 0,
  balance_usd numeric(15, 0) not null default 0,
  balance_try numeric(15, 0) not null default 0,
  balance_eur numeric(15, 0) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  constraint adreem_accounts_check check (
    (account_type = 'person' and value_kind = 'receivable') or
    (account_type = 'cash' and value_kind = 'cash') or
    (account_type = 'bank' and value_kind = 'bank')
  ),
  primary key (ledger_id, record_id)
);

create table public.adreem_movements (
  ledger_id uuid not null,
  owner_id uuid not null,
  record_id text not null,
  movement_type text not null constraint adreem_movements_movement_type_check check (movement_type in ('opening_balance', 'transfer')),
  status text not null,
  amount numeric(15, 0) not null,
  currency text not null,
  source_account_id text,
  destination_account_id text,
  primary key (ledger_id, record_id)
);

\ir ../migrations/20260926090000_add_credit_cards.sql

create procedure public.expect_card_error(p_statement text, p_expected text)
language plpgsql as $$
begin
  begin
    execute p_statement;
    raise exception 'ADREEM_TEST_EXPECTED_ERROR';
  exception when others then
    if sqlerrm = 'ADREEM_TEST_EXPECTED_ERROR' or position(p_expected in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

insert into public.adreem_accounts (ledger_id, owner_id, record_id, account_type, value_kind, currency_kind, balance_dinar, balance_usd, payload)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'card', 'credit_card', 'credit_card', 'multi', -300, -20, '{"cardCurrencies":["LYD","USD"]}'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'person', 'person', 'receivable', 'LYD', 200, 0, '{}'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'cash', 'cash', 'cash', 'LYD', 1000, 0, '{}');

insert into public.adreem_movements (ledger_id, owner_id, record_id, movement_type, status, amount, currency, source_account_id, destination_account_id)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'charge', 'card_charge', 'posted', 200, 'LYD', 'card', 'person'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'direct', 'card_payment', 'posted', 100, 'LYD', 'person', 'card'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'own', 'card_payment', 'posted', 50, 'LYD', 'cash', 'card');

do $$
begin
  if (select count(*) from public.adreem_entries_for_movement('{"type":"card_charge","status":"posted","amount":200,"currency":"LYD","sourceAccountId":"card","destinationAccountId":"person"}'::jsonb)) <> 2 then
    raise exception 'ADREEM_TEST_POSTINGS_MISSING';
  end if;
end;
$$;

call public.expect_card_error(
  $$insert into public.adreem_movements values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'wrong-route', 'card_charge', 'posted', 10, 'LYD', 'card', 'cash')$$,
  'ADREEM_INVALID_CARD_CHARGE_ROUTE'
);
call public.expect_card_error(
  $$insert into public.adreem_movements values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'wrong-currency', 'card_charge', 'posted', 10, 'EUR', 'card', 'person')$$,
  'ADREEM_INVALID_CARD_CURRENCY'
);
call public.expect_card_error(
  $$insert into public.adreem_movements values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'wrong-transfer', 'transfer', 'posted', 10, 'LYD', 'card', 'person')$$,
  'ADREEM_CARD_MOVEMENT_REQUIRED'
);
update public.adreem_accounts set balance_dinar = -1 where record_id = 'person';
call public.expect_card_error(
  $$insert into public.adreem_movements values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'excess-direct', 'card_payment', 'posted', 201, 'LYD', 'person', 'card')$$,
  'ADREEM_CARD_PAYMENT_EXCEEDS_RECEIVABLE'
);
update public.adreem_accounts set balance_dinar = 100 where record_id = 'person';
call public.expect_card_error(
  $$update public.adreem_accounts set balance_dinar = 1 where record_id = 'card'$$,
  'adreem_credit_card_nonpositive_check'
);
call public.expect_card_error(
  $$update public.adreem_accounts set payload = '{"cardCurrencies":["USD"]}' where record_id = 'card'$$,
  'ADREEM_CARD_CURRENCIES_IMMUTABLE'
);
call public.expect_card_error(
  $$update public.adreem_accounts set balance_eur = -1 where record_id = 'card'$$,
  'ADREEM_INVALID_CARD_CURRENCY'
);
call public.expect_card_error(
  $$insert into public.adreem_movements values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'wrong-opening', 'opening_balance', 'posted', -5, 'EUR', null, 'card')$$,
  'ADREEM_INVALID_CARD_CURRENCY'
);

select 'credit card database checks passed' as result;
