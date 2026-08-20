drop function if exists public.adreem_bot_state_claim(text, text, jsonb, bigint);
drop function if exists public.adreem_bot_state_claim(text, text, jsonb, bigint, bigint);

create function public.adreem_bot_state_claim(
  p_bot_key text,
  p_state_key text,
  p_payload jsonb,
  p_lease_ms bigint,
  p_retention_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_payload jsonb;
  v_existing_payload jsonb;
  v_existing_expires_at timestamptz;
  v_attempts integer;
  v_max_attempts integer;
  v_inserted integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or p_lease_ms <= 0
    or p_retention_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'kind' <> 'processed-update'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' <> 'processing'
    or nullif(p_payload #>> '{value,claimId}', '') is null
    or nullif(p_payload #>> '{value,updateId}', '') is null
    or coalesce((p_payload #>> '{value,maxAttempts}')::integer, 0) <= 0
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_CLAIM' using errcode = '22023';
  end if;

  v_expires_at := v_now + p_lease_ms * interval '1 millisecond';
  v_payload := jsonb_set(
    jsonb_set(p_payload, '{value,attempts}', to_jsonb(1), true),
    '{value,leaseExpiresAt}',
    to_jsonb(v_expires_at),
    true
  );

  insert into adreem_private.adreem_bot_state (bot_key, state_key, payload, expires_at)
  values (p_bot_key, p_state_key, v_payload, v_expires_at)
  on conflict (bot_key, state_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    return jsonb_build_object('claimed', true, 'payload', v_payload, 'expiresAt', v_expires_at);
  end if;

  select state.payload, state.expires_at
  into v_existing_payload, v_existing_expires_at
  from adreem_private.adreem_bot_state as state
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key
  for update;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  if v_existing_payload #>> '{value,updateId}' is distinct from p_payload #>> '{value,updateId}' then
    raise exception 'ADREEM_BOT_STATE_UPDATE_MISMATCH' using errcode = '22023';
  end if;
  if v_existing_payload #>> '{value,status}' in ('completed', 'quarantined') then
    return jsonb_build_object(
      'claimed', false,
      'payload', v_existing_payload,
      'expiresAt', v_existing_expires_at
    );
  end if;
  if v_existing_payload #>> '{value,status}' = 'processing' and v_existing_expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'payload', v_existing_payload,
      'expiresAt', v_existing_expires_at
    );
  end if;
  if v_existing_payload #>> '{value,status}' not in ('processing', 'retrying') then
    raise exception 'ADREEM_INVALID_BOT_STATE_CLAIM_TRANSITION' using errcode = '22023';
  end if;

  v_attempts := greatest(coalesce((v_existing_payload #>> '{value,attempts}')::integer, 1), 1);
  v_max_attempts := (p_payload #>> '{value,maxAttempts}')::integer;
  if v_attempts >= v_max_attempts then
    v_payload := (v_existing_payload #- '{value,claimId}') #- '{value,leaseExpiresAt}';
    v_payload := jsonb_set(v_payload, '{value,status}', to_jsonb('quarantined'::text), true);
    v_payload := jsonb_set(v_payload, '{value,quarantinedAt}', to_jsonb(v_now), true);
    if v_payload #> '{value,lastFailure}' is null then
      v_payload := jsonb_set(
        v_payload,
        '{value,lastFailure}',
        jsonb_build_object(
          'name', 'Error',
          'message', 'Telegram update exhausted its retry limit after an expired claim.',
          'code', 'TELEGRAM_UPDATE_ATTEMPTS_EXHAUSTED',
          'retryable', false
        ),
        true
      );
    end if;
    v_expires_at := v_now + p_retention_ms * interval '1 millisecond';
    update adreem_private.adreem_bot_state as state
    set payload = v_payload,
        expires_at = v_expires_at
    where state.bot_key = p_bot_key
      and state.state_key = p_state_key;
    return jsonb_build_object('claimed', false, 'payload', v_payload, 'expiresAt', v_expires_at);
  end if;

  v_payload := jsonb_set(p_payload, '{value,attempts}', to_jsonb(v_attempts + 1), true);
  v_payload := jsonb_set(v_payload, '{value,leaseExpiresAt}', to_jsonb(v_expires_at), true);
  if v_existing_payload #> '{value,lastFailure}' is not null then
    v_payload := jsonb_set(v_payload, '{value,lastFailure}', v_existing_payload #> '{value,lastFailure}', true);
  end if;

  update adreem_private.adreem_bot_state as state
  set payload = v_payload,
      expires_at = v_expires_at
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key;

  return jsonb_build_object('claimed', true, 'payload', v_payload, 'expiresAt', v_expires_at);
end;
$$;

create or replace function public.adreem_bot_state_fail_claim(
  p_bot_key text,
  p_state_key text,
  p_claim_token text,
  p_payload jsonb,
  p_retention_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or nullif(p_claim_token, '') is null
    or p_retention_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'kind' <> 'processed-update'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' not in ('retrying', 'quarantined')
    or nullif(p_payload #>> '{value,updateId}', '') is null
    or coalesce((p_payload #>> '{value,attempts}')::integer, 0) <= 0
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_FAILURE' using errcode = '22023';
  end if;

  update adreem_private.adreem_bot_state as state
  set payload = p_payload,
      expires_at = v_now + p_retention_ms * interval '1 millisecond'
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key
    and state.expires_at > v_now
    and state.payload #>> '{value,status}' = 'processing'
    and state.payload #>> '{value,claimId}' = p_claim_token
    and state.payload #>> '{value,updateId}' = p_payload #>> '{value,updateId}';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.adreem_bot_state_claim_effect(
  p_bot_key text,
  p_update_state_key text,
  p_claim_token text,
  p_effect_state_key text,
  p_payload jsonb,
  p_retention_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
  v_update_id text;
  v_inserted integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_update_state_key, '') is null
    or nullif(p_claim_token, '') is null
    or nullif(p_effect_state_key, '') is null
    or p_retention_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'kind' <> 'update-effect'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' <> 'processing'
    or p_payload #>> '{value,claimId}' <> p_claim_token
    or nullif(p_payload #>> '{value,updateId}', '') is null
    or nullif(p_payload #>> '{value,effectId}', '') is null
  then
    raise exception 'ADREEM_INVALID_BOT_EFFECT_CLAIM' using errcode = '22023';
  end if;

  select update_state.payload #>> '{value,updateId}'
  into v_update_id
  from adreem_private.adreem_bot_state as update_state
  where update_state.bot_key = p_bot_key
    and update_state.state_key = p_update_state_key
    and update_state.expires_at > v_now
    and update_state.payload #>> '{value,status}' = 'processing'
    and update_state.payload #>> '{value,claimId}' = p_claim_token
  for update;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  if v_update_id is distinct from p_payload #>> '{value,updateId}' then
    raise exception 'ADREEM_BOT_EFFECT_UPDATE_MISMATCH' using errcode = '22023';
  end if;

  insert into adreem_private.adreem_bot_state (bot_key, state_key, payload, expires_at)
  values (
    p_bot_key,
    p_effect_state_key,
    p_payload,
    v_now + p_retention_ms * interval '1 millisecond'
  )
  on conflict (bot_key, state_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    return jsonb_build_object('claimed', true, 'payload', p_payload);
  end if;

  select effect_state.payload
  into v_payload
  from adreem_private.adreem_bot_state as effect_state
  where effect_state.bot_key = p_bot_key
    and effect_state.state_key = p_effect_state_key
  for update;

  if v_payload #>> '{value,updateId}' is distinct from p_payload #>> '{value,updateId}'
    or v_payload #>> '{value,effectId}' is distinct from p_payload #>> '{value,effectId}'
  then
    raise exception 'ADREEM_BOT_EFFECT_IDENTITY_MISMATCH' using errcode = '22023';
  end if;

  if v_payload #>> '{value,status}' = 'failed'
    and coalesce((v_payload #>> '{value,failure,retryable}')::boolean, false)
  then
    update adreem_private.adreem_bot_state as effect_state
    set payload = p_payload,
        expires_at = v_now + p_retention_ms * interval '1 millisecond'
    where effect_state.bot_key = p_bot_key
      and effect_state.state_key = p_effect_state_key
      and effect_state.payload #>> '{value,status}' = 'failed'
      and coalesce((effect_state.payload #>> '{value,failure,retryable}')::boolean, false);
    return jsonb_build_object('claimed', true, 'payload', p_payload);
  end if;

  return jsonb_build_object('claimed', false, 'payload', v_payload);
end;
$$;

create or replace function public.adreem_bot_state_complete_effect(
  p_bot_key text,
  p_update_state_key text,
  p_claim_token text,
  p_effect_state_key text,
  p_payload jsonb,
  p_retention_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_update_id text;
  v_updated integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_update_state_key, '') is null
    or nullif(p_claim_token, '') is null
    or nullif(p_effect_state_key, '') is null
    or p_retention_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'kind' <> 'update-effect'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' not in ('completed', 'failed')
    or p_payload #>> '{value,claimId}' <> p_claim_token
    or nullif(p_payload #>> '{value,updateId}', '') is null
    or nullif(p_payload #>> '{value,effectId}', '') is null
  then
    raise exception 'ADREEM_INVALID_BOT_EFFECT_COMPLETION' using errcode = '22023';
  end if;

  select update_state.payload #>> '{value,updateId}'
  into v_update_id
  from adreem_private.adreem_bot_state as update_state
  where update_state.bot_key = p_bot_key
    and update_state.state_key = p_update_state_key
    and update_state.expires_at > v_now
    and update_state.payload #>> '{value,status}' = 'processing'
    and update_state.payload #>> '{value,claimId}' = p_claim_token
  for update;

  if not found then
    return false;
  end if;
  if v_update_id is distinct from p_payload #>> '{value,updateId}' then
    raise exception 'ADREEM_BOT_EFFECT_UPDATE_MISMATCH' using errcode = '22023';
  end if;

  update adreem_private.adreem_bot_state as effect_state
  set payload = p_payload,
      expires_at = v_now + p_retention_ms * interval '1 millisecond'
  where effect_state.bot_key = p_bot_key
    and effect_state.state_key = p_effect_state_key
    and effect_state.payload #>> '{value,status}' = 'processing'
    and effect_state.payload #>> '{value,claimId}' = p_claim_token
    and effect_state.payload #>> '{value,updateId}' = p_payload #>> '{value,updateId}'
    and effect_state.payload #>> '{value,effectId}' = p_payload #>> '{value,effectId}';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
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
  delete from adreem_private.adreem_bot_state as state
  where state.bot_key = p_bot_key
    and state.expires_at < p_now
    and not (
      state.payload ->> 'kind' = 'processed-update'
      and state.payload #>> '{value,status}' = 'processing'
    )
    and not (
      state.payload ->> 'kind' = 'update-effect'
      and state.payload #>> '{value,status}' = 'processing'
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.adreem_bot_state_claim(text, text, jsonb, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_fail_claim(text, text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_claim_effect(text, text, text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_complete_effect(text, text, text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_clean_expired(text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.adreem_bot_state_claim(text, text, jsonb, bigint, bigint) to service_role;
grant execute on function public.adreem_bot_state_fail_claim(text, text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_claim_effect(text, text, text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_complete_effect(text, text, text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_clean_expired(text, timestamptz) to service_role;
