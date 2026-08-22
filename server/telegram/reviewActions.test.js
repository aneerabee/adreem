import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES } from '../../src/ledger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, summarizeBalances } from '../../src/ledger/ledgerCore.js'
import { createFallbackLedgerState } from '../../src/ledger/ledgerState.js'
import {
  buildReviewSession,
  cancelReviewMovementInState,
  hideZeroReviewAccountInState,
  loadReviewSession,
  stableReviewRequestedPage,
} from './reviewActions.js'
import { actionCallbackData, parseActionCallback, stableActionToken } from './actionTokens.js'

function stateWithReviewItems() {
  return {
    ...createFallbackLedgerState('2026-01-01T00:00:00.000Z'),
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
    expect(session.choices.accounts[stableActionToken('review-zero')]).toBe('review-zero')
    expect(session.choices.accounts[stableActionToken('review-funded')]).toBe('review-funded')
    expect(session.choices.movements[stableActionToken('bad-transfer')]).toBe('bad-transfer')
  })

  it('paginates accounts and movements as one review queue', () => {
    const base = stateWithReviewItems()
    const state = {
      ...base,
      accounts: [
        ...base.accounts,
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `review-extra-${index}`,
          ownerName: `مراجعة إضافية ${index}`,
          subAccountName: 'كاش',
          type: 'review',
          valueKind: 'review',
          currencyKind: CURRENCIES.DINAR,
          status: ACCOUNT_STATUSES.NEEDS_REVIEW,
        })),
      ],
    }

    const first = buildReviewSession(state, 8, 0)
    const second = buildReviewSession(state, 8, 1)

    expect(first.total).toBe(10)
    expect(first.pageCount).toBe(2)
    expect(first.items).toHaveLength(8)
    expect(second.items).toHaveLength(2)
    expect(second.choices.accounts[stableActionToken('review-extra-6')]).toBe('review-extra-6')
    expect(second.choices.movements[stableActionToken('bad-transfer')]).toBe('bad-transfer')
    expect(second.items.map((item) => item.number)).toEqual([9, 10])
  })

  it('loads review movements beyond 1000 while keeping account-aware pages and numbers', async () => {
    const state = { ...stateWithReviewItems(), movements: [] }
    const movements = Array.from({ length: 1005 }, (_, index) => ({
      id: `movement-${index + 1}`,
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      amount: index + 1,
      currency: CURRENCIES.DINAR,
    }))
    const calls = []
    const repository = {
      loadMovements: async (options) => {
        calls.push(options)
        const start = options.movementOffset
        return {
          movements: movements.slice(start, start + options.movementLimit),
          page: { total: start === 0 ? movements.length : null },
        }
      },
    }

    const session = await loadReviewSession(repository, state, 8, 125)

    expect(calls).toEqual([
      { status: MOVEMENT_STATUSES.NEEDS_REVIEW, movementOffset: 998, movementLimit: 8 },
      { status: MOVEMENT_STATUSES.NEEDS_REVIEW, movementOffset: 0, movementLimit: 1 },
    ])
    expect(session.total).toBe(1007)
    expect(session.pageCount).toBe(126)
    expect(session.page).toBe(125)
    expect(session.items).toHaveLength(7)
    expect(session.items.map((item) => item.number)).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007])
    expect(session.items[0].id).toBe('movement-999')
    expect(session.choices.movements[stableActionToken('movement-1005')]).toBe('movement-1005')
  })

  it('rejects a review page from another ledger revision and resets navigation after a change', async () => {
    const repository = {
      loadMovements: async () => ({ movements: [], page: { total: 0 }, revision: 8 }),
    }

    await expect(loadReviewSession(repository, stateWithReviewItems(), 8, 1, 7))
      .rejects.toMatchObject({ code: 'ADREEM_REVIEW_REVISION_CHANGED' })
    expect(stableReviewRequestedPage({ flow: 'review', ledgerRevision: 7 }, 8, 3))
      .toEqual({ page: 0, changed: true })
    expect(stableReviewRequestedPage({ flow: 'review', ledgerRevision: 8 }, 8, 3))
      .toEqual({ page: 3, changed: false })
  })

  it('rejects a repeated review press instead of targeting the next item', () => {
    const state = stateWithReviewItems()
    const first = buildReviewSession(state)
    const token = stableActionToken('bad-transfer')
    const oldCallback = actionCallbackData('review', first.actionSessionId, 'movement', 'cancel', token)
    const result = cancelReviewMovementInState(state, 'bad-transfer')
    const second = buildReviewSession(result.state)

    expect(first.actionSessionId).not.toBe(second.actionSessionId)
    expect(second.choices.movements[token]).toBeUndefined()
    expect(parseActionCallback(oldCallback, 'review', second)).toBe(null)
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
