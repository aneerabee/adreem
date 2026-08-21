import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  createAccount,
  createOpeningMovements,
  postMovement,
} from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { ACCOUNT_OPENING_DIRECTIONS, COUNTERPARTY_ACCOUNT_KINDS, accountOpeningAmounts, emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
import { buildCounterpartyAccountBundle, buildCounterpartyOpeningMovements } from '../../src/mohammadLedger/counterpartyAccounts.js'
import { createEmptyAdreemState, createMohammadFallbackState } from '../../src/mohammadLedger/ledgerState.js'
import { voidRecentMovementInState } from '../telegram/historyActions.js'
import { appendTelegramAccount } from './accountService.js'
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
  it('creates the identical three-channel person bundle in web and Telegram', async () => {
    const draft = {
      ...emptyAccountDraft(),
      ownerName: 'شركة النور',
      counterpartyOpenings: {
        ...emptyAccountDraft().counterpartyOpenings,
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR]: { amount: '800', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
        [COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR]: { amount: '250', direction: ACCOUNT_OPENING_DIRECTIONS.I_OWE },
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD]: { amount: '60', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
      },
    }
    const webAccounts = buildCounterpartyAccountBundle(draft)
    const webOpening = buildCounterpartyOpeningMovements(webAccounts)
    const repository = memoryRepository(createEmptyAdreemState())
    const telegram = await appendTelegramAccount(repository, draft, { idempotencyKey: 'bundle-parity' })
    const comparableAccount = (account) => ({
      ownerName: account.ownerName,
      subAccountName: account.subAccountName,
      type: account.type,
      valueKind: account.valueKind,
      currencyKind: account.currencyKind,
      counterpartyKind: account.counterpartyKind,
      openingDinar: account.openingDinar,
      openingUsd: account.openingUsd,
    })

    expect(telegram.accounts.map(comparableAccount)).toEqual(webAccounts.map(comparableAccount))
    expect(telegram.openingMovements.map(comparableMovement)).toEqual(webOpening.movements.map(comparableMovement))
  })

  it('keeps identical person bundles isolated when two users use separate ledger repositories', async () => {
    const firstLedger = memoryRepository(createEmptyAdreemState(undefined, { ledgerId: 'owner-a' }))
    const secondLedger = memoryRepository(createEmptyAdreemState(undefined, { ledgerId: 'owner-b' }))
    const firstDraft = {
      ...emptyAccountDraft(),
      ownerName: 'شركة النور',
      counterpartyOpenings: {
        ...emptyAccountDraft().counterpartyOpenings,
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR]: { amount: '900', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
      },
    }
    const secondDraft = {
      ...emptyAccountDraft(),
      ownerName: 'شركة النور',
      counterpartyOpenings: {
        ...emptyAccountDraft().counterpartyOpenings,
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD]: { amount: '40', direction: ACCOUNT_OPENING_DIRECTIONS.I_OWE },
      },
    }

    await appendTelegramAccount(firstLedger, firstDraft, { idempotencyKey: 'same-update-key' })
    expect(secondLedger.state.accounts).toHaveLength(0)
    expect(secondLedger.state.movements).toHaveLength(0)
    expect(secondLedger.state.auditEvents).toHaveLength(0)

    await appendTelegramAccount(secondLedger, secondDraft, { idempotencyKey: 'same-update-key' })
    expect(firstLedger.state.ledgerId).toBe('owner-a')
    expect(secondLedger.state.ledgerId).toBe('owner-b')
    expect(firstLedger.state.accounts).toHaveLength(3)
    expect(secondLedger.state.accounts).toHaveLength(3)
    expect(firstLedger.state.movements).toHaveLength(1)
    expect(secondLedger.state.movements).toHaveLength(1)
    expect(firstLedger.state.movements[0]).toMatchObject({ currency: CURRENCIES.DINAR, amount: 900 })
    expect(secondLedger.state.movements[0]).toMatchObject({ currency: CURRENCIES.USD, amount: -40 })
  })

  it('creates the same opening account and balance from web and Telegram inputs', async () => {
    const draft = {
      ownerName: 'مو إدريس',
      subAccountName: 'شيك بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
      openingBalanceAmount: '1,250',
      openingBalanceDirection: 'i_owe',
    }
    const webAccount = createAccount({ ...draft, ...accountOpeningAmounts(draft) })
    const webOpening = createOpeningMovements([webAccount], webAccount.createdAt)
    const repository = memoryRepository(createEmptyAdreemState())
    const telegram = await appendTelegramAccount(repository, draft, { idempotencyKey: 'opening-parity' })

    expect(telegram.account).toMatchObject({
      ownerName: webAccount.ownerName,
      subAccountName: webAccount.subAccountName,
      currencyKind: webAccount.currencyKind,
      openingDinar: webAccount.openingDinar,
      openingUsd: webAccount.openingUsd,
    })
    expect(telegram.openingMovements.map(comparableMovement)).toEqual(webOpening.map(comparableMovement))
  })
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
