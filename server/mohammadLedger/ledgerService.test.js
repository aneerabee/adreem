import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import {
  appendTelegramMovement,
  buildLedgerSnapshot,
  getMovementAccounts,
  parseAmountText,
  rankAccountsForTelegram,
  resolveTelegramReviewMovement,
} from './ledgerService.js'

function memoryRepository(initialState = createMohammadFallbackState()) {
  let state = initialState
  return {
    get state() {
      return state
    },
    async update(updater) {
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
      attachmentUrl: 'https://example.com/fuel.jpg',
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
      url: 'https://example.com/fuel.jpg',
      source: 'telegram',
    })
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
    const initialState = createMohammadFallbackState()
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

    const result = await resolveTelegramReviewMovement(repository, 'review-transfer', {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      note: 'تم الإصلاح',
    }, {
      telegramUserId: 278516861,
      telegramChatId: 278516861,
    })

    const saved = repository.state.movements.filter((movement) => movement.id === 'review-transfer')
    expect(result.needsReview).toBe(false)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: 'saeed-cash',
      reviewSource: 'telegram',
    })
  })

  it('uses the shared web account-selection rules for telegram movement parties', () => {
    const state = createMohammadFallbackState()
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
    const state = createMohammadFallbackState()
    const snapshot = buildLedgerSnapshot(state)
    const ranked = rankAccountsForTelegram(snapshot.activeAccounts, state)

    expect(ranked[0].id).toBe('me-cash')
    expect(ranked.slice(0, 8).some((account) => account.id === 'rabee-cash')).toBe(true)
  })
})
