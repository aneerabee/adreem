import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/ledger/ledgerCore.js'
import { createFallbackLedgerState } from '../../src/ledger/ledgerState.js'
import {
  appendTelegramMovement,
  appendTelegramReconciliation,
  buildLedgerSnapshot,
  formatMoney,
  getMovementAccounts,
  parseAmountText,
  parseBalanceText,
  rankAccountsForTelegram,
  resolveTelegramReviewMovement,
  telegramUpdateIdempotencyKey,
} from './ledgerService.js'

describe('telegram exact money formatting', () => {
  it('does not round a net total beyond the ordinary numeric limit', () => {
    expect(formatMoney(9_999_999_999_999_990n, CURRENCIES.DINAR)).toBe('9,999,999,999,999,990 د.ل')
    expect(formatMoney(-9_999_999_999_999_990n, CURRENCIES.USD)).toBe('-9,999,999,999,999,990 $')
  })
})

function memoryRepository(initialState = createFallbackLedgerState()) {
  let state = initialState
  let updateOptions = null
  return {
    get state() {
      return state
    },
    get updateOptions() {
      return updateOptions
    },
    async update(updater, options = {}) {
      updateOptions = options
      const result = await updater(state)
      if (result?.state) state = result.state
      return { ...result, state }
    },
  }
}

describe('telegram ledger service', () => {
  it('parses western and arabic amount text safely', () => {
    expect(parseAmountText('1,250')).toBe(1250)
    expect(parseAmountText('١٢٥٠')).toBe(1250)
    expect(parseAmountText('7.55', { allowDecimal: true })).toBe(7.55)
    expect(parseAmountText('-1')).toBe(null)
    expect(parseBalanceText('0')).toBe(0)
    expect(parseBalanceText('١٢٬٥٠٠')).toBe(12500)
    expect(parseBalanceText('١٢٫٥٠')).toBe(13)
    expect(parseBalanceText('-1')).toBe(null)
  })

  it('appends a telegram movement once using the idempotency key', async () => {
    const repository = memoryRepository()
    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      note: '',
    }

    const first = await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-1',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    const second = await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-1',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    const saved = repository.state.movements.filter((movement) => movement.idempotencyKey === 'user-session-1')
    expect(first.movement.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(second.duplicate).toBe(true)
    expect(saved).toHaveLength(1)
  })

  it('stores telegram movement attachment metadata without duplicating repeated confirms', async () => {
    const repository = memoryRepository()
    const draft = {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      note: 'وقود',
      attachmentLabel: 'إيصال وقود',
      attachmentUrl: '',
      attachmentStoragePath: 'main/2026-08-19/fuel.jpg',
      attachmentMimeType: 'image/jpeg',
      attachmentSizeBytes: 1024,
    }

    await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-attachment',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-attachment',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    const movement = repository.state.movements.find((item) => item.idempotencyKey === 'user-session-attachment')
    const attachments = repository.state.attachments.filter((attachment) => attachment.movementId === movement.id)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      label: 'إيصال وقود',
      url: '',
      storagePath: 'main/2026-08-19/fuel.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      source: 'telegram',
    })
  })

  it('creates a monthly recurring rule only once for posted telegram movements', async () => {
    const repository = memoryRepository()
    const draft = {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 75,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      note: 'اشتراك شهري',
      recurringEnabled: true,
    }

    await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-recurring',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-recurring',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(repository.state.recurringRules).toHaveLength(1)
    expect(repository.state.recurringRules[0]).toMatchObject({
      source: 'telegram',
      status: 'active',
      frequency: 'monthly',
      template: {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 75,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
      },
    })
  })

  it('distinguishes recurring rules by rate and expense category', async () => {
    const rateRepository = memoryRepository()
    const saleDraft = {
      type: MOVEMENT_TYPES.USD_SALE,
      amount: 10,
      currency: CURRENCIES.USD,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'me-jumhouria',
      note: 'بيع شهري',
      recurringEnabled: true,
    }

    await appendTelegramMovement(rateRepository, { ...saleDraft, rate: 5 }, {
      idempotencyKey: 'recurring-rate-5',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    await appendTelegramMovement(rateRepository, { ...saleDraft, rate: 5.1 }, {
      idempotencyKey: 'recurring-rate-5-1',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(rateRepository.state.recurringRules).toHaveLength(2)

    const initialState = createFallbackLedgerState()
    const categoryRepository = memoryRepository({
      ...initialState,
      accounts: [
        ...initialState.accounts,
        {
          id: 'fuel-expense',
          ownerName: 'وقود',
          subAccountName: 'مصروف',
          type: ACCOUNT_TYPES.EXPENSE,
          valueKind: VALUE_KINDS.EXPENSE,
          status: 'active',
        },
      ],
    })
    const expenseDraft = {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 75,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      note: 'مصروف شهري',
      recurringEnabled: true,
    }

    await appendTelegramMovement(categoryRepository, {
      ...expenseDraft,
      expenseCategoryId: 'personal-expense',
    }, {
      idempotencyKey: 'recurring-category-personal',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    await appendTelegramMovement(categoryRepository, {
      ...expenseDraft,
      expenseCategoryId: 'fuel-expense',
    }, {
      idempotencyKey: 'recurring-category-fuel',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(categoryRepository.state.recurringRules).toHaveLength(2)
  })

  it('records telegram reconciliation and creates one idempotent correction movement', async () => {
    const repository = memoryRepository()

    const first = await appendTelegramReconciliation(repository, {
      accountId: 'me-cash',
      currency: CURRENCIES.DINAR,
      actualBalance: 47000,
      note: 'عد الصندوق',
    }, {
      idempotencyKey: 'user-reconcile-1',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    const second = await appendTelegramReconciliation(repository, {
      accountId: 'me-cash',
      currency: CURRENCIES.DINAR,
      actualBalance: 47000,
      note: 'عد الصندوق',
    }, {
      idempotencyKey: 'user-reconcile-1',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(first.reconciliation).toMatchObject({
      accountId: 'me-cash',
      actualDinar: 47000,
      note: 'عد الصندوق',
      source: 'telegram',
    })
    expect(first.correctionMovements).toHaveLength(1)
    expect(first.correctionMovements[0]).toMatchObject({
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: 'me-cash',
      currency: CURRENCIES.DINAR,
      reconciliationId: first.reconciliation.id,
    })
    expect(second.duplicate).toBe(true)
    expect(repository.state.reconciliations).toHaveLength(1)
    expect(repository.state.movements.filter((movement) => movement.reconciliationId === first.reconciliation.id)).toHaveLength(1)
  })

  it('normalizes legacy fractional balances before reconciling from telegram', async () => {
    const initialState = createFallbackLedgerState()
    const fractionalState = {
      ...initialState,
      movements: [
        ...initialState.movements,
        {
          id: 'fractional-adjustment',
          type: MOVEMENT_TYPES.CORRECTION,
          status: MOVEMENT_STATUSES.POSTED,
          amount: 0.25,
          currency: CURRENCIES.DINAR,
          destinationAccountId: 'me-cash',
          note: 'تصحيح كسري',
        },
      ],
    }
    const expectedDinar = buildLedgerSnapshot(fractionalState).balanceByAccountId.get('me-cash').dinar
    const repository = memoryRepository(fractionalState)

    const result = await appendTelegramReconciliation(repository, {
      accountId: 'me-cash',
      currency: CURRENCIES.DINAR,
      actualBalance: expectedDinar - 0.1,
      note: 'مطابقة كسرية',
    }, {
      idempotencyKey: 'fractional-reconciliation',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(result.reconciliation).toMatchObject({
      expectedDinar,
      actualDinar: expectedDinar,
      diffDinar: 0,
    })
    expect(result.correctionMovements).toHaveLength(0)
  })

  it('rejects telegram reconciliation without a clear note', async () => {
    const repository = memoryRepository()

    const result = await appendTelegramReconciliation(repository, {
      accountId: 'me-cash',
      currency: CURRENCIES.DINAR,
      actualBalance: 47000,
      note: '',
    }, {
      idempotencyKey: 'user-reconcile-missing-note',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(result.rejected).toBe(true)
    expect(result.error).toContain('ملاحظة')
    expect(repository.state.reconciliations).toHaveLength(0)
  })

  it('saves incomplete telegram movements into review instead of rejecting them', async () => {
    const repository = memoryRepository()
    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: '',
    }

    const first = await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-review',
      telegramUserId: 1,
      telegramChatId: 1,
    })
    const second = await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'user-session-review',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    const saved = repository.state.movements.filter((movement) => movement.idempotencyKey === 'user-session-review')
    expect(first.rejected).toBeUndefined()
    expect(first.needsReview).toBe(true)
    expect(first.movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(second.duplicate).toBe(true)
    expect(second.needsReview).toBe(true)
    expect(saved).toHaveLength(1)
  })

  it('resolves a review telegram movement in place without creating a duplicate', async () => {
    const initialState = createFallbackLedgerState()
    const repository = memoryRepository({
      ...initialState,
      movements: [
        ...initialState.movements,
        {
          id: 'review-transfer',
          type: MOVEMENT_TYPES.TRANSFER,
          status: MOVEMENT_STATUSES.NEEDS_REVIEW,
          amount: 100,
          currency: CURRENCIES.DINAR,
          sourceAccountId: 'me-cash',
          destinationAccountId: '',
          source: 'telegram',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      note: 'تم الإصلاح',
    }
    const metadata = {
      idempotencyKey: telegramUpdateIdempotencyKey(8100, 'movement-review'),
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    }
    const result = await resolveTelegramReviewMovement(repository, 'review-transfer', draft, metadata)
    const duplicate = await resolveTelegramReviewMovement(repository, 'review-transfer', draft, metadata)

    const saved = repository.state.movements.filter((movement) => movement.id === 'review-transfer')
    expect(result.needsReview).toBe(false)
    expect(duplicate.duplicate).toBe(true)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: 'saeed-cash',
      reviewSource: 'telegram',
    })
    expect(repository.state.auditEvents.filter((event) => event.action === 'movement.updated')).toHaveLength(1)
    expect(repository.updateOptions).toEqual({ movementIds: ['review-transfer'] })
  })

  it('uses the shared web account-selection rules for telegram movement parties', () => {
    const state = createFallbackLedgerState()
    const transferSources = getMovementAccounts(state, MOVEMENT_TYPES.TRANSFER, 'source', {
      destinationAccountId: 'saeed-cash',
      currency: CURRENCIES.DINAR,
    })
    const usdTransferSources = getMovementAccounts(state, MOVEMENT_TYPES.TRANSFER, 'source', {
      currency: CURRENCIES.USD,
    })
    const transferDestinations = getMovementAccounts(state, MOVEMENT_TYPES.TRANSFER, 'destination', {
      sourceAccountId: 'saeed-cash',
      currency: CURRENCIES.DINAR,
    })
    const usdTransferDestinations = getMovementAccounts(state, MOVEMENT_TYPES.TRANSFER, 'destination', {
      sourceAccountId: 'me-cash',
      currency: CURRENCIES.USD,
    })
    const usdSaleSources = getMovementAccounts(state, MOVEMENT_TYPES.USD_SALE, 'source', {})
    const usdPurchaseDestinations = getMovementAccounts(state, MOVEMENT_TYPES.USD_PURCHASE, 'destination', {
      sourceAccountId: 'me-jumhouria',
    })

    expect(transferSources.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(usdTransferSources.some((account) => account.id === 'me-jumhouria')).toBe(false)
    expect(usdTransferSources.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(usdTransferSources.some((account) => account.id === 'me-cash')).toBe(true)
    expect(transferDestinations.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(transferDestinations.some((account) => account.id === 'me-jumhouria')).toBe(false)
    expect(usdTransferDestinations.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(usdTransferDestinations.some((account) => account.id === 'me-jumhouria')).toBe(false)
    expect(usdSaleSources.some((account) => account.id === 'me-cash')).toBe(true)
    expect(usdPurchaseDestinations.some((account) => account.id === 'me-cash')).toBe(true)
    expect(usdPurchaseDestinations.some((account) => account.id === 'me-jumhouria')).toBe(false)
  })

  it('ranks active debt and balance accounts before zero accounts for telegram choices', () => {
    const state = createFallbackLedgerState()
    const snapshot = buildLedgerSnapshot(state)
    const ranked = rankAccountsForTelegram(snapshot.activeAccounts, state)

    expect(ranked[0].id).toBe('me-cash')
    expect(ranked.slice(0, 8).some((account) => account.id === 'rabee-cash')).toBe(true)
  })
})
