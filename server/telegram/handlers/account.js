import { randomUUID } from 'node:crypto'
import {
  accountDetailOptionsFor,
  accountNeedsCurrency,
  accountPresetFor,
  accountPresets,
  applyAccountName,
  emptyAccountDraft,
} from '../../../src/mohammadLedger/accountConfig.js'
import {
  accountIdempotencyKey,
  appendTelegramAccount,
  resolveTelegramReviewAccount,
  validateAccountDraft,
} from '../../mohammadLedger/accountService.js'
import { accountLabel } from '../../mohammadLedger/ledgerService.js'
import {
  accountConfirmKeyboard,
  accountCurrencyKeyboard,
  accountDetailKeyboard,
  accountTextStepKeyboard,
  accountTypeKeyboard,
  mainMenuKeyboard,
} from '../keyboards.js'
import { accountCreatedText, accountReviewText, accountStepText } from '../messages.js'

const STEPS = {
  TYPE: 'type',
  OWNER: 'owner',
  DETAIL: 'detail',
  CURRENCY: 'currency',
  REVIEW: 'review',
}

function createAccountSession(options = {}) {
  return {
    flow: 'account',
    mode: options.mode || 'create',
    step: STEPS.TYPE,
    sessionId: randomUUID(),
    draft: options.draft || emptyAccountDraft(),
    reviewAccountId: options.reviewAccountId || '',
    reviewOriginalLabel: options.reviewOriginalLabel || '',
    uiMessageId: null,
  }
}

async function upsertAccountMessage(ctx, session, payload) {
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

async function sendStep(ctx, session, result = null) {
  if (session.step === STEPS.TYPE) {
    const preset = accountPresetFor(session.draft.type, session.draft.valueKind)
    return upsertAccountMessage(ctx, session, {
      text: accountStepText(session),
      reply_markup: accountTypeKeyboard(preset.key),
    })
  }
  if (session.step === STEPS.OWNER) {
    return upsertAccountMessage(ctx, session, {
      text: accountStepText(session),
      reply_markup: accountTextStepKeyboard(),
    })
  }
  if (session.step === STEPS.DETAIL) {
    return upsertAccountMessage(ctx, session, {
      text: accountStepText(session),
      reply_markup: accountDetailKeyboard(
        session.draft.subAccountName,
        accountDetailOptionsFor(session.draft.type, session.draft.valueKind),
      ),
    })
  }
  if (session.step === STEPS.CURRENCY) {
    return upsertAccountMessage(ctx, session, {
      text: accountStepText(session),
      reply_markup: accountCurrencyKeyboard(session.draft.currencyKind),
    })
  }
  if (session.step === STEPS.REVIEW) {
    return upsertAccountMessage(ctx, session, {
      text: accountReviewText(session, result),
      reply_markup: accountConfirmKeyboard(),
    })
  }
  return null
}

async function sendAccountConnectionError(ctx, session) {
  return upsertAccountMessage(ctx, session, {
    text: '<b>تعذر الاتصال بالدفتر الآن.</b>\n<blockquote>حاول مرة أخرى بعد لحظات.</blockquote>',
    reply_markup: accountConfirmKeyboard(),
  })
}

export async function startAccount(ctx) {
  const session = createAccountSession()
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function startReviewAccount(ctx, accountId) {
  const { state } = await ctx.repository.load()
  const account = state.accounts.find((item) => item.id === accountId)
  if (!account) {
    return ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: '<b>لم أجد الحساب.</b>',
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    })
  }
  const session = createAccountSession({
    mode: 'review',
    reviewAccountId: account.id,
    reviewOriginalLabel: accountLabel(account),
    draft: {
      ...emptyAccountDraft(),
      ownerName: account.ownerName || '',
      subAccountName: account.subAccountName || 'كاش بيننا',
      notes: account.notes || '',
    },
  })
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function handleAccountCallback(ctx, data) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'account') return sendExpiredAccountMessage(ctx)
  if (isStaleAccountCallback(ctx, session)) return sendExpiredAccountMessage(ctx)

  if (data === 'acct:cancel') {
    const cancelTitle = session.mode === 'review' ? 'تم إلغاء إصلاح الحساب.' : 'تم إلغاء إنشاء الحساب.'
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: `<b>${cancelTitle}</b>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: `<b>${cancelTitle}</b>`, parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
    }
  }

  if (data === 'acct:back') {
    session.step = previousStep(session)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('acct:type:')) {
    const key = data.slice('acct:type:'.length)
    const preset = accountPresets.find((item) => item.key === key) || accountPresets[0]
    session.draft = {
      ...session.draft,
      ownerName: preset.ownerName || '',
      type: preset.type,
      valueKind: preset.valueKind,
      subAccountName: preset.subAccountName,
      currencyKind: session.draft.currencyKind,
    }
    session.step = STEPS.OWNER
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('acct:detail:')) {
    const index = Number(data.slice('acct:detail:'.length))
    const detailOptions = accountDetailOptionsFor(session.draft.type, session.draft.valueKind)
    const detail = Number.isInteger(index) ? detailOptions[index] : ''
    if (!detail) return sendStep(ctx, session)
    session.draft.subAccountName = detail
    session.step = accountNeedsCurrency(session.draft) ? STEPS.CURRENCY : STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    if (session.step === STEPS.CURRENCY) return sendStep(ctx, session)
    try {
      const current = await ctx.repository.load()
      return sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
    } catch (error) {
      console.error('[adreem-telegram-bot] account validation load failed', error?.message || error)
      return sendAccountConnectionError(ctx, session)
    }
  }

  if (data.startsWith('acct:currency:')) {
    session.draft.currencyKind = data.slice('acct:currency:'.length)
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    try {
      const current = await ctx.repository.load()
      return sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
    } catch (error) {
      console.error('[adreem-telegram-bot] account validation load failed', error?.message || error)
      return sendAccountConnectionError(ctx, session)
    }
  }

  if (data === 'acct:confirm') {
    if (session.step !== STEPS.REVIEW) return sendStep(ctx, session)
    let result
    try {
      if (session.mode === 'review') {
        result = await resolveTelegramReviewAccount(ctx.repository, session.reviewAccountId, session.draft, {
          telegramUserId: ctx.userId,
          telegramChatId: ctx.chatId,
        })
      } else {
        result = await appendTelegramAccount(ctx.repository, session.draft, {
          idempotencyKey: accountIdempotencyKey([ctx.userId, session.sessionId]),
          telegramUserId: ctx.userId,
          telegramChatId: ctx.chatId,
        })
      }
    } catch (error) {
      console.error('[adreem-telegram-bot] account save failed', error?.message || error)
      return sendAccountConnectionError(ctx, session)
    }
    if (result.rejected) return sendStep(ctx, session, result)

    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: accountCreatedText(result.account, { duplicate: result.duplicate, reviewed: session.mode === 'review' }),
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: accountCreatedText(result.account, { duplicate: result.duplicate, reviewed: session.mode === 'review' }),
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    }
  }

  return sendStep(ctx, session)
}

function isStaleAccountCallback(ctx, session) {
  return Boolean(ctx.isCallback && session.uiMessageId && ctx.messageId && ctx.messageId !== session.uiMessageId)
}

async function sendExpiredAccountMessage(ctx) {
  const text = '<b>هذه عملية قديمة.</b>\n<blockquote>افتح حسابًا جديدًا من القائمة إذا أردت البدء من جديد.</blockquote>'
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

export async function handleAccountText(ctx, text) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'account') return false

  if (session.step === STEPS.OWNER) {
    const accountName = String(text || '').trim()
    if (!accountName) {
      await sendStep(ctx, session)
      return true
    }
    session.draft = applyAccountName(session.draft, accountName)
    const preset = accountPresetFor(session.draft.type, session.draft.valueKind)
    session.step = preset.skipDetail
      ? (accountNeedsCurrency(session.draft) ? STEPS.CURRENCY : STEPS.REVIEW)
      : STEPS.DETAIL
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    if (session.step === STEPS.REVIEW) {
      try {
        const current = await ctx.repository.load()
        await sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
      } catch (error) {
        console.error('[adreem-telegram-bot] account validation load failed', error?.message || error)
        await sendAccountConnectionError(ctx, session)
      }
    } else {
      await sendStep(ctx, session)
    }
    return true
  }

  if (session.step === STEPS.DETAIL) {
    const subAccountName = String(text || '').trim()
    if (!subAccountName) {
      await sendStep(ctx, session)
      return true
    }
    session.draft.subAccountName = subAccountName
    session.step = accountNeedsCurrency(session.draft) ? STEPS.CURRENCY : STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    if (session.step === STEPS.CURRENCY) {
      await sendStep(ctx, session)
      return true
    }
    try {
      const current = await ctx.repository.load()
      await sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
    } catch (error) {
      console.error('[adreem-telegram-bot] account validation load failed', error?.message || error)
      await sendAccountConnectionError(ctx, session)
    }
    return true
  }

  return false
}

function previousStep(session) {
  const step = session?.step
  const preset = accountPresetFor(session?.draft?.type, session?.draft?.valueKind)
  if (step === STEPS.OWNER) return STEPS.TYPE
  if (step === STEPS.DETAIL) return STEPS.OWNER
  if (step === STEPS.CURRENCY) return preset.skipDetail ? STEPS.OWNER : STEPS.DETAIL
  if (step === STEPS.REVIEW) return accountNeedsCurrency(session?.draft) ? STEPS.CURRENCY : (preset.skipDetail ? STEPS.OWNER : STEPS.DETAIL)
  return STEPS.TYPE
}
