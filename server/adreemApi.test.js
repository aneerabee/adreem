import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAdreemApiHandler,
  parseLedgerTokenHashMap,
  parseLedgerTokenMap,
  parseTokenHashSet,
  tokenFromAuthHeader,
  tokenHash,
} from './adreemApi.js'

let tempDir = null

function tempRegistry(users) {
  tempDir = mkdtempSync(join(tmpdir(), 'adreem-api-users-'))
  const file = join(tempDir, 'users.json')
  writeFileSync(file, `${JSON.stringify({ users }, null, 2)}\n`)
  return file
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

function createMockResponse() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body || ''
    },
  }
}

function createJsonRequest(body, options = {}) {
  const listeners = {}
  return {
    method: options.method || 'PUT',
    url: options.url || '/api/ledger',
    headers: { authorization: `Bearer ${options.token || 'token-a'}` },
    setEncoding() {},
    on(event, handler) {
      listeners[event] = handler
      return this
    },
    destroy() {},
    emitBody() {
      listeners.data?.(JSON.stringify(body))
      listeners.end?.()
    },
  }
}

describe('ADREEM web API auth helpers', () => {
  it('parses private web tokens into isolated ledger ids', () => {
    const map = parseLedgerTokenMap('rabee-secret=main, saeed-secret=saeed-book')

    expect(map.get('rabee-secret')).toBe('main')
    expect(map.get('saeed-secret')).toBe('saeed-book')
  })

  it('parses hashed web tokens without storing the raw token in config', () => {
    const rabeeHash = tokenHash('rabee-secret')
    const map = parseLedgerTokenHashMap(`${rabeeHash}=main,not-a-real-hash=ignored`)

    expect(map.get(rabeeHash)).toBe('main')
    expect([...map.keys()].join(',')).not.toContain('rabee-secret')
    expect(map.has('not-a-real-hash')).toBe(false)
  })

  it('parses admin token hash sets without storing raw tokens', () => {
    const hash = tokenHash('admin-secret')
    const set = parseTokenHashSet(`${hash}, bad-token`)

    expect(set.has(hash)).toBe(true)
    expect([...set].join(',')).not.toContain('admin-secret')
    expect(set.has('bad-token')).toBe(false)
  })

  it('extracts bearer tokens safely', () => {
    expect(tokenFromAuthHeader('Bearer abc123')).toBe('abc123')
    expect(tokenFromAuthHeader('bearer token with spaces')).toBe('token with spaces')
    expect(tokenFromAuthHeader('abc123')).toBe('')
  })

  it('rejects unknown web tokens before any ledger access', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-a')}=main`,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const request = {
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: 'Bearer wrong-token' },
    }
    const response = createMockResponse()

    await api(request, response)

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body).error).toMatch(/Invalid ledger token/)
  })

  it('still rejects unknown web tokens when a test repository is installed', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-a')}=main`,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    api.__setRepositoryForTest?.({
      async load() {
        return { state: { accounts: [], movements: [] }, source: 'test' }
      },
    })
    const response = createMockResponse()

    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: 'Bearer wrong-token' },
    }, response)

    expect(response.statusCode).toBe(401)
  })

  it('routes different hashed web tokens to isolated repositories', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-a')}=rabee,${tokenHash('token-b')}=saeed`,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const requestedLedgers = []
    api.__setRepositoryFactoryForTest?.((ledgerId) => {
      requestedLedgers.push(ledgerId)
      return {
        async load() {
          return { state: { ledgerId, accounts: [], movements: [] }, source: 'test' }
        },
      }
    })

    for (const token of ['token-a', 'token-b']) {
      const response = createMockResponse()
      await api({
        method: 'GET',
        url: '/api/ledger',
        headers: { authorization: `Bearer ${token}` },
      }, response)
      expect(response.statusCode).toBe(200)
    }

    expect(requestedLedgers).toEqual(['rabee', 'saeed'])
  })

  it('routes registry web tokens without requiring an API restart', async () => {
    const token = 'dynamic-user-token'
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-a')}=main`,
      ADREEM_TELEGRAM_USERS_FILE: tempRegistry([
        { telegramUserId: '555', ledgerId: 'saeed-book', webTokenHash: tokenHash(token) },
      ]),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const requestedLedgers = []
    api.__setRepositoryFactoryForTest?.((ledgerId) => {
      requestedLedgers.push(ledgerId)
      return {
        async load() {
          return { state: { ledgerId, accounts: [], movements: [] }, source: 'test' }
        },
      }
    })
    const response = createMockResponse()

    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: `Bearer ${token}` },
    }, response)

    expect(response.statusCode).toBe(200)
    expect(requestedLedgers).toEqual(['saeed-book'])
  })

  it('merges PUT state with the latest repository state instead of replacing arrays', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKENS: 'token-a=main',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    let updateCallback = null
    const currentState = {
      accounts: [{ id: 'from-bot', updatedAt: '2026-01-01T10:00:00.000Z' }],
      movements: [{ id: 'bot-movement', updatedAt: '2026-01-01T10:01:00.000Z' }],
      savedAt: '2026-01-01T10:01:00.000Z',
      version: 2,
    }
    api.__setRepositoryForTest?.({
      async update(callback) {
        updateCallback = callback
        const result = await callback(currentState)
        return { ...result, state: result.state }
      },
    })

    const request = createJsonRequest({
      state: {
        accounts: [{ id: 'from-web', updatedAt: '2026-01-01T10:02:00.000Z' }],
        movements: [{ id: 'web-movement', updatedAt: '2026-01-01T10:03:00.000Z' }],
        savedAt: '2026-01-01T10:03:00.000Z',
        version: 2,
      },
    })
    const response = createMockResponse()
    const promise = api(request, response)
    request.emitBody()
    await promise

    const payload = JSON.parse(response.body)
    expect(updateCallback).toBeTruthy()
    expect(response.statusCode).toBe(200)
    expect(payload.state.accounts.map((account) => account.id).sort()).toEqual(['from-bot', 'from-web'])
    expect(payload.state.movements.map((movement) => movement.id).sort()).toEqual(['bot-movement', 'web-movement'])
  })

  it('rejects admin users endpoint without a valid admin token', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKENS: 'token-a=main',
      ADREEM_ADMIN_TOKEN_HASHES: tokenHash('admin-secret'),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const response = createMockResponse()

    await api({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: 'Bearer wrong-admin' },
    }, response)

    expect(response.statusCode).toBe(401)
  })

  it('creates independent users from the web admin API and routes their web token to the new ledger', async () => {
    const file = tempRegistry([])
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-a')}=main`,
      ADREEM_ADMIN_TOKEN_HASHES: tokenHash('admin-secret'),
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const createRequest = createJsonRequest({
      userId: 'saeed-book',
      displayName: 'سعيد',
      ledgerId: 'saeed-book',
      telegramUserId: '555',
    }, {
      method: 'POST',
      url: '/api/admin/users',
      token: 'admin-secret',
    })
    const createResponse = createMockResponse()
    const createPromise = api(createRequest, createResponse)
    createRequest.emitBody()
    await createPromise

    const payload = JSON.parse(createResponse.body)
    expect(createResponse.statusCode).toBe(201)
    expect(payload.user).toMatchObject({
      userId: 'saeed-book',
      ledgerId: 'saeed-book',
      telegramUserId: '555',
      displayName: 'سعيد',
    })
    expect(payload.webUrl).toMatch(/#ledger_token=/)

    const webToken = new URL(payload.webUrl).hash.replace(/^#ledger_token=/, '')
    const requestedLedgers = []
    api.__setRepositoryFactoryForTest?.((ledgerId) => {
      requestedLedgers.push(ledgerId)
      return {
        async load() {
          return { state: { ledgerId, accounts: [], movements: [] }, source: 'test' }
        },
      }
    })
    const ledgerResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: `Bearer ${webToken}` },
    }, ledgerResponse)

    expect(ledgerResponse.statusCode).toBe(200)
    expect(requestedLedgers).toEqual(['saeed-book'])
  })
})
