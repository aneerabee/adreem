import { randomUUID } from 'node:crypto'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../../src/ledger/accountCatalog.js'
import { accountSupportsTransferCurrency } from '../../../src/ledger/accountCompatibility.js'
import { CURRENCIES } from '../../../src/ledger/ledgerCore.js'
import {
  appendTelegramReconciliation,
  buildLedgerSnapshot,
  formatMoney,
  parseBalanceText,
  rankAccountsForTelegram,
  telegramUpdateIdempotencyKey,
} from '../../ledger/ledgerService.js'
import {
  accountChoiceToken,
  mainMenuKeyboard,
  reconciliationAccountKeyboard,
  reconciliationConfirmKeyboard,
  reconciliationCurrencyKeyboard,
  numericKeypadKeyboard,
  reconciliationTextStepKeyboard,
} from '../keyboards.js'
import { accountChoiceLegendText, escapeHtml, reconciliationReviewText, reconciliationStepText } from '../messages.js'
import { preserveUiData } from '../../../src/ledger/uiTranslation.js'
import { applyNumericKey, normalizeNumericBuffer, numericBufferDisplay, numericBufferValue } from '../numericKeypad.js'

const STEPS = {
  ACCOUNT: 'account',
  CURRENCY: 'currency',
  ACTUAL: 'actual',
  NOTE: 'note',
  REVIEW: 'review',
}

function createReconciliationSession() {
  return {
    flow: 'reconciliation',
    step: STEPS.ACCOUNT,
    sessionId: randomUUID(),
    draft: {
      accountId: '',
      currency: '',
      actualBalance: null,
      note: '',
    },
    choices: {},
    numericInput: null,
    uiMessageId: null,
  }
}

function prepareNumericInput(session) {
  if (session.numericInput?.step !== STEPS.ACTUAL) {
    session.numericInput = {
      step: STEPS.ACTUAL,
      value: normalizeNumericBuffer(session.draft.actualBalance ?? ''),
      header: '',
    }
  }
  return session.numericInput
}

function numericStepText(header, value) {
  return `${header}\n\n<blockquote><code>${escapeHtml(numericBufferDisplay(value))}</code></blockquote>`
}

export async function startReconciliation(ctx) {
  const session = createReconciliationSession()
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
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
  const header = reconciliationStepText(session, snapshot.accountById, snapshot.balanceByAccountId)
  const text = textPrefix ? `${header}\n\n${textPrefix}` : header

  if (session.step === STEPS.ACCOUNT) {
    return sendAccountChoices(ctx, session, state, '', textPrefix)
  }
  if (session.step === STEPS.CURRENCY) {
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: reconciliationCurrencyKeyboard(session.draft.currency),
    })
  }
  if (session.step === STEPS.ACTUAL) {
    const numericInput = prepareNumericInput(session)
    numericInput.header = text
    return upsertFlowMessage(ctx, session, {
      text: numericStepText(text, numericInput.value),
      reply_markup: numericKeypadKeyboard('rec'),
    })
  }
  if (session.step === STEPS.NOTE) {
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: reconciliationTextStepKeyboard(),
    })
  }
  if (session.step === STEPS.REVIEW) {
    const account = snapshot.accountById.get(session.draft.accountId)
    const bucket = snapshot.balanceByAccountId.get(session.draft.accountId)
    const expected = session.draft.currency === CURRENCIES.USD ? bucket?.usd || 0 : bucket?.dinar || 0
    return upsertFlowMessage(ctx, session, {
      text: reconciliationReviewText(session, { account, expected }),
      reply_markup: reconciliationConfirmKeyboard(),
    })
  }
  return null
}

async function sendAccountChoices(ctx, session, state, query = '', feedback = '') {
  const snapshot = buildLedgerSnapshot(state)
  const accounts = snapshot.activeAccounts
    .filter((account) => account.status === ACCOUNT_STATUSES.ACTIVE)
    .filter((account) => account.valueKind === VALUE_KINDS.CASH || account.valueKind === VALUE_KINDS.BANK)
  const ranked = rankAccountsForTelegram(accounts, state, query).slice(0, 8)
  session.choices = {
    ...session.choices,
    account: Object.fromEntries(ranked.map((account) => [accountChoiceToken(account), account.id])),
  }
  ctx.sessions.set(ctx.chatId, ctx.userId, session)

  const lines = [reconciliationStepText(session, snapshot.accountById, snapshot.balanceByAccountId)]
  if (feedback) lines.push('', `<blockquote>${escapeHtml(feedback)}</blockquote>`)
  if (query) lines.push('', `<code>بحث: ${escapeHtml(preserveUiData(query))}</code>`)
  const legend = accountChoiceLegendText(ranked)
  if (legend) lines.push('', `<code>${escapeHtml(legend)}</code>`)
  if (!ranked.length) lines.push('', '<b>لا توجد نتيجة.</b> اكتب جزءًا آخر من الاسم.')
  return upsertFlowMessage(ctx, session, {
    text: lines.join('\n'),
    reply_markup: reconciliationAccountKeyboard(ranked, snapshot.balanceByAccountId),
  })
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

export async function handleReconciliationCallback(ctx, data) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'reconciliation') return sendExpiredReconciliationMessage(ctx)
  if (isStaleReconciliationCallback(ctx, session)) return sendExpiredReconciliationMessage(ctx)
  if (!callbackMatchesCurrentStep(data, session.step)) return sendStep(ctx, session, 'هذا زر من خطوة سابقة. أكمل من الخطوة الظاهرة الآن.')

  if (data === 'rec:cancel') {
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    return editOrSend(ctx, session, '<b>تم إلغاء المطابقة.</b>', mainMenuKeyboard())
  }
  if (data === 'rec:back') {
    session.step = previousStep(session)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }
  if (data.startsWith('rec:num:')) {
    return handleReconciliationNumericCallback(ctx, session, data.slice('rec:num:'.length))
  }
  if (data === 'rec:search') {
    return sendStep(ctx, session, 'اكتب جزءًا من اسم الحساب.')
  }
  if (data.startsWith('rec:account:')) {
    const token = data.slice('rec:account:'.length)
    const accountId = session.choices?.account?.[token]
    if (!accountId) return sendStep(ctx, session, 'الاختيار غير صالح. أعد الاختيار.')
    session.draft.accountId = accountId
    session.draft.currency = ''
    session.step = STEPS.CURRENCY
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }
  if (data.startsWith('rec:currency:')) {
    const currency = data.slice('rec:currency:'.length)
    const { state } = await ctx.repository.load()
    const account = state.accounts.find((item) => item.id === session.draft.accountId)
    if (!accountSupportsTransferCurrency(account, currency)) {
      return sendStep(ctx, session, 'هذا الحساب لا يدعم هذه العملة.')
    }
    session.draft.currency = currency
    session.numericInput = null
    session.step = STEPS.ACTUAL
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }
  if (data === 'rec:confirm') {
    let result
    try {
      result = await appendTelegramReconciliation(ctx.repository, session.draft, {
        idempotencyKey: telegramUpdateIdempotencyKey(ctx.updateId, 'reconciliation-create'),
        telegramUserId: ctx.userId,
        telegramChatId: ctx.chatId,
      })
    } catch (error) {
      console.error('[adreem-telegram-bot] reconciliation save failed', error?.message || error)
      return upsertFlowMessage(ctx, session, {
        text: '<b>تعذر حفظ المطابقة الآن.</b>\n<blockquote>حاول مرة أخرى بعد لحظات.</blockquote>',
        reply_markup: reconciliationConfirmKeyboard(),
      })
    }
    if (result.rejected) {
      return upsertFlowMessage(ctx, session, {
        text: `<b>لم يتم الحفظ.</b>\n<blockquote>${escapeHtml(result.error || 'المطابقة غير مكتملة.')}</blockquote>`,
        reply_markup: reconciliationConfirmKeyboard(),
      })
    }
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    const diff = session.draft.currency === CURRENCIES.USD ? result.reconciliation.diffUsd : result.reconciliation.diffDinar
    const correctionText = result.correctionMovements.length
      ? `تصحيح: ${formatMoney(diff, session.draft.currency)}${result.needsReview ? '\nذهب التصحيح للمراجعة.' : ''}`
      : 'لا يوجد فرق. حفظت المطابقة بدون تصحيح.'
    const title = result.duplicate ? 'كانت المطابقة محفوظة سابقًا.' : 'تم حفظ المطابقة.'
    return editOrSend(ctx, session, `<b>${escapeHtml(title)}</b>\n<blockquote>${escapeHtml(correctionText)}</blockquote>`, mainMenuKeyboard())
  }
  return sendStep(ctx, session, 'أمر غير معروف.')
}

async function handleReconciliationNumericCallback(ctx, session, key) {
  const numericInput = prepareNumericInput(session)
  if (key !== 'done') {
    numericInput.value = applyNumericKey(numericInput.value, key)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    if (!numericInput.header) return sendStep(ctx, session)
    return upsertFlowMessage(ctx, session, {
      text: numericStepText(numericInput.header, numericInput.value),
      reply_markup: numericKeypadKeyboard('rec'),
    })
  }

  const value = numericBufferValue(numericInput.value, { allowZero: true })
  if (value === null) {
    return upsertFlowMessage(ctx, session, {
      text: `${numericStepText(numericInput.header, numericInput.value)}\n\n<b>اكتب رصيدًا صحيحًا، صفر أو أكبر.</b>`,
      reply_markup: numericKeypadKeyboard('rec'),
    })
  }
  session.draft.actualBalance = value
  session.numericInput = null
  session.step = STEPS.NOTE
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function handleReconciliationText(ctx, text) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'reconciliation') return false

  if (session.step === STEPS.ACCOUNT) {
    const { state } = await ctx.repository.load()
    await sendAccountChoices(ctx, session, state, text)
    return true
  }
  if (session.step === STEPS.ACTUAL) {
    const actual = parseBalanceText(text)
    if (actual === null) {
      await sendStep(ctx, session, 'اكتب رصيدًا صحيحًا، صفر أو أكبر.')
      return true
    }
    session.draft.actualBalance = actual
    session.numericInput = null
    session.step = STEPS.NOTE
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }
  if (session.step === STEPS.NOTE) {
    const note = String(text || '').trim()
    if (!note) {
      await sendStep(ctx, session, 'الملاحظة إلزامية.')
      return true
    }
    session.draft.note = note
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }
  await sendStep(ctx, session, 'اختر من الأزرار.')
  return true
}

function callbackMatchesCurrentStep(data, step) {
  if (data === 'rec:cancel' || data === 'rec:back') return true
  if (data === 'rec:search') return step === STEPS.ACCOUNT
  if (data.startsWith('rec:account:')) return step === STEPS.ACCOUNT
  if (data.startsWith('rec:currency:')) return step === STEPS.CURRENCY
  if (data.startsWith('rec:num:')) return step === STEPS.ACTUAL
  if (data === 'rec:confirm') return step === STEPS.REVIEW
  return false
}

function previousStep(session) {
  if (session.step === STEPS.CURRENCY) return STEPS.ACCOUNT
  if (session.step === STEPS.ACTUAL) return STEPS.CURRENCY
  if (session.step === STEPS.NOTE) return STEPS.ACTUAL
  if (session.step === STEPS.REVIEW) return STEPS.NOTE
  return STEPS.ACCOUNT
}

function isStaleReconciliationCallback(ctx, session) {
  return Boolean(ctx.isCallback && session.uiMessageId && ctx.messageId && ctx.messageId !== session.uiMessageId)
}

async function sendExpiredReconciliationMessage(ctx) {
  const text = '<b>هذه مطابقة قديمة.</b>\n<blockquote>افتح مطابقة رصيد من القائمة إذا أردت البدء من جديد.</blockquote>'
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

async function editOrSend(ctx, session, text, replyMarkup) {
  try {
    return await ctx.telegram.editMessageText({
      chat_id: ctx.chatId,
      message_id: session.uiMessageId || ctx.messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    })
  } catch {
    return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup })
  }
}
