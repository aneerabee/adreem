const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

export function createTelegramClient(token) {
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN.')
  const apiBase = `${TELEGRAM_API_BASE}${token}`
  const fileApiBase = `https://api.telegram.org/file/bot${token}`

  async function request(method, payload = {}, { timeoutMs = method === 'getUpdates' ? 45_000 : 15_000 } = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(`${apiBase}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Telegram ${method} timed out after ${timeoutMs}ms.`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Telegram ${method} failed: ${response.status} ${response.statusText} ${body}`)
    }
    const data = await response.json()
    if (!data.ok) {
      throw new Error(data.description || `Telegram ${method} failed.`)
    }
    return data.result
  }

  async function downloadFile(filePath, { timeoutMs = 30_000, maxBytes = 10 * 1024 * 1024 } = {}) {
    const cleanPath = String(filePath || '').replace(/^\/+/, '')
    if (!cleanPath || cleanPath.includes('..')) throw new Error('Invalid Telegram file path.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${fileApiBase}/${cleanPath}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`)
      const declaredSize = Number(response.headers?.get?.('content-length') || 0)
      if (declaredSize > maxBytes) throw new Error('Telegram file is larger than the allowed limit.')
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > maxBytes) throw new Error('Telegram file is larger than the allowed limit.')
      return buffer
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Telegram file download timed out after ${timeoutMs}ms.`)
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
