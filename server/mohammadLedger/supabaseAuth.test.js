import { describe, expect, it, vi } from 'vitest'
import { createSupabaseAuthService, supabaseAuthEnabled } from './supabaseAuth.js'

const ENV = {
  ADREEM_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://adreem.test',
  SUPABASE_PUBLISHABLE_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

function authFailure(message, code = 'auth_error', status = 400) {
  return { message, code, status }
}

function createFixture(overrides = {}) {
  const failures = { ...(overrides.failures || {}) }
  const users = new Map()
  const profiles = new Map()
  const ledgers = new Map()
  let createdUserSequence = 0

  function addUser(user = {}) {
    const id = user.id || `user-${users.size + 1}`
    const authUser = {
      id,
      email: user.email || `${id}@adreem.test`,
      user_metadata: {
        display_name: user.displayName || '',
        language: user.language || 'ar',
        ...(user.userMetadata || {}),
      },
      app_metadata: {
        adreem_member: user.member !== false,
        marker: `${id}-marker`,
        ...(user.appMetadata || {}),
      },
    }
    users.set(id, authUser)
    profiles.set(id, {
      id,
      email: authUser.email,
      display_name: user.profileDisplayName ?? user.displayName ?? '',
      telegram_user_id: user.telegramUserId ?? null,
      language: user.profileLanguage || user.language || 'ar',
      is_system_owner: Boolean(user.isOwner),
      is_active: user.active !== false,
      created_at: user.createdAt || '2026-08-20T10:00:00.000Z',
    })
    if (user.hasLedger !== false) {
      ledgers.set(id, {
        id: user.relationalLedgerId || `ledger-${id}`,
        owner_id: id,
        legacy_ledger_id: user.ledgerId || `legacy-${id}`,
        name: user.ledgerName || `Ledger ${id}`,
        revision: user.revision || 0,
      })
    }
    return authUser
  }

  const primaryUser = addUser({
    id: 'user-a',
    email: 'owner@example.com',
    displayName: 'ربيع',
    telegramUserId: '278516861',
    ledgerId: 'main-ledger',
    relationalLedgerId: 'ledger-a',
    isOwner: overrides.primaryIsOwner,
    member: overrides.primaryMember,
    active: overrides.primaryActive,
    hasLedger: overrides.primaryHasLedger,
  })
  for (const user of overrides.additionalUsers || []) addUser(user)

  const spies = {
    createClient: vi.fn(),
    signInWithPassword: vi.fn(),
    refreshSession: vi.fn(),
    getUser: vi.fn(),
    setSession: vi.fn(),
    signOut: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
  }

  function failure(name) {
    return failures[name] || null
  }

  function sessionFor(user = primaryUser, prefix = 'login') {
    return {
      user,
      session: {
        access_token: `${prefix}-access`,
        refresh_token: `${prefix}-refresh`,
        expires_at: 1_787_229_600,
        user,
      },
    }
  }

  function selectedRows(table) {
    if (table === 'adreem_profiles') return Array.from(profiles.values())
    if (table === 'adreem_ledgers') return Array.from(ledgers.values())
    throw new Error(`Unexpected table: ${table}`)
  }

  function query(table) {
    let action = 'select'
    let updateValues = null
    const filters = []

    async function execute() {
      if (action === 'update') {
        const error = failure('profileUpdate')
        if (error) return { data: null, error }
        const rows = selectedRows(table).filter((row) => filters.every(([field, value]) => row[field] === value))
        rows.forEach((row) => Object.assign(row, updateValues))
        return { data: rows, error: null }
      }

      const errorKey = table === 'adreem_profiles'
        ? (filters.length ? 'profileSelect' : 'profilesList')
        : (filters.length ? 'ledgerSelect' : 'ledgersList')
      const error = failure(errorKey)
      if (error) return { data: null, error }
      const rows = selectedRows(table).filter((row) => filters.every(([field, value]) => row[field] === value))
      return { data: rows, error: null }
    }

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((field, value) => {
        filters.push([field, value])
        return builder
      }),
      update: vi.fn((values) => {
        action = 'update'
        updateValues = values
        return builder
      }),
      async maybeSingle() {
        const result = await execute()
        return { data: result.data?.[0] || null, error: result.error }
      },
      async order() {
        return execute()
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }
    return builder
  }

  function publicAuth() {
    return {
      signInWithPassword: spies.signInWithPassword.mockImplementation(async () => {
        const error = failure('signIn')
        return error ? { data: null, error } : { data: sessionFor(), error: null }
      }),
      refreshSession: spies.refreshSession.mockImplementation(async () => {
        const error = failure('refresh')
        return error ? { data: null, error } : { data: sessionFor(primaryUser, 'refresh'), error: null }
      }),
      getUser: spies.getUser.mockImplementation(async (token) => {
        const error = failure('getUser')
        if (error) return { data: null, error }
        return token === 'valid-access'
          ? { data: { user: primaryUser }, error: null }
          : { data: { user: null }, error: null }
      }),
      setSession: spies.setSession.mockImplementation(async () => ({ error: failure('setSession') })),
      signOut: spies.signOut.mockImplementation(async () => ({ error: failure('signOut') })),
    }
  }

  function syncProfileFromAuth(user) {
    const profile = profiles.get(user.id)
    if (!profile) return
    profile.email = user.email
    profile.display_name = user.user_metadata?.display_name || ''
    profile.language = user.user_metadata?.language === 'en' ? 'en' : 'ar'
    profile.telegram_user_id = user.app_metadata?.adreem_telegram_user_id || null
  }

  const adminAuth = {
    admin: {
      listUsers: spies.listUsers.mockImplementation(async ({ page, perPage }) => {
        const error = failure('listUsers')
        if (error) return { data: null, error }
        const start = (page - 1) * perPage
        return { data: { users: Array.from(users.values()).slice(start, start + perPage) }, error: null }
      }),
      createUser: spies.createUser.mockImplementation(async (attributes) => {
        const error = failure('createUser')
        if (error) return { data: null, error }
        createdUserSequence += 1
        const id = `created-${createdUserSequence}`
        const user = {
          id,
          email: attributes.email,
          user_metadata: { ...(attributes.user_metadata || {}) },
          app_metadata: { ...(attributes.app_metadata || {}) },
        }
        users.set(id, user)
        profiles.set(id, {
          id,
          email: user.email,
          display_name: user.user_metadata.display_name || '',
          telegram_user_id: user.app_metadata.adreem_telegram_user_id || null,
          language: user.user_metadata.language || 'ar',
          is_system_owner: Boolean(user.app_metadata.adreem_system_owner),
          is_active: false,
          created_at: '2026-08-20T11:00:00.000Z',
        })
        ledgers.set(id, {
          id: `ledger-${id}`,
          owner_id: id,
          legacy_ledger_id: user.app_metadata.adreem_legacy_ledger_id,
          name: `Ledger ${id}`,
          revision: 0,
        })
        return { data: { user }, error: null }
      }),
      getUserById: spies.getUserById.mockImplementation(async (userId) => {
        const error = failure('getUserById')
        return error
          ? { data: null, error }
          : { data: { user: users.get(userId) || null }, error: null }
      }),
      updateUserById: spies.updateUserById.mockImplementation(async (userId, attributes) => {
        const error = failure('updateUser')
        if (error) return { data: null, error }
        const existing = users.get(userId)
        if (!existing) return { data: { user: null }, error: null }
        const user = {
          ...existing,
          ...(attributes.email ? { email: attributes.email } : {}),
          user_metadata: attributes.user_metadata || existing.user_metadata,
          app_metadata: attributes.app_metadata || existing.app_metadata,
          ...(attributes.ban_duration === undefined ? {} : { ban_duration: attributes.ban_duration }),
        }
        users.set(userId, user)
        syncProfileFromAuth(user)
        return { data: { user }, error: null }
      }),
    },
  }

  function createClientImpl(url, key, options) {
    spies.createClient(url, key, options)
    return {
      auth: key === ENV.SUPABASE_SERVICE_ROLE_KEY ? adminAuth : publicAuth(),
      from: vi.fn((table) => query(table)),
    }
  }

  const service = createSupabaseAuthService(ENV, { createClientImpl })
  return { failures, ledgers, primaryUser, profiles, service, spies, users }
}

describe('Supabase Auth configuration', () => {
  it('enables Supabase mode without case or surrounding-space sensitivity', () => {
    expect(supabaseAuthEnabled({ ADREEM_AUTH_MODE: '  SuPaBaSe ' })).toBe(true)
    expect(supabaseAuthEnabled({ ADREEM_AUTH_MODE: 'legacy' })).toBe(false)
    expect(supabaseAuthEnabled({})).toBe(false)
  })

  it('rejects incomplete configuration before creating any client', () => {
    const createClientImpl = vi.fn()
    expect(() => createSupabaseAuthService({ SUPABASE_URL: 'https://adreem.test' }, { createClientImpl }))
      .toThrow('Supabase Auth requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY.')
    expect(createClientImpl).not.toHaveBeenCalled()
  })
})

describe('Supabase Auth sessions', () => {
  it('logs in, loads the isolated profile and ledger, and returns a complete public session', async () => {
    const { service, spies } = createFixture()

    const result = await service.login({ email: 'owner@example.com', password: 'secret' })

    expect(spies.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' })
    expect(result).toMatchObject({
      token: 'login-access',
      refreshToken: 'login-refresh',
      expiresAt: '2026-08-20T12:40:00.000Z',
      profile: { id: 'user-a', is_active: true },
      ledger: { id: 'ledger-a', owner_id: 'user-a' },
      publicUser: {
        userId: 'user-a',
        email: 'owner@example.com',
        telegramUserId: '278516861',
        ledgerId: 'main-ledger',
        relationalLedgerId: 'ledger-a',
        displayName: 'ربيع',
        language: 'ar',
        active: true,
        source: 'supabase-auth',
      },
    })
    expect(spies.createClient).toHaveBeenCalledWith(
      ENV.SUPABASE_URL,
      ENV.SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer login-access' } } }),
    )
  })

  it('preserves provider error details when login fails', async () => {
    const error = authFailure('Wrong password', 'invalid_credentials', 401)
    const { service } = createFixture({ failures: { signIn: error } })

    await expect(service.login({ email: 'owner@example.com', password: 'wrong' })).rejects.toMatchObject({
      message: 'Wrong password',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('rejects incomplete sessions and disabled or ledger-less users', async () => {
    const incomplete = createFixture()
    incomplete.spies.signInWithPassword.mockResolvedValueOnce({ data: { user: incomplete.primaryUser }, error: null })
    await expect(incomplete.service.login({ email: 'owner@example.com', password: 'secret' }))
      .rejects.toThrow('Supabase Auth did not return a complete session.')

    const disabled = createFixture({ primaryActive: false })
    await expect(disabled.service.login({ email: 'owner@example.com', password: 'secret' }))
      .rejects.toMatchObject({ status: 403, message: 'This ADREEM user is disabled.' })

    const ledgerless = createFixture({ primaryHasLedger: false })
    await expect(ledgerless.service.login({ email: 'owner@example.com', password: 'secret' }))
      .rejects.toMatchObject({ status: 403, message: 'This ADREEM user is disabled.' })
  })

  it('refreshes and rotates both tokens before rebuilding the user context', async () => {
    const { service, spies } = createFixture()

    const result = await service.refresh('old-refresh')

    expect(spies.refreshSession).toHaveBeenCalledWith({ refresh_token: 'old-refresh' })
    expect(result).toMatchObject({
      token: 'refresh-access',
      refreshToken: 'refresh-refresh',
      publicUser: { userId: 'user-a', relationalLedgerId: 'ledger-a' },
    })
    expect(spies.createClient).toHaveBeenCalledWith(
      ENV.SUPABASE_URL,
      ENV.SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({ global: { headers: { Authorization: 'Bearer refresh-access' } } }),
    )
  })

  it('rejects failed refreshes and sessions whose user was disabled meanwhile', async () => {
    const failed = createFixture({ failures: { refresh: authFailure('Refresh expired', 'refresh_token_not_found', 401) } })
    await expect(failed.service.refresh('expired')).rejects.toMatchObject({
      message: 'Refresh expired',
      code: 'refresh_token_not_found',
      status: 401,
    })

    const disabled = createFixture({ primaryActive: false })
    await expect(disabled.service.refresh('old-refresh'))
      .rejects.toMatchObject({ status: 403, message: 'This ADREEM user is disabled.' })
  })

  it('rejects authentication users without explicit ADREEM membership before profile access', async () => {
    const fixture = createFixture({ primaryMember: false })

    await expect(fixture.service.login({ email: 'owner@example.com', password: 'secret' }))
      .rejects.toMatchObject({ status: 403, message: 'This authentication user is not an ADREEM member.' })
    await expect(fixture.service.refresh('old-refresh'))
      .rejects.toMatchObject({ status: 403, message: 'This authentication user is not an ADREEM member.' })
    await expect(fixture.service.authenticate('valid-access')).resolves.toBeNull()
  })

  it('preserves a rotated session on temporary profile lookup failure', async () => {
    const fixture = createFixture({ failures: { profileSelect: authFailure('Database unavailable', 'db_error', 503) } })

    await expect(fixture.service.refresh('old-refresh')).rejects.toMatchObject({
      status: 503,
      rotatedSession: {
        token: 'refresh-access',
        refreshToken: 'refresh-refresh',
      },
    })
  })

  it('authenticates a valid bearer token and rejects blank, invalid, disabled, or incomplete identities', async () => {
    const valid = createFixture({ primaryIsOwner: true })
    await expect(valid.service.authenticate(' valid-access ')).resolves.toMatchObject({
      accessToken: 'valid-access',
      authUser: { id: 'user-a' },
      profile: { id: 'user-a', is_system_owner: true },
      ledger: { id: 'ledger-a' },
      publicUser: { userId: 'user-a', isOwner: true },
      isOwner: true,
    })
    expect(valid.spies.getUser).toHaveBeenCalledWith('valid-access')

    await expect(valid.service.authenticate('')).resolves.toBeNull()
    await expect(valid.service.authenticate('invalid-access')).resolves.toBeNull()
    expect(valid.spies.getUser).toHaveBeenCalledTimes(2)

    const disabled = createFixture({ primaryActive: false })
    await expect(disabled.service.authenticate('valid-access')).resolves.toBeNull()

    const ledgerless = createFixture({ primaryHasLedger: false })
    await expect(ledgerless.service.authenticate('valid-access')).resolves.toBeNull()
  })

  it('returns null for verifier errors but propagates database lookup errors', async () => {
    const invalid = createFixture({ failures: { getUser: authFailure('JWT expired', 'bad_jwt', 401) } })
    await expect(invalid.service.authenticate('valid-access')).resolves.toBeNull()

    const databaseFailure = createFixture({ failures: { profileSelect: authFailure('Database unavailable', 'db_error', 503) } })
    await expect(databaseFailure.service.authenticate('valid-access')).rejects.toMatchObject({
      message: 'Database unavailable',
      code: 'db_error',
      status: 503,
    })
  })

  it('revokes complete and refresh-only sessions and handles failure paths safely', async () => {
    const success = createFixture()
    await success.service.logout('access', 'refresh')
    expect(success.spies.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
    expect(success.spies.signOut).toHaveBeenCalledWith({ scope: 'local' })

    await success.service.logout('', 'refresh')
    expect(success.spies.setSession).toHaveBeenCalledTimes(1)
    expect(success.spies.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh' })
    expect(success.spies.signOut).toHaveBeenCalledTimes(2)

    const restoreFailed = createFixture({ failures: { setSession: authFailure('Invalid session') } })
    await expect(restoreFailed.service.logout('access', 'refresh')).resolves.toBeUndefined()
    expect(restoreFailed.spies.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh' })
    expect(restoreFailed.spies.signOut).toHaveBeenCalledWith({ scope: 'local' })

    const refreshFailed = createFixture({ failures: { refresh: authFailure('Refresh expired') } })
    await expect(refreshFailed.service.logout('', 'refresh')).resolves.toBeUndefined()
    expect(refreshFailed.spies.signOut).not.toHaveBeenCalled()

    const signOutFailed = createFixture({ failures: { signOut: authFailure('Revoke failed', 'revoke_error', 502) } })
    await expect(signOutFailed.service.logout('access', 'refresh')).rejects.toMatchObject({
      message: 'Revoke failed',
      code: 'revoke_error',
      status: 502,
    })
  })
})

describe('Supabase Auth user administration', () => {
  it('lists users with their isolated ledgers and reads every authentication page', async () => {
    const additionalUsers = Array.from({ length: 1_000 }, (_, index) => ({
      id: `member-${index}`,
      email: `member-${index}@adreem.test`,
      displayName: `Member ${index}`,
      ledgerId: `book-${index}`,
    }))
    const { service, spies } = createFixture({ additionalUsers })

    const result = await service.listUsers()

    expect(result).toHaveLength(1_001)
    expect(result[1_000]).toMatchObject({
      userId: 'member-999',
      email: 'member-999@adreem.test',
      ledgerId: 'book-999',
      source: 'supabase-auth',
    })
    expect(spies.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1_000 })
    expect(spies.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1_000 })
  })

  it('surfaces profile, ledger, and authentication listing failures', async () => {
    const profileFailure = createFixture({ failures: { profilesList: authFailure('Profiles failed', 'profiles_error', 500) } })
    await expect(profileFailure.service.listUsers()).rejects.toMatchObject({ message: 'Profiles failed', status: 500 })

    const ledgerFailure = createFixture({ failures: { ledgersList: authFailure('Ledgers failed', 'ledgers_error', 500) } })
    await expect(ledgerFailure.service.listUsers()).rejects.toMatchObject({ message: 'Ledgers failed', status: 500 })

    const authListFailure = createFixture({ failures: { listUsers: authFailure('Users failed', 'users_error', 503) } })
    await expect(authListFailure.service.listUsers()).rejects.toMatchObject({ message: 'Users failed', status: 503 })
  })

  it('excludes non-members from administration and refuses to modify their ADREEM state', async () => {
    const { service, spies } = createFixture({
      additionalUsers: [{ id: 'outsider', email: 'outsider@example.com', member: false }],
    })

    await expect(service.listUsers()).resolves.toHaveLength(1)
    await expect(service.updateUser('outsider', { displayName: 'No access' }))
      .rejects.toMatchObject({ status: 403, message: 'This authentication user is not an ADREEM member.' })
    await expect(service.setUserActive('outsider', true))
      .rejects.toMatchObject({ status: 403, message: 'This authentication user is not an ADREEM member.' })
    expect(spies.updateUserById).not.toHaveBeenCalled()
  })

  it('creates a confirmed user with normalized identity metadata and returns its isolated ledger', async () => {
    const { service, spies } = createFixture()

    const result = await service.createUser({
      email: '  NEW@Example.COM ',
      password: 'strong-password',
      displayName: 'محمد',
      telegramUserId: 12345,
      ledgerId: '  Customer Main  ',
      language: 'en',
    })

    expect(spies.createUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'strong-password',
      email_confirm: true,
      ban_duration: '876000h',
      user_metadata: { display_name: 'محمد', language: 'en' },
      app_metadata: {
        adreem_member: true,
        adreem_disabled: true,
        adreem_legacy_ledger_id: 'customer-main',
        adreem_telegram_user_id: '12345',
        adreem_system_owner: false,
      },
    })
    expect(result).toMatchObject({
      email: 'new@example.com',
      displayName: 'محمد',
      telegramUserId: '12345',
      ledgerId: 'customer-main',
      relationalLedgerId: 'ledger-created-1',
      language: 'en',
      active: false,
      isOwner: false,
    })
  })

  it('activates a newly created member only after its disabled profile and ledger exist', async () => {
    const { profiles, service, spies, users } = createFixture()

    const result = await service.createUser({
      email: 'active@example.com',
      password: 'strong-password',
      displayName: 'Active User',
      ledgerId: 'active-ledger',
      active: true,
    })

    expect(spies.createUser).toHaveBeenCalledWith(expect.objectContaining({
      ban_duration: '876000h',
      app_metadata: expect.objectContaining({ adreem_member: true, adreem_disabled: true }),
    }))
    expect(spies.updateUserById).toHaveBeenCalledWith('created-1', {
      ban_duration: 'none',
      app_metadata: expect.objectContaining({ adreem_member: true, adreem_disabled: false }),
    })
    expect(profiles.get('created-1').is_active).toBe(true)
    expect(users.get('created-1').app_metadata.adreem_disabled).toBe(false)
    expect(result).toMatchObject({ userId: 'created-1', active: true })
  })

  it('rolls authentication back to disabled when new-user profile activation fails', async () => {
    const fixture = createFixture({ failures: { profileUpdate: authFailure('Profile unavailable', 'profile_error', 503) } })

    await expect(fixture.service.createUser({
      email: 'rollback@example.com',
      password: 'strong-password',
      ledgerId: 'rollback-ledger',
      active: true,
    })).rejects.toMatchObject({ status: 503 })

    expect(fixture.spies.updateUserById).toHaveBeenCalledTimes(2)
    expect(fixture.spies.updateUserById).toHaveBeenLastCalledWith('created-1', {
      ban_duration: '876000h',
      app_metadata: expect.objectContaining({ adreem_member: true, adreem_disabled: true }),
    })
    expect(fixture.profiles.get('created-1').is_active).toBe(false)
    expect(fixture.users.get('created-1')).toMatchObject({
      ban_duration: '876000h',
      app_metadata: { adreem_disabled: true },
    })
  })

  it('rejects non-boolean activation values before creating or updating a user', async () => {
    const { service, spies } = createFixture()

    await expect(service.createUser({ email: 'bad@example.com', password: 'secret', active: 'true' }))
      .rejects.toMatchObject({ status: 400, message: 'Active must be a boolean.' })
    await expect(service.setUserActive('user-a', 'false'))
      .rejects.toMatchObject({ status: 400, message: 'Active must be a boolean.' })

    expect(spies.createUser).not.toHaveBeenCalled()
    expect(spies.getUserById).not.toHaveBeenCalled()
    expect(spies.updateUserById).not.toHaveBeenCalled()
  })

  it('propagates user creation and post-creation profile lookup failures', async () => {
    const creationFailure = createFixture({ failures: { createUser: authFailure('Email already exists', 'email_exists', 422) } })
    await expect(creationFailure.service.createUser({ email: 'used@example.com', password: 'secret', ledgerId: 'used' }))
      .rejects.toMatchObject({ message: 'Email already exists', code: 'email_exists', status: 422 })

    const lookupFailure = createFixture({ failures: { profileSelect: authFailure('Profile trigger failed', 'profile_error', 500) } })
    await expect(lookupFailure.service.createUser({ email: 'new@example.com', password: 'secret', ledgerId: 'new' }))
      .rejects.toMatchObject({ message: 'Profile trigger failed', status: 500 })
  })

  it('updates only supplied fields while preserving unrelated authentication metadata', async () => {
    const { service, spies, users } = createFixture()
    users.get('user-a').user_metadata.timezone = 'Europe/Istanbul'
    users.get('user-a').app_metadata.plan = 'pro'

    const result = await service.updateUser('user-a', {
      email: '  UPDATED@Example.COM ',
      password: 'new-password',
      displayName: 'ربيع الجديد',
      telegramUserId: 9988,
      language: 'en',
    })

    expect(spies.updateUserById).toHaveBeenCalledWith('user-a', {
      email: 'updated@example.com',
      email_confirm: true,
      password: 'new-password',
      user_metadata: {
        display_name: 'ربيع الجديد',
        language: 'en',
        timezone: 'Europe/Istanbul',
      },
      app_metadata: {
        adreem_member: true,
        marker: 'user-a-marker',
        plan: 'pro',
        adreem_telegram_user_id: '9988',
      },
    })
    expect(result).toMatchObject({
      email: 'updated@example.com',
      displayName: 'ربيع الجديد',
      telegramUserId: '9988',
      language: 'en',
      ledgerId: 'main-ledger',
    })
  })

  it('does not overwrite optional fields that were omitted from an update', async () => {
    const { service, spies } = createFixture()

    await service.updateUser('user-a', { displayName: 'اسم فقط' })

    expect(spies.updateUserById).toHaveBeenCalledWith('user-a', {
      user_metadata: { display_name: 'اسم فقط', language: 'ar' },
      app_metadata: { adreem_member: true, marker: 'user-a-marker', adreem_telegram_user_id: '278516861' },
    })
  })

  it('restores profile fields when the authentication update fails', async () => {
    const fixture = createFixture({ failures: { updateUser: authFailure('Auth update failed', 'auth_update_failed', 503) } })

    await expect(fixture.service.updateUser('user-a', {
      email: 'new@example.com',
      displayName: 'اسم جديد',
      telegramUserId: '9988',
      language: 'en',
    })).rejects.toMatchObject({ code: 'auth_update_failed', status: 503 })

    expect(fixture.profiles.get('user-a')).toMatchObject({
      email: 'owner@example.com',
      display_name: 'ربيع',
      telegram_user_id: '278516861',
      language: 'ar',
    })
  })

  it('rejects changing a ledger identity or an invalid Telegram ID before mutation', async () => {
    const fixture = createFixture()

    await expect(fixture.service.updateUser('user-a', { ledgerId: 'another-ledger' }))
      .rejects.toMatchObject({ code: 'ledger-change-requires-migration', status: 409 })
    await expect(fixture.service.createUser({
      email: 'bad-telegram@example.com',
      password: 'strong-password',
      displayName: 'Bad ID',
      ledgerId: 'bad-telegram',
      telegramUserId: '12x',
    })).rejects.toMatchObject({ code: 'invalid-telegram-user-id', status: 400 })

    expect(fixture.spies.updateUserById).not.toHaveBeenCalled()
    expect(fixture.spies.createUser).not.toHaveBeenCalled()
  })

  it('rejects missing users and propagates update failures without masking their details', async () => {
    const missing = createFixture()
    await expect(missing.service.updateUser('missing-user', { displayName: 'Nobody' }))
      .rejects.toThrow('ADREEM user was not found.')
    expect(missing.spies.updateUserById).not.toHaveBeenCalled()

    const getFailure = createFixture({ failures: { getUserById: authFailure('Lookup failed', 'lookup_error', 503) } })
    await expect(getFailure.service.updateUser('user-a', {}))
      .rejects.toMatchObject({ message: 'Lookup failed', code: 'lookup_error', status: 503 })

    const updateFailure = createFixture({ failures: { updateUser: authFailure('Update failed', 'update_error', 422) } })
    await expect(updateFailure.service.updateUser('user-a', { displayName: 'New' }))
      .rejects.toMatchObject({ message: 'Update failed', code: 'update_error', status: 422 })
  })

  it('disables a member in both authentication and ledger access while preserving metadata', async () => {
    const { profiles, service, spies, users } = createFixture()
    users.get('user-a').app_metadata.plan = 'pro'

    const result = await service.setUserActive('user-a', false)

    expect(spies.updateUserById).toHaveBeenCalledWith('user-a', {
      ban_duration: '876000h',
      app_metadata: { adreem_member: true, marker: 'user-a-marker', plan: 'pro', adreem_disabled: true },
    })
    expect(profiles.get('user-a').is_active).toBe(false)
    expect(result).toMatchObject({ userId: 'user-a', active: false })
  })

  it('reactivates a member in both authentication and ledger access', async () => {
    const { profiles, service, spies, users } = createFixture({ primaryActive: false })
    users.get('user-a').app_metadata.adreem_disabled = true

    const result = await service.setUserActive('user-a', true)

    expect(spies.updateUserById).toHaveBeenCalledWith('user-a', {
      ban_duration: 'none',
      app_metadata: { adreem_member: true, marker: 'user-a-marker', adreem_disabled: false },
    })
    expect(profiles.get('user-a').is_active).toBe(true)
    expect(result).toMatchObject({ userId: 'user-a', active: true })
  })

  it('refuses to disable the system owner before changing authentication or profile state', async () => {
    const { profiles, service, spies } = createFixture({ primaryIsOwner: true })

    await expect(service.setUserActive('user-a', false)).rejects.toMatchObject({
      message: 'The ADREEM owner cannot be disabled.',
      status: 409,
    })
    expect(spies.updateUserById).not.toHaveBeenCalled()
    expect(profiles.get('user-a').is_active).toBe(true)
  })

  it('rejects unknown users and reports both authentication and profile update failures', async () => {
    const missing = createFixture()
    await expect(missing.service.setUserActive('missing-user', false))
      .rejects.toThrow('ADREEM user was not found.')

    const authFailureFixture = createFixture({ failures: { updateUser: authFailure('Ban failed', 'ban_error', 503) } })
    await expect(authFailureFixture.service.setUserActive('user-a', false))
      .rejects.toMatchObject({ message: 'Ban failed', code: 'ban_error', status: 503 })
    expect(authFailureFixture.profiles.get('user-a').is_active).toBe(true)

    const profileFailureFixture = createFixture({ failures: { profileUpdate: authFailure('Profile access failed', 'profile_update_error', 500) } })
    await expect(profileFailureFixture.service.setUserActive('user-a', false))
      .rejects.toMatchObject({ message: 'Profile access failed', code: 'profile_update_error', status: 500 })
    expect(profileFailureFixture.spies.updateUserById).toHaveBeenCalledTimes(2)
    expect(profileFailureFixture.spies.updateUserById).toHaveBeenLastCalledWith('user-a', {
      ban_duration: 'none',
      app_metadata: { adreem_member: true, marker: 'user-a-marker', adreem_disabled: false },
    })
    expect(profileFailureFixture.profiles.get('user-a').is_active).toBe(true)
  })
})
