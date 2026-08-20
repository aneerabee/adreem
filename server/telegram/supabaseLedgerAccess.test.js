import { describe, expect, it, vi } from 'vitest'
import { createSupabaseTelegramLedgerAccess } from './supabaseLedgerAccess.js'

function queryResult(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  }
  return query
}

function fakeClient({ profile, ledger, profileError = null, ledgerError = null } = {}) {
  const profileQuery = queryResult({ data: profile || null, error: profileError })
  const ledgerQuery = queryResult({ data: ledger || null, error: ledgerError })
  return {
    from: vi.fn((table) => table === 'adreem_profiles' ? profileQuery : ledgerQuery),
    profileQuery,
    ledgerQuery,
  }
}

const env = {
  ADREEM_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

describe('Supabase Telegram ledger access', () => {
  it('stays disabled outside Supabase auth mode', () => {
    expect(createSupabaseTelegramLedgerAccess({})).toBeNull()
  })

  it('resolves an active Telegram user to exactly one owned ledger', async () => {
    const client = fakeClient({
      profile: {
        id: 'owner-a',
        display_name: 'Rabee',
        telegram_user_id: 278516861,
        language: 'en',
        is_system_owner: true,
        is_active: true,
      },
      ledger: { id: 'ledger-a', owner_id: 'owner-a', legacy_ledger_id: 'rabee' },
    })
    const createRepository = vi.fn(() => ({ load: vi.fn() }))
    const access = createSupabaseTelegramLedgerAccess(env, { client, createRepository })

    const identity = await access.resolve(278516861)

    expect(identity).toEqual(expect.objectContaining({
      ownerId: 'owner-a',
      ledgerId: 'ledger-a',
      legacyLedgerId: 'rabee',
      language: 'en',
      isOwner: true,
    }))
    expect(client.profileQuery.eq).toHaveBeenCalledWith('telegram_user_id', '278516861')
    expect(client.ledgerQuery.eq).toHaveBeenCalledWith('owner_id', 'owner-a')
    expect(access.repositoryFor(identity)).toBe(access.repositoryFor(identity))
    expect(createRepository).toHaveBeenCalledTimes(1)
    expect(createRepository).toHaveBeenCalledWith(client, { env, ledgerId: 'ledger-a', ownerId: 'owner-a' })
  })

  it('denies invalid, unknown, inactive, and mismatched users', async () => {
    const invalidAccess = createSupabaseTelegramLedgerAccess(env, { client: fakeClient() })
    expect(await invalidAccess.resolve('not-a-number')).toBeNull()

    const inactiveAccess = createSupabaseTelegramLedgerAccess(env, {
      client: fakeClient({ profile: { id: 'owner-a', is_active: false } }),
    })
    expect(await inactiveAccess.resolve('123')).toBeNull()

    const mismatchedAccess = createSupabaseTelegramLedgerAccess(env, {
      client: fakeClient({
        profile: { id: 'owner-a', is_active: true, language: 'ar' },
        ledger: { id: 'ledger-b', owner_id: 'owner-b' },
      }),
    })
    expect(await mismatchedAccess.resolve('123')).toBeNull()
  })

  it('surfaces database lookup failures without leaking configuration', async () => {
    const access = createSupabaseTelegramLedgerAccess(env, {
      client: fakeClient({ profileError: { message: 'profile lookup failed', code: 'PGRST001' } }),
    })
    await expect(access.resolve('123')).rejects.toMatchObject({ message: 'profile lookup failed', code: 'PGRST001' })
  })
})
