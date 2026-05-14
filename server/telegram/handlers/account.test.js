import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from '../../../src/mohammadLedger/accountCatalog.js'
import { createSessionStore } from '../sessionStore.js'
import { handleAccountCallback, handleAccountText, startAccount } from './account.js'

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

function createTelegramStub() {
  let messageId = 100
  const calls = []
  return {
    calls,
    async sendMessage(payload) {
      calls.push({ method: 'sendMessage', payload })
      messageId += 1
      return { message_id: messageId }
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

describe('telegram account flow', () => {
  it('creates an account through type, name, detail, and confirmation steps', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:type:person-cash')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سعيد')
    await handleAccountCallback(ctx, 'acct:detail:0')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
    })
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
  })

  it('keeps back navigation inside the account flow without touching movement sessions', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:type:own-bank')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 57 }, 'أنا')
    await handleAccountCallback(ctx, 'acct:back')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('account')
    expect(session.step).toBe('owner')
    expect(session.draft).toMatchObject({
      ownerName: 'أنا',
      type: ACCOUNT_TYPES.BANK,
      valueKind: VALUE_KINDS.BANK,
    })
  })
})
