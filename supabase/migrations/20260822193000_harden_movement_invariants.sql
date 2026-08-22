create or replace function public.adreem_entries_for_movement(p_movement jsonb)
returns table (
  entry_index smallint,
  account_id text,
  currency text,
  delta numeric(15, 0)
)
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
  if v_status <> 'posted' then
    return;
  end if;

  begin
    v_amount := nullif(p_movement ->> 'amount', '')::numeric;
    v_rate := nullif(p_movement ->> 'rate', '')::numeric;
  exception when invalid_text_representation then
    raise exception 'ADREEM_INVALID_MOVEMENT_NUMBER' using errcode = '22023';
  end;

  if v_amount is null or v_amount = 0 or v_amount <> trunc(v_amount) then
    raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
  end if;
  if v_currency not in ('LYD', 'USD') then
    raise exception 'ADREEM_INVALID_MOVEMENT_CURRENCY' using errcode = '22023';
  end if;
  if v_type not in ('opening_balance', 'correction') and v_amount < 0 then
    raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
  end if;
  if v_type = 'record_only' then
    if v_source is not null or v_destination is not null then
      raise exception 'ADREEM_RECORD_ONLY_ACCOUNTS_NOT_ALLOWED' using errcode = '22023';
    end if;
    if v_note = '' then
      raise exception 'ADREEM_RECORD_ONLY_NOTE_REQUIRED' using errcode = '22023';
    end if;
    return;
  end if;
  if v_type = 'correction' and v_note = '' then
    raise exception 'ADREEM_CORRECTION_NOTE_REQUIRED' using errcode = '22023';
  end if;
  if v_type in ('transfer', 'cash_deposit', 'cash_withdrawal', 'usd_sale', 'usd_purchase') and
     (v_source is null or v_destination is null or v_source = v_destination) then
    raise exception 'ADREEM_INVALID_MOVEMENT_ACCOUNTS' using errcode = '22023';
  end if;
  if v_type in ('expense', 'truck_expense') and v_source is null then
    raise exception 'ADREEM_MOVEMENT_SOURCE_REQUIRED' using errcode = '22023';
  end if;
  if v_type in ('opening_balance', 'external_income', 'truck_income', 'correction') and v_destination is null then
    raise exception 'ADREEM_MOVEMENT_DESTINATION_REQUIRED' using errcode = '22023';
  end if;
  if (v_type = 'usd_sale' and v_currency <> 'USD') or
     (v_type = 'usd_purchase' and v_currency <> 'LYD') then
    raise exception 'ADREEM_INVALID_EXCHANGE_CURRENCY' using errcode = '22023';
  end if;

  case v_type
    when 'opening_balance', 'external_income', 'truck_income' then
      return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'expense', 'truck_expense' then
      return query select 0::smallint, v_source, v_currency, -abs(round(v_amount));
    when 'transfer', 'cash_deposit', 'cash_withdrawal' then
      return query
        select 0::smallint, v_source, v_currency, -abs(round(v_amount))
        union all
        select 1::smallint, v_destination, v_currency, abs(round(v_amount));
    when 'usd_sale' then
      if v_rate is null or v_rate <= 0 then
        raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
      end if;
      if round(abs(v_amount) * v_rate) = 0 then
        raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023';
      end if;
      return query
        select 0::smallint, v_source, 'USD'::text, -abs(round(v_amount))
        union all
        select 1::smallint, v_destination, 'LYD'::text, round(abs(v_amount) * v_rate);
    when 'usd_purchase' then
      if v_rate is null or v_rate <= 0 then
        raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
      end if;
      if round(abs(v_amount) / v_rate) = 0 then
        raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023';
      end if;
      return query
        select 0::smallint, v_source, 'LYD'::text, -abs(round(v_amount))
        union all
        select 1::smallint, v_destination, 'USD'::text, round(abs(v_amount) / v_rate);
    when 'correction' then
      return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'record_only' then
      return;
    else
      raise exception 'ADREEM_UNKNOWN_MOVEMENT_TYPE' using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.adreem_entries_for_movement(jsonb) from public, anon, authenticated, service_role;

create or replace function adreem_private.protect_opening_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_account_merge boolean;
  v_payload_updated_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if old.movement_type = 'opening_balance' then
      raise exception 'ADREEM_OPENING_MOVEMENT_IMMUTABLE' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.movement_type = 'opening_balance' or new.movement_type = 'opening_balance' then
      begin
        v_payload_updated_at := nullif(new.payload ->> 'updatedAt', '')::timestamptz;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
        v_payload_updated_at := null;
      end;
      v_is_account_merge :=
        old.movement_type = 'opening_balance' and
        new.movement_type = old.movement_type and
        old.destination_account_id is distinct from new.destination_account_id and
        new.payload ->> 'destinationAccountId' = new.destination_account_id and
        new.payload ->> 'mergedFromAccountId' = old.destination_account_id and
        old.ledger_id is not distinct from new.ledger_id and
        old.owner_id is not distinct from new.owner_id and
        old.record_id is not distinct from new.record_id and
        old.status is not distinct from new.status and
        old.amount is not distinct from new.amount and
        old.currency is not distinct from new.currency and
        old.source_account_id is not distinct from new.source_account_id and
        old.rate is not distinct from new.rate and
        old.dimension_id is not distinct from new.dimension_id and
        old.expense_category_id is not distinct from new.expense_category_id and
        old.occurred_at is not distinct from new.occurred_at and
        old.created_at is not distinct from new.created_at and
        v_payload_updated_at is not null and
        new.payload - array['destinationAccountId', 'mergedFromAccountId', 'updatedAt'] =
          old.payload - array['destinationAccountId', 'mergedFromAccountId', 'updatedAt'];
      if v_is_account_merge then
        return new;
      end if;
      if old.payload is distinct from new.payload or
         old.ledger_id is distinct from new.ledger_id or
         old.owner_id is distinct from new.owner_id or
         old.record_id is distinct from new.record_id or
         old.movement_type is distinct from new.movement_type or
         old.status is distinct from new.status or
         old.amount is distinct from new.amount or
         old.currency is distinct from new.currency or
         old.source_account_id is distinct from new.source_account_id or
         old.destination_account_id is distinct from new.destination_account_id or
         old.rate is distinct from new.rate or
         old.dimension_id is distinct from new.dimension_id or
         old.expense_category_id is distinct from new.expense_category_id or
         old.occurred_at is distinct from new.occurred_at or
         old.created_at is distinct from new.created_at or
         old.updated_at is distinct from new.updated_at then
        raise exception 'ADREEM_OPENING_MOVEMENT_IMMUTABLE' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  if new.movement_type <> 'opening_balance' then
    return new;
  end if;
  if not exists (
    select 1
    from public.adreem_accounts as account
    where account.ledger_id = new.ledger_id
      and account.owner_id = new.owner_id
      and account.record_id = new.destination_account_id
      and account.created_at = transaction_timestamp()
      and new.status = 'posted'
      and new.source_account_id is null
      and new.currency in ('LYD', 'USD')
      and new.record_id = concat(
        'opening-',
        new.destination_account_id,
        case new.currency when 'USD' then '-usd' else '-dinar' end
      )
      and new.amount = case new.currency
        when 'USD' then coalesce(nullif(account.payload ->> 'openingUsd', '')::numeric, 0)
        else coalesce(nullif(account.payload ->> 'openingDinar', '')::numeric, 0)
      end
  ) then
    raise exception 'ADREEM_OPENING_MOVEMENT_MISMATCH' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.adreem_movements as movement
    where movement.ledger_id = new.ledger_id
      and movement.owner_id = new.owner_id
      and movement.destination_account_id = new.destination_account_id
      and movement.movement_type = 'opening_balance'
      and movement.currency = new.currency
  ) then
    raise exception 'ADREEM_OPENING_MOVEMENT_DUPLICATE' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists adreem_protect_opening_movement on public.adreem_movements;
create trigger adreem_protect_opening_movement
before insert or update or delete on public.adreem_movements
for each row execute function adreem_private.protect_opening_movement();

create or replace function adreem_private.protect_account_opening_amounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dinar numeric;
  v_usd numeric;
  v_old_dinar numeric;
  v_old_usd numeric;
  v_merge_target_id text;
  v_is_account_merge boolean := false;
begin
  begin
    v_dinar := coalesce(nullif(new.payload ->> 'openingDinar', '')::numeric, 0);
    v_usd := coalesce(nullif(new.payload ->> 'openingUsd', '')::numeric, 0);
    if tg_op = 'UPDATE' then
      v_old_dinar := coalesce(nullif(old.payload ->> 'openingDinar', '')::numeric, 0);
      v_old_usd := coalesce(nullif(old.payload ->> 'openingUsd', '')::numeric, 0);
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'ADREEM_INVALID_OPENING_AMOUNT' using errcode = '22023';
  end;

  if v_dinar <> trunc(v_dinar) or v_usd <> trunc(v_usd) or
     abs(v_dinar) > 999999999999999 or abs(v_usd) > 999999999999999 then
    raise exception 'ADREEM_INVALID_OPENING_AMOUNT' using errcode = '22023';
  end if;
  if (new.currency_kind = 'LYD' and v_usd <> 0) or
     (new.currency_kind = 'USD' and v_dinar <> 0) then
    raise exception 'ADREEM_OPENING_CURRENCY_MISMATCH' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (v_old_dinar is distinct from v_dinar or v_old_usd is distinct from v_usd) then
    v_merge_target_id := nullif(new.payload ->> 'mergedIntoAccountId', '');
    v_is_account_merge :=
      v_dinar = 0 and
      v_usd = 0 and
      v_merge_target_id is not null and
      v_merge_target_id <> new.record_id and
      new.status = 'inactive' and
      new.payload ->> 'status' = 'inactive' and
      new.balance_dinar = 0 and
      new.balance_usd = 0 and
      new.posted_count = 0 and
      new.structure_locked = true and
      old.ledger_id is not distinct from new.ledger_id and
      old.owner_id is not distinct from new.owner_id and
      old.record_id is not distinct from new.record_id and
      old.name is not distinct from new.name and
      old.account_type is not distinct from new.account_type and
      old.value_kind is not distinct from new.value_kind and
      old.currency_kind is not distinct from new.currency_kind and
      old.created_at is not distinct from new.created_at and
      new.payload - array['status', 'openingDinar', 'openingUsd', 'mergedIntoAccountId', 'disabledAt', 'updatedAt'] =
        old.payload - array['status', 'openingDinar', 'openingUsd', 'mergedIntoAccountId', 'disabledAt', 'updatedAt'] and
      not exists (
        select 1
        from public.adreem_movements as movement
        where movement.ledger_id = new.ledger_id
          and movement.owner_id = new.owner_id
          and movement.movement_type = 'opening_balance'
          and movement.destination_account_id = new.record_id
      ) and
      (v_old_dinar = 0 or exists (
        select 1
        from public.adreem_movements as movement
        where movement.ledger_id = new.ledger_id
          and movement.owner_id = new.owner_id
          and movement.record_id = concat('opening-', new.record_id, '-dinar')
          and movement.movement_type = 'opening_balance'
          and movement.currency = 'LYD'
          and movement.amount = v_old_dinar
          and movement.destination_account_id = v_merge_target_id
          and movement.payload ->> 'mergedFromAccountId' = new.record_id
      )) and
      (v_old_usd = 0 or exists (
        select 1
        from public.adreem_movements as movement
        where movement.ledger_id = new.ledger_id
          and movement.owner_id = new.owner_id
          and movement.record_id = concat('opening-', new.record_id, '-usd')
          and movement.movement_type = 'opening_balance'
          and movement.currency = 'USD'
          and movement.amount = v_old_usd
          and movement.destination_account_id = v_merge_target_id
          and movement.payload ->> 'mergedFromAccountId' = new.record_id
      ));
    if not v_is_account_merge then
      raise exception 'ADREEM_ACCOUNT_OPENING_IMMUTABLE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.protect_account_opening_amounts() from public, anon, authenticated, service_role;

create or replace function adreem_private.require_account_opening_movements()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_payload jsonb;
  v_dinar numeric;
  v_usd numeric;
begin
  select account.payload
  into v_current_payload
  from public.adreem_accounts as account
  where account.ledger_id = new.ledger_id
    and account.owner_id = new.owner_id
    and account.record_id = new.record_id;

  if not found then
    return new;
  end if;

  v_dinar := coalesce(nullif(v_current_payload ->> 'openingDinar', '')::numeric, 0);
  v_usd := coalesce(nullif(v_current_payload ->> 'openingUsd', '')::numeric, 0);
  if v_dinar <> 0 and not exists (
    select 1
    from public.adreem_movements as movement
    where movement.ledger_id = new.ledger_id
      and movement.owner_id = new.owner_id
      and movement.record_id = concat('opening-', new.record_id, '-dinar')
      and movement.movement_type = 'opening_balance'
      and movement.status = 'posted'
      and movement.amount = v_dinar
      and movement.currency = 'LYD'
      and movement.source_account_id is null
      and movement.destination_account_id = new.record_id
  ) then
    raise exception 'ADREEM_ACCOUNT_OPENING_MOVEMENT_REQUIRED' using errcode = '23514';
  end if;
  if v_usd <> 0 and not exists (
    select 1
    from public.adreem_movements as movement
    where movement.ledger_id = new.ledger_id
      and movement.owner_id = new.owner_id
      and movement.record_id = concat('opening-', new.record_id, '-usd')
      and movement.movement_type = 'opening_balance'
      and movement.status = 'posted'
      and movement.amount = v_usd
      and movement.currency = 'USD'
      and movement.source_account_id is null
      and movement.destination_account_id = new.record_id
  ) then
    raise exception 'ADREEM_ACCOUNT_OPENING_MOVEMENT_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.require_account_opening_movements() from public, anon, authenticated, service_role;

drop trigger if exists adreem_protect_account_opening_amounts on public.adreem_accounts;
create trigger adreem_protect_account_opening_amounts
before insert or update on public.adreem_accounts
for each row execute function adreem_private.protect_account_opening_amounts();

drop trigger if exists adreem_require_account_opening_movements on public.adreem_accounts;
create constraint trigger adreem_require_account_opening_movements
after insert or update on public.adreem_accounts
deferrable initially deferred
for each row execute function adreem_private.require_account_opening_movements();
