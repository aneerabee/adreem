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
    else
      raise exception 'ADREEM_UNKNOWN_MOVEMENT_TYPE' using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.adreem_entries_for_movement(jsonb) from public, anon, authenticated, service_role;

create or replace function public.adreem_merge_account_references(
  p_ledger_id uuid,
  p_owner_id uuid,
  p_source_account_id text,
  p_target_account_id text,
  p_merged_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.adreem_accounts%rowtype;
  v_target public.adreem_accounts%rowtype;
begin
  if nullif(p_source_account_id, '') is null or
     nullif(p_target_account_id, '') is null or
     p_source_account_id = p_target_account_id then
    raise exception 'ADREEM_INVALID_ACCOUNT_MERGE' using errcode = '22023';
  end if;

  select account.* into v_source
  from public.adreem_accounts as account
  where account.ledger_id = p_ledger_id
    and account.owner_id = p_owner_id
    and account.record_id = p_source_account_id
  for update;
  if not found then
    raise exception 'ADREEM_MERGE_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select account.* into v_target
  from public.adreem_accounts as account
  where account.ledger_id = p_ledger_id
    and account.owner_id = p_owner_id
    and account.record_id = p_target_account_id
  for update;
  if not found or v_target.status <> 'active' then
    raise exception 'ADREEM_MERGE_TARGET_NOT_ACTIVE' using errcode = '23514';
  end if;

  if v_source.value_kind <> 'review' and (
    v_source.account_type <> v_target.account_type or
    v_source.value_kind <> v_target.value_kind or
    v_source.currency_kind <> v_target.currency_kind
  ) then
    raise exception 'ADREEM_MERGE_ACCOUNT_MISMATCH' using errcode = '23514';
  end if;

  if v_target.value_kind not in ('cash', 'bank') and exists (
    select 1 from public.adreem_reconciliations as reconciliation
    where reconciliation.ledger_id = p_ledger_id
      and reconciliation.owner_id = p_owner_id
      and reconciliation.account_id = p_source_account_id
  ) then
    raise exception 'ADREEM_MERGE_RECONCILIATION_MISMATCH' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.adreem_dimensions as dimension
    where dimension.ledger_id = p_ledger_id
      and dimension.owner_id = p_owner_id
      and dimension.payload ->> 'linkedAccountId' = p_source_account_id
      and (
        (dimension.payload ->> 'type' = 'asset' and v_target.value_kind <> 'asset') or
        (dimension.payload ->> 'type' = 'project' and v_target.value_kind <> 'project')
      )
  ) then
    raise exception 'ADREEM_MERGE_DIMENSION_MISMATCH' using errcode = '23514';
  end if;

  update public.adreem_movement_entries as entry
  set account_id = p_target_account_id
  where entry.ledger_id = p_ledger_id
    and entry.owner_id = p_owner_id
    and entry.account_id = p_source_account_id;

  update public.adreem_movements as movement
  set source_account_id = case when movement.source_account_id = p_source_account_id then p_target_account_id else movement.source_account_id end,
      destination_account_id = case when movement.destination_account_id = p_source_account_id then p_target_account_id else movement.destination_account_id end,
      expense_category_id = case when movement.expense_category_id = p_source_account_id then p_target_account_id else movement.expense_category_id end,
      payload = movement.payload || jsonb_strip_nulls(jsonb_build_object(
        'sourceAccountId', case when movement.source_account_id = p_source_account_id then p_target_account_id end,
        'destinationAccountId', case when movement.destination_account_id = p_source_account_id then p_target_account_id end,
        'expenseCategoryId', case when movement.expense_category_id = p_source_account_id then p_target_account_id end,
        'mergedFromAccountId', p_source_account_id,
        'updatedAt', p_merged_at
      )),
      updated_at = p_merged_at
  where movement.ledger_id = p_ledger_id
    and movement.owner_id = p_owner_id
    and p_source_account_id in (movement.source_account_id, movement.destination_account_id, movement.expense_category_id);

  update public.adreem_attachments as attachment
  set account_id = p_target_account_id,
      payload = attachment.payload || jsonb_build_object(
        'accountId', p_target_account_id,
        'mergedFromAccountId', p_source_account_id,
        'updatedAt', p_merged_at
      )
  where attachment.ledger_id = p_ledger_id
    and attachment.owner_id = p_owner_id
    and attachment.account_id = p_source_account_id;

  update public.adreem_dimensions as dimension
  set payload = dimension.payload || jsonb_build_object(
        'linkedAccountId', p_target_account_id,
        'mergedFromAccountId', p_source_account_id,
        'updatedAt', p_merged_at
      )
  where dimension.ledger_id = p_ledger_id
    and dimension.owner_id = p_owner_id
    and dimension.payload ->> 'linkedAccountId' = p_source_account_id;

  update public.adreem_recurring_rules as rule
  set payload = jsonb_set(
        rule.payload,
        '{template}',
        coalesce(rule.payload -> 'template', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'sourceAccountId', case when rule.payload #>> '{template,sourceAccountId}' = p_source_account_id then p_target_account_id end,
          'destinationAccountId', case when rule.payload #>> '{template,destinationAccountId}' = p_source_account_id then p_target_account_id end,
          'expenseCategoryId', case when rule.payload #>> '{template,expenseCategoryId}' = p_source_account_id then p_target_account_id end
        )),
        true
      ) || jsonb_build_object(
        'mergedFromAccountId', p_source_account_id,
        'updatedAt', p_merged_at
      )
  where rule.ledger_id = p_ledger_id
    and rule.owner_id = p_owner_id
    and p_source_account_id in (
      rule.payload #>> '{template,sourceAccountId}',
      rule.payload #>> '{template,destinationAccountId}',
      rule.payload #>> '{template,expenseCategoryId}'
    );

  update public.adreem_reconciliations as reconciliation
  set account_id = p_target_account_id,
      payload = reconciliation.payload || jsonb_build_object(
        'accountId', p_target_account_id,
        'mergedFromAccountId', p_source_account_id,
        'updatedAt', p_merged_at
      )
  where reconciliation.ledger_id = p_ledger_id
    and reconciliation.owner_id = p_owner_id
    and reconciliation.account_id = p_source_account_id;

  update public.adreem_accounts as target
  set balance_dinar = target.balance_dinar + v_source.balance_dinar,
      balance_usd = target.balance_usd + v_source.balance_usd,
      posted_count = target.posted_count + v_source.posted_count,
      structure_locked = target.structure_locked or v_source.structure_locked,
      payload = target.payload || jsonb_build_object('updatedAt', p_merged_at)
  where target.ledger_id = p_ledger_id
    and target.owner_id = p_owner_id
    and target.record_id = p_target_account_id;

  update public.adreem_accounts as source
  set status = 'inactive',
      balance_dinar = 0,
      balance_usd = 0,
      posted_count = 0,
      structure_locked = true,
      payload = source.payload || jsonb_build_object(
        'status', 'inactive',
        'mergedIntoAccountId', p_target_account_id,
        'disabledAt', p_merged_at,
        'updatedAt', p_merged_at
      )
  where source.ledger_id = p_ledger_id
    and source.owner_id = p_owner_id
    and source.record_id = p_source_account_id;
end;
$$;

revoke all on function public.adreem_merge_account_references(uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.adreem_apply_ledger_delta(
  p_ledger_id uuid,
  p_expected_revision bigint,
  p_delta jsonb,
  p_owner_id uuid default null
)
returns table (
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authenticated_owner_id uuid := (select auth.uid());
  v_request_role text := coalesce((select auth.jwt() ->> 'role'), '');
  v_authenticated_member boolean := lower(coalesce((select auth.jwt()) -> 'app_metadata' ->> 'adreem_member', 'false')) = 'true';
  v_owner_id uuid;
  v_current_revision bigint;
  v_item jsonb;
  v_record_id text;
  v_updated_at timestamptz;
  v_account_type text;
  v_value_kind text;
  v_currency_kind text;
  v_account_status text;
  v_recurring_status text;
  v_movement_type text;
  v_movement_status text;
  v_amount numeric;
  v_rate numeric;
  v_source_account_id text;
  v_destination_account_id text;
  v_source_kind text;
  v_destination_kind text;
  v_existing_movement_status text;
  v_existing_movement_payload jsonb;
  v_existing_movement_occurred_at timestamptz;
  v_existing_movement_created_at timestamptz;
  v_voided_at timestamptz;
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
    select 1 from public.adreem_profiles as profile
    where profile.id = v_owner_id and profile.is_active
  ) then
    raise exception 'ADREEM_USER_DISABLED' using errcode = '42501';
  end if;
  if p_delta is null or jsonb_typeof(p_delta) <> 'object' then
    raise exception 'ADREEM_INVALID_DELTA' using errcode = '22023';
  end if;
  if p_delta ? 'resetAt' and v_request_role <> 'service_role' then
    raise exception 'ADREEM_CLIENT_RESET_NOT_ALLOWED' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_delta) as delta_key(key)
    where delta_key.key not in (
      'accounts',
      'movements',
      'dimensions',
      'attachments',
      'recurringRules',
      'reconciliations',
      'auditEvents',
      'ignoredExternalAccounts',
      'resetAt'
    )
  ) then
    raise exception 'ADREEM_UNKNOWN_DELTA_FIELD' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'ADREEM_REVISION_REQUIRED' using errcode = '22023';
  end if;

  select ledger.revision
  into v_current_revision
  from public.adreem_ledgers as ledger
  where ledger.id = p_ledger_id
    and ledger.owner_id = v_owner_id
  for update;

  if not found then
    raise exception 'ADREEM_LEDGER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_current_revision is distinct from p_expected_revision then
    raise exception 'ADREEM_REVISION_CONFLICT' using errcode = '40001';
  end if;

  if jsonb_typeof(coalesce(p_delta -> 'accounts', '[]'::jsonb)) <> 'array' or
     jsonb_typeof(coalesce(p_delta -> 'movements', '[]'::jsonb)) <> 'array' then
    raise exception 'ADREEM_INVALID_DELTA_COLLECTION' using errcode = '22023';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'dimensions', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then
      raise exception 'ADREEM_DIMENSION_ID_REQUIRED' using errcode = '22023';
    end if;
    insert into public.adreem_dimensions (
      ledger_id, owner_id, record_id, name, status, payload
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      coalesce(nullif(v_item ->> 'name', ''), v_record_id),
      coalesce(nullif(v_item ->> 'status', ''), 'active'),
      v_item
    )
    on conflict (ledger_id, record_id) do update set
      name = excluded.name,
      status = excluded.status,
      payload = excluded.payload;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'accounts', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then
      raise exception 'ADREEM_ACCOUNT_ID_REQUIRED' using errcode = '22023';
    end if;
    v_account_type := coalesce(nullif(v_item ->> 'type', ''), 'person');
    v_value_kind := coalesce(nullif(v_item ->> 'valueKind', ''), 'receivable');
    v_currency_kind := case lower(coalesce(nullif(v_item ->> 'currencyKind', ''), 'lyd'))
      when 'dinar' then 'LYD'
      when 'lyd' then 'LYD'
      when 'usd' then 'USD'
      when '$' then 'USD'
      when 'both' then 'multi'
      when 'multi' then 'multi'
      else v_item ->> 'currencyKind'
    end;
    v_account_status := coalesce(nullif(v_item ->> 'status', ''), 'active');

    if exists (
      select 1
      from public.adreem_accounts as existing
      where existing.ledger_id = p_ledger_id
        and existing.owner_id = v_owner_id
        and existing.record_id = v_record_id
        and existing.structure_locked
        and (
          existing.account_type <> v_account_type or
          existing.value_kind <> v_value_kind or
          existing.currency_kind <> v_currency_kind or
          (
            (existing.value_kind = 'receivable' or v_value_kind = 'receivable') and
            coalesce(existing.payload ->> 'subAccountName', '') is distinct from coalesce(v_item ->> 'subAccountName', '')
          )
        )
    ) then
      raise exception 'ADREEM_ACCOUNT_STRUCTURE_LOCKED' using errcode = '23514';
    end if;
    if v_account_status = 'inactive' and
       nullif(v_item ->> 'mergedIntoAccountId', '') is null and
       exists (
         select 1 from public.adreem_accounts as existing
         where existing.ledger_id = p_ledger_id
           and existing.owner_id = v_owner_id
           and existing.record_id = v_record_id
           and (existing.balance_dinar <> 0 or existing.balance_usd <> 0)
       ) then
      raise exception 'ADREEM_NONZERO_ACCOUNT_CANNOT_BE_DISABLED' using errcode = '23514';
    end if;
    insert into public.adreem_accounts (
      ledger_id,
      owner_id,
      record_id,
      name,
      account_type,
      value_kind,
      currency_kind,
      status,
      payload
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      coalesce(
        nullif(v_item ->> 'ownerName', ''),
        nullif(v_item ->> 'name', ''),
        nullif(v_item ->> 'legacyName', ''),
        v_record_id
      ),
      v_account_type,
      v_value_kind,
      v_currency_kind,
      v_account_status,
      v_item
    )
    on conflict (ledger_id, record_id) do update set
      name = excluded.name,
      account_type = excluded.account_type,
      value_kind = excluded.value_kind,
      currency_kind = excluded.currency_kind,
      status = excluded.status,
      payload = excluded.payload;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'accounts', '[]'::jsonb))
  loop
    if coalesce(v_item ->> 'status', 'active') = 'inactive' and nullif(v_item ->> 'mergedIntoAccountId', '') is not null then
      perform public.adreem_merge_account_references(
        p_ledger_id,
        v_owner_id,
        v_item ->> 'id',
        v_item ->> 'mergedIntoAccountId',
        coalesce(nullif(v_item ->> 'updatedAt', '')::timestamptz, now())
      );
    end if;
  end loop;

  update public.adreem_accounts as account
  set structure_locked = true
  where account.ledger_id = p_ledger_id
    and account.owner_id = v_owner_id
    and account.record_id in (
      select nullif(dimension ->> 'linkedAccountId', '')
      from jsonb_array_elements(coalesce(p_delta -> 'dimensions', '[]'::jsonb)) as dimension
    );

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'movements', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then
      raise exception 'ADREEM_MOVEMENT_ID_REQUIRED' using errcode = '22023';
    end if;

    v_movement_type := nullif(v_item ->> 'type', '');
    v_movement_status := coalesce(nullif(v_item ->> 'status', ''), 'needs_review');
    v_source_account_id := nullif(v_item ->> 'sourceAccountId', '');
    v_destination_account_id := nullif(v_item ->> 'destinationAccountId', '');
    begin
      v_amount := nullif(v_item ->> 'amount', '')::numeric;
      v_rate := nullif(v_item ->> 'rate', '')::numeric;
    exception when invalid_text_representation then
      raise exception 'ADREEM_INVALID_MOVEMENT_NUMBER' using errcode = '22023';
    end;
    if v_amount is not null and v_amount <> trunc(v_amount) then
      raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
    end if;
    if v_amount is not null and abs(v_amount) > 999999999999999 then
      raise exception 'ADREEM_INVALID_MOVEMENT_AMOUNT' using errcode = '22023';
    end if;
    if v_rate is not null and (v_rate <= 0 or v_rate > 9999999) then
      raise exception 'ADREEM_INVALID_MOVEMENT_RATE' using errcode = '22023';
    end if;

    select existing.status, existing.payload, existing.occurred_at, existing.created_at
    into v_existing_movement_status, v_existing_movement_payload, v_existing_movement_occurred_at, v_existing_movement_created_at
    from public.adreem_movements as existing
    where existing.ledger_id = p_ledger_id
      and existing.owner_id = v_owner_id
      and existing.record_id = v_record_id;

    if found then
      if v_existing_movement_status = 'voided' and v_existing_movement_payload is distinct from v_item then
        raise exception 'ADREEM_VOIDED_MOVEMENT_IMMUTABLE' using errcode = '23514';
      end if;
      if v_existing_movement_payload ? 'createdAt' and
         coalesce(v_item ->> 'createdAt', '') is distinct from coalesce(v_existing_movement_payload ->> 'createdAt', '') then
        raise exception 'ADREEM_MOVEMENT_CREATED_AT_IMMUTABLE' using errcode = '23514';
      end if;
      if v_existing_movement_status = 'posted' and
         v_movement_status = 'posted' and
         v_existing_movement_payload is distinct from v_item and
         now() - least(v_existing_movement_occurred_at, v_existing_movement_created_at) > interval '24 hours' then
        raise exception 'ADREEM_MOVEMENT_EDIT_WINDOW_EXPIRED' using errcode = '23514';
      end if;
      if v_existing_movement_status is distinct from v_movement_status then
        if v_movement_status = 'voided' then
          if v_existing_movement_status not in ('posted', 'needs_review') or
             nullif(btrim(v_item ->> 'voidReason'), '') is null or
             exists (
               select 1
               from unnest(array[
                 'type', 'amount', 'currency', 'rate', 'sourceAccountId',
                 'destinationAccountId', 'dimensionId', 'expenseCategoryId', 'note'
               ]) as changed_field(field_name)
               where (v_item -> changed_field.field_name) is distinct from (v_existing_movement_payload -> changed_field.field_name)
             ) then
            raise exception 'ADREEM_INVALID_MOVEMENT_STATUS_TRANSITION' using errcode = '23514';
          end if;
          begin
            v_voided_at := nullif(v_item ->> 'voidedAt', '')::timestamptz;
          exception when invalid_datetime_format then
            raise exception 'ADREEM_INVALID_MOVEMENT_VOID_DATE' using errcode = '22023';
          end;
          if v_voided_at is null then
            raise exception 'ADREEM_INVALID_MOVEMENT_VOID_DATE' using errcode = '22023';
          end if;
          if v_existing_movement_status = 'posted' and
             now() - least(v_existing_movement_occurred_at, v_existing_movement_created_at) > interval '24 hours' then
            raise exception 'ADREEM_MOVEMENT_VOID_WINDOW_EXPIRED' using errcode = '23514';
          end if;
        elsif v_existing_movement_status in ('posted', 'voided') then
          raise exception 'ADREEM_INVALID_MOVEMENT_STATUS_TRANSITION' using errcode = '23514';
        end if;
      end if;
    end if;

    if v_movement_status = 'posted' then
      perform 1 from public.adreem_entries_for_movement(v_item);
      if exists (
        select 1
        from public.adreem_entries_for_movement(v_item) as entry
        left join public.adreem_accounts as account
          on account.ledger_id = p_ledger_id
         and account.owner_id = v_owner_id
         and account.record_id = entry.account_id
        where account.record_id is null
           or account.status <> 'active'
           or account.value_kind in ('project', 'expense', 'summary', 'review')
           or account.currency_kind not in (entry.currency, 'multi')
      ) then
        raise exception 'ADREEM_MOVEMENT_ACCOUNT_NOT_ALLOWED' using errcode = '23514';
      end if;

      if v_movement_type = 'transfer' then
        select case
          when source.value_kind = 'cash' or lower(concat_ws(' ', source.payload ->> 'subAccountName', source.payload ->> 'legacyName')) ~ '(كاش|نقد|cash)' then 'cash'
          when source.value_kind = 'bank' or lower(concat_ws(' ', source.payload ->> 'subAccountName', source.payload ->> 'legacyName')) ~ '(مصرف|مصرفي|شيك|حساب|الجمهورية|الوحدة|تركيا|bank)' then 'bank'
          else source.value_kind
        end
        into v_source_kind
        from public.adreem_accounts as source
        where source.ledger_id = p_ledger_id and source.owner_id = v_owner_id and source.record_id = v_source_account_id;

        select case
          when destination.value_kind = 'cash' or lower(concat_ws(' ', destination.payload ->> 'subAccountName', destination.payload ->> 'legacyName')) ~ '(كاش|نقد|cash)' then 'cash'
          when destination.value_kind = 'bank' or lower(concat_ws(' ', destination.payload ->> 'subAccountName', destination.payload ->> 'legacyName')) ~ '(مصرف|مصرفي|شيك|حساب|الجمهورية|الوحدة|تركيا|bank)' then 'bank'
          else destination.value_kind
        end
        into v_destination_kind
        from public.adreem_accounts as destination
        where destination.ledger_id = p_ledger_id and destination.owner_id = v_owner_id and destination.record_id = v_destination_account_id;

        if v_source_kind is distinct from v_destination_kind then
          raise exception 'ADREEM_TRANSFER_ACCOUNT_KIND_MISMATCH' using errcode = '23514';
        end if;
      end if;

      if v_movement_type = 'cash_deposit' and exists (
        select 1
        from public.adreem_accounts as source, public.adreem_accounts as destination
        where source.ledger_id = p_ledger_id and source.owner_id = v_owner_id and source.record_id = v_source_account_id
          and destination.ledger_id = p_ledger_id and destination.owner_id = v_owner_id and destination.record_id = v_destination_account_id
          and (source.value_kind <> 'cash' or destination.value_kind <> 'bank')
      ) then
        raise exception 'ADREEM_INVALID_CASH_DEPOSIT_ACCOUNTS' using errcode = '23514';
      end if;

      if v_movement_type = 'cash_withdrawal' and exists (
        select 1
        from public.adreem_accounts as source, public.adreem_accounts as destination
        where source.ledger_id = p_ledger_id and source.owner_id = v_owner_id and source.record_id = v_source_account_id
          and destination.ledger_id = p_ledger_id and destination.owner_id = v_owner_id and destination.record_id = v_destination_account_id
          and (source.value_kind <> 'bank' or destination.value_kind <> 'cash')
      ) then
        raise exception 'ADREEM_INVALID_CASH_WITHDRAWAL_ACCOUNTS' using errcode = '23514';
      end if;

      if nullif(v_item ->> 'expenseCategoryId', '') is not null and not exists (
        select 1
        from public.adreem_accounts as category
        where category.ledger_id = p_ledger_id
          and category.owner_id = v_owner_id
          and category.record_id = v_item ->> 'expenseCategoryId'
          and category.value_kind = 'expense'
          and category.status = 'active'
      ) then
        raise exception 'ADREEM_INVALID_EXPENSE_CATEGORY' using errcode = '23514';
      end if;
    end if;

    begin
    with old_entries as (
      select entry.account_id, entry.currency, -entry.delta as delta, -1::bigint as count_delta
      from public.adreem_movement_entries as entry
      where entry.ledger_id = p_ledger_id
        and entry.movement_id = v_record_id
        and entry.owner_id = v_owner_id
    ),
    new_entries as (
      select entry.account_id, entry.currency, entry.delta, 1::bigint as count_delta
      from public.adreem_entries_for_movement(v_item) as entry
    ),
    net as (
      select
        combined.account_id,
        coalesce(sum(combined.delta) filter (where combined.currency = 'LYD'), 0) as dinar_delta,
        coalesce(sum(combined.delta) filter (where combined.currency = 'USD'), 0) as usd_delta,
        sum(combined.count_delta) as count_delta
      from (
        select * from old_entries
        union all
        select * from new_entries
      ) as combined
      group by combined.account_id
    )
    update public.adreem_accounts as account
    set
      balance_dinar = account.balance_dinar + net.dinar_delta,
      balance_usd = account.balance_usd + net.usd_delta,
      posted_count = account.posted_count + net.count_delta
    from net
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and account.record_id = net.account_id;
    exception when check_violation then
      raise exception 'ADREEM_NEGATIVE_OWN_BALANCE' using errcode = '23514';
    end;

    delete from public.adreem_movement_entries
    where ledger_id = p_ledger_id
      and owner_id = v_owner_id
      and movement_id = v_record_id;

    begin
      v_updated_at := coalesce(nullif(v_item ->> 'updatedAt', '')::timestamptz, now());
    exception when invalid_datetime_format then
      raise exception 'ADREEM_INVALID_MOVEMENT_DATE' using errcode = '22023';
    end;

    insert into public.adreem_movements (
      ledger_id,
      owner_id,
      record_id,
      movement_type,
      status,
      amount,
      currency,
      source_account_id,
      destination_account_id,
      rate,
      dimension_id,
      expense_category_id,
      occurred_at,
      payload,
      updated_at
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      v_movement_type,
      v_movement_status,
      v_amount,
      nullif(v_item ->> 'currency', ''),
      v_source_account_id,
      v_destination_account_id,
      v_rate,
      nullif(v_item ->> 'dimensionId', ''),
      nullif(v_item ->> 'expenseCategoryId', ''),
      coalesce(nullif(v_item ->> 'createdAt', '')::timestamptz, v_updated_at),
      v_item,
      v_updated_at
    )
    on conflict (ledger_id, record_id) do update set
      movement_type = excluded.movement_type,
      status = excluded.status,
      amount = excluded.amount,
      currency = excluded.currency,
      source_account_id = excluded.source_account_id,
      destination_account_id = excluded.destination_account_id,
      rate = excluded.rate,
      dimension_id = excluded.dimension_id,
      expense_category_id = excluded.expense_category_id,
      occurred_at = excluded.occurred_at,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

    insert into public.adreem_movement_entries (
      ledger_id, owner_id, movement_id, entry_index, account_id, currency, delta
    )
    select
      p_ledger_id,
      v_owner_id,
      v_record_id,
      entry.entry_index,
      entry.account_id,
      entry.currency,
      entry.delta
    from public.adreem_entries_for_movement(v_item) as entry;

    if v_movement_status in ('posted', 'voided') then
      update public.adreem_accounts as account
      set structure_locked = true
      where account.ledger_id = p_ledger_id
        and account.owner_id = v_owner_id
        and account.record_id in (v_source_account_id, v_destination_account_id, nullif(v_item ->> 'expenseCategoryId', ''));
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'attachments', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null or nullif(v_item ->> 'storagePath', '') is null then
      raise exception 'ADREEM_ATTACHMENT_ID_AND_PATH_REQUIRED' using errcode = '22023';
    end if;
    insert into public.adreem_attachments (
      ledger_id,
      owner_id,
      record_id,
      movement_id,
      account_id,
      storage_path,
      file_name,
      mime_type,
      size_bytes,
      hidden_at,
      payload
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      nullif(v_item ->> 'movementId', ''),
      nullif(v_item ->> 'accountId', ''),
      nullif(v_item ->> 'storagePath', ''),
      coalesce(nullif(v_item ->> 'label', ''), 'attachment'),
      coalesce(nullif(v_item ->> 'mimeType', ''), 'application/octet-stream'),
      coalesce(nullif(v_item ->> 'sizeBytes', '')::bigint, 0),
      nullif(v_item ->> 'hiddenAt', '')::timestamptz,
      v_item
    )
    on conflict (ledger_id, record_id) do update set
      movement_id = excluded.movement_id,
      account_id = excluded.account_id,
      storage_path = excluded.storage_path,
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      hidden_at = excluded.hidden_at,
      payload = excluded.payload;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'recurringRules', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then
      raise exception 'ADREEM_RECURRING_RULE_ID_REQUIRED' using errcode = '22023';
    end if;
    v_recurring_status := coalesce(
      nullif(v_item ->> 'status', ''),
      case when v_item ->> 'disabledAt' is null then 'active' else 'inactive' end
    );
    if v_recurring_status = 'active'
       and not exists (
         select 1 from public.adreem_recurring_rules as existing
         where existing.ledger_id = p_ledger_id
           and existing.owner_id = v_owner_id
           and existing.record_id = v_record_id
           and existing.status = 'active'
       )
       and (
         select count(*) from public.adreem_recurring_rules as existing
         where existing.ledger_id = p_ledger_id
           and existing.owner_id = v_owner_id
           and existing.status = 'active'
       ) >= 250 then
      raise exception 'ADREEM_ACTIVE_RECURRING_RULE_LIMIT' using errcode = '23514';
    end if;
    insert into public.adreem_recurring_rules (
      ledger_id, owner_id, record_id, status, next_run_at, last_run_at, payload
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      v_recurring_status,
      nullif(v_item ->> 'nextRunAt', '')::timestamptz,
      nullif(v_item ->> 'lastRunAt', '')::timestamptz,
      v_item
    )
    on conflict (ledger_id, record_id) do update set
      status = excluded.status,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      payload = excluded.payload;

    update public.adreem_accounts as account
    set structure_locked = true
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and account.record_id in (
        nullif(v_item #>> '{template,sourceAccountId}', ''),
        nullif(v_item #>> '{template,destinationAccountId}', ''),
        nullif(v_item #>> '{template,expenseCategoryId}', '')
      );
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'reconciliations', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null or nullif(v_item ->> 'accountId', '') is null then
      raise exception 'ADREEM_RECONCILIATION_ID_AND_ACCOUNT_REQUIRED' using errcode = '22023';
    end if;
    insert into public.adreem_reconciliations (
      ledger_id, owner_id, record_id, account_id, reconciled_at, payload
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      v_item ->> 'accountId',
      least(coalesce(
        nullif(v_item ->> 'createdAt', '')::timestamptz,
        nullif(v_item ->> 'reconciledAt', '')::timestamptz,
        now()
      ), now()),
      v_item
    )
    on conflict (ledger_id, record_id) do update set
      account_id = excluded.account_id,
      payload = excluded.payload;

    update public.adreem_accounts as account
    set structure_locked = true
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and account.record_id = v_item ->> 'accountId';
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delta -> 'auditEvents', '[]'::jsonb))
  loop
    v_record_id := nullif(v_item ->> 'id', '');
    if v_record_id is null then
      raise exception 'ADREEM_AUDIT_ID_REQUIRED' using errcode = '22023';
    end if;
    insert into public.adreem_audit_events (
      ledger_id, owner_id, record_id, action, payload, created_at
    ) values (
      p_ledger_id,
      v_owner_id,
      v_record_id,
      'user_activity',
      v_item,
      now()
    )
    on conflict (ledger_id, record_id) do nothing;
  end loop;

  if p_delta ? 'ignoredExternalAccounts' then
    if jsonb_typeof(p_delta -> 'ignoredExternalAccounts') <> 'array' then
      raise exception 'ADREEM_INVALID_IGNORED_ACCOUNTS' using errcode = '22023';
    end if;
    delete from public.adreem_ignored_external_accounts
    where ledger_id = p_ledger_id and owner_id = v_owner_id;
    insert into public.adreem_ignored_external_accounts (ledger_id, owner_id, account_id)
    select p_ledger_id, v_owner_id, ignored.account_id
    from jsonb_array_elements_text(p_delta -> 'ignoredExternalAccounts') as ignored(account_id)
    on conflict (ledger_id, account_id) do nothing;
  end if;

  update public.adreem_ledgers as ledger
  set
    revision = ledger.revision + 1,
    reset_at = case
      when p_delta ? 'resetAt' then nullif(p_delta ->> 'resetAt', '')::timestamptz
      else ledger.reset_at
    end
  where ledger.id = p_ledger_id
    and ledger.owner_id = v_owner_id
  returning ledger.revision, ledger.updated_at
  into v_current_revision, v_updated_at;

  insert into adreem_private.adreem_security_events (
    ledger_id,
    owner_id,
    action,
    payload
  ) values (
    p_ledger_id,
    v_owner_id,
    'ledger_delta_applied',
    jsonb_build_object(
      'revision', v_current_revision,
      'previousRevision', p_expected_revision,
      'collections', coalesce((select jsonb_agg(key order by key) from jsonb_object_keys(p_delta) as key), '[]'::jsonb),
      'requestRole', v_request_role
    )
  );

  return query select v_current_revision, v_updated_at;
end;
$$;

revoke all on function public.adreem_apply_ledger_delta(uuid, bigint, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.adreem_apply_ledger_delta(uuid, bigint, jsonb, uuid) to authenticated, service_role;

create or replace function public.adreem_bot_state_get(p_bot_key text, p_state_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'payload', state.payload,
    'expiresAt', state.expires_at
  )
  from adreem_private.adreem_bot_state as state
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key;
$$;

create or replace function public.adreem_bot_state_set(
  p_bot_key text,
  p_state_key text,
  p_payload jsonb,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(p_bot_key, '') is null or nullif(p_state_key, '') is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ADREEM_INVALID_BOT_STATE' using errcode = '22023';
  end if;
  insert into adreem_private.adreem_bot_state (bot_key, state_key, payload, expires_at)
  values (p_bot_key, p_state_key, p_payload, p_expires_at)
  on conflict (bot_key, state_key) do update set
    payload = excluded.payload,
    expires_at = excluded.expires_at;
end;
$$;

create or replace function public.adreem_bot_state_delete(p_bot_key text, p_state_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from adreem_private.adreem_bot_state
  where bot_key = p_bot_key and state_key = p_state_key;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.adreem_bot_state_set_if_absent(
  p_bot_key text,
  p_state_key text,
  p_payload jsonb,
  p_expires_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_inserted integer;
begin
  if nullif(p_bot_key, '') is null or nullif(p_state_key, '') is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ADREEM_INVALID_BOT_STATE' using errcode = '22023';
  end if;
  insert into adreem_private.adreem_bot_state (bot_key, state_key, payload, expires_at)
  values (p_bot_key, p_state_key, p_payload, p_expires_at)
  on conflict (bot_key, state_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function public.adreem_bot_state_clean_expired(p_bot_key text, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from adreem_private.adreem_bot_state
  where bot_key = p_bot_key and expires_at < p_now;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.adreem_bot_state_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_set(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_delete(text, text) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_set_if_absent(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_clean_expired(text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.adreem_bot_state_get(text, text) to service_role;
grant execute on function public.adreem_bot_state_set(text, text, jsonb, timestamptz) to service_role;
grant execute on function public.adreem_bot_state_delete(text, text) to service_role;
grant execute on function public.adreem_bot_state_set_if_absent(text, text, jsonb, timestamptz) to service_role;
grant execute on function public.adreem_bot_state_clean_expired(text, timestamptz) to service_role;

create or replace function public.adreem_search_ledger_movements(
  p_ledger_id uuid,
  p_owner_id uuid default null,
  p_before_sequence bigint default null,
  p_limit integer default 100,
  p_query text default null,
  p_account_id text default null,
  p_status text default null,
  p_movement_type text default null,
  p_dimension_id text default null,
  p_expense_category_id text default null,
  p_exclude_opening boolean default true,
  p_occurred_from timestamptz default null,
  p_occurred_before timestamptz default null,
  p_include_total boolean default true
)
returns table (
  record_id text,
  payload jsonb,
  sequence bigint,
  total_count bigint
)
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
  v_limit integer := least(250, greatest(1, coalesce(p_limit, 100)));
  v_query text := nullif(public.adreem_normalize_search_text(p_query), '');
  v_query_pattern text;
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

  if p_before_sequence is not null and p_before_sequence <= 0 then
    raise exception 'ADREEM_INVALID_MOVEMENT_CURSOR' using errcode = '22023';
  end if;
  if length(coalesce(v_query, '')) > 120 or
     length(coalesce(p_account_id, '')) > 200 or
     length(coalesce(p_dimension_id, '')) > 200 or
     length(coalesce(p_expense_category_id, '')) > 200 then
    raise exception 'ADREEM_INVALID_MOVEMENT_FILTER' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('draft', 'needs_review', 'posted', 'voided') then
    raise exception 'ADREEM_INVALID_MOVEMENT_STATUS' using errcode = '22023';
  end if;
  if p_movement_type is not null and p_movement_type not in (
    'opening_balance', 'transfer', 'cash_deposit', 'cash_withdrawal',
    'expense', 'truck_expense', 'truck_income', 'usd_sale',
    'usd_purchase', 'external_income', 'correction'
  ) then
    raise exception 'ADREEM_INVALID_MOVEMENT_TYPE' using errcode = '22023';
  end if;

  if v_query is not null then
    v_query_pattern := '%' ||
      replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
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

  return query
  select
    movement.record_id,
    movement.payload,
    movement.sequence,
    case when p_include_total then count(*) over()::bigint else null::bigint end as total_count
  from public.adreem_movements as movement
  where movement.ledger_id = p_ledger_id
    and movement.owner_id = v_owner_id
    and (p_before_sequence is null or movement.sequence < p_before_sequence)
    and (not p_exclude_opening or movement.movement_type <> 'opening_balance')
    and (p_account_id is null or movement.source_account_id = p_account_id or movement.destination_account_id = p_account_id)
    and (p_status is null or movement.status = p_status)
    and (p_movement_type is null or movement.movement_type = p_movement_type)
    and (p_dimension_id is null or movement.dimension_id = p_dimension_id)
    and (p_expense_category_id is null or movement.expense_category_id = p_expense_category_id)
    and (p_occurred_from is null or movement.occurred_at >= p_occurred_from)
    and (p_occurred_before is null or movement.occurred_at < p_occurred_before)
    and (
      v_query is null or
      public.adreem_normalize_search_text(movement.payload ->> 'note') ilike v_query_pattern escape E'\\' or
      public.adreem_normalize_search_text(concat_ws(
        ' ',
        movement.movement_type,
        movement.status,
        case movement.movement_type
          when 'opening_balance' then 'رصيد افتتاحي'
          when 'transfer' then 'تحويل'
          when 'cash_deposit' then 'إيداع في المصرف'
          when 'cash_withdrawal' then 'سحب من المصرف'
          when 'expense' then 'مصروف'
          when 'truck_expense' then 'مصروف شاحنة'
          when 'truck_income' then 'دخل شاحنة'
          when 'usd_sale' then 'بعت دولار'
          when 'usd_purchase' then 'اشتريت دولار'
          when 'external_income' then 'دخل'
          when 'correction' then 'تعديل رصيد'
          else ''
        end,
        case movement.status
          when 'posted' then 'تم'
          when 'needs_review' then 'ناقص'
          when 'voided' then 'ملغي'
          when 'draft' then 'مسودة'
          else ''
        end
      )) ilike v_query_pattern escape E'\\' or
      exists (
        select 1
        from public.adreem_accounts as account
        where account.ledger_id = movement.ledger_id
          and account.owner_id = movement.owner_id
          and account.record_id in (
            movement.source_account_id,
            movement.destination_account_id,
            movement.expense_category_id
          )
          and public.adreem_normalize_search_text(concat_ws(
            ' ',
            account.name,
            account.payload ->> 'ownerName',
            account.payload ->> 'subAccountName',
            account.payload ->> 'legacyName',
            account.payload ->> 'type',
            account.payload ->> 'valueKind',
            account.payload ->> 'currencyKind'
          )) ilike v_query_pattern escape E'\\'
      ) or
      exists (
        select 1
        from public.adreem_dimensions as dimension
        where dimension.ledger_id = movement.ledger_id
          and dimension.owner_id = movement.owner_id
          and dimension.record_id = movement.dimension_id
          and public.adreem_normalize_search_text(concat_ws(
            ' ',
            dimension.name,
            dimension.payload ->> 'name',
            dimension.payload ->> 'type'
          )) ilike v_query_pattern escape E'\\'
      )
    )
  order by movement.sequence desc
  limit v_limit + 1;
end;
$$;

revoke all on function public.adreem_search_ledger_movements(uuid, uuid, bigint, integer, text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.adreem_search_ledger_movements(uuid, uuid, bigint, integer, text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean)
to authenticated, service_role;

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
        abs(coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0) - coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0)) +
        abs(coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0) - coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0))
      ) as weight,
      jsonb_build_object(
        'dimension', dimension.payload,
        'movementCount', count(movement.record_id)::bigint,
        'income', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0),
        'expense', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0),
        'net', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0) - coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'LYD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0),
        'incomeUsd', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0),
        'expenseUsd', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0),
        'netUsd', coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('external_income', 'truck_income')
        ), 0) - coalesce(sum(abs(movement.amount)) filter (
          where movement.currency = 'USD' and movement.movement_type in ('expense', 'truck_expense')
        ), 0)
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

create or replace function public.adreem_latest_account_attachments(
  p_ledger_id uuid,
  p_limit_per_account integer default 5
)
returns table (record_id text, payload jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select recent.record_id, recent.payload
  from public.adreem_accounts as account
  cross join lateral (
    select
      attachment.record_id,
      attachment.payload,
      attachment.updated_at
    from public.adreem_attachments as attachment
    where attachment.ledger_id = p_ledger_id
      and attachment.account_id = account.record_id
      and attachment.hidden_at is null
    order by attachment.updated_at desc, attachment.record_id desc
    limit least(greatest(coalesce(p_limit_per_account, 5), 1), 25)
  ) as recent
  where account.ledger_id = p_ledger_id
  order by account.record_id, recent.updated_at desc, recent.record_id desc;
$$;

revoke all on function public.adreem_latest_account_attachments(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.adreem_latest_account_attachments(uuid, integer) to authenticated, service_role;

create or replace function public.adreem_latest_reconciliations(p_ledger_id uuid)
returns table (record_id text, payload jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select latest.record_id, latest.payload
  from public.adreem_accounts as account
  cross join lateral (
    select
      reconciliation.record_id,
      reconciliation.payload,
      reconciliation.reconciled_at
    from public.adreem_reconciliations as reconciliation
    where reconciliation.ledger_id = p_ledger_id
      and reconciliation.account_id = account.record_id
    order by reconciliation.reconciled_at desc, reconciliation.record_id desc
    limit 1
  ) as latest
  where account.ledger_id = p_ledger_id
  order by latest.reconciled_at desc, latest.record_id desc;
$$;

revoke all on function public.adreem_latest_reconciliations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.adreem_latest_reconciliations(uuid) to authenticated, service_role;

create schema if not exists adreem_private;
revoke all on schema adreem_private from public, anon, authenticated;

create or replace function adreem_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_ledger_id text := nullif(new.raw_app_meta_data ->> 'adreem_legacy_ledger_id', '');
  v_telegram_user_id bigint;
begin
  if lower(coalesce(new.raw_app_meta_data ->> 'adreem_member', 'false')) <> 'true' then
    update public.adreem_profiles
    set is_active = false
    where id = new.id;
    return new;
  end if;

  if coalesce(new.raw_app_meta_data ->> 'adreem_telegram_user_id', '') ~ '^[0-9]+$' then
    v_telegram_user_id := (new.raw_app_meta_data ->> 'adreem_telegram_user_id')::bigint;
  end if;

  insert into public.adreem_profiles (
    id,
    email,
    display_name,
    telegram_user_id,
    language,
    is_system_owner,
    is_active
  ) values (
    new.id,
    coalesce(new.email, concat(new.id::text, '@invalid.local')),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), ''),
    v_telegram_user_id,
    case when new.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'ar' end,
    lower(coalesce(new.raw_app_meta_data ->> 'adreem_system_owner', 'false')) = 'true',
    lower(coalesce(new.raw_app_meta_data ->> 'adreem_disabled', 'true')) <> 'true'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    telegram_user_id = excluded.telegram_user_id,
    language = excluded.language,
    is_system_owner = excluded.is_system_owner,
    is_active = excluded.is_active;

  insert into public.adreem_ledgers (owner_id, legacy_ledger_id)
  values (new.id, v_legacy_ledger_id)
  on conflict (owner_id) do update set
    legacy_ledger_id = coalesce(public.adreem_ledgers.legacy_ledger_id, excluded.legacy_ledger_id);

  return new;
end;
$$;

revoke all on function adreem_private.handle_new_auth_user() from public, anon, authenticated, service_role;

drop trigger if exists adreem_on_auth_user_created on auth.users;
create trigger adreem_on_auth_user_created
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute function adreem_private.handle_new_auth_user();

insert into public.adreem_profiles (
  id,
  email,
  display_name,
  telegram_user_id,
  language,
  is_system_owner,
  is_active
)
select
  auth_user.id,
  coalesce(auth_user.email, concat(auth_user.id::text, '@invalid.local')),
  coalesce(nullif(auth_user.raw_user_meta_data ->> 'display_name', ''), ''),
  case
    when coalesce(auth_user.raw_app_meta_data ->> 'adreem_telegram_user_id', '') ~ '^[0-9]+$'
      then (auth_user.raw_app_meta_data ->> 'adreem_telegram_user_id')::bigint
    else null
  end,
  case when auth_user.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'ar' end,
  lower(coalesce(auth_user.raw_app_meta_data ->> 'adreem_system_owner', 'false')) = 'true',
  lower(coalesce(auth_user.raw_app_meta_data ->> 'adreem_disabled', 'true')) <> 'true'
from auth.users as auth_user
where lower(coalesce(auth_user.raw_app_meta_data ->> 'adreem_member', 'false')) = 'true'
on conflict (id) do update set
  email = excluded.email,
  display_name = excluded.display_name,
  telegram_user_id = excluded.telegram_user_id,
  language = excluded.language,
  is_system_owner = excluded.is_system_owner,
  is_active = excluded.is_active;

insert into public.adreem_ledgers (owner_id, legacy_ledger_id)
select
  auth_user.id,
  nullif(auth_user.raw_app_meta_data ->> 'adreem_legacy_ledger_id', '')
from auth.users as auth_user
where lower(coalesce(auth_user.raw_app_meta_data ->> 'adreem_member', 'false')) = 'true'
on conflict (owner_id) do update set
  legacy_ledger_id = coalesce(public.adreem_ledgers.legacy_ledger_id, excluded.legacy_ledger_id);

do $$
begin
  if exists (
    select 1
    from auth.users as auth_user
    left join public.adreem_profiles as profile on profile.id = auth_user.id
    left join public.adreem_ledgers as ledger on ledger.owner_id = auth_user.id
    where lower(coalesce(auth_user.raw_app_meta_data ->> 'adreem_member', 'false')) = 'true'
      and (profile.id is null or ledger.id is null)
  ) then
    raise exception 'ADREEM_AUTH_USER_BACKFILL_INCOMPLETE';
  end if;
end;
$$;
