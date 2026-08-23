-- Add TRY as a fully posted ADREEM currency without rewriting existing rows.

alter table public.adreem_accounts
  add column if not exists balance_try numeric(15, 0) not null default 0;

alter table public.adreem_accounts
  drop constraint if exists adreem_accounts_currency_kind_check;
alter table public.adreem_accounts
  add constraint adreem_accounts_currency_kind_check check (currency_kind in ('LYD', 'USD', 'TRY', 'multi'));
alter table public.adreem_accounts
  drop constraint if exists adreem_accounts_nonnegative_try_check;
alter table public.adreem_accounts
  add constraint adreem_accounts_nonnegative_try_check check (
    value_kind not in ('cash', 'bank', 'asset') or balance_try >= 0
  );

alter table public.adreem_movements
  drop constraint if exists adreem_movements_currency_check;
alter table public.adreem_movements
  add constraint adreem_movements_currency_check check (currency is null or currency in ('LYD', 'USD', 'TRY'));

alter table public.adreem_movement_entries
  drop constraint if exists adreem_movement_entries_currency_check;
alter table public.adreem_movement_entries
  add constraint adreem_movement_entries_currency_check check (currency in ('LYD', 'USD', 'TRY'));

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
  if v_currency not in ('LYD', 'USD', 'TRY') then
    raise exception 'ADREEM_INVALID_MOVEMENT_CURRENCY' using errcode = '22023';
  end if;
  if v_type not in ('opening_balance', 'correction') and v_amount < 0 then
    raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
  end if;
  if v_type = 'record_only' then
    if v_source is not null or v_destination is not null then
      raise exception 'ADREEM_RECORD_ONLY_ACCOUNTS_NOT_ALLOWED' using errcode = '22023';
    end if;
    if v_note = '' then raise exception 'ADREEM_RECORD_ONLY_NOTE_REQUIRED' using errcode = '22023'; end if;
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
  if (v_type = 'usd_sale' and v_currency <> 'USD') or (v_type = 'usd_purchase' and v_currency <> 'LYD') then
    raise exception 'ADREEM_INVALID_EXCHANGE_CURRENCY' using errcode = '22023';
  end if;

  case v_type
    when 'opening_balance', 'external_income', 'truck_income' then
      return query select 0::smallint, v_destination, v_currency, round(v_amount);
    when 'expense', 'truck_expense' then
      return query select 0::smallint, v_source, v_currency, -abs(round(v_amount));
    when 'transfer', 'cash_deposit', 'cash_withdrawal' then
      return query select 0::smallint, v_source, v_currency, -abs(round(v_amount))
        union all select 1::smallint, v_destination, v_currency, abs(round(v_amount));
    when 'usd_sale' then
      if v_rate is null or v_rate <= 0 then
        raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
      end if;
      if round(abs(v_amount) * v_rate) = 0 then
        raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023';
      end if;
      return query select 0::smallint, v_source, 'USD'::text, -abs(round(v_amount))
        union all select 1::smallint, v_destination, 'LYD'::text, round(abs(v_amount) * v_rate);
    when 'usd_purchase' then
      if v_rate is null or v_rate <= 0 then
        raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
      end if;
      if round(abs(v_amount) / v_rate) = 0 then
        raise exception 'ADREEM_EXCHANGE_RESULT_TOO_SMALL' using errcode = '22023';
      end if;
      return query select 0::smallint, v_source, 'LYD'::text, -abs(round(v_amount))
        union all select 1::smallint, v_destination, 'USD'::text, round(abs(v_amount) / v_rate);
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

create or replace function adreem_private.sync_try_entry_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.currency = 'TRY' then
    update public.adreem_accounts
    set balance_try = balance_try - old.delta
    where ledger_id = old.ledger_id and owner_id = old.owner_id and record_id = old.account_id;
  end if;
  if tg_op = 'INSERT' and new.currency = 'TRY' then
    begin
      update public.adreem_accounts
      set balance_try = balance_try + new.delta
      where ledger_id = new.ledger_id and owner_id = new.owner_id and record_id = new.account_id;
    exception when check_violation then
      raise exception 'ADREEM_NEGATIVE_OWN_BALANCE' using errcode = '23514';
    end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function adreem_private.sync_try_entry_balance() from public, anon, authenticated, service_role;
drop trigger if exists adreem_sync_try_entry_balance on public.adreem_movement_entries;
create trigger adreem_sync_try_entry_balance
after insert or delete on public.adreem_movement_entries
for each row execute function adreem_private.sync_try_entry_balance();

create or replace function adreem_private.sync_try_entry_balance_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  begin
    with changes as (
      select row.ledger_id, row.owner_id, row.account_id, -row.delta as delta
      from old_try_entries as row
      where row.currency = 'TRY'
      union all
      select row.ledger_id, row.owner_id, row.account_id, row.delta
      from new_try_entries as row
      where row.currency = 'TRY'
    ), net as (
      select change.ledger_id, change.owner_id, change.account_id, sum(change.delta) as delta
      from changes as change
      group by change.ledger_id, change.owner_id, change.account_id
    )
    update public.adreem_accounts as account
    set balance_try = account.balance_try + net.delta
    from net
    where account.ledger_id = net.ledger_id
      and account.owner_id = net.owner_id
      and account.record_id = net.account_id
      and net.delta <> 0;
  exception when check_violation then
    raise exception 'ADREEM_NEGATIVE_OWN_BALANCE' using errcode = '23514';
  end;
  return null;
end;
$$;

revoke all on function adreem_private.sync_try_entry_balance_update() from public, anon, authenticated, service_role;
drop trigger if exists adreem_sync_try_entry_balance_update on public.adreem_movement_entries;
create trigger adreem_sync_try_entry_balance_update
after update on public.adreem_movement_entries
referencing old table as old_try_entries new table as new_try_entries
for each statement execute function adreem_private.sync_try_entry_balance_update();

create or replace function adreem_private.protect_account_try_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.balance_try <> 0 then
    raise exception 'ADREEM_ACCOUNT_DELETE_IN_USE' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'inactive' and new.balance_try <> 0 then
    raise exception 'ADREEM_NONZERO_ACCOUNT_CANNOT_BE_DISABLED' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists adreem_protect_account_try_lifecycle on public.adreem_accounts;
create trigger adreem_protect_account_try_lifecycle
before update or delete on public.adreem_accounts
for each row execute function adreem_private.protect_account_try_lifecycle();

create or replace function adreem_private.protect_opening_movement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_account_merge boolean;
  v_payload_updated_at timestamptz;
  v_suffix text;
  v_field text;
begin
  if tg_op = 'DELETE' then
    if old.movement_type = 'opening_balance' then
      raise exception 'ADREEM_OPENING_MOVEMENT_IMMUTABLE' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.movement_type = 'opening_balance' or new.movement_type = 'opening_balance') then
    begin
      v_payload_updated_at := nullif(new.payload ->> 'updatedAt', '')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      v_payload_updated_at := null;
    end;
    v_is_account_merge :=
      old.movement_type = 'opening_balance' and new.movement_type = old.movement_type and
      old.destination_account_id is distinct from new.destination_account_id and
      new.payload ->> 'destinationAccountId' = new.destination_account_id and
      new.payload ->> 'mergedFromAccountId' = old.destination_account_id and
      old.ledger_id is not distinct from new.ledger_id and old.owner_id is not distinct from new.owner_id and
      old.record_id is not distinct from new.record_id and old.status is not distinct from new.status and
      old.amount is not distinct from new.amount and old.currency is not distinct from new.currency and
      old.source_account_id is not distinct from new.source_account_id and old.rate is not distinct from new.rate and
      old.dimension_id is not distinct from new.dimension_id and old.expense_category_id is not distinct from new.expense_category_id and
      old.occurred_at is not distinct from new.occurred_at and old.created_at is not distinct from new.created_at and
      v_payload_updated_at is not null and
      new.payload - array['destinationAccountId', 'mergedFromAccountId', 'updatedAt'] =
        old.payload - array['destinationAccountId', 'mergedFromAccountId', 'updatedAt'];
    if v_is_account_merge then return new; end if;
    if old is distinct from new then raise exception 'ADREEM_OPENING_MOVEMENT_IMMUTABLE' using errcode = '23514'; end if;
    return new;
  end if;
  if new.movement_type <> 'opening_balance' then return new; end if;
  v_suffix := case new.currency when 'USD' then 'usd' when 'TRY' then 'try' else 'dinar' end;
  v_field := case new.currency when 'USD' then 'openingUsd' when 'TRY' then 'openingTry' else 'openingDinar' end;
  if not exists (
    select 1 from public.adreem_accounts account
    where account.ledger_id = new.ledger_id and account.owner_id = new.owner_id
      and account.record_id = new.destination_account_id and account.created_at = transaction_timestamp()
      and new.status = 'posted' and new.source_account_id is null
      and new.currency in ('LYD', 'USD', 'TRY')
      and new.record_id = concat('opening-', new.destination_account_id, '-', v_suffix)
      and new.amount = coalesce(nullif(account.payload ->> v_field, '')::numeric, 0)
  ) then
    raise exception 'ADREEM_OPENING_MOVEMENT_MISMATCH' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.adreem_movements movement
    where movement.ledger_id = new.ledger_id and movement.owner_id = new.owner_id
      and movement.destination_account_id = new.destination_account_id
      and movement.movement_type = 'opening_balance' and movement.currency = new.currency
  ) then
    raise exception 'ADREEM_OPENING_MOVEMENT_DUPLICATE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function adreem_private.protect_account_opening_try()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_try numeric := coalesce(nullif(new.payload ->> 'openingTry', '')::numeric, 0);
  v_old_try numeric := case when tg_op = 'UPDATE' then coalesce(nullif(old.payload ->> 'openingTry', '')::numeric, 0) else 0 end;
  v_merge_target text := nullif(new.payload ->> 'mergedIntoAccountId', '');
begin
  if v_try <> trunc(v_try) or abs(v_try) > 999999999999999 then
    raise exception 'ADREEM_INVALID_OPENING_AMOUNT' using errcode = '22023';
  end if;
  if new.currency_kind not in ('TRY', 'multi') and v_try <> 0 then
    raise exception 'ADREEM_OPENING_CURRENCY_MISMATCH' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and v_old_try <> 0 and new.status = 'inactive' and v_merge_target is not null then
    if new.balance_try <> 0 or not exists (
      select 1 from public.adreem_movements movement
      where movement.ledger_id = new.ledger_id and movement.owner_id = new.owner_id
        and movement.record_id = concat('opening-', new.record_id, '-try')
        and movement.movement_type = 'opening_balance' and movement.currency = 'TRY'
        and movement.amount = v_old_try and movement.destination_account_id = v_merge_target
        and movement.payload ->> 'mergedFromAccountId' = new.record_id
    ) then
      raise exception 'ADREEM_ACCOUNT_OPENING_IMMUTABLE' using errcode = '23514';
    end if;
    new.payload := jsonb_set(new.payload, '{openingTry}', '0'::jsonb, true);
    v_try := 0;
  end if;
  if tg_op = 'UPDATE' and v_old_try is distinct from v_try then
    if not (v_old_try <> 0 and v_try = 0 and new.status = 'inactive' and v_merge_target is not null) then
      raise exception 'ADREEM_ACCOUNT_OPENING_IMMUTABLE' using errcode = '23514';
    end if;
  end if;
  return new;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'ADREEM_INVALID_OPENING_AMOUNT' using errcode = '22023';
end;
$$;

revoke all on function adreem_private.protect_account_opening_try() from public, anon, authenticated, service_role;
drop trigger if exists adreem_protect_account_opening_try on public.adreem_accounts;
create trigger adreem_protect_account_opening_try
before insert or update on public.adreem_accounts
for each row execute function adreem_private.protect_account_opening_try();

create or replace function adreem_private.require_account_opening_movements()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency text;
  v_field text;
  v_suffix text;
  v_amount numeric;
begin
  foreach v_currency in array array['LYD', 'USD', 'TRY'] loop
    v_field := case v_currency when 'USD' then 'openingUsd' when 'TRY' then 'openingTry' else 'openingDinar' end;
    v_suffix := lower(case v_currency when 'LYD' then 'dinar' else v_currency end);
    v_amount := coalesce(nullif(new.payload ->> v_field, '')::numeric, 0);
    if v_amount <> 0 and not exists (
      select 1 from public.adreem_movements movement
      where movement.ledger_id = new.ledger_id and movement.owner_id = new.owner_id
        and movement.record_id = concat('opening-', new.record_id, '-', v_suffix)
        and movement.movement_type = 'opening_balance' and movement.status = 'posted'
        and movement.amount = v_amount and movement.currency = v_currency
        and movement.source_account_id is null and movement.destination_account_id = new.record_id
    ) then
      raise exception 'ADREEM_ACCOUNT_OPENING_MOVEMENT_REQUIRED' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function adreem_private.protect_opening_movement() from public, anon, authenticated, service_role;
revoke all on function adreem_private.require_account_opening_movements() from public, anon, authenticated, service_role;

create or replace function public.adreem_ledger_report_summary(
  p_ledger_id uuid,
  p_owner_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authenticated_owner_id uuid := (select auth.uid());
  v_request_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_authenticated_member boolean := lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'adreem_member', 'false')) = 'true';
  v_owner_id uuid;
  v_dimensions jsonb;
  v_expense_categories jsonb;
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

  if not exists (
    select 1
    from public.adreem_ledgers as ledger
    join public.adreem_profiles as profile on profile.id = ledger.owner_id
    where ledger.id = p_ledger_id
      and ledger.owner_id = v_owner_id
      and profile.is_active
  ) then
    raise exception 'ADREEM_LEDGER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(report.payload order by report.weight desc, report.movement_count desc), '[]'::jsonb)
  into v_dimensions
  from (
    select
      dimension.record_id,
      count(movement.record_id)::bigint as movement_count,
      (
        abs(coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')), 0))
        + abs(coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')), 0))
        + abs(coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('expense', 'truck_expense')), 0))
      ) as weight,
      jsonb_build_object(
        'dimension', dimension.payload,
        'movementCount', count(movement.record_id)::bigint,
        'income', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')), 0),
        'expense', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')), 0),
        'net', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')), 0),
        'incomeUsd', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')), 0),
        'expenseUsd', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')), 0),
        'netUsd', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')), 0),
        'incomeTry', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('external_income', 'truck_income')), 0),
        'expenseTry', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('expense', 'truck_expense')), 0),
        'netTry', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('external_income', 'truck_income')), 0)
          - coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY' and movement.movement_type in ('expense', 'truck_expense')), 0)
      ) as payload
    from public.adreem_dimensions as dimension
    left join public.adreem_movements as movement
      on movement.ledger_id = dimension.ledger_id
     and movement.owner_id = dimension.owner_id
     and movement.dimension_id = dimension.record_id
     and movement.status = 'posted'
    where dimension.ledger_id = p_ledger_id
      and dimension.owner_id = v_owner_id
    group by dimension.record_id, dimension.payload
  ) as report;

  select coalesce(jsonb_agg(report.payload order by report.weight desc, report.movement_count desc), '[]'::jsonb)
  into v_expense_categories
  from (
    select
      coalesce(movement.expense_category_id, '') as category_id,
      count(*)::bigint as movement_count,
      coalesce(sum(abs(movement.amount)), 0) as weight,
      jsonb_build_object(
        'categoryId', coalesce(movement.expense_category_id, ''),
        'name', coalesce(nullif(category.payload ->> 'ownerName', ''), nullif(category.name, ''), 'بدون تصنيف'),
        'dinar', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'LYD'), 0),
        'usd', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'USD'), 0),
        'try', coalesce(sum(abs(movement.amount)) filter (where movement.currency = 'TRY'), 0),
        'count', count(*)::bigint
      ) as payload
    from public.adreem_movements as movement
    left join public.adreem_accounts as category
      on category.ledger_id = movement.ledger_id
     and category.owner_id = movement.owner_id
     and category.record_id = movement.expense_category_id
     and category.value_kind = 'expense'
    where movement.ledger_id = p_ledger_id
      and movement.owner_id = v_owner_id
      and movement.status = 'posted'
      and movement.movement_type in ('expense', 'truck_expense')
    group by coalesce(movement.expense_category_id, ''), category.payload, category.name
  ) as report;

  return jsonb_build_object(
    'dimensions', v_dimensions,
    'expenseCategories', v_expense_categories
  );
end;
$$;

revoke all on function public.adreem_ledger_report_summary(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.adreem_ledger_report_summary(uuid, uuid) to authenticated, service_role;
