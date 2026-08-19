import { CURRENCIES, MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { normalizeAccountSearchText } from '../../src/mohammadLedger/movementAccounts.js'
import {
  buildDimensionReports,
  buildExpenseCategoryReports,
  buildLedgerAlerts,
  dueRecurringRules,
  executeRecurringRuleInState,
} from '../../src/mohammadLedger/ledgerOperations.js'
import { createLedgerRepository } from '../mohammadLedger/ledgerRepository.js'
import { accountLabel, buildLedgerSnapshot, formatMoney } from '../mohammadLedger/ledgerService.js'
import {
  accountChoiceToken,
  accountProfileKeyboard,
  accountsBrowserKeyboard,
  historyCancelConfirmKeyboard,
  historyKeyboard,
  mainMenuKeyboard,
  moreMenuKeyboard,
  recurringRulesKeyboard,
  reportKeyboard,
  reviewKeyboard,
} from './keyboards.js'
import { accountBlockquote, alertsText, escapeHtml, mainMenuText, movementBlockquote, movementLabels } from './messages.js'
import { buildReviewSession, cancelReviewMovementInState, hideZeroReviewAccountInState } from './reviewActions.js'
import { buildHistorySession, HISTORY_ACTION_LIMIT, recentHistoryMovements, voidRecentMovementInState } from './historyActions.js'
import { createSessionStore } from './sessionStore.js'
import { createTelegramClient } from './telegramClient.js'
import { handleAccountCallback, handleAccountText, startAccount, startReviewAccount } from './handlers/account.js'
import { handleMovementCallback, handleMovementMedia, handleMovementText, startMovement, startReviewMovement } from './handlers/movement.js'
import { handleReconciliationCallback, handleReconciliationText, startReconciliation } from './handlers/reconciliation.js'
import { createTelegramUserAccess, validateTelegramLedgerAssignments } from './userRegistry.js'
import { buildRecurringSession, disableRecurringRuleInState } from './recurringActions.js'
import { parseActionCallback } from './actionTokens.js'
import { isPrivateTelegramUpdate, processTelegramUpdates, shouldSkipOldUpdates } from './updateSafety.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('[adreem-telegram-bot] missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}
const userAccess = createTelegramUserAccess(process.env)
const ledgerMapProblem = validateTelegramLedgerAssignments(userAccess)
if (ledgerMapProblem) {
  console.error('[adreem-telegram-bot] invalid Telegram ledger assignments:', ledgerMapProblem)
  process.exit(1)
}

const telegram = createTelegramClient(token)
const repositoriesByLedgerId = new Map()
const sessions = createSessionStore()
const ACCOUNT_PAGE_SIZE = 8

let offset = 0

console.log('[adreem-telegram-bot] starting', {
  admins: userAccess.adminIds.length,
  envUsers: userAccess.envUserIds.length,
  envMappedLedgers: userAccess.envLedgerMap.size,
  registry: userAccess.filePath,
})

function repositoryForUser(userId) {
  const ledgerId = userAccess.ledgerIdForUser(userId)
  if (!ledgerId) return null
  if (!repositoriesByLedgerId.has(ledgerId)) {
    repositoriesByLedgerId.set(ledgerId, createLedgerRepository(process.env, { ledgerId }))
  }
  return repositoriesByLedgerId.get(ledgerId)
}

async function skipOldUpdates() {
  if (!shouldSkipOldUpdates(process.env)) return
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

async function showMoreMenu(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  return sendScreen(
    ctx,
    '<b>ADREEM · المزيد</b>\n<blockquote>أدوات أقل استعمالًا، في مكان واحد.</blockquote>',
    moreMenuKeyboard(),
  )
}

function movementsForToday(state) {
  const today = new Date()
  return state.movements.filter((movement) => {
    if (movement.status !== MOVEMENT_STATUSES.POSTED || movement.id?.startsWith('opening-')) return false
    const date = new Date(movement.createdAt || movement.updatedAt || '')
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
  })
}

async function showAccounts(ctx, requestedPage = 0) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const allBuckets = snapshot.balances
    .filter((bucket) => bucket.account.status === ACCOUNT_STATUSES.ACTIVE)
    .sort((a, b) => Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd))
  const pageCount = Math.max(1, Math.ceil(allBuckets.length / ACCOUNT_PAGE_SIZE))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const visibleBuckets = allBuckets.slice(page * ACCOUNT_PAGE_SIZE, (page + 1) * ACCOUNT_PAGE_SIZE)
  const session = {
    flow: 'accounts',
    page,
    pageCount,
    choices: {
      accounts: Object.fromEntries(visibleBuckets.map((bucket) => [accountChoiceToken(bucket.account), bucket.account.id])),
    },
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  const myMoney = allBuckets.filter((bucket) => bucket.account.valueKind === VALUE_KINDS.CASH || bucket.account.valueKind === VALUE_KINDS.BANK)
  const people = allBuckets.filter((bucket) => bucket.account.valueKind === VALUE_KINDS.RECEIVABLE)
  const moneyDinar = myMoney.reduce((sum, bucket) => sum + Number(bucket.dinar || 0), 0)
  const collectDinar = people.reduce((sum, bucket) => sum + Math.max(0, Number(bucket.dinar || 0)), 0)
  const payDinar = people.reduce((sum, bucket) => sum + Math.max(0, -Number(bucket.dinar || 0)), 0)
  const text = allBuckets.length
    ? `<b>ADREEM · الأرصدة</b>\n<code>${allBuckets.length} حساب · صفحة ${page + 1}/${pageCount}</code>\n\n<blockquote>${escapeHtml(`فلوسي: ${formatMoney(moneyDinar)}\nأقبض: ${formatMoney(collectDinar)}\nأدفع: ${formatMoney(payDinar)}`)}</blockquote>\n\n<b>افتح حسابًا</b>`
    : '<b>ADREEM · الأرصدة</b>\n<blockquote>لا توجد حسابات.\nأنشئ حسابًا من «المزيد».</blockquote>'
  return sendScreen(ctx, text, accountsBrowserKeyboard(visibleBuckets, session))
}

async function handleAccountsCallback(ctx, data) {
  if (data.startsWith('accounts:page:')) return showAccounts(ctx, Number(data.slice('accounts:page:'.length)))
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'accounts') return showAccounts(ctx)
  const token = data.slice('accounts:open:'.length)
  const accountId = session.choices?.accounts?.[token]
  if (!accountId) return showAccounts(ctx, session.page)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const account = snapshot.accountById.get(accountId)
  const bucket = snapshot.balanceByAccountId.get(accountId)
  if (!account || !bucket) return showAccounts(ctx, session.page)
  const movements = (state.movements || [])
    .filter((movement) => movement.sourceAccountId === accountId || movement.destinationAccountId === accountId)
    .slice()
    .reverse()
    .slice(0, 8)
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  const text = [
    '<b>ADREEM · الحساب</b>',
    '',
    accountBlockquote(account, bucket),
    '',
    `<b>آخر الحركات · ${movements.length}</b>`,
    movements.length ? movements.join('\n') : '<blockquote>لا توجد حركات لهذا الحساب.</blockquote>',
  ].join('\n')
  return sendScreen(ctx, text, accountProfileKeyboard(session.page))
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

async function showHistory(ctx, notice = '', requestedPage = 0) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const historySession = buildHistorySession(state, HISTORY_ACTION_LIMIT, requestedPage)
  sessions.set(ctx.chatId, ctx.userId, { ...historySession, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const rows = recentHistoryMovements(state)
    .slice(historySession.page * HISTORY_ACTION_LIMIT, (historySession.page + 1) * HISTORY_ACTION_LIMIT)
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  const noticeBlock = notice ? `\n\n<blockquote>${escapeHtml(notice)}</blockquote>` : ''
  return sendScreen(
    ctx,
    rows.length ? `<b>ADREEM · الحركات</b>\n<code>${historySession.total} حركة · صفحة ${historySession.page + 1}/${historySession.pageCount}</code>${noticeBlock}\n\n${rows.join('\n')}` : `<b>ADREEM · الحركات</b>${noticeBlock}\n<blockquote>لا توجد حركات.</blockquote>`,
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

async function showReports(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const projects = buildDimensionReports(state)
  const expenses = buildExpenseCategoryReports(state)
  const lines = ['<b>ADREEM · التقارير</b>']
  lines.push('', '<b>المشاريع والأصول</b>')
  if (!projects.length) lines.push('<blockquote>لا توجد بيانات بعد.</blockquote>')
  projects.slice(0, 6).forEach((item) => {
    const dinar = `دخل ${formatMoney(item.income)} · مصروف ${formatMoney(item.expense)} · صافي ${formatMoney(item.net)}`
    const usd = item.incomeUsd || item.expenseUsd
      ? `\nدولار: دخل ${formatMoney(item.incomeUsd, CURRENCIES.USD)} · مصروف ${formatMoney(item.expenseUsd, CURRENCIES.USD)} · صافي ${formatMoney(item.netUsd, CURRENCIES.USD)}`
      : ''
    lines.push(`<blockquote>${escapeHtml(`${item.dimension.name}\n${dinar}${usd}`)}</blockquote>`)
  })
  lines.push('', '<b>المصروفات</b>')
  if (!expenses.length) lines.push('<blockquote>لا توجد مصروفات مصنفة.</blockquote>')
  expenses.slice(0, 6).forEach((item) => {
    const usd = item.usd ? ` · ${formatMoney(item.usd, CURRENCIES.USD)}` : ''
    lines.push(`<blockquote>${escapeHtml(`${item.name}\n${formatMoney(item.dinar)}${usd}`)}</blockquote>`)
  })
  return sendScreen(ctx, lines.join('\n'), reportKeyboard())
}

async function showRecurring(ctx, notice = '') {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const session = buildRecurringSession(state)
  sessions.set(ctx.chatId, ctx.userId, { ...session, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const byId = new Map((state.recurringRules || []).map((rule) => [rule.id, rule]))
  const dueRuleIds = new Set(session.dueRuleIds)
  const rules = Object.values(session.choices.rules).map((id) => byId.get(id)).filter(Boolean)
  const lines = ['<b>ADREEM · الحركات الشهرية</b>', `<code>${rules.length} فعالة · ${dueRuleIds.size} مستحقة</code>`]
  if (notice) lines.push('', `<blockquote>${escapeHtml(notice)}</blockquote>`)
  if (!rules.length) lines.push('', '<blockquote>لا توجد حركة شهرية.</blockquote>')
  rules.forEach((rule, index) => {
    const amount = formatMoney(rule.template?.amount, rule.template?.currency)
    const status = dueRuleIds.has(rule.id) ? 'مستحقة الآن' : 'غير مستحقة'
    lines.push('', `<blockquote>${escapeHtml(`#${index + 1} · ${rule.name}\n${amount} · يوم ${rule.dayOfMonth || 1}\n${status}`)}</blockquote>`)
  })
  return sendScreen(ctx, lines.join('\n'), recurringRulesKeyboard(session))
}

async function handleRecurringCallback(ctx, data) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'recurring') return sendScreen(ctx, '<b>هذه أزرار تكرار قديمة.</b>\n<blockquote>افتح الحركات الشهرية من القائمة لعرض الأحدث.</blockquote>')
  const [action, token] = parseActionCallback(data, 'repeat', session) || []
  if (!action || !token) return sendScreen(ctx, '<b>انتهت صلاحية هذه البطاقة.</b>\n<blockquote>بطاقة الحركات الشهرية الحالية لم تتغير.</blockquote>')
  const ruleId = session.choices?.rules?.[token]
  if (!ruleId) return showRecurring(ctx, 'هذه الحركة لم تعد في القائمة.')
  const result = action === 'run'
    ? await ctx.repository.update((state) => executeRecurringRuleInState(state, ruleId))
    : action === 'disable'
      ? await ctx.repository.update((state) => disableRecurringRuleInState(state, ruleId))
      : { message: 'الأمر غير معروف.' }
  return showRecurring(ctx, result.message)
}

async function showReview(ctx, notice = '', requestedPage = 0) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const reviewSession = buildReviewSession(state, undefined, requestedPage)
  sessions.set(ctx.chatId, ctx.userId, { ...reviewSession, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const pageLabel = reviewSession.pageCount > 1 ? ` · صفحة ${reviewSession.page + 1}/${reviewSession.pageCount}` : ''
  const lines = ['<b>ADREEM · مراجعة</b>', `<code>${reviewSession.total} عنصر${pageLabel}</code>`]
  if (notice) lines.push('', `<blockquote>${escapeHtml(notice)}</blockquote>`)
  if (!reviewSession.total) lines.push('', '<blockquote>لا شيء معلق.</blockquote>')
  reviewSession.items.forEach((item) => {
    const description = item.kind === 'account'
      ? `حساب · ${accountLabel(item.value)}`
      : `حركة · ${movementLabels[item.value.type] || item.value.type} · ${formatMoney(item.value.amount, item.value.currency)}`
    lines.push(`<blockquote>${escapeHtml(`#${item.number} · ${description}`)}</blockquote>`)
  })
  return sendScreen(ctx, lines.join('\n'), reviewKeyboard(reviewSession))
}

async function handleReviewCallback(ctx, data) {
  if (data.startsWith('review:page:')) {
    return showReview(ctx, '', Number(data.slice('review:page:'.length)))
  }
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'review') {
    return sendScreen(ctx, '<b>هذه أزرار مراجعة قديمة.</b>\n<blockquote>افتح المراجعة من القائمة لعرض الأحدث.</blockquote>')
  }

  const [kind, action, token] = parseActionCallback(data, 'review', session) || []
  if (!kind || !action || !token) {
    return sendScreen(ctx, '<b>انتهت صلاحية هذه البطاقة.</b>\n<blockquote>بطاقة المراجعة الحالية لم تتغير.</blockquote>')
  }
  if (kind === 'movement' && action === 'cancel') {
    const movementId = session.choices?.movements?.[token]
    if (!movementId) return showReview(ctx, 'هذا العنصر لم يعد موجودًا في القائمة.')
    const result = await ctx.repository.update((state) => cancelReviewMovementInState(state, movementId))
    return showReview(ctx, result.message, session.page)
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
    return showReview(ctx, result.message, session.page)
  }
  if (kind === 'account' && action === 'fix') {
    const accountId = session.choices?.accounts?.[token]
    if (!accountId) return showReview(ctx, 'هذا الحساب لم يعد موجودًا في القائمة.')
    return startReviewAccount(ctx, accountId)
  }
  return showReview(ctx, 'أمر المراجعة غير معروف.')
}

async function handleHistoryCallback(ctx, data) {
  if (data.startsWith('history:page:')) return showHistory(ctx, '', Number(data.slice('history:page:'.length)))
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'history') {
    return sendScreen(ctx, '<b>هذه أزرار حركات قديمة.</b>\n<blockquote>افتح الحركات من القائمة لعرض الأحدث.</blockquote>')
  }

  const [action, token] = parseActionCallback(data, 'history', session) || []
  if (!action || !token) return sendScreen(ctx, '<b>انتهت صلاحية هذه البطاقة.</b>\n<blockquote>بطاقة الحركات الحالية لم تتغير.</blockquote>')
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
    return sendScreen(ctx, text, historyCancelConfirmKeyboard(session.actionSessionId, token))
  }

  if (action === 'confirm') {
    const result = await ctx.repository.update((state) => voidRecentMovementInState(state, movementId))
    return showHistory(ctx, result.message, session.page)
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
  const query = normalizeAccountSearchText(text)
  const results = snapshot.balances
    .filter((bucket) => bucket.account.status === ACCOUNT_STATUSES.ACTIVE)
    .filter((bucket) => normalizeAccountSearchText(`${bucket.account.ownerName} ${bucket.account.subAccountName} ${bucket.account.legacyName || ''}`).includes(query))
    .sort((a, b) => Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd))
    .slice(0, ACCOUNT_PAGE_SIZE)
  const targetMessageId = session.uiMessageId
  const resultSession = {
    flow: 'accounts',
    page: 0,
    pageCount: 1,
    choices: {
      accounts: Object.fromEntries(results.map((bucket) => [accountChoiceToken(bucket.account), bucket.account.id])),
    },
    uiMessageId: targetMessageId,
  }
  sessions.set(ctx.chatId, ctx.userId, resultSession)
  await deleteUserInput(ctx)
  const textResult = results.length
    ? `<b>ADREEM · نتائج البحث</b>\n<code>${results.length} نتيجة</code>\n\n<b>اختر الحساب</b>`
    : '<b>ADREEM · بحث</b>\n<blockquote>لا توجد نتيجة.</blockquote>'
  const replyMarkup = results.length ? accountsBrowserKeyboard(results, resultSession) : mainMenuKeyboard()
  if (targetMessageId) {
    try {
      return await telegram.editMessageText({
        chat_id: ctx.chatId,
        message_id: targetMessageId,
        text: textResult,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
    } catch {
      // Fall back to a new result if Telegram can no longer edit the search card.
    }
  }
  return telegram.sendMessage({ chat_id: ctx.chatId, text: textResult, parse_mode: 'HTML', reply_markup: replyMarkup })
}

function helpAdminText() {
  return [
    '<b>ADREEM · إدارة المستخدمين</b>',
    '<blockquote>الأوامر:',
    '/myid',
    '/users',
    '',
    'إضافة المستخدمين وتسجيل الدخول تتم من صفحة الإدارة فقط.</blockquote>',
  ].join('\n')
}

async function handleAdminCommand(ctx, text) {
  if (text === '/myid') {
    return telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `<b>رقم تيليغرام</b>\n<blockquote>${escapeHtml(String(ctx.userId || ''))}</blockquote>`,
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
    return telegram.sendMessage({
      chat_id: ctx.chatId,
      text: [
        '<b>إضافة المستخدمين من الويب فقط</b>',
        '<blockquote>استخدم صفحة إدارة مستخدمي ADREEM لإنشاء إيميل وكلمة مرور.',
        'التلقرام لا ينشئ مستخدمين حتى لا تتكرر مسارات الصلاحيات.</blockquote>',
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
  if (data === 'main:more') return showMoreMenu(ctx)
  if (data === 'main:account') return startAccount(ctx)
  if (data === 'main:accounts') return showAccounts(ctx)
  if (data === 'main:today') return showToday(ctx)
  if (data === 'main:history') return showHistory(ctx)
  if (data === 'main:review') return showReview(ctx)
  if (data === 'main:search') return startSearch(ctx)
  if (data === 'main:alerts') return showAlerts(ctx)
  if (data === 'main:reconcile') return startReconciliation(ctx)
  if (data === 'main:reports') return showReports(ctx)
  if (data === 'main:recurring') return showRecurring(ctx)
  if (data.startsWith('accounts:')) return handleAccountsCallback(ctx, data)
  if (data.startsWith('repeat:')) return handleRecurringCallback(ctx, data)
  if (data.startsWith('review:')) return handleReviewCallback(ctx, data)
  if (data.startsWith('history:')) return handleHistoryCallback(ctx, data)
  if (data.startsWith('acct:')) return handleAccountCallback(ctx, data)
  if (data.startsWith('mv:')) return handleMovementCallback(ctx, data)
  if (data.startsWith('rec:')) return handleReconciliationCallback(ctx, data)
  return sendScreen(ctx, 'أمر غير معروف.')
}

async function handleMessage(ctx, update) {
  if (update.message?.document || update.message?.photo) {
    if (await handleMovementMedia(ctx, update.message)) {
      await deleteUserInput(ctx)
      return null
    }
  }
  const text = String(update.message?.text || '').trim()
  console.log('[adreem-telegram-bot] message', {
    userId: ctx.userId,
    kind: update.message?.document ? 'document' : update.message?.photo ? 'photo' : text.startsWith('/') ? 'command' : 'text',
    textLength: text.length,
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
  if (!isPrivateTelegramUpdate(update)) {
    if (update.callback_query?.id) {
      await telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })
    }
    if (ctx.chatId) {
      await telegram.sendMessage({
        chat_id: ctx.chatId,
        text: '<b>استخدم ADREEM في محادثة خاصة فقط.</b>',
        parse_mode: 'HTML',
      })
    }
    return
  }
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
  if (!ctx.repository) {
    const text = String(update.message?.text || '').trim()
    if (text && await handleAdminCommand(ctx, text)) return
    if (update.callback_query?.id) {
      await telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })
    }
    await telegram.sendMessage({
      chat_id: ctx.chatId,
      text: '<b>لا يوجد دفتر معيّن لهذا المستخدم.</b>\n<blockquote>عيّن دفترًا صريحًا قبل استخدام البوت.</blockquote>',
      parse_mode: 'HTML',
    })
    return
  }
  if (update.callback_query) return handleCallback(ctx, update)
  if (update.message) return handleMessage(ctx, update)
}

async function poll() {
  await skipOldUpdates()
  while (true) {
    try {
      const updates = await telegram.getUpdates({ offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
      await processTelegramUpdates(updates, handleUpdate, (nextOffset) => {
        offset = nextOffset
      }, {
        onPermanentError(error, update) {
          console.error('[adreem-telegram-bot] skipped permanently failed Telegram update', {
            updateId: update.update_id,
            method: error.method,
            status: error.status,
            message: error.message,
          })
        },
      })
    } catch (error) {
      console.error('[adreem-telegram-bot]', error?.message || error)
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
  }
}

poll()
