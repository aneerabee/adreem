import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramClient, TelegramClientError, telegramRequestTimeoutMs } from './telegramClient.js'

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

  it.each([400, 403])('marks Telegram HTTP %i errors as permanent', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status,
      statusText: 'Rejected',
      text: async () => JSON.stringify({ ok: false, description: 'message rejected' }),
    })))
    const client = createTelegramClient('token')

    const error = await client.sendMessage({ chat_id: 1, text: 'x' }).catch((caught) => caught)

    expect(error).toBeInstanceOf(TelegramClientError)
    expect(error).toMatchObject({ method: 'sendMessage', status, retryable: false })
  })

  it('marks temporary Telegram API errors as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error_code: 500, description: 'temporary failure' }),
    })))
    const client = createTelegramClient('token')

    const error = await client.sendMessage({ chat_id: 1, text: 'x' }).catch((caught) => caught)

    expect(error).toBeInstanceOf(TelegramClientError)
    expect(error).toMatchObject({ method: 'sendMessage', status: 500, retryable: true })
  })

  it('retries a 429 after retry_after when it fits inside the request timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => JSON.stringify({ ok: false, parameters: { retry_after: 2 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 6 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const client = createTelegramClient('token')

    const promise = client.sendMessage({ chat_id: 1, text: 'x' }, { timeoutMs: 5_000 })
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toEqual({ message_id: 6 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 429 beyond the current request timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => JSON.stringify({ ok: false, parameters: { retry_after: 2 } }),
    })))
    const client = createTelegramClient('token')

    await expect(client.sendMessage({ chat_id: 1, text: 'x' }, { timeoutMs: 1_000 })).rejects.toThrow(
      'Telegram sendMessage failed: 429 Too Many Requests',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
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
    const expectation = expect(promise).rejects.toMatchObject({
      message: 'Telegram sendMessage timed out after 5ms.',
      method: 'sendMessage',
      status: null,
      retryable: true,
    })
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
