import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createLedgerRepository } from './mohammadLedger/ledgerRepository.js'
import { mergeLedgerStates } from '../src/mohammadLedger/ledgerState.js'
import { registryWebTokenMap } from './telegram/userRegistry.js'

const DEFAULT_PORT = 8787

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
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 5_000_000) {
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

export function createAdreemApiHandler(env = process.env) {
  const tokenMap = parseLedgerTokenMap(env.ADREEM_WEB_LEDGER_TOKENS)
  const tokenHashMap = parseLedgerTokenHashMap(env.ADREEM_WEB_LEDGER_TOKEN_HASHES)
  const repositories = new Map()
  const allowedOrigin = env.ADREEM_WEB_ALLOWED_ORIGIN || '*'
  let testRepository = null
  let testRepositoryFactory = null

  function repositoryForToken(token) {
    const hash = tokenHash(token)
    const ledgerId = tokenHashMap.get(hash) || registryWebTokenMap(env).get(hash) || tokenMap.get(token)
    if (!ledgerId) return null
    if (testRepository) return testRepository
    if (testRepositoryFactory) return testRepositoryFactory(ledgerId)
    if (!repositories.has(ledgerId)) {
      repositories.set(ledgerId, createLedgerRepository(env, { ledgerId }))
    }
    return repositories.get(ledgerId)
  }

  async function adreemApiHandler(req, res) {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {}, allowedOrigin)
    }

    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'adreem-api' }, allowedOrigin)
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
        const result = await repository.load()
        return sendJson(res, 200, { state: result.state, source: result.source || 'api' }, allowedOrigin)
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req)
        const result = await repository.update((currentState) => ({
          state: body.state && typeof body.state === 'object'
            ? mergeLedgerStates(body.state, currentState, currentState)
            : currentState,
        }))
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
  if (!env.ADREEM_WEB_LEDGER_TOKEN_HASHES && !env.ADREEM_WEB_LEDGER_TOKENS) {
    throw new Error('Missing ADREEM_WEB_LEDGER_TOKEN_HASHES. Example: sha256-token-hash=main')
  }
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
