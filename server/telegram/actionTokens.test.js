import { describe, expect, it } from 'vitest'
import { actionCallbackData, createActionSessionId, parseActionCallback, stableActionToken } from './actionTokens.js'

describe('telegram action tokens', () => {
  it('binds callbacks to one rendered action card', () => {
    const oldSession = { actionSessionId: createActionSessionId() }
    const currentSession = { actionSessionId: createActionSessionId() }
    const callback = actionCallbackData('history', oldSession.actionSessionId, 'confirm', stableActionToken('movement-1'))

    expect(parseActionCallback(callback, 'history', oldSession)).toEqual(['confirm', stableActionToken('movement-1')])
    expect(parseActionCallback(callback, 'history', currentSession)).toBe(null)
  })

  it('keeps stable item callbacks inside the Telegram size limit', () => {
    const callback = actionCallbackData(
      'review',
      createActionSessionId(),
      'movement',
      'cancel',
      stableActionToken('movement-with-a-very-long-identifier'),
    )

    expect(Buffer.byteLength(callback)).toBeLessThanOrEqual(64)
  })
})
