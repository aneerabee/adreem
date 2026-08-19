import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { createEmptyAdreemState } from '../../src/mohammadLedger/ledgerState.js'
import { validateLedgerStateTransition } from './stateValidation.js'

const at = '2026-08-19T12:00:00.000Z'

function cashAccount(overrides = {}) {
  return {
    id: 'cash-main',
    ownerName: 'أنا',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    currencyKind: CURRENCIES.DINAR,
    status: ACCOUNT_STATUSES.ACTIVE,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function opening(amount = 100) {
  return {
    id: 'opening-1',
    type: MOVEMENT_TYPES.OPENING_BALANCE,
    status: MOVEMENT_STATUSES.POSTED,
    amount,
    currency: CURRENCIES.DINAR,
    sourceAccountId: null,
    destinationAccountId: 'cash-main',
    createdAt: at,
    updatedAt: at,
  }
}

describe('server ledger state validation', () => {
  it('accepts a valid empty ledger', () => {
    const state = createEmptyAdreemState(at, { ledgerId: 'main' })
    expect(validateLedgerStateTransition(state, state, { ledgerId: 'main' })).toEqual({ ok: true, errors: [] })
  })

  it('rejects a new posted movement that overdraws owned cash', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const expense = {
      id: 'expense-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 101,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-main',
      createdAt: '2026-08-19T12:01:00.000Z',
      updatedAt: '2026-08-19T12:01:00.000Z',
    }
    const result = validateLedgerStateTransition({ ...current, movements: [...current.movements, expense] }, current)

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'invalid-posted-movement')).toBe(true)
    expect(result.errors.some((error) => error.code === 'negative-own-balance')).toBe(true)
  })

  it('allows invalid drafts only when they remain in review and do not affect balances', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const reviewMovement = {
      id: 'review-1',
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      amount: 50,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-main',
      destinationAccountId: '',
      createdAt: '2026-08-19T12:01:00.000Z',
      updatedAt: '2026-08-19T12:01:00.000Z',
    }

    expect(validateLedgerStateTransition({ ...current, movements: [...current.movements, reviewMovement] }, current).ok).toBe(true)
  })

  it('rejects hiding an account that still carries money', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const hidden = cashAccount({ status: ACCOUNT_STATUSES.INACTIVE, updatedAt: '2026-08-19T12:02:00.000Z' })
    const result = validateLedgerStateTransition({ ...current, accounts: [hidden] }, current)

    expect(result.errors.some((error) => error.code === 'inactive-account-has-balance')).toBe(true)
  })

  it('rejects a new attachment path that belongs to another ledger', () => {
    const current = createEmptyAdreemState(at, { ledgerId: 'main' })
    const next = {
      ...current,
      attachments: [{
        id: 'attachment-1',
        label: 'إيصال',
        storagePath: 'other/receipt.pdf',
        status: 'active',
        createdAt: at,
        updatedAt: at,
      }],
    }
    const result = validateLedgerStateTransition(next, current, { ledgerId: 'main' })

    expect(result.errors.some((error) => error.code === 'attachment-outside-ledger')).toBe(true)
  })
})
