import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore, sessionWithReplacementMessage } from './sessionStore.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('telegram session store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps composite chat/user keys unambiguous', () => {
    const store = createSessionStore()

    store.set('1:2', '3', { flow: 'first' })
    store.set('1', '2:3', { flow: 'second' })

    expect(store.get('1:2', '3').flow).toBe('first')
    expect(store.get('1', '2:3').flow).toBe('second')
  })

  it('refreshes touchedAt without mutating the previously returned object', () => {
    vi.useFakeTimers()
    const store = createSessionStore()
    store.set(10, 20, { flow: 'movement' })

    const first = store.get(10, 20)
    const firstTouchedAt = first.touchedAt
    first.flow = 'changed-outside'
    vi.advanceTimersByTime(1)
    const second = store.get(10, 20)

    expect(second.flow).toBe('movement')
    expect(second.touchedAt).toBeGreaterThan(firstTouchedAt)
  })

  it('deeply isolates nested drafts across set, get, and durable persistence', async () => {
    const persisted = []
    const store = createSessionStore({
      onSet: async (_chatId, _userId, session) => persisted.push(session),
    })
    const input = {
      flow: 'movement',
      draft: { amount: 20, attachment: { label: 'receipt.pdf' } },
    }

    store.set(10, 20, input)
    input.draft.amount = 999
    input.draft.attachment.label = 'changed.pdf'

    const loaded = store.get(10, 20)
    loaded.draft.amount = 500
    loaded.draft.attachment.label = 'loaded-change.pdf'
    await store.flush()

    expect(store.peek(10, 20)).toMatchObject({
      draft: { amount: 20, attachment: { label: 'receipt.pdf' } },
    })
    expect(persisted).toHaveLength(2)
    expect(persisted[0].draft).toEqual({ amount: 20, attachment: { label: 'receipt.pdf' } })
    expect(persisted[1].draft).toEqual({ amount: 20, attachment: { label: 'receipt.pdf' } })
  })

  it('tracks a replacement card without letting an older card take over the session', () => {
    const current = { flow: 'movement', uiMessageId: 20 }

    expect(sessionWithReplacementMessage(current, 20, 30)).toEqual({ flow: 'movement', uiMessageId: 30 })
    expect(sessionWithReplacementMessage(current, null, 30)).toEqual({ flow: 'movement', uiMessageId: 30 })
    expect(sessionWithReplacementMessage(current, 10, 30)).toBe(current)
  })

  it('flushes durable writes and hydrates a session after restart', async () => {
    const durable = new Map()
    const first = createSessionStore({
      onSet: async (chatId, userId, session) => durable.set(`${chatId}:${userId}`, session),
      onClear: async (chatId, userId) => durable.delete(`${chatId}:${userId}`),
    })
    first.set(10, 20, { flow: 'movement', step: 'amount', draft: { amount: 125 } })
    await first.flush()

    const second = createSessionStore()
    const stored = durable.get('10:20')
    second.hydrate(10, 20, stored)
    stored.draft.amount = 999

    const restarted = second.get(10, 20)
    restarted.draft.amount = 500

    expect(second.get(10, 20)).toMatchObject({ flow: 'movement', step: 'amount', draft: { amount: 125 } })
  })

  it('surfaces durable write failures before committing the Telegram offset', async () => {
    const store = createSessionStore({
      onSet: async () => {
        throw new Error('storage unavailable')
      },
    })
    store.set(10, 20, { flow: 'movement' })
    await expect(store.flush()).rejects.toThrow('storage unavailable')
  })

  it('serializes set and clear writes so an older set cannot revive stale state', async () => {
    const durable = new Map()
    const firstSetStarted = deferred()
    const releaseFirstSet = deferred()
    const operations = []
    const store = createSessionStore({
      async onSet(chatId, userId, session) {
        operations.push(`set:${session.revision}`)
        if (session.revision === 1) {
          firstSetStarted.resolve()
          await releaseFirstSet.promise
        }
        durable.set(`${chatId}:${userId}`, session)
      },
      async onClear(chatId, userId) {
        operations.push('clear')
        durable.delete(`${chatId}:${userId}`)
      },
    })

    store.set(10, 20, { flow: 'movement', revision: 1 })
    await firstSetStarted.promise
    store.clear(10, 20)
    store.set(10, 20, { flow: 'account', revision: 2 })

    expect(operations).toEqual(['set:1'])
    releaseFirstSet.resolve()
    await store.flush()

    expect(operations).toEqual(['set:1', 'clear', 'set:2'])
    expect(durable.get('10:20')).toMatchObject({ flow: 'account', revision: 2 })
  })

  it('keeps a cleared session absent after its delayed set finishes', async () => {
    const durable = new Map()
    const firstSetStarted = deferred()
    const releaseFirstSet = deferred()
    const store = createSessionStore({
      async onSet(chatId, userId, session) {
        firstSetStarted.resolve()
        await releaseFirstSet.promise
        durable.set(`${chatId}:${userId}`, session)
      },
      async onClear(chatId, userId) {
        durable.delete(`${chatId}:${userId}`)
      },
    })

    store.set(10, 20, { flow: 'movement' })
    await firstSetStarted.promise
    store.clear(10, 20)
    releaseFirstSet.resolve()
    await store.flush()

    expect(durable.has('10:20')).toBe(false)
  })

  it('does not serialize writes belonging to different sessions', async () => {
    const releaseFirstSession = deferred()
    const secondSessionStored = deferred()
    const store = createSessionStore({
      async onSet(chatId) {
        if (chatId === 1) await releaseFirstSession.promise
        if (chatId === 2) secondSessionStored.resolve()
      },
    })

    store.set(1, 1, { flow: 'first' })
    store.set(2, 2, { flow: 'second' })

    await secondSessionStored.promise
    releaseFirstSession.resolve()
    await store.flush()
  })

  it('continues newer writes after a persistence failure while reporting that failure', async () => {
    const durable = new Map()
    const operations = []
    const store = createSessionStore({
      async onSet(chatId, userId, session) {
        operations.push(`set:${session.revision}`)
        if (session.revision === 1) throw new Error('first write failed')
        durable.set(`${chatId}:${userId}`, session)
      },
      async onClear(chatId, userId) {
        operations.push('clear')
        durable.delete(`${chatId}:${userId}`)
      },
    })

    store.set(10, 20, { revision: 1 })
    store.clear(10, 20)
    store.set(10, 20, { revision: 2 })

    await expect(store.flush()).rejects.toThrow('first write failed')
    expect(operations).toEqual(['set:1', 'clear', 'set:2'])
    expect(durable.get('10:20')).toMatchObject({ revision: 2 })
  })
})
