import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { createLedgerIdentity, adreemStateRowId } from '../../src/mohammadLedger/ledgerState.js'
import { parseTelegramLedgerMap } from '../mohammadLedger/ledgerRepository.js'

const HASH_PATTERN = /^[a-f0-9]{64}$/i

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

export function createPrivateWebToken() {
  return randomBytes(32).toString('base64url')
}

export function webUrlForToken(token, env = process.env) {
  return `${webBaseUrl(env).replace(/#.*$/, '').replace(/\/?$/, '/') }#ledger_token=${token}`
}

export function normalizeTelegramUserEntry(entry = {}) {
  const telegramUserId = String(entry.telegramUserId || entry.userId || entry.id || '').trim()
  const identity = createLedgerIdentity({ ledgerId: entry.ledgerId })
  if (!telegramUserId || !identity.ledgerId) return null
  const hash = String(entry.webTokenHash || '').trim().toLowerCase()
  return {
    telegramUserId,
    ledgerId: identity.ledgerId,
    webTokenHash: HASH_PATTERN.test(hash) ? hash : '',
    addedAt: entry.addedAt || new Date().toISOString(),
    addedBy: entry.addedBy ? String(entry.addedBy) : '',
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
  writeFileSync(filePath, `${JSON.stringify({ users: registry.users || [] }, null, 2)}\n`, { mode: 0o600 })
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
  const envLedgerMap = parseTelegramLedgerMap(env.ADREEM_TELEGRAM_LEDGER_IDS || env.MOHAMMAD_TELEGRAM_LEDGER_IDS)

  function registryMap() {
    const registry = loadTelegramUserRegistry(filePath)
    return new Map(registry.users.map((entry) => [entry.telegramUserId, entry.ledgerId]))
  }

  function ledgerIdForUser(userId) {
    const key = String(userId || '')
    return envLedgerMap.get(key) || registryMap().get(key) || ''
  }

  function isAdmin(userId) {
    return adminIds.includes(String(userId || ''))
  }

  function isAllowed(userId) {
    const key = String(userId || '')
    return isAdmin(key) || Boolean(ledgerIdForUser(key))
  }

  function addUser({ telegramUserId, ledgerId, addedBy, firstName = '', username = '' }) {
    const webToken = createPrivateWebToken()
    const entry = normalizeTelegramUserEntry({
      telegramUserId,
      ledgerId,
      addedBy,
      firstName,
      username,
      webTokenHash: webTokenHash(webToken),
    })
    if (!entry) return { ok: false, error: 'invalid-user-or-ledger' }
    const registry = loadTelegramUserRegistry(filePath)
    const envLedgerOwner = [...envLedgerMap.entries()].find(([userId, mappedLedgerId]) =>
      userId !== entry.telegramUserId && mappedLedgerId === entry.ledgerId)
    if (envLedgerOwner) {
      return { ok: false, error: 'ledger-used', existingUserId: envLedgerOwner[0] }
    }
    const existingLedgerOwner = registry.users.find((user) =>
      user.telegramUserId !== entry.telegramUserId && user.ledgerId === entry.ledgerId)
    if (existingLedgerOwner) {
      return { ok: false, error: 'ledger-used', existingUserId: existingLedgerOwner.telegramUserId }
    }
    const nextUsers = registry.users.filter((user) => user.telegramUserId !== entry.telegramUserId)
    nextUsers.push(entry)
    nextUsers.sort((a, b) => a.telegramUserId.localeCompare(b.telegramUserId))
    saveTelegramUserRegistry(filePath, { users: nextUsers })
    return { ok: true, entry, rowId: adreemStateRowId({ ledgerId: entry.ledgerId }), webToken, webUrl: webUrlForToken(webToken, env) }
  }

  function listUsers() {
    const registry = loadTelegramUserRegistry(filePath)
    const envUsers = [...envLedgerMap.entries()].map(([telegramUserId, ledgerId]) => ({
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
    isAllowed,
    ledgerIdForUser,
    addUser,
    listUsers,
  }
}

export function registryWebTokenMap(env = process.env, filePath = defaultRegistryPath(env)) {
  const registry = loadTelegramUserRegistry(filePath)
  return new Map(registry.users
    .filter((user) => user.webTokenHash)
    .map((user) => [user.webTokenHash, user.ledgerId]))
}
