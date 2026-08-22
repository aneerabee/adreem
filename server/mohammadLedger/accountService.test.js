import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { ACCOUNT_OPENING_DIRECTIONS, COUNTERPARTY_ACCOUNT_KINDS, emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
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
  it('creates the same three linked person balances used by the web', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ...emptyAccountDraft(),
      ownerName: 'شركة النور',
      counterpartyOpenings: {
        ...emptyAccountDraft().counterpartyOpenings,
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR]: { amount: '900', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD]: { amount: '40', direction: ACCOUNT_OPENING_DIRECTIONS.I_OWE },
      },
    }, { idempotencyKey: 'counterparty-bundle-create' })

    expect(result.rejected).toBeFalsy()
    expect(result.bundle).toBe(true)
    expect(repository.state.accounts).toHaveLength(3)
    expect(repository.state.movements).toHaveLength(2)
    expect(repository.state.accounts.map((account) => [account.counterpartyKind, account.openingDinar, account.openingUsd])).toEqual([
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 900, 0],
      [COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, 0, 0],
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 0, -40],
    ])
  })

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
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingBalanceAmount: '750',
      openingBalanceDirection: 'owed_to_me',
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
    expect(repository.state.movements).toHaveLength(1)
    expect(repository.state.movements[0]).toMatchObject({
      type: MOVEMENT_TYPES.OPENING_BALANCE,
      amount: 750,
      currency: CURRENCIES.DINAR,
      destinationAccountId: first.account.id,
    })
  })

  it('creates a negative opening movement when I owe a person', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: 'سيف',
      subAccountName: 'شيك بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
      openingBalanceAmount: '1,500',
      openingBalanceDirection: 'i_owe',
    }, { idempotencyKey: 'account-opening-payable' })

    expect(result.rejected).toBeFalsy()
    expect(result.openingMovements).toHaveLength(1)
    expect(repository.state.accounts[0]).toMatchObject({ openingDinar: 0, openingUsd: -1_500 })
    expect(repository.state.movements[0]).toMatchObject({
      type: MOVEMENT_TYPES.OPENING_BALANCE,
      amount: -1_500,
      currency: CURRENCIES.USD,
    })
  })

  it('keeps a zero opening balance without creating a fake movement', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: 'أنا',
      subAccountName: 'الخزنة',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingBalanceAmount: '',
    }, { idempotencyKey: 'account-opening-zero' })

    expect(result.rejected).toBeFalsy()
    expect(result.openingMovements).toEqual([])
    expect(repository.state.movements).toEqual([])
  })

  it('rejects an ambiguous person opening balance without a chosen direction', async () => {
    const repository = memoryRepository()
    const result = await appendTelegramAccount(repository, {
      ownerName: 'سعيد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingBalanceAmount: '500',
      openingBalanceDirection: '',
    }, { idempotencyKey: 'account-opening-missing-direction' })

    expect(result.rejected).toBe(true)
    expect(result.validation.errors).toContainEqual(expect.objectContaining({ field: 'openingBalanceDirection' }))
    expect(repository.state.accounts).toEqual([])
    expect(repository.state.movements).toEqual([])
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

  it('renames every linked person balance and records the complete linked set', async () => {
    const repository = memoryRepository()
    const created = await appendTelegramAccount(repository, {
      ...emptyAccountDraft(),
      ownerName: 'سعيد',
    }, { idempotencyKey: 'linked-person-create' })

    const result = await updateTelegramAccount(repository, created.accounts[0].id, {
      ...created.accounts[0],
      ownerName: 'شركة سعيد',
    }, { idempotencyKey: 'linked-person-rename' })

    expect(result.rejected).toBeFalsy()
    expect(result.accountIds).toHaveLength(3)
    expect(new Set(repository.state.accounts.map((account) => account.ownerName))).toEqual(new Set(['شركة سعيد']))
    expect(repository.state.auditEvents.at(-1)).toMatchObject({
      action: 'account.updated',
      details: {
        accountId: created.accounts[0].id,
        accountIds: expect.arrayContaining(created.accounts.map((account) => account.id)),
      },
    })
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

    expect(result).toMatchObject({ rejected: true, reason: 'account-structure-locked' })
    expect(repository.state.accounts.find((item) => item.id === person.id).currencyKind).toBe(ACCOUNT_CURRENCY_KINDS.DINAR)
    expect(repository.state.auditEvents).toEqual([])
  })

  it('ignores the retired account separation flag without changing the account', async () => {
    const cash = createAccount({
      id: 'cash-used-scope',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingDinar: 500,
    })
    const person = createAccount({
      id: 'person-used-scope',
      ownerName: 'مالك',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const transfer = postMovement({
      id: 'posted-scope',
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: cash.id,
      destinationAccountId: person.id,
    }, [cash, person], [])
    const repository = memoryRepository({
      ...emptyState(),
      accounts: [cash, person],
      movements: [transfer],
      auditEvents: [],
    })

    const result = await updateTelegramAccount(repository, person.id, {
      ...person,
      summaryScope: 'separate',
    }, { idempotencyKey: 'scope-after-use' })

    expect(result.rejected).toBeFalsy()
    expect(result.changes).toEqual([])
    expect(repository.state.accounts.find((account) => account.id === person.id)).toMatchObject({
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      valueKind: VALUE_KINDS.RECEIVABLE,
      summaryScope: 'included',
    })
    expect(repository.state.auditEvents).toEqual([])
  })
})
