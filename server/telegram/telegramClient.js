const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

export function createTelegramClient(token) {
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN.')
  const apiBase = `${TELEGRAM_API_BASE}${token}`

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

  return {
    getUpdates: (payload, options) => request('getUpdates', payload, options),
    sendMessage: (payload, options) => request('sendMessage', payload, options),
    editMessageText: (payload, options) => request('editMessageText', payload, options),
    deleteMessage: (payload, options) => request('deleteMessage', payload, options),
    answerCallbackQuery: (payload, options) => request('answerCallbackQuery', payload, options),
  }
}
