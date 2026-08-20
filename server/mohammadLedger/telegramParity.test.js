import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  postMovement,
} from '../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import { voidRecentMovementInState } from '../telegram/historyActions.js'
import { appendTelegramMovement, resolveTelegramReviewMovement, telegramUpdateIdempotencyKey } from './ledgerService.js'

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

    const webMovement = postMovement(draft, state.accounts, state.movements)
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

    const webMovement = postMovement(draft, state.accounts, state.movements)
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

    const webMovement = postMovement(draft, state.accounts, state.movements)
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

    const webMovement = postMovement(draft, state.accounts, state.movements)
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

    const webMovement = postMovement(draft, state.accounts, state.movements)
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

    const webMovement = postMovement(draft, state.accounts, state.movements)
    const telegramMovement = await telegramMovementFor(draft)

    expect(telegramMovement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it.each([
    {
      name: 'cash deposit',
      draft: {
        type: MOVEMENT_TYPES.CASH_DEPOSIT,
        amount: 400,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
        note: '',
      },
    },
    {
      name: 'cash withdrawal',
      draft: {
        type: MOVEMENT_TYPES.CASH_WITHDRAWAL,
        amount: 300,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-cash',
        note: '',
      },
    },
    {
      name: 'external income',
      draft: {
        type: MOVEMENT_TYPES.EXTERNAL_INCOME,
        amount: 700,
        currency: CURRENCIES.DINAR,
        sourceAccountId: '',
        destinationAccountId: 'me-cash',
        note: '',
      },
    },
    {
      name: 'insufficient own cash',
      draft: {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 100_000,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: '',
        note: '',
      },
    },
    {
      name: 'same logical account transfer',
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'saeed-cash',
        destinationAccountId: 'saeed-cash',
        note: '',
      },
    },
    {
      name: 'wrong sale source currency',
      draft: {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-cash',
        rate: 7.5,
        note: '',
      },
    },
  ])('keeps $name validation and effects identical to core/web', async ({ draft }) => {
    const state = createMohammadFallbackState()
    const webMovement = postMovement(draft, state.accounts, state.movements)
    const telegramMovement = await telegramMovementFor(draft, state)

    expect(comparableMovement(telegramMovement)).toEqual(comparableMovement(webMovement))
  })

  it('does not change balances when both web and bot route an unsafe movement to review', async () => {
    const state = createMohammadFallbackState()
    const draft = {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 100_000,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: '',
    }
    const repository = memoryRepository(state)
    const result = await appendTelegramMovement(repository, draft, {
      idempotencyKey: 'unsafe-own-cash',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(result.movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(buildPostingEntries(result.movement)).toEqual([])
    expect(repository.state.movements).toHaveLength(state.movements.length + 1)
  })

  it('records the same movement creation audit event as the web path', async () => {
    const state = createMohammadFallbackState()
    const repository = memoryRepository(state)
    const idempotencyKey = telegramUpdateIdempotencyKey(8300, 'movement-create')
    const result = await appendTelegramMovement(repository, {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 90,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: 'وقود',
    }, {
      idempotencyKey,
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(repository.state.auditEvents.at(-1)).toMatchObject({
      action: 'movement.created',
      details: {
        movementId: result.movement.id,
        status: result.movement.status,
        telegramIdempotencyKey: idempotencyKey,
      },
    })

    await appendTelegramMovement(repository, {}, {
      idempotencyKey,
      telegramUserId: 1,
      telegramChatId: 1,
    })
    expect(repository.state.auditEvents).toHaveLength(state.auditEvents.length + 1)
  })

  it('records the same movement update audit event as the web path', async () => {
    const state = createMohammadFallbackState()
    const repository = memoryRepository(state)
    const created = await appendTelegramMovement(repository, {
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: '',
    }, {
      idempotencyKey: 'audit-review',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    const idempotencyKey = telegramUpdateIdempotencyKey(8301, 'movement-review')
    const result = await resolveTelegramReviewMovement(repository, created.movement.id, {
      destinationAccountId: 'saeed-cash',
    }, {
      idempotencyKey,
      telegramUserId: 1,
      telegramChatId: 1,
    })

    expect(result.movement.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(repository.state.auditEvents.at(-1)).toMatchObject({
      action: 'movement.updated',
      details: {
        movementId: created.movement.id,
        status: MOVEMENT_STATUSES.POSTED,
        telegramIdempotencyKey: idempotencyKey,
      },
    })
  })

  it('records movement cancellation with the same audit shape as a web update', async () => {
    const state = createMohammadFallbackState()
    const repository = memoryRepository(state)
    const created = await appendTelegramMovement(repository, {
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 90,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: '',
      note: 'وقود',
    }, {
      idempotencyKey: 'audit-cancel',
      telegramUserId: 1,
      telegramChatId: 1,
    })

    const idempotencyKey = telegramUpdateIdempotencyKey(8302, 'movement-cancel')
    const result = voidRecentMovementInState(
      repository.state,
      created.movement.id,
      new Date().toISOString(),
      { idempotencyKey },
    )

    expect(result.ok).toBe(true)
    expect(result.state.auditEvents.at(-1)).toMatchObject({
      action: 'movement.updated',
      details: {
        movementId: created.movement.id,
        status: MOVEMENT_STATUSES.VOIDED,
        telegramIdempotencyKey: idempotencyKey,
      },
    })
  })
})
