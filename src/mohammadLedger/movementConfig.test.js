import { describe, expect, it } from 'vitest'
import { MOVEMENT_TYPES } from './ledgerCore.js'
import {
  movementConfigFor,
  movementDefaultsFor,
  movementLabels,
  movementNeedsSource,
  movementSupportsDimension,
} from './movementConfig.js'

describe('mohammad movement config', () => {
  it('has explicit config and defaults for every labeled movement type', () => {
    for (const type of Object.keys(movementLabels)) {
      expect(movementConfigFor(type), type).toHaveProperty('amountLabel')
      expect(movementDefaultsFor(type), type).toHaveProperty('sourceAccountId')
      expect(movementDefaultsFor(type), type).toHaveProperty('destinationAccountId')
    }
  })

  it('does not treat legacy income and correction as transfer routes', () => {
    expect(movementConfigFor(MOVEMENT_TYPES.TRUCK_INCOME).sourceLabel).toBe('مصدر خارجي')
    expect(movementConfigFor(MOVEMENT_TYPES.EXTERNAL_INCOME).sourceLabel).toBe('مصدر خارجي')
    expect(movementConfigFor(MOVEMENT_TYPES.CORRECTION).sourceLabel).toBe('تصحيح')
    expect(movementNeedsSource(MOVEMENT_TYPES.EXTERNAL_INCOME)).toBe(false)
    expect(movementNeedsSource(MOVEMENT_TYPES.CORRECTION)).toBe(false)
    expect(movementNeedsSource(MOVEMENT_TYPES.TRANSFER)).toBe(true)
  })

  it('keeps operational dimensions for income and expense only', () => {
    expect(movementSupportsDimension(MOVEMENT_TYPES.EXPENSE)).toBe(true)
    expect(movementSupportsDimension(MOVEMENT_TYPES.EXTERNAL_INCOME)).toBe(true)
    expect(movementSupportsDimension(MOVEMENT_TYPES.TRUCK_EXPENSE)).toBe(true)
    expect(movementSupportsDimension(MOVEMENT_TYPES.TRUCK_INCOME)).toBe(true)
    expect(movementSupportsDimension(MOVEMENT_TYPES.TRANSFER)).toBe(false)
    expect(movementSupportsDimension(MOVEMENT_TYPES.USD_SALE)).toBe(false)
    expect(movementSupportsDimension(MOVEMENT_TYPES.USD_PURCHASE)).toBe(false)
  })
})
