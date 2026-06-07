import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADREEM_MIGRATION_MARKER_KEY,
  ADREEM_STORAGE_KEY,
  MOHAMMAD_STORAGE_KEY,
  adreemStorageKeysForApiToken,
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
  const sessionStore = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
      key: (index) => Array.from(store.keys())[index] || null,
      get length() {
        return store.size
      },
    },
    sessionStorage: {
      getItem: (key) => sessionStore.get(key) || null,
      setItem: (key, value) => sessionStore.set(key, String(value)),
      removeItem: (key) => sessionStore.delete(key),
      clear: () => sessionStore.clear(),
    },
    location: {
      hash: '',
      pathname: '/adreem/',
      search: '',
    },
    history: {
      replaceState: vi.fn(),
    },
  }
  return store
}

afterEach(() => {
  delete globalThis.window
  vi.unstubAllGlobals()
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

  it('scopes API-token browser storage without writing the raw token into localStorage keys', () => {
    const tokenKeys = adreemStorageKeysForApiToken('secret-token-for-rabee')
    const otherTokenKeys = adreemStorageKeysForApiToken('secret-token-for-saeed')

    expect(tokenKeys.state).toMatch(/^adreem-ledger-v1:api:/)
    expect(tokenKeys.backup).toMatch(/^adreem-ledger-backups-v1:api:/)
    expect(tokenKeys.canReadLegacy).toBe(false)
    expect(tokenKeys.state).not.toContain('secret-token-for-rabee')
    expect(tokenKeys.state).not.toBe(otherTokenKeys.state)
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
    expect(listLocalAdreemBackups()[0].state.accounts.map((account) => account.id)).toEqual(['person-1'])
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

  it('keeps writing snapshots even when the previous backup list is corrupted', async () => {
    const store = installLocalStorage({
      'adreem-ledger-backups-v1': '{bad-json',
    })

    await saveMohammadPersistedState({
      accounts: [{ id: 'fresh-backup', ownerName: 'جديد', subAccountName: 'كاش' }],
      movements: [],
    })

    expect(JSON.parse(store.get('adreem-ledger-backups-v1'))[0].state.accounts.map((account) => account.id)).toEqual(['fresh-backup'])
  })

  it('does not enable direct Supabase persistence in production builds', () => {
    installLocalStorage()
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_ENABLE_SUPABASE_DIRECT', 'true')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    expect(getMohammadPersistenceMode()).toBe('local')
  })

  it('uses API state as source of truth instead of merging stale browser data', async () => {
    const staleLocalState = {
      version: ADREEM_LEDGER_VERSION,
      savedAt: '2026-06-08T10:00:00.000Z',
      accounts: [{ id: 'old-local-account', ownerName: 'قديم', subAccountName: 'كاش' }],
      movements: [{ id: 'old-local-movement', createdAt: '2026-06-08T10:00:00.000Z' }],
    }
    const apiState = {
      version: ADREEM_LEDGER_VERSION,
      savedAt: '2026-05-25T12:01:42.608Z',
      resetAt: '2026-05-25T12:01:42.608Z',
      accounts: [{ id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' }],
      movements: [],
    }
    const store = installLocalStorage({
      [ADREEM_STORAGE_KEY]: JSON.stringify(staleLocalState),
    })
    globalThis.window.location.hash = '#ledger_token=valid-token'
    vi.stubEnv('VITE_ADREEM_API_URL', 'https://example.com/adreem-api')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: apiState }),
    })))
    vi.resetModules()
    const {
      loadMohammadPersistedState: loadViaApi,
    } = await import('./mohammadPersistence.js')

    const result = await loadViaApi({ accounts: [], movements: [] })

    expect(result.source).toBe('api')
    expect(result.state.accounts.map((account) => account.id)).toEqual(['me-cash'])
    expect(result.state.movements).toEqual([])
    expect(store.has(ADREEM_STORAGE_KEY)).toBe(false)
    expect(store.has('adreem-ledger-api-token-v1')).toBe(false)
  })

  it('does not fall back to local data when the cloud API token is missing', async () => {
    const store = installLocalStorage({
      [ADREEM_STORAGE_KEY]: JSON.stringify({
        version: ADREEM_LEDGER_VERSION,
        savedAt: '2026-06-08T10:00:00.000Z',
        accounts: [{ id: 'old-local-account', ownerName: 'قديم', subAccountName: 'كاش' }],
        movements: [],
      }),
    })
    vi.stubEnv('VITE_ADREEM_API_URL', 'https://example.com/adreem-api')
    vi.resetModules()
    const {
      getMohammadPersistenceMode: mode,
      loadMohammadPersistedState: loadViaApi,
      saveMohammadPersistedState: saveViaApi,
    } = await import('./mohammadPersistence.js')

    const loaded = await loadViaApi({ accounts: [], movements: [] })
    const saved = await saveViaApi({ accounts: [{ id: 'draft-account' }], movements: [] })

    expect(mode()).toBe('api-missing-token')
    expect(loaded.source).toBe('api-missing-token')
    expect(loaded.state.accounts).toEqual([])
    expect(saved.mode).toBe('api-missing-token')
    expect(saved.localOk).toBe(false)
    expect(store.has(ADREEM_STORAGE_KEY)).toBe(false)
  })
})
