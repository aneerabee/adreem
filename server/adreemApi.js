import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { ConcurrentLedgerUpdateError, createLedgerRepository, LedgerIntegrityError } from './ledger/ledgerRepository.js'
import { validateLedgerStateTransition } from './ledger/stateValidation.js'
import { attachmentContentMatchesMime, decodeCanonicalBase64 } from './ledger/attachmentValidation.js'
import { mergeLedgerStates } from '../src/ledger/ledgerState.js'
import { ALLOWED_ATTACHMENT_MIME_TYPES, ATTACHMENT_MAX_SIZE_BYTES } from '../src/ledger/ledgerOperations.js'
import { deleteUnusedAccountFromLedgerState } from '../src/ledger/accountEditing.js'
import { isSupportedUiLanguage, normalizeUiLanguage } from '../src/ledger/uiLanguage.js'
import {
  createUserAccess,
  defaultRegistryPath,
  registrySessionTokenMap,
  validateUserLedgerAssignments,
} from './auth/userRegistry.js'
import { createAdreemV3ApiHandler } from './adreemV3Api.js'
import { supabaseAuthEnabled } from './ledger/supabaseAuth.js'

const DEFAULT_PORT = 8787
const DEFAULT_JSON_BODY_LIMIT = 5_000_000
const ATTACHMENT_BODY_LIMIT = 15_000_000
const RATE_LIMITS = {
  login: { limit: 8, windowMs: 15 * 60 * 1000 },
  admin: { limit: 120, windowMs: 60 * 1000 },
  ledgerRead: { limit: 240, windowMs: 60 * 1000 },
  ledgerWrite: { limit: 80, windowMs: 60 * 1000 },
  attachment: { limit: 30, windowMs: 60 * 1000 },
}
const MOVEMENT_AUDIT_FIELDS = [
  'id',
  'type',
  'status',
  'amount',
  'currency',
  'sourceAccountId',
  'destinationAccountId',
  'rate',
  'dimensionId',
  'expenseCategoryId',
  'createdAt',
  'updatedAt',
]
const MOVEMENT_AUDIT_FIELD_SET = new Set(MOVEMENT_AUDIT_FIELDS)

class ApiRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
  }
}

export function parseLedgerTokenMap(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((map, item) => {
      const [token, ledgerId] = item.split('=').map((part) => part?.trim())
      if (token && ledgerId) map.set(token, ledgerId)
      return map
    }, new Map())
}

export function tokenHash(token = '') {
  return createHash('sha256').update(String(token || '').trim()).digest('hex')
}

export function parseLedgerTokenHashMap(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((map, item) => {
      const [hash, ledgerId] = item.split('=').map((part) => part?.trim())
      if (/^[a-f0-9]{64}$/i.test(hash || '') && ledgerId) map.set(hash.toLowerCase(), ledgerId)
      return map
    }, new Map())
}

export function tokenFromAuthHeader(header = '') {
  const match = String(header || '').match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function sendJson(res, statusCode, payload, origin = '*') {
  const body = statusCode === 204 ? '' : JSON.stringify(payload)
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
  }
  if (statusCode !== 204) headers['content-length'] = Buffer.byteLength(body)
  res.writeHead(statusCode, {
    ...headers,
  })
  res.end(body)
}

export function createMemoryRateLimiter(now = () => Date.now(), { maxBuckets = 5_000 } = {}) {
  const buckets = new Map()

  function prune(currentTime) {
    for (const [key, bucket] of buckets) {
      if (currentTime >= bucket.resetAt) buckets.delete(key)
    }
    while (buckets.size >= maxBuckets) {
      const oldestKey = buckets.keys().next().value
      if (oldestKey === undefined) break
      buckets.delete(oldestKey)
    }
  }

  return {
    check(key, { limit, windowMs }) {
      const safeKey = String(key || 'anonymous')
      const currentTime = now()
      const existing = buckets.get(safeKey)
      if (!existing || currentTime >= existing.resetAt) {
        if (!existing) prune(currentTime)
        buckets.set(safeKey, { count: 1, resetAt: currentTime + windowMs })
        return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 }
      }
      existing.count += 1
      if (existing.count <= limit) {
        return { ok: true, remaining: Math.max(0, limit - existing.count), retryAfterSeconds: 0 }
      }
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1000)),
      }
    },
    size() {
      return buckets.size
    },
  }
}

function auditLogPath(env = process.env) {
  if (env.ADREEM_AUDIT_LOG_FILE) return env.ADREEM_AUDIT_LOG_FILE
  const registryPath = defaultRegistryPath(env)
  return `${dirname(registryPath)}/adreem-audit.jsonl`
}

function audit(env, event) {
  if (env.ADREEM_AUDIT_DISABLED === 'true' || (process.env.NODE_ENV === 'test' && !env.ADREEM_AUDIT_LOG_FILE)) return
  const record = {
    at: new Date().toISOString(),
    service: 'adreem-api',
    ...event,
  }
  try {
    const filePath = auditLogPath(env)
    mkdirSync(dirname(filePath), { recursive: true })
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  } catch (error) {
    console.error('[adreem-audit]', error?.message || error)
  }
}

function movementAuditSnapshot(movement = {}) {
  return Object.fromEntries(MOVEMENT_AUDIT_FIELDS.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(movement, field)) return []
    const value = movement[field]
    if (value === null || typeof value === 'boolean') return [[field, value]]
    if (typeof value === 'number' && Number.isFinite(value)) return [[field, value]]
    if (typeof value === 'string') return [[field, value.slice(0, 160)]]
    return []
  }))
}

function movementUpdateAuditEntries(beforeState = {}, afterState = {}) {
  const beforeMovements = Array.isArray(beforeState.movements) ? beforeState.movements : []
  const afterMovements = Array.isArray(afterState.movements) ? afterState.movements : []
  const beforeById = new Map(beforeMovements
    .filter((movement) => movement?.id)
    .map((movement) => [movement.id, movement]))

  return afterMovements.flatMap((after) => {
    const before = beforeById.get(after?.id)
    if (!before || isDeepStrictEqual(before, after)) return []
    const allChangedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => !isDeepStrictEqual(before[field], after[field]))
    const changedFields = allChangedFields.filter((field) => MOVEMENT_AUDIT_FIELD_SET.has(field))
    return [{
      movementId: String(after.id).slice(0, 160),
      changedFields,
      redactedFieldChanges: allChangedFields.length - changedFields.length,
      before: movementAuditSnapshot(before),
      after: movementAuditSnapshot(after),
    }]
  })
}

export function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return forwarded.at(-1) || req.socket?.remoteAddress || 'unknown'
}

function rateKey(req, scope, extra = '') {
  return [scope, clientIp(req), extra].filter(Boolean).join(':')
}

function rejectRateLimited(res, origin, result) {
  const payload = { error: 'Too many requests. Try again later.', retryAfterSeconds: result.retryAfterSeconds }
  const body = JSON.stringify(payload)
  res.writeHead(429, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    pragma: 'no-cache',
    'retry-after': String(result.retryAfterSeconds),
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function userIdFromAdminPath(pathname = '') {
  const match = String(pathname || '').match(/^\/api\/admin\/users\/([^/]+)$/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

function accountIdFromPath(pathname = '') {
  const match = String(pathname || '').match(/^\/api\/accounts\/([^/]+)$/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

function readJsonBody(req, { maxBytes = DEFAULT_JSON_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > maxBytes) {
        reject(new ApiRequestError('Request body too large.', 413))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new ApiRequestError('Invalid JSON body.', 400))
      }
    })
    req.on('error', reject)
  })
}

function cleanFileName(value = '') {
  const cleaned = String(value || 'attachment')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return cleaned || 'attachment'
}

function storageClient(env) {
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!bucket) throw new ApiRequestError('Attachments bucket is not configured.', 501)
  if (!supabaseUrl || !supabaseKey) throw new ApiRequestError('Attachment storage is not configured.', 501)
  return {
    bucket,
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  }
}

export function isLedgerStoragePath(storagePath = '', ledgerId = '') {
  const cleanPath = String(storagePath || '').trim()
  const cleanLedgerId = String(ledgerId || '').trim()
  const parts = cleanPath.split('/')
  return Boolean(
    cleanLedgerId &&
    parts.length >= 2 &&
    parts[0] === cleanLedgerId &&
    parts.every((part) => part && part !== '.' && part !== '..'),
  )
}

async function signAttachment(env, { ledgerId, storagePath }) {
  if (!isLedgerStoragePath(storagePath, ledgerId)) throw new ApiRequestError('Attachment path is outside this ledger.', 403)
  const { bucket, client } = storageClient(env)
  const { data, error } = await client.storage.from(bucket).createSignedUrl(storagePath, 15 * 60)
  if (error || !data?.signedUrl) throw new ApiRequestError(error?.message || 'Attachment signing failed.', 500)
  return data.signedUrl
}

async function uploadAttachment(env, { ledgerId, fileName, mimeType, base64 }) {
  let buffer
  try {
    buffer = decodeCanonicalBase64(base64)
  } catch (error) {
    throw new ApiRequestError(error.message, 400)
  }
  if (!buffer.length) throw new ApiRequestError('Attachment file is empty.', 400)
  if (buffer.length > ATTACHMENT_MAX_SIZE_BYTES) throw new ApiRequestError('Attachment is larger than 10MB.', 413)
  const safeName = cleanFileName(fileName)
  const date = new Date().toISOString().slice(0, 10)
  const hash = createHash('sha256').update(`${ledgerId}:${safeName}:${Date.now()}:${buffer.length}`).digest('hex').slice(0, 16)
  const storagePath = `${ledgerId}/${date}/${hash}-${safeName}`
  const contentType = String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream'
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(contentType.toLowerCase())) {
    throw new ApiRequestError('Attachment type is not allowed.', 415)
  }
  if (!attachmentContentMatchesMime(buffer, contentType)) {
    throw new ApiRequestError('Attachment content does not match its file type.', 415)
  }
  const { bucket, client } = storageClient(env)
  const { error } = await client.storage.from(bucket).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  })
  if (error) throw new ApiRequestError(error.message || 'Attachment upload failed.', 500)
  const { data, error: signedError } = await client.storage.from(bucket).createSignedUrl(storagePath, 15 * 60)
  if (signedError) throw new ApiRequestError(signedError.message || 'Attachment signing failed.', 500)
  return {
    label: safeName,
    url: data?.signedUrl || '',
    storagePath,
    mimeType: contentType,
    sizeBytes: buffer.length,
  }
}

export function createAdreemApiHandler(env = process.env) {
  if (supabaseAuthEnabled(env)) return createAdreemV3ApiHandler(env)
  const userAccess = createUserAccess(env)
  const ledgerMapProblem = validateUserLedgerAssignments(userAccess)
  if (ledgerMapProblem) {
    throw new Error(`Invalid user ledger assignments: ${ledgerMapProblem}`)
  }
  const repositories = new Map()
  const allowedOrigin = env.ADREEM_WEB_ALLOWED_ORIGIN || '*'
  const rateLimiter = createMemoryRateLimiter()
  let testRepository = null
  let testRepositoryFactory = null
  let readinessRepository = null

  function ledgerIdForToken(token) {
    const hash = tokenHash(token)
    return registrySessionTokenMap(env).get(hash) || ''
  }

  function repositoryForToken(token) {
    const ledgerId = ledgerIdForToken(token)
    if (!ledgerId) return null
    if (testRepository) return testRepository
    if (testRepositoryFactory) return testRepositoryFactory(ledgerId)
    if (!repositories.has(ledgerId)) {
      repositories.set(ledgerId, createLedgerRepository(env, { ledgerId }))
    }
    return repositories.get(ledgerId)
  }

  function ownerForToken(token) {
    const user = userAccess.userForSessionToken(token)
    return user && userAccess.isOwnerUser(user) ? user : null
  }

  function publicUser(user) {
    const safeUser = user || {}
    return {
      userId: safeUser.userId || '',
      email: safeUser.email || '',
      ledgerId: safeUser.ledgerId || '',
      source: safeUser.source || 'registry',
      displayName: safeUser.displayName || safeUser.firstName || safeUser.username || '',
      firstName: safeUser.firstName || '',
      username: safeUser.username || '',
      addedAt: safeUser.addedAt || '',
      addedBy: safeUser.addedBy || '',
      hasWebToken: false,
      hasPassword: Boolean(safeUser.passwordHash),
      language: normalizeUiLanguage(safeUser.language),
    }
  }

  async function adreemApiHandler(req, res) {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {}, allowedOrigin)
    }

    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'adreem-api' }, allowedOrigin)
    }
    if (url.pathname === '/ready') {
      try {
        readinessRepository ||= testRepository || createLedgerRepository(env, {
          ledgerId: env.ADREEM_HEALTH_LEDGER_ID || env.ADREEM_LEDGER_ID || 'main',
        })
        const result = await readinessRepository.load()
        return sendJson(res, 200, {
          ok: true,
          service: 'adreem-api',
          storage: 'reachable',
          updatedAt: result.updatedAt || null,
        }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-ready]', error?.message || error)
        return sendJson(res, 503, { ok: false, service: 'adreem-api', storage: 'unreachable' }, allowedOrigin)
      }
    }
    if (url.pathname === '/api/auth/login') {
      try {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
        const body = await readJsonBody(req)
        const normalizedEmail = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        if (normalizedEmail.length > 254 || password.length > 256) {
          return sendJson(res, 400, { error: 'Invalid login input.' }, allowedOrigin)
        }
        const limit = rateLimiter.check(rateKey(req, 'login'), RATE_LIMITS.login)
        if (!limit.ok) {
          audit(env, { action: 'auth.rate_limited', ip: clientIp(req) })
          return rejectRateLimited(res, allowedOrigin, limit)
        }
        const result = userAccess.loginUser({ email: normalizedEmail, password })
        audit(env, {
          action: result.ok ? 'auth.login.success' : 'auth.login.failed',
          ip: clientIp(req),
          emailHash: normalizedEmail ? tokenHash(normalizedEmail).slice(0, 16) : '',
          userId: result.entry?.userId || '',
          ledgerId: result.entry?.ledgerId || '',
        })
        if (!result.ok) return sendJson(res, 401, { error: 'Invalid email or password.' }, allowedOrigin)
        return sendJson(res, 200, {
          token: result.sessionToken,
          expiresAt: result.sessionExpiresAt,
          user: publicUser({ ...result.entry, source: 'registry' }),
        }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-auth]', error?.message || error)
        if (error instanceof ApiRequestError) {
          return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
        }
        return sendJson(res, 500, { error: 'ADREEM auth failed.' }, allowedOrigin)
      }
    }
    if (url.pathname === '/api/auth/logout') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
      const token = tokenFromAuthHeader(req.headers.authorization)
      if (!token) return sendJson(res, 204, {}, allowedOrigin)
      try {
        userAccess.revokeSessionToken?.(token)
        audit(env, { action: 'auth.logout', ip: clientIp(req) })
        return sendJson(res, 204, {}, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-auth]', error?.message || error)
        return sendJson(res, 500, { error: 'ADREEM logout failed.' }, allowedOrigin)
      }
    }
    if (url.pathname === '/api/profile') {
      const token = tokenFromAuthHeader(req.headers.authorization)
      const currentUser = userAccess.userForSessionToken(token)
      if (!currentUser) return sendJson(res, 401, { error: 'Valid user session required.' }, allowedOrigin)
      try {
        if (req.method === 'GET') {
          return sendJson(res, 200, { user: publicUser(currentUser) }, allowedOrigin)
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req)
          if (!isSupportedUiLanguage(body.language)) {
            return sendJson(res, 400, { error: 'Unsupported language.' }, allowedOrigin)
          }
          const result = userAccess.updateUser(currentUser.userId, {
            language: body.language,
            updatedBy: currentUser.userId,
          })
          if (!result.ok) {
            audit(env, { action: 'profile.language.update.failed', userId: currentUser.userId, error: result.error })
            return sendJson(res, result.error === 'not-found' ? 404 : 400, { error: result.error }, allowedOrigin)
          }
          audit(env, { action: 'profile.language.updated', userId: currentUser.userId, language: result.entry.language })
          return sendJson(res, 200, { user: publicUser(result.entry) }, allowedOrigin)
        }
        return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-profile]', error?.message || error)
        if (error instanceof ApiRequestError) {
          return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
        }
        return sendJson(res, 500, { error: 'ADREEM profile update failed.' }, allowedOrigin)
      }
    }
    if (url.pathname === '/api/admin/users' || userIdFromAdminPath(url.pathname)) {
      const adminLimit = rateLimiter.check(rateKey(req, 'admin'), RATE_LIMITS.admin)
      if (!adminLimit.ok) {
        audit(env, { action: 'admin.rate_limited', ip: clientIp(req), path: url.pathname })
        return rejectRateLimited(res, allowedOrigin, adminLimit)
      }
      const token = tokenFromAuthHeader(req.headers.authorization)
      const ownerUser = ownerForToken(token)
      if (!ownerUser) {
        return sendJson(res, 401, { error: 'Owner session required.' }, allowedOrigin)
      }
      try {
        const targetUserId = userIdFromAdminPath(url.pathname)
        if (!targetUserId && req.method === 'GET') {
          return sendJson(res, 200, {
            users: userAccess.listUsers().map(publicUser),
            source: 'registry',
            owner: ownerUser ? publicUser({ ...ownerUser, source: 'registry' }) : null,
          }, allowedOrigin)
        }
        if (!targetUserId && req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = userAccess.addUser({
            userId: body.userId,
            email: body.email,
            password: body.password,
            ledgerId: body.ledgerId,
            displayName: body.displayName,
            language: body.language,
            firstName: body.firstName,
            username: body.username,
            addedBy: ownerUser.userId,
            createWebToken: false,
          })
          if (!result.ok) {
            audit(env, { action: 'admin.user.create.failed', ownerUserId: ownerUser.userId, error: result.error, targetUserId: body.userId || body.ledgerId || '' })
            const status = result.error === 'ledger-used' || result.error === 'email-used' ? 409 : 400
            return sendJson(res, status, { error: result.error, existingUserId: result.existingUserId || '' }, allowedOrigin)
          }
          audit(env, { action: 'admin.user.created', ownerUserId: ownerUser.userId, targetUserId: result.entry.userId, ledgerId: result.entry.ledgerId })
          return sendJson(res, 201, {
            user: publicUser({ ...result.entry, source: 'registry' }),
            rowId: result.rowId,
          }, allowedOrigin)
        }
        if (targetUserId && req.method === 'PATCH') {
          const body = await readJsonBody(req)
          const result = userAccess.updateUser(targetUserId, {
            email: body.email,
            password: body.password,
            ledgerId: body.ledgerId,
            displayName: body.displayName,
            language: body.language,
            updatedBy: ownerUser.userId,
          })
          if (!result.ok) {
            audit(env, { action: 'admin.user.update.failed', ownerUserId: ownerUser.userId, targetUserId, error: result.error })
            const status = result.error === 'not-found' ? 404
              : result.error === 'ledger-used' || result.error === 'email-used' || result.error === 'ledger-change-requires-migration' || result.error === 'owner-identity-required' ? 409
                : 400
            return sendJson(res, status, { error: result.error, existingUserId: result.existingUserId || '' }, allowedOrigin)
          }
          audit(env, { action: 'admin.user.updated', ownerUserId: ownerUser.userId, targetUserId, ledgerId: result.entry.ledgerId })
          return sendJson(res, 200, {
            user: publicUser({ ...result.entry, source: 'registry' }),
            rowId: result.rowId,
          }, allowedOrigin)
        }
        if (targetUserId && req.method === 'DELETE') {
          const result = userAccess.removeUserAccess(targetUserId, { requestedBy: ownerUser.userId })
          if (!result.ok) {
            audit(env, { action: 'admin.user.delete.failed', ownerUserId: ownerUser.userId, targetUserId, error: result.error })
            const status = result.error === 'not-found' ? 404 : result.error === 'owner-protected' ? 409 : 400
            return sendJson(res, status, { error: result.error }, allowedOrigin)
          }
          audit(env, { action: 'admin.user.deleted', ownerUserId: ownerUser.userId, targetUserId })
          return sendJson(res, 200, { ok: true, removedUserId: targetUserId }, allowedOrigin)
        }
        return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-admin]', error?.message || error)
        if (error instanceof ApiRequestError) {
          return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
        }
        return sendJson(res, 500, { error: 'ADREEM admin API failed.' }, allowedOrigin)
      }
    }
    if (url.pathname === '/api/attachments') {
      const attachmentLimit = rateLimiter.check(rateKey(req, 'attachment'), RATE_LIMITS.attachment)
      if (!attachmentLimit.ok) {
        audit(env, { action: 'attachment.rate_limited', ip: clientIp(req) })
        return rejectRateLimited(res, allowedOrigin, attachmentLimit)
      }
      const token = tokenFromAuthHeader(req.headers.authorization)
      const ledgerId = ledgerIdForToken(token)
      if (!ledgerId) return sendJson(res, 401, { error: 'Invalid ledger token.' }, allowedOrigin)
      try {
        if (req.method === 'GET') {
          const storagePath = String(url.searchParams.get('path') || '')
          const signedUrl = await signAttachment(env, { ledgerId, storagePath })
          return sendJson(res, 200, { signedUrl, expiresInSeconds: 900 }, allowedOrigin)
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req, { maxBytes: ATTACHMENT_BODY_LIMIT })
          const attachment = await uploadAttachment(env, {
            ledgerId,
            fileName: body.fileName,
            mimeType: body.mimeType,
            base64: body.base64,
          })
          audit(env, { action: 'attachment.uploaded', ledgerId, storagePath: attachment.storagePath, sizeBytes: attachment.sizeBytes })
          return sendJson(res, 201, { attachment }, allowedOrigin)
        }
        return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-attachment]', error?.message || error)
        audit(env, { action: req.method === 'POST' ? 'attachment.upload.failed' : 'attachment.access.failed', ledgerId, error: error?.message || String(error) })
        if (error instanceof ApiRequestError) {
          return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
        }
        return sendJson(res, 500, { error: 'Attachment request failed.' }, allowedOrigin)
      }
    }
    const requestedAccountId = accountIdFromPath(url.pathname)
    if (url.pathname !== '/api/ledger' && !requestedAccountId) {
      return sendJson(res, 404, { error: 'Not found.' }, allowedOrigin)
    }

    const token = tokenFromAuthHeader(req.headers.authorization)
    const ledgerId = ledgerIdForToken(token)
    const repository = repositoryForToken(token)
    if (!repository) {
      return sendJson(res, 401, { error: 'Invalid ledger token.' }, allowedOrigin)
    }

    try {
      if (requestedAccountId) {
        if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
        const limit = rateLimiter.check(rateKey(req, 'ledger-write'), RATE_LIMITS.ledgerWrite)
        if (!limit.ok) {
          audit(env, { action: 'account.delete.rate_limited', ip: clientIp(req), ledgerId })
          return rejectRateLimited(res, allowedOrigin, limit)
        }
        const body = await readJsonBody(req)
        if (!Object.prototype.hasOwnProperty.call(body, 'baseUpdatedAt')) {
          throw new ApiRequestError('أعد تحميل الدفتر قبل حذف الحساب.', 428)
        }
        const result = await repository.update((currentState) => {
          const deletion = deleteUnusedAccountFromLedgerState(currentState, requestedAccountId)
          if (!deletion.ok) {
            const missing = deletion.blockers?.includes('missing-account')
            throw new ApiRequestError(
              missing ? 'الحساب غير موجود.' : 'لا يمكن حذف الحساب لأنه استُخدم أو ارتبط بسجل آخر.',
              missing ? 404 : 409,
            )
          }
          return deletion
        }, {
          expectedUpdatedAt: body.baseUpdatedAt || null,
          allowUnusedAccountDeletion: true,
        })
        audit(env, {
          action: 'account.deleted',
          ledgerId,
          deletedAccountIds: result.deletedAccountIds || [requestedAccountId],
          source: 'web-api',
        })
        return sendJson(res, 200, {
          state: result.state,
          source: 'api-account-delete',
          storageMode: 'legacy',
          updatedAt: result.updatedAt || null,
          deletedAccountIds: result.deletedAccountIds || [requestedAccountId],
        }, allowedOrigin)
      }
      if (req.method === 'GET') {
        const limit = rateLimiter.check(rateKey(req, 'ledger-read'), RATE_LIMITS.ledgerRead)
        if (!limit.ok) return rejectRateLimited(res, allowedOrigin, limit)
        const result = await repository.load()
        return sendJson(res, 200, {
          state: result.state,
          source: result.source || 'api',
          updatedAt: result.updatedAt || null,
          access: { canManageUsers: Boolean(ownerForToken(token)) },
          profile: publicUser(userAccess.userForSessionToken(token)),
        }, allowedOrigin)
      }
      if (req.method === 'PUT') {
        const limit = rateLimiter.check(rateKey(req, 'ledger-write'), RATE_LIMITS.ledgerWrite)
        if (!limit.ok) {
          audit(env, { action: 'ledger.save.rate_limited', ip: clientIp(req) })
          return rejectRateLimited(res, allowedOrigin, limit)
        }
        const body = await readJsonBody(req)
        if (!Object.prototype.hasOwnProperty.call(body, 'baseUpdatedAt')) {
          throw new ApiRequestError('Reload the ledger before saving.', 428)
        }
        const updateOptions = { expectedUpdatedAt: body.baseUpdatedAt || null }
        let movementUpdates = []
        const result = await repository.update((currentState) => {
          const state = body.state && typeof body.state === 'object'
            ? mergeLedgerStates(body.state, currentState, currentState)
            : currentState
          const validation = validateLedgerStateTransition(state, currentState, {
            ledgerId: repository.ledgerConfig?.identity?.ledgerId || ledgerIdForToken(token),
          })
          if (!validation.ok) {
            repository.backupRejected?.(state)
            throw new ApiRequestError(`Ledger integrity check failed: ${validation.errors[0]?.message || 'invalid state'}`, 422)
          }
          movementUpdates = movementUpdateAuditEntries(currentState, state)
          return { state }
        }, updateOptions)
        audit(env, { action: 'ledger.saved', ledgerId, source: 'web-api', movementUpdates })
        return sendJson(res, 200, { state: result.state, source: 'api-save', updatedAt: result.updatedAt || null }, allowedOrigin)
      }
      return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
    } catch (error) {
      if (error instanceof ConcurrentLedgerUpdateError) {
        // Conflicts are expected client errors and are recorded below without a server stack.
      } else if (!(error instanceof ApiRequestError) || error.statusCode >= 500) {
        console.error('[adreem-api]', error?.message || error)
      } else {
        audit(env, { action: 'ledger.save.rejected', ledgerId, error: error.message })
      }
      if (error instanceof ConcurrentLedgerUpdateError) {
        audit(env, { action: 'ledger.save.conflict', ledgerId })
        return sendJson(res, 409, { error: 'تم تعديل الدفتر من جهاز آخر. أعد تحميل الصفحة قبل الحفظ.' }, allowedOrigin)
      }
      if (error instanceof LedgerIntegrityError) {
        audit(env, { action: 'ledger.save.rejected', ledgerId, error: error.message })
        return sendJson(res, 422, { error: `Ledger integrity check failed: ${error.message}` }, allowedOrigin)
      }
      if (error instanceof ApiRequestError) {
        return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
      }
      return sendJson(res, 500, { error: 'Ledger API failed.' }, allowedOrigin)
    }
  }

  adreemApiHandler.__setRepositoryForTest = (repository) => {
    testRepository = repository
    readinessRepository = null
  }
  adreemApiHandler.__setRepositoryFactoryForTest = (factory) => {
    testRepositoryFactory = factory
  }

  return adreemApiHandler
}

export function startAdreemApi(env = process.env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('ADREEM web API requires SUPABASE_SERVICE_ROLE_KEY.')
  }
  if (env.NODE_ENV === 'production' && !env.ADREEM_WEB_ALLOWED_ORIGIN) {
    throw new Error('Production ADREEM web API requires ADREEM_WEB_ALLOWED_ORIGIN.')
  }
  const port = Number(env.ADREEM_API_PORT || env.PORT || DEFAULT_PORT)
  const host = String(env.ADREEM_API_HOST || '127.0.0.1').trim()
  const server = createServer(createAdreemApiHandler(env))
  server.listen(port, host, () => {
    console.log('[adreem-api] listening', { host, port })
  })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startAdreemApi()
}
