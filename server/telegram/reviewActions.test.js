import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, summarizeBalances } from '../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import {
  buildReviewSession,
  cancelReviewMovementInState,
  hideZeroReviewAccountInState,
} from './reviewActions.js'

function stateWithReviewItems() {
  return {
    ...createMohammadFallbackState('2026-01-01T00:00:00.000Z'),
    accounts: [
      {
        id: 'me-cash',
        ownerName: 'أنا',
        subAccountName: 'كاش',
        type: 'cash',
        valueKind: 'cash',
        currencyKind: CURRENCIES.DINAR,
        status: ACCOUNT_STATUSES.ACTIVE,
      },
      {
        id: 'review-zero',
        ownerName: 'مراجعة صفر',
        subAccountName: 'كاش',
        type: 'review',
        valueKind: 'review',
        currencyKind: CURRENCIES.DINAR,
        status: ACCOUNT_STATUSES.NEEDS_REVIEW,
      },
      {
        id: 'review-funded',
        ownerName: 'مراجعة برصيد',
        subAccountName: 'كاش',
        type: 'review',
        valueKind: 'review',
        currencyKind: CURRENCIES.DINAR,
        status: ACCOUNT_STATUSES.NEEDS_REVIEW,
      },
    ],
    movements: [
      {
        id: 'posted-opening',
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        amount: 500,
        currency: CURRENCIES.DINAR,
        destinationAccountId: 'me-cash',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'fund-review',
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        amount: 50,
        currency: CURRENCIES.DINAR,
        destinationAccountId: 'review-funded',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'bad-transfer',
        type: MOVEMENT_TYPES.TRANSFER,
        status: MOVEMENT_STATUSES.NEEDS_REVIEW,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

describe('telegram review actions', () => {
  it('builds short callback choices for review accounts and movements', () => {
    const session = buildReviewSession(stateWithReviewItems())

    expect(session.flow).toBe('review')
    expect(session.choices.accounts['0']).toBe('review-zero')
    expect(session.choices.accounts['1']).toBe('review-funded')
    expect(session.choices.movements['0']).toBe('bad-transfer')
  })

  it('voids a needs-review movement without changing posted balances', () => {
    const state = stateWithReviewItems()
    const before = summarizeBalances(state.accounts, state.movements)
    const result = cancelReviewMovementInState(state, 'bad-transfer', '2026-01-02T00:00:00.000Z')
    const after = summarizeBalances(result.state.accounts, result.state.movements)
    const movement = result.state.movements.find((item) => item.id === 'bad-transfer')

    expect(result.ok).toBe(true)
    expect(movement.status).toBe(MOVEMENT_STATUSES.VOIDED)
    expect(movement.voidReason).toContain('البوت')
    expect(after).toEqual(before)
  })

  it('refuses to cancel posted movements from the review path', () => {
    const state = stateWithReviewItems()
    const result = cancelReviewMovementInState(state, 'posted-opening')

    expect(result.ok).toBe(false)
    expect(result.state).toBeUndefined()
    expect(result.message).toContain('لم تعد في المراجعة')
  })

  it('hides only zero review accounts', () => {
    const state = stateWithReviewItems()
    const result = hideZeroReviewAccountInState(state, 'review-zero', '2026-01-02T00:00:00.000Z')
    const account = result.state.accounts.find((item) => item.id === 'review-zero')

    expect(result.ok).toBe(true)
    expect(account.status).toBe(ACCOUNT_STATUSES.INACTIVE)
    expect(account.disabledReason).toContain('البوت')
  })

  it('blocks hiding review accounts that still carry a balance', () => {
    const state = stateWithReviewItems()
    const result = hideZeroReviewAccountInState(state, 'review-funded')

    expect(result.ok).toBe(false)
    expect(result.state).toBeUndefined()
    expect(result.message).toContain('عليه رصيد')
  })
})
