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

  it('rejects hiding an account with a fractional balance', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening(0.4)] }
    const hidden = cashAccount({ status: ACCOUNT_STATUSES.INACTIVE, updatedAt: '2026-08-19T12:02:00.000Z' })
    const result = validateLedgerStateTransition({ ...current, accounts: [hidden] }, current)

    expect(result.errors.some((error) => error.code === 'inactive-account-has-balance')).toBe(true)
  })

  it('revalidates unchanged posted movements after a related account classification changes', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const reclassified = cashAccount({
      type: ACCOUNT_TYPES.SUMMARY,
      updatedAt: '2026-08-19T12:02:00.000Z',
    })
    const result = validateLedgerStateTransition({ ...current, accounts: [reclassified] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-posted-movement',
      id: 'opening-1',
    }))
  })

  it.each([MOVEMENT_STATUSES.DRAFT, MOVEMENT_STATUSES.NEEDS_REVIEW])(
    'rejects moving a posted movement back to %s',
    (status) => {
      const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
      const changed = {
        ...opening(),
        status,
        updatedAt: '2026-08-19T12:02:00.000Z',
      }
      const result = validateLedgerStateTransition({ ...current, movements: [changed] }, current)

      expect(result.errors).toContainEqual(expect.objectContaining({
        code: 'invalid-movement-status-transition',
        id: 'opening-1',
      }))
    },
  )

  it('rejects restoring a voided movement to posted', () => {
    const voided = {
      ...opening(),
      status: MOVEMENT_STATUSES.VOIDED,
      voidedAt: '2026-08-19T12:01:00.000Z',
      updatedAt: '2026-08-19T12:01:00.000Z',
    }
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [voided] }
    const restored = {
      ...voided,
      status: MOVEMENT_STATUSES.POSTED,
      updatedAt: '2026-08-19T12:02:00.000Z',
    }
    const result = validateLedgerStateTransition({ ...current, movements: [restored] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-movement-status-transition',
      id: 'opening-1',
    }))
  })

  it('requires a reason and timestamp when voiding a posted movement', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const invalidVoid = {
      ...opening(),
      status: MOVEMENT_STATUSES.VOIDED,
      updatedAt: '2026-08-19T12:02:00.000Z',
    }
    const result = validateLedgerStateTransition({ ...current, movements: [invalidVoid] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-status-transition' }))
  })

  it('requires void metadata when canceling a movement under review', () => {
    const reviewMovement = { ...opening(), status: MOVEMENT_STATUSES.NEEDS_REVIEW }
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [reviewMovement] }
    const result = validateLedgerStateTransition({
      ...current,
      movements: [{ ...reviewMovement, status: MOVEMENT_STATUSES.VOIDED, updatedAt: '2026-08-19T12:02:00.000Z' }],
    }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-status-transition' }))
  })

  it('does not allow changing the value while voiding or editing an already voided movement', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const changedDuringVoid = {
      ...opening(),
      amount: 999,
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'إلغاء',
      voidedAt: '2026-08-19T12:02:00.000Z',
      updatedAt: '2026-08-19T12:02:00.000Z',
    }
    const changedResult = validateLedgerStateTransition({ ...current, movements: [changedDuringVoid] }, current)
    expect(changedResult.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-status-transition' }))

    const voidedState = { ...current, movements: [{ ...opening(), status: MOVEMENT_STATUSES.VOIDED, voidReason: 'إلغاء', voidedAt: at }] }
    const editedVoid = { ...voidedState.movements[0], note: 'تغيير', updatedAt: '2026-08-19T12:03:00.000Z' }
    const editedResult = validateLedgerStateTransition({ ...voidedState, movements: [editedVoid] }, voidedState)
    expect(editedResult.errors).toContainEqual(expect.objectContaining({ code: 'voided-movement-is-immutable' }))
  })

  it('rejects changing the ledger reset marker through normal client save', () => {
    const current = createEmptyAdreemState(at)
    const result = validateLedgerStateTransition({ ...current, resetAt: '2099-01-01T00:00:00.000Z' }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'client-reset-not-allowed' }))
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

  it('rejects stored attachments that are orphaned or have incomplete file metadata', () => {
    const current = createEmptyAdreemState(at, { ledgerId: 'main' })
    const next = {
      ...current,
      attachments: [{
        id: 'attachment-1',
        label: 'receipt.jpg',
        storagePath: 'main/2026-08-19/receipt.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 0,
        createdAt: at,
        updatedAt: at,
      }],
    }

    const result = validateLedgerStateTransition(next, current, { ledgerId: 'main' })

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'orphan-attachment' }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-stored-attachment' }))
  })
})
