import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../../src/mohammadLedger/ledgerState.js'
import { createSessionStore } from '../sessionStore.js'
import { handleReconciliationCallback, handleReconciliationText, startReconciliation } from './reconciliation.js'

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

describe('telegram reconciliation flow', () => {
  it('creates a correction from actual balance after confirmation', async () => {
    const ctx = createCtx()

    await startReconciliation(ctx)
    await handleReconciliationCallback(ctx, `rec:account:${choiceTokenFor(ctx, 'me-cash')}`)
    await handleReconciliationCallback(ctx, `rec:currency:${CURRENCIES.DINAR}`)
    await handleReconciliationText({ ...ctx, isCallback: false, messageId: 56 }, '47000')
    await handleReconciliationText({ ...ctx, isCallback: false, messageId: 57 }, 'عد الصندوق')
    await handleReconciliationCallback(ctx, 'rec:confirm')

    expect(ctx.repository.state.reconciliations).toHaveLength(1)
    const reconciliation = ctx.repository.state.reconciliations[0]
    expect(reconciliation).toMatchObject({
      accountId: 'me-cash',
      actualDinar: 47000,
      note: 'عد الصندوق',
      source: 'telegram',
    })
    const corrections = ctx.repository.state.movements.filter((movement) => movement.reconciliationId === reconciliation.id)
    expect(corrections).toHaveLength(1)
    expect(corrections[0]).toMatchObject({
      type: MOVEMENT_TYPES.CORRECTION,
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: 'me-cash',
    })
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم حفظ المطابقة')
  })

  it('stores a zero-diff reconciliation without a correction movement', async () => {
    const ctx = createCtx()
    const expected = Math.round(ctx.repository.state.movements
      .filter((movement) => movement.destinationAccountId === 'me-cash' || movement.sourceAccountId === 'me-cash')
      .reduce((total, movement) => {
        if (movement.status !== MOVEMENT_STATUSES.POSTED) return total
        if (movement.destinationAccountId === 'me-cash') return total + Number(movement.amount || 0)
        if (movement.sourceAccountId === 'me-cash') return total - Number(movement.amount || 0)
        return total
      }, 0))

    await startReconciliation(ctx)
    await handleReconciliationCallback(ctx, `rec:account:${choiceTokenFor(ctx, 'me-cash')}`)
    await handleReconciliationCallback(ctx, `rec:currency:${CURRENCIES.DINAR}`)
    await handleReconciliationText({ ...ctx, isCallback: false, messageId: 56 }, String(expected))
    await handleReconciliationText({ ...ctx, isCallback: false, messageId: 57 }, 'مطابقة يومية')
    await handleReconciliationCallback(ctx, 'rec:confirm')

    const reconciliation = ctx.repository.state.reconciliations[0]
    expect(reconciliation.diffDinar).toBe(0)
    expect(ctx.repository.state.movements.filter((movement) => movement.reconciliationId === reconciliation.id)).toHaveLength(0)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('بدون تصحيح')
  })

  it('does not hijack another active flow from an old reconciliation button', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, { flow: 'movement', step: 'amount', draft: { amount: 0 } })

    await handleReconciliationCallback(ctx, 'rec:confirm')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).flow).toBe('movement')
    expect(ctx.repository.state.reconciliations).toHaveLength(0)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('مطابقة قديمة')
  })
})

function choiceTokenFor(ctx, accountId) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  const entries = Object.entries(session.choices?.account || {})
  const found = entries.find(([, id]) => id === accountId)
  if (!found) throw new Error(`Missing choice for ${accountId}`)
  return found[0]
}
