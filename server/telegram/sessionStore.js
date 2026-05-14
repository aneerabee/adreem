const DEFAULT_TTL_MS = 30 * 60 * 1000

export function createSessionStore({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const sessions = new Map()

  function keyFor(chatId, userId) {
    return JSON.stringify([chatId, userId])
  }

  function cleanup() {
    const now = Date.now()
    for (const [key, session] of sessions.entries()) {
      if (now - session.touchedAt > ttlMs) sessions.delete(key)
    }
  }

  return {
    get(chatId, userId) {
      cleanup()
      const key = keyFor(chatId, userId)
      const session = sessions.get(key) || null
      if (!session) return null
      const nextSession = { ...session, touchedAt: Date.now() }
      sessions.set(key, nextSession)
      return { ...nextSession }
    },
    set(chatId, userId, session) {
      cleanup()
      sessions.set(keyFor(chatId, userId), { ...session, touchedAt: Date.now() })
    },
    update(chatId, userId, updater) {
      const current = this.get(chatId, userId)
      const next = updater(current)
      if (!next) this.clear(chatId, userId)
      else this.set(chatId, userId, next)
      return next
    },
    clear(chatId, userId) {
      sessions.delete(keyFor(chatId, userId))
    },
  }
}
