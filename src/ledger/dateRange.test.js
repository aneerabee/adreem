import { describe, expect, it } from 'vitest'
import { ADREEM_TIME_ZONE, formatZonedTime, isZonedToday, isZonedYesterday, zonedDayKey, zonedDayRange } from './dateRange.js'

describe('ADREEM ledger date range', () => {
  it('uses Tripoli as the shared ledger timezone', () => {
    const reference = new Date('2026-08-20T22:30:00.000Z')

    expect(ADREEM_TIME_ZONE).toBe('Africa/Tripoli')
    expect(zonedDayKey(reference)).toBe('2026-08-21')
    expect(zonedDayRange(reference)).toEqual({
      from: '2026-08-20T22:00:00.000Z',
      before: '2026-08-21T22:00:00.000Z',
    })
    expect(formatZonedTime(reference, 'en-GB', { hour: '2-digit', minute: '2-digit' })).toBe('00:30')
  })

  it('compares today and yesterday in Tripoli instead of the device timezone', () => {
    const reference = new Date('2026-08-20T22:30:00.000Z')

    expect(isZonedToday('2026-08-20T22:05:00.000Z', reference)).toBe(true)
    expect(isZonedToday('2026-08-20T21:59:59.999Z', reference)).toBe(false)
    expect(isZonedYesterday('2026-08-20T21:59:59.999Z', reference)).toBe(true)
    expect(isZonedToday('invalid', reference)).toBe(false)
    expect(isZonedToday('', reference)).toBe(false)
  })
})
