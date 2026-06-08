import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { ADREEM_DEFAULT_LEDGER_ID, createLedgerIdentity, adreemStateRowId } from '../../src/mohammadLedger/ledgerState.js'
import { parseTelegramLedgerMap } from '../mohammadLedger/ledgerRepository.js'

const HASH_PATTERN = /^[a-f0-9]{64}$/i
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEYLEN = 32
const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000

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
  return `${webBaseUrl(env).replace(/#.*$/, '').replace(/\/?$/, '/') }#ledger_token=${token}`
}

export function normalizeTelegramUserEntry(entry = {}) {
  const userId = String(entry.userId || entry.id || entry.telegramUserId || '').trim()
  const telegramUserId = String(entry.telegramUserId || '').trim()
  const email = normalizeEmail(entry.email)
  const rawLedgerId = String(entry.ledgerId || '').trim()
  const identity = createLedgerIdentity({ ledgerId: rawLedgerId })
  if (!userId || !rawLedgerId || !identity.ledgerId) return null
  if (identity.ledgerId === ADREEM_DEFAULT_LEDGER_ID && rawLedgerId.toLowerCase() !== ADREEM_DEFAULT_LEDGER_ID) return null
  const sessionExpiresAt = entry.sessionExpiresAt ? String(entry.sessionExpiresAt) : ''
  return {
    userId,
    email,
    telegramUserId,
    ledgerId: identity.ledgerId,
    webTokenHash: normalizeOptionalHash(entry.webTokenHash),
    sessionTokenHash: normalizeOptionalHash(entry.sessionTokenHash),
    sessionExpiresAt,
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
    return { users }
  } catch (error) {
    if (error?.code === 'ENOENT') return { users: [] }
    throw error
  }
}

export function saveTelegramUserRegistry(filePath, registry) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify({ ...registry, users: registry.users || [] }, null, 2)}\n`, { mode: 0o600 })
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
    const webToken = createWebToken ? createPrivateWebToken() : ''
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
      webTokenHash: webToken ? webTokenHash(webToken) : '',
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
    saveTelegramUserRegistry(filePath, { users: nextUsers })
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
    const entry = normalizeTelegramUserEntry({
      ...target,
      email: email === undefined ? target.email : email,
      telegramUserId: telegramUserId === undefined ? target.telegramUserId : telegramUserId,
      ledgerId: ledgerId === undefined ? target.ledgerId : ledgerId,
      displayName: displayName === undefined ? target.displayName : displayName,
      passwordHash: password ? createPasswordHash(password) : target.passwordHash,
      sessionTokenHash: password ? '' : target.sessionTokenHash,
      sessionExpiresAt: password ? '' : target.sessionExpiresAt,
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
    saveTelegramUserRegistry(filePath, { users: nextUsers })
    return { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }) }
  }

  function removeUserAccess(userId, { requestedBy = '' } = {}) {
    const targetUserId = String(userId || '').trim()
    const registry = loadTelegramUserRegistry(filePath)
    const target = registry.users.find((user) => user.userId === targetUserId)
    if (!target) return { ok: false, error: 'not-found' }
    if (isOwnerUser(target)) return { ok: false, error: 'owner-protected' }
    const nextUsers = registry.users.filter((user) => user.userId !== targetUserId)
    saveTelegramUserRegistry(filePath, { users: nextUsers, removed: [{ ...target, removedAt: new Date().toISOString(), removedBy: requestedBy }] })
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
    const nextUsers = registry.users.map((user) => user.userId === target.userId
      ? {
          ...user,
          sessionTokenHash: webTokenHash(sessionToken),
          sessionExpiresAt,
          lastLoginAt: new Date().toISOString(),
        }
      : user)
    saveTelegramUserRegistry(filePath, { users: nextUsers })
    const entry = normalizeTelegramUserEntry({ ...target, sessionTokenHash: webTokenHash(sessionToken), sessionExpiresAt })
    return { ok: true, entry, sessionToken, sessionExpiresAt }
  }

  function userForSessionToken(token = '') {
    if (!String(token || '').trim()) return null
    const hash = webTokenHash(token)
    if (!normalizeOptionalHash(hash)) return null
    const registry = loadTelegramUserRegistry(filePath)
    const now = Date.now()
    const target = registry.users.find((user) => {
      const expiresAt = new Date(user.sessionExpiresAt || 0).getTime()
      return user.sessionTokenHash === hash && Number.isFinite(expiresAt) && expiresAt > now
    })
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
    if (user.webTokenHash) pairs.push([user.webTokenHash, user.ledgerId])
    const expiresAt = new Date(user.sessionExpiresAt || 0).getTime()
    if (user.sessionTokenHash && Number.isFinite(expiresAt) && expiresAt > now) {
      pairs.push([user.sessionTokenHash, user.ledgerId])
    }
  }
  return new Map(pairs)
}
