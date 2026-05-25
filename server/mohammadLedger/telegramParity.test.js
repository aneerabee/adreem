import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  postMovement,
} from '../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import { appendTelegramMovement } from './ledgerService.js'

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

function comparableMovement(movement) {
  return {
    type: movement.type,
    amount: movement.amount,
    currency: movement.currency,
    sourceAccountId: movement.sourceAccountId || null,
    destinationAccountId: movement.destinationAccountId || null,
    rate: movement.rate,
    status: movement.status,
    errorFields: movement.validation?.errors?.map((error) => error.field).sort() || [],
    entries: buildPostingEntries(movement),
  }
}

async function telegramMovementFor(draft, initialState = createMohammadFallbackState()) {
  const repository = memoryRepository(initialState)
  const result = await appendTelegramMovement(repository, draft, {
    idempotencyKey: `parity-${draft.type}-${draft.amount}-${draft.sourceAccountId || 'none'}-${draft.destinationAccountId || 'none'}`,
    telegramUserId: 1,
    telegramChatId: 1,
  })
  return result.movement
}

describe('telegram and web movement parity', () => {
  it('posts a dinar transfer with the same accounting effect as core/web', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      note: '',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('posts a USD sale with the same currency split as core/web', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.USD_SALE,
      amount: 100,
      currency: CURRENCIES.USD,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'me-jumhouria',
      rate: 7.5,
      note: '',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('posts a USD purchase with the same currency split as core/web', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.USD_PURCHASE,
      amount: 750,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-jumhouria',
      destinationAccountId: 'me-cash',
      rate: 7.5,
      note: '',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft, state)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('posts an expense with the same single-account effect as core/web', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 90,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: 'وقود',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft, state)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('posts a USD transfer with the same compatible-account effect as core/web', async () => {
    const state = {
      ...createMohammadFallbackState(),
      accounts: [
        ...createMohammadFallbackState().accounts,
        {
          id: 'usd-vault',
          ownerName: 'أنا',
          subAccountName: 'خزنة دولار',
          type: 'cash',
          valueKind: 'cash',
          currencyKind: CURRENCIES.USD,
          status: 'active',
          openingDinar: 0,
          openingUsd: 0,
        },
      ],
    }
    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 25,
      currency: CURRENCIES.USD,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'usd-vault',
      note: '',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft, state)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('keeps incomplete telegram movement status and validation aligned with core/web', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: '',
    }

    const webMovement = postMovement(draft, state.accounts)
    const telegramMovement = await telegramMovementFor(draft)

    expect(telegramMovement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })
})
