import { MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { buildLedgerAlerts, dueRecurringRules } from '../../src/mohammadLedger/ledgerOperations.js'
import { createLedgerRepository } from '../mohammadLedger/ledgerRepository.js'
import { createLedgerIdentity } from '../../src/mohammadLedger/ledgerState.js'
import { accountLabel, buildLedgerSnapshot, formatMoney } from '../mohammadLedger/ledgerService.js'
import { historyCancelConfirmKeyboard, historyKeyboard, mainMenuKeyboard, reviewKeyboard } from './keyboards.js'
import { accountBlockquote, alertsText, escapeHtml, mainMenuText, movementBlockquote, movementLabels } from './messages.js'
import { buildReviewSession, cancelReviewMovementInState, hideZeroReviewAccountInState } from './reviewActions.js'
import { buildHistorySession, recentHistoryMovements, voidRecentMovementInState } from './historyActions.js'
import { createSessionStore } from './sessionStore.js'
import { createTelegramClient } from './telegramClient.js'
import { handleAccountCallback, handleAccountText, startAccount, startReviewAccount } from './handlers/account.js'
import { handleMovementCallback, handleMovementText, startMovement, startReviewMovement } from './handlers/movement.js'
import { handleReconciliationCallback, handleReconciliationText, startReconciliation } from './handlers/reconciliation.js'
import { createTelegramUserAccess } from './userRegistry.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('[adreem-telegram-bot] missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}
const userAccess = createTelegramUserAccess(process.env)
const ledgerMapProblem = validateTelegramLedgerMap(userAccess)
if (ledgerMapProblem) {
  console.error('[adreem-telegram-bot] invalid ADREEM_TELEGRAM_LEDGER_IDS:', ledgerMapProblem)
  process.exit(1)
}

const telegram = createTelegramClient(token)
const repositoriesByLedgerId = new Map()
const sessions = createSessionStore()

let offset = 0

console.log('[adreem-telegram-bot] starting', {
  admins: userAccess.adminIds.length,
  envUsers: userAccess.envUserIds.length,
  envMappedLedgers: userAccess.envLedgerMap.size,
  registry: userAccess.filePath,
})

function repositoryForUser(userId) {
  const ledgerId = userAccess.ledgerIdForUser(userId) || createLedgerIdentity({
    ledgerId: process.env.ADREEM_LEDGER_ID || process.env.VITE_ADREEM_LEDGER_ID,
  }).ledgerId
  if (!repositoriesByLedgerId.has(ledgerId)) {
    repositoriesByLedgerId.set(ledgerId, createLedgerRepository(process.env, { ledgerId }))
  }
  return repositoriesByLedgerId.get(ledgerId)
}

function validateTelegramLedgerMap(access) {
  const seen = new Map()
  for (const [userId, ledgerId] of access.envLedgerMap.entries()) {
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
  return userAccess.isAllowed(user.id)
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
    sections.push(`<b>فلوسي عندي</b>\n${myMoney.map((bucket) => accountBlockquote(bucket.account, bucket)).join('\n')}`)
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

async function showHistory(ctx, notice = '') {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const historySession = buildHistorySession(state)
  sessions.set(ctx.chatId, ctx.userId, { ...historySession, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const rows = recentHistoryMovements(state)
    .slice(0, 14)
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  const noticeBlock = notice ? `\n\n<blockquote>${escapeHtml(notice)}</blockquote>` : ''
  return sendScreen(
    ctx,
    rows.length ? `<b>ADREEM · السجل</b>\n<code>${rows.length} حركة أخيرة</code>${noticeBlock}\n\n${rows.join('\n')}` : `<b>ADREEM · السجل</b>${noticeBlock}\n<blockquote>لا توجد حركات.</blockquote>`,
    historyKeyboard(historySession),
  )
}

async function showAlerts(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const reviewAccounts = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
  const reviewMovements = state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const iOwePeople = snapshot.balances
    .filter((bucket) => bucket.account?.valueKind === VALUE_KINDS.RECEIVABLE)
    .reduce((total, bucket) => total + Math.max(0, -Math.round(Number(bucket.dinar || 0))), 0)
  const reconciliationDiffCount = (state.reconciliations || []).filter((item) =>
    Math.round(Number(item.actualDinar || 0)) !== Math.round(Number(item.expectedDinar || 0)) ||
    Math.round(Number(item.actualUsd || 0)) !== Math.round(Number(item.expectedUsd || 0)),
  ).length
  const alerts = buildLedgerAlerts({
    reviewAccounts,
    reviewMovements,
    balances: snapshot.balances,
    movements: state.movements,
    totals: { iOwePeople },
    dueRecurringCount: dueRecurringRules(state.recurringRules).length,
    reconciliationDiffCount,
  })
  return sendScreen(ctx, alertsText(alerts))
}

async function showReview(ctx, notice = '') {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const accounts = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
  const movements = state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const reviewSession = buildReviewSession(state)
  sessions.set(ctx.chatId, ctx.userId, { ...reviewSession, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const lines = ['<b>ADREEM · مراجعة</b>', `<code>${accounts.length + movements.length} عنصر</code>`]
  if (notice) lines.push('', `<blockquote>${escapeHtml(notice)}</blockquote>`)
  if (!accounts.length && !movements.length) lines.push('', '<blockquote>لا شيء معلق.</blockquote>')
  if (accounts.length) {
    lines.push('', '<b>حسابات</b>')
    accounts.slice(0, 8).forEach((account, index) => lines.push(`<blockquote>${escapeHtml(`#${index + 1} · ${accountLabel(account)}`)}</blockquote>`))
  }
  if (movements.length) {
    lines.push('', '<b>حركات</b>')
    movements.slice(0, 8).forEach((movement, index) => lines.push(`<blockquote>${escapeHtml(`#${index + 1} · ${movementLabels[movement.type] || movement.type} · ${formatMoney(movement.amount, movement.currency)}`)}</blockquote>`))
  }
  return sendScreen(ctx, lines.join('\n'), reviewKeyboard(reviewSession))
}

async function handleReviewCallback(ctx, data) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'review') {
    return showReview(ctx, 'هذه أزرار مراجعة قديمة. فتحت لك القائمة الأحدث.')
  }

  const [, kind, action, token] = data.split(':')
  if (kind === 'movement' && action === 'cancel') {
    const movementId = session.choices?.movements?.[token]
    if (!movementId) return showReview(ctx, 'هذا العنصر لم يعد موجودًا في القائمة.')
    const result = await ctx.repository.update((state) => cancelReviewMovementInState(state, movementId))
    return showReview(ctx, result.message)
  }
  if (kind === 'movement' && action === 'fix') {
    const movementId = session.choices?.movements?.[token]
    if (!movementId) return showReview(ctx, 'هذا العنصر لم يعد موجودًا في القائمة.')
    return startReviewMovement(ctx, movementId)
  }
  if (kind === 'account' && action === 'hide') {
    const accountId = session.choices?.accounts?.[token]
    if (!accountId) return showReview(ctx, 'هذا الحساب لم يعد موجودًا في القائمة.')
    const result = await ctx.repository.update((state) => hideZeroReviewAccountInState(state, accountId))
    return showReview(ctx, result.message)
  }
  if (kind === 'account' && action === 'fix') {
    const accountId = session.choices?.accounts?.[token]
    if (!accountId) return showReview(ctx, 'هذا الحساب لم يعد موجودًا في القائمة.')
    return startReviewAccount(ctx, accountId)
  }
  return showReview(ctx, 'أمر المراجعة غير معروف.')
}

async function handleHistoryCallback(ctx, data) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'history') {
    return showHistory(ctx)
  }

  const [, action, token] = data.split(':')
  const movementId = session.choices?.movements?.[token]
  if (!movementId) return showHistory(ctx)

  if (action === 'cancel') {
    const { state } = await ctx.repository.load()
    const snapshot = buildLedgerSnapshot(state)
    const movement = state.movements.find((item) => item.id === movementId)
    const text = [
      '<b>تأكيد إلغاء الحركة</b>',
      '<code>الإلغاء يبقي الحركة في السجل كملغية</code>',
      '',
      movementBlockquote(movement, snapshot.accountById, { includeDate: true }),
    ].join('\n')
    return sendScreen(ctx, text, historyCancelConfirmKeyboard(token))
  }

  if (action === 'confirm') {
    const result = await ctx.repository.update((state) => voidRecentMovementInState(state, movementId))
    return showHistory(ctx, result.message)
  }

  return showHistory(ctx)
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

function helpAdminText() {
  return [
    '<b>ADREEM · إدارة المستخدمين</b>',
    '<blockquote>الأوامر:',
    '/myid',
    '/users',
    '/adduser TELEGRAM_ID LEDGER_ID',
    '',
    'مثال:',
    '/adduser 555 saeed-book</blockquote>',
  ].join('\n')
}

function parseAddUserCommand(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 3) return null
  return {
    telegramUserId: parts[1],
    ledgerId: parts[2],
  }
}

async function handleAdminCommand(ctx, text) {
  if (text === '/myid') {
    return telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `<b>Telegram ID</b>\n<blockquote>${escapeHtml(String(ctx.userId || ''))}</blockquote>`,
      parse_mode: 'HTML',
    })
  }
  if (!userAccess.isAdmin(ctx.userId)) return false
  if (text === '/admin' || text === '/helpadmin') {
    return telegram.sendMessage({ chat_id: ctx.chatId, text: helpAdminText(), parse_mode: 'HTML' })
  }
  if (text === '/users') {
    const users = userAccess.listUsers()
    const rows = users.length
      ? users.map((user) => `${user.source === 'env' ? 'ثابت' : 'مضاف'} · ${user.telegramUserId} · ${user.ledgerId}`).join('\n')
      : 'لا يوجد مستخدمون.'
    return telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `<b>ADREEM · المستخدمون</b>\n<blockquote>${escapeHtml(rows)}</blockquote>`,
      parse_mode: 'HTML',
    })
  }
  if (text.startsWith('/adduser')) {
    const parsed = parseAddUserCommand(text)
    if (!parsed) {
      return telegram.sendMessage({ chat_id: ctx.chatId, text: helpAdminText(), parse_mode: 'HTML' })
    }
    const result = userAccess.addUser({
      ...parsed,
      addedBy: ctx.userId,
      firstName: ctx.user?.first_name,
      username: ctx.user?.username,
    })
    if (!result.ok) {
      const message = result.error === 'ledger-used'
        ? `هذا الدفتر مستخدم بالفعل للمستخدم ${result.existingUserId}. اختر ledgerId آخر.`
        : 'لم أستطع إضافة المستخدم. تأكد من Telegram ID واسم الدفتر.'
      return telegram.sendMessage({ chat_id: ctx.chatId, text: `<b>لم تتم الإضافة</b>\n<blockquote>${escapeHtml(message)}</blockquote>`, parse_mode: 'HTML' })
    }
    return telegram.sendMessage({
      chat_id: ctx.chatId,
      text: [
        '<b>تمت إضافة مستخدم مستقل</b>',
        `<blockquote>Telegram: ${escapeHtml(result.entry.telegramUserId)}`,
        `Ledger: ${escapeHtml(result.entry.ledgerId)}`,
        `Row: ${escapeHtml(result.rowId)}`,
        '',
        'رابط الويب الخاص:',
        `${escapeHtml(result.webUrl)}`,
        '',
        'يمكنه الآن فتح /start وسيعمل داخل دفتره فقط.</blockquote>',
      ].join('\n'),
      parse_mode: 'HTML',
    })
  }
  return false
}

async function handleCallback(ctx, update) {
  const data = update.callback_query?.data || ''
  console.log('[adreem-telegram-bot] callback', {
    userId: ctx.userId,
    data,
  })
  await telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })

  if (data === 'main:movement') return startMovement(ctx)
  if (data === 'main:home') return showMainMenu(ctx)
  if (data === 'main:account') return startAccount(ctx)
  if (data === 'main:accounts') return showAccounts(ctx)
  if (data === 'main:today') return showToday(ctx)
  if (data === 'main:history') return showHistory(ctx)
  if (data === 'main:review') return showReview(ctx)
  if (data === 'main:search') return startSearch(ctx)
  if (data === 'main:alerts') return showAlerts(ctx)
  if (data === 'main:reconcile') return startReconciliation(ctx)
  if (data.startsWith('review:')) return handleReviewCallback(ctx, data)
  if (data.startsWith('history:')) return handleHistoryCallback(ctx, data)
  if (data.startsWith('acct:')) return handleAccountCallback(ctx, data)
  if (data.startsWith('mv:')) return handleMovementCallback(ctx, data)
  if (data.startsWith('rec:')) return handleReconciliationCallback(ctx, data)
  return sendScreen(ctx, 'أمر غير معروف.')
}

async function handleMessage(ctx, update) {
  const text = String(update.message?.text || '').trim()
  console.log('[adreem-telegram-bot] message', {
    userId: ctx.userId,
    text: text.slice(0, 32),
  })
  if (!text) return null
  if (await handleAdminCommand(ctx, text)) return null
  if (text === '/start' || text === 'القائمة') return showMainMenu(ctx)
  if (await handleMovementText(ctx, text)) {
    await deleteUserInput(ctx)
    return null
  }
  if (await handleAccountText(ctx, text)) {
    await deleteUserInput(ctx)
    return null
  }
  if (await handleReconciliationText(ctx, text)) {
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
      await telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `<b>هذا الدفتر خاص.</b>\n<blockquote>أرسل هذا الرقم لصاحب النظام ليضيفك:\n${escapeHtml(String(ctx.user?.id || ''))}</blockquote>`,
        parse_mode: 'HTML',
      })
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
