import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../../src/mohammadLedger/ledgerCore.js'
import { createMohammadFallbackState } from '../../../src/mohammadLedger/ledgerState.js'
import { createSessionStore } from '../sessionStore.js'
import { createLocalizedTelegramClient } from '../localizedTelegram.js'
import { attachmentPathIsReferenced, handleMovementCallback, handleMovementMedia, handleMovementText, startMovement, startReviewMovement } from './movement.js'

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

function createCtx(language = 'ar') {
  const client = createTelegramStub()
  const telegram = language === 'en' ? createLocalizedTelegramClient(client, language) : client
  telegram.calls = client.calls
  return {
    telegram,
    repository: memoryRepository(),
    sessions: createSessionStore(),
    chatId: 278516861,
    userId: 278516861,
    messageId: 55,
    isCallback: true,
  }
}

describe('telegram movement flow safety', () => {
  it('translates attachment upload failure while preserving a colliding file name', async () => {
    const ctx = createCtx('en')
    ctx.repository.uploadAttachmentFile = async () => {
      throw new Error('upload failed')
    }
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'create',
      step: 'review',
      sessionId: 'english-upload-failure',
      uiMessageId: ctx.messageId,
      draft: {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 100,
        currency: CURRENCIES.DINAR,
        attachmentLabel: 'دخل',
        attachmentPending: { fileName: 'دخل', mimeType: 'application/pdf', buffer: Buffer.from('pdf') },
      },
    })

    await handleMovementCallback(ctx, 'mv:confirm')

    const text = ctx.telegram.calls.at(-1).payload.text
    expect(text).toContain('Attachment upload failed.')
    expect(text).toContain('Attachment: دخل')
    expect(text).toContain('The entry was not saved.')
    expect(text).not.toContain('تعذر')
  })

  it('translates a rejected review save', async () => {
    const ctx = createCtx('en')
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'review',
      step: 'review',
      sessionId: 'english-rejected-review',
      reviewMovementId: 'missing-review-entry',
      uiMessageId: ctx.messageId,
      draft: { type: MOVEMENT_TYPES.EXPENSE, amount: 100, currency: CURRENCIES.DINAR },
    })

    await handleMovementCallback(ctx, 'mv:confirm')

    expect(ctx.telegram.calls.at(-1).payload.text)
      .toBe('<b>Save failed.</b>\n<blockquote>This entry is no longer in Review.</blockquote>')
  })

  it('translates invalid callback feedback without leaving the active step', async () => {
    const ctx = createCtx('en')
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'create',
      step: 'currency',
      sessionId: 'invalid-english-currency',
      uiMessageId: ctx.messageId,
      choices: {},
      draft: { type: MOVEMENT_TYPES.TRANSFER, amount: 100, currency: '', currencyConfirmed: false },
    })

    await handleMovementCallback(ctx, 'mv:currency:EUR')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('currency')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('Choose a valid currency.')
    expect(ctx.telegram.calls.at(-1).payload.text).not.toContain('اختر عملة')
  })

  it('preserves colliding notes and generated attachment names in English review text', async () => {
    const ctx = createCtx('en')
    ctx.telegram.getFile = async () => ({ file_path: 'documents/income.pdf' })
    ctx.telegram.downloadFile = async () => Buffer.from('pdf')
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'create',
      step: 'attachment',
      sessionId: 'english-protected-data',
      uiMessageId: ctx.messageId,
      choices: {},
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        currencyConfirmed: true,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
        note: 'مالك',
      },
    })

    await handleMovementMedia(ctx, {
      document: {
        file_id: 'income-file',
        file_unique_id: 'income-file',
        file_name: 'دخل',
        mime_type: 'application/pdf',
        file_size: 3,
      },
    })

    const text = ctx.telegram.calls.at(-1).payload.text
    expect(text).toContain('<b>Note:</b> مالك')
    expect(text).toContain('<b>Attachment:</b> دخل')
    expect(text).not.toContain('<b>Attachment:</b> Income')
  })

  it('recognizes an uploaded attachment already linked to the ledger', () => {
    const storagePath = 'main/2026-08-19/receipt.pdf'
    expect(attachmentPathIsReferenced({ attachments: [{ storagePath }] }, storagePath)).toBe(true)
    expect(attachmentPathIsReferenced({ attachments: [] }, storagePath)).toBe(false)
  })

  it('deletes an unlinked uploaded attachment when the movement is cancelled', async () => {
    const ctx = createCtx()
    const deleted = []
    ctx.repository.deleteAttachmentFile = async (storagePath) => {
      deleted.push(storagePath)
      return { ok: true }
    }
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      step: 'review',
      uiMessageId: ctx.messageId,
      draft: { attachmentStoragePath: 'main/2026-08-19/orphan.pdf' },
    })

    await handleMovementCallback(ctx, 'mv:cancel')

    expect(deleted).toEqual(['main/2026-08-19/orphan.pdf'])
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
  })
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

  it('refuses callbacks that do not belong to the current movement step', async () => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.TRANSFER}`)

    await handleMovementCallback(ctx, 'mv:confirm')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('amount')
    expect(ctx.repository.state.movements).toHaveLength(createMohammadFallbackState().movements.length)
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('زر من خطوة سابقة')
  })

  it('refuses movement types that are not offered by the shared configuration', async () => {
    const ctx = createCtx()
    await startMovement(ctx)

    await handleMovementCallback(ctx, 'mv:type:unknown-type')

    const session = ctx.sessions.get(ctx.chatId, ctx.userId)
    expect(session.step).toBe('type')
    expect(session.draft.type).toBe('')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('نوع الحركة غير صالح')
  })

  it('enters the movement amount from the inline calculator', async () => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.TRANSFER}`)

    for (const key of ['1', '2', '5', '0', '0']) await handleMovementCallback(ctx, `mv:num:${key}`)

    expect(ctx.telegram.calls.at(-1).payload.text).toContain('12,500')
    await handleMovementCallback(ctx, 'mv:num:done')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({
      step: 'currency',
      draft: { amount: 12500 },
    })
  })

  it('enters a decimal exchange rate and supports delete and clear', async () => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.USD_SALE}`)
    await handleMovementCallback(ctx, 'mv:num:1')
    await handleMovementCallback(ctx, 'mv:num:0')
    await handleMovementCallback(ctx, 'mv:num:delete')
    await handleMovementCallback(ctx, 'mv:num:clear')
    await handleMovementCallback(ctx, 'mv:num:7')
    await handleMovementCallback(ctx, 'mv:num:done')

    for (const key of ['7', 'dot', '5', '5']) await handleMovementCallback(ctx, `mv:num:${key}`)
    await handleMovementCallback(ctx, 'mv:num:done')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toMatchObject({
      step: 'source',
      draft: { amount: 7, rate: 7.55 },
    })
  })

  it('shows all transfer accounts by pages and puts people first at the destination', async () => {
    const base = createMohammadFallbackState()
    const extraCashAccounts = Array.from({ length: 9 }, (_, index) => ({
      ...base.accounts.find((account) => account.id === 'me-cash'),
      id: `own-cash-${index}`,
      ownerName: 'أنا',
      subAccountName: `خزنة ${index + 1}`,
      legacyName: `أنا / خزنة ${index + 1}`,
      openingDinar: 0,
      openingUsd: 0,
      currencyKind: CURRENCIES.DINAR,
    }))
    const ctx = createCtx()
    ctx.repository = memoryRepository({ ...base, accounts: [...base.accounts, ...extraCashAccounts] })

    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.TRANSFER}`)
    await handleMovementCallback(ctx, 'mv:num:1')
    await handleMovementCallback(ctx, 'mv:num:done')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).accountPicker.pageCount).toBeGreaterThan(1)
    const firstPageIds = Object.values(ctx.sessions.get(ctx.chatId, ctx.userId).choices.source)
    await handleMovementCallback(ctx, 'mv:accounts:source:page:1')
    expect(Object.values(ctx.sessions.get(ctx.chatId, ctx.userId).choices.source)).not.toEqual(firstPageIds)
    await handleMovementCallback(ctx, 'mv:accounts:source:page:0')
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)

    const destinationIds = Object.values(ctx.sessions.get(ctx.chatId, ctx.userId).choices.destination)
    expect(new Set(destinationIds.slice(0, 3))).toEqual(new Set(['saeed-cash', 'omar-gold', 'rabee-cash']))
    expect(destinationIds).not.toContain('saeed-bank')
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
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
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
      valueKind: 'project',
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
    await handleMovementCallback(ctx, 'mv:category:skip')
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.source === 'telegram')
    expect(saved).toMatchObject({
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      sourceAccountId: 'me-cash',
      dimensionId,
    })
  })

  it('stores a telegram movement attachment as ledger attachment metadata', async () => {
    const ctx = createCtx()

    await startMovement(ctx)
    await handleMovementCallback(ctx, 'mv:type:expense')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '125')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 57 }, 'وقود')
    await handleMovementCallback(ctx, 'mv:dimension:skip')
    await handleMovementCallback(ctx, 'mv:category:skip')
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
    await handleMovementCallback(ctx, 'mv:confirm')

    expect(ctx.repository.state.attachments || []).toHaveLength(0)

    await startMovement(ctx)
    await handleMovementCallback(ctx, 'mv:type:expense')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 58 }, '130')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 59 }, 'ديزل')
    await handleMovementCallback(ctx, 'mv:dimension:skip')
    await handleMovementCallback(ctx, 'mv:category:skip')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 60 }, 'https://example.com/receipt.jpg')
    await handleMovementCallback(ctx, 'mv:recurring:monthly')
    await handleMovementCallback(ctx, 'mv:confirm')

    const movement = ctx.repository.state.movements.find((item) => item.note === 'ديزل')
    const attachment = (ctx.repository.state.attachments || []).find((item) => item.movementId === movement.id)
    expect(attachment).toMatchObject({
      label: 'https://example.com/receipt.jpg',
      url: 'https://example.com/receipt.jpg',
      source: 'telegram',
    })
    expect(ctx.repository.state.recurringRules).toHaveLength(1)
    expect(ctx.repository.state.recurringRules[0].template.note).toBe('ديزل')
  })

  it('accepts a Telegram photo and stores it in the private ledger attachment path', async () => {
    const ctx = createCtx()
    ctx.telegram.getFile = async () => ({ file_path: 'photos/receipt.jpg' })
    ctx.telegram.downloadFile = async () => Buffer.from('receipt-image')
    ctx.repository.uploadAttachmentFile = async (file) => ({
      label: file.fileName,
      storagePath: 'main/2026-08-19/receipt.jpg',
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
    })

    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.EXPENSE}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '140')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')
    await handleMovementCallback(ctx, 'mv:dimension:skip')
    await handleMovementCallback(ctx, 'mv:category:skip')
    await handleMovementMedia(ctx, {
      photo: [{ file_id: 'photo-small' }, { file_id: 'photo-large', file_unique_id: 'receipt', file_size: 13 }],
    })
    await handleMovementCallback(ctx, 'mv:recurring:no')
    await handleMovementCallback(ctx, 'mv:confirm')

    const movement = ctx.repository.state.movements.find((item) => item.source === 'telegram')
    const attachment = ctx.repository.state.attachments.find((item) => item.movementId === movement.id)
    expect(attachment).toMatchObject({
      label: 'telegram-photo-receipt.jpg',
      storagePath: 'main/2026-08-19/receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 13,
      source: 'telegram',
    })
    expect(attachment.url).toBe('')
  })

  it('offers attachment and recurrence after skipping an optional note', async () => {
    const ctx = createCtx()

    await startMovement(ctx)
    await handleMovementCallback(ctx, 'mv:type:transfer')
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '100')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, `mv:account:destination:${choiceTokenFor(ctx, 'destination', 'saeed-cash')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('attachment')
  })

  it('saves a cash deposit through the dedicated cash-to-bank route', async () => {
    const base = createMohammadFallbackState()
    const ctx = createCtx()
    ctx.repository = memoryRepository({
      ...base,
      accounts: base.accounts.filter((account) => ['me-cash', 'me-jumhouria'].includes(account.id)),
      movements: base.movements.filter((movement) => ['me-cash', 'me-jumhouria'].includes(movement.destinationAccountId)),
    })

    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.CASH_DEPOSIT}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '500')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, `mv:account:destination:${choiceTokenFor(ctx, 'destination', 'me-jumhouria')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.type === MOVEMENT_TYPES.CASH_DEPOSIT)
    expect(saved).toMatchObject({
      status: MOVEMENT_STATUSES.POSTED,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'me-jumhouria',
      amount: 500,
    })
  })

  it('stores an expense category selected in the bot', async () => {
    const ctx = createCtx()

    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.EXPENSE}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '100')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', 'me-cash')}`)
    await handleMovementCallback(ctx, 'mv:note:skip')
    await handleMovementCallback(ctx, 'mv:dimension:skip')
    const categorySession = ctx.sessions.get(ctx.chatId, ctx.userId)
    const [categoryToken, categoryId] = Object.entries(categorySession.choices.category)[0]
    await handleMovementCallback(ctx, `mv:category:${categoryToken}`)
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.source === 'telegram')
    expect(saved.expenseCategoryId).toBe(categoryId)
  })

  it.each([
    [MOVEMENT_TYPES.TRANSFER, 'currency'],
    [MOVEMENT_TYPES.EXPENSE, 'currency'],
    [MOVEMENT_TYPES.CASH_DEPOSIT, 'currency'],
    [MOVEMENT_TYPES.CASH_WITHDRAWAL, 'currency'],
    [MOVEMENT_TYPES.EXTERNAL_INCOME, 'currency'],
    [MOVEMENT_TYPES.USD_SALE, 'rate'],
    [MOVEMENT_TYPES.USD_PURCHASE, 'rate'],
  ])('routes %s through the expected step after amount', async (type, expectedStep) => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${type}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '250')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe(expectedStep)
  })

  it.each([
    { type: MOVEMENT_TYPES.TRANSFER, amount: '100', currency: CURRENCIES.DINAR, source: 'me-cash', destination: 'saeed-cash' },
    { type: MOVEMENT_TYPES.EXPENSE, amount: '100', currency: CURRENCIES.DINAR, source: 'me-cash' },
    { type: MOVEMENT_TYPES.CASH_DEPOSIT, amount: '100', currency: CURRENCIES.DINAR, source: 'me-cash', destination: 'me-jumhouria' },
    { type: MOVEMENT_TYPES.CASH_WITHDRAWAL, amount: '100', currency: CURRENCIES.DINAR, source: 'me-jumhouria', destination: 'me-cash' },
    { type: MOVEMENT_TYPES.EXTERNAL_INCOME, amount: '100', currency: CURRENCIES.DINAR, destination: 'me-cash' },
    { type: MOVEMENT_TYPES.USD_SALE, amount: '10', rate: '7.5', source: 'me-cash', destination: 'me-jumhouria' },
    { type: MOVEMENT_TYPES.USD_PURCHASE, amount: '75', rate: '7.5', source: 'me-jumhouria', destination: 'me-cash' },
  ])('completes and posts the full $type bot path', async ({ type, amount, currency, rate, source, destination }) => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${type}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, amount)

    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'currency') {
      await handleMovementCallback(ctx, `mv:currency:${currency}`)
    }
    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'rate') {
      await handleMovementText({ ...ctx, isCallback: false, messageId: 57 }, rate)
    }
    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'source') {
      await handleMovementCallback(ctx, `mv:account:source:${choiceTokenFor(ctx, 'source', source)}`)
    }
    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'destination') {
      await handleMovementCallback(ctx, `mv:account:destination:${choiceTokenFor(ctx, 'destination', destination)}`)
    }

    await handleMovementCallback(ctx, 'mv:note:skip')
    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'dimension') await handleMovementCallback(ctx, 'mv:dimension:skip')
    if (ctx.sessions.get(ctx.chatId, ctx.userId).step === 'category') await handleMovementCallback(ctx, 'mv:category:skip')
    await handleMovementCallback(ctx, 'mv:attachment:skip')
    await handleMovementCallback(ctx, 'mv:recurring:no')
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('review')

    await handleMovementCallback(ctx, 'mv:confirm')

    const saved = ctx.repository.state.movements.find((movement) => movement.source === 'telegram')
    expect(saved).toMatchObject({ type, status: MOVEMENT_STATUSES.POSTED })
    expect(ctx.sessions.get(ctx.chatId, ctx.userId)).toBe(null)
  })

  it.each([
    ['amount', 'type'],
    ['currency', 'amount'],
    ['source', 'currency'],
    ['destination', 'source'],
    ['note', 'destination'],
    ['attachment', 'note'],
    ['recurring', 'attachment'],
    ['review', 'recurring'],
  ])('returns safely from %s to %s', async (step, expectedStep) => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'create',
      step,
      sessionId: `back-${step}`,
      uiMessageId: ctx.messageId,
      choices: {},
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 250,
        currency: CURRENCIES.DINAR,
        currencyConfirmed: true,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
        note: '',
        recurringEnabled: false,
      },
    })

    await handleMovementCallback(ctx, 'mv:back')

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe(expectedStep)
  })

  it('keeps unexpected text inside the active button step without opening another menu', async () => {
    const ctx = createCtx()
    await startMovement(ctx)

    const handled = await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, 'نص غير متوقع')

    expect(handled).toBe(true)
    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe('type')
    expect(ctx.telegram.calls.at(-1).payload.text).toContain('اختر من الأزرار')
    expect(ctx.telegram.calls.at(-1).payload.text).not.toContain('افتح ADREEM من /start')
  })

  it.each([
    ['currency', 'mv:currency:EUR', 'currency'],
    ['dimension', 'mv:dimension:missing', 'dimension'],
    ['category', 'mv:category:missing', 'category'],
    ['recurring', 'mv:recurring:weekly', 'recurring'],
  ])('does not advance %s when callback data is invalid', async (step, callbackData, expectedStep) => {
    const ctx = createCtx()
    ctx.sessions.set(ctx.chatId, ctx.userId, {
      flow: 'movement',
      mode: 'create',
      step,
      sessionId: `invalid-${step}`,
      uiMessageId: ctx.messageId,
      choices: { dimension: {}, category: {} },
      draft: {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 100,
        currency: CURRENCIES.DINAR,
        currencyConfirmed: step !== 'currency',
        sourceAccountId: 'me-cash',
        destinationAccountId: '',
        note: '',
        dimensionId: '',
        expenseCategoryId: '',
        recurringEnabled: false,
      },
    })

    await handleMovementCallback(ctx, callbackData)

    expect(ctx.sessions.get(ctx.chatId, ctx.userId).step).toBe(expectedStep)
    expect(ctx.repository.state.movements).toHaveLength(createMohammadFallbackState().movements.length)
  })

  it('shows account search as one compact question without repeated instructions', async () => {
    const ctx = createCtx()
    await startMovement(ctx)
    await handleMovementCallback(ctx, `mv:type:${MOVEMENT_TYPES.TRANSFER}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 56 }, '250')
    await handleMovementCallback(ctx, `mv:currency:${CURRENCIES.DINAR}`)
    await handleMovementText({ ...ctx, isCallback: false, messageId: 57 }, 'أنا')

    const text = ctx.telegram.calls.at(-1).payload.text
    expect(text.match(/من أين تخرج الفلوس؟/gu)).toHaveLength(1)
    expect(text).toContain('بحث:')
    expect(text).not.toContain('اختيارات مناسبة')
    expect(text).not.toContain('اضغط على الحساب')
  })
})

function choiceTokenFor(ctx, role, accountId) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  const entry = Object.entries(session?.choices?.[role] || {}).find(([, id]) => id === accountId)
  if (!entry) throw new Error(`Missing ${role} choice for ${accountId}`)
  return entry[0]
}
