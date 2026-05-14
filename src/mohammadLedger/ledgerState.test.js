import { describe, expect, it } from 'vitest'
import { mergeLedgerStates } from './ledgerState.js'

describe('mohammad ledger state reset safety', () => {
  it('keeps a newer remote reset from merging old local accounts back in', () => {
    const local = {
      savedAt: '2026-05-13T10:00:00.000Z',
      accounts: [{ id: 'old-person', ownerName: 'قديم', subAccountName: 'كاش' }],
      movements: [{ id: 'old-movement', createdAt: '2026-05-13T10:00:00.000Z' }],
    }
    const remote = {
      savedAt: '2026-05-14T08:00:00.000Z',
      resetAt: '2026-05-14T08:00:00.000Z',
      accounts: [{ id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' }],
      movements: [],
    }

    const merged = mergeLedgerStates(local, remote, remote)

    expect(merged.accounts.map((account) => account.id)).toEqual(['me-cash'])
    expect(merged.movements).toEqual([])
    expect(merged.resetAt).toBe(remote.resetAt)
  })
})
