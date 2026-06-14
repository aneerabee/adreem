import { request } from 'node:https'
import { request as httpRequest } from 'node:http'

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADREEM_WEB_ALLOWED_ORIGIN',
  'TELEGRAM_BOT_TOKEN',
]

function envStatus() {
  return [
    ...required.map((key) => ({ key, ok: Boolean(process.env[key]) })),
    {
      key: 'ADREEM_RUNTIME_TEST_EMAIL',
      ok: Boolean(process.env.ADREEM_RUNTIME_TEST_EMAIL),
    },
    {
      key: 'ADREEM_RUNTIME_TEST_PASSWORD',
      ok: Boolean(process.env.ADREEM_RUNTIME_TEST_PASSWORD),
    },
  ]
}

function requestJson(url, options = {}) {
  const client = url.startsWith('https:') ? request : httpRequest
  return new Promise((resolve) => {
    const body = options.body ? JSON.stringify(options.body) : ''
    const requestOptions = {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
      },
    }
    delete requestOptions.body
    const req = client(url, requestOptions, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body ? JSON.parse(body) : null })
        } catch {
          resolve({ ok: false, status: res.statusCode, body })
        }
      })
    })
    req.on('error', (error) => resolve({ ok: false, error: error.message }))
    req.setTimeout(8000, () => {
      req.destroy(new Error('timeout'))
    })
    if (body) req.write(body)
    req.end()
  })
}

async function login(apiBase) {
  if (!process.env.ADREEM_RUNTIME_TEST_EMAIL || !process.env.ADREEM_RUNTIME_TEST_PASSWORD) {
    return { ok: false, skipped: true, reason: 'Set ADREEM_RUNTIME_TEST_EMAIL and ADREEM_RUNTIME_TEST_PASSWORD.' }
  }
  return requestJson(`${apiBase}/api/auth/login`, {
    method: 'POST',
    body: {
      email: process.env.ADREEM_RUNTIME_TEST_EMAIL,
      password: process.env.ADREEM_RUNTIME_TEST_PASSWORD,
    },
  })
}

async function main() {
  const apiBase = String(process.env.ADREEM_API_URL || `http://127.0.0.1:${process.env.ADREEM_API_PORT || 8787}`).replace(/\/+$/, '')
  const checks = {
    env: envStatus(),
    apiHealth: await requestJson(`${apiBase}/health`),
    login: null,
    ledgerRead: null,
  }
  checks.login = await login(apiBase)
  const token = checks.login.body?.token || ''
  if (checks.login.ok && token) {
    checks.ledgerRead = await requestJson(`${apiBase}/api/ledger`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
  } else {
    checks.ledgerRead = { ok: false, skipped: true, reason: 'Runtime login failed or missing test credentials.' }
  }
  const failedEnv = checks.env.filter((item) => !item.ok).map((item) => item.key)
  const ok = !failedEnv.length && checks.apiHealth.ok && (!checks.ledgerRead || checks.ledgerRead.ok)
  console.log(JSON.stringify({
    ok,
    failedEnv,
    apiHealth: checks.apiHealth,
    login: checks.login ? { ok: checks.login.ok, status: checks.login.status, userId: checks.login.body?.user?.userId } : null,
    ledgerRead: checks.ledgerRead ? { ok: checks.ledgerRead.ok, status: checks.ledgerRead.status, source: checks.ledgerRead.body?.source } : null,
  }, null, 2))
  process.exit(ok ? 0 : 1)
}

main()
