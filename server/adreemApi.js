import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createLedgerRepository } from './mohammadLedger/ledgerRepository.js'
import { mergeLedgerStates } from '../src/mohammadLedger/ledgerState.js'
import { createTelegramUserAccess, defaultRegistryPath, registrySessionTokenMap } from './telegram/userRegistry.js'

const DEFAULT_PORT = 8787
const DEFAULT_JSON_BODY_LIMIT = 5_000_000
const ATTACHMENT_BODY_LIMIT = 15_000_000
const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024
const RATE_LIMITS = {
  login: { limit: 8, windowMs: 15 * 60 * 1000 },
  admin: { limit: 120, windowMs: 60 * 1000 },
  ledgerRead: { limit: 240, windowMs: 60 * 1000 },
  ledgerWrite: { limit: 80, windowMs: 60 * 1000 },
  attachment: { limit: 30, windowMs: 60 * 1000 },
}

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
    'content-type': 'application/json; charset=utf-8',
  }
  if (statusCode !== 204) headers['content-length'] = Buffer.byteLength(body)
  res.writeHead(statusCode, {
    ...headers,
  })
  res.end(body)
}

export function createMemoryRateLimiter(now = () => Date.now()) {
  const buckets = new Map()
  return {
    check(key, { limit, windowMs }) {
      const safeKey = String(key || 'anonymous')
      const currentTime = now()
      const existing = buckets.get(safeKey)
      if (!existing || currentTime >= existing.resetAt) {
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

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || req.socket?.remoteAddress || 'unknown'
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
    'content-type': 'application/json; charset=utf-8',
    'retry-after': String(result.retryAfterSeconds),
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function userIdFromAdminPath(pathname = '') {
  const match = String(pathname || '').match(/^\/api\/admin\/users\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : ''
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

async function uploadAttachment(env, { ledgerId, fileName, mimeType, base64 }) {
  const { bucket, client } = storageClient(env)
  const buffer = Buffer.from(String(base64 || ''), 'base64')
  if (!buffer.length) throw new ApiRequestError('Attachment file is empty.', 400)
  if (buffer.length > ATTACHMENT_MAX_SIZE_BYTES) throw new ApiRequestError('Attachment is larger than 10MB.', 413)
  const safeName = cleanFileName(fileName)
  const date = new Date().toISOString().slice(0, 10)
  const hash = createHash('sha256').update(`${ledgerId}:${safeName}:${Date.now()}:${buffer.length}`).digest('hex').slice(0, 16)
  const storagePath = `${ledgerId}/${date}/${hash}-${safeName}`
  const contentType = String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream'
  const { error } = await client.storage.from(bucket).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  })
  if (error) throw new ApiRequestError(error.message || 'Attachment upload failed.', 500)
  const { data, error: signedError } = await client.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 24 * 7)
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
  const userAccess = createTelegramUserAccess(env)
  const repositories = new Map()
  const allowedOrigin = env.ADREEM_WEB_ALLOWED_ORIGIN || '*'
  const rateLimiter = createMemoryRateLimiter()
  let testRepository = null
  let testRepositoryFactory = null

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
    return {
      userId: user.userId || '',
      email: user.email || '',
      telegramUserId: user.telegramUserId || '',
      ledgerId: user.ledgerId || '',
      source: user.source || 'registry',
      displayName: user.displayName || user.firstName || user.username || '',
      firstName: user.firstName || '',
      username: user.username || '',
      addedAt: user.addedAt || '',
      addedBy: user.addedBy || '',
      hasWebToken: false,
      hasPassword: Boolean(user.passwordHash),
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
    if (url.pathname === '/api/auth/login') {
      try {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
        const body = await readJsonBody(req)
        const normalizedEmail = String(body.email || '').trim().toLowerCase()
        const limit = rateLimiter.check(rateKey(req, 'login', normalizedEmail), RATE_LIMITS.login)
        if (!limit.ok) {
          audit(env, { action: 'auth.rate_limited', ip: clientIp(req), email: normalizedEmail })
          return rejectRateLimited(res, allowedOrigin, limit)
        }
        const result = userAccess.loginUser({ email: body.email, password: body.password })
        audit(env, {
          action: result.ok ? 'auth.login.success' : 'auth.login.failed',
          ip: clientIp(req),
          email: normalizedEmail,
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
            telegramUserId: body.telegramUserId,
            ledgerId: body.ledgerId,
            displayName: body.displayName,
            firstName: body.firstName,
            username: body.username,
            addedBy: ownerUser.userId,
            createWebToken: false,
          })
          if (!result.ok) {
            audit(env, { action: 'admin.user.create.failed', ownerUserId: ownerUser.userId, error: result.error, targetUserId: body.userId || body.ledgerId || '' })
            const status = result.error === 'ledger-used' || result.error === 'telegram-used' || result.error === 'email-used' ? 409 : 400
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
            telegramUserId: body.telegramUserId,
            ledgerId: body.ledgerId,
            displayName: body.displayName,
            updatedBy: ownerUser.userId,
          })
          if (!result.ok) {
            audit(env, { action: 'admin.user.update.failed', ownerUserId: ownerUser.userId, targetUserId, error: result.error })
            const status = result.error === 'not-found' ? 404
              : result.error === 'ledger-used' || result.error === 'telegram-used' || result.error === 'email-used' ? 409
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
          return sendJson(res, 200, { ok: true, removedUserId: targetUserId })
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
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
        const body = await readJsonBody(req, { maxBytes: ATTACHMENT_BODY_LIMIT })
        const attachment = await uploadAttachment(env, {
          ledgerId,
          fileName: body.fileName,
          mimeType: body.mimeType,
          base64: body.base64,
        })
        audit(env, { action: 'attachment.uploaded', ledgerId, storagePath: attachment.storagePath, sizeBytes: attachment.sizeBytes })
        return sendJson(res, 201, { attachment }, allowedOrigin)
      } catch (error) {
        console.error('[adreem-api-attachment]', error?.message || error)
        audit(env, { action: 'attachment.upload.failed', ledgerId, error: error?.message || String(error) })
        if (error instanceof ApiRequestError) {
          return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
        }
        return sendJson(res, 500, { error: 'Attachment upload failed.' }, allowedOrigin)
      }
    }
    if (url.pathname !== '/api/ledger') {
      return sendJson(res, 404, { error: 'Not found.' }, allowedOrigin)
    }

    const token = tokenFromAuthHeader(req.headers.authorization)
    const repository = repositoryForToken(token)
    if (!repository) {
      return sendJson(res, 401, { error: 'Invalid ledger token.' }, allowedOrigin)
    }

    try {
      if (req.method === 'GET') {
        const limit = rateLimiter.check(rateKey(req, 'ledger-read'), RATE_LIMITS.ledgerRead)
        if (!limit.ok) return rejectRateLimited(res, allowedOrigin, limit)
        const result = await repository.load()
        return sendJson(res, 200, { state: result.state, source: result.source || 'api' }, allowedOrigin)
      }
      if (req.method === 'PUT') {
        const limit = rateLimiter.check(rateKey(req, 'ledger-write'), RATE_LIMITS.ledgerWrite)
        if (!limit.ok) {
          audit(env, { action: 'ledger.save.rate_limited', ip: clientIp(req) })
          return rejectRateLimited(res, allowedOrigin, limit)
        }
        const body = await readJsonBody(req)
        const result = await repository.update((currentState) => ({
          state: body.state && typeof body.state === 'object'
            ? mergeLedgerStates(body.state, currentState, currentState)
            : currentState,
        }))
        audit(env, { action: 'ledger.saved', source: 'web-api' })
        return sendJson(res, 200, { state: result.state, source: 'api-save' }, allowedOrigin)
      }
      return sendJson(res, 405, { error: 'Method not allowed.' }, allowedOrigin)
    } catch (error) {
      console.error('[adreem-api]', error?.message || error)
      if (error instanceof ApiRequestError) {
        return sendJson(res, error.statusCode, { error: error.message }, allowedOrigin)
      }
      return sendJson(res, 500, { error: 'Ledger API failed.' }, allowedOrigin)
    }
  }

  adreemApiHandler.__setRepositoryForTest = (repository) => {
    testRepository = repository
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
  const server = createServer(createAdreemApiHandler(env))
  server.listen(port, () => {
    console.log('[adreem-api] listening', { port })
  })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startAdreemApi()
}
