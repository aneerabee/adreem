import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADREEM_MIGRATION_MARKER_KEY,
  ADREEM_STORAGE_KEY,
  MOHAMMAD_STORAGE_KEY,
  adreemStorageKeysForRowId,
  listLocalAdreemBackups,
  loadLocalMohammadState,
  restoreLatestLocalAdreemBackup,
  getMohammadPersistenceMode,
  saveMohammadPersistedState,
} from './mohammadPersistence.js'
import { ADREEM_LEDGER_VERSION } from './ledgerState.js'

function installLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
    },
  }
  return store
}

afterEach(() => {
  delete globalThis.window
  vi.unstubAllEnvs()
})

describe('adreem local persistence migration', () => {
  it('scopes ADREEM browser storage keys for non-main ledgers', () => {
    expect(adreemStorageKeysForRowId('adreem:adreem:main')).toEqual({
      state: 'adreem-ledger-v1',
      backup: 'adreem-ledger-backups-v1',
      migrationMarker: 'adreem-ledger-migration-v1',
      canReadLegacy: true,
    })
    expect(adreemStorageKeysForRowId('adreem:adreem:saeed-book')).toEqual({
      state: 'adreem-ledger-v1:adreem:adreem:saeed-book',
      backup: 'adreem-ledger-backups-v1:adreem:adreem:saeed-book',
      migrationMarker: 'adreem-ledger-migration-v1:adreem:adreem:saeed-book',
      canReadLegacy: false,
    })
  })

  it('reads the legacy Mohammad key once and writes the ADREEM key without deleting legacy data', () => {
    const legacyState = {
      version: 1,
      savedAt: '2026-05-20T10:00:00.000Z',
      accounts: [{ id: 'person-1', ownerName: 'سعيد', subAccountName: 'كاش' }],
      movements: [{ id: 'movement-1', createdAt: '2026-05-20T10:00:00.000Z' }],
    }
    const store = installLocalStorage({
      [MOHAMMAD_STORAGE_KEY]: JSON.stringify(legacyState),
    })

    const state = loadLocalMohammadState({ accounts: [], movements: [] })

    expect(state.version).toBe(ADREEM_LEDGER_VERSION)
    expect(state.migratedFrom).toBe('mohammad-ledger-v1')
    expect(state.accounts.map((account) => account.id)).toEqual(['person-1'])
    expect(JSON.parse(store.get(ADREEM_STORAGE_KEY)).version).toBe(ADREEM_LEDGER_VERSION)
    expect(JSON.parse(store.get(ADREEM_MIGRATION_MARKER_KEY)).from).toBe(MOHAMMAD_STORAGE_KEY)
    expect(store.get(MOHAMMAD_STORAGE_KEY)).toBe(JSON.stringify(legacyState))
  })

  it('merges ADREEM and legacy keys when both exist so old tabs cannot silently split the ledger', () => {
    installLocalStorage({
      [MOHAMMAD_STORAGE_KEY]: JSON.stringify({
        version: 1,
        savedAt: '2026-05-20T12:00:00.000Z',
        accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'كاش' }],
        movements: [],
      }),
      [ADREEM_STORAGE_KEY]: JSON.stringify({
        version: ADREEM_LEDGER_VERSION,
        savedAt: '2026-05-20T11:00:00.000Z',
        accounts: [{ id: 'adreem-account', ownerName: 'حديث', subAccountName: 'كاش' }],
        movements: [],
      }),
    })

    const state = loadLocalMohammadState({ accounts: [], movements: [] })

    expect(state.accounts.map((account) => account.id).sort()).toEqual(['adreem-account', 'legacy-account'])
  })

  it('falls back to valid legacy data when the ADREEM key is corrupted', () => {
    installLocalStorage({
      [ADREEM_STORAGE_KEY]: '{bad-json',
      [MOHAMMAD_STORAGE_KEY]: JSON.stringify({
        version: 1,
        savedAt: '2026-05-20T10:00:00.000Z',
        accounts: [{ id: 'legacy-account', ownerName: 'قديم', subAccountName: 'كاش' }],
        movements: [],
      }),
    })

    const state = loadLocalMohammadState({ accounts: [], movements: [] })

    expect(state.accounts.map((account) => account.id)).toEqual(['legacy-account'])
    expect(state.version).toBe(ADREEM_LEDGER_VERSION)
  })

  it('preserves ADREEM future collections when saving a partial accounts and movements payload', async () => {
    const store = installLocalStorage({
      [ADREEM_STORAGE_KEY]: JSON.stringify({
        version: ADREEM_LEDGER_VERSION,
        savedAt: '2026-05-20T10:00:00.000Z',
        accounts: [{ id: 'existing-account', ownerName: 'قديم', subAccountName: 'كاش' }],
        movements: [],
        dimensions: [{ id: 'truck-1', name: 'شاحنة' }],
        attachments: [{ id: 'att-1', movementId: 'movement-1' }],
        recurringRules: [{ id: 'monthly-1', name: 'شهري' }],
        reconciliations: [{ id: 'rec-1', accountId: 'existing-account' }],
        auditEvents: [{ id: 'audit-1', action: 'created' }],
      }),
    })

    const result = await saveMohammadPersistedState({
      accounts: [{ id: 'next-account', ownerName: 'جديد', subAccountName: 'كاش' }],
      movements: [{ id: 'movement-1', createdAt: '2026-05-20T11:00:00.000Z' }],
    })

    const persisted = JSON.parse(store.get(ADREEM_STORAGE_KEY))
    expect(result.state.accounts.map((account) => account.id)).toEqual(['next-account'])
    expect(persisted.dimensions.map((item) => item.id)).toEqual(['truck-1'])
    expect(persisted.attachments.map((item) => item.id)).toEqual(['att-1'])
    expect(persisted.recurringRules.map((item) => item.id)).toEqual(['monthly-1'])
    expect(persisted.reconciliations.map((item) => item.id)).toEqual(['rec-1'])
    expect(persisted.auditEvents.map((item) => item.id)).toEqual(['audit-1'])
  })

  it('keeps local snapshots and restores the latest backup internally', async () => {
    const store = installLocalStorage()
    await saveMohammadPersistedState({
      accounts: [{ id: 'backup-account', ownerName: 'نسخة', subAccountName: 'كاش' }],
      movements: [],
      dimensions: [],
      attachments: [],
      recurringRules: [],
      reconciliations: [],
      auditEvents: [],
    })
    store.set(ADREEM_STORAGE_KEY, JSON.stringify({
      version: ADREEM_LEDGER_VERSION,
      accounts: [],
      movements: [],
      savedAt: '2026-05-20T10:00:00.000Z',
    }))

    expect(listLocalAdreemBackups()).toHaveLength(1)
    const restored = restoreLatestLocalAdreemBackup({ accounts: [], movements: [] })

    expect(restored.accounts.map((account) => account.id)).toContain('backup-account')
    expect(JSON.parse(store.get(ADREEM_STORAGE_KEY)).accounts.map((account) => account.id)).toContain('backup-account')
  })

  it('does not enable direct Supabase persistence in production builds', () => {
    installLocalStorage()
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_ENABLE_SUPABASE_DIRECT', 'true')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    expect(getMohammadPersistenceMode()).toBe('local')
  })
})
