alter table public.adreem_movements
  drop constraint if exists adreem_movements_movement_type_check;

alter table public.adreem_movements
  add constraint adreem_movements_movement_type_check check (movement_type in (
    'opening_balance', 'transfer', 'cash_deposit', 'cash_withdrawal',
    'expense', 'truck_expense', 'truck_income', 'usd_sale',
    'usd_purchase', 'external_income', 'correction', 'record_only'
  ));

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
      return query
        select 0::smallint, v_source, 'USD'::text, -abs(round(v_amount))
        union all
        select 1::smallint, v_destination, 'LYD'::text, round(abs(v_amount) * v_rate);
    when 'usd_purchase' then
      if v_rate is null or v_rate <= 0 then
        raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
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

create or replace function adreem_private.prevent_record_only_mode_flip()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'posted' and
     old.movement_type is distinct from new.movement_type and
     (old.movement_type = 'record_only' or new.movement_type = 'record_only') then
    raise exception 'ADREEM_MOVEMENT_POSTING_MODE_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function adreem_private.prevent_record_only_mode_flip() from public, anon, authenticated, service_role;

drop trigger if exists adreem_prevent_record_only_mode_flip on public.adreem_movements;
create trigger adreem_prevent_record_only_mode_flip
before update on public.adreem_movements
for each row execute function adreem_private.prevent_record_only_mode_flip();
