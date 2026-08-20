import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../../src/mohammadLedger/ledgerCore.js'
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
  }
}

describe('telegram account flow', () => {
  it('creates a person account without a redundant type step', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')

    const selectedGroupSession = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(selectedGroupSession.step).toBe('owner')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('<code>2/5</code>')
    expect(ctx.telegram.calls.at(-1).payload.text).not.toContain('النوع: شخص أو جهة')

    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'شركة النور')
    const detailButtons = ctx.telegram.calls.at(-1).payload.reply_markup.inline_keyboard
      .flat()
      .filter((button) => button.callback_data?.startsWith('acct:detail:'))
    expect(detailButtons.map((button) => button.text)).toEqual(['كاش بيننا', 'شيك بيننا'])
    expect(detailButtons.every((button) => button.style === 'primary')).toBe(true)

    await handleAccountCallback(ctx, 'acct:detail:0')
    await handleAccountCallback(ctx, 'acct:currency:USD')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'شركة النور',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })
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

  it('rejects unapproved free text for a person account detail', async () => {
    const ctx = createCtx()

    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سعيد')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 57 }, 'تفصيل حر')

    const rejectedSession = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(rejectedSession.step).toBe('detail')
    expect(rejectedSession.draft.subAccountName).toBe('كاش بيننا')

    await handleAccountText({ ...ctx, isCallback: false, messageId: 58 }, 'شيك بيننا')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('currency')
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

  it('does not advance when an invalid account currency callback arrives', async () => {
    const ctx = createCtx()
    await startAccount(ctx)
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 56 }, 'سعيد')
    await handleAccountCallback(ctx, 'acct:detail:0')

    await handleAccountCallback(ctx, 'acct:currency:EUR')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('currency')
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
          ownerName: 'محمد',
          subAccountName: 'حساب',
          type: ACCOUNT_TYPES.REVIEW,
          valueKind: VALUE_KINDS.REVIEW,
          status: ACCOUNT_STATUSES.NEEDS_REVIEW,
        },
      ],
    })

    await startReviewAccount(ctx, 'review-person')
    await handleAccountCallback(ctx, 'acct:group:people')
    await handleAccountText({ ...ctx, isCallback: false, messageId: 58 }, 'محمد')
    await handleAccountCallback(ctx, 'acct:detail:1')
    await handleAccountCallback(ctx, 'acct:currency:LYD')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts).toHaveLength(1)
    expect(ctx.repository.state.accounts[0]).toMatchObject({
      id: 'review-person',
      ownerName: 'محمد',
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

  it('edits only the name when the account structure is locked by a posted movement', async () => {
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
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({ structureLocked: true, step: 'owner' })
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('النوع وطريقة التعامل والعملة ثابتة')

    await handleAccountText({ ...ctx, isCallback: false, messageId: 59 }, 'شركة سيف')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('review')
    expect(ctx.telegram.calls.at(-1).payload.text).not.toContain('لا يمكن الحفظ الآن')
    await handleAccountCallback(ctx, 'acct:confirm')

    expect(ctx.repository.state.accounts[0]).toMatchObject({
      ownerName: 'شركة سيف',
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
