import { createClient } from '@supabase/supabase-js'
import { createLedgerIdentity } from '../../src/ledger/ledgerState.js'

const USER_PAGE_SIZE = 1_000
const LONG_BAN_DURATION = '876000h'
const ADREEM_MEMBER_METADATA_KEY = 'adreem_member'

export function supabaseAuthEnabled(env = process.env) {
  return String(env.ADREEM_AUTH_MODE || '').trim().toLowerCase() === 'supabase'
}

function requiredAuthConfig(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !publishableKey || !serviceKey) {
    throw new Error('Supabase Auth requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY.')
  }
  return { url, publishableKey, serviceKey }
}

function authError(error, fallback) {
  const next = new Error(error?.message || fallback)
  next.code = error?.code || ''
  next.status = error?.status || 0
  return next
}

function isAdreemMember(user) {
  return user?.app_metadata?.[ADREEM_MEMBER_METADATA_KEY] === true
}

function requireAdreemMember(user) {
  if (isAdreemMember(user)) return
  throw authError({ status: 403 }, 'This authentication user is not an ADREEM member.')
}

function telegramUserIdValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (!/^\d{1,19}$/.test(text) || BigInt(text) > 9_223_372_036_854_775_807n) {
    throw authError({ status: 400, code: 'invalid-telegram-user-id' }, 'Telegram user ID is invalid.')
  }
  return text
}

function attachRotatedSession(error, session) {
  const next = error instanceof Error ? error : authError(error, 'Failed to load the ADREEM session.')
  next.rotatedSession = session
  return next
}

function createPublicClient(config, createClientImpl, accessToken = '') {
  return createClientImpl(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
  })
}

function sessionResult(data = {}) {
  const session = data.session
  const user = data.user || session?.user
  if (!session?.access_token || !session?.refresh_token || !user?.id) {
    throw new Error('Supabase Auth did not return a complete session.')
  }
  return {
    token: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    user,
  }
}

function publicUser(profile = {}, ledger = {}, authUser = {}) {
  return {
    userId: profile.id || authUser.id || '',
    email: profile.email || authUser.email || '',
    telegramUserId: profile.telegram_user_id ? String(profile.telegram_user_id) : '',
    ledgerId: ledger.legacy_ledger_id || ledger.id || '',
    relationalLedgerId: ledger.id || '',
    displayName: profile.display_name || authUser.user_metadata?.display_name || '',
    language: profile.language || 'ar',
    active: profile.is_active !== false,
    isOwner: Boolean(profile.is_system_owner),
    source: 'supabase-auth',
    hasPassword: true,
  }
}

export function createSupabaseAuthService(env = process.env, options = {}) {
  const config = requiredAuthConfig(env)
  const createClientImpl = options.createClientImpl || createClient
  const admin = createClientImpl(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function profileAndLedger(client, userId) {
    const { data: profile, error: profileError } = await client
      .from('adreem_profiles')
      .select('id, email, display_name, telegram_user_id, language, is_system_owner, is_active')
      .eq('id', userId)
      .maybeSingle()
    if (profileError) throw authError(profileError, 'Failed to load the user profile.')
    const { data: ledger, error: ledgerError } = await client
      .from('adreem_ledgers')
      .select('id, owner_id, legacy_ledger_id, name, revision')
      .eq('owner_id', userId)
      .maybeSingle()
    if (ledgerError) throw authError(ledgerError, 'Failed to load the user ledger.')
    return { profile, ledger }
  }

  async function login({ email, password }) {
    const client = createPublicClient(config, createClientImpl)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw authError(error, 'Invalid email or password.')
    const result = sessionResult(data)
    requireAdreemMember(result.user)
    const userClient = createPublicClient(config, createClientImpl, result.token)
    const { profile, ledger } = await profileAndLedger(userClient, result.user.id)
    if (!profile?.is_active || !ledger) throw authError({ status: 403 }, 'This ADREEM user is disabled.')
    return { ...result, client: userClient, profile, ledger, publicUser: publicUser(profile, ledger, result.user) }
  }

  async function refresh(refreshToken) {
    const client = createPublicClient(config, createClientImpl)
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken })
    if (error) throw authError(error, 'The login session has expired.')
    const result = sessionResult(data)
    try {
      requireAdreemMember(result.user)
      const userClient = createPublicClient(config, createClientImpl, result.token)
      const { profile, ledger } = await profileAndLedger(userClient, result.user.id)
      if (!profile?.is_active || !ledger) throw authError({ status: 403 }, 'This ADREEM user is disabled.')
      return { ...result, client: userClient, profile, ledger, publicUser: publicUser(profile, ledger, result.user) }
    } catch (profileError) {
      throw attachRotatedSession(profileError, result)
    }
  }

  async function logout(accessToken, refreshToken) {
    if (!refreshToken) return false
    const client = createPublicClient(config, createClientImpl)
    if (accessToken) {
      const { error: sessionError } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (sessionError) {
        const { error: refreshError } = await client.auth.refreshSession({ refresh_token: refreshToken })
        if (refreshError) return false
      }
    } else {
      const { error: refreshError } = await client.auth.refreshSession({ refresh_token: refreshToken })
      if (refreshError) return false
    }
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw authError(error, 'Failed to revoke the login session.')
    return true
  }

  async function authenticate(accessToken) {
    const token = String(accessToken || '').trim()
    if (!token) return null
    const verifier = createPublicClient(config, createClientImpl)
    const { data, error } = await verifier.auth.getUser(token)
    if (error || !data?.user?.id) return null
    if (!isAdreemMember(data.user)) return null
    const client = createPublicClient(config, createClientImpl, token)
    const { profile, ledger } = await profileAndLedger(client, data.user.id)
    if (!profile?.is_active || !ledger) return null
    return {
      accessToken: token,
      authUser: data.user,
      client,
      profile,
      ledger,
      publicUser: publicUser(profile, ledger, data.user),
      isOwner: Boolean(profile.is_system_owner),
    }
  }

  async function listUsers() {
    const { data: profileRows, error: profilesError } = await admin
      .from('adreem_profiles')
      .select('id, email, display_name, telegram_user_id, language, is_system_owner, is_active')
      .order('created_at', { ascending: true })
    if (profilesError) throw authError(profilesError, 'Failed to list ADREEM profiles.')
    const { data: ledgerRows, error: ledgersError } = await admin
      .from('adreem_ledgers')
      .select('id, owner_id, legacy_ledger_id, name, revision')
    if (ledgersError) throw authError(ledgersError, 'Failed to list ADREEM ledgers.')
    const authUsers = []
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE })
      if (error) throw authError(error, 'Failed to list authentication users.')
      authUsers.push(...(data?.users || []))
      if (!data?.users || data.users.length < USER_PAGE_SIZE) break
    }
    const authById = new Map(authUsers.map((user) => [user.id, user]))
    const ledgerByOwner = new Map((ledgerRows || []).map((ledger) => [ledger.owner_id, ledger]))
    return (profileRows || [])
      .filter((profile) => isAdreemMember(authById.get(profile.id)))
      .map((profile) => publicUser(profile, ledgerByOwner.get(profile.id), authById.get(profile.id)))
  }

  async function createUser({ email, password, displayName = '', telegramUserId = '', ledgerId, language = 'ar', active = false }) {
    if (typeof active !== 'boolean') throw authError({ status: 400 }, 'Active must be a boolean.')
    const normalizedLedgerId = createLedgerIdentity({ ledgerId }).ledgerId
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedDisplayName = String(displayName || '').trim()
    const normalizedLanguage = language === 'en' ? 'en' : 'ar'
    const normalizedTelegramUserId = telegramUserIdValue(telegramUserId)
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      ban_duration: LONG_BAN_DURATION,
      user_metadata: { display_name: normalizedDisplayName, language: normalizedLanguage },
      app_metadata: {
        [ADREEM_MEMBER_METADATA_KEY]: true,
        adreem_disabled: true,
        adreem_legacy_ledger_id: normalizedLedgerId,
        adreem_telegram_user_id: normalizedTelegramUserId || '',
        adreem_system_owner: false,
      },
    })
    if (error) throw authError(error, 'Failed to create the ADREEM user.')
    const { profile, ledger } = await profileAndLedger(admin, data.user.id)
    if (!active) return publicUser(profile, ledger, data.user)
    return setUserActive(data.user.id, true)
  }

  async function updateUser(userId, updates = {}) {
    const { data: existingData, error: existingError } = await admin.auth.admin.getUserById(userId)
    if (existingError || !existingData?.user) throw authError(existingError, 'ADREEM user was not found.')
    const existing = existingData.user
    requireAdreemMember(existing)
    const { profile: currentProfile, ledger: currentLedger } = await profileAndLedger(admin, userId)
    if (updates.ledgerId !== undefined && createLedgerIdentity({ ledgerId: updates.ledgerId }).ledgerId !== currentLedger.legacy_ledger_id) {
      throw authError({ status: 409, code: 'ledger-change-requires-migration' }, 'The ledger ID cannot change without a migration.')
    }
    const nextProfile = {
      userId,
      email: updates.email === undefined ? currentProfile.email : String(updates.email || '').trim().toLowerCase(),
      displayName: updates.displayName === undefined ? currentProfile.display_name : String(updates.displayName || '').trim(),
      telegramUserId: updates.telegramUserId === undefined ? currentProfile.telegram_user_id : telegramUserIdValue(updates.telegramUserId),
      language: updates.language === undefined ? currentProfile.language : updates.language === 'en' ? 'en' : 'ar',
    }
    const attributes = {
      user_metadata: {
        ...(existing.user_metadata || {}),
        display_name: nextProfile.displayName,
        language: nextProfile.language,
      },
      app_metadata: {
        ...(existing.app_metadata || {}),
        adreem_telegram_user_id: nextProfile.telegramUserId ? String(nextProfile.telegramUserId) : '',
      },
      ...(updates.email ? { email: nextProfile.email, email_confirm: true } : {}),
      ...(updates.password ? { password: updates.password } : {}),
    }
    const { data, error } = await admin.auth.admin.updateUserById(userId, attributes)
    if (error) throw authError(error, 'Failed to update the ADREEM user.')
    const { profile, ledger } = await profileAndLedger(admin, userId)
    return publicUser(profile, ledger, data.user)
  }

  async function setUserActive(userId, active) {
    if (typeof active !== 'boolean') throw authError({ status: 400 }, 'Active must be a boolean.')
    const { data: existingData, error: existingError } = await admin.auth.admin.getUserById(userId)
    if (existingError || !existingData?.user) throw authError(existingError, 'ADREEM user was not found.')
    const existing = existingData.user
    requireAdreemMember(existing)
    const { profile: currentProfile, ledger } = await profileAndLedger(admin, userId)
    if (!active && currentProfile?.is_system_owner) {
      throw authError({ status: 409 }, 'The ADREEM owner cannot be disabled.')
    }
    const { data: authUpdateData, error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: active ? 'none' : LONG_BAN_DURATION,
      app_metadata: { ...(existing.app_metadata || {}), adreem_disabled: !active },
    })
    if (authUpdateError) throw authError(authUpdateError, 'Failed to update user access.')
    const { data: updatedProfile, error: profileError } = await admin
      .from('adreem_profiles')
      .update({ is_active: Boolean(active) })
      .eq('id', userId)
      .select('id')
      .maybeSingle()
    if (profileError || !updatedProfile) {
      const previousActive = currentProfile?.is_active !== false
      const { error: rollbackError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: previousActive ? 'none' : LONG_BAN_DURATION,
        app_metadata: { ...(existing.app_metadata || {}), adreem_disabled: !previousActive },
      })
      if (rollbackError) {
        const failure = authError(profileError, 'Failed to update ledger access and restore authentication state.')
        failure.rollbackError = rollbackError?.message || 'Authentication rollback failed.'
        failure.status = 503
        throw failure
      }
      throw authError(profileError, 'Failed to update ledger access.')
    }
    return publicUser(
      { ...currentProfile, is_active: active },
      ledger,
      authUpdateData?.user || existing,
    )
  }

  return {
    admin,
    authenticate,
    createUser,
    listUsers,
    login,
    logout,
    refresh,
    setUserActive,
    updateUser,
  }
}
