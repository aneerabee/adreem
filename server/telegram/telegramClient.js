const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'
const PERMANENT_TELEGRAM_STATUSES = new Set([400, 403])

export class TelegramClientError extends Error {
  constructor(message, { method, status = null, cause } = {}) {
    super(message)
    this.name = 'TelegramClientError'
    this.method = method
    this.status = Number.isInteger(Number(status)) && Number(status) > 0 ? Number(status) : null
    this.retryable = this.status === null || !PERMANENT_TELEGRAM_STATUSES.has(this.status)
    if (cause) this.cause = cause
  }
}

export function isPermanentTelegramError(error) {
  return error instanceof TelegramClientError && error.retryable === false
}

function retryAfterMs(payload = {}) {
  const seconds = Number(payload?.parameters?.retry_after)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0
}

function waitForRetry(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
      return
    }
    const timeout = setTimeout(resolve, delayMs)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
}

export function telegramRequestTimeoutMs(method, payload = {}) {
  if (method !== 'getUpdates') return 15_000
  const longPollSeconds = Math.max(0, Number(payload.timeout) || 0)
  return Math.max(30_000, (longPollSeconds * 1_000) + 30_000)
}

export function createTelegramClient(token) {
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN.')
  const apiBase = `${TELEGRAM_API_BASE}${token}`
  const fileApiBase = `https://api.telegram.org/file/bot${token}`

  async function request(method, payload = {}, { timeoutMs = telegramRequestTimeoutMs(method, payload) } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
    try {
      while (true) {
        const response = await fetch(`${apiBase}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await response.text()
          let errorPayload = null
          try {
            errorPayload = JSON.parse(body)
          } catch {
            // Telegram or its proxy may return plain text errors.
          }
          const delayMs = response.status === 429 ? retryAfterMs(errorPayload) : 0
          const remainingMs = timeoutMs - (Date.now() - startedAt)
          if (delayMs && delayMs < remainingMs) {
            await waitForRetry(delayMs, controller.signal)
            continue
          }
          throw new TelegramClientError(
            `Telegram ${method} failed: ${response.status} ${response.statusText} ${body}`,
            { method, status: response.status },
          )
        }
        const data = await response.json()
        if (!data.ok) {
          const delayMs = Number(data.error_code) === 429 ? retryAfterMs(data) : 0
          const remainingMs = timeoutMs - (Date.now() - startedAt)
          if (delayMs && delayMs < remainingMs) {
            await waitForRetry(delayMs, controller.signal)
            continue
          }
          throw new TelegramClientError(data.description || `Telegram ${method} failed.`, {
            method,
            status: data.error_code,
          })
        }
        return data.result
      }
    } catch (error) {
      if (error instanceof TelegramClientError) throw error
      if (error?.name === 'AbortError') {
        throw new TelegramClientError(`Telegram ${method} timed out after ${timeoutMs}ms.`, {
          method,
          cause: error,
        })
      }
      throw new TelegramClientError(`Telegram ${method} request failed: ${error?.message || error}`, {
        method,
        cause: error,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function downloadFile(filePath, { timeoutMs = 30_000, maxBytes = 10 * 1024 * 1024 } = {}) {
    const cleanPath = String(filePath || '').replace(/^\/+/, '')
    if (!cleanPath || cleanPath.includes('..')) throw new Error('Invalid Telegram file path.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${fileApiBase}/${cleanPath}`, { signal: controller.signal })
      if (!response.ok) {
        throw new TelegramClientError(
          `Telegram file download failed: ${response.status} ${response.statusText}`,
          { method: 'downloadFile', status: response.status },
        )
      }
      const declaredSize = Number(response.headers?.get?.('content-length') || 0)
      if (declaredSize > maxBytes) throw new Error('Telegram file is larger than the allowed limit.')
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > maxBytes) throw new Error('Telegram file is larger than the allowed limit.')
      return buffer
    } catch (error) {
      if (error instanceof TelegramClientError) throw error
      if (error?.name === 'AbortError') {
        throw new TelegramClientError(`Telegram file download timed out after ${timeoutMs}ms.`, {
          method: 'downloadFile',
          cause: error,
        })
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    getUpdates: (payload, options) => request('getUpdates', payload, options),
    sendMessage: (payload, options) => request('sendMessage', payload, options),
    editMessageText: (payload, options) => request('editMessageText', payload, options),
    deleteMessage: (payload, options) => request('deleteMessage', payload, options),
    answerCallbackQuery: (payload, options) => request('answerCallbackQuery', payload, options),
    getFile: (payload, options) => request('getFile', payload, options),
    downloadFile,
  }
}
