const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000
const DEFAULT_UPDATE_LEASE_MS = 30 * 1000
const DEFAULT_UPDATE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_EFFECT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

function cloneValue(value) {
  return structuredClone(value)
}

function storedExpiry(record = {}, now = Date.now(), options = {}) {
  if (record.kind === 'session') {
    const touchedAt = Number(record.value?.touchedAt || now)
    return new Date(touchedAt + Number(options.sessionTtlMs || DEFAULT_SESSION_TTL_MS)).toISOString()
  }
  if (record.kind === 'processed-update') {
    if (record.value?.status === 'processing') {
      const leaseExpiresAt = Date.parse(record.value?.leaseExpiresAt)
      if (Number.isFinite(leaseExpiresAt)) return new Date(leaseExpiresAt).toISOString()
      return new Date(now + Number(options.updateLeaseMs || DEFAULT_UPDATE_LEASE_MS)).toISOString()
    }
    return new Date(now + Number(options.updateRetentionMs || DEFAULT_UPDATE_RETENTION_MS)).toISOString()
  }
  if (record.kind === 'update-effect') {
    return new Date(now + Number(options.effectRetentionMs || DEFAULT_EFFECT_RETENTION_MS)).toISOString()
  }
  return null
}

function stateError(error, operation) {
  const next = new Error(error?.message || `Telegram state ${operation} failed.`)
  next.code = error?.code || ''
  return next
}

export function createSupabaseStateRepository(client, { botKey, ...options } = {}) {
  const normalizedBotKey = String(botKey || '').trim()
  if (!client) throw new TypeError('Supabase Telegram state repository requires a client.')
  if (!normalizedBotKey) throw new TypeError('Supabase Telegram state repository requires a bot key.')

  return {
    async get(key) {
      const { data, error } = await client.rpc('adreem_bot_state_get', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
      })
      if (error) throw stateError(error, 'read')
      if (!data) return null
      return cloneValue(data.payload)
    },

    async set(key, value) {
      const payload = cloneValue(value)
      const { error } = await client.rpc('adreem_bot_state_set', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_payload: payload,
        p_expires_at: storedExpiry(payload, Date.now(), options),
      })
      if (error) throw stateError(error, 'write')
    },

    async delete(key) {
      const { data, error } = await client.rpc('adreem_bot_state_delete', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
      })
      if (error) throw stateError(error, 'delete')
      return Boolean(data)
    },

    async setIfAbsent(key, value) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_set_if_absent', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_payload: payload,
        p_expires_at: storedExpiry(payload, Date.now(), options),
      })
      if (error) throw stateError(error, 'insert')
      return Boolean(data)
    },

    async claim(
      key,
      value,
      leaseMs = options.updateLeaseMs || DEFAULT_UPDATE_LEASE_MS,
      retentionMs = options.updateRetentionMs || DEFAULT_UPDATE_RETENTION_MS,
    ) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_claim', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_payload: payload,
        p_lease_ms: Number(leaseMs),
        p_retention_ms: Number(retentionMs),
      })
      if (error) throw stateError(error, 'claim')
      return cloneValue(data)
    },

    async renewClaim(key, claimToken, value, leaseMs = options.updateLeaseMs || DEFAULT_UPDATE_LEASE_MS) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_renew_claim', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_claim_token: claimToken,
        p_payload: payload,
        p_lease_ms: Number(leaseMs),
      })
      if (error) throw stateError(error, 'renew claim')
      return cloneValue(data)
    },

    async completeClaim(key, claimToken, value) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_complete_claim', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_claim_token: claimToken,
        p_payload: payload,
        p_retention_ms: Number(options.updateRetentionMs || DEFAULT_UPDATE_RETENTION_MS),
      })
      if (error) throw stateError(error, 'complete claim')
      return Boolean(data)
    },

    async failClaim(key, claimToken, value, retentionMs = options.updateRetentionMs || DEFAULT_UPDATE_RETENTION_MS) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_fail_claim', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_claim_token: claimToken,
        p_payload: payload,
        p_retention_ms: Number(retentionMs),
      })
      if (error) throw stateError(error, 'fail claim')
      return Boolean(data)
    },

    async releaseClaim(key, claimToken) {
      const { data, error } = await client.rpc('adreem_bot_state_release_claim', {
        p_bot_key: normalizedBotKey,
        p_state_key: key,
        p_claim_token: claimToken,
      })
      if (error) throw stateError(error, 'release claim')
      return Boolean(data)
    },

    async claimEffect(key, updateKey, claimToken, value, retentionMs = options.effectRetentionMs || DEFAULT_EFFECT_RETENTION_MS) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_claim_effect', {
        p_bot_key: normalizedBotKey,
        p_update_state_key: updateKey,
        p_claim_token: claimToken,
        p_effect_state_key: key,
        p_payload: payload,
        p_retention_ms: Number(retentionMs),
      })
      if (error) throw stateError(error, 'claim effect')
      return cloneValue(data)
    },

    async completeEffect(key, updateKey, claimToken, value, retentionMs = options.effectRetentionMs || DEFAULT_EFFECT_RETENTION_MS) {
      const payload = cloneValue(value)
      const { data, error } = await client.rpc('adreem_bot_state_complete_effect', {
        p_bot_key: normalizedBotKey,
        p_update_state_key: updateKey,
        p_claim_token: claimToken,
        p_effect_state_key: key,
        p_payload: payload,
        p_retention_ms: Number(retentionMs),
      })
      if (error) throw stateError(error, 'complete effect')
      return Boolean(data)
    },

    async cleanExpired() {
      const { error } = await client.rpc('adreem_bot_state_clean_expired', {
        p_bot_key: normalizedBotKey,
      })
      if (error) throw stateError(error, 'cleanup')
    },
  }
}
