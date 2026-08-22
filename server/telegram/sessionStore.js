const DEFAULT_TTL_MS = 30 * 60 * 1000

function cloneSession(session) {
  return structuredClone(session)
}

export function sessionWithReplacementMessage(session, currentMessageId, replacementMessageId) {
  if (!session || !replacementMessageId) return session
  if (session.uiMessageId && currentMessageId && session.uiMessageId !== currentMessageId) return session
  return { ...session, uiMessageId: replacementMessageId }
}

export function createSessionStore({ ttlMs = DEFAULT_TTL_MS, onSet, onClear } = {}) {
  const sessions = new Map()
  const activeScopes = new Map()
  const pendingWrites = []
  const writeTails = new Map()
  let flushTail = Promise.resolve()

  function enqueuePersistence(chatId, userId, operation) {
    const key = keyFor(chatId, userId)
    const previous = writeTails.get(key) || Promise.resolve()
    const task = previous.then(operation)
    const tail = task.catch(() => undefined)
    writeTails.set(key, tail)
    void tail.finally(() => {
      if (writeTails.get(key) === tail) writeTails.delete(key)
    })
    pendingWrites.push(task.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    ))
  }

  function persistSet(chatId, userId, session) {
    if (typeof onSet !== 'function') return
    const persistentSession = cloneSession(session)
    enqueuePersistence(chatId, userId, () => onSet(chatId, userId, cloneSession(persistentSession)))
  }

  function persistClear(chatId, userId) {
    if (typeof onClear !== 'function') return
    enqueuePersistence(chatId, userId, () => onClear(chatId, userId))
  }

  function keyFor(chatId, userId) {
    return JSON.stringify([chatId, userId])
  }

  function normalizedScope(scope) {
    return {
      ownerId: String(scope?.ownerId || ''),
      ledgerId: String(scope?.ledgerId || ''),
    }
  }

  function sameScope(left, right) {
    return Boolean(left && right) && left.ownerId === right.ownerId && left.ledgerId === right.ledgerId
  }

  function cleanup() {
    const now = Date.now()
    for (const [key, session] of sessions.entries()) {
      if (now - session.touchedAt <= ttlMs) continue
      sessions.delete(key)
      const [chatId, userId] = JSON.parse(key)
      persistClear(chatId, userId)
    }
  }

  return {
    peek(chatId, userId) {
      cleanup()
      const session = sessions.get(keyFor(chatId, userId)) || null
      return session ? cloneSession(session) : null
    },
    get(chatId, userId) {
      cleanup()
      const key = keyFor(chatId, userId)
      const session = sessions.get(key) || null
      if (!session) return null
      const nextSession = { ...cloneSession(session), touchedAt: Date.now() }
      sessions.set(key, nextSession)
      persistSet(chatId, userId, nextSession)
      return cloneSession(nextSession)
    },
    set(chatId, userId, session) {
      cleanup()
      const key = keyFor(chatId, userId)
      const scope = activeScopes.get(key)
      const nextSession = {
        ...cloneSession(session),
        ...(scope ? { ledgerScope: cloneSession(scope) } : {}),
        touchedAt: Date.now(),
      }
      sessions.set(key, nextSession)
      persistSet(chatId, userId, nextSession)
    },
    bindScope(chatId, userId, scope) {
      cleanup()
      const key = keyFor(chatId, userId)
      const nextScope = normalizedScope(scope)
      const current = sessions.get(key) || null
      const discarded = Boolean(current && !sameScope(current.ledgerScope, nextScope))
      if (discarded) {
        sessions.delete(key)
        persistClear(chatId, userId)
      }
      activeScopes.set(key, nextScope)
      return { discarded }
    },
    releaseScope(chatId, userId) {
      activeScopes.delete(keyFor(chatId, userId))
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
      persistClear(chatId, userId)
    },
    hydrate(chatId, userId, session) {
      if (!session || typeof session !== 'object') return null
      const touchedAt = Number(session.touchedAt || Date.now())
      if (Date.now() - touchedAt > ttlMs) return null
      const nextSession = { ...cloneSession(session), touchedAt }
      sessions.set(keyFor(chatId, userId), nextSession)
      return cloneSession(nextSession)
    },
    async flush() {
      const flush = flushTail.then(async () => {
        const writes = pendingWrites.splice(0)
        const results = await Promise.all(writes)
        const failure = results.find((result) => !result.ok)
        if (failure) throw failure.error
      })
      flushTail = flush.catch(() => undefined)
      return flush
    },
  }
}
