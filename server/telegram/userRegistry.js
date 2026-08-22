import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes, createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { ADREEM_DEFAULT_LEDGER_ID, createLedgerIdentity, adreemStateRowId } from '../../src/ledger/ledgerState.js'
import { DEFAULT_UI_LANGUAGE, normalizeUiLanguage } from '../../src/ledger/uiLanguage.js'
import { parseTelegramLedgerMap } from '../ledger/ledgerRepository.js'

const HASH_PATTERN = /^[a-f0-9]{64}$/i
const PASSWORD_ITERATIONS = 210_000
const PASSWORD_KEYLEN = 32
const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000
const MAX_ACTIVE_SESSIONS = 12
const REGISTRY_LOCK_TIMEOUT_MS = 1_000
const REGISTRY_LOCK_RETRY_MS = 10
const REGISTRY_STALE_LOCK_MS = 30_000
const REMOVED_USER_AUTH_FIELDS = new Set([
  'passwordHash',
  'sessions',
  'sessionTokenHash',
  'sessionExpiresAt',
  'webTokenHash',
])
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4))

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

function sanitizeRemovedUserEntry(entry = {}) {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => !REMOVED_USER_AUTH_FIELDS.has(key)),
  )
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
    language: normalizeUiLanguage(entry.language, DEFAULT_UI_LANGUAGE),
  }
}

export function loadTelegramUserRegistry(filePath = defaultRegistryPath()) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    const users = Array.isArray(data?.users) ? data.users.map(normalizeTelegramUserEntry).filter(Boolean) : []
    const removed = Array.isArray(data?.removed)
      ? data.removed
        .filter((entry) => entry && typeof entry === 'object')
        .map(sanitizeRemovedUserEntry)
      : []
    return { users, removed }
  } catch (error) {
    if (error?.code === 'ENOENT') return { users: [], removed: [] }
    throw error
  }
}

function writeTelegramUserRegistryFile(filePath, registry) {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = `${JSON.stringify({
    ...registry,
    users: registry.users || [],
    removed: (registry.removed || []).map(sanitizeRemovedUserEntry),
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

function acquireRegistryLock(filePath, {
  lockTimeoutMs = REGISTRY_LOCK_TIMEOUT_MS,
  retryDelayMs = REGISTRY_LOCK_RETRY_MS,
} = {}) {
  mkdirSync(dirname(filePath), { recursive: true })
  const lockPath = `${filePath}.lock`
  const lockToken = `${process.pid}-${randomBytes(12).toString('hex')}`
  const deadline = Date.now() + Math.max(0, Number(lockTimeoutMs) || 0)

  while (true) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600)
      try {
        writeFileSync(descriptor, lockToken)
      } finally {
        closeSync(descriptor)
      }
      return () => {
        try {
          if (readFileSync(lockPath, 'utf8') === lockToken) unlinkSync(lockPath)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > REGISTRY_STALE_LOCK_MS) {
          unlinkSync(lockPath)
          continue
        }
      } catch (staleError) {
        if (staleError?.code === 'ENOENT') continue
        throw staleError
      }
      if (Date.now() >= deadline) {
        const timeoutError = new Error(`Timed out waiting for Telegram user registry lock: ${filePath}`)
        timeoutError.code = 'REGISTRY_LOCK_TIMEOUT'
        throw timeoutError
      }
      const waitMs = Math.min(Math.max(1, Number(retryDelayMs) || REGISTRY_LOCK_RETRY_MS), deadline - Date.now())
      Atomics.wait(lockWaitBuffer, 0, 0, waitMs)
    }
  }
}

function withRegistryLock(filePath, callback, options) {
  const release = acquireRegistryLock(filePath, options)
  try {
    return callback()
  } finally {
    release()
  }
}

export function saveTelegramUserRegistry(filePath, registry, options) {
  return withRegistryLock(filePath, () => writeTelegramUserRegistryFile(filePath, registry), options)
}

export function updateTelegramUserRegistry(filePath, updater, options) {
  return withRegistryLock(filePath, () => {
    const current = loadTelegramUserRegistry(filePath)
    const next = updater(current)
    if (next === null || next === undefined) return current
    writeTelegramUserRegistryFile(filePath, next)
    return next
  }, options)
}

export function validateTelegramLedgerAssignments(access) {
  const registry = loadTelegramUserRegistry(access.filePath)
  const ledgerByTelegramUser = new Map()
  const ownerByLedger = new Map()

  function addAssignment(telegramUserId, ledgerId, source, ownerId = telegramUserId) {
    const userKey = String(telegramUserId || '').trim()
    const ownerKey = String(ownerId || '').trim()
    const ledgerKey = String(ledgerId || '').trim()
    if (!ownerKey || !ledgerKey) return ''
    if (userKey) {
      const existingLedger = ledgerByTelegramUser.get(userKey)
      if (existingLedger && existingLedger.ledgerId !== ledgerKey) {
        return `Telegram user ${userKey} is assigned to ledger "${existingLedger.ledgerId}" in ${existingLedger.source} and "${ledgerKey}" in ${source}`
      }
      ledgerByTelegramUser.set(userKey, { ledgerId: ledgerKey, source })
    }
    const existingOwner = ownerByLedger.get(ledgerKey)
    if (existingOwner && existingOwner.ownerId !== ownerKey) {
      return `ledger "${ledgerKey}" is assigned to ${existingOwner.ownerId} in ${existingOwner.source} and ${ownerKey} in ${source}`
    }
    ownerByLedger.set(ledgerKey, { ownerId: ownerKey, source })
    return ''
  }

  for (const [telegramUserId, ledgerId] of access.envLedgerMap.entries()) {
    const problem = addAssignment(telegramUserId, ledgerId, 'configuration', `telegram user ${telegramUserId}`)
    if (problem) return problem
  }
  for (const user of registry.users) {
    const ownerId = user.telegramUserId ? `telegram user ${user.telegramUserId}` : `registry user ${user.userId}`
    const problem = addAssignment(user.telegramUserId, user.ledgerId, 'registry', ownerId)
    if (problem) return problem
  }
  return ''
}

export function createTelegramUserAccess(env = process.env, filePath = defaultRegistryPath(env)) {
  const envUserIds = parseIdList(
    env.ADREEM_TELEGRAM_USER_IDS ||
    env.ADREEM_TELEGRAM_USER_ID ||
    '',
  )
  const adminIds = parseIdList(env.ADREEM_TELEGRAM_ADMIN_IDS)
  const ownerEmails = parseIdList(env.ADREEM_OWNER_EMAILS || env.ADREEM_OWNER_EMAIL).map(normalizeEmail)
  const ownerUserIds = parseIdList(env.ADREEM_OWNER_USER_IDS || env.ADREEM_OWNER_USER_ID)
  const ownerLedgerIds = parseIdList(env.ADREEM_OWNER_LEDGER_IDS || env.ADREEM_OWNER_LEDGER_ID)
  const envLedgerMap = parseTelegramLedgerMap(env.ADREEM_TELEGRAM_LEDGER_IDS)

  function registryMap() {
    const registry = loadTelegramUserRegistry(filePath)
    return new Map(registry.users
      .filter((entry) => entry.telegramUserId)
      .map((entry) => [entry.telegramUserId, entry.ledgerId]))
  }

  function ledgerIdForUser(userId) {
    const key = String(userId || '')
    const configuredLedgerId = envLedgerMap.get(key) || ''
    const registryLedgerId = registryMap().get(key) || ''
    if (configuredLedgerId && registryLedgerId && configuredLedgerId !== registryLedgerId) {
      throw new Error(`Conflicting ledger assignments for Telegram user ${key}.`)
    }
    return configuredLedgerId || registryLedgerId
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

  function envTelegramConflict(entry) {
    if (!entry.telegramUserId) return null
    const configuredLedgerId = envLedgerMap.get(entry.telegramUserId)
    if (!configuredLedgerId || configuredLedgerId === entry.ledgerId) return null
    return { ok: false, error: 'telegram-used', existingUserId: entry.telegramUserId }
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
    language = DEFAULT_UI_LANGUAGE,
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
      language,
      passwordHash: password ? createPasswordHash(password) : '',
      webTokenHash: '',
    })
    if (!entry) return { ok: false, error: 'invalid-user-or-ledger' }
    if (email && !entry.email.includes('@')) return { ok: false, error: 'invalid-email' }
    if (password && !entry.passwordHash) return { ok: false, error: 'weak-password' }
    let result
    updateTelegramUserRegistry(filePath, (registry) => {
      const telegramConflict = envTelegramConflict(entry)
      if (telegramConflict) {
        result = telegramConflict
        return null
      }
      const envLedgerOwner = [...envLedgerMap.entries()].find(([envUserId, mappedLedgerId]) =>
        envUserId !== entry.telegramUserId && mappedLedgerId === entry.ledgerId)
      if (envLedgerOwner) {
        result = { ok: false, error: 'ledger-used', existingUserId: envLedgerOwner[0] }
        return null
      }
      const existingLedgerOwner = registry.users.find((user) =>
        user.userId !== entry.userId && user.ledgerId === entry.ledgerId)
      if (existingLedgerOwner) {
        result = { ok: false, error: 'ledger-used', existingUserId: existingLedgerOwner.userId }
        return null
      }
      if (entry.telegramUserId) {
        const existingTelegramOwner = registry.users.find((user) =>
          user.userId !== entry.userId && user.telegramUserId === entry.telegramUserId)
        if (existingTelegramOwner) {
          result = { ok: false, error: 'telegram-used', existingUserId: existingTelegramOwner.userId }
          return null
        }
      }
      if (entry.email) {
        const existingEmailOwner = registry.users.find((user) =>
          user.userId !== entry.userId && normalizeEmail(user.email) === entry.email)
        if (existingEmailOwner) {
          result = { ok: false, error: 'email-used', existingUserId: existingEmailOwner.userId }
          return null
        }
      }
      const nextUsers = registry.users.filter((user) => user.userId !== entry.userId)
      nextUsers.push(entry)
      nextUsers.sort((a, b) => a.userId.localeCompare(b.userId))
      result = { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }), webToken, webUrl: webUrlForToken(webToken, env) }
      return { ...registry, users: nextUsers }
    })
    return result
  }

  function updateUser(userId, {
    email,
    password = '',
    telegramUserId,
    ledgerId,
    displayName,
    language,
    updatedBy = '',
  } = {}) {
    const targetUserId = String(userId || '').trim()
    const passwordHash = password ? createPasswordHash(password) : ''
    if (password && !passwordHash) return { ok: false, error: 'weak-password' }
    let result
    updateTelegramUserRegistry(filePath, (registry) => {
      const target = registry.users.find((user) => user.userId === targetUserId)
      if (!target) {
        result = { ok: false, error: 'not-found' }
        return null
      }
      const requestedLedgerId = ledgerId === undefined
        ? target.ledgerId
        : createLedgerIdentity({ ledgerId }).ledgerId
      if (requestedLedgerId !== target.ledgerId) {
        result = { ok: false, error: 'ledger-change-requires-migration' }
        return null
      }
      const entry = normalizeTelegramUserEntry({
        ...target,
        email: email === undefined ? target.email : email,
        telegramUserId: telegramUserId === undefined ? target.telegramUserId : telegramUserId,
        ledgerId: target.ledgerId,
        displayName: displayName === undefined ? target.displayName : displayName,
        language: language === undefined ? target.language : language,
        passwordHash: password ? passwordHash : target.passwordHash,
        sessions: password ? [] : target.sessions,
        updatedAt: new Date().toISOString(),
        updatedBy,
      })
      if (!entry) {
        result = { ok: false, error: 'invalid-user-or-ledger' }
        return null
      }
      if (entry.email && !entry.email.includes('@')) {
        result = { ok: false, error: 'invalid-email' }
        return null
      }
      if (isOwnerUser(target) && !isOwnerUser(entry)) {
        result = { ok: false, error: 'owner-identity-required' }
        return null
      }
      const telegramConflict = envTelegramConflict(entry)
      if (telegramConflict) {
        result = telegramConflict
        return null
      }
      const envLedgerOwner = [...envLedgerMap.entries()].find(([envUserId, mappedLedgerId]) =>
        envUserId !== entry.telegramUserId && mappedLedgerId === entry.ledgerId)
      if (envLedgerOwner) {
        result = { ok: false, error: 'ledger-used', existingUserId: envLedgerOwner[0] }
        return null
      }
      const existingLedgerOwner = registry.users.find((user) =>
        user.userId !== entry.userId && user.ledgerId === entry.ledgerId)
      if (existingLedgerOwner) {
        result = { ok: false, error: 'ledger-used', existingUserId: existingLedgerOwner.userId }
        return null
      }
      if (entry.telegramUserId) {
        const existingTelegramOwner = registry.users.find((user) =>
          user.userId !== entry.userId && user.telegramUserId === entry.telegramUserId)
        if (existingTelegramOwner) {
          result = { ok: false, error: 'telegram-used', existingUserId: existingTelegramOwner.userId }
          return null
        }
      }
      if (entry.email) {
        const existingEmailOwner = registry.users.find((user) =>
          user.userId !== entry.userId && normalizeEmail(user.email) === entry.email)
        if (existingEmailOwner) {
          result = { ok: false, error: 'email-used', existingUserId: existingEmailOwner.userId }
          return null
        }
      }
      const nextUsers = registry.users.map((user) => (user.userId === targetUserId ? entry : user))
      nextUsers.sort((a, b) => a.userId.localeCompare(b.userId))
      result = { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }) }
      return { ...registry, users: nextUsers }
    })
    return result
  }

  function removeUserAccess(userId, { requestedBy = '' } = {}) {
    const targetUserId = String(userId || '').trim()
    let result
    updateTelegramUserRegistry(filePath, (registry) => {
      const target = registry.users.find((user) => user.userId === targetUserId)
      if (!target) {
        result = { ok: false, error: 'not-found' }
        return null
      }
      if (isOwnerUser(target)) {
        result = { ok: false, error: 'owner-protected' }
        return null
      }
      const removedUser = sanitizeRemovedUserEntry(target)
      result = { ok: true, removed: removedUser }
      return {
        ...registry,
        users: registry.users.filter((user) => user.userId !== targetUserId),
        removed: [
          ...(registry.removed || []),
          { ...removedUser, removedAt: new Date().toISOString(), removedBy: requestedBy },
        ],
      }
    })
    return result
  }

  function loginUser({ email, password }) {
    const normalizedEmail = normalizeEmail(email)
    if (!normalizedEmail || !password) return { ok: false, error: 'invalid-login' }
    let result
    updateTelegramUserRegistry(filePath, (registry) => {
      const target = registry.users.find((user) => normalizeEmail(user.email) === normalizedEmail)
      if (!target?.passwordHash || !verifyPassword(password, target.passwordHash)) {
        result = { ok: false, error: 'invalid-login' }
        return null
      }
      const sessionToken = createPrivateWebToken()
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
      const session = {
        tokenHash: webTokenHash(sessionToken),
        expiresAt: sessionExpiresAt,
        createdAt: new Date().toISOString(),
      }
      const nextSessions = [
        ...(target.sessions || []).filter((item) => new Date(item.expiresAt || 0).getTime() > Date.now()),
        session,
      ].slice(-MAX_ACTIVE_SESSIONS)
      const nextUsers = registry.users.map((user) => user.userId === target.userId
        ? { ...user, sessions: nextSessions, lastLoginAt: new Date().toISOString() }
        : user)
      const entry = normalizeTelegramUserEntry({ ...target, sessions: nextSessions })
      result = { ok: true, entry, sessionToken, sessionExpiresAt }
      return { ...registry, users: nextUsers }
    })
    return result
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

  function userForTelegramId(userId = '') {
    const telegramUserId = String(userId || '').trim()
    if (!telegramUserId) return null
    return loadTelegramUserRegistry(filePath).users.find((user) => user.telegramUserId === telegramUserId) || null
  }

  function languageForTelegramUser(userId = '') {
    return normalizeUiLanguage(userForTelegramId(userId)?.language, DEFAULT_UI_LANGUAGE)
  }

  function revokeSessionToken(token = '') {
    const cleanToken = String(token || '').trim()
    if (!cleanToken) return { ok: false, error: 'invalid-token' }
    const tokenHash = webTokenHash(cleanToken)
    let result
    updateTelegramUserRegistry(filePath, (registry) => {
      const target = registry.users.find((user) =>
        (user.sessions || []).some((session) => session.tokenHash === tokenHash))
      if (!target) {
        result = { ok: false, error: 'not-found' }
        return null
      }
      result = { ok: true, userId: target.userId }
      return {
        ...registry,
        users: registry.users.map((user) => user.userId === target.userId
          ? { ...user, sessions: (user.sessions || []).filter((session) => session.tokenHash !== tokenHash) }
          : user),
      }
    })
    return result
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
    userForTelegramId,
    languageForTelegramUser,
    revokeSessionToken,
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
