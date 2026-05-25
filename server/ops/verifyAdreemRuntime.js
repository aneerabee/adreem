import { request } from 'node:https'
import { request as httpRequest } from 'node:http'

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADREEM_WEB_ALLOWED_ORIGIN',
  'ADREEM_WEB_LEDGER_TOKENS',
  'TELEGRAM_BOT_TOKEN',
]

function envStatus() {
  return required.map((key) => ({ key, ok: Boolean(process.env[key]) }))
}

function requestJson(url, options = {}) {
  const client = url.startsWith('https:') ? request : httpRequest
  return new Promise((resolve) => {
    const req = client(url, options, (res) => {
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
    req.end()
  })
}

function firstLedgerToken() {
  const raw = String(process.env.ADREEM_WEB_LEDGER_TOKENS || '')
  const first = raw.split(',').map((item) => item.trim()).filter(Boolean)[0] || ''
  return first.split('=')[0] || ''
}

async function main() {
  const apiBase = String(process.env.ADREEM_API_URL || `http://127.0.0.1:${process.env.ADREEM_API_PORT || 8787}`).replace(/\/+$/, '')
  const checks = {
    env: envStatus(),
    apiHealth: await requestJson(`${apiBase}/health`),
    ledgerRead: null,
  }
  const token = firstLedgerToken()
  if (token) {
    checks.ledgerRead = await requestJson(`${apiBase}/api/ledger`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    })
  }
  const failedEnv = checks.env.filter((item) => !item.ok).map((item) => item.key)
  const ok = !failedEnv.length && checks.apiHealth.ok && (!checks.ledgerRead || checks.ledgerRead.ok)
  console.log(JSON.stringify({
    ok,
    failedEnv,
    apiHealth: checks.apiHealth,
    ledgerRead: checks.ledgerRead ? { ok: checks.ledgerRead.ok, status: checks.ledgerRead.status, source: checks.ledgerRead.body?.source } : null,
  }, null, 2))
  process.exit(ok ? 0 : 1)
}

main()
