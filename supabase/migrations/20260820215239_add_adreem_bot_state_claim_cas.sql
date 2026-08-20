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
    and state.state_key = p_state_key
    and (state.expires_at is null or state.expires_at > now());
$$;

create or replace function public.adreem_bot_state_claim(
  p_bot_key text,
  p_state_key text,
  p_payload jsonb,
  p_lease_ms bigint
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
  v_inserted integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or p_lease_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' <> 'processing'
    or nullif(p_payload #>> '{value,claimId}', '') is null
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_CLAIM' using errcode = '22023';
  end if;

  v_expires_at := v_now + p_lease_ms * interval '1 millisecond';
  v_payload := jsonb_set(
    p_payload,
    '{value,leaseExpiresAt}',
    to_jsonb(v_expires_at),
    true
  );

  delete from adreem_private.adreem_bot_state
  where bot_key = p_bot_key
    and state_key = p_state_key
    and expires_at <= v_now;

  insert into adreem_private.adreem_bot_state (bot_key, state_key, payload, expires_at)
  values (p_bot_key, p_state_key, v_payload, v_expires_at)
  on conflict (bot_key, state_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    return jsonb_build_object(
      'claimed', true,
      'payload', v_payload,
      'expiresAt', v_expires_at
    );
  end if;

  select state.payload, state.expires_at
  into v_payload, v_expires_at
  from adreem_private.adreem_bot_state as state
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key;

  return jsonb_build_object(
    'claimed', false,
    'payload', v_payload,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.adreem_bot_state_renew_claim(
  p_bot_key text,
  p_state_key text,
  p_claim_token text,
  p_payload jsonb,
  p_lease_ms bigint
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
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or nullif(p_claim_token, '') is null
    or p_lease_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' <> 'processing'
    or p_payload #>> '{value,claimId}' <> p_claim_token
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_CLAIM' using errcode = '22023';
  end if;

  v_expires_at := v_now + p_lease_ms * interval '1 millisecond';
  v_payload := jsonb_set(
    p_payload,
    '{value,leaseExpiresAt}',
    to_jsonb(v_expires_at),
    true
  );

  update adreem_private.adreem_bot_state as state
  set payload = v_payload,
      expires_at = v_expires_at
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key
    and state.expires_at > v_now
    and state.payload #>> '{value,status}' = 'processing'
    and state.payload #>> '{value,claimId}' = p_claim_token
    and state.payload #>> '{value,updateId}' = v_payload #>> '{value,updateId}'
  returning state.payload, state.expires_at
  into v_payload, v_expires_at;

  if not found then
    return jsonb_build_object('updated', false);
  end if;

  return jsonb_build_object(
    'updated', true,
    'payload', v_payload,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.adreem_bot_state_complete_claim(
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
  v_payload jsonb;
  v_updated integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or nullif(p_claim_token, '') is null
    or p_retention_ms <= 0
    or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'value') <> 'object'
    or p_payload #>> '{value,status}' <> 'completed'
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_COMPLETION' using errcode = '22023';
  end if;

  v_payload := jsonb_set(
    p_payload,
    '{value,processedAt}',
    to_jsonb(v_now),
    true
  );

  update adreem_private.adreem_bot_state as state
  set payload = v_payload,
      expires_at = v_now + p_retention_ms * interval '1 millisecond'
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key
    and state.expires_at > v_now
    and state.payload #>> '{value,status}' = 'processing'
    and state.payload #>> '{value,claimId}' = p_claim_token
    and state.payload #>> '{value,updateId}' = v_payload #>> '{value,updateId}';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.adreem_bot_state_release_claim(
  p_bot_key text,
  p_state_key text,
  p_claim_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if nullif(p_bot_key, '') is null
    or nullif(p_state_key, '') is null
    or nullif(p_claim_token, '') is null
  then
    raise exception 'ADREEM_INVALID_BOT_STATE_CLAIM' using errcode = '22023';
  end if;

  delete from adreem_private.adreem_bot_state as state
  where state.bot_key = p_bot_key
    and state.state_key = p_state_key
    and state.payload #>> '{value,status}' = 'processing'
    and state.payload #>> '{value,claimId}' = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.adreem_bot_state_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_claim(text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_renew_claim(text, text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_complete_claim(text, text, text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.adreem_bot_state_release_claim(text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.adreem_bot_state_get(text, text) to service_role;
grant execute on function public.adreem_bot_state_claim(text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_renew_claim(text, text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_complete_claim(text, text, text, jsonb, bigint) to service_role;
grant execute on function public.adreem_bot_state_release_claim(text, text, text) to service_role;
