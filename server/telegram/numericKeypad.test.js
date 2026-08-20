import { describe, expect, it } from 'vitest'
import { applyNumericKey, normalizeNumericBuffer, numericBufferDisplay, numericBufferValue } from './numericKeypad.js'

describe('telegram numeric keypad', () => {
  it('builds an integer exactly like a calculator', () => {
    const value = ['1', '2', '5', '0', '0'].reduce((current, key) => applyNumericKey(current, key), '')
    expect(value).toBe('12500')
    expect(numericBufferDisplay(value)).toBe('12,500')
    expect(numericBufferValue(value)).toBe(12500)
  })

  it('supports delete, clear, and a valid zero balance', () => {
    expect(applyNumericKey('1250', 'delete')).toBe('125')
    expect(applyNumericKey('1250', 'clear')).toBe('')
    expect(numericBufferValue('0', { allowZero: true })).toBe(0)
    expect(numericBufferValue('0')).toBe(null)
  })

  it('accepts one decimal separator and limits the rate precision', () => {
    const keys = ['7', 'dot', '5', '5', 'dot', '1', '2', '3', '4', '5', '6', '7']
    const value = keys.reduce((current, key) => applyNumericKey(current, key, { allowDecimal: true }), '')
    expect(value).toBe('7.551234')
    expect(numericBufferValue(value, { allowDecimal: true })).toBe(7.551234)
  })

  it('normalizes Arabic digits without admitting non-numeric text', () => {
    expect(normalizeNumericBuffer('١٢٥٠')).toBe('1250')
    expect(normalizeNumericBuffer('٧٫٥', { allowDecimal: true })).toBe('7.5')
    expect(normalizeNumericBuffer('abc')).toBe('')
  })
})
