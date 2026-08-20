import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseStateRepository } from './supabaseStateRepository.js'

const CLAIM_CAS_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20260820215239_add_adreem_bot_state_claim_cas.sql', import.meta.url),
  'utf8',
)
const EFFECT_CAS_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20260820223000_add_adreem_bot_effect_cas.sql', import.meta.url),
  'utf8',
)

describe('Supabase Telegram state repository', () => {
  it('keeps every claim mutation security-definer and service-role only', () => {
    const functions = [
      'adreem_bot_state_get',
      'adreem_bot_state_claim',
      'adreem_bot_state_renew_claim',
      'adreem_bot_state_complete_claim',
      'adreem_bot_state_release_claim',
    ]

    for (const functionName of functions) {
      expect(CLAIM_CAS_MIGRATION).toContain(`revoke all on function public.${functionName}`)
      expect(CLAIM_CAS_MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${functionName}\\([^;]+\\) to service_role;`))
    }
    expect(CLAIM_CAS_MIGRATION.match(/security definer/g)).toHaveLength(5)
    expect(CLAIM_CAS_MIGRATION.match(/set search_path = ''/g)).toHaveLength(5)
    expect(CLAIM_CAS_MIGRATION).not.toMatch(/grant execute[^;]+to (public|anon|authenticated);/)
  })

  it('keeps effect reservations fenced by the update claim and service-role only', () => {
    const functions = [
      'adreem_bot_state_claim',
      'adreem_bot_state_fail_claim',
      'adreem_bot_state_claim_effect',
      'adreem_bot_state_complete_effect',
      'adreem_bot_state_clean_expired',
    ]

    for (const functionName of functions) {
      expect(EFFECT_CAS_MIGRATION).toContain(`revoke all on function public.${functionName}`)
      expect(EFFECT_CAS_MIGRATION).toMatch(new RegExp(String.raw`grant execute on function public\.${functionName}\([^;]+\) to service_role;`))
    }
    expect(EFFECT_CAS_MIGRATION.match(/security definer/g)).toHaveLength(5)
    expect(EFFECT_CAS_MIGRATION.match(/set search_path = ''/g)).toHaveLength(5)
    expect(EFFECT_CAS_MIGRATION).toContain("update_state.payload #>> '{value,claimId}' = p_claim_token")
    expect(EFFECT_CAS_MIGRATION).toContain("p_payload #>> '{value,status}' not in ('retrying', 'quarantined')")
    expect(EFFECT_CAS_MIGRATION).toContain("v_existing_payload #>> '{value,status}' in ('completed', 'quarantined')")
    expect(EFFECT_CAS_MIGRATION).toContain("'{value,failure,retryable}'")
    expect(EFFECT_CAS_MIGRATION).toContain("state.payload #>> '{value,status}' = 'processing'")
    expect(EFFECT_CAS_MIGRATION).not.toMatch(/grant execute[^;]+to (public|anon|authenticated);/)
  })

  it('stores state under one bot namespace', async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: null })) }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })

    await repository.set('session/1', { kind: 'session', value: { touchedAt: Date.now() } })

    expect(client.rpc).toHaveBeenCalledWith('adreem_bot_state_set', expect.objectContaining({
      p_bot_key: 'adreem-main',
      p_state_key: 'session/1',
      p_payload: expect.objectContaining({ kind: 'session' }),
      p_expires_at: expect.any(String),
    }))
  })

  it('passes a deep payload snapshot to persistence', async () => {
    let persistedPayload
    const client = {
      rpc: vi.fn(async (_name, parameters) => {
        persistedPayload = parameters.p_payload
        return { data: null, error: null }
      }),
    }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })
    const value = { kind: 'session', value: { draft: { amount: 20 }, touchedAt: Date.now() } }

    await repository.set('session/1', value)
    value.value.draft.amount = 999

    expect(persistedPayload.value.draft.amount).toBe(20)
  })

  it('returns a deep copy of a stored payload', async () => {
    const payload = { kind: 'session', value: { draft: { amount: 20 } } }
    const client = {
      rpc: vi.fn(async () => ({ data: { expiresAt: null, payload }, error: null })),
    }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })

    const loaded = await repository.get('session/1')
    loaded.value.draft.amount = 999

    expect(payload.value.draft.amount).toBe(20)
  })

  it('treats a duplicate processed update marker as already stored', async () => {
    const client = { rpc: vi.fn(async () => ({ data: false, error: null })) }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })
    await expect(repository.setIfAbsent('update/7', { kind: 'processed-update', value: {} })).resolves.toBe(false)
    expect(client.rpc).toHaveBeenCalledWith('adreem_bot_state_set_if_absent', expect.any(Object))
  })

  it('expires an in-progress update at its lease deadline', async () => {
    const leaseExpiresAt = new Date(Date.now() + 5_000).toISOString()
    const client = { rpc: vi.fn(async () => ({ data: true, error: null })) }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })

    await repository.setIfAbsent('update/8', {
      kind: 'processed-update',
      value: { status: 'processing', leaseExpiresAt },
    })

    expect(client.rpc).toHaveBeenCalledWith('adreem_bot_state_set_if_absent', expect.objectContaining({
      p_expires_at: leaseExpiresAt,
    }))
  })

  it('keeps missing reads side-effect free so cleanup cannot delete a newer lease', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: null,
      })),
    }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })

    await expect(repository.get('update/9')).resolves.toBeNull()

    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('adreem_bot_state_get', expect.any(Object))
  })

  it('cleans leases with a database-side expiry predicate before claiming', async () => {
    const client = { rpc: vi.fn(async () => ({ data: 1, error: null })) }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })
    const now = '2026-08-20T10:00:00.000Z'

    await repository.cleanExpired(now)

    expect(client.rpc).toHaveBeenCalledWith('adreem_bot_state_clean_expired', {
      p_bot_key: 'adreem-main',
    })
  })

  it('claims and renews leases atomically with the claim token', async () => {
    const claimPayload = {
      kind: 'processed-update',
      value: { updateId: 10, status: 'processing', claimId: 'claim-1' },
    }
    const renewedPayload = {
      ...claimPayload,
      value: { ...claimPayload.value, leaseExpiresAt: '2026-08-20T10:01:00.000Z' },
    }
    const client = {
      rpc: vi.fn(async (name) => ({
        data: name === 'adreem_bot_state_claim'
          ? { claimed: true, payload: claimPayload }
          : { updated: true, payload: renewedPayload },
        error: null,
      })),
    }
    const repository = createSupabaseStateRepository(client, { botKey: 'adreem-main' })

    await expect(repository.claim('update/10', claimPayload, 5_000)).resolves.toMatchObject({ claimed: true })
    await expect(repository.renewClaim('update/10', 'claim-1', claimPayload, 5_000)).resolves.toMatchObject({
      updated: true,
    })

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'adreem_bot_state_claim', {
      p_bot_key: 'adreem-main',
      p_state_key: 'update/10',
      p_payload: claimPayload,
      p_lease_ms: 5_000,
      p_retention_ms: 1_209_600_000,
    })
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'adreem_bot_state_renew_claim', {
      p_bot_key: 'adreem-main',
      p_state_key: 'update/10',
      p_claim_token: 'claim-1',
      p_payload: claimPayload,
      p_lease_ms: 5_000,
    })
  })

  it('completes, fails, and releases only the matching claim token', async () => {
    const client = { client: true, rpc: vi.fn(async () => ({ data: true, error: null })) }
    const repository = createSupabaseStateRepository(client, {
      botKey: 'adreem-main',
      updateRetentionMs: 60_000,
    })
    const completed = {
      kind: 'processed-update',
      value: { updateId: 11, status: 'completed' },
    }
    const retrying = {
      kind: 'processed-update',
      value: { updateId: 11, status: 'retrying', attempts: 1 },
    }

    await expect(repository.completeClaim('update/11', 'claim-2', completed)).resolves.toBe(true)
    await expect(repository.failClaim('update/11', 'claim-2', retrying)).resolves.toBe(true)
    await expect(repository.releaseClaim('update/11', 'claim-2')).resolves.toBe(true)

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'adreem_bot_state_complete_claim', {
      p_bot_key: 'adreem-main',
      p_state_key: 'update/11',
      p_claim_token: 'claim-2',
      p_payload: completed,
      p_retention_ms: 60_000,
    })
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'adreem_bot_state_fail_claim', {
      p_bot_key: 'adreem-main',
      p_state_key: 'update/11',
      p_claim_token: 'claim-2',
      p_payload: retrying,
      p_retention_ms: 60_000,
    })
    expect(client.rpc).toHaveBeenNthCalledWith(3, 'adreem_bot_state_release_claim', {
      p_bot_key: 'adreem-main',
      p_state_key: 'update/11',
      p_claim_token: 'claim-2',
    })
  })

  it('claims and completes external effects with the same fenced update token', async () => {
    const client = {
      rpc: vi.fn(async (name) => ({
        data: name === 'adreem_bot_state_claim_effect'
          ? { claimed: true, payload: { kind: 'update-effect', value: { status: 'processing' } } }
          : true,
        error: null,
      })),
    }
    const repository = createSupabaseStateRepository(client, {
      botKey: 'adreem-main',
      effectRetentionMs: 90_000,
    })
    const pending = { kind: 'update-effect', value: { status: 'processing', claimId: 'claim-3' } }
    const completed = { kind: 'update-effect', value: { status: 'completed', result: { message_id: 9 } } }

    await expect(repository.claimEffect('effect/12', 'update/12', 'claim-3', pending)).resolves.toMatchObject({ claimed: true })
    await expect(repository.completeEffect('effect/12', 'update/12', 'claim-3', completed)).resolves.toBe(true)

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'adreem_bot_state_claim_effect', {
      p_bot_key: 'adreem-main',
      p_update_state_key: 'update/12',
      p_claim_token: 'claim-3',
      p_effect_state_key: 'effect/12',
      p_payload: pending,
      p_retention_ms: 90_000,
    })
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'adreem_bot_state_complete_effect', {
      p_bot_key: 'adreem-main',
      p_update_state_key: 'update/12',
      p_claim_token: 'claim-3',
      p_effect_state_key: 'effect/12',
      p_payload: completed,
      p_retention_ms: 90_000,
    })
  })
})
