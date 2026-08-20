import { describe, expect, it, vi } from 'vitest'
import { createDurableBotRuntime, hydrateDurableSession, telegramBotKey } from './durableBotRuntime.js'

describe('durable Telegram runtime', () => {
  it('does not expose the Telegram token in the database namespace', () => {
    const key = telegramBotKey('123:secret-token')
    expect(key).toMatch(/^adreem-[a-f0-9]{20}$/)
    expect(key).not.toContain('secret-token')
  })

  it('keeps the current memory-only runtime until the durable flag is enabled', () => {
    const runtime = createDurableBotRuntime({}, '123:secret')
    runtime.sessions.set(1, 2, { flow: 'movement' })
    expect(runtime.durableState).toBe(null)
    expect(runtime.sessions.get(1, 2)).toMatchObject({ flow: 'movement' })
  })

  it('hydrates a saved session once after a restart', async () => {
    const runtime = {
      sessions: createDurableBotRuntime({}, '123:secret').sessions,
      durableState: {
        getSession: vi.fn(async () => ({ flow: 'movement', step: 'amount', touchedAt: Date.now() })),
      },
    }
    await hydrateDurableSession(runtime, 1, 2)
    await hydrateDurableSession(runtime, 1, 2)
    expect(runtime.sessions.get(1, 2)).toMatchObject({ flow: 'movement', step: 'amount' })
    expect(runtime.durableState.getSession).toHaveBeenCalledTimes(1)
  })
})
