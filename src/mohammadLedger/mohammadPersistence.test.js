import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADREEM_LEDGER_VERSION } from './ledgerState.js'

function installBrowser(initial = {}) {
  const store = new Map(Object.entries(initial))
  const sessionStore = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      key: (index) => Array.from(store.keys())[index] || null,
      get length() { return store.size },
    },
    sessionStorage: {
      getItem: (key) => sessionStore.get(key) || null,
      setItem: (key, value) => sessionStore.set(key, String(value)),
      removeItem: (key) => sessionStore.delete(key),
    },
  }
  return { store, sessionStore }
}

async function persistenceWithApi(initial = {}) {
  const browser = installBrowser(initial)
  vi.stubEnv('VITE_ADREEM_API_URL', 'https://example.com/adreem-api')
  vi.resetModules()
  return { browser, module: await import('./mohammadPersistence.js') }
}

afterEach(() => {
  delete globalThis.window
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('ADREEM cloud-only persistence', () => {
  it('refuses to open a local ledger when the cloud API is not configured', async () => {
    installBrowser({ 'adreem-ledger-v1': JSON.stringify({ accounts: [{ id: 'old' }] }) })
    vi.resetModules()
    const module = await import('./mohammadPersistence.js')

    expect(module.getMohammadPersistenceMode()).toBe('configuration-error')
    const loaded = await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    expect(loaded.loadError).toBe(true)
    expect(loaded.state.accounts).toEqual([])
  })

  it('removes legacy ledger caches but keeps the remembered login', async () => {
    const { store } = installBrowser({
      'mohammad-ledger-v1': 'legacy',
      'adreem-ledger-v1': 'old',
      'adreem-ledger-backups-v1:old': 'backup',
      'adreem-ledger-api-token-v1': 'old-token',
      'adreem-ledger-api-login-token-v1': 'remembered-token',
    })
    vi.resetModules()
    const module = await import('./mohammadPersistence.js')

    module.clearLegacyBrowserLedgerData()

    expect(store.has('mohammad-ledger-v1')).toBe(false)
    expect(store.has('adreem-ledger-v1')).toBe(false)
    expect(store.has('adreem-ledger-backups-v1:old')).toBe(false)
    expect(store.has('adreem-ledger-api-token-v1')).toBe(false)
    expect(store.get('adreem-ledger-api-login-token-v1')).toBe('remembered-token')
  })

  it('uses API state as the only ledger source and clears stale browser data', async () => {
    const apiState = {
      version: ADREEM_LEDGER_VERSION,
      accounts: [{ id: 'cloud-account', ownerName: 'أنا', subAccountName: 'كاش' }],
      movements: [],
    }
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-v1': JSON.stringify({ accounts: [{ id: 'old-local' }] }),
      'adreem-ledger-api-login-token-v1': 'valid-token',
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: apiState, access: { canManageUsers: true }, profile: { userId: 'owner', language: 'en' } }),
    })))

    const result = await module.loadMohammadPersistedState({ accounts: [], movements: [] })

    expect(result.source).toBe('api')
    expect(result.access.canManageUsers).toBe(true)
    expect(result.profile).toMatchObject({ userId: 'owner', language: 'en' })
    expect(result.state.accounts.map((account) => account.id)).toEqual(['cloud-account'])
    expect(browser.store.has('adreem-ledger-v1')).toBe(false)
    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('valid-token')
  })

  it('saves only through the authenticated API', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const fetchMock = vi.fn(async (_url, options = {}) => ({
      ok: true,
      json: async () => ({ state: JSON.parse(options.body).state }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await module.saveMohammadPersistedState({ accounts: [{ id: 'cloud-only' }], movements: [] })

    expect(result.supabaseOk).toBe(true)
    expect(result.localOk).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/adreem-api/api/ledger', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ baseUpdatedAt: null })
  })

  it('does not fall back to browser data when the login token is missing', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-v1': JSON.stringify({ accounts: [{ id: 'old-local' }] }),
    })

    expect(module.getMohammadPersistenceMode()).toBe('api-missing-token')
    const loaded = await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const saved = await module.saveMohammadPersistedState({ accounts: [{ id: 'draft' }], movements: [] })

    expect(loaded.state.accounts).toEqual([])
    expect(saved.localOk).toBe(false)
    expect(browser.store.has('adreem-ledger-v1')).toBe(false)
  })

  it('keeps the remembered login active across browser sessions', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'remembered-token' })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ state: { accounts: [], movements: [] } }) }))
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })

    expect(module.getMohammadPersistenceMode()).toBe('api')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/adreem-api/api/ledger',
      expect.objectContaining({ headers: { authorization: 'Bearer remembered-token' } }),
    )
  })

  it('sends the cloud version received at load and advances it after save', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] }, updatedAt: 'version-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] }, updatedAt: 'version-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] }, updatedAt: 'version-3' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    await module.saveMohammadPersistedState({ accounts: [], movements: [] })
    await module.saveMohammadPersistedState({ accounts: [], movements: [] })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).baseUpdatedAt).toBe('version-1')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).baseUpdatedAt).toBe('version-2')
  })

  it('marks state conflicts as permanent until the user reloads or retries deliberately', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({ error: 'conflict' }),
    })))

    const result = await module.saveMohammadPersistedState({ accounts: [], movements: [] })

    expect(result.supabaseOk).toBe(false)
    expect(result.error.retryable).toBe(false)
  })

  it('resolves private attachments through the authenticated API', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'attachment-token' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ signedUrl: 'https://signed.example/receipt' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const attachment = { storagePath: 'main/2026-08-19/receipt.pdf' }

    await expect(module.resolveAdreemAttachmentUrl(attachment)).resolves.toBe('https://signed.example/receipt')
  })
})
