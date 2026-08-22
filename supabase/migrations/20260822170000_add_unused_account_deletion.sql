create or replace function public.adreem_delete_unused_account(
  p_ledger_id uuid,
  p_account_id text,
  p_expected_revision bigint,
  p_owner_id uuid default null
)
returns table (
  revision bigint,
  updated_at timestamptz,
  deleted_account_ids text[]
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
  v_updated_at timestamptz;
  v_counterparty_id text;
  v_target_account_ids text[];
  v_dimension_ids text[];
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
  if nullif(btrim(p_account_id), '') is null then
    raise exception 'ADREEM_ACCOUNT_ID_REQUIRED' using errcode = '22023';
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

  select nullif(account.payload ->> 'counterpartyId', '')
  into v_counterparty_id
  from public.adreem_accounts as account
  where account.ledger_id = p_ledger_id
    and account.owner_id = v_owner_id
    and account.record_id = p_account_id;

  if not found then
    raise exception 'ADREEM_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select array_agg(account.record_id order by account.record_id)
  into v_target_account_ids
  from public.adreem_accounts as account
  where account.ledger_id = p_ledger_id
    and account.owner_id = v_owner_id
    and (
      account.record_id = p_account_id
      or (v_counterparty_id is not null and account.payload ->> 'counterpartyId' = v_counterparty_id)
    );

  if exists (
    select 1
    from public.adreem_accounts as account
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and account.record_id = any(v_target_account_ids)
      and account.account_type in ('summary', 'review')
  ) then
    raise exception 'ADREEM_ACCOUNT_DELETE_PROTECTED' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.adreem_accounts as account
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and account.record_id = any(v_target_account_ids)
      and (
        account.balance_dinar <> 0
        or account.balance_usd <> 0
        or account.posted_count <> 0
        or account.structure_locked
      )
  ) then
    raise exception 'ADREEM_ACCOUNT_DELETE_IN_USE' using errcode = '23503';
  end if;

  select coalesce(array_agg(dimension.record_id order by dimension.record_id), array[]::text[])
  into v_dimension_ids
  from public.adreem_dimensions as dimension
  where dimension.ledger_id = p_ledger_id
    and dimension.owner_id = v_owner_id
    and (
      dimension.payload ->> 'linkedAccountId' = any(v_target_account_ids)
      or dimension.record_id in (
        select coalesce(nullif(account.payload ->> 'dimensionId', ''), 'dimension-account-' || account.record_id)
        from public.adreem_accounts as account
        where account.ledger_id = p_ledger_id
          and account.owner_id = v_owner_id
          and account.record_id = any(v_target_account_ids)
          and account.value_kind in ('project', 'asset')
      )
    );

  if exists (
    select 1
    from public.adreem_movements as movement
    where movement.ledger_id = p_ledger_id
      and movement.owner_id = v_owner_id
      and (
        movement.source_account_id = any(v_target_account_ids)
        or movement.destination_account_id = any(v_target_account_ids)
        or movement.expense_category_id = any(v_target_account_ids)
        or movement.payload ->> 'sourceAccountId' = any(v_target_account_ids)
        or movement.payload ->> 'destinationAccountId' = any(v_target_account_ids)
        or movement.payload ->> 'expenseCategoryId' = any(v_target_account_ids)
        or (cardinality(v_dimension_ids) > 0 and movement.dimension_id = any(v_dimension_ids))
        or (cardinality(v_dimension_ids) > 0 and movement.payload ->> 'dimensionId' = any(v_dimension_ids))
      )
  ) or exists (
    select 1
    from public.adreem_movement_entries as entry
    where entry.ledger_id = p_ledger_id
      and entry.owner_id = v_owner_id
      and entry.account_id = any(v_target_account_ids)
  ) or exists (
    select 1
    from public.adreem_attachments as attachment
    where attachment.ledger_id = p_ledger_id
      and attachment.owner_id = v_owner_id
      and attachment.account_id = any(v_target_account_ids)
  ) or exists (
    select 1
    from public.adreem_reconciliations as reconciliation
    where reconciliation.ledger_id = p_ledger_id
      and reconciliation.owner_id = v_owner_id
      and reconciliation.account_id = any(v_target_account_ids)
  ) or exists (
    select 1
    from public.adreem_recurring_rules as rule
    where rule.ledger_id = p_ledger_id
      and rule.owner_id = v_owner_id
      and (
        rule.payload #>> '{template,sourceAccountId}' = any(v_target_account_ids)
        or rule.payload #>> '{template,destinationAccountId}' = any(v_target_account_ids)
        or rule.payload #>> '{template,expenseCategoryId}' = any(v_target_account_ids)
        or (cardinality(v_dimension_ids) > 0 and rule.payload #>> '{template,dimensionId}' = any(v_dimension_ids))
      )
  ) or exists (
    select 1
    from public.adreem_accounts as account
    where account.ledger_id = p_ledger_id
      and account.owner_id = v_owner_id
      and not (account.record_id = any(v_target_account_ids))
      and (
        account.payload ->> 'mergedIntoAccountId' = any(v_target_account_ids)
        or account.payload ->> 'mergedFromAccountId' = any(v_target_account_ids)
        or account.payload ->> 'linkedAccountId' = any(v_target_account_ids)
      )
  ) then
    raise exception 'ADREEM_ACCOUNT_DELETE_LINKED' using errcode = '23503';
  end if;

  delete from public.adreem_audit_events as audit
  where audit.ledger_id = p_ledger_id
    and audit.owner_id = v_owner_id
    and (
      audit.payload #>> '{details,accountId}' = any(v_target_account_ids)
      or audit.payload #>> '{details,sourceAccountId}' = any(v_target_account_ids)
      or audit.payload #>> '{details,targetAccountId}' = any(v_target_account_ids)
      or exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(audit.payload #> '{details,accountIds}') = 'array'
              then audit.payload #> '{details,accountIds}'
            else '[]'::jsonb
          end
        ) as related(account_id)
        where related.account_id = any(v_target_account_ids)
      )
    );

  delete from public.adreem_ignored_external_accounts as ignored
  where ignored.ledger_id = p_ledger_id
    and ignored.owner_id = v_owner_id
    and ignored.account_id = any(v_target_account_ids);

  if cardinality(v_dimension_ids) > 0 then
    delete from public.adreem_dimensions as dimension
    where dimension.ledger_id = p_ledger_id
      and dimension.owner_id = v_owner_id
      and dimension.record_id = any(v_dimension_ids);
  end if;

  delete from public.adreem_accounts as account
  where account.ledger_id = p_ledger_id
    and account.owner_id = v_owner_id
    and account.record_id = any(v_target_account_ids);

  if not found then
    raise exception 'ADREEM_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.adreem_ledgers as ledger
  set revision = ledger.revision + 1
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
    'unused_account_deleted',
    jsonb_build_object(
      'accountIds', to_jsonb(v_target_account_ids),
      'revision', v_current_revision,
      'previousRevision', p_expected_revision,
      'requestRole', v_request_role
    )
  );

  return query select v_current_revision, v_updated_at, v_target_account_ids;
end;
$$;

revoke all on function public.adreem_delete_unused_account(uuid, text, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.adreem_delete_unused_account(uuid, text, bigint, uuid) to authenticated, service_role;
