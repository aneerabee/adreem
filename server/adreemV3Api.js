import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { createRelationalLedgerRepository } from './ledger/relationalLedgerRepository.js'
import { createSupabaseAuthService } from './ledger/supabaseAuth.js'
import { attachmentContentMatchesMime, decodeCanonicalBase64 } from './ledger/attachmentValidation.js'
import { ALLOWED_ATTACHMENT_MIME_TYPES, ATTACHMENT_MAX_SIZE_BYTES } from '../src/ledger/ledgerOperations.js'
import { ConcurrentLedgerUpdateError } from './ledger/ledgerRepository.js'

const DEFAULT_BODY_LIMIT = 1_000_000
const ATTACHMENT_BODY_LIMIT = 15_000_000
const RATE_WINDOW_MS = 60_000
const DEFAULT_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60
const DEFAULT_REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_ATTACHMENT_UPLOADS_PER_MINUTE = 12
const DEFAULT_ATTACHMENT_LEDGER_QUOTA_BYTES = 1024 * 1024 * 1024
const ATTACHMENT_USAGE_PAGE_SIZE = 100
const SESSION_FENCE_TTL_MS = DEFAULT_REFRESH_COOKIE_MAX_AGE_SECONDS * 1_000
const MAX_SESSION_FENCE_ENTRIES = 4_096
const REFRESH_SINGLE_FLIGHT_TTL_MS = 10_000
const AUTH_SESSION_MARKER = 'cookie-v3'
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CONSISTENT_VIEW_ATTEMPTS = 3

export const ADREEM_ACCESS_COOKIE_NAME = '__Host-adreem-access-v3'
export const ADREEM_REFRESH_COOKIE_NAME = '__Host-adreem-refresh-v3'

class V3ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'V3ApiError'
    this.status = status
  }
}

function adminUserApiError(error) {
  const rawCode = String(error?.code || '').toLowerCase()
  const rawMessage = String(error?.message || '').toLowerCase()
  let code = ''
  if (rawCode === 'ledger-change-requires-migration') code = rawCode
  else if (rawCode.includes('weak_password') || (rawMessage.includes('password') && rawMessage.includes('weak'))) code = 'weak-password'
  else if (rawCode.includes('invalid_email') || rawMessage.includes('invalid email')) code = 'invalid-email'
  else if (rawMessage.includes('adreem_ledgers_legacy_ledger_id_key')) code = 'ledger-used'
  else if (
    rawCode.includes('email_exists') ||
    rawCode.includes('user_already_exists') ||
    rawMessage.includes('already registered') ||
    rawMessage.includes('adreem_profiles_email_key')
  ) code = 'email-used'
  if (!code) return error
  const status = ['email-used', 'ledger-used', 'ledger-change-requires-migration'].includes(code) ? 409 : 400
  const mapped = new V3ApiError('لم يتم حفظ المستخدم. راجع البيانات.', status)
  mapped.code = code
  return mapped
}

export async function loadConsistentLedgerView(repository, loadOptions = {}) {
  for (let attempt = 0; attempt < CONSISTENT_VIEW_ATTEMPTS; attempt += 1) {
    const result = await repository.load(loadOptions)
    const reports = await repository.loadReports()
    if (reports?.revision === result.revision) return { result, reports }
  }
  throw new ConcurrentLedgerUpdateError('Ledger changed repeatedly while the view was loading. Retry the request.')
}

function sendJson(res, status, payload, origin, { cookies = [] } = {}) {
  const body = status === 204 ? '' : JSON.stringify(payload)
  const headers = {
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-credentials': 'true',
    'cache-control': 'no-store, private',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  }
  if (origin) headers['access-control-allow-origin'] = origin
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(status, headers)
  res.end(body)
}

function exactOrigin(value, label) {
  const candidate = String(value || '').trim()
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`${label} must be an exact web origin.`)
  }
  if (!candidate || parsed.origin !== candidate || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must be an exact web origin.`)
  }
  return candidate
}

export function v3BrowserAuthOrigin(env = process.env) {
  const origin = exactOrigin(env.ADREEM_WEB_ALLOWED_ORIGIN, 'ADREEM_WEB_ALLOWED_ORIGIN')
  if (env.NODE_ENV !== 'production') return origin
  if (!origin.startsWith('https://')) throw new Error('Production ADREEM v3 requires an HTTPS web origin.')
  const apiOrigin = exactOrigin(env.ADREEM_API_PUBLIC_ORIGIN, 'ADREEM_API_PUBLIC_ORIGIN')
  if (apiOrigin !== origin) {
    throw new Error('Production ADREEM v3 requires the web and API to use the same origin.')
  }
  return origin
}

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=')
      if (separator <= 0) return cookies
      const name = part.slice(0, separator).trim()
      const value = part.slice(separator + 1).trim()
      try {
        cookies.set(name, decodeURIComponent(value))
      } catch {
        cookies.set(name, '')
      }
      return cookies
    }, new Map())
}

export function v3SessionFromCookieHeader(header = '') {
  const cookies = parseCookies(header)
  return {
    accessToken: cookies.get(ADREEM_ACCESS_COOKIE_NAME) || '',
    refreshToken: cookies.get(ADREEM_REFRESH_COOKIE_NAME) || '',
  }
}

function cookie(name, value, maxAge, { clear = false } = {}) {
  const attributes = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ]
  if (clear) attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  return attributes.join('; ')
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function v3SessionCookieHeaders(session = {}, env = process.env, now = Date.now()) {
  const expiresAt = Date.parse(session.expiresAt || '')
  const accessMaxAge = Number.isFinite(expiresAt)
    ? Math.max(1, Math.floor((expiresAt - now) / 1_000))
    : DEFAULT_ACCESS_COOKIE_MAX_AGE_SECONDS
  const refreshMaxAge = positiveInteger(env.ADREEM_AUTH_REFRESH_MAX_AGE_SECONDS, DEFAULT_REFRESH_COOKIE_MAX_AGE_SECONDS)
  return [
    cookie(ADREEM_ACCESS_COOKIE_NAME, String(session.token || ''), accessMaxAge),
    cookie(ADREEM_REFRESH_COOKIE_NAME, String(session.refreshToken || ''), refreshMaxAge),
  ]
}

export function v3ClearSessionCookieHeaders() {
  return [
    cookie(ADREEM_ACCESS_COOKIE_NAME, '', 0, { clear: true }),
    cookie(ADREEM_REFRESH_COOKIE_NAME, '', 0, { clear: true }),
  ]
}

function trustedRequestOrigin(req, origin) {
  const requestOrigin = String(req.headers?.origin || '').trim()
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase()
  if (requestOrigin && requestOrigin !== origin) return false
  if (fetchSite === 'cross-site') return false
  if (req.method === 'OPTIONS') return requestOrigin === origin
  if (UNSAFE_METHODS.has(req.method) && fetchSite && !requestOrigin) return false
  return true
}

function readJson(req, maxBytes = DEFAULT_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = ''
    let bytes = 0
    let exceeded = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBytes) {
        exceeded = true
        body = ''
        return
      }
      if (!exceeded) body += chunk
    })
    req.on('end', () => {
      if (exceeded) return reject(new V3ApiError('Request body too large.', 413))
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new V3ApiError('Invalid JSON body.', 400))
      }
    })
    req.on('error', reject)
  })
}

function userIdFromPath(pathname = '') {
  const match = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

function accountIdFromPath(pathname = '') {
  const match = pathname.match(/^\/api\/accounts\/([^/]+)$/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1]).trim()
  } catch {
    return ''
  }
}

function accountDeletionApiError(error) {
  if (error?.code === 'account-not-found') {
    const mapped = new V3ApiError('الحساب غير موجود.', 404)
    mapped.code = 'account-not-found'
    return mapped
  }
  if (error?.code === 'account-protected') {
    const mapped = new V3ApiError('هذا الحساب محمي ولا يمكن حذفه.', 409)
    mapped.code = 'account-protected'
    return mapped
  }
  if (error?.code === 'account-in-use') {
    const mapped = new V3ApiError('لا يمكن حذف الحساب لأنه استُخدم أو ارتبط بسجل آخر.', 409)
    mapped.code = 'account-in-use'
    return mapped
  }
  return error
}

function ledgerDeltaApiError(error) {
  if (error?.name === 'ConcurrentLedgerUpdateError' || error?.code === '40001') {
    const mapped = new V3ApiError('تغير الدفتر أثناء الحفظ. أعد المحاولة على أحدث نسخة.', 409)
    mapped.code = 'ledger-revision-conflict'
    return mapped
  }
  if (['22023', '23514'].includes(String(error?.code || '')) || String(error?.message || '').includes('ADREEM_')) {
    const mapped = new V3ApiError('رفضنا التغيير لأنه لا يحافظ على سلامة الأرصدة أو السجلات.', 409)
    mapped.code = 'ledger-integrity'
    return mapped
  }
  return error
}

function createRateLimiter(now = Date.now) {
  const buckets = new Map()
  let checks = 0
  return (key, limit) => {
    const checkedAt = now()
    checks += 1
    if (checks % 100 === 0) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= checkedAt) buckets.delete(bucketKey)
      }
    }
    const existing = buckets.get(key)
    if (!existing || existing.resetAt <= checkedAt) {
      buckets.set(key, { count: 1, resetAt: checkedAt + RATE_WINDOW_MS })
      return true
    }
    existing.count += 1
    return existing.count <= limit
  }
}

function configuredBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}

function normalizedIpAddress(value) {
  const candidate = String(value || '').trim()
  if (!candidate) return ''
  const unwrapped = candidate.startsWith('[') && candidate.endsWith(']') ? candidate.slice(1, -1) : candidate
  const normalized = unwrapped.startsWith('::ffff:') && isIP(unwrapped.slice(7)) === 4 ? unwrapped.slice(7) : unwrapped
  return isIP(normalized) ? normalized : ''
}

function trustedClientAddress(req, env) {
  if (configuredBoolean(env.ADREEM_TRUST_PROXY)) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0]
    const forwardedAddress = normalizedIpAddress(forwarded)
    if (forwardedAddress) return forwardedAddress
  }
  return normalizedIpAddress(req.socket?.remoteAddress)
}

function createKeyedLock() {
  const locks = new Map()
  return async (key, operation) => {
    const previous = locks.get(key) || Promise.resolve()
    let release
    const current = new Promise((resolve) => { release = resolve })
    locks.set(key, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (locks.get(key) === current) locks.delete(key)
    }
  }
}

export function createSessionFence(now = Date.now, maxEntries = MAX_SESSION_FENCE_ENTRIES) {
  const sessions = new Map()
  const pendingSessions = new Map()
  const revokedTokens = new Map()
  const capacity = positiveInteger(maxEntries, MAX_SESSION_FENCE_ENTRIES)
  let checks = 0
  const keyFor = (refreshToken) => createHash('sha256').update(String(refreshToken || '')).digest('hex')
  const entries = () => Array.from(new Set(sessions.values()))
  const deleteEntry = (entry) => {
    for (const [key, storedEntry] of sessions) {
      if (storedEntry === entry) sessions.delete(key)
    }
  }
  const purgeExpired = () => {
    const checkedAt = now()
    for (const entry of entries()) {
      if (entry.expiresAt <= checkedAt) deleteEntry(entry)
    }
    for (const [key, entry] of pendingSessions) {
      if (entry.expiresAt <= checkedAt) pendingSessions.delete(key)
    }
    for (const [key, expiresAt] of revokedTokens) {
      if (expiresAt <= checkedAt) revokedTokens.delete(key)
    }
  }
  const clean = () => {
    checks += 1
    if (checks % 100 !== 0) return
    purgeExpired()
  }
  const makeRoom = () => {
    if (entries().length < capacity) return
    const checkedAt = now()
    for (const entry of entries()) {
      if (entry.expiresAt <= checkedAt) deleteEntry(entry)
    }
    while (entries().length >= capacity) deleteEntry(entries()[0])
  }
  return {
    begin(refreshToken) {
      clean()
      const key = keyFor(refreshToken)
      if (revokedTokens.has(key)) {
        return { key, generation: 0, revoked: true, stale: false, overloaded: false }
      }
      let entry = sessions.get(key) || pendingSessions.get(key)
      if (!entry) {
        if (pendingSessions.size >= capacity) purgeExpired()
        if (pendingSessions.size >= capacity) {
          return { key, generation: 0, revoked: false, stale: false, overloaded: true }
        }
        entry = {
          generation: 0,
          revoked: false,
          currentKey: key,
          expiresAt: now() + REFRESH_SINGLE_FLIGHT_TTL_MS,
        }
        pendingSessions.set(key, entry)
      }
      return {
        key,
        generation: entry.generation,
        revoked: entry.revoked,
        stale: !entry.revoked && entry.currentKey !== key,
        overloaded: false,
      }
    },
    fence(refreshToken, { verified = false } = {}) {
      if (!refreshToken) return false
      const key = keyFor(refreshToken)
      const entry = sessions.get(key) || pendingSessions.get(key)
      if (!entry) {
        if (!verified) return false
        purgeExpired()
        if (revokedTokens.size >= capacity) return false
        revokedTokens.set(key, now() + SESSION_FENCE_TTL_MS)
        return true
      }
      entry.generation += 1
      entry.revoked = true
      entry.expiresAt = now() + SESSION_FENCE_TTL_MS
      if (pendingSessions.get(key) === entry) {
        pendingSessions.delete(key)
        if (revokedTokens.size < capacity || revokedTokens.has(key)) revokedTokens.set(key, entry.expiresAt)
        return true
      }
      sessions.set(key, entry)
      return true
    },
    discard(refreshToken) {
      if (!refreshToken) return
      const key = keyFor(refreshToken)
      const entry = sessions.get(key) || pendingSessions.get(key)
      if (entry) deleteEntry(entry)
      for (const [pendingKey, pendingEntry] of pendingSessions) {
        if (pendingEntry === entry) pendingSessions.delete(pendingKey)
      }
      revokedTokens.delete(key)
    },
    reject(refreshToken) {
      if (!refreshToken) return
      const key = keyFor(refreshToken)
      if (sessions.has(key)) {
        this.fence(refreshToken)
        return
      }
      if (revokedTokens.has(key)) return
      pendingSessions.delete(key)
    },
    rotate(ticket, refreshToken) {
      if (!this.valid(ticket)) return false
      let entry = sessions.get(ticket.key) || pendingSessions.get(ticket.key)
      if (pendingSessions.get(ticket.key) === entry) {
        pendingSessions.delete(ticket.key)
        makeRoom()
      } else {
        for (const [storedKey, storedEntry] of sessions) {
          if (storedEntry === entry && storedKey !== ticket.key) sessions.delete(storedKey)
        }
      }
      const nextKey = keyFor(refreshToken)
      entry.generation += 1
      entry.revoked = false
      entry.currentKey = nextKey
      entry.expiresAt = now() + SESSION_FENCE_TTL_MS
      sessions.set(ticket.key, entry)
      sessions.set(nextKey, entry)
      return true
    },
    valid(ticket) {
      const entry = sessions.get(ticket.key) || pendingSessions.get(ticket.key)
      if (!entry) return false
      return entry?.generation === ticket.generation && entry.currentKey === ticket.key && !entry.revoked
    },
    size() {
      return entries().length + revokedTokens.size
    },
    pendingSize() {
      return pendingSessions.size
    },
    revokedSize() {
      return revokedTokens.size
    },
  }
}

function cleanFileName(value = '') {
  return String(value || 'attachment')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'attachment'
}

function movementDateFilter(value) {
  if (!value) return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw new V3ApiError('Invalid movement date filter.', 400)
  return date.toISOString()
}

function conflictMovementIds(searchParams) {
  const ids = Array.from(new Set(searchParams.getAll('movementId')
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
  if (ids.length > 250 || ids.some((id) => id.length > 200)) {
    throw new V3ApiError('Too many movement records were requested.', 400)
  }
  return ids
}

async function ledgerAttachmentUsage(authService, env, context) {
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!bucket) throw new V3ApiError('Attachments bucket is not configured.', 501)
  const storage = authService.admin.storage.from(bucket)
  const pendingPrefixes = [`${context.profile.id}/${context.ledger.id}`]
  let total = 0
  while (pendingPrefixes.length) {
    const prefix = pendingPrefixes.shift()
    for (let offset = 0; ; offset += ATTACHMENT_USAGE_PAGE_SIZE) {
      const { data, error } = await storage.list(prefix, {
        limit: ATTACHMENT_USAGE_PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw new V3ApiError('Attachment quota check failed.', 503)
      const rows = Array.isArray(data) ? data : []
      for (const row of rows) {
        if (!row?.name || String(row.name).includes('/')) throw new V3ApiError('Attachment quota check failed.', 503)
        if (!row.id) {
          pendingPrefixes.push(`${prefix}/${row.name}`)
          continue
        }
        const size = Number(row.metadata?.size)
        if (!Number.isSafeInteger(size) || size < 0) throw new V3ApiError('Attachment quota check failed.', 503)
        total += size
      }
      if (rows.length < ATTACHMENT_USAGE_PAGE_SIZE) break
    }
  }
  return total
}

async function uploadAttachment(authService, env, context, body, usageLoader) {
  let buffer
  try {
    buffer = decodeCanonicalBase64(body.base64)
  } catch (error) {
    throw new V3ApiError(error.message, 400)
  }
  const mimeType = String(body.mimeType || '').trim().toLowerCase()
  if (!buffer.length) throw new V3ApiError('Attachment file is empty.', 400)
  if (buffer.length > ATTACHMENT_MAX_SIZE_BYTES) throw new V3ApiError('Attachment is larger than 10MB.', 413)
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw new V3ApiError('Attachment type is not allowed.', 415)
  if (!attachmentContentMatchesMime(buffer, mimeType)) throw new V3ApiError('Attachment content does not match its file type.', 415)
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!bucket) throw new V3ApiError('Attachments bucket is not configured.', 501)
  const quotaBytes = positiveInteger(env.ADREEM_ATTACHMENT_LEDGER_QUOTA_BYTES, DEFAULT_ATTACHMENT_LEDGER_QUOTA_BYTES)
  const usedBytes = Number(await usageLoader(context))
  if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) throw new V3ApiError('Attachment quota check failed.', 503)
  if (usedBytes + buffer.length > quotaBytes) throw new V3ApiError('Attachment ledger quota exceeded.', 413)
  const fileName = cleanFileName(body.fileName)
  const date = new Date().toISOString().slice(0, 10)
  const hash = createHash('sha256').update(`${context.profile.id}:${fileName}:${Date.now()}:${buffer.length}`).digest('hex').slice(0, 16)
  const storagePath = `${context.profile.id}/${context.ledger.id}/${date}/${hash}-${fileName}`
  const { error } = await authService.admin.storage.from(bucket).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  })
  if (error) throw new V3ApiError('Attachment upload failed.', 500)
  return { label: fileName, storagePath, mimeType, sizeBytes: buffer.length }
}

function assertAttachmentPath(context, storagePath) {
  const path = String(storagePath || '')
  const prefix = `${context.profile.id}/${context.ledger.id}/`
  if (!path.startsWith(prefix) || path.includes('..')) {
    throw new V3ApiError('Attachment path is outside this ledger.', 403)
  }
  return path
}

async function attachmentReference(context, storagePath) {
  const { data, error } = await context.client
    .from('adreem_attachments')
    .select('record_id, hidden_at, payload')
    .eq('owner_id', context.profile.id)
    .eq('ledger_id', context.ledger.id)
    .eq('storage_path', storagePath)
    .maybeSingle()
  if (error) throw new V3ApiError('Attachment cleanup check failed.', 503)
  if (!data) return null
  const inactive = data.hidden_at
    || data.payload?.hiddenAt
    || data.payload?.disabledAt
    || data.payload?.status === 'inactive'
  return inactive ? null : data
}

async function removeAttachment(authService, env, context, storagePath, referenceLoader) {
  const path = assertAttachmentPath(context, storagePath)
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!bucket) throw new V3ApiError('Attachments bucket is not configured.', 501)
  if (await referenceLoader(context, path)) throw new V3ApiError('Attachment is already linked to a ledger record.', 409)
  const { error } = await authService.admin.storage.from(bucket).remove([path])
  if (error) throw new V3ApiError('Attachment cleanup failed.', 500)
}

async function signedAttachmentUrl(authService, env, context, storagePath) {
  const path = assertAttachmentPath(context, storagePath)
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!bucket) throw new V3ApiError('Attachments bucket is not configured.', 501)
  const { data, error } = await authService.admin.storage.from(bucket).createSignedUrl(path, 15 * 60)
  if (error || !data?.signedUrl) throw new V3ApiError('Attachment signing failed.', 500)
  return data.signedUrl
}

export function createAdreemV3ApiHandler(env = process.env, options = {}) {
  const origin = v3BrowserAuthOrigin(env)
  const authService = options.authService || createSupabaseAuthService(env)
  const repositoryFactory = options.repositoryFactory || ((context) => createRelationalLedgerRepository(context.client, {
    ownerId: context.profile.id,
    ledgerId: context.ledger.id,
  }))
  const now = options.now || Date.now
  const rateLimit = createRateLimiter(now)
  const attachmentUsage = options.attachmentUsage || ((context) => ledgerAttachmentUsage(authService, env, context))
  const attachmentReferenceLoader = options.attachmentReference || attachmentReference
  const withAttachmentLock = createKeyedLock()
  const sessionFence = createSessionFence(now)
  const refreshFlights = new Map()
  const anonymousSockets = new WeakMap()
  let anonymousSocketSequence = 0

  function clientRateKey(req) {
    const address = trustedClientAddress(req, env)
    if (address) return address
    const socket = req.socket
    if (!socket || (typeof socket !== 'object' && typeof socket !== 'function')) return `unknown-${++anonymousSocketSequence}`
    if (!anonymousSockets.has(socket)) anonymousSockets.set(socket, `connection-${++anonymousSocketSequence}`)
    return anonymousSockets.get(socket)
  }

  async function refreshWithFence(refreshToken) {
    const ticket = sessionFence.begin(refreshToken)
    if (ticket.overloaded) {
      throw new V3ApiError('Too many session checks are in progress. Try again shortly.', 429)
    }
    if (ticket.stale) {
      const error = new V3ApiError('The login session changed in another tab. Retry the request.', 409)
      error.code = 'adreem-session-rotated'
      throw error
    }
    if (ticket.revoked) {
      const error = new V3ApiError('The login session has expired.', 401)
      error.clearSession = true
      throw error
    }
    const checkedAt = now()
    for (const [key, flight] of refreshFlights) {
      if (flight.expiresAt <= checkedAt) refreshFlights.delete(key)
    }
    const existing = refreshFlights.get(ticket.key)
    if (existing?.generation === ticket.generation) return existing.promise

    const promise = (async () => {
      try {
        const result = await authService.refresh(refreshToken)
        if (!sessionFence.rotate(ticket, result.refreshToken)) {
          try {
            await authService.logout(result.token, result.refreshToken)
          } catch {
            // The fenced browser session stays invalid even if provider revocation is temporarily unavailable.
          }
          const error = new V3ApiError('The login session has expired.', 401)
          error.clearSession = true
          throw error
        }
        return result
      } catch (error) {
        if (!error?.rotatedSession) {
          if (Number(error?.status) === 401) {
            if (error?.clearSession) sessionFence.reject(refreshToken)
            else sessionFence.discard(refreshToken)
          }
          throw error
        }
        if (!sessionFence.rotate(ticket, error.rotatedSession.refreshToken)) {
          try {
            await authService.logout(error.rotatedSession.token, error.rotatedSession.refreshToken)
          } catch {
            // The fenced browser session stays invalid even if provider revocation is temporarily unavailable.
          }
          const fencedError = new V3ApiError('The login session has expired.', 401)
          fencedError.clearSession = true
          throw fencedError
        }
        throw error
      }
    })()
    refreshFlights.set(ticket.key, {
      generation: ticket.generation,
      promise,
      expiresAt: checkedAt + REFRESH_SINGLE_FLIGHT_TTL_MS,
    })
    promise.catch(() => {
      if (refreshFlights.get(ticket.key)?.promise === promise) refreshFlights.delete(ticket.key)
    })
    return promise
  }

  async function requestContext(req, setResponseCookies) {
    const session = v3SessionFromCookieHeader(req.headers?.cookie)
    const context = session.accessToken ? await authService.authenticate(session.accessToken) : null
    if (context) return { context, cookies: [] }
    if (!session.refreshToken) {
      const error = new V3ApiError('Valid ADREEM session required.', 401)
      error.clearSession = true
      throw error
    }
    try {
      const refreshed = await refreshWithFence(session.refreshToken)
      return {
        context: {
          accessToken: refreshed.token,
          authUser: refreshed.user,
          client: refreshed.client,
          profile: refreshed.profile,
          ledger: refreshed.ledger,
          publicUser: refreshed.publicUser,
          isOwner: Boolean(refreshed.profile?.is_system_owner),
        },
        cookies: v3SessionCookieHeaders(refreshed, env, now()),
      }
    } catch (error) {
      if (error?.rotatedSession) {
        setResponseCookies(v3SessionCookieHeaders(error.rotatedSession, env, now()))
        if (Number(error?.status) === 401) throw new V3ApiError('ADREEM profile verification is temporarily unavailable.', 503)
        throw error
      }
      if (Number(error?.status) !== 401) throw error
      const expired = new V3ApiError('The login session has expired.', 401)
      expired.clearSession = true
      throw expired
    }
  }

  return async function adreemV3ApiHandler(req, res) {
    if (!trustedRequestOrigin(req, origin)) {
      return sendJson(res, 403, { error: 'Request origin is not allowed.' }, '')
    }
    if (req.method === 'OPTIONS') return sendJson(res, 204, {}, origin)
    const url = new URL(req.url || '/', 'http://localhost')
    let responseCookies = []
    const reply = (status, payload) => sendJson(res, status, payload, origin, { cookies: responseCookies })
    try {
      if (url.pathname === '/health') return reply(200, { ok: true, service: 'adreem-api', storageMode: 'relational' })

      if (url.pathname === '/api/auth/login') {
        if (req.method !== 'POST') throw new V3ApiError('Method not allowed.', 405)
        if (!rateLimit(`login:${clientRateKey(req)}`, 8)) throw new V3ApiError('Too many requests. Try again later.', 429)
        const body = await readJson(req)
        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        if (!email || email.length > 254 || !password || password.length > 256) {
          throw new V3ApiError('Invalid login input.', 400)
        }
        let result
        try {
          result = await authService.login({ email, password })
        } catch (error) {
          if (Number(error?.status) === 401) throw new V3ApiError('Invalid email or password.', 401)
          throw error
        }
        responseCookies = v3SessionCookieHeaders(result, env, now())
        return reply(200, {
          authMode: AUTH_SESSION_MARKER,
          expiresAt: result.expiresAt,
          user: result.publicUser,
        })
      }

      if (url.pathname === '/api/auth/refresh') {
        if (req.method !== 'POST') throw new V3ApiError('Method not allowed.', 405)
        if (!rateLimit(`refresh:${clientRateKey(req)}`, 30)) throw new V3ApiError('Too many requests. Try again later.', 429)
        await readJson(req)
        const session = v3SessionFromCookieHeader(req.headers?.cookie)
        if (!session.refreshToken) {
          const error = new V3ApiError('The login session has expired.', 401)
          error.clearSession = true
          throw error
        }
        try {
          const result = await refreshWithFence(session.refreshToken)
          responseCookies = v3SessionCookieHeaders(result, env, now())
          return reply(200, {
            authMode: AUTH_SESSION_MARKER,
            expiresAt: result.expiresAt,
            user: result.publicUser,
          })
        } catch (error) {
          if (error?.rotatedSession) {
            responseCookies = v3SessionCookieHeaders(error.rotatedSession, env, now())
            if (Number(error?.status) === 401) throw new V3ApiError('ADREEM profile verification is temporarily unavailable.', 503)
            throw error
          }
          if (Number(error?.status) !== 401) throw error
          const expired = new V3ApiError('The login session has expired.', 401)
          expired.clearSession = true
          throw expired
        }
      }

      if (url.pathname === '/api/auth/logout') {
        if (req.method !== 'POST') throw new V3ApiError('Method not allowed.', 405)
        const session = v3SessionFromCookieHeader(req.headers?.cookie)
        sessionFence.fence(session.refreshToken)
        responseCookies = v3ClearSessionCookieHeaders()
        const verified = await authService.logout(session.accessToken, session.refreshToken)
        if (verified !== false) sessionFence.fence(session.refreshToken, { verified: true })
        return reply(204, {})
      }

      if (url.pathname === '/ready') {
        const { error } = await authService.admin
          .from('adreem_ledgers')
          .select('id')
          .limit(1)
          .maybeSingle()
        if (error) throw error
        return reply(200, {
          ok: true,
          service: 'adreem-api',
          storageMode: 'relational',
        })
      }

      const authenticated = await requestContext(req, (cookies) => { responseCookies = cookies })
      responseCookies = authenticated.cookies
      const { context } = authenticated
      const repository = repositoryFactory(context)

      if (url.pathname === '/api/profile') {
        if (req.method === 'GET') return reply(200, { user: context.publicUser })
        if (req.method !== 'PATCH') throw new V3ApiError('Method not allowed.', 405)
        const body = await readJson(req)
        const updates = {}
        if (body.language === 'ar' || body.language === 'en') updates.language = body.language
        if (body.displayName !== undefined) updates.display_name = String(body.displayName || '').trim().slice(0, 80)
        if (!Object.keys(updates).length) throw new V3ApiError('No valid profile update was provided.', 400)
        const { error } = await context.client.from('adreem_profiles').update(updates).eq('id', context.profile.id)
        if (error) throw new V3ApiError('Profile update failed.', 400)
        const next = await authService.authenticate(context.accessToken)
        if (!next) {
          const sessionError = new V3ApiError('Valid ADREEM session required.', 401)
          sessionError.clearSession = true
          throw sessionError
        }
        return reply(200, { user: next.publicUser })
      }

      const adminUserId = userIdFromPath(url.pathname)
      if (url.pathname === '/api/admin/users' || adminUserId) {
        if (!context.isOwner) throw new V3ApiError('Owner session required.', 403)
        if (url.pathname === '/api/admin/users' && req.method === 'GET') {
          return reply(200, { users: await authService.listUsers(), source: 'supabase-auth', owner: context.publicUser })
        }
        if (url.pathname === '/api/admin/users' && req.method === 'POST') {
          const body = await readJson(req)
          if (body.active !== undefined && typeof body.active !== 'boolean') throw new V3ApiError('Active must be a boolean.', 400)
          let user
          try {
            user = await authService.createUser(body)
          } catch (error) {
            throw adminUserApiError(error)
          }
          return reply(201, { user })
        }
        if (adminUserId && req.method === 'PATCH') {
          const body = await readJson(req)
          if (body.active !== undefined && typeof body.active !== 'boolean') throw new V3ApiError('Active must be a boolean.', 400)
          if (body.active !== undefined && Object.keys(body).some((key) => key !== 'active')) {
            throw new V3ApiError('Activation must be changed separately from profile details.', 400)
          }
          let user
          try {
            user = body.active === undefined
              ? await authService.updateUser(adminUserId, body)
              : await authService.setUserActive(adminUserId, body.active)
          } catch (error) {
            throw adminUserApiError(error)
          }
          return reply(200, { user })
        }
        if (adminUserId && req.method === 'DELETE') {
          let user
          try {
            user = await authService.setUserActive(adminUserId, false)
          } catch (error) {
            throw adminUserApiError(error)
          }
          return reply(200, { ok: true, deactivatedUserId: adminUserId, user })
        }
        throw new V3ApiError('Method not allowed.', 405)
      }

      if (url.pathname === '/api/movements') {
        if (req.method !== 'GET') throw new V3ApiError('Method not allowed.', 405)
        const result = await repository.loadMovements({
          movementOffset: url.searchParams.get('offset'),
          beforeSequence: url.searchParams.get('before'),
          movementLimit: url.searchParams.get('limit'),
          accountId: url.searchParams.get('accountId'),
          status: url.searchParams.get('status'),
          movementType: url.searchParams.get('type'),
          movementTypes: String(url.searchParams.get('types') || '').split(',').map((type) => type.trim()).filter(Boolean),
          query: url.searchParams.get('q'),
          dimensionId: url.searchParams.get('dimensionId'),
          expenseCategoryId: url.searchParams.get('expenseCategoryId'),
          excludeOpening: url.searchParams.get('includeOpening') !== 'true',
          occurredFrom: movementDateFilter(url.searchParams.get('occurredFrom')),
          occurredBefore: movementDateFilter(url.searchParams.get('occurredBefore')),
        })
        return reply(200, result)
      }

      const accountId = accountIdFromPath(url.pathname)
      if (accountId) {
        if (req.method !== 'DELETE') throw new V3ApiError('Method not allowed.', 405)
        const body = await readJson(req)
        const expectedRevision = Number(body.baseRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new V3ApiError('أعد تحميل الدفتر قبل حذف الحساب.', 428)
        }
        let deletion
        try {
          deletion = await withAttachmentLock(context.ledger.id, () => repository.deleteUnusedAccount(accountId, expectedRevision))
        } catch (error) {
          throw accountDeletionApiError(error)
        }
        const { result, reports } = await loadConsistentLedgerView(repository)
        return reply(200, {
          state: result.state,
          source: 'relational-account-deletion',
          storageMode: result.storageMode,
          revision: result.revision,
          updatedAt: result.updatedAt,
          movementPage: result.movementPage,
          reports,
          deletedAccountIds: deletion.deletedAccountIds,
        })
      }

      if (url.pathname === '/api/attachments') {
        if (req.method === 'GET') {
          const signedUrl = await signedAttachmentUrl(authService, env, context, String(url.searchParams.get('path') || ''))
          return reply(200, { signedUrl, expiresInSeconds: 900 })
        }
        if (req.method === 'POST') {
          const uploadLimit = positiveInteger(env.ADREEM_ATTACHMENT_UPLOADS_PER_MINUTE, DEFAULT_ATTACHMENT_UPLOADS_PER_MINUTE)
          if (!rateLimit(`attachment:${context.profile.id}`, uploadLimit)) throw new V3ApiError('Too many requests. Try again later.', 429)
          const body = await readJson(req, ATTACHMENT_BODY_LIMIT)
          const attachment = await withAttachmentLock(context.ledger.id, () => uploadAttachment(authService, env, context, body, attachmentUsage))
          return reply(201, { attachment })
        }
        if (req.method === 'DELETE') {
          await readJson(req)
          await withAttachmentLock(context.ledger.id, () => removeAttachment(
            authService,
            env,
            context,
            String(url.searchParams.get('path') || ''),
            attachmentReferenceLoader,
          ))
          return reply(204, {})
        }
        throw new V3ApiError('Method not allowed.', 405)
      }

      if (url.pathname !== '/api/ledger') throw new V3ApiError('Not found.', 404)
      if (req.method === 'GET') {
        const movementIds = conflictMovementIds(url.searchParams)
        const loadOptions = movementIds.length
          ? { movementIds }
          : { movementLimit: url.searchParams.get('movementLimit') }
        const { result, reports } = await loadConsistentLedgerView(repository, loadOptions)
        return reply(200, {
          state: result.state,
          source: result.source,
          storageMode: result.storageMode,
          revision: result.revision,
          updatedAt: result.updatedAt,
          movementPage: result.movementPage,
          reports,
          access: { canManageUsers: context.isOwner },
          profile: context.publicUser,
        })
      }
      if (req.method === 'PUT') {
        const body = await readJson(req)
        const expectedRevision = Number(body.baseRevision)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new V3ApiError('Reload the ledger before saving.', 428)
        }
        if (!body.delta || typeof body.delta !== 'object' || Array.isArray(body.delta)) {
          throw new V3ApiError('A ledger delta is required.', 400)
        }
        try {
          await withAttachmentLock(context.ledger.id, () => repository.applyDelta(body.delta, expectedRevision))
        } catch (error) {
          throw ledgerDeltaApiError(error)
        }
        const { result, reports } = await loadConsistentLedgerView(repository, {
          movementLimit: body.movementLimit,
        })
        return reply(200, {
          state: result.state,
          source: 'relational-save',
          storageMode: result.storageMode,
          revision: result.revision,
          updatedAt: result.updatedAt,
          movementPage: result.movementPage,
          reports,
        })
      }
      throw new V3ApiError('Method not allowed.', 405)
    } catch (error) {
      if (error?.clearSession) responseCookies = v3ClearSessionCookieHeaders()
      if (error instanceof ConcurrentLedgerUpdateError || error?.code === '40001') {
        return reply(409, { error: 'تم تعديل الدفتر من جهاز آخر. أعد تحميل الصفحة قبل الحفظ.' })
      }
      const status = error instanceof V3ApiError
        ? error.status
        : Number(error?.status) >= 400 && Number(error?.status) < 600
          ? Number(error.status)
          : 500
      if (status >= 500) console.error('[adreem-v3-api] request failed', {
        status,
        name: String(error?.name || 'Error').slice(0, 80),
        code: String(error?.code || '').slice(0, 80),
      })
      const message = error instanceof V3ApiError
        ? error.message
        : status >= 500
          ? 'ADREEM API failed.'
          : 'ADREEM request failed.'
      return reply(status, {
        error: message,
        ...(error instanceof V3ApiError && error.code ? { code: error.code } : {}),
      })
    }
  }
}
