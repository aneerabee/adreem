import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  movementAccountCurrencyForRole,
  movementConfigFor,
  movementDefaultsFor,
  movementLabels,
  movementNeedsSource,
  movementSupportsDimension,
} from './movementConfig.js'

describe('adreem movement config', () => {
  it('has explicit config and defaults for every labeled movement type', () => {
    for (const type of Object.keys(movementLabels)) {
      expect(movementConfigFor(type), type).toHaveProperty('amountLabel')
      expect(movementDefaultsFor(type), type).toHaveProperty('sourceAccountId')
      expect(movementDefaultsFor(type), type).toHaveProperty('destinationAccountId')
      expect(movementDefaultsFor(type).sourceAccountId, type).toBe('')
      expect(movementDefaultsFor(type).destinationAccountId, type).toBe('')
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

  it('maps each exchange side to the currency shown in its account list', () => {
    expect(movementAccountCurrencyForRole(MOVEMENT_TYPES.USD_SALE, 'source', CURRENCIES.DINAR)).toBe(CURRENCIES.USD)
    expect(movementAccountCurrencyForRole(MOVEMENT_TYPES.USD_SALE, 'destination', CURRENCIES.USD)).toBe(CURRENCIES.DINAR)
    expect(movementAccountCurrencyForRole(MOVEMENT_TYPES.USD_PURCHASE, 'source', CURRENCIES.USD)).toBe(CURRENCIES.DINAR)
    expect(movementAccountCurrencyForRole(MOVEMENT_TYPES.USD_PURCHASE, 'destination', CURRENCIES.DINAR)).toBe(CURRENCIES.USD)
  })

  it('configures record-only as a note-based movement without account sides', () => {
    const config = movementConfigFor(MOVEMENT_TYPES.RECORD_ONLY)

    expect(config).toMatchObject({ needsSource: false, needsDestination: false, requiresNote: true })
    expect(movementNeedsSource(MOVEMENT_TYPES.RECORD_ONLY)).toBe(false)
    expect(movementSupportsDimension(MOVEMENT_TYPES.RECORD_ONLY)).toBe(false)
  })
})
