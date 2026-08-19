import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramClient, telegramRequestTimeoutMs } from './telegramClient.js'

describe('telegram client', () => {
  it('keeps a safe network margin above Telegram long polling', () => {
    expect(telegramRequestTimeoutMs('getUpdates', { timeout: 30 })).toBe(60_000)
    expect(telegramRequestTimeoutMs('getUpdates', { timeout: 0 })).toBe(30_000)
    expect(telegramRequestTimeoutMs('sendMessage', {})).toBe(15_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('throws an informative error for non-ok HTTP responses without parsing JSON first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'retry later',
    })))

    const client = createTelegramClient('token')

    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).rejects.toThrow(
      'Telegram sendMessage failed: 429 Too Many Requests retry later',
    )
  })

  it('returns result for successful Telegram API responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 5 } }),
    })))

    const client = createTelegramClient('token')

    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).resolves.toEqual({ message_id: 5 })
  })

  it('times out stalled requests', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })))

    const client = createTelegramClient('token')
    const promise = client.sendMessage({ chat_id: 1, text: 'x' }, { timeoutMs: 5 })
    const expectation = expect(promise).rejects.toThrow('Telegram sendMessage timed out after 5ms.')
    await vi.advanceTimersByTimeAsync(5)

    await expectation
  })

  it('downloads Telegram files without exposing them beyond the configured size limit', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => '4' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createTelegramClient('secret-token')

    const buffer = await client.downloadFile('documents/receipt.pdf', { maxBytes: 4 })

    expect(buffer).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(fetchMock.mock.calls[0][0]).toContain('/file/botsecret-token/documents/receipt.pdf')
    await expect(client.downloadFile('../secret')).rejects.toThrow('Invalid Telegram file path')
  })
})
