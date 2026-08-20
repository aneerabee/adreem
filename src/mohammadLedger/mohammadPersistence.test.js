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

  it('keeps concurrent new movements when recovering from a cloud conflict', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const baseState = {
      accounts: [],
      movements: [],
      savedAt: '2026-08-19T10:00:00.000Z',
    }
    const webMovement = {
      id: 'web-movement',
      note: 'web',
      createdAt: '2026-08-19T10:01:00.000Z',
      updatedAt: '2026-08-19T10:01:00.000Z',
    }
    const botMovement = {
      id: 'bot-movement',
      note: 'bot',
      createdAt: '2026-08-19T10:02:00.000Z',
      updatedAt: '2026-08-19T10:02:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: baseState, updatedAt: 'version-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => null },
        json: async () => ({ error: 'conflict' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: { ...baseState, movements: [botMovement], savedAt: botMovement.updatedAt },
          updatedAt: 'version-2',
        }),
      })
      .mockImplementationOnce(async (_url, options = {}) => {
        const request = JSON.parse(options.body)
        return {
          ok: true,
          json: async () => ({ state: request.state, updatedAt: 'version-3' }),
        }
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState(baseState)
    const result = await module.saveMohammadPersistedState({
      ...baseState,
      movements: [webMovement],
      savedAt: webMovement.updatedAt,
    })

    const putCalls = fetchMock.mock.calls.filter(([, options = {}]) => options.method === 'PUT')
    const retryRequest = JSON.parse(putCalls[1][1].body)
    expect(result.supabaseOk).toBe(true)
    expect(putCalls).toHaveLength(2)
    expect(retryRequest.baseUpdatedAt).toBe('version-2')
    expect(retryRequest.state.movements.map(({ id }) => id).sort()).toEqual(['bot-movement', 'web-movement'])
  })

  it('does not overwrite a record edited concurrently in the cloud', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const baseMovement = {
      id: 'shared-movement',
      note: 'base',
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z',
    }
    const baseState = {
      accounts: [],
      movements: [baseMovement],
      savedAt: baseMovement.updatedAt,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: baseState, updatedAt: 'version-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => null },
        json: async () => ({ error: 'conflict' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: {
            ...baseState,
            movements: [{ ...baseMovement, note: 'bot edit', updatedAt: '2026-08-19T10:01:00.000Z' }],
            savedAt: '2026-08-19T10:01:00.000Z',
          },
          updatedAt: 'version-2',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState(baseState)
    const result = await module.saveMohammadPersistedState({
      ...baseState,
      movements: [{ ...baseMovement, note: 'web edit', updatedAt: '2026-08-19T10:02:00.000Z' }],
      savedAt: '2026-08-19T10:02:00.000Z',
    })

    const putCalls = fetchMock.mock.calls.filter(([, options = {}]) => options.method === 'PUT')
    expect(putCalls).toHaveLength(1)
    expect(result.supabaseOk).toBe(false)
    expect(result.error).toMatchObject({
      status: 409,
      retryable: false,
      code: 'ledger-record-conflict',
      conflicts: [{ collection: 'movements', id: 'shared-movement' }],
    })
    expect(result.error.message).toContain('تعارض')
  })

  it('does not duplicate a movement when the server saved it but the response was lost', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const baseState = {
      accounts: [],
      movements: [],
      savedAt: '2026-08-19T10:00:00.000Z',
    }
    const movement = {
      id: 'response-lost-movement',
      createdAt: '2026-08-19T10:01:00.000Z',
      updatedAt: '2026-08-19T10:01:00.000Z',
    }
    let cloudState = baseState
    let cloudVersion = 'version-1'
    let putCount = 0
    const fetchMock = vi.fn(async (_url, options = {}) => {
      if (options.method !== 'PUT') {
        return { ok: true, json: async () => ({ state: cloudState, updatedAt: cloudVersion }) }
      }
      putCount += 1
      const request = JSON.parse(options.body)
      if (putCount === 1) {
        cloudState = request.state
        cloudVersion = 'version-2'
        throw new TypeError('response lost')
      }
      if (putCount === 2) {
        return {
          ok: false,
          status: 409,
          headers: { get: () => null },
          json: async () => ({ error: 'conflict' }),
        }
      }
      cloudState = request.state
      cloudVersion = 'version-3'
      return { ok: true, json: async () => ({ state: cloudState, updatedAt: cloudVersion }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const nextState = {
      ...baseState,
      movements: [movement],
      savedAt: movement.updatedAt,
    }

    await module.loadMohammadPersistedState(baseState)
    const lostResponse = await module.saveMohammadPersistedState(nextState)
    const recovered = await module.saveMohammadPersistedState(nextState)

    expect(lostResponse.error.retryable).toBe(true)
    expect(recovered.supabaseOk).toBe(true)
    expect(cloudState.movements).toHaveLength(1)
    expect(cloudState.movements[0].id).toBe(movement.id)
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

  it('shows a localized attachment error instead of leaking a server message', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'attachment-token' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ error: 'Attachment path is outside this ledger.' }),
    })))

    await expect(module.resolveAdreemAttachmentUrl({ storagePath: 'other/receipt.pdf' }))
      .rejects.toThrow('لا يمكنك فتح هذا المرفق.')
  })
})
