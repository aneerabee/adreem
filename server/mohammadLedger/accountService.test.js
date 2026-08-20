import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_TYPES, createAccount, createOpeningMovements, postMovement } from '../../src/mohammadLedger/ledgerCore.js'
import { appendTelegramAccount, resolveTelegramReviewAccount, updateTelegramAccount, validateAccountDraft } from './accountService.js'

function emptyState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    resetAt: new Date().toISOString(),
    accounts: [],
    movements: [],
  }
}

function memoryRepository(initialState = emptyState()) {
  let state = initialState
  return {
    get state() {
      return state
    },
    async load() {
      return { state, updatedAt: null }
    },
    async update(updater) {
      const result = await updater(state)
      if (result?.state) state = result.state
      return { ...result, state }
    },
  }
}

describe('telegram account service', () => {
  it('creates accounts through the same web account validation rules', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }, {
      idempotencyKey: 'account-session-1',
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    })

    expect(result.rejected).toBeFalsy()
    expect(repository.state.accounts).toHaveLength(1)
    expect(repository.state.accounts[0]).toMatchObject({
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      openingDinar: 0,
      openingUsd: 0,
      source: 'telegram',
    })
  })

  it('preserves multi-word names and normalizes only redundant spacing at save time', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: '  شركة   النور  ',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }, { idempotencyKey: 'account-multi-word' })

    expect(result.rejected).toBeFalsy()
    expect(repository.state.accounts[0].ownerName).toBe('شركة النور')
  })

  it('prevents duplicate logical accounts but keeps repeated confirm idempotent', async () => {
    const repository = memoryRepository()
    const draft = {
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }

    const first = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-1' })
    const repeatedConfirm = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-1' })
    const duplicateName = await appendTelegramAccount(repository, draft, { idempotencyKey: 'account-session-2' })

    expect(first.duplicate).toBe(false)
    expect(repeatedConfirm.duplicate).toBe(true)
    expect(duplicateName.rejected).toBe(true)
    expect(duplicateName.validation.errors.map((error) => error.field)).toContain('id')
    expect(duplicateName.validation.errors.map((error) => error.field)).toContain('subAccountName')
    expect(repository.state.accounts).toHaveLength(1)
  })

  it('validates missing names before saving', () => {
    const result = validateAccountDraft({
      ownerName: '',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    }, [])

    expect(result.validation.ok).toBe(false)
    expect(result.validation.errors.map((error) => error.field)).toContain('ownerName')
  })

  it('resolves an existing review account instead of creating a duplicate', async () => {
    const repository = memoryRepository({
      ...emptyState(),
      accounts: [
        {
          id: 'review-person',
          ownerName: 'محمد',
          subAccountName: 'حساب',
          type: ACCOUNT_TYPES.REVIEW,
          valueKind: VALUE_KINDS.REVIEW,
          status: ACCOUNT_STATUSES.NEEDS_REVIEW,
        },
      ],
    })

    const result = await resolveTelegramReviewAccount(repository, 'review-person', {
      ownerName: 'محمد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: 'LYD',
    }, {
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    })

    expect(result.rejected).toBeFalsy()
    expect(repository.state.accounts).toHaveLength(1)
    expect(repository.state.accounts[0]).toMatchObject({
      id: 'review-person',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      status: ACCOUNT_STATUSES.ACTIVE,
      reviewSource: 'telegram',
    })
    expect(repository.state.auditEvents).toHaveLength(1)
    expect(repository.state.auditEvents[0]).toMatchObject({ action: 'account.updated', details: { accountId: 'review-person' } })
  })

  it('updates an active account and records exact before and after values', async () => {
    const account = createAccount({
      id: 'person-active',
      ownerName: 'سعيد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const repository = memoryRepository({ ...emptyState(), accounts: [account], auditEvents: [] })

    const result = await updateTelegramAccount(repository, account.id, {
      ...account,
      ownerName: 'شركة سعيد',
      subAccountName: 'شيك بيننا',
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    }, { telegramUserId: 278516861 })

    expect(result.rejected).toBeFalsy()
    expect(result.changes.map((change) => change.key)).toEqual(['name', 'type', 'currency'])
    expect(repository.state.accounts[0]).toMatchObject({
      ownerName: 'شركة سعيد',
      subAccountName: 'شيك بيننا',
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })
    expect(repository.state.auditEvents[0]).toMatchObject({
      action: 'account.updated',
      details: {
        accountId: account.id,
        before: { ownerName: 'سعيد', subAccountName: 'كاش بيننا' },
        after: { ownerName: 'شركة سعيد', subAccountName: 'شيك بيننا' },
      },
    })
  })

  it('does not create a history event when the account did not change', async () => {
    const account = createAccount({
      id: 'cash-unchanged',
      ownerName: 'أنا',
      subAccountName: 'الخزنة',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const repository = memoryRepository({ ...emptyState(), accounts: [account], auditEvents: [] })

    const result = await updateTelegramAccount(repository, account.id, account)

    expect(result.unchanged).toBe(true)
    expect(repository.state.auditEvents).toEqual([])
  })

  it('rejects an edit that would invalidate an earlier posted movement', async () => {
    const cash = createAccount({
      id: 'cash-history',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingDinar: 500,
    })
    const person = createAccount({
      id: 'person-history',
      ownerName: 'مالك',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const openingMovements = createOpeningMovements([cash, person])
    const transfer = postMovement({
      id: 'posted-history',
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: cash.id,
      destinationAccountId: person.id,
    }, [cash, person], openingMovements)
    const repository = memoryRepository({
      ...emptyState(),
      accounts: [cash, person],
      movements: [...openingMovements, transfer],
      auditEvents: [],
    })

    const result = await updateTelegramAccount(repository, person.id, {
      ...person,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })

    expect(result).toMatchObject({ rejected: true, reason: 'movement-history' })
    expect(repository.state.accounts.find((item) => item.id === person.id).currencyKind).toBe(ACCOUNT_CURRENCY_KINDS.DINAR)
    expect(repository.state.auditEvents).toEqual([])
  })
})
