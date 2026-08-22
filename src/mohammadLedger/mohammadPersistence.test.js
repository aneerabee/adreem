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

  it('deletes an unused account at the loaded revision and remembers the authoritative response', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'cookie-v3' })
    const initialState = { accounts: [{ id: 'unused' }, { id: 'kept' }], movements: [] }
    const deletedState = { accounts: [{ id: 'kept' }], movements: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: initialState, storageMode: 'relational', revision: 4 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: deletedState,
          storageMode: 'relational',
          revision: 5,
          deletedAccountIds: ['unused'],
          movementPage: { hasMore: false, nextCursor: null },
          reports: { dimensions: [], expenseCategories: [] },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const result = await module.deleteAdreemUnusedAccount('unused', 4)

    expect(fetchMock.mock.calls[1]).toEqual([
      'https://example.com/adreem-api/api/accounts/unused',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        body: JSON.stringify({ baseRevision: 4 }),
      }),
    ])
    expect(result).toMatchObject({
      revision: 5,
      deletedAccountIds: ['unused'],
      state: { accounts: [{ id: 'kept' }] },
    })
  })

  it('deletes an unused account from the current production ledger at its loaded timestamp', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const initialState = { accounts: [{ id: 'unused' }, { id: 'kept' }], movements: [] }
    const deletedState = { accounts: [{ id: 'kept' }], movements: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: initialState, updatedAt: 'cloud-version-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: deletedState,
          storageMode: 'legacy',
          updatedAt: 'cloud-version-2',
          deletedAccountIds: ['unused'],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const result = await module.deleteAdreemUnusedAccount('unused')

    expect(fetchMock.mock.calls[1]).toEqual([
      'https://example.com/adreem-api/api/accounts/unused',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ baseUpdatedAt: 'cloud-version-1' }),
      }),
    ])
    expect(result).toMatchObject({
      storageMode: 'legacy',
      deletedAccountIds: ['unused'],
      state: { accounts: [{ id: 'kept' }] },
    })
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
            movements: [{ ...baseMovement, note: 'bot edit' }],
            savedAt: '2026-08-19T10:01:00.000Z',
          },
          updatedAt: 'version-2',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState(baseState)
    const result = await module.saveMohammadPersistedState({
      ...baseState,
      movements: [{ ...baseMovement, note: 'web edit' }],
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

  it('refreshes an expired access session once and remembers the rotated session', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'expired-token',
      'adreem-ledger-api-refresh-token-v1': 'refresh-1',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'expired' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'fresh-token', refreshToken: 'refresh-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await module.loadMohammadPersistedState({ accounts: [], movements: [] })

    expect(result.loadError).toBeUndefined()
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/adreem-api/api/auth/refresh')
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe('Bearer fresh-token')
    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('fresh-token')
    expect(browser.store.get('adreem-ledger-api-refresh-token-v1')).toBe('refresh-2')
  })

  it('remembers v3 with a non-secret marker and removes every browser-visible token', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'old-access-token',
      'adreem-ledger-api-refresh-token-v1': 'old-refresh-token',
    })
    browser.sessionStore.set('adreem-ledger-api-token-session-v1', 'tab-access-token')

    module.rememberAdreemCloudSession({
      authMode: 'cookie-v3',
      token: 'must-not-be-stored',
      refreshToken: 'must-not-be-stored-either',
    })

    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('cookie-v3')
    expect(browser.store.has('adreem-ledger-api-refresh-token-v1')).toBe(false)
    expect(browser.sessionStore.has('adreem-ledger-api-token-session-v1')).toBe(false)
    expect([...browser.store.values(), ...browser.sessionStore.values()]).not.toContain('must-not-be-stored')
    expect([...browser.store.values(), ...browser.sessionStore.values()]).not.toContain('must-not-be-stored-either')
  })

  it('uses credentialed cookie requests and refreshes without exposing tokens to JavaScript', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
      'adreem-ledger-api-refresh-token-v1': 'stale-visible-refresh-token',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'expired' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authMode: 'cookie-v3', expiresAt: '2026-08-20T13:00:00.000Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await module.loadMohammadPersistedState({ accounts: [], movements: [] })

    expect(result.loadError).toBeUndefined()
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/adreem-api/api/auth/refresh')
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.credentials).toBe('include')
      expect(options.headers.authorization).toBeUndefined()
      expect(options.headers.Authorization).toBeUndefined()
    }
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('cookie-v3')
    expect(browser.store.has('adreem-ledger-api-refresh-token-v1')).toBe(false)
  })

  it('retries a rotated cookie from another tab without clearing the remembered login', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'access expired' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => null },
        json: async () => ({ error: 'retry with the rotated cookie', code: 'adreem-session-rotated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authMode: 'cookie-v3', expiresAt: '2026-08-20T13:00:00.000Z' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { accounts: [], movements: [] } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await module.loadMohammadPersistedState({ accounts: [], movements: [] })

    expect(result.loadError).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/adreem-api/api/auth/refresh')
    expect(fetchMock.mock.calls[2][0]).toBe('https://example.com/adreem-api/api/auth/refresh')
    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('cookie-v3')
  })

  it.each([403, 503])('keeps the cookie-session marker after a temporary refresh failure with status %s', async (status) => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'access expired' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status,
        headers: { get: () => null },
        json: async () => ({ error: 'profile temporarily unavailable' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(module.adreemApiJson('/api/profile')).rejects.toMatchObject({ status })

    expect(browser.store.get('adreem-ledger-api-login-token-v1')).toBe('cookie-v3')
  })

  it('clears the cookie-session marker when refresh itself is rejected with 401', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'access expired' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'refresh expired' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(module.adreemApiJson('/api/profile')).rejects.toMatchObject({ status: 401 })

    expect(browser.store.has('adreem-ledger-api-login-token-v1')).toBe(false)
  })

  it('does not let a late refresh restore the marker after logout', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
    })
    let resolveRefresh
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/api/auth/refresh')) {
        return new Promise((resolve) => { resolveRefresh = resolve })
      }
      if (url.endsWith('/api/auth/logout')) {
        return { ok: true, status: 204, json: async () => ({}) }
      }
      return {
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: 'access expired' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const requestPending = module.adreemApiJson('/api/profile')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await module.logoutAdreemCloudSession()
    resolveRefresh({
      ok: true,
      json: async () => ({ authMode: 'cookie-v3', expiresAt: '2026-08-20T13:00:00.000Z' }),
    })

    await expect(requestPending).rejects.toMatchObject({ code: 'adreem-session-fenced' })
    expect(browser.store.has('adreem-ledger-api-login-token-v1')).toBe(false)
  })

  it('logs out v3 with cookies only and removes the non-secret browser marker', async () => {
    const { browser, module } = await persistenceWithApi({
      'adreem-ledger-api-login-token-v1': 'cookie-v3',
    })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => { throw new Error('empty response') },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await module.logoutAdreemCloudSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/adreem-api/api/auth/logout')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined()
    expect(browser.store.has('adreem-ledger-api-login-token-v1')).toBe(false)
  })

  it('sends only changed records with the relational revision', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const baseState = { accounts: [], movements: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: baseState,
          storageMode: 'relational',
          revision: 7,
          movementPage: { hasMore: false, nextCursor: null },
        }),
      })
      .mockImplementationOnce(async (_url, options = {}) => ({
        ok: true,
        json: async () => ({
          state: { accounts: [{ id: 'cash', updatedAt: '2026-08-20T18:00:00.000Z' }], movements: [] },
          storageMode: 'relational',
          revision: 8,
          movementPage: { hasMore: false, nextCursor: null },
          request: JSON.parse(options.body),
        }),
      }))
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState(baseState)
    const result = await module.saveMohammadPersistedState({
      accounts: [{ id: 'cash', updatedAt: '2026-08-20T18:00:00.000Z' }],
      movements: [],
    })

    const request = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(request).toEqual({
      baseRevision: 7,
      delta: { accounts: [{ id: 'cash', currencyKind: 'LYD', updatedAt: '2026-08-20T18:00:00.000Z' }] },
    })
    expect(request.state).toBeUndefined()
    expect(result.revision).toBe(8)
  })

  it('loads older relational movements by a stable cursor and merges without duplicates', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const newest = { id: 'm-100', databaseSequence: 100, updatedAt: '2026-08-20T18:00:00.000Z' }
    const older = { id: 'm-99', databaseSequence: 99, updatedAt: '2026-08-20T17:00:00.000Z' }
    const newestAttachment = { id: 'a-100', movementId: 'm-100', updatedAt: '2026-08-20T18:00:00.000Z' }
    const olderAttachment = { id: 'a-99', movementId: 'm-99', updatedAt: '2026-08-20T17:00:00.000Z' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: { accounts: [], movements: [newest], attachments: [newestAttachment] },
          storageMode: 'relational',
          revision: 1,
          movementPage: { hasMore: true, nextCursor: 100, limit: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          movements: [older],
          attachments: [olderAttachment, { ...newestAttachment, updatedAt: '2026-08-20T16:00:00.000Z' }],
          page: { hasMore: false, nextCursor: 99, limit: 1 },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const result = await module.loadMoreAdreemMovements({ before: 100, limit: 1 })

    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/adreem-api/api/movements?limit=1&before=100')
    expect(result.allMovements.map((movement) => movement.id)).toEqual(['m-99', 'm-100'])
    expect(result.allAttachments).toEqual([newestAttachment, olderAttachment])
    expect(result.page).toMatchObject({ hasMore: false, nextCursor: 99, loaded: 2 })
  })

  it('keeps accumulated page attachments when a save response contains only the first page', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const newest = { id: 'm-2', databaseSequence: 2, updatedAt: '2026-08-20T18:00:00.000Z' }
    const older = { id: 'm-1', databaseSequence: 1, updatedAt: '2026-08-20T17:00:00.000Z' }
    const newestAttachment = { id: 'a-2', movementId: 'm-2', updatedAt: '2026-08-20T18:00:00.000Z' }
    const olderAttachment = { id: 'a-1', movementId: 'm-1', updatedAt: '2026-08-20T17:00:00.000Z' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: { accounts: [], movements: [newest], attachments: [newestAttachment] },
          storageMode: 'relational',
          revision: 1,
          movementPage: { hasMore: true, nextCursor: 2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          movements: [older],
          attachments: [olderAttachment],
          revision: 1,
          page: { hasMore: false, nextCursor: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: {
            accounts: [{ id: 'cash', updatedAt: '2026-08-20T19:00:00.000Z' }],
            movements: [newest],
            attachments: [newestAttachment],
          },
          storageMode: 'relational',
          revision: 2,
          movementPage: { hasMore: true, nextCursor: 2 },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [], attachments: [] })
    const page = await module.loadAdreemMovementPage({ before: 2 })
    const saved = await module.saveMohammadPersistedState({
      accounts: [{ id: 'cash', updatedAt: '2026-08-20T19:00:00.000Z' }],
      movements: page.allMovements,
      attachments: page.allAttachments,
    })

    expect(saved.state.attachments.map((attachment) => attachment.id)).toEqual(['a-2', 'a-1'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('ignores a movement page that arrives after a newer relational save', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const initialMovement = { id: 'm-1', databaseSequence: 1, updatedAt: '2026-08-20T10:00:00.000Z' }
    const savedMovement = { id: 'm-2', databaseSequence: 2, updatedAt: '2026-08-20T11:00:00.000Z' }
    let resolvePage
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url.includes('/api/movements?')) return new Promise((resolve) => { resolvePage = resolve })
      if (options.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({
            state: { accounts: [], movements: [initialMovement, savedMovement] },
            storageMode: 'relational',
            revision: 2,
            movementPage: { hasMore: false, nextCursor: null },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          state: { accounts: [], movements: [initialMovement] },
          storageMode: 'relational',
          revision: 1,
          movementPage: { hasMore: true, nextCursor: 1 },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const pagePending = module.loadAdreemMovementPage({ before: 1 })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const save = await module.saveMohammadPersistedState({ accounts: [], movements: [initialMovement, savedMovement] })
    resolvePage({
      ok: true,
      json: async () => ({
        movements: [{ id: 'stale', databaseSequence: 0 }],
        revision: 1,
        page: { hasMore: false, nextCursor: null },
      }),
    })
    const page = await pagePending

    expect(save.revision).toBe(2)
    expect(page.stale).toBe(true)
    expect(page.allMovements.map((movement) => movement.id)).toEqual(['m-1', 'm-2'])
  })

  it('keeps movement pages with independent request keys active in the same epoch', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const initialMovement = { id: 'initial', databaseSequence: 3, updatedAt: '2026-08-20T10:00:00.000Z' }
    let resolveAccountPage
    let resolveHistoryPage
    const fetchMock = vi.fn((url) => {
      if (url.includes('/api/movements?') && url.includes('accountId=cash')) {
        return new Promise((resolve) => { resolveAccountPage = resolve })
      }
      if (url.includes('/api/movements?') && url.includes('q=fuel')) {
        return new Promise((resolve) => { resolveHistoryPage = resolve })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          state: { accounts: [], movements: [initialMovement] },
          storageMode: 'relational',
          revision: 7,
          movementPage: { hasMore: true, nextCursor: 3 },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const accountPending = module.loadAdreemMovementPage({ accountId: 'cash', requestKey: 'account-profile' })
    const historyPending = module.loadAdreemMovementPage({ query: 'fuel', requestKey: 'history' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    resolveAccountPage({
      ok: true,
      json: async () => ({
        movements: [{ id: 'account', databaseSequence: 2 }],
        revision: 7,
        page: { hasMore: false, nextCursor: 2 },
      }),
    })
    const accountPage = await accountPending
    resolveHistoryPage({
      ok: true,
      json: async () => ({
        movements: [{ id: 'history', databaseSequence: 1 }],
        revision: 7,
        page: { hasMore: false, nextCursor: 1 },
      }),
    })
    const historyPage = await historyPending

    expect(accountPage.stale).toBeUndefined()
    expect(historyPage.stale).toBeUndefined()
    expect(historyPage.allMovements.map((movement) => movement.id)).toEqual(['history', 'account', 'initial'])
  })

  it('requests authenticated cleanup for an uploaded orphan', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'cookie-v3' })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await module.deleteAdreemUploadedAttachment('owner/ledger/file.pdf')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/adreem-api/api/attachments?path=owner%2Fledger%2Ffile.pdf',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
  })

  it('cleans uploaded orphans in a deduplicated batch and reports guarded failures', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'cookie-v3' })
    const fetchMock = vi.fn(async (url) => url.includes('linked.pdf')
      ? {
          ok: false,
          status: 409,
          headers: { get: () => null },
          json: async () => ({ error: 'raw database detail' }),
        }
      : { ok: true, status: 204, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await module.cleanupAdreemUploadedAttachments([
      'owner/ledger/orphan.pdf',
      'owner/ledger/orphan.pdf',
      'owner/ledger/linked.pdf',
      '',
    ])

    expect(result).toEqual({
      deletedPaths: ['owner/ledger/orphan.pdf'],
      failedPaths: ['owner/ledger/linked.pdf'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads a filtered history page without resubmitting fetched records as new movements', async () => {
    const { module } = await persistenceWithApi({ 'adreem-ledger-api-login-token-v1': 'valid-token' })
    const newest = { id: 'm-100', databaseSequence: 100, updatedAt: '2026-08-20T18:00:00.000Z' }
    const filtered = { id: 'm-20', databaseSequence: 20, note: 'fuel', updatedAt: '2026-08-19T18:00:00.000Z' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: { accounts: [], movements: [newest] },
          storageMode: 'relational',
          revision: 4,
          movementPage: { hasMore: true, nextCursor: 100, limit: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ movements: [filtered], page: { hasMore: false, nextCursor: 20, limit: 25, total: 1 } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await module.loadMohammadPersistedState({ accounts: [], movements: [] })
    const page = await module.loadAdreemMovementPage({
      query: 'fuel',
      accountId: 'cash',
      status: 'posted',
      type: 'expense',
      dimensionId: 'truck',
      expenseCategoryId: 'fuel-category',
      limit: 25,
    })
    const save = await module.saveMohammadPersistedState({ accounts: [], movements: page.allMovements })

    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/adreem-api/api/movements?limit=25&q=fuel&accountId=cash&status=posted&type=expense&dimensionId=truck&expenseCategoryId=fuel-category')
    expect(page.movements).toEqual([filtered])
    expect(save.supabaseOk).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
