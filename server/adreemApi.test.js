import { describe, expect, it } from 'vitest'
import { createAdreemApiHandler, parseLedgerTokenMap, tokenFromAuthHeader } from './adreemApi.js'

function createMockResponse() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body || ''
    },
  }
}

function createJsonRequest(body) {
  const listeners = {}
  return {
    method: 'PUT',
    url: '/api/ledger',
    headers: { authorization: 'Bearer token-a' },
    setEncoding() {},
    on(event, handler) {
      listeners[event] = handler
      return this
    },
    destroy() {},
    emitBody() {
      listeners.data?.(JSON.stringify(body))
      listeners.end?.()
    },
  }
}

describe('ADREEM web API auth helpers', () => {
  it('parses private web tokens into isolated ledger ids', () => {
    const map = parseLedgerTokenMap('rabee-secret=main, saeed-secret=saeed-book')

    expect(map.get('rabee-secret')).toBe('main')
    expect(map.get('saeed-secret')).toBe('saeed-book')
  })

  it('extracts bearer tokens safely', () => {
    expect(tokenFromAuthHeader('Bearer abc123')).toBe('abc123')
    expect(tokenFromAuthHeader('bearer token with spaces')).toBe('token with spaces')
    expect(tokenFromAuthHeader('abc123')).toBe('')
  })

  it('merges PUT state with the latest repository state instead of replacing arrays', async () => {
    const api = createAdreemApiHandler({
      ADREEM_WEB_LEDGER_TOKENS: 'token-a=main',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })
    let updateCallback = null
    const currentState = {
      accounts: [{ id: 'from-bot', updatedAt: '2026-01-01T10:00:00.000Z' }],
      movements: [{ id: 'bot-movement', updatedAt: '2026-01-01T10:01:00.000Z' }],
      savedAt: '2026-01-01T10:01:00.000Z',
      version: 2,
    }
    api.__setRepositoryForTest?.({
      async update(callback) {
        updateCallback = callback
        const result = await callback(currentState)
        return { ...result, state: result.state }
      },
    })

    const request = createJsonRequest({
      state: {
        accounts: [{ id: 'from-web', updatedAt: '2026-01-01T10:02:00.000Z' }],
        movements: [{ id: 'web-movement', updatedAt: '2026-01-01T10:03:00.000Z' }],
        savedAt: '2026-01-01T10:03:00.000Z',
        version: 2,
      },
    })
    const response = createMockResponse()
    const promise = api(request, response)
    request.emitBody()
    await promise

    const payload = JSON.parse(response.body)
    expect(updateCallback).toBeTruthy()
    expect(response.statusCode).toBe(200)
    expect(payload.state.accounts.map((account) => account.id).sort()).toEqual(['from-bot', 'from-web'])
    expect(payload.state.movements.map((movement) => movement.id).sort()).toEqual(['bot-movement', 'web-movement'])
  })
})
