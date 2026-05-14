import { MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { createLedgerRepository } from '../mohammadLedger/ledgerRepository.js'
import { accountLabel, buildLedgerSnapshot, formatMoney } from '../mohammadLedger/ledgerService.js'
import { mainMenuKeyboard } from './keyboards.js'
import { accountBlockquote, escapeHtml, mainMenuText, movementBlockquote, movementLabels } from './messages.js'
import { createSessionStore } from './sessionStore.js'
import { createTelegramClient } from './telegramClient.js'
import { handleAccountCallback, handleAccountText, startAccount } from './handlers/account.js'
import { handleMovementCallback, handleMovementText, startMovement } from './handlers/movement.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('[mohammad-telegram-bot] missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}
const allowedUserIds = String(process.env.MOHAMMAD_TELEGRAM_USER_IDS || process.env.MOHAMMAD_TELEGRAM_USER_ID || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const telegram = createTelegramClient(token)
const repository = createLedgerRepository(process.env)
const sessions = createSessionStore()

let offset = 0

console.log('[mohammad-telegram-bot] starting', {
  allowedUsers: allowedUserIds.length,
})

async function skipOldUpdates() {
  if (process.env.TELEGRAM_SKIP_OLD_UPDATES === 'false') return
  const updates = await telegram.getUpdates({ offset: -1, timeout: 0, allowed_updates: ['message', 'callback_query'] })
  if (updates.length) {
    offset = updates[updates.length - 1].update_id + 1
    console.log('[mohammad-telegram-bot] skipped old updates', { nextOffset: offset })
  }
}

function getUser(update) {
  return update.message?.from || update.callback_query?.from || null
}

function getChatId(update) {
  return update.message?.chat?.id || update.callback_query?.message?.chat?.id || null
}

function getMessageId(update) {
  return update.callback_query?.message?.message_id || update.message?.message_id || null
}

function isAllowed(user) {
  if (!user?.id) return false
  if (!allowedUserIds.length) return false
  return allowedUserIds.includes(String(user.id))
}

function contextFor(update) {
  const user = getUser(update)
  return {
    telegram,
    repository,
    sessions,
    user,
    userId: user?.id,
    chatId: getChatId(update),
    messageId: getMessageId(update),
    isCallback: Boolean(update.callback_query),
  }
}

async function sendScreen(ctx, text, replyMarkup = mainMenuKeyboard()) {
  if (ctx.isCallback && ctx.messageId) {
    try {
      return await telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    } catch {
      // Fall back to a new message if the selected Telegram message is no longer editable.
    }
  }
  return telegram.sendMessage({
    chat_id: ctx.chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  })
}

async function deleteUserInput(ctx) {
  if (!ctx.messageId || ctx.isCallback) return
  try {
    await telegram.deleteMessage({ chat_id: ctx.chatId, message_id: ctx.messageId })
  } catch {
    // Some Telegram clients or message ages can reject deletion; this should not block the flow.
  }
}

async function showMainMenu(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await repository.load()
  const today = movementsForToday(state).length
  const reviewCount = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW).length +
    state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW).length
  return sendScreen(ctx, mainMenuText({ todayCount: today, reviewCount }))
}

function movementsForToday(state) {
  const today = new Date()
  return state.movements.filter((movement) => {
    if (movement.status !== MOVEMENT_STATUSES.POSTED || movement.id?.startsWith('opening-')) return false
    const date = new Date(movement.createdAt || movement.updatedAt || '')
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
  })
}

async function showAccounts(ctx) {
  const { state } = await repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const myMoney = snapshot.balances
    .filter((bucket) => bucket.account.status === ACCOUNT_STATUSES.ACTIVE)
    .filter((bucket) => bucket.account.valueKind === VALUE_KINDS.CASH || bucket.account.valueKind === VALUE_KINDS.BANK)
    .sort((a, b) => Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd))
    .slice(0, 5)
  const receivables = snapshot.balances
    .filter((bucket) => bucket.account.status === ACCOUNT_STATUSES.ACTIVE)
    .filter((bucket) => bucket.account.valueKind === VALUE_KINDS.RECEIVABLE)
    .sort((a, b) => Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd))
    .slice(0, 10)
  const rows = [
    ...myMoney.map((bucket) => accountBlockquote(bucket.account, bucket)),
    ...(myMoney.length && receivables.length ? [''] : []),
    ...receivables.map((bucket) => accountBlockquote(bucket.account, bucket)),
  ]
  return sendScreen(ctx, rows.length ? `<b>الحسابات الأهم</b>\n\n${rows.join('\n')}` : '<b>لا توجد حسابات.</b>')
}

async function showToday(ctx) {
  const { state } = await repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const rows = movementsForToday(state)
    .slice()
    .reverse()
    .slice(0, 10)
    .map((movement) => movementBlockquote(movement, snapshot.accountById))
  return sendScreen(ctx, rows.length ? `<b>حركات اليوم</b>\n\n${rows.join('\n')}` : '<b>لا توجد حركات اليوم.</b>')
}

async function showHistory(ctx) {
  const { state } = await repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const rows = state.movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && !movement.id?.startsWith('opening-'))
    .slice()
    .reverse()
    .slice(0, 14)
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  return sendScreen(ctx, rows.length ? `<b>آخر الحركات</b>\n\n${rows.join('\n')}` : '<b>لا توجد حركات.</b>')
}

async function showReview(ctx) {
  const { state } = await repository.load()
  const accounts = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
  const movements = state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const lines = ['<b>المراجعة</b>']
  if (!accounts.length && !movements.length) lines.push('', 'لا توجد عناصر معلقة.')
  if (accounts.length) {
    lines.push('', '<b>حسابات:</b>')
    accounts.slice(0, 8).forEach((account) => lines.push(`- ${escapeHtml(accountLabel(account))}`))
  }
  if (movements.length) {
    lines.push('', '<b>حركات:</b>')
    movements.slice(0, 8).forEach((movement) => lines.push(`- ${escapeHtml(`${movementLabels[movement.type] || movement.type} ${formatMoney(movement.amount, movement.currency)}`)}`))
  }
  return sendScreen(ctx, lines.join('\n'))
}

async function startSearch(ctx) {
  sessions.set(ctx.chatId, ctx.userId, { flow: 'search', uiMessageId: ctx.isCallback ? ctx.messageId : null })
  return sendScreen(ctx, '<b>البحث</b>\n<blockquote>اكتب الاسم أو جزءًا منه.</blockquote>')
}

async function handleSearchText(ctx, text) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'search') return false
  const { state } = await repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const query = String(text || '').trim().toLowerCase()
  const rows = snapshot.balances
    .filter((bucket) => `${bucket.account.ownerName} ${bucket.account.subAccountName} ${bucket.account.legacyName || ''}`.toLowerCase().includes(query))
    .sort((a, b) => Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd))
    .slice(0, 12)
    .map((bucket) => accountBlockquote(bucket.account, bucket))
  const targetMessageId = session.uiMessageId
  sessions.clear(ctx.chatId, ctx.userId)
  await deleteUserInput(ctx)
  const textResult = rows.length ? `<b>نتائج البحث</b>\n\n${rows.join('\n')}` : '<b>لا توجد نتيجة.</b>'
  if (targetMessageId) {
    try {
      return await telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: targetMessageId,
        text: textResult,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    } catch {
      // Fall back to a new result if Telegram can no longer edit the search card.
    }
  }
  return telegram.sendMessage({ chat_id: ctx.chatId, text: textResult, parse_mode: 'HTML', reply_markup: mainMenuKeyboard() })
}

async function handleCallback(update) {
  const ctx = contextFor(update)
  const data = update.callback_query?.data || ''
  console.log('[mohammad-telegram-bot] callback', {
    userId: ctx.userId,
    data,
  })
  await telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })

  if (data === 'main:movement') return startMovement(ctx)
  if (data === 'main:account') return startAccount(ctx)
  if (data === 'main:accounts') return showAccounts(ctx)
  if (data === 'main:today') return showToday(ctx)
  if (data === 'main:history') return showHistory(ctx)
  if (data === 'main:review') return showReview(ctx)
  if (data === 'main:search') return startSearch(ctx)
  if (data.startsWith('acct:')) return handleAccountCallback(ctx, data)
  if (data.startsWith('mv:')) return handleMovementCallback(ctx, data)
  return sendScreen(ctx, 'أمر غير معروف.')
}

async function handleMessage(update) {
  const ctx = contextFor(update)
  const text = String(update.message?.text || '').trim()
  console.log('[mohammad-telegram-bot] message', {
    userId: ctx.userId,
    text: text.slice(0, 32),
  })
  if (!text) return null
  if (text === '/start' || text === 'القائمة') return showMainMenu(ctx)
  if (await handleMovementText(ctx, text)) {
    await deleteUserInput(ctx)
    return null
  }
  if (await handleAccountText(ctx, text)) {
    await deleteUserInput(ctx)
    return null
  }
  if (await handleSearchText(ctx, text)) return null
  return telegram.sendMessage({
    chat_id: ctx.chatId,
    text: '<b>اكتب /start لفتح القائمة.</b>',
    parse_mode: 'HTML',
    reply_markup: mainMenuKeyboard(),
  })
}

async function handleUpdate(update) {
  const ctx = contextFor(update)
  if (!isAllowed(ctx.user)) {
    if (ctx.chatId) {
      await telegram.sendMessage({ chat_id: ctx.chatId, text: '<b>هذا الدفتر خاص وغير مسموح لهذا المستخدم.</b>', parse_mode: 'HTML' })
    }
    return
  }
  if (update.callback_query) return handleCallback(update)
  if (update.message) return handleMessage(update)
}

async function poll() {
  await skipOldUpdates()
  while (true) {
    try {
      const updates = await telegram.getUpdates({ offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
      for (const update of updates) {
        offset = update.update_id + 1
        await handleUpdate(update)
      }
    } catch (error) {
      console.error('[mohammad-telegram-bot]', error?.message || error)
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }
}

poll()
