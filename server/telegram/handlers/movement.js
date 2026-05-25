import { randomUUID } from 'node:crypto'
import { CURRENCIES } from '../../../src/mohammadLedger/ledgerCore.js'
import {
  movementConfigFor,
  movementCurrencyFor,
  movementLabels,
  movementNeedsDestination,
  movementNeedsRate,
  movementPreferredAccountIds,
} from '../../../src/mohammadLedger/movementConfig.js'
import {
  appendTelegramMovement,
  buildLedgerSnapshot,
  formatMoney,
  getMovementAccounts,
  parseAmountText,
  previewDraft,
  rankAccountsForTelegram,
} from '../../mohammadLedger/ledgerService.js'
import {
  accountChoicesKeyboard,
  accountChoiceToken,
  confirmKeyboard,
  currencyKeyboard,
  mainMenuKeyboard,
  movementTypeKeyboard,
  noteKeyboard,
} from '../keyboards.js'
import { escapeHtml, movementStepText, reviewMovementText, stepPromptText } from '../messages.js'

const STEPS = {
  TYPE: 'type',
  AMOUNT: 'amount',
  CURRENCY: 'currency',
  RATE: 'rate',
  SOURCE: 'source',
  DESTINATION: 'destination',
  NOTE: 'note',
  REVIEW: 'review',
}

function createMovementSession() {
  return {
    flow: 'movement',
    step: STEPS.TYPE,
    sessionId: randomUUID(),
    draft: {
      type: '',
      amount: 0,
      currency: '',
      currencyConfirmed: false,
      sourceAccountId: '',
      destinationAccountId: '',
      rate: undefined,
      note: '',
    },
    choices: {},
    uiMessageId: null,
  }
}

function nextAfterAmount(type) {
  const config = movementConfigFor(type)
  if (config.currencyLocked) return movementNeedsRate(type) ? STEPS.RATE : STEPS.SOURCE
  return STEPS.CURRENCY
}

function nextAfterSource(type) {
  return movementNeedsDestination(type) ? STEPS.DESTINATION : STEPS.NOTE
}

async function sendStep(ctx, session, textPrefix = '') {
  let state
  try {
    const loaded = await ctx.repository.load()
    state = loaded.state
  } catch (error) {
    console.error('[adreem-telegram-bot] ledger load failed', error?.message || error)
    return upsertFlowMessage(ctx, session, {
      text: '<b>تعذر الاتصال بالدفتر الآن.</b>\n<blockquote>حاول مرة أخرى بعد لحظات.</blockquote>',
      reply_markup: mainMenuKeyboard(),
    })
  }
  const snapshot = buildLedgerSnapshot(state)
  const header = movementStepText(session, snapshot.accountById)
  const text = textPrefix ? `${header}\n\n${textPrefix}` : header

  if (session.step === STEPS.TYPE) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: movementTypeKeyboard() })
  }
  if (session.step === STEPS.AMOUNT) {
    return upsertFlowMessage(ctx, session, { text: `${text}\n\n${stepPromptText(session)}` })
  }
  if (session.step === STEPS.CURRENCY) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: currencyKeyboard(session.draft.currency) })
  }
  if (session.step === STEPS.RATE) {
    return upsertFlowMessage(ctx, session, { text: `${text}\n\n${stepPromptText(session)}` })
  }
  if (session.step === STEPS.SOURCE || session.step === STEPS.DESTINATION) {
    return sendAccountChoices(ctx, session, state, session.step)
  }
  if (session.step === STEPS.NOTE) {
    return upsertFlowMessage(ctx, session, { text: `${text}\n\n${stepPromptText(session)}`, reply_markup: noteKeyboard() })
  }
  if (session.step === STEPS.REVIEW) {
    const preview = previewDraft(state, session.draft)
    return upsertFlowMessage(ctx, session, { text: reviewMovementText(session, preview), reply_markup: confirmKeyboard() })
  }
  return null
}

async function upsertFlowMessage(ctx, session, payload) {
  const targetMessageId = session.uiMessageId || (ctx.isCallback ? ctx.messageId : null)
  if (targetMessageId) {
    try {
      await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: targetMessageId,
        text: payload.text,
        parse_mode: 'HTML',
        reply_markup: payload.reply_markup,
      })
      session.uiMessageId = targetMessageId
      ctx.sessions.set(ctx.chatId, ctx.userId, session)
      return null
    } catch (error) {
      const message = String(error?.message || '')
      if (/message is not modified/i.test(message)) return null
      // If Telegram refuses editing an old message, send a fresh control card.
    }
  }

  const sent = await ctx.telegram.sendMessage({
    chat_id: ctx.chatId,
    text: payload.text,
    parse_mode: 'HTML',
    reply_markup: payload.reply_markup,
  })
  session.uiMessageId = sent.message_id
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sent
}

async function sendAccountChoices(ctx, session, state, role, query = '') {
  const accounts = getMovementAccounts(state, session.draft.type, role, session.draft)
  const preferredIds = movementPreferredAccountIds(session.draft.type, role)
  const rankedAll = rankAccountsForTelegram(accounts, state, query)
  const ranked = [
    ...preferredIds
      .map((id) => rankedAll.find((account) => account.id === id))
      .filter(Boolean),
    ...rankedAll.filter((account) => !preferredIds.includes(account.id)),
  ].slice(0, 8)
  session.choices = {
    ...session.choices,
    [role]: Object.fromEntries(ranked.map((account) => [accountChoiceToken(account), account.id])),
  }
  ctx.sessions.set(ctx.chatId, ctx.userId, session)

  const snapshot = buildLedgerSnapshot(state)
  const lines = [movementStepText(session, snapshot.accountById), '']
  lines.push(stepPromptText(session))
  if (query) lines.push(`<b>بحث:</b> ${escapeHtml(query)}`)
  lines.push(ranked.length ? `<b>${ranked.length} اختيارات مناسبة.</b> اضغط الاسم المطلوب.` : '<b>لا توجد نتيجة.</b> اكتب جزءًا آخر من الاسم.')
  return upsertFlowMessage(ctx, session, {
    text: lines.join('\n'),
    reply_markup: accountChoicesKeyboard(ranked, role, snapshot.balanceByAccountId),
  })
}

export async function startMovement(ctx) {
  const session = createMovementSession()
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function handleMovementCallback(ctx, data) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'movement') return sendExpiredMovementMessage(ctx)
  if (isStaleMovementCallback(ctx, session)) return sendExpiredMovementMessage(ctx)

  if (data === 'mv:cancel') {
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: '<b>تم إلغاء الإدخال.</b>',
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: '<b>تم إلغاء الإدخال.</b>', parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
    }
  }

  if (data === 'mv:back') {
    session.step = previousStep(session)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:type:')) {
    const type = data.slice('mv:type:'.length)
    const config = movementConfigFor(type)
    session.draft = {
      ...session.draft,
      type,
      currency: movementCurrencyFor(type, CURRENCIES.DINAR),
      currencyConfirmed: Boolean(config.currencyLocked),
      sourceAccountId: '',
      destinationAccountId: '',
      rate: movementNeedsRate(type) ? session.draft.rate : undefined,
    }
    session.step = STEPS.AMOUNT
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session, `تم اختيار: ${movementLabels[type]}.`)
  }

  if (data.startsWith('mv:currency:')) {
    session.draft.currency = data.slice('mv:currency:'.length)
    session.draft.currencyConfirmed = true
    session.step = STEPS.SOURCE
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:searchhint:')) {
    return sendStep(ctx, session, 'اكتب جزءًا من الاسم، وسأعرض أقرب الحسابات.')
  }

  if (data.startsWith('mv:account:')) {
    const [, , role, token] = data.split(':')
    const accountId = session.choices?.[role]?.[token]
    if (!accountId) return sendStep(ctx, session, 'الاختيار غير صالح. أعد الاختيار.')
    if (role === STEPS.SOURCE) {
      session.draft.sourceAccountId = accountId
      session.step = nextAfterSource(session.draft.type)
    } else {
      session.draft.destinationAccountId = accountId
      session.step = STEPS.NOTE
    }
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data === 'mv:note:skip') {
    session.draft.note = ''
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data === 'mv:confirm') {
    session.draft.currency = session.draft.currency || movementCurrencyFor(session.draft.type, CURRENCIES.DINAR)
    let result
    try {
      result = await appendTelegramMovement(ctx.repository, session.draft, {
        idempotencyKey: `${ctx.userId}-${session.sessionId}`,
        telegramUserId: ctx.userId,
        telegramChatId: ctx.chatId,
      })
    } catch (error) {
      console.error('[adreem-telegram-bot] movement save failed', error?.message || error)
      return upsertFlowMessage(ctx, session, {
        text: '<b>تعذر حفظ الحركة الآن.</b>\n<blockquote>حاول مرة أخرى بعد لحظات.</blockquote>',
        reply_markup: confirmKeyboard(),
      })
    }
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    const amountText = formatMoney(result.movement.amount, result.movement.currency)
    const suffix = savedMovementSuffix(result)
    const detailText = result.needsReview
      ? `${movementLabels[result.movement.type]} ${amountText}\nستظهر في قسم المراجعة.\nلا تغير الأرصدة قبل الاعتماد.`
      : `${movementLabels[result.movement.type]} ${amountText}`
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: `<b>${escapeHtml(suffix)}</b>\n<blockquote>${escapeHtml(detailText)}</blockquote>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `<b>${escapeHtml(suffix)}</b>\n<blockquote>${escapeHtml(detailText)}</blockquote>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    }
  }

  return sendStep(ctx, session, 'أمر غير معروف.')
}

function savedMovementSuffix(result) {
  if (result.duplicate) return result.needsReview ? 'كانت محفوظة سابقًا في المراجعة.' : 'كانت محفوظة سابقًا ولم تتكرر.'
  return result.needsReview ? 'تم حفظها في المراجعة.' : 'تم الحفظ وتحديث الدفتر.'
}

function isStaleMovementCallback(ctx, session) {
  return Boolean(ctx.isCallback && session.uiMessageId && ctx.messageId && ctx.messageId !== session.uiMessageId)
}

async function sendExpiredMovementMessage(ctx) {
  const text = '<b>هذه عملية قديمة.</b>\n<blockquote>افتح إدخال حركة من القائمة إذا أردت البدء من جديد.</blockquote>'
  if (ctx.isCallback && ctx.messageId) {
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      // Fall back to a fresh message if Telegram cannot edit the old card.
    }
  }
  return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text, parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
}

export async function handleMovementText(ctx, text) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'movement') return false

  if (session.step === STEPS.AMOUNT) {
    const amount = parseAmountText(text)
    if (!amount) {
      await sendStep(ctx, session, 'اكتب مبلغًا صحيحًا أكبر من صفر.')
      return true
    }
    session.draft.amount = amount
    if (movementConfigFor(session.draft.type).currencyLocked) {
      session.draft.currency = movementCurrencyFor(session.draft.type, CURRENCIES.DINAR)
      session.draft.currencyConfirmed = true
    }
    session.step = nextAfterAmount(session.draft.type)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  if (session.step === STEPS.RATE) {
    const rate = parseAmountText(text, { allowDecimal: true })
    if (!rate) {
      await sendStep(ctx, session, 'اكتب سعر صرف صحيحًا.')
      return true
    }
    session.draft.rate = rate
    session.step = STEPS.SOURCE
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  if (session.step === STEPS.SOURCE || session.step === STEPS.DESTINATION) {
    let state
    try {
      const loaded = await ctx.repository.load()
      state = loaded.state
    } catch (error) {
      console.error('[adreem-telegram-bot] ledger load failed', error?.message || error)
      await sendStep(ctx, session, 'تعذر الاتصال بالدفتر الآن. حاول مرة أخرى بعد لحظات.')
      return true
    }
    await sendAccountChoices(ctx, session, state, session.step, text)
    return true
  }

  if (session.step === STEPS.NOTE) {
    session.draft.note = String(text || '').trim()
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  return false
}

function previousStep(session) {
  if (session.step === STEPS.AMOUNT) return STEPS.TYPE
  if (session.step === STEPS.CURRENCY) return STEPS.AMOUNT
  if (session.step === STEPS.RATE) return STEPS.AMOUNT
  if (session.step === STEPS.SOURCE) return movementNeedsRate(session.draft.type) ? STEPS.RATE : (movementConfigFor(session.draft.type).currencyLocked ? STEPS.AMOUNT : STEPS.CURRENCY)
  if (session.step === STEPS.DESTINATION) return STEPS.SOURCE
  if (session.step === STEPS.NOTE) return movementNeedsDestination(session.draft.type) ? STEPS.DESTINATION : STEPS.SOURCE
  if (session.step === STEPS.REVIEW) return STEPS.NOTE
  return STEPS.TYPE
}
