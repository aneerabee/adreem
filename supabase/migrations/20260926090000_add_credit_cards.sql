-- Credit-card debt is separate from owned bank money and from counterparty balances.
alter table public.adreem_accounts
  drop constraint if exists adreem_accounts_account_type_check,
  drop constraint if exists adreem_accounts_value_kind_check,
  drop constraint if exists adreem_accounts_check;

alter table public.adreem_accounts
  add constraint adreem_accounts_account_type_check check (account_type in ('person', 'cash', 'bank', 'credit_card', 'expense', 'asset', 'project', 'summary', 'review')),
  add constraint adreem_accounts_value_kind_check check (value_kind in ('cash', 'bank', 'credit_card', 'receivable', 'expense', 'asset', 'project', 'summary', 'review')),
  add constraint adreem_accounts_type_kind_check check (
    (account_type = 'person' and value_kind = 'receivable') or
    (account_type = 'cash' and value_kind = 'cash') or
    (account_type = 'bank' and value_kind = 'bank') or
    (account_type = 'credit_card' and value_kind = 'credit_card') or
    (account_type = 'expense' and value_kind = 'expense') or
    (account_type = 'asset' and value_kind = 'asset') or
    (account_type = 'project' and value_kind = 'project') or
    (account_type = 'summary' and value_kind = 'summary') or
    (account_type = 'review' and value_kind = 'review')
  ),
  add constraint adreem_credit_card_nonpositive_check check (
    value_kind <> 'credit_card' or
    (balance_dinar <= 0 and balance_usd <= 0 and balance_try <= 0 and balance_eur <= 0)
  );

alter table public.adreem_movements
  drop constraint if exists adreem_movements_movement_type_check;
alter table public.adreem_movements
  add constraint adreem_movements_movement_type_check check (movement_type in (
    'opening_balance', 'transfer', 'cash_deposit', 'cash_withdrawal',
    'expense', 'truck_expense', 'truck_income', 'usd_sale',
    'usd_purchase', 'external_income', 'correction', 'record_only',
    'investment_deposit', 'investment_withdrawal', 'card_charge', 'card_payment'
  ));

create or replace function adreem_private.validate_credit_card_account()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_currencies jsonb := new.payload -> 'cardCurrencies';
  v_count integer;
  v_invalid_count integer;
begin
  if tg_op = 'UPDATE' and (old.account_type = 'credit_card' or new.account_type = 'credit_card') and
    (old.account_type is distinct from new.account_type or old.value_kind is distinct from new.value_kind or
     old.currency_kind is distinct from new.currency_kind or
     old.payload -> 'cardCurrencies' is distinct from new.payload -> 'cardCurrencies') then
    raise exception 'ADREEM_CARD_CURRENCIES_IMMUTABLE' using errcode = '23514';
  end if;
  if new.account_type <> 'credit_card' and new.value_kind <> 'credit_card' then return new; end if;
  if new.account_type <> 'credit_card' or new.value_kind <> 'credit_card' or
    jsonb_typeof(v_currencies) is distinct from 'array' or
    jsonb_array_length(v_currencies) not between 1 and 4 then
    raise exception 'ADREEM_INVALID_CARD_CURRENCIES' using errcode = '23514';
  end if;
  select count(distinct currency), count(*) filter (where currency not in ('LYD', 'USD', 'TRY', 'EUR'))
  into v_count, v_invalid_count
  from jsonb_array_elements_text(v_currencies) as item(currency);
  if v_invalid_count <> 0 or v_count <> jsonb_array_length(v_currencies) or
    new.currency_kind <> (case when v_count = 1 then v_currencies ->> 0 else 'multi' end) then
    raise exception 'ADREEM_INVALID_CARD_CURRENCIES' using errcode = '23514';
  end if;
  if (new.balance_dinar <> 0 and not v_currencies ? 'LYD') or
     (new.balance_usd <> 0 and not v_currencies ? 'USD') or
     (new.balance_try <> 0 and not v_currencies ? 'TRY') or
     (new.balance_eur <> 0 and not v_currencies ? 'EUR') then
    raise exception 'ADREEM_INVALID_CARD_CURRENCY' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.validate_credit_card_account() from public, anon, authenticated, service_role;
create trigger adreem_validate_credit_card_account
before insert or update on public.adreem_accounts
for each row execute function adreem_private.validate_credit_card_account();

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

create or replace function adreem_private.validate_credit_card_movement()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_source public.adreem_accounts%rowtype;
  v_destination public.adreem_accounts%rowtype;
  v_card public.adreem_accounts%rowtype;
  v_available numeric;
  v_amount numeric;
begin
  if new.status <> 'posted' then return new; end if;
  if new.source_account_id is not null then
    select * into v_source from public.adreem_accounts where ledger_id = new.ledger_id and owner_id = new.owner_id and record_id = new.source_account_id;
  end if;
  if new.destination_account_id is not null then
    select * into v_destination from public.adreem_accounts where ledger_id = new.ledger_id and owner_id = new.owner_id and record_id = new.destination_account_id;
  end if;
  if new.movement_type not in ('card_charge', 'card_payment', 'opening_balance') and
    (v_source.value_kind = 'credit_card' or v_destination.value_kind = 'credit_card') then
    raise exception 'ADREEM_CARD_MOVEMENT_REQUIRED' using errcode = '23514';
  end if;
  if new.movement_type = 'opening_balance' and v_destination.value_kind = 'credit_card' then
    if new.amount >= 0 then
      raise exception 'ADREEM_CARD_OPENING_MUST_BE_DEBT' using errcode = '23514';
    end if;
    if not (v_destination.payload -> 'cardCurrencies' ? new.currency) then
      raise exception 'ADREEM_INVALID_CARD_CURRENCY' using errcode = '23514';
    end if;
  end if;
  if new.movement_type not in ('card_charge', 'card_payment') then return new; end if;
  if new.movement_type = 'card_charge' then
    v_card := v_source;
    if v_source.value_kind <> 'credit_card' or v_destination.value_kind <> 'receivable' then
      raise exception 'ADREEM_INVALID_CARD_CHARGE_ROUTE' using errcode = '23514';
    end if;
  else
    v_card := v_destination;
    if v_destination.value_kind <> 'credit_card' or v_source.value_kind not in ('cash', 'bank', 'receivable') then
      raise exception 'ADREEM_INVALID_CARD_PAYMENT_ROUTE' using errcode = '23514';
    end if;
  end if;
  if v_card.currency_kind not in (new.currency, 'multi') or
    not (v_card.payload -> 'cardCurrencies' ? new.currency) or
    v_source.currency_kind not in (new.currency, 'multi') or
    v_destination.currency_kind not in (new.currency, 'multi') then
    raise exception 'ADREEM_INVALID_CARD_CURRENCY' using errcode = '23514';
  end if;
  if new.movement_type = 'card_payment' and v_source.value_kind = 'receivable' then
    v_available := case new.currency
      when 'LYD' then v_source.balance_dinar when 'USD' then v_source.balance_usd
      when 'TRY' then v_source.balance_try else v_source.balance_eur end;
    -- The ledger delta updates account balances before inserting the movement row.
    if v_available < 0 then
      raise exception 'ADREEM_CARD_PAYMENT_EXCEEDS_RECEIVABLE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.validate_credit_card_movement() from public, anon, authenticated, service_role;
create trigger adreem_validate_credit_card_movement
before insert or update on public.adreem_movements
for each row execute function adreem_private.validate_credit_card_movement();
