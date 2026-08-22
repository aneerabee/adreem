import { describe, expect, it, vi } from 'vitest'
import {
  ADREEM_ACCESS_COOKIE_NAME,
  ADREEM_REFRESH_COOKIE_NAME,
  createAdreemV3ApiHandler,
  v3BrowserAuthOrigin,
} from './adreemV3Api.js'

function response() {
  return {
    statusCode: 0,
    headers: {},
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

function request({
  method = 'GET',
  url = '/api/ledger',
  accessToken = 'valid',
  refreshToken = '',
  bearerToken = '',
  origin = '',
  fetchSite = '',
  forwardedFor = '',
  remoteAddress = '127.0.0.1',
  body,
} = {}) {
  const listeners = {}
  const cookies = [
    accessToken ? `${ADREEM_ACCESS_COOKIE_NAME}=${encodeURIComponent(accessToken)}` : '',
    refreshToken ? `${ADREEM_REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}` : '',
  ].filter(Boolean)
  return {
    method,
    url,
    headers: {
      ...(cookies.length ? { cookie: cookies.join('; ') } : {}),
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      ...(origin ? { origin } : {}),
      ...(fetchSite ? { 'sec-fetch-site': fetchSite } : {}),
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    socket: { remoteAddress },
    setEncoding() {},
    on(event, handler) {
      listeners[event] = handler
      return this
    },
    emitBody(value = body) {
      if (value !== undefined) listeners.data?.(typeof value === 'string' ? value : JSON.stringify(value))
      listeners.end?.()
    },
  }
}

function fixture(overrides = {}) {
  const context = {
    accessToken: 'valid',
    client: {},
    profile: { id: 'owner-a', is_system_owner: false },
    ledger: { id: 'ledger-a', revision: 7 },
    publicUser: { userId: 'owner-a', ledgerId: 'main' },
    isOwner: false,
  }
  const storage = {
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.test/file' }, error: null })),
  }
  const authService = {
    authenticate: vi.fn(async (token) => token === 'valid' ? context : null),
    login: vi.fn(async () => ({
      token: 'login-access',
      refreshToken: 'login-refresh',
      expiresAt: '2026-08-20T13:00:00.000Z',
      publicUser: context.publicUser,
    })),
    refresh: vi.fn(async () => ({
      token: 'rotated-access',
      refreshToken: 'rotated-refresh',
      expiresAt: '2026-08-20T13:00:00.000Z',
      user: { id: context.profile.id },
      client: context.client,
      profile: context.profile,
      ledger: context.ledger,
      publicUser: context.publicUser,
    })),
    logout: vi.fn(),
    listUsers: vi.fn(async () => []),
    createUser: vi.fn(async (attributes) => ({
      userId: 'created-user',
      active: attributes.active === true,
      source: 'supabase-auth',
    })),
    updateUser: vi.fn(async (userId) => ({ userId, active: true, source: 'supabase-auth' })),
    setUserActive: vi.fn(async (userId, active) => ({ userId, active, source: 'supabase-auth' })),
    admin: { storage: { from: vi.fn(() => storage) } },
  }
  const repository = {
    load: vi.fn(async () => ({
      state: { accounts: [], movements: [] },
      source: 'relational',
      storageMode: 'relational',
      revision: 7,
      updatedAt: '2026-08-20T12:00:00.000Z',
      movementPage: { offset: 0, limit: 100, total: 0, hasMore: false },
    })),
    applyDelta: vi.fn(async () => ({ revision: 8 })),
    deleteUnusedAccount: vi.fn(async (accountId) => ({ revision: 8, deletedAccountIds: [accountId] })),
    loadMovements: vi.fn(async () => ({
      movements: [{ id: 'm1' }],
      page: { offset: 50, limit: 50, total: 101, hasMore: true },
      revision: 7,
    })),
    loadReports: vi.fn(async () => ({ dimensions: [], expenseCategories: [], revision: 7 })),
  }
  const attachmentUsage = overrides.useStorageUsage ? undefined : overrides.attachmentUsage || vi.fn(async () => 0)
  const attachmentReference = overrides.attachmentReference || vi.fn(async () => null)
  const handler = createAdreemV3ApiHandler({
    ADREEM_WEB_ALLOWED_ORIGIN: 'https://app.test',
    ADREEM_ATTACHMENTS_BUCKET: 'adreem-files',
    ...(overrides.env || {}),
  }, {
    authService,
    repositoryFactory: () => repository,
    now: () => Date.parse('2026-08-20T12:00:00.000Z'),
    ...(attachmentUsage ? { attachmentUsage } : {}),
    attachmentReference,
  })
  return { attachmentReference, attachmentUsage, authService, context, handler, repository, storage }
}

describe('ADREEM v3 API', () => {
  it('returns a bounded bootstrap state with its database revision', async () => {
    const { handler } = fixture()
    const req = request()
    const res = response()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ storageMode: 'relational', revision: 7, reports: { dimensions: [], expenseCategories: [] } })
    expect(res.headers['cache-control']).toBe('no-store, private')
    expect(res.headers['access-control-allow-origin']).toBe('https://app.test')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('retries until ledger data and reports use the same revision', async () => {
    const { handler, repository } = fixture()
    repository.loadReports
      .mockResolvedValueOnce({ dimensions: [], expenseCategories: [], revision: 6 })
      .mockResolvedValueOnce({ dimensions: [], expenseCategories: [], revision: 7 })

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(200)
    expect(repository.load).toHaveBeenCalledTimes(2)
    expect(repository.loadReports).toHaveBeenCalledTimes(2)
  })

  it('applies only the supplied delta at the expected revision', async () => {
    const { handler, repository } = fixture()
    const req = request({ method: 'PUT', body: { baseRevision: 7, delta: { movements: [{ id: 'm2' }] } } })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending
    expect(res.statusCode).toBe(200)
    expect(repository.applyDelta).toHaveBeenCalledWith({ movements: [{ id: 'm2' }] }, 7)
  })

  it('deletes an unused account and returns the authoritative ledger state', async () => {
    const { handler, repository } = fixture()
    const req = request({ method: 'DELETE', url: '/api/accounts/unused%20cash', body: { baseRevision: 7 } })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(200)
    expect(repository.deleteUnusedAccount).toHaveBeenCalledWith('unused cash', 7)
    expect(JSON.parse(res.body)).toMatchObject({
      storageMode: 'relational',
      revision: 7,
      deletedAccountIds: ['unused cash'],
    })
  })

  it('refuses account deletion without a current ledger revision', async () => {
    const { handler, repository } = fixture()
    const req = request({ method: 'DELETE', url: '/api/accounts/unused', body: {} })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(428)
    expect(repository.deleteUnusedAccount).not.toHaveBeenCalled()
  })

  it('returns a safe conflict when the database finds an account link', async () => {
    const { handler, repository } = fixture()
    repository.deleteUnusedAccount.mockRejectedValueOnce(Object.assign(new Error('raw database detail'), { code: 'account-in-use' }))
    const req = request({ method: 'DELETE', url: '/api/accounts/used', body: { baseRevision: 7 } })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toEqual({
      error: 'لا يمكن حذف الحساب لأنه استُخدم أو ارتبط بسجل آخر.',
      code: 'account-in-use',
    })
  })

  it('rejects legacy full-state replacement requests', async () => {
    const { handler, repository } = fixture()
    const req = request({ method: 'PUT', body: { baseRevision: 7, state: { accounts: [], movements: [] } } })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending
    expect(res.statusCode).toBe(400)
    expect(repository.applyDelta).not.toHaveBeenCalled()
  })

  it('loads later movement pages without returning the full ledger', async () => {
    const { handler, repository } = fixture()
    const req = request({ url: '/api/movements?offset=50&limit=50&q=fuel&accountId=cash&status=posted&type=expense&dimensionId=truck&expenseCategoryId=fuel-category' })
    const res = response()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(repository.loadMovements).toHaveBeenCalledWith(expect.objectContaining({
      movementOffset: '50',
      movementLimit: '50',
      query: 'fuel',
      accountId: 'cash',
      status: 'posted',
      movementType: 'expense',
      dimensionId: 'truck',
      expenseCategoryId: 'fuel-category',
      excludeOpening: true,
    }))
    expect(JSON.parse(res.body)).toMatchObject({ revision: 7, page: { hasMore: true } })
  })

  it('passes the main movement type list to the isolated repository', async () => {
    const { handler, repository } = fixture()
    const req = request({ url: '/api/movements?limit=8&types=transfer%2Cexpense' })
    const res = response()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(repository.loadMovements).toHaveBeenCalledWith(expect.objectContaining({
      movementType: null,
      movementTypes: ['transfer', 'expense'],
    }))
  })

  it('returns a clean 413 response after draining an oversized request', async () => {
    const { handler, repository } = fixture()
    const req = request({ method: 'PUT', body: 'x'.repeat(1_000_001) })
    const res = response()
    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending
    expect(res.statusCode).toBe(413)
    expect(repository.applyDelta).not.toHaveBeenCalled()
  })

  it('validates movement date filters before querying the database', async () => {
    const { handler, repository } = fixture()
    const res = response()

    await handler(request({ url: '/api/movements?occurredFrom=not-a-date' }), res)

    expect(res.statusCode).toBe(400)
    expect(repository.loadMovements).not.toHaveBeenCalled()
  })

  it('sets secure HttpOnly cookies without exposing Supabase tokens in the login response', async () => {
    const { authService, handler } = fixture()
    const req = request({
      method: 'POST',
      url: '/api/auth/login',
      accessToken: '',
      origin: 'https://app.test',
      fetchSite: 'same-origin',
      body: { email: 'OWNER@EXAMPLE.COM', password: 'secret' },
    })
    const res = response()
    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(200)
    expect(authService.login).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' })
    expect(JSON.parse(res.body)).toEqual({
      authMode: 'cookie-v3',
      expiresAt: '2026-08-20T13:00:00.000Z',
      user: { userId: 'owner-a', ledgerId: 'main' },
    })
    expect(res.body).not.toContain('login-access')
    expect(res.body).not.toContain('login-refresh')
    expect(res.headers['set-cookie']).toHaveLength(2)
    expect(res.headers['set-cookie'][0]).toContain(`${ADREEM_ACCESS_COOKIE_NAME}=login-access`)
    expect(res.headers['set-cookie'][0]).toContain('Max-Age=3600')
    expect(res.headers['set-cookie'][1]).toContain(`${ADREEM_REFRESH_COOKIE_NAME}=login-refresh`)
    expect(res.headers['set-cookie'][1]).toContain('Max-Age=2592000')
    for (const header of res.headers['set-cookie']) {
      expect(header).toContain('Path=/')
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Secure')
      expect(header).toContain('SameSite=Strict')
    }
  })

  it('rejects bearer-only access and authenticates only from the HttpOnly cookie', async () => {
    const { authService, handler } = fixture()
    const req = request({ accessToken: '', bearerToken: 'valid' })
    const res = response()

    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(authService.authenticate).not.toHaveBeenCalled()
    expect(res.headers['set-cookie']).toHaveLength(2)
  })

  it('refreshes an expired access cookie and rotates both cookies before serving the request', async () => {
    const { authService, handler } = fixture()
    const req = request({ accessToken: 'expired', refreshToken: 'refresh-1' })
    const res = response()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(authService.authenticate).toHaveBeenCalledWith('expired')
    expect(authService.refresh).toHaveBeenCalledWith('refresh-1')
    expect(res.headers['set-cookie'][0]).toContain(`${ADREEM_ACCESS_COOKIE_NAME}=rotated-access`)
    expect(res.headers['set-cookie'][1]).toContain(`${ADREEM_REFRESH_COOKIE_NAME}=rotated-refresh`)
  })

  it('does not accept a refresh token from JavaScript request data', async () => {
    const { authService, handler } = fixture()
    const req = request({
      method: 'POST',
      url: '/api/auth/refresh',
      accessToken: '',
      origin: 'https://app.test',
      fetchSite: 'same-origin',
      body: { refreshToken: 'body-refresh-token' },
    })
    const res = response()

    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(401)
    expect(authService.refresh).not.toHaveBeenCalled()
    expect(res.headers['set-cookie']).toHaveLength(2)
    expect(res.body).not.toContain('body-refresh-token')
  })

  it('rotates a refresh-cookie session without returning either rotated token', async () => {
    const { authService, handler } = fixture()
    const req = request({
      method: 'POST',
      url: '/api/auth/refresh',
      accessToken: '',
      refreshToken: 'refresh-1',
      origin: 'https://app.test',
      fetchSite: 'same-origin',
    })
    const res = response()

    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(200)
    expect(authService.refresh).toHaveBeenCalledWith('refresh-1')
    expect(JSON.parse(res.body)).toEqual({
      authMode: 'cookie-v3',
      expiresAt: '2026-08-20T13:00:00.000Z',
      user: { userId: 'owner-a', ledgerId: 'main' },
    })
    expect(res.body).not.toContain('rotated-access')
    expect(res.body).not.toContain('rotated-refresh')
    expect(res.headers['set-cookie'][0]).toContain(`${ADREEM_ACCESS_COOKIE_NAME}=rotated-access`)
    expect(res.headers['set-cookie'][1]).toContain(`${ADREEM_REFRESH_COOKIE_NAME}=rotated-refresh`)
  })

  it('shares one provider rotation across concurrent requests with the same refresh cookie', async () => {
    const { authService, context, handler } = fixture()
    let resolveRefresh
    authService.refresh.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const firstRequest = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'shared-refresh' })
    const secondRequest = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'shared-refresh' })
    const firstResponse = response()
    const secondResponse = response()

    const firstPending = handler(firstRequest, firstResponse)
    firstRequest.emitBody()
    const secondPending = handler(secondRequest, secondResponse)
    secondRequest.emitBody()
    await vi.waitFor(() => expect(authService.refresh).toHaveBeenCalledTimes(1))
    resolveRefresh({
      token: 'shared-access-rotated',
      refreshToken: 'shared-refresh-rotated',
      expiresAt: '2026-08-20T13:00:00.000Z',
      user: { id: context.profile.id },
      client: context.client,
      profile: context.profile,
      ledger: context.ledger,
      publicUser: context.publicUser,
    })
    await Promise.all([firstPending, secondPending])

    expect(authService.refresh).toHaveBeenCalledOnce()
    expect(firstResponse.statusCode).toBe(200)
    expect(secondResponse.statusCode).toBe(200)
    expect(firstResponse.headers['set-cookie']).toEqual(secondResponse.headers['set-cookie'])
  })

  it('asks a stale tab to retry after rotation without clearing the current cookies', async () => {
    const { authService, handler } = fixture()
    const firstRequest = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'refresh-1' })
    const firstResponse = response()
    const firstPending = handler(firstRequest, firstResponse)
    firstRequest.emitBody()
    await firstPending

    const replayRequest = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'refresh-1' })
    const replayResponse = response()
    const replayPending = handler(replayRequest, replayResponse)
    replayRequest.emitBody()
    await replayPending

    expect(firstResponse.statusCode).toBe(200)
    expect(replayResponse.statusCode).toBe(409)
    expect(JSON.parse(replayResponse.body)).toEqual({
      error: 'The login session changed in another tab. Retry the request.',
      code: 'adreem-session-rotated',
    })
    expect(replayResponse.headers['set-cookie']).toBeUndefined()
    expect(authService.refresh).toHaveBeenCalledOnce()
  })

  it.each([
    [401, 503],
    [403, 403],
    [503, 503],
  ])('keeps rotated cookies when refresh succeeds but profile verification fails with %s', async (providerStatus, responseStatus) => {
    const { authService, handler } = fixture()
    const error = Object.assign(new Error('Database unavailable'), {
      status: providerStatus,
      rotatedSession: {
        token: 'preserved-access',
        refreshToken: 'preserved-refresh',
        expiresAt: '2026-08-20T13:00:00.000Z',
      },
    })
    authService.refresh.mockRejectedValueOnce(error)
    const req = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'refresh-1' })
    const res = response()

    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(responseStatus)
    expect(res.headers['set-cookie'][0]).toContain(`${ADREEM_ACCESS_COOKIE_NAME}=preserved-access`)
    expect(res.headers['set-cookie'][1]).toContain(`${ADREEM_REFRESH_COOKIE_NAME}=preserved-refresh`)
    expect(res.headers['set-cookie'].some((header) => header.includes('Max-Age=0'))).toBe(false)
  })

  it('clears cookies only when the refresh token is rejected with 401', async () => {
    const { authService, handler } = fixture()
    authService.refresh.mockRejectedValueOnce(Object.assign(new Error('Refresh expired'), { status: 401 }))
    const req = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'expired-refresh' })
    const res = response()

    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toHaveLength(2)
    expect(res.headers['set-cookie'].every((header) => header.includes('Max-Age=0'))).toBe(true)
  })

  it('fences a late refresh after logout and revokes its rotated session', async () => {
    const { authService, context, handler } = fixture()
    let resolveRefresh
    authService.refresh.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const refreshReq = request({ method: 'POST', url: '/api/auth/refresh', accessToken: '', refreshToken: 'refresh-1' })
    const refreshRes = response()
    const refreshPending = handler(refreshReq, refreshRes)
    refreshReq.emitBody()
    await vi.waitFor(() => expect(authService.refresh).toHaveBeenCalled())

    const logoutReq = request({ method: 'POST', url: '/api/auth/logout', refreshToken: 'refresh-1' })
    const logoutRes = response()
    const logoutPending = handler(logoutReq, logoutRes)
    logoutReq.emitBody()
    await logoutPending

    resolveRefresh({
      token: 'late-access',
      refreshToken: 'late-refresh',
      expiresAt: '2026-08-20T13:00:00.000Z',
      user: { id: context.profile.id },
      client: context.client,
      profile: context.profile,
      ledger: context.ledger,
      publicUser: context.publicUser,
    })
    await refreshPending

    expect(logoutRes.statusCode).toBe(204)
    expect(refreshRes.statusCode).toBe(401)
    expect(refreshRes.headers['set-cookie'].every((header) => header.includes('Max-Age=0'))).toBe(true)
    expect(authService.logout).toHaveBeenCalledWith('late-access', 'late-refresh')
  })

  it('revokes the cookie session and expires both cookies on logout', async () => {
    const { authService, handler } = fixture()
    const req = request({
      method: 'POST',
      url: '/api/auth/logout',
      accessToken: 'valid',
      refreshToken: 'refresh-1',
      origin: 'https://app.test',
      fetchSite: 'same-origin',
    })
    const res = response()

    const pending = handler(req, res)
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(204)
    expect(authService.logout).toHaveBeenCalledWith('valid', 'refresh-1')
    expect(res.headers['set-cookie']).toHaveLength(2)
    expect(res.headers['set-cookie'].every((header) => header.includes('Max-Age=0'))).toBe(true)
  })

  it('creates an active member only when the owner explicitly sends a boolean true', async () => {
    const { authService, context, handler } = fixture()
    context.isOwner = true
    const body = {
      email: 'new@example.com',
      password: 'strong-password',
      ledgerId: 'new-ledger',
      active: true,
    }
    const req = request({ method: 'POST', url: '/api/admin/users', body })
    const res = response()

    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(201)
    expect(authService.createUser).toHaveBeenCalledWith(body)
    expect(JSON.parse(res.body)).toMatchObject({ user: { active: true } })
  })

  it('rejects string active values for both user creation and activation', async () => {
    const { authService, context, handler } = fixture()
    context.isOwner = true
    const createRequest = request({
      method: 'POST',
      url: '/api/admin/users',
      body: { email: 'new@example.com', password: 'strong-password', ledgerId: 'new-ledger', active: 'true' },
    })
    const createResponse = response()
    const createPending = handler(createRequest, createResponse)
    await new Promise((resolve) => setTimeout(resolve, 0))
    createRequest.emitBody()
    await createPending

    const updateRequest = request({ method: 'PATCH', url: '/api/admin/users/user-a', body: { active: 'false' } })
    const updateResponse = response()
    const updatePending = handler(updateRequest, updateResponse)
    await new Promise((resolve) => setTimeout(resolve, 0))
    updateRequest.emitBody()
    await updatePending

    expect(createResponse.statusCode).toBe(400)
    expect(updateResponse.statusCode).toBe(400)
    expect(authService.createUser).not.toHaveBeenCalled()
    expect(authService.setUserActive).not.toHaveBeenCalled()
  })

  it('returns stable user-management error codes without exposing provider details', async () => {
    const { authService, context, handler } = fixture()
    context.isOwner = true
    authService.createUser.mockRejectedValueOnce(Object.assign(
      new Error('duplicate key violates adreem_profiles_telegram_user_id_key: private detail'),
      { code: '23505', status: 409 },
    ))
    const req = request({
      method: 'POST',
      url: '/api/admin/users',
      body: { email: 'new@example.com', password: 'strong-password', displayName: 'New', ledgerId: 'new-ledger', telegramUserId: '123' },
    })
    const res = response()

    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toEqual({
      error: 'لم يتم حفظ المستخدم. راجع البيانات.',
      code: 'telegram-used',
    })
    expect(res.body).not.toContain('private detail')
  })

  it('logs internal provider failures but returns a generic server error', async () => {
    const { handler, repository } = fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.load.mockRejectedValueOnce(Object.assign(new Error('raw database password=secret'), { status: 503 }))
    const res = response()

    await handler(request(), res)

    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toEqual({ error: 'ADREEM API failed.' })
    expect(res.body).not.toContain('password=secret')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('rejects hostile browser origins without granting CORS access', async () => {
    const { authService, handler } = fixture()
    const req = request({ origin: 'https://evil.test', fetchSite: 'cross-site' })
    const res = response()

    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(authService.authenticate).not.toHaveBeenCalled()
  })

  it('ignores forwarded addresses unless the trusted proxy flag is enabled', async () => {
    async function login(handler, forwardedFor) {
      const req = request({
        method: 'POST',
        url: '/api/auth/login',
        accessToken: '',
        forwardedFor,
        remoteAddress: '10.0.0.5',
        body: { email: 'owner@example.com', password: 'secret' },
      })
      const res = response()
      const pending = handler(req, res)
      await new Promise((resolve) => setTimeout(resolve, 0))
      req.emitBody()
      await pending
      return res.statusCode
    }

    const untrusted = fixture()
    const untrustedStatuses = []
    for (let index = 1; index <= 9; index += 1) {
      untrustedStatuses.push(await login(untrusted.handler, `203.0.113.${index}`))
    }
    expect(untrustedStatuses.slice(0, 8)).toEqual(Array(8).fill(200))
    expect(untrustedStatuses[8]).toBe(429)

    const trusted = fixture({ env: { ADREEM_TRUST_PROXY: 'true' } })
    const trustedStatuses = []
    for (let index = 1; index <= 9; index += 1) {
      trustedStatuses.push(await login(trusted.handler, `203.0.113.${index}`))
    }
    expect(trustedStatuses).toEqual(Array(9).fill(200))

    const addressless = fixture()
    const addresslessStatuses = []
    for (let index = 1; index <= 9; index += 1) {
      const req = request({
        method: 'POST',
        url: '/api/auth/login',
        accessToken: '',
        remoteAddress: '',
        body: { email: `owner-${index}@example.com`, password: 'secret' },
      })
      const res = response()
      const pending = addressless.handler(req, res)
      req.emitBody()
      await pending
      addresslessStatuses.push(res.statusCode)
    }
    expect(addresslessStatuses).toEqual(Array(9).fill(200))
  })

  it('enforces attachment rate limits per owner before upload', async () => {
    const { context, handler, storage } = fixture({ env: { ADREEM_ATTACHMENT_UPLOADS_PER_MINUTE: '1' } })
    const body = {
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      base64: Buffer.from('%PDF-1.4\nbody\n%%EOF').toString('base64'),
    }
    async function upload() {
      const req = request({ method: 'POST', url: '/api/attachments', body })
      const res = response()
      const pending = handler(req, res)
      await new Promise((resolve) => setTimeout(resolve, 0))
      req.emitBody()
      await pending
      return res
    }

    expect((await upload()).statusCode).toBe(201)
    expect((await upload()).statusCode).toBe(429)
    expect(storage.upload).toHaveBeenCalledTimes(1)

    context.profile.id = 'owner-b'
    context.ledger.id = 'ledger-b'
    expect((await upload()).statusCode).toBe(201)
    expect(storage.upload).toHaveBeenCalledTimes(2)
  })

  it('rejects a ledger quota overflow before calling storage', async () => {
    const { handler, storage } = fixture({
      useStorageUsage: true,
      env: { ADREEM_ATTACHMENT_LEDGER_QUOTA_BYTES: '100' },
    })
    storage.list
      .mockResolvedValueOnce({ data: [{ id: null, name: '2026-08-20', metadata: null }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'stored-file', name: 'orphan.pdf', metadata: { size: 95 } }], error: null })
    const req = request({
      method: 'POST',
      url: '/api/attachments',
      body: {
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('%PDF-1.4\nbody\n%%EOF').toString('base64'),
      },
    })
    const res = response()

    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(413)
    expect(storage.list).toHaveBeenCalledTimes(2)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('deletes only an authenticated owner path for orphan cleanup', async () => {
    const { attachmentReference, handler, storage } = fixture()
    const storagePath = 'owner-a/ledger-a/2026-08-20/file.pdf'
    const req = request({ method: 'DELETE', url: `/api/attachments?path=${encodeURIComponent(storagePath)}` })
    const res = response()

    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(204)
    expect(attachmentReference).toHaveBeenCalledWith(expect.any(Object), storagePath)
    expect(storage.remove).toHaveBeenCalledWith([storagePath])
  })

  it('refuses to remove storage while the attachment is linked to a live ledger record', async () => {
    const attachmentReference = vi.fn(async () => ({ record_id: 'attachment-live' }))
    const { handler, storage } = fixture({ attachmentReference })
    const storagePath = 'owner-a/ledger-a/2026-08-20/live.pdf'
    const req = request({ method: 'DELETE', url: `/api/attachments?path=${encodeURIComponent(storagePath)}` })
    const res = response()

    const pending = handler(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))
    req.emitBody()
    await pending

    expect(res.statusCode).toBe(409)
    expect(attachmentReference).toHaveBeenCalledWith(expect.any(Object), storagePath)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('serializes orphan cleanup behind a ledger save before checking live references', async () => {
    let resolveSave
    const attachmentReference = vi.fn(async () => ({ record_id: 'attachment-saved' }))
    const { handler, repository, storage } = fixture({ attachmentReference })
    repository.applyDelta.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    const saveRequest = request({ method: 'PUT', body: { baseRevision: 7, delta: { attachments: [{ id: 'attachment-saved' }] } } })
    const saveResponse = response()
    const savePending = handler(saveRequest, saveResponse)
    await new Promise((resolve) => setTimeout(resolve, 0))
    saveRequest.emitBody()
    await vi.waitFor(() => expect(repository.applyDelta).toHaveBeenCalled())

    const storagePath = 'owner-a/ledger-a/2026-08-20/saved.pdf'
    const cleanupRequest = request({ method: 'DELETE', url: `/api/attachments?path=${encodeURIComponent(storagePath)}` })
    const cleanupResponse = response()
    const cleanupPending = handler(cleanupRequest, cleanupResponse)
    await new Promise((resolve) => setTimeout(resolve, 0))
    cleanupRequest.emitBody()
    await Promise.resolve()
    expect(attachmentReference).not.toHaveBeenCalled()

    resolveSave({ revision: 8 })
    await Promise.all([savePending, cleanupPending])

    expect(saveResponse.statusCode).toBe(200)
    expect(cleanupResponse.statusCode).toBe(409)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('requires the production web and API to share one exact HTTPS origin', () => {
    expect(v3BrowserAuthOrigin({
      NODE_ENV: 'production',
      ADREEM_WEB_ALLOWED_ORIGIN: 'https://adreem.example.com',
      ADREEM_API_PUBLIC_ORIGIN: 'https://adreem.example.com',
    })).toBe('https://adreem.example.com')
    expect(() => v3BrowserAuthOrigin({
      NODE_ENV: 'production',
      ADREEM_WEB_ALLOWED_ORIGIN: 'https://aneerabee.github.io',
      ADREEM_API_PUBLIC_ORIGIN: 'https://api.example.com',
    })).toThrow('requires the web and API to use the same origin')
    expect(() => v3BrowserAuthOrigin({
      NODE_ENV: 'production',
      ADREEM_WEB_ALLOWED_ORIGIN: 'https://adreem.example.com/',
      ADREEM_API_PUBLIC_ORIGIN: 'https://adreem.example.com',
    })).toThrow('must be an exact web origin')
  })
})
