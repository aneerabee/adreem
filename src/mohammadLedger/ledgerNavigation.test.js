import { describe, expect, it } from 'vitest'
import { DEFAULT_LEDGER_NAVIGATION, ledgerNavigationSearch, readLedgerNavigation } from './ledgerNavigation.js'

describe('ADREEM ledger navigation', () => {
  it('restores the active section and its visible subview after a reload', () => {
    expect(readLedgerNavigation('?section=accounts&group=people&people=all')).toEqual({
      section: 'accounts',
      entryMode: 'movement',
      accountGroup: 'people',
    })
    expect(readLedgerNavigation('?entry=account')).toEqual({
      section: 'entry',
      entryMode: 'account',
      accountGroup: 'money',
    })
  })

  it('keeps unrelated query values and removes inactive navigation values', () => {
    expect(ledgerNavigationSearch('?source=phone&group=people', {
      ...DEFAULT_LEDGER_NAVIGATION,
      section: 'history',
    })).toBe('?source=phone&section=history')
  })

  it('removes the retired all-people subview from refreshed links', () => {
    expect(ledgerNavigationSearch('?section=accounts&group=people&people=all', {
      ...DEFAULT_LEDGER_NAVIGATION,
      section: 'accounts',
      accountGroup: 'people',
    })).toBe('?section=accounts&group=people')
  })

  it('falls back safely when a link contains unknown navigation values', () => {
    expect(readLedgerNavigation('?section=unknown&entry=wrong&group=bad&people=no')).toEqual(DEFAULT_LEDGER_NAVIGATION)
  })
})
