import { randomUUID } from 'node:crypto'
import { VALUE_KINDS } from '../../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES } from '../../../src/mohammadLedger/ledgerCore.js'
import {
  movementAccountCurrencyForRole,
  movementConfigFor,
  movementCurrencyFor,
  movementLabels,
  movementNeedsDestination,
  movementNeedsRate,
  movementNeedsSource,
  movementSupportsDimension,
  movementSupportsExpenseCategory,
  movementTypeOptions,
} from '../../../src/mohammadLedger/movementConfig.js'
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_MAX_SIZE_BYTES,
  dimensionsFromAccounts,
} from '../../../src/mohammadLedger/ledgerOperations.js'
import {
  appendTelegramMovement,
  buildLedgerSnapshot,
  formatMoney,
  getMovementAccounts,
  parseAmountText,
  previewDraft,
  rankAccountsForTelegram,
  resolveTelegramReviewMovement,
} from '../../mohammadLedger/ledgerService.js'
import {
  accountChoicesKeyboard,
  accountChoiceToken,
  attachmentKeyboard,
  confirmKeyboard,
  currencyKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  mainMenuKeyboard,
  movementTextStepKeyboard,
  movementTypeKeyboard,
  noteKeyboard,
  recurringKeyboard,
} from '../keyboards.js'
import { escapeHtml, movementStepText, reviewMovementText } from '../messages.js'
import { preserveUiData } from '../../../src/mohammadLedger/uiTranslation.js'

const STEPS = {
  TYPE: 'type',
  AMOUNT: 'amount',
  CURRENCY: 'currency',
  RATE: 'rate',
  SOURCE: 'source',
  DESTINATION: 'destination',
  NOTE: 'note',
  DIMENSION: 'dimension',
  CATEGORY: 'category',
  ATTACHMENT: 'attachment',
  RECURRING: 'recurring',
  REVIEW: 'review',
}

function createMovementSession(options = {}) {
  return {
    flow: 'movement',
    mode: options.mode || 'create',
    step: STEPS.TYPE,
    sessionId: randomUUID(),
    reviewMovementId: options.reviewMovementId || '',
    draft: options.draft || {
      type: '',
      amount: 0,
      currency: '',
      currencyConfirmed: false,
      sourceAccountId: '',
      destinationAccountId: '',
      rate: undefined,
      note: '',
      dimensionId: '',
      expenseCategoryId: '',
      attachmentLabel: '',
      attachmentUrl: '',
      attachmentStoragePath: '',
      attachmentMimeType: '',
      attachmentSizeBytes: 0,
      attachmentPending: null,
      recurringEnabled: false,
    },
    choices: {},
    uiMessageId: null,
  }
}

function nextAfterAmount(type) {
  const config = movementConfigFor(type)
  if (config.currencyLocked) return movementNeedsRate(type) ? STEPS.RATE : firstAccountStep(type)
  return STEPS.CURRENCY
}

function firstAccountStep(type) {
  if (movementNeedsSource(type)) return STEPS.SOURCE
  return movementNeedsDestination(type) ? STEPS.DESTINATION : STEPS.NOTE
}

function nextAfterSource(type) {
  return movementNeedsDestination(type) ? STEPS.DESTINATION : STEPS.NOTE
}

function nextAfterNote(type) {
  if (movementSupportsDimension(type)) return STEPS.DIMENSION
  if (movementSupportsExpenseCategory(type)) return STEPS.CATEGORY
  return STEPS.ATTACHMENT
}

function nextAfterDimension(type) {
  return movementSupportsExpenseCategory(type) ? STEPS.CATEGORY : STEPS.ATTACHMENT
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
  const dimensions = dimensionsFromAccounts(state.accounts, state.dimensions)
  const dimensionById = new Map(dimensions.map((dimension) => [dimension.id, dimension]))
  const expenseCategories = state.accounts.filter((account) => account.status === 'active' && account.valueKind === VALUE_KINDS.EXPENSE)
  const expenseCategoryById = new Map(expenseCategories.map((category) => [category.id, category]))
  const header = movementStepText(session, snapshot.accountById, dimensionById, expenseCategoryById)
  const text = textPrefix ? `${header}\n\n<blockquote>${escapeHtml(textPrefix)}</blockquote>` : header

  if (session.step === STEPS.TYPE) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: movementTypeKeyboard(session.draft.type) })
  }
  if (session.step === STEPS.AMOUNT) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: movementTextStepKeyboard() })
  }
  if (session.step === STEPS.CURRENCY) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: currencyKeyboard(session.draft.currency) })
  }
  if (session.step === STEPS.RATE) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: movementTextStepKeyboard() })
  }
  if (session.step === STEPS.SOURCE || session.step === STEPS.DESTINATION) {
    return sendAccountChoices(ctx, session, state, session.step)
  }
  if (session.step === STEPS.NOTE) {
    return upsertFlowMessage(ctx, session, { text, reply_markup: noteKeyboard() })
  }
  if (session.step === STEPS.DIMENSION) {
    if (!movementSupportsDimension(session.draft.type) || !dimensions.length) {
      session.step = nextAfterDimension(session.draft.type)
      ctx.sessions.set(ctx.chatId, ctx.userId, session)
      return sendStep(ctx, session)
    }
    session.choices = {
      ...session.choices,
      dimension: Object.fromEntries(dimensions.slice(0, 8).map((dimension, index) => [String(index), dimension.id])),
    }
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: dimensionKeyboard(dimensions, { selectedId: session.draft.dimensionId }),
    })
  }
  if (session.step === STEPS.CATEGORY) {
    if (!movementSupportsExpenseCategory(session.draft.type) || !expenseCategories.length) {
      session.step = STEPS.ATTACHMENT
      ctx.sessions.set(ctx.chatId, ctx.userId, session)
      return sendStep(ctx, session)
    }
    session.choices = {
      ...session.choices,
      category: Object.fromEntries(expenseCategories.slice(0, 8).map((category, index) => [String(index), category.id])),
    }
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: expenseCategoryKeyboard(expenseCategories, { selectedId: session.draft.expenseCategoryId }),
    })
  }
  if (session.step === STEPS.ATTACHMENT) {
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: attachmentKeyboard(),
    })
  }
  if (session.step === STEPS.RECURRING) {
    return upsertFlowMessage(ctx, session, {
      text,
      reply_markup: recurringKeyboard(),
    })
  }
  if (session.step === STEPS.REVIEW) {
    const preview = previewDraft(state, session.draft)
    return upsertFlowMessage(ctx, session, {
      text: reviewMovementText(session, preview, {
        accountsById: snapshot.accountById,
        dimensionsById: dimensionById,
        expenseCategoriesById: expenseCategoryById,
      }),
      reply_markup: confirmKeyboard(),
    })
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
  const displayCurrency = movementAccountCurrencyForRole(session.draft.type, role, session.draft.currency)
  const rankedAll = rankAccountsForTelegram(accounts, state, query, displayCurrency)
  const ranked = rankedAll.slice(0, 8)
  session.choices = {
    ...session.choices,
    [role]: Object.fromEntries(ranked.map((account) => [accountChoiceToken(account), account.id])),
  }
  ctx.sessions.set(ctx.chatId, ctx.userId, session)

  const snapshot = buildLedgerSnapshot(state)
  const dimensions = dimensionsFromAccounts(state.accounts, state.dimensions)
  const dimensionById = new Map(dimensions.map((dimension) => [dimension.id, dimension]))
  const expenseCategoryById = new Map(state.accounts.filter((account) => account.valueKind === VALUE_KINDS.EXPENSE).map((category) => [category.id, category]))
  const lines = [movementStepText(session, snapshot.accountById, dimensionById, expenseCategoryById)]
  if (query) lines.push('', `<code>بحث: ${escapeHtml(preserveUiData(query))}</code>`)
  if (!ranked.length) lines.push('', '<b>لا توجد نتيجة.</b> اكتب جزءًا آخر من الاسم.')
  return upsertFlowMessage(ctx, session, {
    text: lines.join('\n'),
    reply_markup: accountChoicesKeyboard(ranked, role, snapshot.balanceByAccountId, displayCurrency),
  })
}

export async function startMovement(ctx) {
  const session = createMovementSession()
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function startReviewMovement(ctx, movementId) {
  const { state } = await ctx.repository.load()
  const movement = state.movements.find((item) => item.id === movementId)
  if (!movement) {
    return ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: '<b>لم أجد الحركة.</b>',
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    })
  }
  const session = createMovementSession({
    mode: 'review',
    reviewMovementId: movement.id,
    draft: {
      type: movement.type || '',
      amount: movement.amount || 0,
      currency: movement.currency || '',
      currencyConfirmed: Boolean(movement.currency),
      sourceAccountId: movement.sourceAccountId || '',
      destinationAccountId: movement.destinationAccountId || '',
      rate: movement.rate,
      note: movement.note || '',
      dimensionId: movement.dimensionId || '',
      expenseCategoryId: movement.expenseCategoryId || '',
      attachmentLabel: '',
      attachmentUrl: '',
      attachmentStoragePath: '',
      attachmentMimeType: '',
      attachmentSizeBytes: 0,
      attachmentPending: null,
      recurringEnabled: false,
    },
  })
  ctx.sessions.set(ctx.chatId, ctx.userId, session)
  return sendStep(ctx, session)
}

export async function handleMovementCallback(ctx, data) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'movement') return sendExpiredMovementMessage(ctx)
  if (isStaleMovementCallback(ctx, session)) return sendExpiredMovementMessage(ctx)
  if (!callbackMatchesCurrentStep(data, session.step)) {
    return sendStep(ctx, session, 'هذا زر من خطوة سابقة. أكمل من الخطوة الظاهرة الآن.')
  }

  if (data === 'mv:cancel') {
    const cancelText = session.mode === 'review' ? 'تم إلغاء إصلاح الحركة.' : 'تم إلغاء الإدخال.'
    await removeRejectedUploadedAttachment(ctx, session)
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    try {
      return await ctx.telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: session.uiMessageId || ctx.messageId,
        text: `<b>${cancelText}</b>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: `<b>${cancelText}</b>`, parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
    }
  }

  if (data === 'mv:back') {
    session.step = previousStep(session)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:type:')) {
    const type = data.slice('mv:type:'.length)
    if (!movementTypeOptions.some((option) => option.type === type)) {
      return sendStep(ctx, session, 'نوع الحركة غير صالح. اختر من الأزرار الظاهرة.')
    }
    const config = movementConfigFor(type)
    session.draft = {
      ...session.draft,
      type,
      currency: movementCurrencyFor(type, CURRENCIES.DINAR),
      currencyConfirmed: Boolean(config.currencyLocked),
      sourceAccountId: '',
      destinationAccountId: '',
      rate: movementNeedsRate(type) ? session.draft.rate : undefined,
      dimensionId: movementSupportsDimension(type) ? session.draft.dimensionId || '' : '',
      expenseCategoryId: movementSupportsExpenseCategory(type) ? session.draft.expenseCategoryId || '' : '',
      attachmentLabel: session.draft.attachmentLabel || '',
      attachmentUrl: session.draft.attachmentUrl || '',
      attachmentStoragePath: session.draft.attachmentStoragePath || '',
      attachmentMimeType: session.draft.attachmentMimeType || '',
      attachmentSizeBytes: Number(session.draft.attachmentSizeBytes || 0),
      attachmentPending: session.draft.attachmentPending || null,
      recurringEnabled: Boolean(session.draft.recurringEnabled),
    }
    session.step = STEPS.AMOUNT
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:currency:')) {
    const currency = data.slice('mv:currency:'.length)
    if (![CURRENCIES.DINAR, CURRENCIES.USD].includes(currency)) {
      return sendStep(ctx, session, 'اختر عملة صحيحة.')
    }
    session.draft.currency = currency
    session.draft.currencyConfirmed = true
    session.step = firstAccountStep(session.draft.type)
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
    session.step = nextAfterNote(session.draft.type)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:dimension:')) {
    const token = data.slice('mv:dimension:'.length)
    const dimensionId = token === 'skip' ? '' : session.choices?.dimension?.[token]
    if (token !== 'skip' && !dimensionId) return sendStep(ctx, session, 'المشروع غير متاح. أعد الاختيار.')
    session.draft.dimensionId = dimensionId || ''
    session.step = nextAfterDimension(session.draft.type)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:category:')) {
    const token = data.slice('mv:category:'.length)
    const expenseCategoryId = token === 'skip' ? '' : session.choices?.category?.[token]
    if (token !== 'skip' && !expenseCategoryId) return sendStep(ctx, session, 'نوع المصروف غير متاح. أعد الاختيار.')
    session.draft.expenseCategoryId = expenseCategoryId || ''
    session.step = STEPS.ATTACHMENT
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data === 'mv:attachment:skip') {
    await removeRejectedUploadedAttachment(ctx, session)
    session.draft.attachmentLabel = ''
    session.draft.attachmentUrl = ''
    session.draft.attachmentStoragePath = ''
    session.draft.attachmentMimeType = ''
    session.draft.attachmentSizeBytes = 0
    session.draft.attachmentPending = null
    session.step = STEPS.RECURRING
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data.startsWith('mv:recurring:')) {
    const recurringChoice = data.slice('mv:recurring:'.length)
    if (!['monthly', 'no'].includes(recurringChoice)) return sendStep(ctx, session, 'اختر التكرار من الأزرار.')
    session.draft.recurringEnabled = recurringChoice === 'monthly'
    session.step = STEPS.REVIEW
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    return sendStep(ctx, session)
  }

  if (data === 'mv:confirm') {
    session.draft.currency = session.draft.currency || movementCurrencyFor(session.draft.type, CURRENCIES.DINAR)
    if (session.draft.attachmentPending) {
      try {
        const uploaded = await ctx.repository.uploadAttachmentFile(session.draft.attachmentPending)
        session.draft = {
          ...session.draft,
          attachmentLabel: uploaded.label,
          attachmentUrl: '',
          attachmentStoragePath: uploaded.storagePath,
          attachmentMimeType: uploaded.mimeType,
          attachmentSizeBytes: uploaded.sizeBytes,
          attachmentPending: null,
        }
        ctx.sessions.set(ctx.chatId, ctx.userId, session)
      } catch (error) {
        console.error('[adreem-telegram-bot] attachment upload failed', error?.message || error)
        const attachmentLabel = session.draft.attachmentPending?.fileName || session.draft.attachmentLabel
        const attachmentLine = attachmentLabel ? `مرفق: ${preserveUiData(attachmentLabel)}\n` : ''
        return upsertFlowMessage(ctx, session, {
          text: `<b>تعذر رفع المرفق.</b>\n<blockquote>${escapeHtml(`${attachmentLine}لم تُحفظ الحركة. حاول مرة أخرى أو ارجع واحذف المرفق.`)}</blockquote>`,
          reply_markup: confirmKeyboard(),
        })
      }
    }
    let result
    try {
      if (session.mode === 'review') {
        result = await resolveTelegramReviewMovement(ctx.repository, session.reviewMovementId, session.draft, {
          telegramUserId: ctx.userId,
          telegramChatId: ctx.chatId,
        })
      } else {
        result = await appendTelegramMovement(ctx.repository, session.draft, {
          idempotencyKey: `${ctx.userId}-${session.sessionId}`,
          telegramUserId: ctx.userId,
          telegramChatId: ctx.chatId,
        })
      }
    } catch (error) {
      console.error('[adreem-telegram-bot] movement save failed', error?.message || error)
      return upsertFlowMessage(ctx, session, {
        text: '<b>تعذر حفظ الحركة الآن.</b>\n<blockquote>حاول مرة أخرى بعد لحظات.</blockquote>',
        reply_markup: confirmKeyboard(),
      })
    }
    if (result.rejected) {
      await removeRejectedUploadedAttachment(ctx, session)
      return upsertFlowMessage(ctx, session, {
        text: `<b>لم يتم الحفظ.</b>\n<blockquote>${escapeHtml(result.error || 'الحركة لم تعد قابلة للإصلاح من هنا.')}</blockquote>`,
        reply_markup: confirmKeyboard(),
      })
    }
    ctx.sessions.clear(ctx.chatId, ctx.userId)
    const amountText = formatMoney(result.movement.amount, result.movement.currency)
    const suffix = savedMovementSuffix(result, session)
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

function callbackMatchesCurrentStep(data, step) {
  if (data === 'mv:cancel' || data === 'mv:back') return true
  if (data.startsWith('mv:type:')) return step === STEPS.TYPE
  if (data.startsWith('mv:currency:')) return step === STEPS.CURRENCY
  if (data.startsWith('mv:searchhint:')) return step === STEPS.SOURCE || step === STEPS.DESTINATION
  if (data.startsWith('mv:account:source:')) return step === STEPS.SOURCE
  if (data.startsWith('mv:account:destination:')) return step === STEPS.DESTINATION
  if (data === 'mv:note:skip') return step === STEPS.NOTE
  if (data.startsWith('mv:dimension:')) return step === STEPS.DIMENSION
  if (data.startsWith('mv:category:')) return step === STEPS.CATEGORY
  if (data === 'mv:attachment:skip') return step === STEPS.ATTACHMENT
  if (data.startsWith('mv:recurring:')) return step === STEPS.RECURRING
  if (data === 'mv:confirm') return step === STEPS.REVIEW
  return false
}

function savedMovementSuffix(result, session = {}) {
  if (session.mode === 'review') return result.needsReview ? 'ما زالت في المراجعة.' : 'تم إصلاح الحركة وتحديث الدفتر.'
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
    session.step = firstAccountStep(session.draft.type)
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
    session.step = nextAfterNote(session.draft.type)
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  if (session.step === STEPS.ATTACHMENT) {
    const attachment = parseAttachmentText(text)
    await removeRejectedUploadedAttachment(ctx, session)
    session.draft = {
      ...session.draft,
      attachmentLabel: attachment.label,
      attachmentUrl: attachment.url,
      attachmentStoragePath: '',
      attachmentMimeType: '',
      attachmentSizeBytes: 0,
      attachmentPending: null,
    }
    session.step = STEPS.RECURRING
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
    return true
  }

  await sendStep(ctx, session, 'اختر من الأزرار.')
  return true
}

export async function handleMovementMedia(ctx, message = {}) {
  const session = ctx.sessions.get(ctx.chatId, ctx.userId)
  if (!session || session.flow !== 'movement' || session.step !== STEPS.ATTACHMENT) return false
  const media = telegramAttachmentFromMessage(message)
  if (!media) {
    await sendStep(ctx, session, 'أرسل صورة أو ملف PDF فقط.')
    return true
  }
  if (media.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) {
    await sendStep(ctx, session, 'حجم المرفق أكبر من 10 ميغابايت.')
    return true
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(media.mimeType)) {
    await sendStep(ctx, session, 'المسموح: صورة JPG أو PNG أو WebP، أو ملف PDF.')
    return true
  }

  try {
    const file = await ctx.telegram.getFile({ file_id: media.fileId })
    const buffer = await ctx.telegram.downloadFile(file.file_path, { maxBytes: ATTACHMENT_MAX_SIZE_BYTES })
    await removeRejectedUploadedAttachment(ctx, session)
    session.draft = {
      ...session.draft,
      attachmentLabel: media.fileName,
      attachmentUrl: '',
      attachmentStoragePath: '',
      attachmentMimeType: media.mimeType,
      attachmentSizeBytes: buffer.length,
      attachmentPending: {
        fileName: media.fileName,
        mimeType: media.mimeType,
        buffer,
      },
    }
    session.step = STEPS.RECURRING
    ctx.sessions.set(ctx.chatId, ctx.userId, session)
    await sendStep(ctx, session)
  } catch (error) {
    console.error('[adreem-telegram-bot] attachment download failed', error?.message || error)
    await sendStep(ctx, session, 'تعذر قراءة المرفق. حاول إرساله مرة أخرى.')
  }
  return true
}

function telegramAttachmentFromMessage(message = {}) {
  if (message.document) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || `telegram-file-${message.document.file_unique_id || Date.now()}`,
      mimeType: String(message.document.mime_type || '').toLowerCase(),
      sizeBytes: Number(message.document.file_size || 0),
    }
  }
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null
  if (!photo) return null
  return {
    fileId: photo.file_id,
    fileName: `telegram-photo-${photo.file_unique_id || Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: Number(photo.file_size || 0),
  }
}

async function removeRejectedUploadedAttachment(ctx, session) {
  const storagePath = session.draft.attachmentStoragePath
  if (!storagePath || typeof ctx.repository.deleteAttachmentFile !== 'function') return
  try {
    const current = await ctx.repository.load()
    if (attachmentPathIsReferenced(current?.state, storagePath)) return
    await ctx.repository.deleteAttachmentFile(storagePath)
    session.draft.attachmentStoragePath = ''
  } catch (error) {
    console.error('[adreem-telegram-bot] rejected attachment cleanup failed', error?.message || error)
  }
}

export function attachmentPathIsReferenced(state = {}, storagePath = '') {
  const cleanPath = String(storagePath || '').trim()
  if (!cleanPath) return false
  return (Array.isArray(state.attachments) ? state.attachments : [])
    .some((attachment) => String(attachment?.storagePath || '').trim() === cleanPath)
}

function previousStep(session) {
  if (session.step === STEPS.AMOUNT) return STEPS.TYPE
  if (session.step === STEPS.CURRENCY) return STEPS.AMOUNT
  if (session.step === STEPS.RATE) return STEPS.AMOUNT
  if (session.step === STEPS.SOURCE) return movementNeedsRate(session.draft.type) ? STEPS.RATE : (movementConfigFor(session.draft.type).currencyLocked ? STEPS.AMOUNT : STEPS.CURRENCY)
  if (session.step === STEPS.DESTINATION) return movementNeedsSource(session.draft.type) ? STEPS.SOURCE : (movementNeedsRate(session.draft.type) ? STEPS.RATE : (movementConfigFor(session.draft.type).currencyLocked ? STEPS.AMOUNT : STEPS.CURRENCY))
  if (session.step === STEPS.NOTE) return movementNeedsDestination(session.draft.type) ? STEPS.DESTINATION : (movementNeedsSource(session.draft.type) ? STEPS.SOURCE : STEPS.CURRENCY)
  if (session.step === STEPS.DIMENSION) return STEPS.NOTE
  if (session.step === STEPS.CATEGORY) return movementSupportsDimension(session.draft.type) ? STEPS.DIMENSION : STEPS.NOTE
  if (session.step === STEPS.ATTACHMENT) return movementSupportsExpenseCategory(session.draft.type) ? STEPS.CATEGORY : (movementSupportsDimension(session.draft.type) ? STEPS.DIMENSION : STEPS.NOTE)
  if (session.step === STEPS.RECURRING) return STEPS.ATTACHMENT
  if (session.step === STEPS.REVIEW) return STEPS.RECURRING
  return STEPS.TYPE
}

function parseAttachmentText(text) {
  const value = String(text || '').trim()
  if (/^https?:\/\//i.test(value)) return { label: value, url: value }
  return { label: value, url: '' }
}
