import { randomUUID } from 'node:crypto'
import { accountDetailOptions, accountPresetFor, accountPresets, emptyAccountDraft } from '../../../src/mohammadLedger/accountConfig.js'
import { accountIdempotencyKey, appendTelegramAccount, validateAccountDraft } from '../../mohammadLedger/accountService.js'
import {
  accountConfirmKeyboard,
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
  REVIEW: 'review',
}

function createAccountSession() {
  return {
    flow: 'account',
    step: STEPS.TYPE,
    sessionId: randomUUID(),
    draft: emptyAccountDraft(),
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
      reply_markup: accountDetailKeyboard(session.draft.subAccountName),
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

export async function handleAccountCallback(ctx, data) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'account') return startAccount(ctx)

  if (data === 'acct:cancel') {
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: '<b>تم إلغاء إنشاء الحساب.</b>',
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: '<b>تم إلغاء إنشاء الحساب.</b>', parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
    }
  }

  if (data === 'acct:back') {
    session.step = previousStep(session.step)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('acct:type:')) {
    const key = data.slice('acct:type:'.length)
    const preset = accountPresets.find((item) => item.key === key) || accountPresets[0]
    session.draft = {
      ...session.draft,
      type: preset.type,
      valueKind: preset.valueKind,
      subAccountName: preset.subAccountName,
    }
    session.step = STEPS.OWNER
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('acct:detail:')) {
    const index = Number(data.slice('acct:detail:'.length))
    const detail = Number.isInteger(index) ? accountDetailOptions[index] : ''
    if (!detail) return sendStep(ctx, session)
    session.draft.subAccountName = detail
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    try {
      const current = await ctx.repository.load()
      return sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
    } catch (error) {
      console.error('[mohammad-telegram-bot] account validation load failed', error?.message || error)
      return sendAccountConnectionError(ctx, session)
    }
  }

  if (data === 'acct:confirm') {
    let result
    try {
      result = await appendTelegramAccount(ctx.repository, session.draft, {
        idempotencyKey: accountIdempotencyKey([ctx.userId, session.sessionId]),
        telegramUserId: ctx.userId,
        telegramChatId: ctx.chatId,
      })
    } catch (error) {
      console.error('[mohammad-telegram-bot] account save failed', error?.message || error)
      return sendAccountConnectionError(ctx, session)
    }
    if (result.rejected) return sendStep(ctx, session, result)

    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: accountCreatedText(result.account, { duplicate: result.duplicate }),
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: accountCreatedText(result.account, { duplicate: result.duplicate }),
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    }
  }

  return sendStep(ctx, session)
}

export async function handleAccountText(ctx, text) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'account') return false

  if (session.step === STEPS.OWNER) {
    const ownerName = String(text || '').trim()
    if (!ownerName) {
      await sendStep(ctx, session)
      return true
    }
    session.draft.ownerName = ownerName
    session.step = STEPS.DETAIL
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  if (session.step === STEPS.DETAIL) {
    const subAccountName = String(text || '').trim()
    if (!subAccountName) {
      await sendStep(ctx, session)
      return true
    }
    session.draft.subAccountName = subAccountName
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    try {
      const current = await ctx.repository.load()
      await sendStep(ctx, session, validateAccountDraft(session.draft, current.state.accounts))
    } catch (error) {
      console.error('[mohammad-telegram-bot] account validation load failed', error?.message || error)
      await sendAccountConnectionError(ctx, session)
    }
    return true
  }

  return false
}

function previousStep(step) {
  if (step === STEPS.OWNER) return STEPS.TYPE
  if (step === STEPS.DETAIL) return STEPS.OWNER
  if (step === STEPS.REVIEW) return STEPS.DETAIL
  return STEPS.TYPE
}
