import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../../src/ledger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../../src/ledger/ledgerCore.js'
import { createSessionStore } from '../sessionStore.js'
import { handleAccountCallback, handleAccountText, startAccount, startEditAccount, startReviewAccount } from './account.js'

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
    updateId: 7002,
  }
}

describe('telegram account flow', () => {
  it('creates a person account without a redundant type step', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')

    const selectedGroupSession = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(selectedGroupSession.step).toBe('owner')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('<code>2/4</code>')
    expect(ctx.telegram.calls.at(-1).payload.text).not.toContain('النوع: شخص أو جهة')

    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'شركة النور')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('opening')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('رصيد دينار كاش')
    for (let index = 0; index < 3; index += 1) await handleAccountCallback(ctx, 'acct:num:done')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(3)
    expect(ctx.repository.state.accounts.map((account) => [account.ownerName, account.subAccountName, account.currencyKind])).toEqual([
      ['شركة النور', 'كاش بيننا', ACCOUNT_CURRENCY_KINDS.DINAR],
      ['شركة النور', 'شيك بيننا', ACCOUNT_CURRENCY_KINDS.DINAR],
      ['شركة النور', 'دولار بيننا', ACCOUNT_CURRENCY_KINDS.USD],
    ])
    expect(new Set(ctx.repository.state.accounts.map((account) => account.counterpartyId)).size).toBe(1)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
  })

  it('returns from the person name directly to the group choice', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountCallback(ctx, 'acct:back')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('group')
  })

  it('keeps unexpected free text inside the first opening balance step', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سعيد')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 57 }, 'تفصيل حر')

    const rejectedSession = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(rejectedSession.step).toBe('opening')
    expect(rejectedSession.bundleOpeningIndex).toBe(0)
    expect(rejectedSession.draft.counterpartyOpenings['cash-dinar'].amount).toBe('')
  })

  it('keeps back navigation inside the account flow without touching movement sessions', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:money')
    await handleAccountCallback(ctx, 'acct:type:own-bank')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 57 }, 'الجمهورية')
    await handleAccountCallback(ctx, 'acct:back')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('account')
    expect(session.step).toBe('owner')
    expect(session.draft).toMatchObject({
      ownerName: 'أنا',
      subAccountName: 'الجمهورية',
      type: ACCOUNT_TYPES.BANK,
      valueKind: VALUE_KINDS.BANK,
    })
  })

  it('creates my bank account without showing unrelated detail choices', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:money')
    await handleAccountCallback(ctx, 'acct:type:own-bank')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 57 }, 'الجمهورية')
    await handleAccountCallback(ctx, 'acct:currency:LYD')
    await handleAccountCallback(ctx, 'acct:num:done')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'أنا',
      subAccountName: 'الجمهورية',
      type: ACCOUNT_TYPES.BANK,
      valueKind: VALUE_KINDS.BANK,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
  })

  it('creates a person opening debt through the calculator and explicit direction', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'مو إدريس')
    await handleAccountCallback(ctx, 'acct:num:done')
    await handleAccountCallback(ctx, 'acct:num:done')
    for (const key of ['1', '2', '5', '0']) await handleAccountCallback(ctx, `acct:num:${key}`)
    await handleAccountCallback(ctx, 'acct:num:done')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({ step: 'direction', openingBuffer: '1250' })
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('لمن الرصيد')

    await handleAccountCallback(ctx, 'acct:opening-direction:i_owe')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عليّ له')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(3)
    expect(ctx.repository.state.accounts[2]).toMatchObject({ openingDinar: 0, openingUsd: -1_250 })
    expect(ctx.repository.state.movements).toHaveLength(1)
    expect(ctx.repository.state.movements[0]).toMatchObject({
      type: MOVEMENT_TYPES.OPENING_BALANCE,
      amount: -1_250,
      currency: CURRENCIES.USD,
    })
  })

  it('returns safely through the opening balance steps without losing the amount', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سيف')
    for (const key of ['5', '0', '0']) await handleAccountCallback(ctx, `acct:num:${key}`)
    await handleAccountCallback(ctx, 'acct:num:done')

    const directionButtons = ctx.telegram.calls.at(-1).payload.reply_markup.inline_keyboard.flat()
    expect(directionButtons.filter((button) => button.callback_data?.startsWith('acct:opening-direction:')).every((button) => !button.text.startsWith('✓'))).toBe(true)

    await handleAccountCallback(ctx, 'acct:back')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({ step: 'opening', openingBuffer: '500' })
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('500 د.ل')

    await handleAccountCallback(ctx, 'acct:cancel')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.repository.state.accounts).toEqual([])
    expect(ctx.repository.state.movements).toEqual([])
  })

  it('creates a project tracking account without treating it as a posting party yet', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:tracking')
    await handleAccountCallback(ctx, 'acct:type:project')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 58 }, 'شاحنة العمل')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'شاحنة العمل',
      subAccountName: 'مشروع',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.PROJECT,
    })
  })

  it('does not start a new account flow from an expired account button', async () => {
    const ctx = createCtx()

    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(0)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('does not let an old button jump across account steps', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:type:own-bank')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('group')
    expect(session.draft.valueKind).toBe(VALUE_KINDS.RECEIVABLE)
  })

  it('ignores an outdated currency callback for an automatic person bundle', async () => {
    const ctx = createCtx()
    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سعيد')
    await handleAccountCallback(ctx, 'acct:detail:0')

    await handleAccountCallback(ctx, 'acct:currency:EUR')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('opening')
    expect(session.draft.currencyKind).not.toBe('EUR')
    expect(ctx.repository.state.accounts).toHaveLength(0)
  })

  it('does not overwrite an active movement flow when an old account button is pressed', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, { flow: 'movement', step: 'amount', draft: { amount: 0 } })

    await handleAccountCallback(ctx, 'acct:type:person-cash')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('movement')
    expect(session.step).toBe('amount')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('ignores stale account buttons from an older account control card', async () => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'account',
      step: 'owner',
      uiMessageId: 777,
      draft: { ownerName: '', subAccountName: 'كاش', type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE },
    })

    await handleAccountCallback({ ...ctx, messageId: 55 }, 'acct:type:own-bank')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.flow).toBe('account')
    expect(session.step).toBe('owner')
    expect(session.draft.type).toBe(ACCOUNT_TYPES.PERSON)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('عملية قديمة')
  })

  it('resolves a review account through the same account wizard', async () => {
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...emptyState(),
      accounts: [
        {
          id: 'review-person',
          ownerName: 'أحمد',
          subAccountName: 'حساب',
          type: ACCOUNT_TYPES.REVIEW,
          valueKind: VALUE_KINDS.REVIEW,
          status: ACCOUNT_STATUSES.NEEDS_REVIEW,
        },
      ],
    })

    await startReviewAccount(ctx, 'review-person')
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 58 }, 'أحمد')
    await handleAccountCallback(ctx, 'acct:detail:1')
    await handleAccountCallback(ctx, 'acct:currency:LYD')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      id: 'review-person',
      ownerName: 'أحمد',
      subAccountName: 'شيك بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      status: ACCOUNT_STATUSES.ACTIVE,
      reviewSource: 'telegram',
    })
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم إصلاح الحساب')
  })

  it('keeps the original classification while opening an account for review', async () => {
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...emptyState(),
      accounts: [{
        id: 'review-asset',
        ownerName: 'الشاحنة',
        subAccountName: 'أصل',
        type: ACCOUNT_TYPES.ASSET,
        valueKind: VALUE_KINDS.ASSET,
        currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
        status: ACCOUNT_STATUSES.NEEDS_REVIEW,
      }],
    })

    await startReviewAccount(ctx, 'review-asset')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('group')
    expect(session.presetGroup).toBe('tracking')
    expect(session.draft).toMatchObject({
      type: ACCOUNT_TYPES.ASSET,
      valueKind: VALUE_KINDS.ASSET,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })
  })

  it('edits an active account from its current name and records the change', async () => {
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...emptyState(),
      accounts: [{
        id: 'active-person',
        ownerName: 'سعيد',
        subAccountName: 'كاش بيننا',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
        status: ACCOUNT_STATUSES.ACTIVE,
      }],
      auditEvents: [],
    })

    await startEditAccount(ctx, 'active-person')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({ mode: 'edit', step: 'owner', editAccountId: 'active-person' })
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('ADREEM · تعديل حساب')

    await handleAccountText({ ...ctx, isCallback: false, messageId: 58 }, 'شركة سعيد')
    await handleAccountCallback(ctx, 'acct:detail:1')
    await handleAccountCallback(ctx, 'acct:currency:USD')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'شركة سعيد',
      subAccountName: 'شيك بيننا',
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })
    expect(ctx.repository.state.auditEvents).toHaveLength(1)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم تعديل الحساب وحفظ السجل')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
  })

  it('cancels account editing without changing the account', async () => {
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...emptyState(),
      accounts: [{
        id: 'active-cash',
        ownerName: 'أنا',
        subAccountName: 'الخزنة',
        type: ACCOUNT_TYPES.CASH,
        valueKind: VALUE_KINDS.CASH,
        currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
        status: ACCOUNT_STATUSES.ACTIVE,
      }],
    })

    await startEditAccount(ctx, 'active-cash')
    await handleAccountCallback(ctx, 'acct:cancel')

    expect(ctx.repository.state.accounts[0].subAccountName).toBe('الخزنة')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('تم إلغاء تعديل الحساب')
  })

  it('refuses to edit any account data after a posted movement', async () => {
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...emptyState(),
      accounts: [{
        id: 'used-person',
        ownerName: 'سيف',
        subAccountName: 'كاش بيننا',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
        status: ACCOUNT_STATUSES.ACTIVE,
      }],
      movements: [{
        id: 'used-transfer',
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        amount: 100,
        currency: CURRENCIES.DINAR,
        destinationAccountId: 'used-person',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-20T10:00:00.000Z',
      }],
      auditEvents: [],
    })

    await startEditAccount(ctx, 'used-person')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('هذا الحساب ثابت بعد أول حركة')

    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
  })

  it('keeps unexpected text inside an account button step', async () => {
    const ctx = createCtx()
    await startAccount(ctx)

    const handled = await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'نص غير متوقع')

    expect(handled).toBe(true)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('group')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('ماذا تريد أن تضيف')
  })
})
