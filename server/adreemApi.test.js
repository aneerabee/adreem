import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  userIdFromAdminPath,
} from './adreemApi.js'
import { attachmentContentMatchesMime, decodeCanonicalBase64 } from './ledger/attachmentValidation.js'
import { ConcurrentLedgerUpdateError } from './ledger/ledgerRepository.js'
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
  language = 'ar',
}) {
  return {
    userId,
    displayName,
    email,
    passwordHash: createPasswordHash(password),
    ledgerId,
    telegramUserId,
    language,
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

  it('rejects malformed encoded admin user paths without crashing', () => {
    expect(userIdFromAdminPath('/api/admin/users/saeed-book')).toBe('saeed-book')
    expect(userIdFromAdminPath('/api/admin/users/%E0%A4%A')).toBe('')
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
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n%%EOF')
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(15), Buffer.from([0xff, 0xd9])])
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from('IHDR'),
      Buffer.alloc(17),
    ])
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])
    expect(decodeCanonicalBase64(pdf.toString('base64'))).toEqual(pdf)

    expect(attachmentContentMatchesMime(pdf, 'application/pdf')).toBe(true)
    expect(attachmentContentMatchesMime(pdf, 'image/jpeg')).toBe(false)
    expect(attachmentContentMatchesMime(jpeg, 'image/jpeg')).toBe(true)
    expect(attachmentContentMatchesMime(png, 'image/png')).toBe(true)
    expect(attachmentContentMatchesMime(webp, 'image/webp')).toBe(true)
    expect(attachmentContentMatchesMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(false)
    expect(attachmentContentMatchesMime(Buffer.from('%PDF-'), 'application/pdf')).toBe(false)
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

  it('ships a restrictive browser policy that allows the configured API connection', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("default-src 'self';")
    expect(html).toContain("connect-src 'self' %VITE_ADREEM_API_URL% %VITE_ADREEM_API_URL%/;")
    expect(html).toContain("object-src 'none';")
    expect(html).not.toContain("'unsafe-eval'")
    expect(html).not.toContain("'unsafe-inline'")
  })

  it('reports readiness only after the cloud repository is reachable', async () => {
    const api = createAdreemApiHandler({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    api.__setRepositoryForTest?.({
      async load() {
        return { state: { accounts: [], movements: [] }, updatedAt: 'cloud-version' }
      },
    })
    const response = createMockResponse()

    await api({ method: 'GET', url: '/ready', headers: {} }, response)

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, storage: 'reachable', updatedAt: 'cloud-version' })
  })

  it('revokes the current cloud session on logout', async () => {
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
    const logoutResponse = createMockResponse()

    await api({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
      socket: {},
    }, logoutResponse)

    expect(logoutResponse.statusCode).toBe(204)

    const ledgerResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/ledger',
      headers: { authorization: `Bearer ${token}` },
    }, ledgerResponse)
    expect(ledgerResponse.statusCode).toBe(401)
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
    let updateOptions = null
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
      async update(callback, options) {
        updateCallback = callback
        updateOptions = options
        const result = await callback(currentState)
        return { ...result, state: result.state, updatedAt: 'cloud-version-2' }
      },
    })

    const request = createJsonRequest({
      baseUpdatedAt: 'cloud-version-1',
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
    expect(updateOptions).toEqual({ expectedUpdatedAt: 'cloud-version-1' })
    expect(response.statusCode).toBe(200)
    expect(payload.updatedAt).toBe('cloud-version-2')
    expect(payload.state.accounts.map((account) => account.id).sort()).toEqual(['from-bot', 'from-web'])
    expect(payload.state.movements.map((movement) => movement.id).sort()).toEqual(['bot-movement', 'web-movement'])
  })

  it('deletes an unused legacy account through a versioned protected request', async () => {
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
        id: 'unused account',
        ownerName: 'أنا',
        subAccountName: 'إضافي',
        type: 'cash',
        valueKind: 'cash',
        currencyKind: 'LYD',
        status: 'active',
      }],
      movements: [],
      auditEvents: [{ id: 'created', details: { accountId: 'unused account' } }],
    }
    let updateOptions = null
    api.__setRepositoryForTest?.({
      ledgerConfig: { identity: { ledgerId: 'main' } },
      async update(callback, options) {
        updateOptions = options
        const result = await callback(currentState)
        return { ...result, updatedAt: 'cloud-version-2' }
      },
    })
    const request = createJsonRequest({ baseUpdatedAt: 'cloud-version-1' }, {
      token,
      method: 'DELETE',
      url: '/api/accounts/unused%20account',
    })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    const payload = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(updateOptions).toEqual({
      expectedUpdatedAt: 'cloud-version-1',
      allowUnusedAccountDeletion: true,
    })
    expect(payload.state.accounts).toEqual([])
    expect(payload.state.auditEvents).toEqual([])
    expect(payload.deletedAccountIds).toEqual(['unused account'])
    expect(payload.storageMode).toBe('legacy')
  })

  it('rejects deleting a legacy account linked to any record', async () => {
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
    const account = { id: 'used', type: 'cash', valueKind: 'cash', currencyKind: 'LYD', status: 'active' }
    api.__setRepositoryForTest?.({
      async update(callback) {
        return callback({ accounts: [account], movements: [], attachments: [{ id: 'file', accountId: account.id }] })
      },
    })
    const request = createJsonRequest({ baseUpdatedAt: 'cloud-version-1' }, {
      token,
      method: 'DELETE',
      url: '/api/accounts/used',
    })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body).error).toContain('ارتبط')
  })

  it('records committed movement changes with safe server-derived before and after values', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'main',
        displayName: 'Main',
        email: 'main@example.com',
        password: 'main-pass-123',
        ledgerId: 'main',
      }),
    ])
    const auditFile = join(tempDir, 'audit.jsonl')
    const api = createAdreemApiHandler({
      ADREEM_AUDIT_LOG_FILE: auditFile,
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const token = await loginForToken(api, 'main@example.com', 'main-pass-123')
    const currentState = {
      accounts: [],
      movements: [{
        id: 'movement-1',
        type: 'transfer',
        status: 'needs_review',
        amount: 10,
        currency: 'LYD',
        note: 'private-before-note',
        apiToken: 'before-secret-token',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      }],
      savedAt: '2026-01-01T10:00:00.000Z',
      version: 2,
    }
    api.__setRepositoryForTest?.({
      ledgerConfig: { identity: { ledgerId: 'main' } },
      async update(callback) {
        const result = await callback(currentState)
        return { ...result, updatedAt: 'cloud-version-2' }
      },
    })
    const request = createJsonRequest({
      baseUpdatedAt: 'cloud-version-1',
      state: {
        ...currentState,
        movements: [{
          ...currentState.movements[0],
          amount: 25,
          note: 'private-after-note',
          apiToken: 'after-secret-token',
          updatedAt: '2026-01-01T10:01:00.000Z',
        }],
        savedAt: '2026-01-01T10:01:00.000Z',
      },
    }, { token })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    const records = readFileSync(auditFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const saveRecord = records.find((record) => record.action === 'ledger.saved')
    expect(response.statusCode).toBe(200)
    expect(saveRecord.movementUpdates).toEqual([expect.objectContaining({
      movementId: 'movement-1',
      changedFields: expect.arrayContaining(['amount', 'updatedAt']),
      redactedFieldChanges: 2,
      before: expect.objectContaining({ amount: 10 }),
      after: expect.objectContaining({ amount: 25 }),
    })])
    expect(JSON.stringify(saveRecord)).not.toContain('private-before-note')
    expect(JSON.stringify(saveRecord)).not.toContain('private-after-note')
    expect(JSON.stringify(saveRecord)).not.toContain('secret-token')
  })

  it('returns a conflict instead of silently overwriting a newer cloud version', async () => {
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
    api.__setRepositoryForTest?.({
      async update() {
        throw new ConcurrentLedgerUpdateError()
      },
    })
    const request = createJsonRequest({
      baseUpdatedAt: 'stale-version',
      state: { accounts: [], movements: [], version: 2 },
    }, { token })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body).error).toContain('جهاز آخر')
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
    let rejectedState = null
    api.__setRepositoryForTest?.({
      ledgerConfig: { identity: { ledgerId: 'main' } },
      backupRejected(state) {
        rejectedState = state
      },
      async update(callback) {
        return callback(currentState)
      },
    })
    const request = createJsonRequest({
      baseUpdatedAt: null,
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
    expect(rejectedState?.movements).toHaveLength(1)
    expect(rejectedState?.movements?.[0]?.id).toBe('expense-1')
  })

  it('requires the web client ledger version before accepting a save', async () => {
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
    const request = createJsonRequest({ state: { accounts: [], movements: [], version: 2 } }, { token })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(428)
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

  it('fails during API creation when the registry conflicts with the configured Telegram ledger map', () => {
    const file = tempRegistry([
      {
        userId: 'registry-100',
        telegramUserId: '100',
        ledgerId: 'registry-ledger',
      },
    ])

    expect(() => createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })).toThrow('Invalid Telegram ledger assignments')
  })

  it('returns 409 when creating a user with a Telegram id configured for another ledger', async () => {
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
      ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const ownerToken = await loginForToken(api, 'owner@example.com', 'owner-pass-123')
    const request = createJsonRequest({
      userId: 'registry-100',
      telegramUserId: '100',
      ledgerId: 'registry-ledger',
    }, {
      method: 'POST',
      url: '/api/admin/users',
      token: ownerToken,
    })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'telegram-used', existingUserId: '100' })
  })

  it('returns 409 when updating a user to a Telegram id configured for another ledger', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'owner-main',
        displayName: 'Owner',
        email: 'owner@example.com',
        password: 'owner-pass-123',
        ledgerId: 'owner-main',
      }),
      registryPasswordUser({
        userId: 'registry-user',
        displayName: 'Registry user',
        email: 'registry@example.com',
        password: 'registry-pass-123',
        ledgerId: 'registry-ledger',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_OWNER_EMAILS: 'owner@example.com',
      ADREEM_TELEGRAM_USERS_FILE: file,
      ADREEM_TELEGRAM_LEDGER_IDS: '100=config-ledger',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const ownerToken = await loginForToken(api, 'owner@example.com', 'owner-pass-123')
    const request = createJsonRequest({ telegramUserId: '100' }, {
      method: 'PATCH',
      url: '/api/admin/users/registry-user',
      token: ownerToken,
    })
    const response = createMockResponse()

    const promise = api(request, response)
    request.emitBody()
    await promise

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'telegram-used', existingUserId: '100' })
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

  it('rejects an owner identity edit that would remove administration and keeps the session active', async () => {
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
    const updateRequest = createJsonRequest({ email: 'renamed@example.com' }, {
      method: 'PATCH',
      url: '/api/admin/users/owner-main',
      token: ownerToken,
    })
    const updateResponse = createMockResponse()

    const updatePromise = api(updateRequest, updateResponse)
    updateRequest.emitBody()
    await updatePromise

    const listResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${ownerToken}` },
    }, listResponse)
    expect(updateResponse.statusCode).toBe(409)
    expect(JSON.parse(updateResponse.body).error).toBe('owner-identity-required')
    expect(listResponse.statusCode).toBe(200)
    expect(JSON.parse(listResponse.body).owner.email).toBe('owner@example.com')
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

  it('persists profile language per user and rejects unsupported languages', async () => {
    const file = tempRegistry([
      registryPasswordUser({
        userId: 'first',
        displayName: 'First',
        email: 'first@example.com',
        password: 'first-pass-123',
        ledgerId: 'first',
      }),
      registryPasswordUser({
        userId: 'second',
        displayName: 'Second',
        email: 'second@example.com',
        password: 'second-pass-123',
        ledgerId: 'second',
      }),
    ])
    const api = createAdreemApiHandler({
      ADREEM_TELEGRAM_USERS_FILE: file,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    const firstToken = await loginForToken(api, 'first@example.com', 'first-pass-123')
    const secondToken = await loginForToken(api, 'second@example.com', 'second-pass-123')

    const updateRequest = createJsonRequest({ language: 'en' }, {
      method: 'PATCH',
      url: '/api/profile',
      token: firstToken,
    })
    const updateResponse = createMockResponse()
    const updatePromise = api(updateRequest, updateResponse)
    updateRequest.emitBody()
    await updatePromise

    const firstProfileResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: 'Bearer ' + firstToken },
    }, firstProfileResponse)
    const secondProfileResponse = createMockResponse()
    await api({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: 'Bearer ' + secondToken },
    }, secondProfileResponse)

    expect(updateResponse.statusCode).toBe(200)
    expect(JSON.parse(firstProfileResponse.body).user.language).toBe('en')
    expect(JSON.parse(secondProfileResponse.body).user.language).toBe('ar')

    const invalidRequest = createJsonRequest({ language: 'fr' }, {
      method: 'PATCH',
      url: '/api/profile',
      token: firstToken,
    })
    const invalidResponse = createMockResponse()
    const invalidPromise = api(invalidRequest, invalidResponse)
    invalidRequest.emitBody()
    await invalidPromise

    expect(invalidResponse.statusCode).toBe(400)
    expect(JSON.parse(invalidResponse.body).error).toBe('Unsupported language.')
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
