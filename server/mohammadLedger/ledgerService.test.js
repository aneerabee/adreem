import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import { appendTelegramMovement, buildLedgerSnapshot, getMovementAccounts, parseAmountText, rankAccountsForTelegram } from './ledgerService.js'

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
    expect(usdTransferSources.every((account) => account.id === 'me-cash' || /دولار|usd|\$/i.test(`${account.ownerName} ${account.subAccountName} ${account.legacyName || ''}`))).toBe(true)
    expect(usdTransferSources.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(transferDestinations.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(transferDestinations.some((account) => account.id === 'me-jumhouria')).toBe(false)
    expect(usdTransferDestinations.some((account) => account.id === 'saeed-cash')).toBe(false)
    expect(usdSaleSources.some((account) => account.id === 'me-cash')).toBe(true)
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
