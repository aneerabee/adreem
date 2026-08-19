import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { ADREEM_DEFAULT_LEDGER_ID, createLedgerIdentity, adreemStateRowId } from '../../src/mohammadLedger/ledgerState.js'
import { parseTelegramLedgerMap } from '../mohammadLedger/ledgerRepository.js'

const HASH_PATTERN = /^[a-f0-9]{64}$/i
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEYLEN = 32
const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000
const MAX_ACTIVE_SESSIONS = 12

export function parseIdList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function defaultRegistryPath(env = process.env) {
  return env.ADREEM_TELEGRAM_USERS_FILE || env.ADREEM_TELEGRAM_REGISTRY_PATH || './adreem-telegram-users.json'
}

export function webBaseUrl(env = process.env) {
  return env.ADREEM_WEB_APP_URL || env.ADREEM_WEB_URL || 'https://aneerabee.github.io/adreem/'
}

export function webTokenHash(token = '') {
  return createHash('sha256').update(String(token || '').trim()).digest('hex')
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizeOptionalHash(value = '') {
  const hash = String(value || '').trim().toLowerCase()
  return HASH_PATTERN.test(hash) ? hash : ''
}

function normalizeSession(entry = {}) {
  const tokenHash = normalizeOptionalHash(entry.tokenHash || entry.sessionTokenHash)
  const expiresAt = String(entry.expiresAt || entry.sessionExpiresAt || '').trim()
  if (!tokenHash || !expiresAt || !Number.isFinite(new Date(expiresAt).getTime())) return null
  return {
    tokenHash,
    expiresAt,
    createdAt: String(entry.createdAt || entry.lastLoginAt || '').trim(),
  }
}

function normalizeSessions(entry = {}) {
  const candidates = [
    ...(Array.isArray(entry.sessions) ? entry.sessions : []),
    entry.sessionTokenHash ? entry : null,
  ].filter(Boolean)
  const byHash = new Map()
  for (const candidate of candidates) {
    const session = normalizeSession(candidate)
    if (session) byHash.set(session.tokenHash, session)
  }
  return Array.from(byHash.values())
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0))
    .slice(-MAX_ACTIVE_SESSIONS)
}

export function createPasswordHash(password = '') {
  const text = String(password || '')
  if (text.length < 8) return ''
  const salt = randomBytes(16).toString('base64url')
  const hash = pbkdf2Sync(text, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, 'sha256').toString('base64url')
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`
}

export function verifyPassword(password = '', passwordHash = '') {
  const [kind, iterationsText, salt, expected] = String(passwordHash || '').split('$')
  const iterations = Number(iterationsText)
  if (kind !== 'pbkdf2-sha256' || !iterations || !salt || !expected) return false
  const actual = pbkdf2Sync(String(password || ''), salt, iterations, PASSWORD_KEYLEN, 'sha256')
  const expectedBuffer = Buffer.from(expected, 'base64url')
  if (actual.length !== expectedBuffer.length) return false
  return timingSafeEqual(actual, expectedBuffer)
}

export function createPrivateWebToken() {
  return randomBytes(32).toString('base64url')
}

export function webUrlForToken(token, env = process.env) {
  void token
  return webBaseUrl(env).replace(/#.*$/, '').replace(/\/?$/, '/')
}

export function normalizeTelegramUserEntry(entry = {}) {
  const userId = String(entry.userId || entry.id || entry.telegramUserId || '').trim()
  const telegramUserId = String(entry.telegramUserId || '').trim()
  const email = normalizeEmail(entry.email)
  const rawLedgerId = String(entry.ledgerId || '').trim()
  const identity = createLedgerIdentity({ ledgerId: rawLedgerId })
  if (!userId || !rawLedgerId || !identity.ledgerId) return null
  if (identity.ledgerId === ADREEM_DEFAULT_LEDGER_ID && rawLedgerId.toLowerCase() !== ADREEM_DEFAULT_LEDGER_ID) return null
  return {
    userId,
    email,
    telegramUserId,
    ledgerId: identity.ledgerId,
    webTokenHash: normalizeOptionalHash(entry.webTokenHash),
    sessionTokenHash: '',
    sessionExpiresAt: '',
    sessions: normalizeSessions(entry),
    passwordHash: String(entry.passwordHash || '').startsWith('pbkdf2-sha256$') ? String(entry.passwordHash) : '',
    addedAt: entry.addedAt || new Date().toISOString(),
    addedBy: entry.addedBy ? String(entry.addedBy) : '',
    updatedAt: entry.updatedAt ? String(entry.updatedAt) : '',
    updatedBy: entry.updatedBy ? String(entry.updatedBy) : '',
    displayName: entry.displayName ? String(entry.displayName).slice(0, 80) : '',
    firstName: entry.firstName ? String(entry.firstName).slice(0, 80) : '',
    username: entry.username ? String(entry.username).slice(0, 80) : '',
  }
}

export function loadTelegramUserRegistry(filePath = defaultRegistryPath()) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    const users = Array.isArray(data?.users) ? data.users.map(normalizeTelegramUserEntry).filter(Boolean) : []
    const removed = Array.isArray(data?.removed) ? data.removed.filter((entry) => entry && typeof entry === 'object') : []
    return { users, removed }
  } catch (error) {
    if (error?.code === 'ENOENT') return { users: [], removed: [] }
    throw error
  }
}

export function saveTelegramUserRegistry(filePath, registry) {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = `${JSON.stringify({
    ...registry,
    users: registry.users || [],
    removed: registry.removed || [],
  }, null, 2)}\n`
  try {
    writeFileSync(temporaryPath, payload, { mode: 0o600, flag: 'wx' })
    renameSync(temporaryPath, filePath)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // The temporary file may not have been created.
    }
    throw error
  }
}

export function createTelegramUserAccess(env = process.env, filePath = defaultRegistryPath(env)) {
  const envUserIds = parseIdList(
    env.ADREEM_TELEGRAM_USER_IDS ||
    env.ADREEM_TELEGRAM_USER_ID ||
    env.MOHAMMAD_TELEGRAM_USER_IDS ||
    env.MOHAMMAD_TELEGRAM_USER_ID ||
    '',
  )
  const adminIds = parseIdList(env.ADREEM_TELEGRAM_ADMIN_IDS || envUserIds.join(','))
  const ownerEmails = parseIdList(env.ADREEM_OWNER_EMAILS || env.ADREEM_OWNER_EMAIL).map(normalizeEmail)
  const ownerUserIds = parseIdList(env.ADREEM_OWNER_USER_IDS || env.ADREEM_OWNER_USER_ID)
  const ownerLedgerIds = parseIdList(env.ADREEM_OWNER_LEDGER_IDS || env.ADREEM_OWNER_LEDGER_ID)
  const envLedgerMap = parseTelegramLedgerMap(env.ADREEM_TELEGRAM_LEDGER_IDS || env.MOHAMMAD_TELEGRAM_LEDGER_IDS)

  function registryMap() {
    const registry = loadTelegramUserRegistry(filePath)
    return new Map(registry.users
      .filter((entry) => entry.telegramUserId)
      .map((entry) => [entry.telegramUserId, entry.ledgerId]))
  }

  function ledgerIdForUser(userId) {
    const key = String(userId || '')
    return envLedgerMap.get(key) || registryMap().get(key) || ''
  }

  function isAdmin(userId) {
    return adminIds.includes(String(userId || ''))
  }

  function isOwnerUser(user = {}) {
    const email = normalizeEmail(user.email)
    const userId = String(user.userId || '').trim()
    const telegramUserId = String(user.telegramUserId || '').trim()
    const ledgerId = String(user.ledgerId || '').trim()
    return Boolean(
      (email && ownerEmails.includes(email)) ||
      (userId && ownerUserIds.includes(userId)) ||
      (telegramUserId && ownerUserIds.includes(telegramUserId)) ||
      (ledgerId && ownerLedgerIds.includes(ledgerId)) ||
      (telegramUserId && adminIds.includes(telegramUserId)),
    )
  }

  function isAllowed(userId) {
    const key = String(userId || '')
    return isAdmin(key) || Boolean(ledgerIdForUser(key))
  }

  function addUser({
    userId,
    email = '',
    password = '',
    telegramUserId = '',
    ledgerId,
    addedBy,
    displayName = '',
    firstName = '',
    username = '',
    createWebToken = false,
  }) {
    void createWebToken
    const webToken = ''
    const entry = normalizeTelegramUserEntry({
      userId: userId || telegramUserId,
      email,
      telegramUserId,
      ledgerId,
      addedBy,
      displayName,
      firstName,
      username,
      passwordHash: password ? createPasswordHash(password) : '',
      webTokenHash: '',
    })
    if (!entry) return { ok: false, error: 'invalid-user-or-ledger' }
    if (email && !entry.email.includes('@')) return { ok: false, error: 'invalid-email' }
    if (password && !entry.passwordHash) return { ok: false, error: 'weak-password' }
    const registry = loadTelegramUserRegistry(filePath)
    const envLedgerOwner = [...envLedgerMap.entries()].find(([envUserId, mappedLedgerId]) =>
      entry.telegramUserId && envUserId !== entry.telegramUserId && mappedLedgerId === entry.ledgerId)
    if (envLedgerOwner) {
      return { ok: false, error: 'ledger-used', existingUserId: envLedgerOwner[0] }
    }
    const existingLedgerOwner = registry.users.find((user) =>
      user.userId !== entry.userId && user.ledgerId === entry.ledgerId)
    if (existingLedgerOwner) {
      return { ok: false, error: 'ledger-used', existingUserId: existingLedgerOwner.userId }
    }
    if (entry.telegramUserId) {
      const existingTelegramOwner = registry.users.find((user) =>
        user.userId !== entry.userId && user.telegramUserId === entry.telegramUserId)
      if (existingTelegramOwner) {
        return { ok: false, error: 'telegram-used', existingUserId: existingTelegramOwner.userId }
      }
    }
    if (entry.email) {
      const existingEmailOwner = registry.users.find((user) =>
        user.userId !== entry.userId && normalizeEmail(user.email) === entry.email)
      if (existingEmailOwner) {
        return { ok: false, error: 'email-used', existingUserId: existingEmailOwner.userId }
      }
    }
    const nextUsers = registry.users.filter((user) => user.userId !== entry.userId)
    nextUsers.push(entry)
    nextUsers.sort((a, b) => a.userId.localeCompare(b.userId))
    saveTelegramUserRegistry(filePath, { ...registry, users: nextUsers })
    return { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }), webToken, webUrl: webUrlForToken(webToken, env) }
  }

  function updateUser(userId, {
    email,
    password = '',
    telegramUserId = '',
    ledgerId,
    displayName = '',
    updatedBy = '',
  } = {}) {
    const targetUserId = String(userId || '').trim()
    const registry = loadTelegramUserRegistry(filePath)
    const target = registry.users.find((user) => user.userId === targetUserId)
    if (!target) return { ok: false, error: 'not-found' }
    const requestedLedgerId = ledgerId === undefined
      ? target.ledgerId
      : createLedgerIdentity({ ledgerId }).ledgerId
    if (requestedLedgerId !== target.ledgerId) {
      return { ok: false, error: 'ledger-change-requires-migration' }
    }
    const entry = normalizeTelegramUserEntry({
      ...target,
      email: email === undefined ? target.email : email,
      telegramUserId: telegramUserId === undefined ? target.telegramUserId : telegramUserId,
      ledgerId: target.ledgerId,
      displayName: displayName === undefined ? target.displayName : displayName,
      passwordHash: password ? createPasswordHash(password) : target.passwordHash,
      sessions: password ? [] : target.sessions,
      updatedAt: new Date().toISOString(),
      updatedBy,
    })
    if (!entry) return { ok: false, error: 'invalid-user-or-ledger' }
    if (entry.email && !entry.email.includes('@')) return { ok: false, error: 'invalid-email' }
    if (password && !entry.passwordHash) return { ok: false, error: 'weak-password' }
    const envLedgerOwner = [...envLedgerMap.entries()].find(([envUserId, mappedLedgerId]) =>
      entry.telegramUserId && envUserId !== entry.telegramUserId && mappedLedgerId === entry.ledgerId)
    if (envLedgerOwner) return { ok: false, error: 'ledger-used', existingUserId: envLedgerOwner[0] }
    const existingLedgerOwner = registry.users.find((user) =>
      user.userId !== entry.userId && user.ledgerId === entry.ledgerId)
    if (existingLedgerOwner) return { ok: false, error: 'ledger-used', existingUserId: existingLedgerOwner.userId }
    if (entry.telegramUserId) {
      const existingTelegramOwner = registry.users.find((user) =>
        user.userId !== entry.userId && user.telegramUserId === entry.telegramUserId)
      if (existingTelegramOwner) return { ok: false, error: 'telegram-used', existingUserId: existingTelegramOwner.userId }
    }
    if (entry.email) {
      const existingEmailOwner = registry.users.find((user) =>
        user.userId !== entry.userId && normalizeEmail(user.email) === entry.email)
      if (existingEmailOwner) return { ok: false, error: 'email-used', existingUserId: existingEmailOwner.userId }
    }
    const nextUsers = registry.users.map((user) => (user.userId === targetUserId ? entry : user))
    nextUsers.sort((a, b) => a.userId.localeCompare(b.userId))
    saveTelegramUserRegistry(filePath, { ...registry, users: nextUsers })
    return { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }) }
  }

  function removeUserAccess(userId, { requestedBy = '' } = {}) {
    const targetUserId = String(userId || '').trim()
    const registry = loadTelegramUserRegistry(filePath)
    const target = registry.users.find((user) => user.userId === targetUserId)
    if (!target) return { ok: false, error: 'not-found' }
    if (isOwnerUser(target)) return { ok: false, error: 'owner-protected' }
    const nextUsers = registry.users.filter((user) => user.userId !== targetUserId)
    saveTelegramUserRegistry(filePath, {
      ...registry,
      users: nextUsers,
      removed: [
        ...(registry.removed || []),
        { ...target, removedAt: new Date().toISOString(), removedBy: requestedBy },
      ],
    })
    return { ok: true, removed: target }
  }

  function loginUser({ email, password }) {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail || !password) return { ok: false, error: 'invalid-login' }
    const registry = loadTelegramUserRegistry(filePath)
    const target = registry.users.find((user) => normalizeEmail(user.email) === normalizedEmail)
    if (!target?.passwordHash || !verifyPassword(password, target.passwordHash)) {
      return { ok: false, error: 'invalid-login' }
    }
    const sessionToken = createPrivateWebToken()
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    const session = {
      tokenHash: webTokenHash(sessionToken),
      expiresAt: sessionExpiresAt,
      createdAt: new Date().toISOString(),
    }
    const nextUsers = registry.users.map((user) => user.userId === target.userId
      ? {
          ...user,
          sessions: [
            ...(user.sessions || []).filter((item) => new Date(item.expiresAt || 0).getTime() > Date.now()),
            session,
          ].slice(-MAX_ACTIVE_SESSIONS),
          lastLoginAt: new Date().toISOString(),
        }
      : user)
    saveTelegramUserRegistry(filePath, { ...registry, users: nextUsers })
    const entry = normalizeTelegramUserEntry({ ...target, sessions: [...(target.sessions || []), session] })
    return { ok: true, entry, sessionToken, sessionExpiresAt }
  }

  function userForSessionToken(token = '') {
    if (!String(token || '').trim()) return null
    const hash = webTokenHash(token)
    if (!normalizeOptionalHash(hash)) return null
    const registry = loadTelegramUserRegistry(filePath)
    const now = Date.now()
    const target = registry.users.find((user) => (user.sessions || []).some((session) => {
      const expiresAt = new Date(session.expiresAt || 0).getTime()
      return session.tokenHash === hash && Number.isFinite(expiresAt) && expiresAt > now
    }))
    return target || null
  }

  function listUsers() {
    const registry = loadTelegramUserRegistry(filePath)
    const registryLedgerIds = new Set(registry.users.map((user) => user.ledgerId))
    const envUsers = [...envLedgerMap.entries()].filter(([, ledgerId]) => !registryLedgerIds.has(ledgerId)).map(([telegramUserId, ledgerId]) => ({
      userId: `telegram-${telegramUserId}`,
      email: '',
      telegramUserId,
      ledgerId,
      source: 'env',
    }))
    const dynamicUsers = registry.users.map((user) => ({ ...user, source: 'registry' }))
    return [...envUsers, ...dynamicUsers].sort((a, b) => a.telegramUserId.localeCompare(b.telegramUserId))
  }

  return {
    adminIds,
    envUserIds,
    envLedgerMap,
    filePath,
    isAdmin,
    isOwnerUser,
    isAllowed,
    ledgerIdForUser,
    addUser,
    updateUser,
    removeUserAccess,
    loginUser,
    userForSessionToken,
    listUsers,
  }
}

export function registryWebTokenMap(env = process.env, filePath = defaultRegistryPath(env)) {
  const registry = loadTelegramUserRegistry(filePath)
  const now = Date.now()
  const pairs = []
  for (const user of registry.users) {
    for (const session of user.sessions || []) {
      const expiresAt = new Date(session.expiresAt || 0).getTime()
      if (session.tokenHash && Number.isFinite(expiresAt) && expiresAt > now) {
        pairs.push([session.tokenHash, user.ledgerId])
      }
    }
  }
  return new Map(pairs)
}

export function registrySessionTokenMap(env = process.env, filePath = defaultRegistryPath(env)) {
  const registry = loadTelegramUserRegistry(filePath)
  const now = Date.now()
  const pairs = []
  for (const user of registry.users) {
    for (const session of user.sessions || []) {
      const expiresAt = new Date(session.expiresAt || 0).getTime()
      if (session.tokenHash && Number.isFinite(expiresAt) && expiresAt > now) {
        pairs.push([session.tokenHash, user.ledgerId])
      }
    }
  }
  return new Map(pairs)
}
