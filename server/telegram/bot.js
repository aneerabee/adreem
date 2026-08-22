import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/ledger/ledgerCore.js'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import { accountDeletionEligibility, accountStructureUsage } from '../../src/ledger/accountEditing.js'
import { normalizeAccountSearchText } from '../../src/ledger/movementAccounts.js'
import { buildNetPosition, convertNetPosition } from '../../src/ledger/ledgerScope.js'
import { MAIN_LEDGER_MOVEMENT_TYPES, normalizeSeparateRecordDirection, separateRecordCancellationDraft } from '../../src/ledger/separateRecords.js'
import {
  buildDimensionReports,
  buildExpenseCategoryReports,
  buildLedgerAlerts,
  dimensionsFromAccounts,
  dueRecurringRules,
  executeRecurringRuleInState,
  recurringRuleDueOn,
} from '../../src/ledger/ledgerOperations.js'
import { createLedgerRepository } from '../ledger/ledgerRepository.js'
import { createSupabaseTelegramLedgerAccess } from './supabaseLedgerAccess.js'
import {
  appendTelegramMovement,
  buildLedgerSnapshot,
  formatMoney,
  runTelegramIdempotentStateAction,
  telegramUpdateIdempotencyKey,
} from '../ledger/ledgerService.js'
import {
  accountChoiceToken,
  accountDeleteConfirmKeyboard,
  accountProfileKeyboard,
  accountsBrowserKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  historyCancelConfirmKeyboard,
  historyKeyboard,
  mainMenuKeyboard,
  moreMenuKeyboard,
  netTargetKeyboard,
  numericKeypadKeyboard,
  recurringRulesKeyboard,
  reportDetailKeyboard,
  reportKeyboard,
  reportListKeyboard,
  reviewKeyboard,
  separateLedgerKeyboard,
  separateVoidConfirmKeyboard,
} from './keyboards.js'
import {
  accountBlockquote,
  accountChoiceLegendText,
  accountEditHistoryText,
  alertsText,
  escapeHtml,
  mainMenuText,
  movementBlockquote,
  movementLabels,
  movementStepText,
  protectedAccountLabel,
} from './messages.js'
import { buildReviewSession, cancelReviewMovementInState, hideZeroReviewAccountInState, loadReviewSession, stableReviewRequestedPage } from './reviewActions.js'
import {
  buildHistorySession,
  HISTORY_ACTION_LIMIT,
  movementsForDate,
  relatedReportMovements,
  voidRecentMovementInState,
} from './historyActions.js'
import { createSessionStore, sessionWithReplacementMessage } from './sessionStore.js'
import { createTelegramClient } from './telegramClient.js'
import { createLocalizedTelegramClient } from './localizedTelegram.js'
import { preserveUiData } from '../../src/ledger/uiTranslation.js'
import { handleAccountCallback, handleAccountText, startAccount, startEditAccount, startReviewAccount } from './handlers/account.js'
import { handleMovementCallback, handleMovementMedia, handleMovementText, startMovement, startReviewMovement, startSeparateRecord } from './handlers/movement.js'
import { handleReconciliationCallback, handleReconciliationText, startReconciliation } from './handlers/reconciliation.js'
import { createTelegramUserAccess, validateTelegramLedgerAssignments } from './userRegistry.js'
import { buildRecurringSession, disableRecurringRuleInState } from './recurringActions.js'
import { parseActionCallback, stableActionToken } from './actionTokens.js'
import {
  createIdempotentTelegramEffectClient,
  isPrivateTelegramUpdate,
  processTelegramUpdates,
  runCallbackActionWithBestEffortAck,
  shouldSkipOldUpdates,
} from './updateSafety.js'
import { createDurableBotRuntime, hydrateDurableSession } from './durableBotRuntime.js'
import { zonedDayRange } from './dateRange.js'
import { applyNumericKey, numericBufferDisplay, numericBufferValue } from './numericKeypad.js'
import { buildTelegramBalanceView } from './balanceView.js'
import { loadSeparateLedgerRecords, paginateSeparateLedgerRecords } from './separateLedgerView.js'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('[adreem-telegram-bot] missing TELEGRAM_BOT_TOKEN')
  process.exit(1)
}
const userAccess = createTelegramUserAccess(process.env)
const supabaseLedgerAccess = createSupabaseTelegramLedgerAccess(process.env)
const ledgerMapProblem = supabaseLedgerAccess ? '' : validateTelegramLedgerAssignments(userAccess)
if (ledgerMapProblem) {
  console.error('[adreem-telegram-bot] invalid Telegram ledger assignments:', ledgerMapProblem)
  process.exit(1)
}

const telegram = createTelegramClient(token)
const repositoriesByLedgerId = new Map()
const durableRuntime = createDurableBotRuntime(process.env, token)
const sessions = durableRuntime.sessions || createSessionStore()
const ACCOUNT_PAGE_SIZE = 8
const MOVEMENT_PICKER_PAGE_SIZE = 8
const REPORT_PAGE_SIZE = 8
const TODAY_PREVIEW_LIMIT = 10
const NET_ACCOUNT_PAGE_SIZE = 8
const LEDGER_TIME_ZONE = process.env.ADREEM_TIME_ZONE || 'Africa/Tripoli'

let offset = 0

console.log('[adreem-telegram-bot] starting', {
  accessMode: supabaseLedgerAccess ? 'supabase' : 'legacy',
  admins: userAccess.adminIds.length,
  envUsers: userAccess.envUserIds.length,
  envMappedLedgers: userAccess.envLedgerMap.size,
  registry: userAccess.filePath,
})

async function identityForUser(userId) {
  if (supabaseLedgerAccess) return supabaseLedgerAccess.resolve(userId)
  if (!userAccess.isAllowed(userId)) return null
  const ledgerId = userAccess.ledgerIdForUser(userId)
  if (!ledgerId) return null
  return {
    ownerId: '',
    ledgerId,
    legacyLedgerId: ledgerId,
    language: userAccess.languageForTelegramUser(userId),
    isOwner: userAccess.isAdmin(userId),
    source: 'legacy',
    telegramUserId: String(userId || ''),
  }
}

function repositoryForIdentity(identity) {
  if (supabaseLedgerAccess) return supabaseLedgerAccess.repositoryFor(identity)
  const ledgerId = identity?.ledgerId
  if (!ledgerId) return null
  if (!repositoriesByLedgerId.has(ledgerId)) {
    repositoriesByLedgerId.set(ledgerId, createLedgerRepository(process.env, { ledgerId }))
  }
  return repositoriesByLedgerId.get(ledgerId)
}

async function skipOldUpdates() {
  if (durableRuntime.durableState && offset > 0) return
  if (!shouldSkipOldUpdates(process.env)) return
  const updates = await telegram.getUpdates({ offset: -1, timeout: 0, allowed_updates: ['message', 'callback_query'] })
  if (updates.length) {
    const nextOffset = updates[updates.length - 1].update_id + 1
    if (durableRuntime.durableState) await durableRuntime.durableState.setOffset(nextOffset)
    offset = nextOffset
    console.log('[adreem-telegram-bot] skipped old updates', { nextOffset: offset })
  }
}

async function restoreDurableOffset() {
  if (!durableRuntime.durableState) return
  await durableRuntime.repository.cleanExpired()
  const savedOffset = await durableRuntime.durableState.getOffset()
  if (savedOffset !== null) offset = savedOffset
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

function contextFor(update, identity = null, execution = null) {
  const user = getUser(update)
  const language = identity?.language || userAccess.languageForTelegramUser(user?.id)
  const localizedTelegram = createLocalizedTelegramClient(telegram, language)
  return {
    telegram: createIdempotentTelegramEffectClient(localizedTelegram, execution?.runEffect),
    repository: null,
    sessions,
    user,
    identity,
    userId: user?.id,
    chatId: getChatId(update),
    messageId: getMessageId(update),
    isCallback: Boolean(update.callback_query),
    language,
    updateId: update.update_id,
    runEffect: execution?.runEffect || null,
  }
}

async function sendScreen(ctx, text, replyMarkup = mainMenuKeyboard()) {
  if (ctx.isCallback && ctx.messageId) {
    try {
      return await ctx.telegram.editMessageText({
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
  const sent = await ctx.telegram.sendMessage({
    chat_id: ctx.chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  })
  const session = sessions.get(ctx.chatId, ctx.userId)
  const nextSession = sessionWithReplacementMessage(session, ctx.isCallback ? ctx.messageId : null, sent.message_id)
  if (nextSession && nextSession !== session) sessions.set(ctx.chatId, ctx.userId, nextSession)
  return sent
}

async function deleteUserInput(ctx) {
  if (!ctx.messageId || ctx.isCallback) return
  try {
    await ctx.telegram.deleteMessage({ chat_id: ctx.chatId, message_id: ctx.messageId })
  } catch {
    // Some Telegram clients or message ages can reject deletion; this should not block the flow.
  }
}

async function showMainMenu(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state, movementPage } = await ctx.repository.load()
  let today
  if (typeof ctx.repository.loadMovements === 'function') {
    const range = zonedDayRange(new Date(), LEDGER_TIME_ZONE)
    const result = await ctx.repository.loadMovements({
      occurredFrom: range.from,
      occurredBefore: range.before,
      movementLimit: 1,
      movementTypes: MAIN_LEDGER_MOVEMENT_TYPES,
      excludeOpening: true,
    })
    today = Number(result.page?.total || 0)
  } else {
    today = movementsForDate(state).length
  }
  const reviewCount = state.accounts.filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW).length +
    Number(movementPage?.reviewTotal ?? state.movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW).length)
  return sendScreen(ctx, mainMenuText({ todayCount: today, reviewCount }))
}

async function showMoreMenu(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  return sendScreen(
    ctx,
    '<b>ADREEM · المزيد</b>',
    moreMenuKeyboard(),
  )
}

async function showAccounts(ctx, requestedPage = 0, requestedFilter = 'money', notice = '') {
  sessions.clear(ctx.chatId, ctx.userId)
  if (requestedFilter === 'separate') return showSeparateAccounts(ctx, requestedPage)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const balanceView = buildTelegramBalanceView(snapshot.balances, requestedFilter)
  const { allBuckets, filteredBuckets, filter, summary } = balanceView
  const pageCount = Math.max(1, Math.ceil(filteredBuckets.length / ACCOUNT_PAGE_SIZE))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const visibleBuckets = filteredBuckets.slice(page * ACCOUNT_PAGE_SIZE, (page + 1) * ACCOUNT_PAGE_SIZE)
  const session = {
    flow: 'accounts',
    page,
    pageCount,
    balanceFilter: filter,
    choices: {
      accounts: Object.fromEntries(visibleBuckets.map((bucket) => [accountChoiceToken(bucket.account), bucket.account.id])),
    },
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  const balancePair = (value) => `${formatMoney(value.dinar, CURRENCIES.DINAR)} · ${formatMoney(value.usd, CURRENCIES.USD)}`
  const accountLegend = accountChoiceLegendText(visibleBuckets.map((bucket) => bucket.account))
  const filterLabel = { money: 'فلوسي', collect: 'لي عند الناس', pay: 'عليّ للناس', separate: 'حسابات منفصلة', all: 'كل الحسابات' }[filter]
  const noticeText = notice ? `\n<blockquote>${escapeHtml(notice)}</blockquote>` : ''
  const text = allBuckets.length
    ? `<b>ADREEM · الأرصدة</b>${noticeText}\n<blockquote>${escapeHtml(`فلوسي\n${balancePair(summary.money)}\n\nلي عند الناس\n${balancePair(summary.collect)}\n\nعليّ للناس\n${balancePair(summary.pay)}`)}</blockquote>\n\n<b>${escapeHtml(filterLabel)}</b>\n<code>${filteredBuckets.length} حساب · ${page + 1}/${pageCount}</code>${accountLegend ? `\n<code>${escapeHtml(accountLegend)}</code>` : ''}${visibleBuckets.length ? '' : '\n<blockquote>لا توجد حسابات في هذا القسم.</blockquote>'}`
    : '<b>ADREEM · الأرصدة</b>\n<blockquote>لا توجد حسابات.\nأنشئ حسابًا من «المزيد».</blockquote>'
  return sendScreen(ctx, text, accountsBrowserKeyboard(visibleBuckets, session))
}

async function showSeparateAccounts(ctx, requestedPage = 0, notice = '') {
  const records = await loadSeparateLedgerRecords(ctx.repository)
  const { visibleRecords, total, page, pageCount } = paginateSeparateLedgerRecords(
    records,
    requestedPage,
    ACCOUNT_PAGE_SIZE,
  )
  const items = visibleRecords.map((movement, index) => ({
    id: movement.id,
    number: page * ACCOUNT_PAGE_SIZE + index + 1,
    token: accountChoiceToken(movement),
  }))
  const session = {
    flow: 'accounts',
    page,
    pageCount,
    balanceFilter: 'separate',
    items,
    choices: { separate: Object.fromEntries(items.map((item) => [item.token, item.id])) },
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  const recordsText = visibleRecords.map((movement, index) => {
    const direction = normalizeSeparateRecordDirection(movement.recordDirection)
    const icon = direction === 'receivable' ? '🟢' : direction === 'payable' ? '🔴' : '📝'
    const label = direction === 'receivable' ? 'لي' : direction === 'payable' ? 'عليّ' : 'معلومة'
    return `<blockquote>${escapeHtml(`#${items[index].number} · ${icon} ${preserveUiData(movement.relatedName || 'بدون اسم')}\n${label} · ${formatMoney(movement.amount, movement.currency)}\n${preserveUiData(movement.note || '')}`)}</blockquote>`
  })
  const text = [
    '<b>ADREEM · منفصل</b>',
    `<code>${total} حساب · صفحة ${page + 1}/${pageCount}</code>`,
    ...(notice ? ['', `<blockquote>${escapeHtml(notice)}</blockquote>`] : []),
    '',
    ...(recordsText.length ? recordsText : ['<blockquote>لا توجد حسابات منفصلة.</blockquote>']),
  ].join('\n')
  return sendScreen(ctx, text, separateLedgerKeyboard(session))
}

async function handleAccountsCallback(ctx, data) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'accounts') return showAccounts(ctx)
  if (data === 'accounts:net') return startNetPosition(ctx)
  if (data === 'accounts:separate:add') return startSeparateRecord(ctx)
  if (data.startsWith('accounts:separate:page:')) return showAccounts(ctx, Number(data.slice('accounts:separate:page:'.length)), 'separate')
  if (data.startsWith('accounts:separate:edit:')) {
    const token = data.slice('accounts:separate:edit:'.length)
    const movementId = session.choices?.separate?.[token]
    const records = await loadSeparateLedgerRecords(ctx.repository)
    const target = records.find((movement) => movement.id === movementId)
    if (!target) return showSeparateAccounts(ctx, session.page, 'هذا الحساب تغيّر. عُرضت أحدث نسخة.')
    return startSeparateRecord(ctx, target)
  }
  if (data.startsWith('accounts:separate:void-confirm:')) {
    const token = data.slice('accounts:separate:void-confirm:'.length)
    const movementId = session.choices?.separate?.[token]
    if (!movementId || session.pendingSeparateVoidId !== movementId) {
      return showSeparateAccounts(ctx, session.page, 'انتهى طلب الإلغاء. لم يتغير شيء.')
    }
    const records = await loadSeparateLedgerRecords(ctx.repository)
    const target = records.find((movement) => movement.id === movementId)
    if (!target) return showSeparateAccounts(ctx, session.page, 'هذا الحساب تغيّر. لم يتكرر الإلغاء.')
    try {
      const result = await appendTelegramMovement(ctx.repository, separateRecordCancellationDraft(target), {
        idempotencyKey: telegramUpdateIdempotencyKey(ctx.updateId, 'separate-record-void'),
        telegramUserId: ctx.userId,
        telegramChatId: ctx.chatId,
      })
      return showSeparateAccounts(ctx, session.page, result.duplicate ? 'كان الحساب ملغيًا بالفعل.' : 'تم إلغاء الحساب المنفصل.')
    } catch (error) {
      console.error('[adreem-telegram-bot] separate account cancellation failed', error?.message || error)
      return showSeparateAccounts(ctx, session.page, 'تعذر الإلغاء الآن. لم يتغير الحساب.')
    }
  }
  if (data.startsWith('accounts:separate:void:')) {
    const token = data.slice('accounts:separate:void:'.length)
    const movementId = session.choices?.separate?.[token]
    const records = await loadSeparateLedgerRecords(ctx.repository)
    const target = records.find((movement) => movement.id === movementId)
    if (!target) return showSeparateAccounts(ctx, session.page, 'هذا الحساب تغيّر. عُرضت أحدث نسخة.')
    const nextSession = { ...session, pendingSeparateVoidId: target.id }
    sessions.set(ctx.chatId, ctx.userId, nextSession)
    return sendScreen(
      ctx,
      `<b>إلغاء الحساب المنفصل؟</b>\n<blockquote>${escapeHtml(`${preserveUiData(target.relatedName || 'بدون اسم')}\n${formatMoney(target.amount, target.currency)}\nلن تتأثر الأرصدة الرئيسية.`)}</blockquote>`,
      separateVoidConfirmKeyboard(nextSession, token),
    )
  }
  if (data.startsWith('accounts:filter:')) return showAccounts(ctx, 0, data.slice('accounts:filter:'.length))
  if (data.startsWith('accounts:page:')) return showAccounts(ctx, Number(data.slice('accounts:page:'.length)), session.balanceFilter)
  if (data.startsWith('accounts:delete-confirm:')) {
    const deleteToken = data.slice('accounts:delete-confirm:'.length)
    const deleteAccountId = session.choices?.accounts?.[deleteToken]
    if (!deleteAccountId || session.pendingDeleteAccountId !== deleteAccountId) {
      return showAccounts(ctx, session.page, session.balanceFilter, 'انتهى طلب الحذف. لم يتغير شيء.')
    }
    const { state, revision } = await ctx.repository.load()
    const account = (state.accounts || []).find((item) => item.id === deleteAccountId)
    const deletion = accountDeletionEligibility(account, {
      accounts: state.accounts || [],
      movements: state.movements || [],
      attachments: state.attachments || [],
      reconciliations: state.reconciliations || [],
      recurringRules: state.recurringRules || [],
      dimensions: state.dimensions || [],
    })
    if (!deletion.canDelete || typeof ctx.repository.deleteUnusedAccount !== 'function') {
      return showAccounts(ctx, session.page, session.balanceFilter, 'لم يعد الحساب قابلًا للحذف. لم يتغير شيء.')
    }
    try {
      await ctx.repository.deleteUnusedAccount(deleteAccountId, revision)
      return showAccounts(ctx, session.page, session.balanceFilter, 'تم حذف الحساب نهائيًا.')
    } catch (error) {
      console.error('[adreem-telegram-bot] account deletion failed', {
        name: error?.name || 'Error',
        code: error?.code || '',
      })
      return showAccounts(ctx, session.page, session.balanceFilter, 'تعذر الحذف الآن. لم يتغير شيء.')
    }
  }
  if (data.startsWith('accounts:delete:')) {
    const deleteToken = data.slice('accounts:delete:'.length)
    const deleteAccountId = session.choices?.accounts?.[deleteToken]
    if (!deleteAccountId) return showAccounts(ctx, session.page, session.balanceFilter)
    const { state } = await ctx.repository.load()
    const account = (state.accounts || []).find((item) => item.id === deleteAccountId)
    const deletion = accountDeletionEligibility(account, {
      accounts: state.accounts || [],
      movements: state.movements || [],
      attachments: state.attachments || [],
      reconciliations: state.reconciliations || [],
      recurringRules: state.recurringRules || [],
      dimensions: state.dimensions || [],
    })
    if (!deletion.canDelete || typeof ctx.repository.deleteUnusedAccount !== 'function') {
      return showAccounts(ctx, session.page, session.balanceFilter, 'هذا الحساب مستخدم أو مرتبط بسجل آخر، لذلك لا يمكن حذفه.')
    }
    const nextSession = { ...session, pendingDeleteAccountId: deleteAccountId }
    sessions.set(ctx.chatId, ctx.userId, nextSession)
    return sendScreen(
      ctx,
      `<b>حذف الحساب نهائيًا؟</b>\n<blockquote>${escapeHtml(`${preserveUiData(account.ownerName || account.name || 'الحساب')}\nمتاح فقط لأنه لم يُستخدم في أي حركة.`)}</blockquote>`,
      accountDeleteConfirmKeyboard(session.page, deleteToken),
    )
  }
  if (data.startsWith('accounts:edit:')) {
    const editToken = data.slice('accounts:edit:'.length)
    const editAccountId = session.choices?.accounts?.[editToken]
    if (!editAccountId) return showAccounts(ctx, session.page)
    return startEditAccount(ctx, editAccountId)
  }
  const token = data.slice('accounts:open:'.length)
  const accountId = session.choices?.accounts?.[token]
  if (!accountId) return showAccounts(ctx, session.page)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const account = snapshot.accountById.get(accountId)
  const bucket = snapshot.balanceByAccountId.get(accountId)
  if (!account || !bucket) return showAccounts(ctx, session.page)
  const accountMovements = typeof ctx.repository.loadMovements === 'function'
    ? (await ctx.repository.loadMovements({ accountId, movementLimit: 8, excludeOpening: true })).movements
    : (state.movements || [])
      .filter((movement) => movement.sourceAccountId === accountId || movement.destinationAccountId === accountId)
      .slice()
      .reverse()
      .slice(0, 8)
  const movements = accountMovements
    .map((movement) => movementBlockquote(movement, snapshot.accountById, { includeDate: true }))
  const text = [
    '<b>ADREEM · الحساب</b>',
    '',
    accountBlockquote(account, bucket),
    '',
    `<b>آخر الحركات · ${movements.length}</b>`,
    movements.length ? movements.join('\n') : '<blockquote>لا توجد حركات لهذا الحساب.</blockquote>',
    accountEditHistoryText(account.id, state.auditEvents || []),
  ].filter(Boolean).join('\n')
  const accountContext = {
    accounts: state.accounts || [],
    movements: state.movements || [],
    reconciliations: state.reconciliations || [],
    recurringRules: state.recurringRules || [],
    dimensions: state.dimensions || [],
  }
  const accountLocked = accountStructureUsage(account, accountContext).movement
  const deletion = accountDeletionEligibility(account, {
    ...accountContext,
    attachments: state.attachments || [],
  })
  return sendScreen(ctx, text, accountProfileKeyboard(session.page, token, {
    canEdit: !accountLocked,
    canDelete: deletion.canDelete && typeof ctx.repository.deleteUnusedAccount === 'function',
  }))
}

async function startNetPosition(ctx) {
  const session = {
    flow: 'net',
    step: 'rate',
    rateBuffer: '',
    rate: null,
    targetCurrency: CURRENCIES.DINAR,
    showAccounts: false,
    accountsPage: 0,
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  return renderNetPosition(ctx, session)
}

async function renderNetPosition(ctx, session, notice = '') {
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  const activeBalances = snapshot.balances.filter((bucket) => bucket.account.status === ACCOUNT_STATUSES.ACTIVE)
  const position = buildNetPosition(activeBalances)
  const rawText = `دينار: ${formatMoney(position.dinar, CURRENCIES.DINAR)}\nدولار: ${formatMoney(position.usd, CURRENCIES.USD)}`
  if (session.step === 'rate') {
    const text = [
      '<b>ADREEM · الصافي</b>',
      `<blockquote>${escapeHtml(rawText)}</blockquote>`,
      ...(notice ? ['', `<b>${escapeHtml(notice)}</b>`] : []),
      '',
      '<b>سعر الدولار بالدينار</b>',
      `<blockquote>${escapeHtml(numericBufferDisplay(session.rateBuffer))}</blockquote>`,
    ].join('\n')
    return sendScreen(ctx, text, numericKeypadKeyboard('net', { allowDecimal: true }))
  }

  const converted = convertNetPosition(position, session.rate, session.targetCurrency)
  const pageCount = Math.max(1, Math.ceil(position.contributions.length / NET_ACCOUNT_PAGE_SIZE))
  const page = Math.min(Math.max(0, Number(session.accountsPage) || 0), pageCount - 1)
  session.accountsPage = page
  sessions.set(ctx.chatId, ctx.userId, session)
  const visibleAccounts = session.showAccounts
    ? position.contributions.slice(page * NET_ACCOUNT_PAGE_SIZE, (page + 1) * NET_ACCOUNT_PAGE_SIZE)
    : []
  const accountLines = visibleAccounts.map((item) => {
    const values = [
      item.dinar ? formatMoney(item.dinar, CURRENCIES.DINAR) : '',
      item.usd ? formatMoney(item.usd, CURRENCIES.USD) : '',
    ].filter(Boolean)
    return `${protectedAccountLabel(item.account)} · ${values.join(' · ') || 'صفر'}`
  })
  const resultText = converted.ok
    ? `الصافي: ${formatMoney(converted.amount, converted.currency)}\nالسعر: ${converted.rate}`
    : converted.error
  const text = [
    '<b>ADREEM · الصافي</b>',
    `<blockquote>${escapeHtml(`${rawText}\n\n${resultText}`)}</blockquote>`,
    ...(session.showAccounts
      ? ['', `<b>الحسابات الداخلة · ${position.accountCount}</b>`, `<code>صفحة ${page + 1}/${pageCount}</code>`, `<blockquote>${escapeHtml(accountLines.join('\n') || 'لا توجد حسابات داخلة.')}</blockquote>`]
      : []),
  ].join('\n')
  return sendScreen(ctx, text, netTargetKeyboard(session.targetCurrency, {
    showAccounts: session.showAccounts,
    page,
    pageCount,
  }))
}

async function handleNetPositionCallback(ctx, data) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'net') return showAccounts(ctx)
  if (data === 'net:cancel') return showMainMenu(ctx)
  if (data === 'net:back') return showAccounts(ctx)
  if (data.startsWith('net:num:')) {
    if (session.step !== 'rate') return renderNetPosition(ctx, session)
    const key = data.slice('net:num:'.length)
    if (key !== 'done') {
      session.rateBuffer = applyNumericKey(session.rateBuffer, key, { allowDecimal: true })
      sessions.set(ctx.chatId, ctx.userId, session)
      return renderNetPosition(ctx, session)
    }
    const rate = numericBufferValue(session.rateBuffer, { allowDecimal: true })
    if (rate === null) return renderNetPosition(ctx, session, 'أدخل سعرًا أكبر من صفر.')
    session.rate = rate
    session.step = 'result'
    sessions.set(ctx.chatId, ctx.userId, session)
    return renderNetPosition(ctx, session)
  }
  if (data === 'net:rate') {
    session.step = 'rate'
    session.rateBuffer = session.rate ? String(session.rate) : ''
  } else if (data.startsWith('net:target:')) {
    session.targetCurrency = data.slice('net:target:'.length) === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR
  } else if (data === 'net:accounts') {
    session.showAccounts = !session.showAccounts
    session.accountsPage = 0
  } else if (data.startsWith('net:accounts:page:')) {
    session.showAccounts = true
    session.accountsPage = Number(data.slice('net:accounts:page:'.length)) || 0
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  return renderNetPosition(ctx, session)
}

async function showToday(ctx) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  let visibleMovements
  let total
  if (typeof ctx.repository.loadMovements === 'function') {
    const range = zonedDayRange(new Date(), LEDGER_TIME_ZONE)
    const result = await ctx.repository.loadMovements({
      occurredFrom: range.from,
      occurredBefore: range.before,
      movementLimit: TODAY_PREVIEW_LIMIT,
      movementTypes: MAIN_LEDGER_MOVEMENT_TYPES,
      excludeOpening: true,
    })
    visibleMovements = result.movements || []
    total = Number(result.page?.total || visibleMovements.length)
  } else {
    const todayMovements = movementsForDate(state)
    visibleMovements = todayMovements.slice(0, TODAY_PREVIEW_LIMIT)
    total = todayMovements.length
  }
  const rows = visibleMovements.map((movement, index) => historyMovementCard(movement, snapshot.accountById, index + 1, { showTime: false }))
  const previewLabel = total > visibleMovements.length ? ` · أحدث ${visibleMovements.length}` : ''
  return sendScreen(ctx, rows.length ? `<b>ADREEM · سجل اليوم</b>\n<code>${total} حركة${previewLabel}</code>\n\n${rows.join('\n')}` : '<b>ADREEM · سجل اليوم</b>\n<blockquote>لا توجد حركات اليوم.</blockquote>')
}

async function showHistory(ctx, notice = '', requestedPage = 0) {
  const previousSession = sessions.get(ctx.chatId, ctx.userId)
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const snapshot = buildLedgerSnapshot(state)
  let historySession
  let visibleMovements = []
  if (typeof ctx.repository.loadMovements === 'function') {
    const page = Math.max(0, Number(requestedPage) || 0)
    const pageCursors = previousSession?.flow === 'history'
      ? { ...(previousSession.pageCursors || {}) }
      : { 0: null }
    const beforeSequence = page > 0 ? pageCursors[page] : null
    if (page > 0 && !beforeSequence) return showHistory(ctx, notice, Math.max(0, page - 1))
    const result = await ctx.repository.loadMovements({
      movementLimit: HISTORY_ACTION_LIMIT,
      movementTypes: MAIN_LEDGER_MOVEMENT_TYPES,
      beforeSequence,
      excludeOpening: true,
    })
    visibleMovements = result.movements || []
    const temporary = buildHistorySession({ ...state, movements: visibleMovements.slice().reverse() }, HISTORY_ACTION_LIMIT, 0)
    const total = page === 0 ? Number(result.page?.total || visibleMovements.length) : Number(previousSession?.total || visibleMovements.length)
    const pageCount = Math.max(1, Math.ceil(total / HISTORY_ACTION_LIMIT))
    const items = temporary.items.map((item, index) => ({ ...item, number: page * HISTORY_ACTION_LIMIT + index + 1 }))
    if (result.page?.nextCursor) pageCursors[page + 1] = result.page.nextCursor
    historySession = {
      ...temporary,
      page,
      pageCount,
      total,
      items,
      pageCursors,
      choices: {
        movements: Object.fromEntries(items.filter((item) => item.canCancel).map((item) => [item.token, item.id])),
      },
    }
  } else {
    historySession = buildHistorySession(state, HISTORY_ACTION_LIMIT, requestedPage)
  }
  sessions.set(ctx.chatId, ctx.userId, { ...historySession, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const movementById = new Map([...(state.movements || []), ...visibleMovements].map((movement) => [movement.id, movement]))
  const rows = historySession.items
    .map((item) => {
      const movement = movementById.get(item.id)
      return movement ? historyMovementCard(movement, snapshot.accountById, item.number, { showTime: false }) : ''
    })
    .filter(Boolean)
  const noticeBlock = notice ? `\n\n<blockquote>${escapeHtml(notice)}</blockquote>` : ''
  return sendScreen(
    ctx,
    rows.length ? `<b>ADREEM · الحركات</b>\n<code>${historySession.total} حركة · صفحة ${historySession.page + 1}/${historySession.pageCount}</code>${noticeBlock}\n\n${rows.join('\n')}` : `<b>ADREEM · الحركات</b>${noticeBlock}\n<blockquote>لا توجد حركات.</blockquote>`,
    historyKeyboard(historySession),
  )
}

function historyMovementCard(movement, accountsById, number, options = {}) {
  return movementBlockquote(movement, accountsById, { ...options, number, variant: 'history' })
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
  const reports = typeof ctx.repository.loadReports === 'function'
    ? await ctx.repository.loadReports()
    : { dimensions: buildDimensionReports(state), expenseCategories: buildExpenseCategoryReports(state) }
  const projects = reports.dimensions
  const expenses = reports.expenseCategories
  const text = [
    '<b>ADREEM · التقارير</b>',
    '<blockquote>اختر القائمة التي تريد فتحها.</blockquote>',
    '',
    `<code>${projects.length} مشروع أو أصل · ${expenses.length} نوع مصروف</code>`,
  ].join('\n')
  return sendScreen(ctx, text, reportKeyboard({ projects: projects.length, expenses: expenses.length }))
}

function reportItemsForKind(state, kind, reports = null) {
  if (reports) return kind === 'expense' ? reports.expenseCategories : reports.dimensions
  return kind === 'expense' ? buildExpenseCategoryReports(state) : buildDimensionReports(state)
}

function reportItemId(item, kind) {
  return kind === 'expense' ? item.categoryId || '' : item.dimension?.id || ''
}

function reportItemName(item, kind) {
  const name = kind === 'expense' ? item.name : item.dimension?.name
  return name ? preserveUiData(name) : 'بدون اسم'
}

function boundedPage(total, requestedPage, pageSize) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  return { page, pageCount }
}

function reportSummary(item, kind) {
  if (kind === 'expense') {
    const usd = item.usd ? ` · ${formatMoney(item.usd, CURRENCIES.USD)}` : ''
    return `${reportItemName(item, kind)}\n${formatMoney(item.dinar)}${usd} · ${item.count} حركة معتمدة`
  }
  const dinar = `دخل ${formatMoney(item.income)} · مصروف ${formatMoney(item.expense)} · صافي ${formatMoney(item.net)}`
  const usd = item.incomeUsd || item.expenseUsd
    ? `\nدولار: دخل ${formatMoney(item.incomeUsd, CURRENCIES.USD)} · مصروف ${formatMoney(item.expenseUsd, CURRENCIES.USD)} · صافي ${formatMoney(item.netUsd, CURRENCIES.USD)}`
    : ''
  return `${reportItemName(item, kind)}\n${dinar}${usd} · ${item.movementCount} حركة معتمدة`
}

async function showReportList(ctx, kind, requestedPage = 0) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const reports = typeof ctx.repository.loadReports === 'function' ? await ctx.repository.loadReports() : null
  const allItems = reportItemsForKind(state, kind, reports)
  const { page, pageCount } = boundedPage(allItems.length, requestedPage, REPORT_PAGE_SIZE)
  const visibleItems = allItems.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE)
  const items = visibleItems.map((item, index) => {
    const id = reportItemId(item, kind)
    return {
      id,
      number: page * REPORT_PAGE_SIZE + index + 1,
      token: stableActionToken(`${kind}:${id || 'uncategorized'}`),
    }
  })
  const session = {
    flow: 'reports',
    view: 'list',
    kind,
    page,
    pageCount,
    total: allItems.length,
    items,
    choices: {
      reports: Object.fromEntries(items.map((item) => [item.token, item.id])),
    },
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  const title = kind === 'expense' ? 'أنواع المصروف' : 'المشاريع والأصول'
  const lines = [`<b>ADREEM · ${title}</b>`, `<code>${allItems.length} عنصر · صفحة ${page + 1}/${pageCount}</code>`]
  if (!visibleItems.length) lines.push('', '<blockquote>لا توجد بيانات بعد.</blockquote>')
  visibleItems.forEach((item, index) => {
    lines.push('', `<b>#${items[index].number}</b>`, `<blockquote>${escapeHtml(reportSummary(item, kind))}</blockquote>`)
  })
  return sendScreen(ctx, lines.join('\n'), reportListKeyboard(session))
}

async function showReportDetail(ctx, kind, reportId, listPage = 0, requestedPage = 0) {
  const previousSession = sessions.get(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const reports = typeof ctx.repository.loadReports === 'function' ? await ctx.repository.loadReports() : null
  const report = reportItemsForKind(state, kind, reports).find((item) => String(reportItemId(item, kind)) === String(reportId || ''))
  if (!report) return showReportList(ctx, kind, listPage)
  let movements
  let page
  let pageCount
  let total
  let pageCursors = {}
  if (typeof ctx.repository.loadMovements === 'function') {
    page = Math.max(0, Number(requestedPage) || 0)
    pageCursors = previousSession?.flow === 'reports' && previousSession.view === 'detail'
      ? { ...(previousSession.pageCursors || {}) }
      : { 0: null }
    const beforeSequence = page > 0 ? pageCursors[page] : null
    if (page > 0 && !beforeSequence) return showReportDetail(ctx, kind, reportId, listPage, Math.max(0, page - 1))
    const result = await ctx.repository.loadMovements({
      movementLimit: REPORT_PAGE_SIZE,
      beforeSequence,
      status: MOVEMENT_STATUSES.POSTED,
      ...(kind === 'project'
        ? { dimensionId: reportId }
        : {
            movementTypes: ['expense', 'truck_expense'],
            ...(reportId ? { expenseCategoryId: reportId } : { expenseCategoryUncategorized: true }),
          }),
    })
    movements = result.movements || []
    total = page === 0 ? Number(result.page?.total || movements.length) : Number(previousSession?.total || movements.length)
    pageCount = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE))
    if (result.page?.nextCursor) pageCursors[page + 1] = result.page.nextCursor
  } else {
    const allMovements = relatedReportMovements(state, kind, reportId)
    const bounded = boundedPage(allMovements.length, requestedPage, REPORT_PAGE_SIZE)
    page = bounded.page
    pageCount = bounded.pageCount
    total = allMovements.length
    movements = allMovements.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE)
  }
  sessions.clear(ctx.chatId, ctx.userId)
  const visibleMovements = movements
  const session = {
    flow: 'reports',
    view: 'detail',
    kind,
    reportId,
    listPage,
    page,
    pageCount,
    total,
    pageCursors,
    uiMessageId: ctx.isCallback ? ctx.messageId : null,
  }
  sessions.set(ctx.chatId, ctx.userId, session)
  const snapshot = buildLedgerSnapshot(state)
  const lines = [
    `<b>ADREEM · ${escapeHtml(reportItemName(report, kind))}</b>`,
    `<blockquote>${escapeHtml(reportSummary(report, kind))}</blockquote>`,
    `<code>${total} حركة مرتبطة · صفحة ${page + 1}/${pageCount}</code>`,
  ]
  if (!visibleMovements.length) lines.push('', '<blockquote>لا توجد حركات مرتبطة.</blockquote>')
  visibleMovements.forEach((movement, index) => {
    lines.push('', historyMovementCard(movement, snapshot.accountById, page * REPORT_PAGE_SIZE + index + 1, { includeDate: true }))
  })
  return sendScreen(ctx, lines.join('\n'), reportDetailKeyboard(session))
}

async function handleReportsCallback(ctx, data) {
  if (data === 'reports:home') return showReports(ctx)
  const listMatch = data.match(/^reports:(project|expense):page:(\d+)$/)
  if (listMatch) return showReportList(ctx, listMatch[1], Number(listMatch[2]))
  const session = sessions.get(ctx.chatId, ctx.userId)
  const detailPageMatch = data.match(/^reports:detail:page:(\d+)$/)
  if (detailPageMatch && session?.flow === 'reports' && session.view === 'detail') {
    return showReportDetail(ctx, session.kind, session.reportId, session.listPage, Number(detailPageMatch[1]))
  }
  const openMatch = data.match(/^reports:open:(project|expense):([^:]+)$/)
  if (openMatch && session?.flow === 'reports' && session.view === 'list' && session.kind === openMatch[1]) {
    const reportId = session.choices?.reports?.[openMatch[2]]
    if (reportId !== undefined) return showReportDetail(ctx, session.kind, reportId, session.page)
  }
  return showReports(ctx)
}

async function showRecurring(ctx, notice = '', requestedPage = 0) {
  sessions.clear(ctx.chatId, ctx.userId)
  const { state } = await ctx.repository.load()
  const session = buildRecurringSession(state, new Date(), undefined, requestedPage)
  sessions.set(ctx.chatId, ctx.userId, { ...session, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const byId = new Map((state.recurringRules || []).map((rule) => [rule.id, rule]))
  const dueRuleIds = new Set(session.dueRuleIds)
  const rules = Object.values(session.choices.rules).map((id) => byId.get(id)).filter(Boolean)
  const lines = ['<b>ADREEM · الحركات الشهرية</b>', `<code>${session.total} فعالة · ${dueRuleIds.size} مستحقة · صفحة ${session.page + 1}/${session.pageCount}</code>`]
  if (notice) lines.push('', `<blockquote>${escapeHtml(notice)}</blockquote>`)
  if (!rules.length) lines.push('', '<blockquote>لا توجد حركة شهرية.</blockquote>')
  rules.forEach((rule, index) => {
    const amount = formatMoney(rule.template?.amount, rule.template?.currency)
    const status = dueRuleIds.has(rule.id) ? 'مستحقة الآن' : 'غير مستحقة'
    const nextRunOn = recurringRuleDueOn(rule)
    lines.push('', `<blockquote>${escapeHtml(`#${session.items[index].number} · ${preserveUiData(rule.name)}\n${amount}\n${status} · ${nextRunOn}`)}</blockquote>`)
  })
  return sendScreen(ctx, lines.join('\n'), recurringRulesKeyboard(session))
}

async function handleRecurringCallback(ctx, data) {
  if (data.startsWith('repeat:page:')) return showRecurring(ctx, '', Number(data.slice('repeat:page:'.length)))
  const session = sessions.get(ctx.chatId, ctx.userId)
  if (session?.flow !== 'recurring') return sendScreen(ctx, '<b>هذه أزرار تكرار قديمة.</b>\n<blockquote>افتح الحركات الشهرية من القائمة لعرض الأحدث.</blockquote>')
  const [action, token] = parseActionCallback(data, 'repeat', session) || []
  if (!action || !token) return sendScreen(ctx, '<b>انتهت صلاحية هذه البطاقة.</b>\n<blockquote>بطاقة الحركات الشهرية الحالية لم تتغير.</blockquote>')
  const ruleId = session.choices?.rules?.[token]
  if (!ruleId) return showRecurring(ctx, 'هذه الحركة لم تعد في القائمة.')
  const operation = action === 'run' ? 'recurring-run' : 'recurring-disable'
  const idempotencyKey = telegramUpdateIdempotencyKey(ctx.updateId, operation)
  const result = action === 'run'
    ? await ctx.repository.update((state) => runTelegramIdempotentStateAction(
        state,
        idempotencyKey,
        operation,
        (current) => executeRecurringRuleInState(current, ruleId),
      ))
    : action === 'disable'
      ? await ctx.repository.update((state) => runTelegramIdempotentStateAction(
          state,
          idempotencyKey,
          operation,
          (current) => disableRecurringRuleInState(current, ruleId),
        ))
      : { message: 'الأمر غير معروف.' }
  return showRecurring(ctx, result.message, session.page)
}

async function showReview(ctx, notice = '', requestedPage = 0) {
  const previousSession = sessions.get(ctx.chatId, ctx.userId)
  sessions.clear(ctx.chatId, ctx.userId)
  let { state, movementPage, revision } = await ctx.repository.load()
  let stablePage = stableReviewRequestedPage(previousSession, revision, requestedPage)
  if (stablePage.changed && !notice) notice = 'تغيرت القائمة. عُدت إلى أول صفحة.'
  const reviewSession = typeof ctx.repository.loadMovements === 'function'
    ? await (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await loadReviewSession(ctx.repository, state, undefined, stablePage.page, revision)
          } catch (error) {
            if (error?.code !== 'ADREEM_REVIEW_REVISION_CHANGED' || attempt === 2) throw error
            const refreshed = await ctx.repository.load()
            state = refreshed.state
            movementPage = refreshed.movementPage
            revision = refreshed.revision
            stablePage = { page: 0, changed: true }
            if (!notice) notice = 'تغيرت القائمة. عُدت إلى أول صفحة.'
          }
        }
        throw new Error('Unable to load a stable review page.')
      })()
    : buildReviewSession(state, undefined, stablePage.page)
  sessions.set(ctx.chatId, ctx.userId, { ...reviewSession, ledgerRevision: revision, uiMessageId: ctx.isCallback ? ctx.messageId : null })
  const pageLabel = reviewSession.pageCount > 1 ? ` · صفحة ${reviewSession.page + 1}/${reviewSession.pageCount}` : ''
  const lines = ['<b>ADREEM · مراجعة</b>', `<code>${reviewSession.total} عنصر${pageLabel}</code>`]
  if (notice) lines.push('', `<blockquote>${escapeHtml(notice)}</blockquote>`)
  if (typeof ctx.repository.loadMovements !== 'function' && movementPage?.reviewTruncated) {
    lines.push('', '<blockquote>عدد الحركات المعلقة كبير جدًا. افتح المراجعة من الويب لعرض الباقي.</blockquote>')
  }
  if (!reviewSession.total) lines.push('', '<blockquote>لا شيء معلق.</blockquote>')
  reviewSession.items.forEach((item) => {
    const description = item.kind === 'account'
      ? `حساب · ${protectedAccountLabel(item.value)}`
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
    const result = await ctx.repository.update(
      (state) => runTelegramIdempotentStateAction(
        state,
        telegramUpdateIdempotencyKey(ctx.updateId, 'review-movement-cancel'),
        'review-movement-cancel',
        (current) => cancelReviewMovementInState(current, movementId),
      ),
      { movementIds: [movementId] },
    )
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
    const result = await ctx.repository.update((state) => runTelegramIdempotentStateAction(
      state,
      telegramUpdateIdempotencyKey(ctx.updateId, 'review-account-hide'),
      'review-account-hide',
      (current) => hideZeroReviewAccountInState(current, accountId),
    ))
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
    const { state } = await ctx.repository.load({ movementIds: [movementId] })
    const snapshot = buildLedgerSnapshot(state)
    const movement = state.movements.find((item) => item.id === movementId)
    if (!movement) return showHistory(ctx, 'هذه الحركة لم تعد موجودة في السجل.', session.page)
    const text = [
      '<b>تأكيد إلغاء الحركة</b>',
      '<code>الإلغاء يبقي الحركة في السجل كملغية</code>',
      '',
      movementBlockquote(movement, snapshot.accountById, { includeDate: true }),
    ].join('\n')
    return sendScreen(ctx, text, historyCancelConfirmKeyboard(session.actionSessionId, token))
  }

  if (action === 'confirm') {
    const result = await ctx.repository.update(
      (state) => voidRecentMovementInState(
        state,
        movementId,
        new Date().toISOString(),
        { idempotencyKey: telegramUpdateIdempotencyKey(ctx.updateId, 'movement-cancel') },
      ),
      { movementIds: [movementId] },
    )
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
  const accountLegend = accountChoiceLegendText(results.map((bucket) => bucket.account))
  const textResult = results.length
    ? `<b>ADREEM · نتائج البحث</b>\n<code>${results.length} نتيجة</code>\n\n<b>اختر الحساب</b>${accountLegend ? `\n<code>${escapeHtml(accountLegend)}</code>` : ''}`
    : '<b>ADREEM · بحث</b>\n<blockquote>لا توجد نتيجة.</blockquote>'
  const replyMarkup = results.length ? accountsBrowserKeyboard(results, resultSession) : mainMenuKeyboard()
  if (targetMessageId) {
    try {
      return await ctx.telegram.editMessageText({
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
  return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: textResult, parse_mode: 'HTML', reply_markup: replyMarkup })
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
    return ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `<b>رقم تيليغرام</b>\n<blockquote>${escapeHtml(String(ctx.userId || ''))}</blockquote>`,
      parse_mode: 'HTML',
    })
  }
  if (supabaseLedgerAccess) {
    if (!ctx.identity?.isOwner) return false
    if (['/admin', '/helpadmin', '/users', '/adduser'].some((command) => text === command || text.startsWith(`${command} `))) {
      return ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: '<b>إدارة المستخدمين من الويب</b>\n<blockquote>افتح ADREEM ثم اختر إدارة المستخدمين.</blockquote>',
        parse_mode: 'HTML',
      })
    }
    return false
  }
  if (!userAccess.isAdmin(ctx.userId)) return false
  if (text === '/admin' || text === '/helpadmin') {
    return ctx.telegram.sendMessage({ chat_id: ctx.chatId, text: helpAdminText(), parse_mode: 'HTML' })
  }
  if (text === '/users') {
    const users = userAccess.listUsers()
    const rows = users.length
      ? users.map((user) => `${user.source === 'env' ? 'ثابت' : 'مضاف'} · ${user.telegramUserId} · ${user.ledgerId}`).join('\n')
      : 'لا يوجد مستخدمون.'
    return ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: `<b>ADREEM · المستخدمون</b>\n<blockquote>${escapeHtml(rows)}</blockquote>`,
      parse_mode: 'HTML',
    })
  }
  if (text.startsWith('/adduser')) {
    return ctx.telegram.sendMessage({
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

async function showMovementPickerPage(ctx, kind, requestedPage) {
  const session = sessions.get(ctx.chatId, ctx.userId)
  const step = kind === 'category' ? 'category' : 'dimension'
  if (session?.flow !== 'movement' || session.step !== step) {
    return handleMovementCallback(ctx, `mv:${step}:page:${requestedPage}`)
  }
  if (session.uiMessageId && ctx.messageId && session.uiMessageId !== ctx.messageId) {
    return sendScreen(ctx, '<b>هذه أزرار من خطوة قديمة.</b>\n<blockquote>استخدم بطاقة الحركة الحالية.</blockquote>')
  }

  const { state } = await ctx.repository.load()
  const dimensions = dimensionsFromAccounts(state.accounts, state.dimensions)
  const expenseCategories = (state.accounts || []).filter((account) => account.status === 'active' && account.valueKind === VALUE_KINDS.EXPENSE)
  const choices = kind === 'category' ? expenseCategories : dimensions
  const { page, pageCount } = boundedPage(choices.length, requestedPage, MOVEMENT_PICKER_PAGE_SIZE)
  const visibleChoices = choices.slice(page * MOVEMENT_PICKER_PAGE_SIZE, (page + 1) * MOVEMENT_PICKER_PAGE_SIZE)
  const choiceKey = kind === 'category' ? 'category' : 'dimension'
  const nextSession = {
    ...session,
    choices: {
      ...session.choices,
      [choiceKey]: Object.fromEntries(visibleChoices.map((item, index) => [String(index), item.id])),
    },
  }
  sessions.set(ctx.chatId, ctx.userId, nextSession)

  const snapshot = buildLedgerSnapshot(state)
  const dimensionById = new Map(dimensions.map((dimension) => [dimension.id, dimension]))
  const expenseCategoryById = new Map(expenseCategories.map((category) => [category.id, category]))
  const label = kind === 'category' ? 'نوع مصروف' : 'مشروع أو أصل'
  const text = [
    movementStepText(nextSession, snapshot.accountById, dimensionById, expenseCategoryById),
    '',
    `<code>${choices.length} ${label} · صفحة ${page + 1}/${pageCount}</code>`,
  ].join('\n')
  const keyboard = kind === 'category'
    ? expenseCategoryKeyboard(expenseCategories, { page, pageSize: MOVEMENT_PICKER_PAGE_SIZE, selectedId: nextSession.draft.expenseCategoryId })
    : dimensionKeyboard(dimensions, { page, pageSize: MOVEMENT_PICKER_PAGE_SIZE, selectedId: nextSession.draft.dimensionId })
  return sendScreen(ctx, text, keyboard)
}

async function dispatchCallback(ctx, data) {
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
  if (data.startsWith('net:')) return handleNetPositionCallback(ctx, data)
  if (data.startsWith('reports:')) return handleReportsCallback(ctx, data)
  if (data.startsWith('repeat:')) return handleRecurringCallback(ctx, data)
  if (data.startsWith('review:')) return handleReviewCallback(ctx, data)
  if (data.startsWith('history:')) return handleHistoryCallback(ctx, data)
  if (data.startsWith('acct:')) return handleAccountCallback(ctx, data)
  if (data.startsWith('mv:dimension:page:')) return showMovementPickerPage(ctx, 'dimension', Number(data.slice('mv:dimension:page:'.length)))
  if (data.startsWith('mv:category:page:')) return showMovementPickerPage(ctx, 'category', Number(data.slice('mv:category:page:'.length)))
  if (data.startsWith('mv:')) return handleMovementCallback(ctx, data)
  if (data.startsWith('rec:')) return handleReconciliationCallback(ctx, data)
  return sendScreen(ctx, 'أمر غير معروف.')
}

async function handleCallback(ctx, update) {
  const callbackId = update.callback_query?.id
  const data = update.callback_query?.data || ''
  console.log('[adreem-telegram-bot] callback', {
    userId: ctx.userId,
    data,
  })
  return runCallbackActionWithBestEffortAck(
    () => dispatchCallback(ctx, data),
    () => ctx.telegram.answerCallbackQuery({ callback_query_id: callbackId }),
    {
      onAckError(error) {
        console.error('[adreem-telegram-bot] callback acknowledgement failed', error?.message || error)
      },
    },
  )
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
  return ctx.telegram.sendMessage({
    chat_id: ctx.chatId,
    text: '<b>افتح ADREEM من /start</b>',
    parse_mode: 'HTML',
    reply_markup: mainMenuKeyboard(),
  })
}

async function handleUpdate(update, execution = null) {
  let ctx = contextFor(update, null, execution)
  if (!isPrivateTelegramUpdate(update)) {
    if (update.callback_query?.id) {
      await ctx.telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })
    }
    if (ctx.chatId) {
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: '<b>استخدم ADREEM في محادثة خاصة فقط.</b>',
        parse_mode: 'HTML',
      })
    }
    return
  }
  const identity = await identityForUser(ctx.userId)
  if (!identity) {
    if (ctx.chatId) {
      await ctx.telegram.sendMessage({
        chat_id: ctx.chatId,
        text: `<b>هذا الدفتر خاص.</b>\n<blockquote>أرسل هذا الرقم لصاحب النظام ليضيفك:\n${escapeHtml(String(ctx.user?.id || ''))}</blockquote>`,
        parse_mode: 'HTML',
      })
    }
    return
  }
  ctx = contextFor(update, identity, execution)
  ctx.repository = repositoryForIdentity(identity)
  if (!ctx.repository) {
    const text = String(update.message?.text || '').trim()
    if (text && await handleAdminCommand(ctx, text)) return
    if (update.callback_query?.id) {
      await ctx.telegram.answerCallbackQuery({ callback_query_id: update.callback_query.id })
    }
    await ctx.telegram.sendMessage({
      chat_id: ctx.chatId,
      text: '<b>لا يوجد دفتر معيّن لهذا المستخدم.</b>\n<blockquote>عيّن دفترًا صريحًا قبل استخدام البوت.</blockquote>',
      parse_mode: 'HTML',
    })
    return
  }
  sessions.bindScope(ctx.chatId, ctx.userId, identity)
  try {
    if (update.callback_query) return await handleCallback(ctx, update)
    if (update.message) return await handleMessage(ctx, update)
  } finally {
    sessions.releaseScope(ctx.chatId, ctx.userId)
  }
}

async function handleUpdateDurably(update) {
  if (!durableRuntime.durableState) {
    try {
      await handleUpdate(update)
    } finally {
      await sessions.flush()
    }
    return { status: 'completed', processed: true }
  }
  return durableRuntime.durableState.runUpdate(update.update_id, async (execution) => {
    await hydrateDurableSession(durableRuntime, getChatId(update), getUser(update)?.id ?? null)
    try {
      await handleUpdate(update, execution)
    } finally {
      await sessions.flush()
    }
  })
}

async function poll() {
  await restoreDurableOffset()
  await skipOldUpdates()
  while (true) {
    try {
      const updates = await telegram.getUpdates({ offset, timeout: 30, allowed_updates: ['message', 'callback_query'] })
      await processTelegramUpdates(updates, handleUpdateDurably, async (nextOffset) => {
        if (durableRuntime.durableState) await durableRuntime.durableState.setOffset(nextOffset)
        offset = nextOffset
      }, {
        onPermanentError(error, update) {
          console.error('[adreem-telegram-bot] permanently failed Telegram update; offset retained', {
            updateId: update.update_id,
            method: error.method,
            status: error.status,
            message: error.message,
          })
        },
        onQuarantined(result, update) {
          console.error('[adreem-telegram-bot] quarantined Telegram update', {
            updateId: update.update_id,
            attempts: result.attempts,
            code: result.failure?.code,
            message: result.failure?.message,
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
