import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramClient } from './telegramClient.js'

describe('telegram client', () => {
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
})
