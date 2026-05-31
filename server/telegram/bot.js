import { MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { createLedgerRepository, parseTelegramLedgerMap, resolveTelegramLedgerId } from '../mohammadLedger/ledgerRepository.js'
import { accountLabel, buildLedgerSnapshot, formatMoney } from '../mohammadLedger/ledgerService.js'
import { mainMenuKeyboard } from './keyboards.js'
import { accountBlockquote, escapeHtml, mainMenuText, movementBlockquote, movementLabels } from './messages.js'
import { createSessionStore } from './sessionStore.js'
import { createTelegramClient } from './telegramClient.js'
import { handleAccountCallback, handleAccountText, startAccount } from './handlers/account.js'
import { handleMovementCallback, handleMovementText, startMovement } from './handlers/movement.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('[adreem-telegram-bot] missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}
const allowedUserIds = String(
  process.env.ADREEM_TELEGRAM_USER_IDS ||
  process.env.ADREEM_TELEGRAM_USER_ID ||
  process.env.MOHAMMAD_TELEGRAM_USER_IDS ||
  process.env.MOHAMMAD_TELEGRAM_USER_ID ||
  '',
)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const telegramLedgerMap = parseTelegramLedgerMap(process.env.ADREEM_TELEGRAM_LEDGER_IDS || process.env.MOHAMMAD_TELEGRAM_LEDGER_IDS)
const ledgerMapProblem = validateTelegramLedgerMap(allowedUserIds, telegramLedgerMap)
if (ledgerMapProblem) {
  console.error('[adreem-telegram-bot] invalid ADREEM_TELEGRAM_LEDGER_IDS:', ledgerMapProblem)
  process.exit(1)
}

const telegram = createTelegramClient(token)
const repositoriesByLedgerId = new Map()
const sessions = createSessionStore()

let offset = 0

console.log('[adreem-telegram-bot] starting', {
  allowedUsers: allowedUserIds.length,
  mappedLedgers: telegramLedgerMap.size,
})

function repositoryForUser(userId) {
  const ledgerId = resolveTelegramLedgerId(userId, process.env)
  if (!repositoriesByLedgerId.has(ledgerId)) {
    repositoriesByLedgerId.set(ledgerId, createLedgerRepository(process.env, { ledgerId }))
  }
  return repositoriesByLedgerId.get(ledgerId)
}

function validateTelegramLedgerMap(userIds, ledgerMap) {
  if (userIds.length <= 1 && ledgerMap.size === 0) return ''
  const missing = userIds.filter((userId) => !ledgerMap.has(String(userId)))
  if (missing.length) return `missing ledger mapping for user id(s): ${missing.join(', ')}`
  const seen = new Map()
  for (const userId of userIds) {
    const ledgerId = ledgerMap.get(String(userId))
    const existingUserId = seen.get(ledgerId)
    if (existingUserId) return `ledger "${ledgerId}" is assigned to both ${existingUserId} and ${userId}`
    seen.set(ledgerId, userId)
  }
  return ''
}

async function skipOldUpdates() {
  if (process.env.TELEGRAM_SKIP_OLD_UPDATES === 'false') return
  const updates = await telegram.getUpdates({ offset: -1, timeout: 0, allowed_updates: ['message', 'callback_query'] })
  if (updates.length) {
    offset = updates[updates.length - 1].update_id + 1
    console.log('[adreem-telegram-bot] skipped old updates', { nextOffset: offset })
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
    repository: null,
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
  const { state } = await ctx.repository.load()
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
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
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
  const sections = []
  if (myMoney.length) {
    sections.push(`<b>مالي عندي</b>\n${myMoney.map((bucket) => accountBlockquote(bucket.account, bucket)).join('\n')}`)
  }
  if (receivables.length) {
    sections.push(`<b>الناس والجهات</b>\n${receivables.map((bucket) => accountBlockquote(bucket.account, bucket)).join('\n')}`)
  }
  return sendScreen(ctx, sections.length ? `<b>ADREEM · الأرصدة</b>\n<code>${myMoney.length + receivables.length} حساب ظاهر</code>\n\n${sections.join('\n\n')}` : '<b>ADREEM · الأرصدة</b>\n<blockquote>لا توجد حسابات.\nابدأ من زر + حساب جديد.</blockquote>')
}

async function showToday(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const rows = movementsForToday(state)
    .slice()
    .reverse()
    .slice(0, 10)
    .map((movement) => movementBlockquote(movement, snapshot.accountById))
  return sendScreen(ctx, rows.length ? `<b>ADREEM · سجل اليوم</b>\n<code>${rows.length} حركة</code>\n\n${rows.join('\n')}` : '<b>ADREEM · سجل اليوم</b>\n<blockquote>لا توجد حركات اليوم.</blockquote>')
}

async function showHistory(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const rows = state.movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && !movement.id?.startsWith('opening-'))
    .slice()
    .reverse()
    .slice(0, 14)
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  return sendScreen(ctx, rows.length ? `<b>ADREEM · السجل</b>\n<code>${rows.length} حركة أخيرة</code>\n\n${rows.join('\n')}` : '<b>ADREEM · السجل</b>\n<blockquote>لا توجد حركات.</blockquote>')
}

async function showReview(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const accounts = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
  const movements = state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const lines = ['<b>ADREEM · مراجعة</b>', `<code>${accounts.length + movements.length} عنصر</code>`]
  if (!accounts.length && !movements.length) lines.push('', '<blockquote>لا شيء معلق.</blockquote>')
  if (accounts.length) {
    lines.push('', '<b>حسابات</b>')
    accounts.slice(0, 8).forEach((account) => lines.push(`<blockquote>${escapeHtml(accountLabel(account))}</blockquote>`))
  }
  if (movements.length) {
    lines.push('', '<b>حركات</b>')
    movements.slice(0, 8).forEach((movement) => lines.push(`<blockquote>${escapeHtml(`${movementLabels[movement.type] || movement.type} · ${formatMoney(movement.amount, movement.currency)}`)}</blockquote>`))
  }
  return sendScreen(ctx, lines.join('\n'))
}

async function startSearch(ctx) {
  sessions.set(ctx.chatId, ctx.userId, { flow: 'search', uiMessageId: ctx.isCallback ? ctx.messageId : null })
  return sendScreen(ctx, '<b>ADREEM · بحث</b>\n<blockquote>اكتب اسم شخص، جهة، كاش، أو مصرف.</blockquote>')
}

async function handleSearchText(ctx, text) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'search') return false
  const { state } = await ctx.repository.load()
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
  const textResult = rows.length ? `<b>ADREEM · نتائج البحث</b>\n<code>${rows.length} نتيجة</code>\n\n${rows.join('\n')}` : '<b>ADREEM · بحث</b>\n<blockquote>لا توجد نتيجة.</blockquote>'
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

async function handleCallback(ctx, update) {
  const data = update.callback_query?.data || ''
  console.log('[adreem-telegram-bot] callback', {
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

async function handleMessage(ctx, update) {
  const text = String(update.message?.text || '').trim()
  console.log('[adreem-telegram-bot] message', {
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
    text: '<b>افتح ADREEM من /start</b>',
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
  ctx.repository = repositoryForUser(ctx.userId)
  if (update.callback_query) return handleCallback(ctx, update)
  if (update.message) return handleMessage(ctx, update)
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
      console.error('[adreem-telegram-bot]', error?.message || error)
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }
}

poll()
