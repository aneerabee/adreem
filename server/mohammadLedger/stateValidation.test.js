import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { DIMENSION_TYPES, RECURRING_FREQUENCIES } from '../../src/mohammadLedger/ledgerOperations.js'
import { createEmptyAdreemState } from '../../src/mohammadLedger/ledgerState.js'
import { buildCounterpartyAccountBundle } from '../../src/mohammadLedger/counterpartyAccounts.js'
import { emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
import { validateLedgerStateTransition } from './stateValidation.js'

const at = '2026-08-19T12:00:00.000Z'
const validationNow = '2026-08-19T12:05:00.000Z'

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

function projectAccount(overrides = {}) {
  return {
    id: 'project-main',
    ownerName: 'مشروع رئيسي',
    subAccountName: 'مركز تكلفة',
    type: ACCOUNT_TYPES.PROJECT,
    valueKind: VALUE_KINDS.PROJECT,
    currencyKind: CURRENCIES.DINAR,
    status: ACCOUNT_STATUSES.ACTIVE,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function reconciliation(overrides = {}) {
  return {
    id: 'reconciliation-1',
    accountId: 'cash-main',
    actualDinar: 90,
    actualUsd: 0,
    expectedDinar: 100,
    expectedUsd: 0,
    diffDinar: -10,
    diffUsd: 0,
    note: 'مطابقة الصندوق',
    createdAt: at,
    ...overrides,
  }
}

function monthlyRule(overrides = {}) {
  return {
    id: 'monthly-rent',
    name: 'إيجار شهري',
    status: 'active',
    frequency: RECURRING_FREQUENCIES.MONTHLY,
    dayOfMonth: 15,
    executionMode: 'manual',
    template: {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 10,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-main',
      destinationAccountId: null,
      dimensionId: '',
      expenseCategoryId: '',
    },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

describe('server ledger state validation', () => {
  it('accepts a valid empty ledger', () => {
    const state = createEmptyAdreemState(at, { ledgerId: 'main' })
    expect(validateLedgerStateTransition(state, state, { ledgerId: 'main' })).toEqual({ ok: true, errors: [] })
  })

  it('accepts a complete linked person and rejects partial or mismatched bundles', () => {
    const current = createEmptyAdreemState(at)
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const valid = validateLedgerStateTransition({ ...current, accounts }, current)
    const missingChannel = validateLedgerStateTransition({ ...current, accounts: accounts.slice(0, 2) }, current)
    const mismatchedName = validateLedgerStateTransition({
      ...current,
      accounts: accounts.map((account, index) => index === 2 ? { ...account, ownerName: 'اسم مختلف' } : account),
    }, current)

    expect(valid.ok).toBe(true)
    expect(missingChannel.errors).toContainEqual(expect.objectContaining({ code: 'invalid-counterparty-bundle', field: 'counterpartyKind' }))
    expect(mismatchedName.errors).toContainEqual(expect.objectContaining({ code: 'invalid-counterparty-bundle', field: 'ownerName' }))
  })

  it('freezes every linked person channel after any one of them has a movement', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const movement = {
      id: 'linked-person-movement',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: null,
      destinationAccountId: accounts[0].id,
      createdAt: at,
      updatedAt: at,
    }
    const current = { ...createEmptyAdreemState(at), accounts, movements: [movement] }
    const renamed = accounts.map((account) => ({ ...account, ownerName: 'شركة سعيد', updatedAt: validationNow }))
    const result = validateLedgerStateTransition({ ...current, accounts: renamed }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'account-structure-locked', field: 'ownerName' }))
  })

  it('rejects silently deleting one linked channel or the complete person bundle', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const current = { ...createEmptyAdreemState(at), accounts }
    const oneRemoved = validateLedgerStateTransition({ ...current, accounts: accounts.slice(1) }, current)
    const allRemoved = validateLedgerStateTransition({ ...current, accounts: [] }, current)

    expect(oneRemoved.errors).toContainEqual(expect.objectContaining({ code: 'account-deletion-not-allowed', id: accounts[0].id }))
    expect(allRemoved.errors.filter((error) => error.code === 'account-deletion-not-allowed')).toHaveLength(3)
  })

  it('accepts one matching opening movement only while its account is first created', () => {
    const current = createEmptyAdreemState(at)
    const account = {
      id: 'person-opening',
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: CURRENCIES.DINAR,
      openingDinar: -500,
      openingUsd: 0,
      status: ACCOUNT_STATUSES.ACTIVE,
      createdAt: at,
    }
    const movement = {
      id: 'opening-person-opening-dinar',
      type: MOVEMENT_TYPES.OPENING_BALANCE,
      status: MOVEMENT_STATUSES.POSTED,
      amount: -500,
      currency: CURRENCIES.DINAR,
      sourceAccountId: null,
      destinationAccountId: account.id,
      createdAt: at,
      updatedAt: at,
    }

    expect(validateLedgerStateTransition({ ...current, accounts: [account], movements: [movement] }, current)).toEqual({ ok: true, errors: [] })
  })

  it('rejects adding or changing an opening balance after account creation', () => {
    const account = cashAccount({ openingDinar: 0, openingUsd: 0 })
    const current = { ...createEmptyAdreemState(at), accounts: [account] }
    const injectedOpening = opening(500)
    const changedAccount = { ...account, openingDinar: 500, updatedAt: validationNow }

    const injected = validateLedgerStateTransition({ ...current, movements: [injectedOpening] }, current)
    expect(injected.errors).toContainEqual(expect.objectContaining({ code: 'opening-account-not-new' }))

    const changed = validateLedgerStateTransition({ ...current, accounts: [changedAccount] }, current)
    expect(changed.errors).toContainEqual(expect.objectContaining({ code: 'account-opening-immutable', field: 'openingDinar' }))
  })

  it('keeps the opening movement immutable after the account is created', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount({ openingDinar: 100 })], movements: [opening(100)] }
    const changedOpening = { ...opening(100), amount: 200, updatedAt: validationNow }
    const result = validateLedgerStateTransition({ ...current, movements: [changedOpening] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'opening-movement-immutable', id: 'opening-1' }))
  })

  it('rejects a nonzero opening field without its matching movement', () => {
    const current = createEmptyAdreemState(at)
    const account = cashAccount({ openingDinar: 500, openingUsd: 0 })
    const result = validateLedgerStateTransition({ ...current, accounts: [account] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'account-opening-movement-missing' }))
  })

  it('allows an account merged into its active logical duplicate to become inactive', () => {
    const target = cashAccount({ id: 'cash-target' })
    const source = cashAccount({ id: 'cash-source', status: ACCOUNT_STATUSES.NEEDS_REVIEW })
    const current = { ...createEmptyAdreemState(at), accounts: [source, target] }
    const next = {
      ...current,
      savedAt: validationNow,
      accounts: [
        {
          ...source,
          status: ACCOUNT_STATUSES.INACTIVE,
          mergedIntoAccountId: target.id,
          disabledAt: validationNow,
          updatedAt: validationNow,
        },
        target,
      ],
    }

    expect(validateLedgerStateTransition(next, current)).toEqual({ ok: true, errors: [] })
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
      code: 'account-structure-locked',
      id: 'cash-main',
    }))
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-posted-movement',
      id: 'opening-1',
    }))
  })

  it('rejects renaming or changing the currency of a used account', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const renamed = cashAccount({ subAccountName: 'خزنة البيت', updatedAt: validationNow })
    expect(validateLedgerStateTransition({ ...current, accounts: [renamed] }, current).errors).toContainEqual(expect.objectContaining({
      code: 'account-structure-locked',
      id: 'cash-main',
      field: 'subAccountName',
    }))

    const changedCurrency = cashAccount({ currencyKind: CURRENCIES.USD, updatedAt: validationNow })
    const result = validateLedgerStateTransition({ ...current, accounts: [changedCurrency] }, current)
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'account-structure-locked',
      id: 'cash-main',
      field: 'currencyKind',
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
    const result = validateLedgerStateTransition({ ...current, movements: [invalidVoid] }, current, { now: validationNow })

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-movement-status-transition' }))
  })

  it('requires void metadata when canceling a movement under review', () => {
    const reviewMovement = { ...opening(), status: MOVEMENT_STATUSES.NEEDS_REVIEW }
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [reviewMovement] }
    const result = validateLedgerStateTransition({
      ...current,
      movements: [{ ...reviewMovement, status: MOVEMENT_STATUSES.VOIDED, updatedAt: '2026-08-19T12:02:00.000Z' }],
    }, current, { now: validationNow })

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
    const changedResult = validateLedgerStateTransition({ ...current, movements: [changedDuringVoid] }, current, { now: validationNow })
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

  it('rejects canceling a movement older than 24 hours using the server copy timestamp', () => {
    const oldExpense = {
      id: 'old-expense',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 10,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-main',
      createdAt: '2026-08-18T11:59:59.000Z',
      updatedAt: '2026-08-18T11:59:59.000Z',
    }
    const current = {
      ...createEmptyAdreemState(at),
      accounts: [cashAccount()],
      movements: [opening(), oldExpense],
    }
    const voided = {
      ...oldExpense,
      createdAt: validationNow,
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'إلغاء متأخر',
      voidedAt: '2026-08-19T12:00:00.000Z',
      updatedAt: '2026-08-19T12:00:00.000Z',
    }

    const result = validateLedgerStateTransition({ ...current, movements: [opening(), voided] }, current, {
      now: '2026-08-19T12:00:00.000Z',
    })

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'movement-void-window-expired',
      id: 'old-expense',
    }))
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'movement-created-at-immutable' }))
  })

  it('allows discarding an old movement under review because it never affected balances', () => {
    const oldReview = {
      id: 'old-review',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      amount: 10,
      currency: CURRENCIES.DINAR,
      sourceAccountId: null,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    }
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [oldReview] }
    const voided = {
      ...oldReview,
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'تنظيف حركة ناقصة',
      voidedAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({ ...current, movements: [voided] }, current, { now: validationNow })

    expect(result.errors).not.toContainEqual(expect.objectContaining({ code: 'movement-void-window-expired' }))
    expect(result.ok).toBe(true)
  })

  it('rejects invalid dimension records and missing linked project accounts', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [projectAccount()] }
    const invalidDimension = {
      id: 'dimension-1',
      name: 'المشروع',
      type: DIMENSION_TYPES.PROJECT,
      status: 'active',
      linkedAccountId: 'missing-project',
      createdAt: at,
    }

    const result = validateLedgerStateTransition({ ...current, dimensions: [invalidDimension] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'dimension-account-missing',
      id: 'dimension-1',
      field: 'linkedAccountId',
    }))
  })

  it('rejects posted movements that reference a missing dimension', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()], movements: [opening()] }
    const expense = {
      id: 'dimension-expense',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 10,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-main',
      dimensionId: 'missing-dimension',
      createdAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({ ...current, movements: [...current.movements, expense] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'movement-dimension-invalid',
      id: 'dimension-expense',
      field: 'dimensionId',
    }))
  })

  it('rejects a new fractional movement amount while preserving exchange-rate precision', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const correction = {
      id: 'fractional-correction',
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 0.25,
      rate: 7.125,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash-main',
      note: 'تصحيح',
      createdAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({ ...current, movements: [correction] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-movement-amount',
      id: 'fractional-correction',
      field: 'amount',
    }))
    expect(result.errors.some((error) => error.field === 'rate')).toBe(false)
  })

  it('rejects reconciliations that reference a missing account', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const invalid = reconciliation({ accountId: 'missing-account' })

    const result = validateLedgerStateTransition({ ...current, reconciliations: [invalid] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'reconciliation-account-missing',
      id: 'reconciliation-1',
      field: 'accountId',
    }))
  })

  it('rejects reconciliation differences that do not match actual and expected values', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const invalid = reconciliation({ diffDinar: -9 })

    const result = validateLedgerStateTransition({ ...current, reconciliations: [invalid] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'reconciliation-difference-mismatch',
      id: 'reconciliation-1',
      field: 'diffDinar',
    }))
  })

  it('rejects fractional currency values in a new reconciliation', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const invalid = reconciliation({ actualDinar: 90.25, diffDinar: -9.75 })

    const result = validateLedgerStateTransition({ ...current, reconciliations: [invalid] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'invalid-reconciliation-amount',
      id: 'reconciliation-1',
      field: 'actualDinar',
    }))
  })

  it('rejects movements that reference a missing reconciliation', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const correction = {
      id: 'correction-1',
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 10,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash-main',
      reconciliationId: 'missing-reconciliation',
      note: 'تصحيح مطابقة',
      createdAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({ ...current, movements: [correction] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'movement-reconciliation-missing',
      id: 'correction-1',
      field: 'reconciliationId',
    }))
  })

  it('rejects a reconciliation correction whose amount differs from the recorded difference', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const record = reconciliation()
    const correction = {
      id: 'wrong-reconciliation-correction',
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      amount: -9,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash-main',
      reconciliationId: record.id,
      note: 'تصحيح مطابقة',
      createdAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({
      ...current,
      movements: [correction],
      reconciliations: [record],
    }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'movement-reconciliation-amount-mismatch',
      id: 'wrong-reconciliation-correction',
      field: 'amount',
    }))
  })

  it.each([
    ['invalid-recurring-day', { dayOfMonth: 32 }],
    ['invalid-recurring-movement-type', { template: { ...monthlyRule().template, type: 'unknown' } }],
    ['recurring-account-reference-missing', { template: { ...monthlyRule().template, sourceAccountId: 'missing-account' } }],
    ['invalid-recurring-template', { template: { ...monthlyRule().template, amount: 10.5 } }],
  ])('rejects monthly rule failure %s', (code, overrides) => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const rule = monthlyRule(overrides)

    const result = validateLedgerStateTransition({ ...current, recurringRules: [rule] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({ code, id: 'monthly-rent' }))
  })

  it('rejects a recurring movement whose type differs from its monthly rule', () => {
    const current = { ...createEmptyAdreemState(at), accounts: [cashAccount()] }
    const rule = monthlyRule()
    const movement = {
      id: 'recurring-mismatch',
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 10,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash-main',
      recurringRuleId: rule.id,
      recurringRunKey: '2026-08',
      note: 'تصحيح',
      createdAt: validationNow,
      updatedAt: validationNow,
    }

    const result = validateLedgerStateTransition({
      ...current,
      movements: [movement],
      recurringRules: [rule],
    }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'movement-recurring-type-mismatch',
      id: 'recurring-mismatch',
    }))
  })

  it('rejects an active monthly rule that references an inactive account', () => {
    const hiddenCash = cashAccount({ status: ACCOUNT_STATUSES.INACTIVE })
    const current = { ...createEmptyAdreemState(at), accounts: [hiddenCash] }

    const result = validateLedgerStateTransition({ ...current, recurringRules: [monthlyRule()] }, current)

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'recurring-account-reference-inactive',
      id: 'monthly-rent',
      field: 'sourceAccountId',
    }))
  })

  it('allows disabling a legacy monthly rule after its account was removed', () => {
    const legacyRule = monthlyRule({ status: 'active' })
    const current = { ...createEmptyAdreemState(at), recurringRules: [legacyRule] }
    const disabledRule = { ...legacyRule, status: 'inactive', disabledAt: validationNow, updatedAt: validationNow }

    expect(validateLedgerStateTransition({ ...current, recurringRules: [disabledRule] }, current)).toEqual({
      ok: true,
      errors: [],
    })
  })

  it('grandfathers unchanged legacy operational records during unrelated saves', () => {
    const current = {
      ...createEmptyAdreemState(at),
      dimensions: [{ id: 'legacy-dimension', name: 'قديم' }],
      reconciliations: [{ id: 'legacy-reconciliation', accountId: 'old-account' }],
      recurringRules: [{ id: 'legacy-rule', name: 'قديم' }],
    }

    expect(validateLedgerStateTransition({ ...current }, current)).toEqual({ ok: true, errors: [] })
  })
})
