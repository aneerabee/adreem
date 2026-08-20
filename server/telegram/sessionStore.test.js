import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore, sessionWithReplacementMessage } from './sessionStore.js'

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

  it('tracks a replacement card without letting an older card take over the session', () => {
    const current = { flow: 'movement', uiMessageId: 20 }

    expect(sessionWithReplacementMessage(current, 20, 30)).toEqual({ flow: 'movement', uiMessageId: 30 })
    expect(sessionWithReplacementMessage(current, null, 30)).toEqual({ flow: 'movement', uiMessageId: 30 })
    expect(sessionWithReplacementMessage(current, 10, 30)).toBe(current)
  })
})
