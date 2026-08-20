import { describe, expect, it } from 'vitest'
import { ADREEM_TIME_ZONE, zonedDayKey, zonedDayRange } from './dateRange.js'

describe('Telegram ledger day range', () => {
  it('uses the ledger timezone instead of the server timezone', () => {
    expect(ADREEM_TIME_ZONE).toBe('Africa/Tripoli')
    expect(zonedDayKey(new Date('2026-08-20T22:30:00.000Z'))).toBe('2026-08-21')
    expect(zonedDayRange(new Date('2026-08-20T22:30:00.000Z'), 'Africa/Tripoli')).toEqual({
      from: '2026-08-20T22:00:00.000Z',
      before: '2026-08-21T22:00:00.000Z',
    })
  })

  it('handles daylight-saving boundaries with real local midnights', () => {
    expect(zonedDayRange(new Date('2026-03-29T12:00:00.000Z'), 'Europe/Istanbul')).toEqual({
      from: '2026-03-28T21:00:00.000Z',
      before: '2026-03-29T21:00:00.000Z',
    })
  })
})
