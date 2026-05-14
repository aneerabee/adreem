import { describe, expect, it } from 'vitest'
import { MOVEMENT_TYPES } from './ledgerCore.js'
import {
  movementConfigFor,
  movementDefaultsFor,
  movementLabels,
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
  })
})
