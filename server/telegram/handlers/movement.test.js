import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../../src/mohammadLedger/ledgerState.js'
import { createSessionStore } from '../sessionStore.js'
import { handleMovementCallback, handleMovementText, startMovement, startReviewMovement } from './movement.js'

function memoryRepository(initialState = createMohammadFallbackState()) {
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

function createTelegramStub() {
  const calls = []
  return {
    calls,
    async sendMessage(payload) {
      calls.push({ method: 'sendMessage', payload })
      return { message_id: 101 }
    },
    async editMessageText(payload) {
      calls.push({ method: 'editMessageText', payload })
      return { message_id: payload.message_id }
    },
  }
}

function createCtx() {
  return {
    telegram: createTelegramStub(),
    repository: memoryRepository(),
    sessions: createSessionStore(),
    chatId: 278516861,
    userId: 278516861,
    messageId: 55,
    isCallback: true,
  }
}

describe('telegram movement flow safety', () => {
  it('does not start a new movement flow from an expired movement button', async () => {
    const ctx = createCtx()

    await handleMovementCallback(ctx, 'mv:confirm')

    expect(ctx.repository.state.movements).toHaveLength(createMohammadFallbackState().movements.length)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('does not overwrite an active account flow when an old movement button is pressed', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, { flow: 'account', step: 'owner', draft: { ownerName: '' } })

    await handleMovementCallback(ctx, 'mv:type:transfer')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('account')
    expect(session.step).toBe('owner')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('ignores stale movement buttons from an older movement control card', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      step: 'amount',
      uiMessageId: 777,
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 0,
        currency: '',
        currencyConfirmed: false,
        sourceAccountId: '',
        destinationAccountId: '',
      },
      choices: {},
    })

    await handleMovementCallback({ ...ctx, messageId: 55 }, 'mv:type:expense')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('movement')
    expect(session.step).toBe('amount')
    expect(session.draft.type).toBe(MOVEMENT_TYPES.TRANSFER)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('clears the chat flow and saves incomplete confirmed movements into review', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      step: 'review',
      sessionId: 'needs-review-session',
      uiMessageId: 55,
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        currencyConfirmed: true,
        sourceAccountId: 'me-cash',
        destinationAccountId: '',
        rate: undefined,
        note: '',
      },
      choices: {},
    })

    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.idempotencyKey === `${ctx.userId}-needs-review-session`)
    expect(saved.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم حفظها في المراجعة')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('ستظهر في قسم المراجعة')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('لا تغير الأرصدة قبل الاعتماد')
  })

  it('skips the source step for external income and asks directly for the destination account', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      step: 'amount',
      sessionId: 'income-session',
      uiMessageId: 55,
      draft: {
        type: MOVEMENT_TYPES.EXTERNAL_INCOME,
        amount: 0,
        currency: '',
        currencyConfirmed: false,
        sourceAccountId: '',
        destinationAccountId: '',
        rate: undefined,
        note: '',
      },
      choices: {},
    })

    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '100')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('destination')
    expect(session.draft.sourceAccountId).toBe('')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('أين دخلت الفلوس')
  })

  it('resolves a review movement through the same movement wizard', async () => {
    const initialState = createMohammadFallbackState()
    const ctx = createCtx()
    ctx.repository = memoryRepository({
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
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    await startReviewMovement(ctx, 'review-transfer')
    await handleMovementCallback(ctx, 'mv:type:transfer')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '100')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, `mv:account:destination:${choiceTokenFor(ctx, 'destination', 'saeed-cash')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')
    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.filter((movement) => movement.id === 'review-transfer')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: 'saeed-cash',
      reviewSource: 'telegram',
    })
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم إصلاح الحركة')
  })

  it('links supported movements to a project dimension when selected', async () => {
    const base = createMohammadFallbackState()
    const meCash = base.accounts.find((account) => account.id === 'me-cash')
    const truckProject = {
      id: 'truck-project',
      ownerName: 'شاحنة العمل',
      subAccountName: 'مشروع',
      type: 'project',
      valueKind: 'asset',
      currencyKind: CURRENCIES.DINAR,
      status: 'active',
    }
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...base,
      accounts: [meCash, truckProject],
      movements: base.movements.filter((movement) =>
        movement.sourceAccountId === 'me-cash' || movement.destinationAccountId === 'me-cash',
      ),
    })

    await startMovement(ctx)
    await handleMovementCallback(ctx, 'mv:type:expense')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '250')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')

    const dimensionId = 'dimension-account-truck-project'
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('dimension')
    await handleMovementCallback(ctx, `mv:dimension:${choiceTokenFor(ctx, 'dimension', dimensionId)}`)
    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.source === 'telegram')
    expect(saved).toMatchObject({
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      sourceAccountId: 'me-cash',
      dimensionId,
    })
  })
})

function choiceTokenFor(ctx, role, accountId) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  const entry = Object.entries(session?.choices?.[role] || {}).find(([, id]) => id === accountId)
  if (!entry) throw new Error(`Missing ${role} choice for ${accountId}`)
  return entry[0]
}
