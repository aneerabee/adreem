import { describe, expect, it } from 'vitest'
import { applyLedgerDelta, createLedgerDelta, isLedgerDeltaEmpty } from './ledgerDelta.js'

describe('ledger delta', () => {
  it('contains only new and changed records', () => {
    const base = {
      accounts: [{ id: 'a', ownerName: 'أنا', status: 'active' }],
      movements: [{ id: 'm1', amount: 100, status: 'posted' }],
      ignoredExternalAccounts: ['x'],
    }
    const next = {
      accounts: [
        { id: 'a', status: 'active', ownerName: 'أنا' },
        { id: 'b', ownerName: 'محمد', status: 'active' },
      ],
      movements: [{ id: 'm1', amount: 200, status: 'posted' }],
      ignoredExternalAccounts: ['x'],
    }

    expect(createLedgerDelta(next, base)).toEqual({
      accounts: [{ id: 'b', ownerName: 'محمد', status: 'active' }],
      movements: [{ id: 'm1', amount: 200, status: 'posted' }],
    })
  })

  it('does not interpret omitted paginated records as deletion', () => {
    const base = { movements: [{ id: 'old' }, { id: 'visible' }] }
    const next = { movements: [{ id: 'visible' }] }
    expect(isLedgerDeltaEmpty(createLedgerDelta(next, base))).toBe(true)
  })

  it('applies changed records without dropping older records', () => {
    const state = {
      accounts: [{ id: 'a', ownerName: 'قبل' }],
      movements: [{ id: 'old', amount: 10 }],
      ignoredExternalAccounts: [],
    }
    const result = applyLedgerDelta(state, {
      accounts: [{ id: 'a', ownerName: 'بعد' }],
      movements: [{ id: 'new', amount: 20 }],
      ignoredExternalAccounts: ['external'],
    })

    expect(result.accounts).toEqual([{ id: 'a', ownerName: 'بعد' }])
    expect(result.movements.map(({ id }) => id)).toEqual(['old', 'new'])
    expect(result.ignoredExternalAccounts).toEqual(['external'])
  })
})
