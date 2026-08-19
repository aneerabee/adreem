import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clientIp,
  createAdreemApiHandler,
  createMemoryRateLimiter,
  isLedgerStoragePath,
  parseLedgerTokenHashMap,
  parseLedgerTokenMap,
  tokenFromAuthHeader,
  tokenHash,
} from './adreemApi.js'
import { attachmentContentMatchesMime, decodeCanonicalBase64 } from './mohammadLedger/attachmentValidation.js'
import { createPasswordHash } from './telegram/userRegistry.js'

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

function registryPasswordUser({
  userId,
  displayName,
  email,
  password,
  ledgerId,
  telegramUserId = '',
}) {
  return {
    userId,
    displayName,
    email,
    passwordHash: createPasswordHash(password),
    ledgerId,
    telegramUserId,
  }
}

async function loginForToken(api, email, password) {
  const loginRequest = createJsonRequest({ email, password }, {
    method: 'POST',
    url: '/api/auth/login',
    token: '',
  })
  const loginResponse = createMockResponse()
  const loginPromise = api(loginRequest, loginResponse)
  loginRequest.emitBody()
  await loginPromise
  expect(loginResponse.statusCode).toBe(200)
  return JSON.parse(loginResponse.body).token
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

  it('extracts bearer tokens safely', () => {
    expect(tokenFromAuthHeader('Bearer abc123')).toBe('abc123')
    expect(tokenFromAuthHeader('bearer token with spaces')).toBe('token with spaces')
    expect(tokenFromAuthHeader('abc123')).toBe('')
  })

  it('keeps attachment paths inside the authenticated ledger folder', () => {
    expect(isLedgerStoragePath('main/2026-08-19/receipt.pdf', 'main')).toBe(true)
    expect(isLedgerStoragePath('other/2026-08-19/receipt.pdf', 'main')).toBe(false)
    expect(isLedgerStoragePath('../main/receipt.pdf', 'main')).toBe(false)
    expect(isLedgerStoragePath('main', 'main')).toBe(false)
  })

  it('uses the address added by the trusted proxy instead of a spoofed first value', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } })).toBe('203.0.113.7')
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
  })

  it('rejects malformed attachment data and verifies file signatures', () => {
    expect(() => decodeCanonicalBase64('not-base64')).toThrow(/invalid/i)
    expect(decodeCanonicalBase64(Buffer.from('%PDF-test').toString('base64')).toString()).toBe('%PDF-test')

    expect(attachmentContentMatchesMime(Buffer.from('%PDF-test'), 'application/pdf')).toBe(true)
    expect(attachmentContentMatchesMime(Buffer.from('%PDF-test'), 'image/jpeg')).toBe(false)
    expect(attachmentContentMatchesMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(true)
    expect(attachmentContentMatchesMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true)
    expect(attachmentContentMatchesMime(Buffer.from('RIFF0000WEBP'), 'image/webp')).toBe(true)
  })

  it('allows browser preflight for admin edit and delete requests', async () => {
    const api = createAdreemApiHandler({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const response = createMockResponse()

    await api({
      method: 'OPTIONS',
      url: '/api/admin/users/saeed-book',
      headers: {},
    }, response)

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['access-control-allow-methods']).toContain('PATCH')
    expect(response.headers['access-control-allow-methods']).toContain('DELETE')
  })

  it('marks authenticated responses as private and non-cacheable', async () => {
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: tempRegistry([
        registryPasswordUser({
          userId: 'main',
          displayName: 'Main',
          email: 'main@example.com',
          password: 'main-pass-123',
          ledgerId: 'main',
        }),
      ]),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const token = await loginForToken(api, 'main@example.com', 'main-pass-123')
    api.__setRepositoryForTest?.({
      async load() {
        return { state: { accounts: [], movements: [] }, source: 'test' }
      },
    })
    const response = createMockResponse()

    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: `Bearer ${token}` },
    }, response)

    expect(response.headers['cache-control']).toBe('no-store, private')
    expect(response.headers.pragma).toBe('no-cache')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('bounds and expires in-memory rate-limit buckets', () => {
    let now = 1_000
    const limiter = createMemoryRateLimiter(() => now, { maxBuckets: 3 })
    const rule = { limit: 2, windowMs: 100 }

    for (const key of ['a', 'b', 'c', 'd']) limiter.check(key, rule)
    expect(limiter.size()).toBeLessThanOrEqual(3)

    now = 1_200
    limiter.check('fresh', rule)
    expect(limiter.size()).toBe(1)
  })

  it('rejects unknown sessions before any ledger access', async () => {
    const api = createAdreemApiHandler({
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

  it('does not accept legacy env ledger tokens for ledger access', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKENS: 'token-a=main',
      ADREEM_WEB_LEDGER_TOKEN_HASHES: `${tokenHash('token-b')}=main`,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    api.__setRepositoryForTest?.({
      async load() {
        return { state: { accounts: [], movements: [] }, source: 'test' }
      },
    })

    for (const token of ['token-a', 'token-b']) {
      const response = createMockResponse()
      await api({
        method: 'GET',
        url: '/api/ledger',
        headers: { authorization: `Bearer ${token}` },
      }, response)

      expect(response.statusCode).toBe(401)
    }
  })

  it('still rejects unknown sessions when a test repository is installed', async () => {
    const api = createAdreemApiHandler({
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

  it('routes different email/password sessions to isolated repositories', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'rabee',
        displayName: 'Rabee',
        email: 'rabee@example.com',
        password: 'rabee-pass-123',
        ledgerId: 'rabee',
      }),
      registryPasswordUser({
        userId: 'saeed',
        displayName: 'Saeed',
        email: 'saeed@example.com',
        password: 'saeed-pass-123',
        ledgerId: 'saeed',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      ADREEM_OWNER_USER_IDS: 'rabee',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const tokenA = await loginForToken(api, 'rabee@example.com', 'rabee-pass-123')
    const tokenB = await loginForToken(api, 'saeed@example.com', 'saeed-pass-123')
    const requestedLedgers = []
    api.__setRepositoryFactoryForTest?.((ledgerId) => {
      requestedLedgers.push(ledgerId)
      return {
        async load() {
          return { state: { ledgerId, accounts: [], movements: [] }, source: 'test' }
        },
      }
    })

    const accessResults = []
    for (const token of [tokenA, tokenB]) {
      const response = createMockResponse()
      await api({
        method: 'GET',
        url: '/api/ledger',
        headers: { authorization: `Bearer ${token}` },
      }, response)
      expect(response.statusCode).toBe(200)
      accessResults.push(JSON.parse(response.body).access)
    }

    expect(requestedLedgers).toEqual(['rabee', 'saeed'])
    expect(accessResults).toEqual([
      { canManageUsers: true },
      { canManageUsers: false },
    ])
  })

  it('routes registry sessions without requiring an API restart', async () => {
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: tempRegistry([
        registryPasswordUser({
          userId: 'saeed-book',
          displayName: 'Saeed',
          email: 'saeed@example.com',
          password: 'saeed-pass-123',
          ledgerId: 'saeed-book',
          telegramUserId: '555',
        }),
      ]),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const token = await loginForToken(api, 'saeed@example.com', 'saeed-pass-123')
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
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'main',
        displayName: 'Main',
        email: 'main@example.com',
        password: 'main-pass-123',
        ledgerId: 'main',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const token = await loginForToken(api, 'main@example.com', 'main-pass-123')
    let updateCallback = null
    const currentState = {
      accounts: [{
        id: 'from-bot',
        ownerName: 'Bot',
        subAccountName: 'Main',
        type: 'person',
        valueKind: 'receivable',
        currencyKind: 'LYD',
        status: 'active',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      }],
      movements: [{
        id: 'bot-movement',
        type: 'transfer',
        status: 'needs_review',
        amount: 1,
        currency: 'LYD',
        createdAt: '2026-01-01T10:01:00.000Z',
        updatedAt: '2026-01-01T10:01:00.000Z',
      }],
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
        accounts: [{
          id: 'from-web',
          ownerName: 'Web',
          subAccountName: 'Main',
          type: 'person',
          valueKind: 'receivable',
          currencyKind: 'LYD',
          status: 'active',
          createdAt: '2026-01-01T10:02:00.000Z',
          updatedAt: '2026-01-01T10:02:00.000Z',
        }],
        movements: [{
          id: 'web-movement',
          type: 'transfer',
          status: 'needs_review',
          amount: 1,
          currency: 'LYD',
          createdAt: '2026-01-01T10:03:00.000Z',
          updatedAt: '2026-01-01T10:03:00.000Z',
        }],
        savedAt: '2026-01-01T10:03:00.000Z',
        version: 2,
      },
    }, {
      token,
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

  it('rejects posted web movements that violate ledger integrity', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'main',
        displayName: 'Main',
        email: 'main@example.com',
        password: 'main-pass-123',
        ledgerId: 'main',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const token = await loginForToken(api, 'main@example.com', 'main-pass-123')
    const currentState = {
      accounts: [{
        id: 'cash-main',
        ownerName: 'أنا',
        subAccountName: 'كاش',
        type: 'cash',
        valueKind: 'cash',
        currencyKind: 'LYD',
        status: 'active',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      }],
      movements: [],
      savedAt: '2026-01-01T10:00:00.000Z',
      version: 2,
    }
    api.__setRepositoryForTest?.({
      ledgerConfig: { identity: { ledgerId: 'main' } },
      async update(callback) {
        return callback(currentState)
      },
    })
    const request = createJsonRequest({
      state: {
        ...currentState,
        movements: [{
          id: 'expense-1',
          type: 'expense',
          status: 'posted',
          amount: 100,
          currency: 'LYD',
          sourceAccountId: 'cash-main',
          createdAt: '2026-01-01T10:01:00.000Z',
          updatedAt: '2026-01-01T10:01:00.000Z',
        }],
        savedAt: '2026-01-01T10:01:00.000Z',
      },
    }, { token })
    const response = createMockResponse()
    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(422)
    expect(JSON.parse(response.body).error).toContain('Ledger integrity check failed')
  })

  it('rejects admin users endpoint without a valid owner session', async () => {
    const api = createAdreemApiHandler({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const response = createMockResponse()

    await api({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: 'Bearer wrong-owner' },
    }, response)

    expect(response.statusCode).toBe(401)
  })

  it('allows the configured owner session to manage users without an admin token', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'owner-main',
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'owner-pass-123',
        ledgerId: 'owner-main',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_OWNER_EMAILS: 'owner@example.com',
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const ownerToken = await loginForToken(api, 'owner@example.com', 'owner-pass-123')

    const createRequest = createJsonRequest({
      userId: 'saeed-book',
      displayName: 'سعيد',
      email: 'saeed@example.com',
      password: 'strong-pass-123',
      ledgerId: 'saeed-book',
    }, {
      method: 'POST',
      url: '/api/admin/users',
      token: ownerToken,
    })
    const createResponse = createMockResponse()
    const createPromise = api(createRequest, createResponse)
    createRequest.emitBody()
    await createPromise

    expect(createResponse.statusCode).toBe(201)

    const listResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${ownerToken}` },
    }, listResponse)
    const listPayload = JSON.parse(listResponse.body)
    expect(listResponse.statusCode).toBe(200)
    expect(listPayload.owner).toMatchObject({ email: 'owner@example.com', ledgerId: 'owner-main' })
    expect(listPayload.users.map((user) => user.email).sort()).toEqual(['owner@example.com', 'saeed@example.com'])
  })

  it('blocks non-owner web sessions from the users admin API', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'normal-user',
        displayName: 'Normal',
        email: 'normal@example.com',
        password: 'normal-pass-123',
        ledgerId: 'normal-book',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_OWNER_EMAILS: 'owner@example.com',
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const normalToken = await loginForToken(api, 'normal@example.com', 'normal-pass-123')

    const adminResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${normalToken}` },
    }, adminResponse)

    expect(adminResponse.statusCode).toBe(401)
  })

  it('lets the owner update and remove user access while protecting the owner account', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'owner-main',
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'owner-pass-123',
        ledgerId: 'owner-main',
      }),
      registryPasswordUser({
        userId: 'saeed-book',
        displayName: 'سعيد',
        email: 'saeed@example.com',
        password: 'old-pass-123',
        ledgerId: 'saeed-book',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_OWNER_EMAILS: 'owner@example.com',
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const ownerToken = await loginForToken(api, 'owner@example.com', 'owner-pass-123')

    const updateRequest = createJsonRequest({
      displayName: 'سعيد الجديد',
      email: 'saeed-new@example.com',
      password: 'new-pass-123',
      ledgerId: 'saeed-book',
      telegramUserId: '555',
    }, {
      method: 'PATCH',
      url: '/api/admin/users/saeed-book',
      token: ownerToken,
    })
    const updateResponse = createMockResponse()
    const updatePromise = api(updateRequest, updateResponse)
    updateRequest.emitBody()
    await updatePromise

    expect(updateResponse.statusCode).toBe(200)
    expect(JSON.parse(updateResponse.body).user).toMatchObject({
      userId: 'saeed-book',
      displayName: 'سعيد الجديد',
      email: 'saeed-new@example.com',
      telegramUserId: '555',
    })
    const oldLoginRequest = createJsonRequest({ email: 'saeed@example.com', password: 'old-pass-123' }, {
      method: 'POST',
      url: '/api/auth/login',
      token: '',
    })
    const oldLoginResponse = createMockResponse()
    const oldLoginPromise = api(oldLoginRequest, oldLoginResponse)
    oldLoginRequest.emitBody()
    await oldLoginPromise
    expect(oldLoginResponse.statusCode).toBe(401)
    await loginForToken(api, 'saeed-new@example.com', 'new-pass-123')

    const ownerDeleteResponse = createMockResponse()
    await api({
      method: 'DELETE',
      url: '/api/admin/users/owner-main',
      headers: { authorization: `Bearer ${ownerToken}` },
    }, ownerDeleteResponse)
    expect(ownerDeleteResponse.statusCode).toBe(409)

    const deleteResponse = createMockResponse()
    await api({
      method: 'DELETE',
      url: '/api/admin/users/saeed-book',
      headers: { authorization: `Bearer ${ownerToken}` },
    }, deleteResponse)
    expect(deleteResponse.statusCode).toBe(200)

    const deletedLoginRequest = createJsonRequest({ email: 'saeed-new@example.com', password: 'new-pass-123' }, {
      method: 'POST',
      url: '/api/auth/login',
      token: '',
    })
    const deletedLoginResponse = createMockResponse()
    const deletedLoginPromise = api(deletedLoginRequest, deletedLoginResponse)
    deletedLoginRequest.emitBody()
    await deletedLoginPromise
    expect(deletedLoginResponse.statusCode).toBe(401)
  })

  it('creates independent users from the web admin API and routes email/password sessions to their ledger', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'owner-main',
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'owner-pass-123',
        ledgerId: 'owner-main',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_OWNER_EMAILS: 'owner@example.com',
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const ownerToken = await loginForToken(api, 'owner@example.com', 'owner-pass-123')
    const createRequest = createJsonRequest({
      userId: 'saeed-book',
      displayName: 'سعيد',
      email: 'saeed@example.com',
      password: 'strong-pass-123',
      ledgerId: 'saeed-book',
      telegramUserId: '555',
    }, {
      method: 'POST',
      url: '/api/admin/users',
      token: ownerToken,
    })
    const createResponse = createMockResponse()
    const createPromise = api(createRequest, createResponse)
    createRequest.emitBody()
    await createPromise

    const payload = JSON.parse(createResponse.body)
    expect(createResponse.statusCode).toBe(201)
    expect(payload.user).toMatchObject({
      userId: 'saeed-book',
      email: 'saeed@example.com',
      ledgerId: 'saeed-book',
      telegramUserId: '555',
      displayName: 'سعيد',
      hasPassword: true,
    })
    expect(payload.webUrl).toBeUndefined()

    const badLoginRequest = createJsonRequest({
      email: 'saeed@example.com',
      password: 'wrong-password',
    }, {
      method: 'POST',
      url: '/api/auth/login',
      token: '',
    })
    const badLoginResponse = createMockResponse()
    const badLoginPromise = api(badLoginRequest, badLoginResponse)
    badLoginRequest.emitBody()
    await badLoginPromise
    expect(badLoginResponse.statusCode).toBe(401)

    const loginRequest = createJsonRequest({
      email: 'SAEED@example.com',
      password: 'strong-pass-123',
    }, {
      method: 'POST',
      url: '/api/auth/login',
      token: '',
    })
    const loginResponse = createMockResponse()
    const loginPromise = api(loginRequest, loginResponse)
    loginRequest.emitBody()
    await loginPromise

    const loginPayload = JSON.parse(loginResponse.body)
    expect(loginResponse.statusCode).toBe(200)
    expect(loginPayload.token).toBeTruthy()
    expect(loginPayload.user).toMatchObject({
      userId: 'saeed-book',
      ledgerId: 'saeed-book',
      email: 'saeed@example.com',
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
    const ledgerResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: `Bearer ${loginPayload.token}` },
    }, ledgerResponse)

    expect(ledgerResponse.statusCode).toBe(200)
    expect(requestedLedgers).toEqual(['saeed-book'])
  })

  it('rate limits repeated failed login attempts', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'owner-main',
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'owner-pass-123',
        ledgerId: 'owner-main',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })

    let lastResponse = null
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const request = createJsonRequest({ email: 'owner@example.com', password: 'wrong-pass' }, {
        method: 'POST',
        url: '/api/auth/login',
        token: '',
      })
      const response = createMockResponse()
      const promise = api(request, response)
      request.emitBody()
      await promise
      lastResponse = response
    }

    expect(lastResponse.statusCode).toBe(429)
    expect(lastResponse.headers['retry-after']).toBeTruthy()
  })
})
