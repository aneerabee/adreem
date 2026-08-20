/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
/* eslint-disable react-refresh/only-export-components -- Keep directly tested UI helpers in this owned module. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Banknote, Boxes, BriefcaseBusiness, Check, ChevronLeft, ChevronRight, CircleDollarSign, Landmark, ReceiptText, Search, SlidersHorizontal, UserRound, WalletCards, Wrench } from 'lucide-react'
import './adreemDesk.css'
import AdreemChrome from './AdreemChrome'
import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS, getActivePostingAccounts, knownExternalAccounts } from './accountCatalog'
import { accountClassificationOptions, accountContextLabel, accountDetailName, accountDisplayName, accountDraftSummary, accountKindLabel, accountDetailOptionsFor, accountNameValue, accountNeedsCurrency, accountPresetGroups, accountPresetFor, accountPresets, accountPresetStepCopy, accountPrimaryName, applyAccountClassification, applyAccountName, classificationValueFor as classificationValue, emptyAccountDraft, parseAccountClassification as parseClassification } from './accountConfig'
import { accountEditChanges, accountEditSnapshot, accountUpdateCurrency, accountUpdateMovementErrors, prepareAccountUpdate } from './accountEditing'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, buildPostingEntries, canCommitMovementEdit, createAccount, postMovement, previewMovement, summarizeBalances, validateAccount, validateMovement, voidMovement } from './ledgerCore'
import { ADREEM_API_TOKEN_PERSIST_KEY, ADREEM_API_TOKEN_SESSION_KEY, getMohammadPersistenceMode, loadMohammadPersistedState, logoutAdreemCloudSession, resolveAdreemAttachmentUrl, saveMohammadPersistedState, updateAdreemUserProfile, uploadAdreemAttachmentFile } from './mohammadPersistence'
import { createLatestSaveCoordinator } from './cloudSaveCoordinator'
import { createEmptyAdreemState, normalizeLedgerState, normalizeMohammadAccounts, sameRecordVersions } from './ledgerState'
import { MOVEMENT_ENTRY_STEPS, movementAccountCurrencyForRole, movementConfigFor, movementLabels, movementNeedsSource, movementSupportsDimension, movementTone, movementTypeOptions } from './movementConfig'
import { getMovementAccounts, normalizeAccountSearchText, rankMovementAccounts, sameLogicalAccount } from './movementAccounts'
import { DIMENSION_TYPES, RECURRING_FREQUENCIES, attachmentsForRecord, buildDimensionReports, buildExpenseCategoryReports, buildLedgerAlerts, buildReconciliationCorrectionDrafts, createAttachment, createAuditEvent, createReconciliation, createRecurringRuleFromMovement, disableRecurringRule, dimensionsFromAccounts, dueRecurringRules, executeRecurringRuleInState, findUnresolvedReconciliationDifferences, hideAttachment, lastReconciliationForAccount, syncRecurringRulesFromMovement, syncRecurringRulesFromSourceMovement, updateRecurringRule } from './ledgerOperations'
import { normalizeUiLanguage, uiLanguageDirection, uiLanguageLocale } from './uiLanguage'
import { getActiveUiLanguage, preserveUiData, readRememberedUiLanguage, rememberUiLanguage, setActiveUiLanguage, translateUiText } from './uiTranslation'

const CANCEL_WINDOW_HOURS = 24
const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000
const USD_MAXIMUM_FRACTION_DIGITS = 6

const accountGroupTabs = [
  { key: 'people', label: 'الناس', title: 'الناس' },
  { key: 'money', label: 'فلوسي', title: 'فلوسي' },
  { key: 'assets', label: 'متابعة', title: 'الأصول والمشاريع' },
  { key: 'expenses', label: 'مصروفات', title: 'المصروفات' },
  { key: 'review', label: 'ناقص', title: 'مراجعة' },
]

const ACCOUNT_WIZARD_STEPS = {
  GROUP: 'group',
  PRESET: 'preset',
  NAME: 'name',
  DETAIL: 'detail',
  CURRENCY: 'currency',
  SAVE: 'save',
}

const sectionTitles = {
  entry: 'عملية جديدة',
  accounts: 'الأرصدة',
  history: 'الحركات',
  review: 'المراجعة',
}

const movementOptionGroups = [
  {
    key: 'daily',
    title: 'اليومي',
    hint: 'الأكثر استعمالًا',
    types: [MOVEMENT_TYPES.TRANSFER, MOVEMENT_TYPES.EXPENSE, MOVEMENT_TYPES.EXTERNAL_INCOME],
  },
  {
    key: 'banking',
    title: 'المصرف',
    hint: 'إيداع أو سحب',
    types: [MOVEMENT_TYPES.CASH_DEPOSIT, MOVEMENT_TYPES.CASH_WITHDRAWAL],
  },
  {
    key: 'exchange',
    title: 'الدولار',
    hint: 'بيع أو شراء',
    types: [MOVEMENT_TYPES.USD_SALE, MOVEMENT_TYPES.USD_PURCHASE],
  },
]

function MovementTypeIcon({ type }) {
  const props = { 'aria-hidden': true, size: 19, strokeWidth: 2.15 }
  if (type === MOVEMENT_TYPES.TRANSFER) return <ArrowRightLeft {...props} />
  if (type === MOVEMENT_TYPES.EXPENSE) return <ReceiptText {...props} />
  if (type === MOVEMENT_TYPES.EXTERNAL_INCOME) return <ArrowDownToLine {...props} />
  if (type === MOVEMENT_TYPES.CASH_DEPOSIT) return <Landmark {...props} />
  if (type === MOVEMENT_TYPES.CASH_WITHDRAWAL) return <ArrowUpFromLine {...props} />
  if (type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) return <CircleDollarSign {...props} />
  return <Banknote {...props} />
}

function AccountPresetIcon({ presetKey }) {
  const props = { 'aria-hidden': true, size: 19 }
  if (presetKey === 'person-cash') return <UserRound {...props} />
  if (presetKey === 'own-cash') return <Banknote {...props} />
  if (presetKey === 'own-bank') return <Landmark {...props} />
  if (presetKey === 'asset') return <Boxes {...props} />
  if (presetKey === 'project') return <BriefcaseBusiness {...props} />
  if (presetKey === 'expense') return <ReceiptText {...props} />
  return <WalletCards {...props} />
}

function AccountGroupIcon({ groupKey }) {
  const props = { 'aria-hidden': true, size: 19 }
  if (groupKey === 'people') return <UserRound {...props} />
  if (groupKey === 'money') return <WalletCards {...props} />
  return <Boxes {...props} />
}

function MovementChoiceButton({ option, active, onChoose }) {
  return (
    <button type="button" className={`ml3-action-choice ml3-action-choice--${option.tone} ${active ? 'is-active' : ''}`} onClick={() => onChoose(option.type)}>
      <MovementTypeIcon type={option.type} />
      <span>
        <strong>{option.label}</strong>
        <small>{option.detail}</small>
      </span>
      <ChevronLeft aria-hidden="true" size={16} />
    </button>
  )
}

function FlowProgress({ current, total, items = [], onEdit }) {
  return (
    <div className="adreem-flow-progress" aria-label={`الخطوة ${formatCount(current)} من ${formatCount(total)}`}>
      <progress className="adreem-flow-progress-line" max={Math.max(1, total)} value={Math.max(0, Math.min(total, current))} aria-hidden="true" />
      <div className="adreem-flow-progress-meta">
        <span>
          {formatCount(current)} من {formatCount(total)}
        </span>
        {items.length ? (
          <div className="adreem-flow-trail" aria-label="الاختيارات السابقة">
            {items.map((item) => (
              <button type="button" key={item.key} onClick={() => onEdit?.(item.step)} title={getActiveUiLanguage() === 'en' ? `Edit ${translateUiText(item.label, 'en')}` : `تعديل ${item.label}`}>
                <Check aria-hidden="true" size={13} strokeWidth={2.7} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </div>
        ) : (
          <small>ابدأ باختيار واحد</small>
        )}
      </div>
    </div>
  )
}

function loadInitialLedgerState() {
  const fallback = createEmptyAdreemState()
  return {
    ...fallback,
    accounts: normalizeMohammadAccounts(fallback.accounts),
  }
}

function ledgerExtrasFromState(state) {
  const normalized = normalizeLedgerState(state)
  return {
    appId: normalized.appId,
    tenantId: normalized.tenantId,
    ledgerId: normalized.ledgerId,
    version: normalized.version,
    resetAt: normalized.resetAt,
    migratedFrom: normalized.migratedFrom,
    dimensions: normalized.dimensions,
    attachments: normalized.attachments,
    recurringRules: normalized.recurringRules,
    reconciliations: normalized.reconciliations,
    ignoredExternalAccounts: normalized.ignoredExternalAccounts,
    auditEvents: normalized.auditEvents,
  }
}

function sameLedgerExtras(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function localizeDigit(character) {
  const code = character.charCodeAt(0)
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
  return character
}

export function normalizeLocalizedNumericInput(value, { allowDecimal = false, allowNegative = false } = {}) {
  const raw = String(value ?? '')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, localizeDigit)
    .replace(/\u2212/g, '-')
  const decimalIndex = raw.search(/[.\u066b]/)
  const wholeSource = decimalIndex >= 0 ? raw.slice(0, decimalIndex) : raw
  const whole = wholeSource.replace(/\D/g, '')
  const sign = allowNegative && /^\s*-/.test(raw) && whole ? '-' : ''

  if (!allowDecimal) return whole ? `${sign}${whole}` : ''
  const fractionSource = decimalIndex >= 0 ? raw.slice(decimalIndex + 1).split(/[.\u066b]/, 1)[0] : ''
  const fraction = fractionSource.replace(/\D/g, '')
  if (!whole && decimalIndex < 0) return ''
  return `${sign}${whole || '0'}${decimalIndex >= 0 ? `.${fraction}` : ''}`
}

export function parseLocalizedDecimal(value) {
  const normalized = normalizeLocalizedNumericInput(value, { allowDecimal: true, allowNegative: true })
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

export function parseWholeAmount(value) {
  return Math.round(parseLocalizedDecimal(value))
}

export function parseMoneyAmount(value) {
  return parseWholeAmount(value)
}

export function formatMoneyNumber(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return Math.round(number).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function hasMoneyValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number !== 0
}

export function money(value, currency = CURRENCIES.DINAR) {
  const unit = currency === CURRENCIES.USD ? '$' : 'د.ل'
  return `${formatMoneyNumber(value, currency)} ${unit}`
}

export function signedMoney(value, currency = CURRENCIES.DINAR) {
  const number = Number(value || 0)
  const displayValue = Math.round(number)
  const prefix = displayValue > 0 ? '+' : displayValue < 0 ? '-' : ''
  return `${prefix}${formatMoneyNumber(Math.abs(displayValue), currency)} ${currency === CURRENCIES.USD ? '$' : 'د.ل'}`
}

function formatInteger(value) {
  const rounded = parseWholeAmount(value)
  return rounded.toLocaleString('en-US')
}

function formatCount(value) {
  return formatInteger(value)
}

function formatRate(value) {
  const number = parseLocalizedDecimal(value)
  if (!Number.isFinite(number)) return ''
  return number.toLocaleString('en-US', {
    maximumFractionDigits: USD_MAXIMUM_FRACTION_DIGITS,
  })
}

function formatNumericEntryValue(value, allowDecimal = false) {
  const raw = normalizeLocalizedNumericInput(value, { allowDecimal })
  if (!raw) return ''
  if (allowDecimal) {
    const [whole, fraction = ''] = raw.split('.')
    const formattedWhole = whole ? formatInteger(whole) : '0'
    return raw.includes('.') ? `${formattedWhole}.${fraction}` : formattedWhole
  }
  return formatInteger(raw)
}

function emptyMovementDraft(type = MOVEMENT_TYPES.TRANSFER) {
  const config = movementConfigFor(type)
  return {
    type,
    amount: '',
    currency: config.currency || CURRENCIES.DINAR,
    sourceAccountId: '',
    destinationAccountId: '',
    rate: '',
    note: '',
    dimensionId: '',
    expenseCategoryId: '',
    attachmentLabel: '',
    attachmentUrl: '',
    recurringEnabled: false,
    recurringFrequency: RECURRING_FREQUENCIES.MONTHLY,
  }
}

function accountLabel(account) {
  return account ? accountDisplayName(account) : ''
}

function accountPrimaryUserValue(account) {
  const primaryName = accountPrimaryName(account)
  const enteredName = String(accountNameValue(account) || '').trim().replace(/\s+/g, ' ')
  return enteredName && enteredName === primaryName ? primaryName : ''
}

function protectUiValues(value, protectedValues = []) {
  const values = Array.from(new Set(protectedValues
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  if (!values.length) return String(value || '')
  const pattern = new RegExp(values.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu')
  return String(value || '').replace(pattern, (item) => preserveUiData(item))
}

function protectedAccountLabel(account) {
  if (!account) return ''
  const protectedValues = [accountPrimaryUserValue(account)]
  const context = accountContextLabel(account)
  const detail = accountDetailName(account)
  const knownDetails = accountDetailOptionsFor(account.type, account.valueKind)
  if (detail && context.includes(detail) && !knownDetails.some((knownDetail) => context.startsWith(knownDetail))) {
    protectedValues.push(detail)
  }
  return protectUiValues(accountLabel(account), protectedValues)
}

function protectedAccountPrimaryName(account) {
  if (!account) return ''
  return protectUiValues(accountPrimaryName(account), [accountPrimaryUserValue(account)])
}

function protectedAccountContext(account) {
  if (!account) return ''
  const context = accountContextLabel(account)
  const detail = accountDetailName(account)
  const knownDetails = accountDetailOptionsFor(account.type, account.valueKind)
  if (knownDetails.some((knownDetail) => context.startsWith(knownDetail))) return context
  return detail && context.includes(detail) ? protectUiValues(context, [detail]) : context
}

function protectedAccountDraftSummary(accountDraft) {
  return protectUiValues(accountDraftSummary(accountDraft), [accountNameValue(accountDraft)])
}

function protectedUserProfile(profile) {
  if (!profile) return profile
  return {
    ...profile,
    displayName: profile.displayName ? preserveUiData(profile.displayName) : profile.displayName,
    email: profile.email ? preserveUiData(profile.email) : profile.email,
    userId: profile.userId ? preserveUiData(profile.userId) : profile.userId,
  }
}

function movementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'تم'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقص'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغي'
  return 'مسودة'
}

function movementErrorFieldLabel(field) {
  const labels = {
    type: 'نوع الحركة',
    amount: 'المبلغ',
    currency: 'العملة',
    rate: 'سعر الصرف',
    sourceAccountId: 'الحساب الذي خرجت منه الفلوس',
    destinationAccountId: 'الحساب الذي دخلت إليه الفلوس',
    expenseCategoryId: 'نوع المصروف',
  }
  return labels[field] || 'بيانات ناقصة'
}

function movementTime(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(uiLanguageLocale(getActiveUiLanguage()), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function movementDateTime(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(uiLanguageLocale(getActiveUiLanguage()), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function movementDayKey(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function movementDayLabel(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return 'تاريخ غير معروف'
  if (isToday(value)) return 'اليوم'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) return 'أمس'
  return date.toLocaleDateString(uiLanguageLocale(getActiveUiLanguage()), {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function isToday(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return false
  const today = new Date()
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
}

function isRecentMovement(movement, now = Date.now()) {
  const date = new Date(movement?.createdAt || movement?.updatedAt || '')
  if (Number.isNaN(date.getTime())) return false
  return now - date.getTime() <= CANCEL_WINDOW_MS
}

function canCancelMovement(movement) {
  return movement?.status === MOVEMENT_STATUSES.POSTED && !movement.id?.startsWith('opening-') && isRecentMovement(movement)
}

export function storageTextForStatus(saveStatus, storageMode) {
  return (
    {
      loading: 'تحميل',
      saving: 'حفظ',
      retrying: 'إعادة الحفظ',
      failed: 'فشل الحفظ',
      saved: storageMode === 'supabase' || storageMode === 'api' ? 'سحابي' : 'تطوير',
      local: storageMode === 'api-missing-token' ? 'دخول ناقص' : 'تطوير',
      'local-only': storageMode === 'api-missing-token' ? 'دخول ناقص' : 'سحابة متوقفة',
    }[saveStatus] || 'تطوير'
  )
}

export function saveFailureMessage(error, retryDelay) {
  if (retryDelay === null) {
    return error?.status === 409 ? 'تغيّرت بيانات الدفتر في جلسة أخرى. أعد تحميل الصفحة قبل المتابعة.' : 'تعذر تأكيد الحفظ. أعد تحميل الصفحة ثم حاول مرة أخرى.'
  }
  return `لم يتم تأكيد الحفظ. سيحاول النظام تلقائيًا خلال ${Math.max(1, Math.round(retryDelay / 1000))} ث.`
}

async function logoutFromCloudSession() {
  if (typeof window === 'undefined') return
  try {
    await logoutAdreemCloudSession()
  } catch (error) {
    console.warn('[adreem-ledger] cloud logout failed:', error?.message || error)
  } finally {
    try {
      window.sessionStorage?.removeItem(ADREEM_API_TOKEN_SESSION_KEY)
    } catch {
      // If session storage is blocked, continue clearing the persistent device login below.
    }
    try {
      window.localStorage?.removeItem(ADREEM_API_TOKEN_PERSIST_KEY)
    } catch {
      // If browser storage is blocked, reloading is still enough to reset the current view.
    }
    window.location.assign(`${window.location.pathname}${window.location.search}`)
  }
}

function openAdminUsersPage() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('admin', 'users')
  url.hash = ''
  window.location.assign(`${url.pathname}${url.search}`)
}

function movementVisibleSteps(config, needsSource) {
  return [MOVEMENT_ENTRY_STEPS.TYPE, MOVEMENT_ENTRY_STEPS.AMOUNT, config.currencyLocked ? null : MOVEMENT_ENTRY_STEPS.CURRENCY, config.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : null, needsSource ? MOVEMENT_ENTRY_STEPS.SOURCE : null, config.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : null, MOVEMENT_ENTRY_STEPS.NOTE, MOVEMENT_ENTRY_STEPS.REVIEW].filter(Boolean)
}

function movementStepCopy(step, config = {}) {
  if (step === MOVEMENT_ENTRY_STEPS.TYPE) return { title: 'نوع الحركة', summary: 'اختر العملية التي تريد تسجيلها.' }
  if (step === MOVEMENT_ENTRY_STEPS.AMOUNT) return { title: 'المبلغ', summary: 'اكتب الرقم فقط، بدون فواصل.' }
  if (step === MOVEMENT_ENTRY_STEPS.CURRENCY) return { title: 'العملة', summary: 'اختر العملة قبل اختيار الحسابات.' }
  if (step === MOVEMENT_ENTRY_STEPS.RATE)
    return {
      title: 'سعر الصرف',
      summary: config.rateLabel || 'اكتب سعر البيع أو الشراء.',
    }
  if (step === MOVEMENT_ENTRY_STEPS.SOURCE)
    return {
      title: config.sourceLabel || 'من',
      summary: config.sourceQuestion || 'اختر من أين تخرج الفلوس.',
    }
  if (step === MOVEMENT_ENTRY_STEPS.DESTINATION)
    return {
      title: config.destinationLabel || 'إلى',
      summary: config.destinationQuestion || 'اختر أين تدخل الفلوس.',
    }
  if (step === MOVEMENT_ENTRY_STEPS.NOTE)
    return {
      title: 'ملاحظة ومرفق',
      summary: 'اختياري: ملاحظة، ملف، أو ربط بمشروع.',
    }
  return { title: 'المراجعة', summary: 'راجع التأثير قبل الحفظ.' }
}

function nonZero(bucket) {
  return hasMoneyValue(bucket.dinar) || hasMoneyValue(bucket.usd)
}

function externalAccountKey(account = {}) {
  return String(account.id || `${account.ownerName || ''}:${account.subAccountName || ''}`).trim()
}

export function movementHistoryForPreview(movements = [], editingMovementId = '') {
  if (!editingMovementId) return movements
  return movements.filter((movement) => movement.id !== editingMovementId)
}

export function accountReviewSelection(classificationValue, currencyKind = ACCOUNT_CURRENCY_KINDS.DINAR) {
  const classification = parseClassification(classificationValue)
  return {
    type: classification.type,
    valueKind: classification.valueKind,
    currencyKind: accountNeedsCurrency(classification) ? (currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? ACCOUNT_CURRENCY_KINDS.USD : ACCOUNT_CURRENCY_KINDS.DINAR) : ACCOUNT_CURRENCY_KINDS.DINAR,
  }
}

export const accountClassificationMovementErrors = accountUpdateMovementErrors

function accountClassificationCurrency(account, classification, requestedCurrencyKind) {
  return accountUpdateCurrency(account, classification, requestedCurrencyKind)
}

export function prepareAccountClassificationUpdate({ accounts = [], movements = [], accountId, ownerName, subAccountName, classificationValue, currencyKind, updatedAt = new Date().toISOString() } = {}) {
  const classification = parseClassification(classificationValue)
  return prepareAccountUpdate({
    accounts,
    movements,
    accountId,
    draft: { ownerName, subAccountName, ...classification, currencyKind },
    updatedAt,
  })
}

export function cancelMovementConfirmation(target) {
  const cancelLabel = `${movementLabels[target.type] || 'الحركة'} بقيمة ${money(target.amount, target.currency)}`
  return translateUiText(`هل تريد إلغاء ${cancelLabel}؟ ستبقى الحركة ظاهرة في السجل.`)
}

export function mergeAccountsConfirmation(sourceAccount, targetAccount) {
  const sourceName = preserveUiData(accountLabel(sourceAccount))
  const targetName = preserveUiData(accountLabel(targetAccount))
  return translateUiText(`هل تريد دمج حساب ${sourceName} داخل ${targetName}؟ ستُنقل الحركات ومرفقات الحساب إلى الحساب المختار.`)
}

export function claimSubmission(lock, key) {
  if (!lock || lock.current === key) return false
  lock.current = key
  return true
}

export function releaseSubmission(lock, key) {
  if (lock?.current === key) lock.current = ''
}

export function filterMovementHistory({ movements = [], query = '', type = '', status = '', accountId = '', dimensionId = '', expenseCategoryId = '', accountById = new Map(), dimensionById = new Map() } = {}) {
  const normalizedQuery = normalizeAccountSearchText(query)
  return movements.filter((movement) => {
    if (type && movement.type !== type) return false
    if (status && movement.status !== status) return false
    if (accountId && movement.sourceAccountId !== accountId && movement.destinationAccountId !== accountId) return false
    if (dimensionId && movement.dimensionId !== dimensionId) return false
    if (expenseCategoryId && movement.expenseCategoryId !== expenseCategoryId) return false
    if (!normalizedQuery) return true
    const source = accountById.get(movement.sourceAccountId)
    const destination = accountById.get(movement.destinationAccountId)
    const expenseCategory = accountById.get(movement.expenseCategoryId)
    const dimension = dimensionById.get(movement.dimensionId)
    const haystack = normalizeAccountSearchText([
      movementLabels[movement.type],
      movementStatusLabel(movement.status),
      movement.note,
      source ? accountLabel(source) : '',
      destination ? accountLabel(destination) : '',
      expenseCategory ? accountLabel(expenseCategory) : '',
      dimension?.name,
    ].join(' '))
    return haystack.includes(normalizedQuery)
  })
}

export function mergeLedgerAccountState({ accounts = [], movements = [], attachments = [], dimensions = [], recurringRules = [], reconciliations = [] } = {}, sourceAccountId, targetAccountId, updatedAt = new Date().toISOString()) {
  const nextMovements = movements.map((movement) => {
    const affected = movement.sourceAccountId === sourceAccountId || movement.destinationAccountId === sourceAccountId || movement.expenseCategoryId === sourceAccountId
    if (!affected) return movement
    return {
      ...movement,
      sourceAccountId: movement.sourceAccountId === sourceAccountId ? targetAccountId : movement.sourceAccountId,
      destinationAccountId: movement.destinationAccountId === sourceAccountId ? targetAccountId : movement.destinationAccountId,
      expenseCategoryId: movement.expenseCategoryId === sourceAccountId ? targetAccountId : movement.expenseCategoryId,
      mergedFromAccountId: sourceAccountId,
      updatedAt,
    }
  })
  const nextAccounts = accounts.map((account) => {
    if (account.id === sourceAccountId) {
      return {
        ...account,
        status: ACCOUNT_STATUSES.INACTIVE,
        mergedIntoAccountId: targetAccountId,
        disabledAt: updatedAt,
        updatedAt,
      }
    }
    return account.id === targetAccountId ? { ...account, updatedAt } : account
  })
  const nextAttachments = attachments.map((attachment) =>
    attachment.accountId === sourceAccountId
      ? {
          ...attachment,
          accountId: targetAccountId,
          mergedFromAccountId: sourceAccountId,
          updatedAt,
        }
      : attachment,
  )
  const nextDimensions = dimensions.map((dimension) =>
    dimension.linkedAccountId === sourceAccountId
      ? { ...dimension, linkedAccountId: targetAccountId, mergedFromAccountId: sourceAccountId, updatedAt }
      : dimension,
  )
  const nextRecurringRules = recurringRules.map((rule) => {
    const template = rule?.template || {}
    const affected = [template.sourceAccountId, template.destinationAccountId, template.expenseCategoryId].includes(sourceAccountId)
    if (!affected) return rule
    return {
      ...rule,
      template: {
        ...template,
        sourceAccountId: template.sourceAccountId === sourceAccountId ? targetAccountId : template.sourceAccountId,
        destinationAccountId: template.destinationAccountId === sourceAccountId ? targetAccountId : template.destinationAccountId,
        expenseCategoryId: template.expenseCategoryId === sourceAccountId ? targetAccountId : template.expenseCategoryId,
      },
      mergedFromAccountId: sourceAccountId,
      updatedAt,
    }
  })
  const nextReconciliations = reconciliations.map((reconciliation) =>
    reconciliation.accountId === sourceAccountId
      ? { ...reconciliation, accountId: targetAccountId, mergedFromAccountId: sourceAccountId, updatedAt }
      : reconciliation,
  )
  return {
    accounts: nextAccounts,
    movements: nextMovements,
    attachments: nextAttachments,
    dimensions: nextDimensions,
    recurringRules: nextRecurringRules,
    reconciliations: nextReconciliations,
  }
}

export function areMergeAccountsCompatible(sourceAccount, targetAccount) {
  if (!sourceAccount || !targetAccount || sourceAccount.id === targetAccount.id) return false
  if (targetAccount.status !== ACCOUNT_STATUSES.ACTIVE) return false
  if (sourceAccount.valueKind === VALUE_KINDS.REVIEW) return true
  if (sourceAccount.valueKind !== targetAccount.valueKind) return false
  const sourceCurrency = sourceAccount.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR
  const targetCurrency = targetAccount.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR
  return sourceCurrency === targetCurrency
}

export function mergeAccountReferenceErrors({ candidate, sourceAccount, targetAccount } = {}) {
  const errors = []
  if (!areMergeAccountsCompatible(sourceAccount, targetAccount)) errors.push('تصنيف أو عملة الحسابين غير متوافقين.')

  for (const dimension of candidate?.dimensions || []) {
    if (dimension.mergedFromAccountId !== sourceAccount?.id || dimension.linkedAccountId !== targetAccount?.id) continue
    const expectedValueKind = dimension.type === DIMENSION_TYPES.ASSET ? VALUE_KINDS.ASSET : VALUE_KINDS.PROJECT
    if (targetAccount.valueKind !== expectedValueKind) errors.push('المشروع أو الأصل لا يطابق الحساب المختار.')
  }

  const reconciliableKinds = new Set([VALUE_KINDS.CASH, VALUE_KINDS.BANK])
  if ((candidate?.reconciliations || []).some((item) => item.mergedFromAccountId === sourceAccount?.id) && !reconciliableKinds.has(targetAccount?.valueKind)) {
    errors.push('مطابقات الرصيد تحتاج حساب كاش أو مصرف.')
  }

  for (const rule of candidate?.recurringRules || []) {
    if (rule.mergedFromAccountId !== sourceAccount?.id || rule.status !== ACCOUNT_STATUSES.ACTIVE) continue
    const movement = { ...rule.template, status: MOVEMENT_STATUSES.POSTED }
    if (!validateMovement(movement, candidate.accounts, candidate.movements || []).ok) {
      errors.push('إحدى الحركات الشهرية لا تناسب الحساب المختار.')
    }
  }

  return Array.from(new Set(errors))
}

function MetricChip({ label, value, tone = 'neutral', currency = CURRENCIES.DINAR }) {
  return (
    <article className={`ml3-metric ml3-metric--${tone}`}>
      <span>{label}</span>
      <strong>{money(value, currency)}</strong>
    </article>
  )
}

function visualKind(account) {
  if (account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || account.valueKind === VALUE_KINDS.REVIEW) return 'review'
  if (account.valueKind === VALUE_KINDS.CASH) return 'cash'
  if (account.valueKind === VALUE_KINDS.BANK) return 'bank'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'expense'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'asset'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE && /مصرف|بنك|شيك|حساب/i.test(account.subAccountName || '')) return 'person-bank'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE && /دولار|usd/i.test(account.subAccountName || '')) return 'person-usd'
  return 'person'
}

function accountKindText(account) {
  return account ? accountKindLabel(account) : ''
}

export function accountBalanceChip(account, bucket, currency = '') {
  const dinar = Number(bucket?.dinar || 0)
  const usd = Number(bucket?.usd || 0)
  if (currency === CURRENCIES.DINAR) return accountBalanceChipForCurrency(account, dinar, CURRENCIES.DINAR)
  if (currency === CURRENCIES.USD) return accountBalanceChipForCurrency(account, usd, CURRENCIES.USD)
  const hasDinar = hasMoneyValue(dinar)
  const hasUsd = hasMoneyValue(usd)

  if (!hasDinar && hasUsd) {
    return {
      tone: usd > 0 ? 'positive' : 'negative',
      text: money(Math.abs(usd), CURRENCIES.USD),
    }
  }
  if (!hasDinar) return { tone: 'zero', text: 'صفر' }

  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return {
      tone: dinar > 0 ? 'positive' : 'negative',
      text: dinar > 0 ? money(dinar) : `ناقص ${money(Math.abs(dinar))}`,
    }
  }

  if (account?.valueKind === VALUE_KINDS.EXPENSE) {
    return { tone: 'expense', text: money(Math.abs(dinar)) }
  }

  if (account?.valueKind === VALUE_KINDS.ASSET) {
    return { tone: 'asset', text: money(Math.abs(dinar)) }
  }

  return {
    tone: dinar > 0 ? 'positive' : 'negative',
    text: dinar > 0 ? `أقبض ${money(dinar)}` : `أدفع ${money(Math.abs(dinar))}`,
  }
}

function accountBalanceChipForCurrency(account, amount, currency) {
  const value = Number(amount || 0)
  if (!hasMoneyValue(value)) return { tone: 'zero', text: money(0, currency) }
  const absolute = money(Math.abs(value), currency)

  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return {
      tone: value > 0 ? 'positive' : 'negative',
      text: value > 0 ? absolute : `ناقص ${absolute}`,
    }
  }
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return { tone: 'expense', text: absolute }
  if (account?.valueKind === VALUE_KINDS.ASSET) return { tone: 'asset', text: absolute }
  return {
    tone: value > 0 ? 'positive' : 'negative',
    text: value > 0 ? `أقبض ${absolute}` : `أدفع ${absolute}`,
  }
}

function compareBalanceBuckets(a, b) {
  const aActive = Math.abs(a.dinar) > 0.000001 || Math.abs(a.usd) > 0.000001
  const bActive = Math.abs(b.dinar) > 0.000001 || Math.abs(b.usd) > 0.000001
  return Number(bActive) - Number(aActive) || Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd)
}

function accountPrimaryBalance(bucket = {}) {
  const dinar = Number(bucket.dinar || 0)
  const usd = Number(bucket.usd || 0)
  const prefersUsd = bucket.account?.currencyKind === ACCOUNT_CURRENCY_KINDS.USD
  const preferred = prefersUsd
    ? { amount: usd, currency: CURRENCIES.USD, secondaryAmount: dinar, secondaryCurrency: CURRENCIES.DINAR }
    : { amount: dinar, currency: CURRENCIES.DINAR, secondaryAmount: usd, secondaryCurrency: CURRENCIES.USD }
  if (hasMoneyValue(preferred.amount) || !hasMoneyValue(preferred.secondaryAmount)) return preferred
  return {
    amount: preferred.secondaryAmount,
    currency: preferred.secondaryCurrency,
    secondaryAmount: preferred.amount,
    secondaryCurrency: preferred.currency,
  }
}

export function buildPeopleAccountViews(rows = []) {
  const sorted = [...rows].sort(compareBalanceBuckets)
  const positive = sorted.filter((bucket) => accountPrimaryBalance(bucket).amount > 0)
  const negative = sorted.filter((bucket) => accountPrimaryBalance(bucket).amount < 0)
  const zero = sorted.filter((bucket) => !nonZero(bucket))
  return {
    positive,
    negative,
    zero,
    withBalance: [...positive, ...negative],
    all: [...positive, ...negative, ...zero],
  }
}

export function AccountRow({ bucket, muted = false, onConfirm, onDisable, onOpen }) {
  const { account } = bucket
  const primaryBalance = accountPrimaryBalance(bucket)
  const balanceTone = primaryBalance.amount > 0 ? 'is-positive' : primaryBalance.amount < 0 ? 'is-negative' : 'is-zero'
  return (
    <article className={`ml3-account-row ml3-account-row--${visualKind(account)} ${balanceTone} ${muted ? 'is-muted' : ''}`}>
      <button type="button" className="ml3-account-main" onClick={() => onOpen?.(account.id)}>
        <strong>{protectedAccountPrimaryName(account)}</strong>
        <span className="ml3-account-meta">
          <small className="ml3-account-context">{protectedAccountContext(account)}</small>
          {account.status === ACCOUNT_STATUSES.NEEDS_REVIEW ? <b>تأكيد</b> : null}
        </span>
      </button>
      <div className={`ml3-account-values ${balanceTone}`}>
        {hasMoneyValue(primaryBalance.amount) ? <strong>{formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</strong> : <span>صفر</span>}
        {hasMoneyValue(primaryBalance.secondaryAmount) ? <strong>{money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency)}</strong> : null}
      </div>
      {(onConfirm || onDisable) && (
        <div className="ml3-row-actions">
          {onConfirm ? (
            <button type="button" className="ml3-mini-action is-confirm" onClick={() => onConfirm(account.id)}>
              تأكيد
            </button>
          ) : null}
          {onDisable ? (
            <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>
              تعطيل
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}

function formatDisplayMeaning(account, amount, currency = CURRENCIES.DINAR) {
  const rounded = Math.round(Number(amount || 0))
  if (!rounded) return 'صفر'
  const formattedAmount = money(Math.abs(rounded), currency)
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return `مصروف ${formattedAmount}`
  if (account?.valueKind === VALUE_KINDS.ASSET) return `قيمة ${formattedAmount}`
  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return rounded > 0 ? `موجود ${formattedAmount}` : `ناقص ${formattedAmount}`
  }
  return rounded > 0 ? `أقبض منه ${formattedAmount}` : `أدفع له ${formattedAmount}`
}

export { accountEditChanges }

function AccountEditHistory({ accountId, auditEvents = [] }) {
  const edits = auditEvents
    .filter((event) => event.action === 'account.updated' && event.details?.accountId === accountId)
    .map((event) => ({ ...event, changes: accountEditChanges(event.details?.before, event.details?.after) }))
    .filter((event) => event.changes.length)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))

  return (
    <section className="ml3-account-edit-history">
      <div className="ml3-profile-section-head">
        <h3>سجل التعديلات</h3>
        <span>{formatCount(edits.length)}</span>
      </div>
      {edits.length === 0 ? <p className="ml3-empty">لم يُعدّل هذا الحساب بعد.</p> : null}
      {edits.map((edit) => (
        <article key={edit.id}>
          <time>{movementDateTime(edit.createdAt)}</time>
          {edit.changes.map((change) => (
            <div key={`${edit.id}-${change.key}`}>
              <strong>{change.label}</strong>
              <span className="ml3-account-edit-values">
                <span>
                  <small>كان</small>
                  <b>{change.protectsUserData ? preserveUiData(change.before) : change.before}</b>
                </span>
                <span>
                  <small>أصبح</small>
                  <em>{change.protectsUserData ? preserveUiData(change.after) : change.after}</em>
                </span>
              </span>
            </div>
          ))}
        </article>
      ))}
    </section>
  )
}

function AccountList({ title, subtitle, rows, emptyText = 'لا شيء', onConfirm, onDisable, onOpen, embedded = false }) {
  const Tag = embedded ? 'div' : 'section'
  return (
    <Tag className={embedded ? 'ml3-list-block' : 'ml3-panel'}>
      <div className="ml3-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <span>{formatCount(rows.length)}</span>
      </div>
      <div className="ml3-list">{rows.length === 0 ? <p className="ml3-empty">{emptyText}</p> : rows.map((bucket) => <AccountRow key={bucket.account.id} bucket={bucket} onConfirm={onConfirm} onDisable={onDisable} onOpen={onOpen} />)}</div>
    </Tag>
  )
}

function AccountSearchSelect({ label, value, accounts, onChange, allowEmpty = true, preferredAccountIds = [], balanceByAccountId = new Map(), balanceCurrency = '' }) {
  const [query, setQuery] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const [showAllResults, setShowAllResults] = useState(false)
  const normalizedQuery = normalizeAccountSearchText(query)
  const selectedAccount = accounts.find((account) => account.id === value)
  const selectedBalance = selectedAccount ? accountBalanceChip(selectedAccount, balanceByAccountId.get(selectedAccount.id), balanceCurrency) : null
  const showChooser = !selectedAccount || isChanging
  const preferredIndexById = new Map(preferredAccountIds.map((accountId, index) => [accountId, index]))
  const accountBucket = (account) => balanceByAccountId.get(account.id) || { dinar: 0, usd: 0 }
  const accountMagnitude = (account) => {
    const bucket = accountBucket(account)
    if (balanceCurrency === CURRENCIES.USD) return Math.abs(Number(bucket.usd || 0))
    if (balanceCurrency === CURRENCIES.DINAR) return Math.abs(Number(bucket.dinar || 0))
    return Math.max(Math.abs(Number(bucket.dinar || 0)), Math.abs(Number(bucket.usd || 0)))
  }
  const hasVisibleBalance = (account) => accountMagnitude(account) > 0
  const preferredAccounts = preferredAccountIds.map((accountId) => accounts.find((account) => account.id === accountId)).filter(Boolean)
  const normalizedPreferredOwner = 'أنا'
  const quickFilters = [
    { key: '', label: 'الكل' },
    { key: 'active', label: 'رصيد' },
    { key: 'owner:أنا', label: 'أنا' },
    { key: 'kind:cash', label: 'كاش' },
    { key: 'kind:bank', label: 'مصرف' },
  ]
  const matchesQuickFilter = (account) => {
    if (!quickFilter) return true
    if (quickFilter === 'active') return hasVisibleBalance(account)
    if (quickFilter === 'owner:أنا') return account.ownerName === normalizedPreferredOwner
    if (quickFilter === 'kind:cash') return account.valueKind === VALUE_KINDS.CASH || account.subAccountName === 'كاش'
    if (quickFilter === 'kind:bank') return account.valueKind === VALUE_KINDS.BANK || /مصرف|بنك|شيك|حساب/i.test(account.subAccountName || '')
    return true
  }
  const rankAccount = (account) => {
    const ownerName = String(account.ownerName || '').trim()
    const labelText = normalizeAccountSearchText(accountLabel(account))
    const magnitude = accountMagnitude(account)
    if (preferredIndexById.has(account.id)) return -1000 + preferredIndexById.get(account.id)
    if (account.id === value) return -900
    if (ownerName === normalizedPreferredOwner) return -820
    if (magnitude > 0) return -700 - Math.min(magnitude / 1000, 250)
    if (normalizedQuery && labelText.startsWith(normalizedQuery)) return -500
    if (normalizedQuery && normalizeAccountSearchText(ownerName).startsWith(normalizedQuery)) return -480
    return 0
  }
  const filteredAccounts = accounts
    .filter((account) => {
      const haystack = normalizeAccountSearchText(`${account.ownerName} ${account.subAccountName} ${accountDetailName(account)} ${account.legacyName || ''}`)
      if (normalizedQuery) return haystack.includes(normalizedQuery)
      return matchesQuickFilter(account)
    })
    .sort((a, b) => rankAccount(a) - rankAccount(b) || accountLabel(a).localeCompare(accountLabel(b), 'ar'))
  const visibleAccounts = selectedAccount && !filteredAccounts.some((account) => account.id === selectedAccount.id) ? [selectedAccount, ...filteredAccounts] : filteredAccounts
  const resultAccounts = visibleAccounts
  const shouldLimitResults = !normalizedQuery && !quickFilter && !showAllResults
  const shownResultAccounts = shouldLimitResults ? resultAccounts.slice(0, 8) : resultAccounts

  function chooseAccount(accountId) {
    onChange(accountId)
    setQuery('')
    setQuickFilter('')
    setIsChanging(false)
    setShowAllResults(false)
  }

  return (
    <div className="ml3-account-picker" aria-label={label}>
      <div className={`ml3-picked-account ${selectedAccount ? `is-selected ml3-picked-account--${visualKind(selectedAccount)}` : ''}`}>
        <div>
          <strong>{selectedAccount ? protectedAccountPrimaryName(selectedAccount) : 'اختر الحساب'}</strong>
          {selectedAccount ? <small>{protectedAccountContext(selectedAccount)}</small> : null}
        </div>
        {selectedAccount ? (
          <div className="ml3-picked-actions">
            <b className={`ml3-balance-chip is-${selectedBalance.tone}`}>{selectedBalance.text}</b>
            <button type="button" onClick={() => setIsChanging(true)}>
              تغيير
            </button>
            {allowEmpty ? (
              <button type="button" onClick={() => chooseAccount(null)}>
                مسح
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {showChooser ? (
        <>
          <label className="ml3-search-box">
            <span className="ml3-search-icon"><Search aria-hidden="true" size={17} /></span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setQuickFilter('')
                setShowAllResults(false)
              }}
              placeholder="اكتب الاسم أو كاش أو مصرف"
            />
          </label>
          {!normalizedQuery && !quickFilter && preferredAccounts.length ? (
            <div className="ml3-picker-lane">
              <div className="ml3-picker-lane-head">
                <strong>الأقرب</strong>
                <span>اختيارات سريعة</span>
              </div>
              <div className="ml3-picker-favorites" aria-label="اختيارات سريعة">
                {preferredAccounts.map((account) => (
                  <button type="button" key={account.id} className={`ml3-picker-favorite--${visualKind(account)} ${account.id === value ? 'is-selected' : ''}`} onClick={() => chooseAccount(account.id)}>
                    <strong>{protectedAccountPrimaryName(account)}</strong>
                    <span>{protectedAccountContext(account)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="ml3-picker-lane is-filter">
            <div className="ml3-picker-lane-head">
              <strong>فلترة</strong>
              <span>{formatCount(resultAccounts.length)} نتيجة</span>
            </div>
            <div className="ml3-picker-chips" aria-label="تصفية سريعة">
              {quickFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.key || 'all'}
                  className={quickFilter === filter.key && !normalizedQuery ? 'is-active' : ''}
                  onClick={() => {
                    setQuickFilter(filter.key)
                    setQuery('')
                    setShowAllResults(false)
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ml3-picker-results">
            {shownResultAccounts.map((account) => {
              const balanceChip = accountBalanceChip(account, balanceByAccountId.get(account.id), balanceCurrency)
              const hasBalance = hasVisibleBalance(account)
              return (
                <button type="button" key={account.id} className={`ml3-picker-option--${visualKind(account)} ${account.ownerName === normalizedPreferredOwner ? 'is-preferred' : ''} ${hasBalance ? 'has-balance' : ''} ${account.id === value ? 'is-selected' : ''}`} onClick={() => chooseAccount(account.id)}>
                  <span className={`ml3-picker-dot ml3-picker-dot--${visualKind(account)}`} aria-hidden="true" />
                  <span className="ml3-picker-option-copy">
                    <strong>{protectedAccountPrimaryName(account)}</strong>
                    <small>{protectedAccountContext(account)}</small>
                  </span>
                  <b className={`ml3-balance-chip is-${balanceChip.tone}`}>{balanceChip.text}</b>
                  {account.id === value ? <em>مختار</em> : null}
                </button>
              )
            })}
            {shouldLimitResults && resultAccounts.length > shownResultAccounts.length ? (
              <button type="button" className="ml3-picker-more" onClick={() => setShowAllResults(true)}>
                عرض الكل · {formatCount(resultAccounts.length)}
              </button>
            ) : null}
            {normalizedQuery && resultAccounts.length === 0 ? <p>لا توجد نتيجة</p> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function preferredAccountIdsFor(accounts, balanceByAccountId, currency = '') {
  return rankMovementAccounts(accounts, balanceByAccountId, '', currency)
    .slice(0, 4)
    .map((account) => account.id)
}

function NumericEntry({ label, value, onChange, name, placeholder = '0', allowDecimal = false, compact = false }) {
  const textValue = String(value || '')
  const keys = allowDecimal ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '000'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '000']

  function pushKey(key) {
    if (!allowDecimal && key === '.') return
    if (key === '.' && textValue.includes('.')) return
    const next = textValue === '0' && key !== '.' ? key : `${textValue}${key}`
    onChange(next)
  }

  if (compact) {
    return (
      <label className="ml3-number-compact">
        <span>{label}</span>
        {name ? <input type="hidden" name={name} value={textValue} /> : null}
        <input
          type="text"
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          value={textValue}
          placeholder={placeholder}
          onChange={(event) => {
            const clean = normalizeLocalizedNumericInput(event.target.value, { allowDecimal })
            onChange(clean)
          }}
        />
      </label>
    )
  }

  return (
    <div className="ml3-number-entry">
      {name ? <input type="hidden" name={name} value={textValue} /> : null}
      <div className="ml3-number-display">
        <span>{label}</span>
        <strong>{textValue ? formatNumericEntryValue(textValue, allowDecimal) : placeholder}</strong>
      </div>
      <div className="ml3-number-pad" aria-label={label}>
        {keys.map((key) => (
          <button type="button" className="ml3-number-key" key={key} onClick={() => pushKey(key)}>
            {key}
          </button>
        ))}
        <button type="button" className="ml3-number-action is-delete" onClick={() => onChange(textValue.slice(0, -1))}>
          حذف
        </button>
        <button type="button" className="ml3-number-action is-clear" onClick={() => onChange('')}>
          مسح
        </button>
      </div>
    </div>
  )
}

function AttachmentFileField({ name = 'attachmentFile' }) {
  const [fileName, setFileName] = useState('')
  return (
    <label className="ml3-file-field">
      ملف
      <span>{fileName ? preserveUiData(fileName) : 'اختر ملفًا'}</span>
      <input name={name} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFileName(event.target.files?.[0]?.name || '')} />
    </label>
  )
}

function AttachmentLink({ attachment, onDelete }) {
  const [status, setStatus] = useState('idle')

  async function openAttachment() {
    const popup = typeof window !== 'undefined' ? window.open('', '_blank') : null
    if (popup) popup.opener = null
    setStatus('opening')
    try {
      const url = await resolveAdreemAttachmentUrl(attachment)
      if (!url) throw new Error('Attachment link is missing.')
      if (popup) popup.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
      setStatus('idle')
    } catch {
      popup?.close()
      setStatus('error')
    }
  }

  return (
    <span className="ml3-attachment-action">
      <button type="button" onClick={openAttachment} disabled={status === 'opening'}>
        {status === 'opening' ? 'فتح...' : preserveUiData(attachment.label)}
      </button>
      {onDelete ? (
        <button type="button" className="is-danger" onClick={() => onDelete(attachment.id)}>
          حذف
        </button>
      ) : null}
      {status === 'error' ? <small>تعذر فتحه</small> : null}
    </span>
  )
}

function MovementMiniRow({ movement, accountById, attachments = [], dimensions = [], onCancel, onDeleteAttachment }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const movementAttachments = attachmentsForRecord(attachments, {
    movementId: movement.id,
  })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)
  const expenseCategory = accountById.get(movement.expenseCategoryId)

  return (
    <article className={`ml3-today-row ml3-today-row--${movementTone(movement.type)} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-today-main">
        <strong>{movementLabels[movement.type] || movement.type}</strong>
        <span>
          {movementTime(movement.createdAt)} · {money(movement.amount, movement.currency)} · {movementStatusLabel(movement.status)}
        </span>
      </div>
      <div className="ml3-today-route">
        {source ? <b>{protectedAccountLabel(source)}</b> : null}
        {destination ? <b>{protectedAccountLabel(destination)}</b> : null}
      </div>
      {effects.length ? (
        <div className="ml3-today-effects">
          {effects.map((effect) => {
            const account = accountById.get(effect.accountId)
            return (
              <span key={`${effect.accountId}-${effect.currency}`}>
                {account ? protectedAccountPrimaryName(account) : preserveUiData(effect.accountId)} {signedMoney(effect.delta, effect.currency)}
              </span>
            )
          })}
        </div>
      ) : null}
      {movement.note ? <small>{preserveUiData(movement.note)}</small> : null}
      {dimension ? <small>ملف: {preserveUiData(dimension.name)}</small> : null}
      {expenseCategory ? <small>نوع المصروف: {protectedAccountPrimaryName(expenseCategory)}</small> : null}
      {movementAttachments.length ? (
        <div className="ml3-attachment-list">
          {movementAttachments.map((item) => (
            <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
          ))}
        </div>
      ) : null}
      {canCancelMovement(movement) ? (
        <button type="button" onClick={() => onCancel(movement.id)}>
          إلغاء
        </button>
      ) : null}
    </article>
  )
}

function HistoryMovementRow({ movement, accountById, attachments = [], dimensions = [], onCancel, onDeleteAttachment }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const statusTone = movement.status === MOVEMENT_STATUSES.POSTED ? 'تم' : movementStatusLabel(movement.status)
  const movementAttachments = attachmentsForRecord(attachments, {
    movementId: movement.id,
  })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)
  const expenseCategory = accountById.get(movement.expenseCategoryId)

  return (
    <article className={`ml3-history-row ml3-history-row--${movementTone(movement.type)} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-history-main">
        <strong>{movementLabels[movement.type] || movement.type}</strong>
        <span>
          {movementDateTime(movement.createdAt || movement.updatedAt)} · {money(movement.amount, movement.currency)} · {statusTone}
        </span>
      </div>
      <div className="ml3-history-route">
        {source ? <b>{protectedAccountLabel(source)}</b> : <b>بدون مصدر</b>}
        {destination ? <b>{protectedAccountLabel(destination)}</b> : null}
      </div>
      {effects.length ? (
        <div className="ml3-history-effects">
          {effects.map((effect) => {
            const account = accountById.get(effect.accountId)
            return (
              <span key={`${movement.id}-${effect.accountId}-${effect.currency}`}>
                {account ? protectedAccountPrimaryName(account) : preserveUiData(effect.accountId)}: {signedMoney(effect.delta, effect.currency)}
              </span>
            )
          })}
        </div>
      ) : movement.validation?.errors?.length ? (
        <div className="ml3-history-effects is-review">
          {movement.validation.errors.slice(0, 2).map((error) => (
            <span key={`${movement.id}-${error.field}`}>{error.message}</span>
          ))}
        </div>
      ) : null}
      {movement.note ? <small>{preserveUiData(movement.note)}</small> : null}
      {dimension ? <small>ملف: {preserveUiData(dimension.name)}</small> : null}
      {expenseCategory ? <small>نوع المصروف: {protectedAccountPrimaryName(expenseCategory)}</small> : null}
      {movementAttachments.length ? (
        <div className="ml3-attachment-list">
          {movementAttachments.map((item) => (
            <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
          ))}
        </div>
      ) : null}
      {canCancelMovement(movement) ? (
        <button type="button" onClick={() => onCancel(movement.id)}>
          إلغاء
        </button>
      ) : null}
    </article>
  )
}

function movementAccountImpact(movement, accountId) {
  return buildPostingEntries(movement).filter((entry) => entry.accountId === accountId)
}

function accountEditorDraft(account) {
  return {
    ...account,
    subAccountName: accountDetailName(account),
    currencyKind: account.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
  }
}

export function AccountClassificationEditorFields({ account, className = '' }) {
  const editorKey = [account.id, account.updatedAt, account.ownerName, account.subAccountName, account.type, account.valueKind, account.currencyKind].join(':')
  return <AccountClassificationEditor key={editorKey} account={account} className={className} />
}

function AccountClassificationEditor({ account, className = '' }) {
  const [draft, setDraft] = useState(() => accountEditorDraft(account))
  const classification = classificationValue(draft)
  const parsedClassification = parseClassification(classification)
  const preset = accountPresetFor(parsedClassification.type, parsedClassification.valueKind)
  const detailOptions = accountDetailOptionsFor(parsedClassification.type, parsedClassification.valueKind)
  const showDetail = !preset.skipDetail && detailOptions.length > 0
  const selectedCurrencyKind = accountClassificationCurrency(account, parsedClassification, draft.currencyKind)
  const showLegacyMultiCurrency = selectedCurrencyKind === ACCOUNT_CURRENCY_KINDS.MULTI
  const currencyFieldValue = showLegacyMultiCurrency ? '' : selectedCurrencyKind

  return (
    <div className={`ml3-profile-editor-grid ${className}`.trim()}>
      <input type="hidden" name="ownerName" value={draft.ownerName || ''} />
      <input type="hidden" name="subAccountName" value={draft.subAccountName || ''} />
      <label>
        هذا الحساب هو
        <select
          name="classification"
          value={classification}
          onChange={(event) => {
            const next = parseClassification(event.target.value)
            setDraft((current) => applyAccountClassification(current, next.type, next.valueKind))
          }}
        >
          {accountClassificationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {preset.nameLabel || 'اسم الحساب'}
        <input value={accountNameValue(draft)} onChange={(event) => setDraft((current) => applyAccountName(current, event.target.value))} placeholder={preset.namePlaceholder || 'اكتب الاسم'} />
      </label>
      {showDetail ? (
        <label>
          {preset.detailLabel || 'نوع التعامل'}
          <select value={draft.subAccountName || detailOptions[0]} onChange={(event) => setDraft((current) => ({ ...current, subAccountName: event.target.value }))}>
            {detailOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      ) : null}
      {accountNeedsCurrency(parsedClassification) ? (
        <label>
          العملة
          <select name="currencyKind" value={currencyFieldValue} onChange={(event) => setDraft((current) => ({ ...current, currencyKind: event.target.value }))}>
            {showLegacyMultiCurrency ? <option value="">اتركها فارغة بدون تغيير</option> : null}
            <option value={ACCOUNT_CURRENCY_KINDS.DINAR}>دينار</option>
            <option value={ACCOUNT_CURRENCY_KINDS.USD}>دولار</option>
          </select>
        </label>
      ) : null}
    </div>
  )
}

function AccountProfile({ bucket, movements, accounts, attachments = [], reconciliations = [], auditEvents = [], isAddingAttachment = false, onClose, onEditMovement, onUpdateAccount, onReconcile, onAddAttachment, onDeleteAttachment }) {
  if (!bucket) return null

  const { account, dinar, usd, postedCount } = bucket
  const accountAttachments = attachmentsForRecord(attachments, {
    accountId: account.id,
  })
  const lastReconciliation = lastReconciliationForAccount(reconciliations, account.id)
  const relatedMovements = movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && movementAccountImpact(movement, account.id).length)
    .slice()
    .reverse()
  const accountMap = new Map(accounts.map((item) => [item.id, item]))
  const canReconcileBalance = account.valueKind === VALUE_KINDS.CASH || account.valueKind === VALUE_KINDS.BANK
  const primaryBalance = accountPrimaryBalance(bucket)
  const profileBalanceTone = primaryBalance.amount > 0 ? 'is-positive' : primaryBalance.amount < 0 ? 'is-negative' : 'is-zero'

  return (
    <div className="ml3-profile-layer" role="dialog" aria-modal="true" aria-label="ملف الحساب" onClick={onClose}>
      <aside className="ml3-profile" onClick={(event) => event.stopPropagation()}>
        <div className="ml3-profile-head">
          <button type="button" onClick={onClose}>
            إغلاق
          </button>
          <div>
            <span>{protectedAccountContext(account)}</span>
            <h2>{protectedAccountPrimaryName(account)}</h2>
            <p>{account.valueKind === VALUE_KINDS.RECEIVABLE ? 'ما لك وما عليك معه' : account.valueKind === VALUE_KINDS.CASH || account.valueKind === VALUE_KINDS.BANK ? 'مكان من أماكن فلوسك' : 'حساب للمتابعة'}</p>
          </div>
        </div>

        <div className={`ml3-profile-balance ${profileBalanceTone}`}>
          <strong>{formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</strong>
          <span>{hasMoneyValue(primaryBalance.secondaryAmount) ? money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency) : primaryBalance.secondaryCurrency === CURRENCIES.USD ? 'لا يوجد دولار' : 'لا يوجد دينار'}</span>
        </div>

        <div className="ml3-profile-facts">
          <div>
            <span>نوع الحساب</span>
            <strong>{accountKindText(account)}</strong>
          </div>
          <div>
            <span>الحركات</span>
            <strong>{formatCount(postedCount)}</strong>
          </div>
          <div>
            <span>الحالة</span>
            <strong>{account.status === ACCOUNT_STATUSES.ACTIVE ? 'فعال' : account.status}</strong>
          </div>
        </div>

        {canReconcileBalance ? (
          <form className="ml3-profile-reconcile ml3-profile-reconcile--balance" onSubmit={(event) => onReconcile(event, account.id, dinar, usd)}>
            <h3>مطابقة</h3>
            {lastReconciliation ? (
              <p className="ml3-profile-note">
                آخر مطابقة: {movementDateTime(lastReconciliation.createdAt)} · {preserveUiData(lastReconciliation.note)}
              </p>
            ) : null}
            <div className="ml3-profile-editor-grid">
              <label>
                الدينار الفعلي
                <input name="actualDinar" inputMode="numeric" defaultValue={formatInteger(dinar)} />
              </label>
              <label>
                الدولار الفعلي
                <input name="actualUsd" inputMode="numeric" defaultValue={formatMoneyNumber(usd)} />
              </label>
              <label>
                ملاحظة
                <input name="note" placeholder="الملاحظة مطلوبة" />
              </label>
            </div>
            <button type="submit">إنشاء تصحيح</button>
          </form>
        ) : null}

        <form className="ml3-profile-reconcile ml3-profile-reconcile--attachment" aria-busy={isAddingAttachment} onSubmit={(event) => onAddAttachment(event, account.id)}>
          <h3>مرفقات</h3>
          <div className="ml3-profile-editor-grid">
            <label>
              اسم المرفق
              <input name="attachmentLabel" placeholder="مثال: صورة إيصال أو عقد" />
            </label>
            <label>
              الرابط
              <input name="attachmentUrl" placeholder="اختياري" />
            </label>
            <AttachmentFileField />
          </div>
          <button type="submit" disabled={isAddingAttachment}>
            {isAddingAttachment ? 'جاري رفع المرفق' : 'ربط مرفق'}
          </button>
          {accountAttachments.length ? (
            <div className="ml3-attachment-list">
              {accountAttachments.slice(0, 5).map((attachment) => (
                <AttachmentLink key={attachment.id} attachment={attachment} onDelete={onDeleteAttachment} />
              ))}
            </div>
          ) : null}
        </form>

        <form className="ml3-profile-editor" onSubmit={(event) => onUpdateAccount(event, account.id)}>
          <h3>بيانات الحساب</h3>
          <AccountClassificationEditorFields account={account} />
          <button type="submit">حفظ التعديل</button>
        </form>

        <AccountEditHistory accountId={account.id} auditEvents={auditEvents} />

        <div className="ml3-profile-movements">
          <h3>الحركات</h3>
          {relatedMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات لهذا الحساب.</p> : null}
          {relatedMovements.map((movement) => {
            const impacts = movementAccountImpact(movement, account.id)
            const source = accountMap.get(movement.sourceAccountId)
            const destination = accountMap.get(movement.destinationAccountId)
            const movementAttachments = attachmentsForRecord(attachments, {
              movementId: movement.id,
            })
            return (
              <article className="ml3-profile-movement" key={movement.id}>
                <div>
                  <strong>{movementLabels[movement.type] || movement.type}</strong>
                  <span>
                    {source ? protectedAccountLabel(source) : 'بدون مصدر'} ← {destination ? protectedAccountLabel(destination) : 'بدون وجهة'}
                  </span>
                  {movement.note ? <small>{preserveUiData(movement.note)}</small> : null}
                  {movementAttachments.length ? (
                    <div className="ml3-attachment-list">
                      {movementAttachments.map((item) => (
                        <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="ml3-profile-impact">
                  {impacts.map((impact) => (
                    <b key={`${movement.id}-${impact.currency}`}>{signedMoney(impact.delta, impact.currency)}</b>
                  ))}
                  {!movement.id?.startsWith('opening-') && canCancelMovement(movement) ? (
                    <button type="button" onClick={() => onEditMovement(movement)}>
                      تعديل
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

export function ReviewAccountCard({ bucket, activeAccounts, onResolve, onMerge, onDisable }) {
  const { account } = bucket
  const mergeTargets = activeAccounts.filter((target) => areMergeAccountsCompatible(account, target))
  const primaryBalance = accountPrimaryBalance(bucket)

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{protectedAccountPrimaryName(account)}</strong>
          <span>{account.notes ? preserveUiData(account.notes) : 'يحتاج تحديد طريقة التعامل معه.'}</span>
        </div>
        <b>{formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</b>
      </div>
      {hasMoneyValue(primaryBalance.secondaryAmount) ? <p className="ml3-review-usd">{money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency)}</p> : null}
      <form className="ml3-decision-grid" onSubmit={(event) => onResolve(event, account.id)}>
        <AccountClassificationEditorFields account={account} className="ml3-decision-wide" />
        <label className="ml3-decision-wide">
          ملاحظة
          <input name="notes" defaultValue={account.notes || ''} placeholder="اختياري" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            اعتماد الحساب
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>
            إخفاء كغير مستخدم
          </button>
        </div>
      </form>
      <div className="ml3-merge-box">
        <label>
          دمج بدل إنشاء حساب مستقل
          <select defaultValue="" onChange={(event) => event.target.value && onMerge(account.id, event.target.value)}>
            <option value="">اختر حسابًا موجودًا للدمج</option>
            {mergeTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {protectedAccountLabel(target)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  )
}

export function ExternalAccountCard({ account, onCreate, onIgnore }) {
  const draftAccount = {
    ...account,
    type: account.type || ACCOUNT_TYPES.PERSON,
    valueKind: account.valueKind || VALUE_KINDS.RECEIVABLE,
    currencyKind: account.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
  }

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{protectedAccountPrimaryName(draftAccount)}</strong>
          <span>{preserveUiData(account.notes)}</span>
        </div>
        <b>اسم جديد</b>
      </div>
      <form className="ml3-decision-grid" onSubmit={(event) => onCreate(event, account)}>
        <AccountClassificationEditorFields account={draftAccount} className="ml3-decision-wide" />
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            إنشاء الحساب
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onIgnore(account)}>
            تجاهل الاسم
          </button>
        </div>
      </form>
    </article>
  )
}

function ReviewMovementCard({ movement, activeAccounts, balanceByAccountId, onResolve, onEdit, onCancel }) {
  const errors = movement.validation?.errors || []
  const [reviewDraft, setReviewDraft] = useState({
    type: movement.type || MOVEMENT_TYPES.TRANSFER,
    amount: movement.amount ? String(movement.amount) : '',
    currency: movement.currency || CURRENCIES.DINAR,
    sourceAccountId: movement.sourceAccountId || '',
    destinationAccountId: movement.destinationAccountId || '',
    rate: movement.rate ? String(movement.rate) : '',
    note: movement.note || '',
  })
  const reviewConfig = movementConfigFor(reviewDraft.type)
  const reviewNeedsSource = movementNeedsSource(reviewDraft.type)
  const reviewSourceAccounts = getMovementAccounts(activeAccounts, balanceByAccountId, reviewDraft.type, 'source', reviewDraft)
  const reviewDestinationAccounts = getMovementAccounts(activeAccounts, balanceByAccountId, reviewDraft.type, 'destination', reviewDraft)
  const reviewSourceCurrency = movementAccountCurrencyForRole(reviewDraft.type, 'source', reviewDraft.currency)
  const reviewDestinationCurrency = movementAccountCurrencyForRole(reviewDraft.type, 'destination', reviewDraft.currency)

  function updateReviewDraft(field, value) {
    setReviewDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'type') {
        const config = movementConfigFor(value)
        next.currency = config.currency || next.currency
        next.destinationAccountId = config.needsDestination ? next.destinationAccountId : ''
        next.rate = config.needsRate ? next.rate : ''
      }
      return next
    })
  }

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{movementLabels[movement.type] || 'حركة غير محددة'}</strong>
          <span>{errors.length ? errors.map((error) => error.message).join(' ') : 'تحتاج مراجعة قبل الاعتماد.'}</span>
        </div>
        <b>{movement.amount ? money(movement.amount, movement.currency) : 'لا مبلغ'}</b>
      </div>
      <div className="ml3-issue-chips">
        {errors.map((error) => (
          <span key={`${movement.id}-${error.field}-${error.message}`}>{movementErrorFieldLabel(error.field)}</span>
        ))}
      </div>
      <form className="ml3-decision-grid ml3-decision-grid--movement" onSubmit={(event) => onResolve(event, movement, reviewDraft)}>
        <label>
          نوع الحركة
          <select value={reviewDraft.type} onChange={(event) => updateReviewDraft('type', event.target.value)}>
            {Object.entries(movementLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <NumericEntry compact label={reviewConfig.amountLabel || 'المبلغ'} value={reviewDraft.amount} onChange={(value) => updateReviewDraft('amount', value)} />
        </div>
        {reviewConfig.currencyLocked ? (
          <div className="ml3-currency-lock">
            <span>العملة</span>
            <strong>{reviewConfig.currencyText}</strong>
          </div>
        ) : (
          <label>
            العملة
            <select value={reviewDraft.currency} onChange={(event) => updateReviewDraft('currency', event.target.value)}>
              <option value={CURRENCIES.DINAR}>دينار</option>
              <option value={CURRENCIES.USD}>دولار</option>
            </select>
          </label>
        )}
        {reviewConfig.needsRate ? (
          <div>
            <NumericEntry label={reviewConfig.rateLabel || 'سعر الصرف'} value={reviewDraft.rate} onChange={(value) => updateReviewDraft('rate', value)} placeholder="7.5" allowDecimal compact />
          </div>
        ) : null}
        {reviewNeedsSource ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect label={reviewConfig.sourceLabel || 'من'} value={reviewDraft.sourceAccountId || ''} accounts={reviewSourceAccounts} onChange={(value) => updateReviewDraft('sourceAccountId', value || '')} preferredAccountIds={preferredAccountIdsFor(reviewSourceAccounts, balanceByAccountId, reviewSourceCurrency)} balanceByAccountId={balanceByAccountId} balanceCurrency={reviewSourceCurrency} />
          </div>
        ) : null}
        {reviewConfig.needsDestination ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect label={reviewConfig.destinationLabel || 'إلى'} value={reviewDraft.destinationAccountId || ''} accounts={reviewDestinationAccounts} onChange={(value) => updateReviewDraft('destinationAccountId', value || '')} preferredAccountIds={preferredAccountIdsFor(reviewDestinationAccounts, balanceByAccountId, reviewDestinationCurrency)} balanceByAccountId={balanceByAccountId} balanceCurrency={reviewDestinationCurrency} />
          </div>
        ) : null}
        <label className="ml3-decision-wide">
          ملاحظة
          <input value={reviewDraft.note} onChange={(event) => updateReviewDraft('note', event.target.value)} placeholder="سبب الحركة أو التصحيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            إصلاح واعتماد
          </button>
          <button type="button" className="ml3-mini-action" onClick={() => onEdit(movement)}>
            فتح في الإدخال
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onCancel(movement.id)}>
            إلغاء
          </button>
        </div>
      </form>
    </article>
  )
}

function AlertBoard({ reviewAccounts, reviewMovements, externalMissing, balances, movements, totals, dueRecurringCount = 0, reconciliationDiffCount = 0 }) {
  const alerts = buildLedgerAlerts({
    reviewAccounts,
    reviewMovements,
    externalMissing,
    balances,
    movements,
    totals,
    dueRecurringCount,
    reconciliationDiffCount,
  })
  if (!alerts.length) return null

  return (
    <section className="ml3-alert-board">
      <div className="ml3-alert-title">
        <strong>تنبيه</strong>
        <span>{formatCount(alerts.length)}</span>
      </div>
      <div className="ml3-alert-list">
        {alerts.map((alert) => (
          <article className={`ml3-alert ml3-alert--${alert.tone}`} key={alert.title}>
            <strong>{alert.title}</strong>
            <span>{alert.format === 'money' ? money(alert.value) : formatCount(alert.value)}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function OperationsPanel({ reports, expenseReports, dueRules, recurringRules, attachments, reconciliations, onRunRecurring, onDisableRecurring, onUpdateRecurring }) {
  const activeRecurringRules = recurringRules.filter((rule) => rule.status === 'active')
  const dueRuleIds = new Set(dueRules.map((rule) => rule.id))
  return (
    <section className="ml3-ops-grid">
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>مشاريع وأصول</strong>
          <span>{formatCount(reports.length)}</span>
        </div>
        {reports.length === 0 ? <p className="ml3-empty">لا توجد مراكز متابعة بعد.</p> : null}
        {reports.map((item) => (
          <div className="ml3-ops-row" key={item.dimension.id}>
            <span>{preserveUiData(item.dimension.name)}</span>
            <b className={(item.net || item.netUsd) >= 0 ? 'is-positive' : 'is-negative'}>{signedMoney(item.net)}</b>
            <small>
              دخل {money(item.income)} · مصروف {money(item.expense)}
            </small>
            {item.incomeUsd || item.expenseUsd ? (
              <small>
                دولار: دخل {money(item.incomeUsd, CURRENCIES.USD)} · مصروف {money(item.expenseUsd, CURRENCIES.USD)}
              </small>
            ) : null}
          </div>
        ))}
      </article>
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>المصروفات</strong>
          <span>{formatCount(expenseReports.length)}</span>
        </div>
        {expenseReports.length === 0 ? <p className="ml3-empty">لا توجد مصروفات مصنفة.</p> : null}
        {expenseReports.map((item) => (
          <div className="ml3-ops-row" key={item.categoryId || 'uncategorized'}>
            <span>{preserveUiData(item.name)}</span>
            <b>{money(item.dinar)}</b>
            {item.usd ? <small>{money(item.usd, CURRENCIES.USD)}</small> : null}
          </div>
        ))}
      </article>
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>متكرر</strong>
          <span>{formatCount(dueRules.length)}</span>
        </div>
        {activeRecurringRules.length === 0 ? <p className="ml3-empty">لا توجد حركة شهرية.</p> : null}
        {activeRecurringRules.slice(0, 5).map((rule) => (
          <div className="ml3-ops-row" key={rule.id}>
            <span>{preserveUiData(rule.name)}</span>
            <label className="ml3-recurring-day">
              يوم
              <input type="number" min="1" max="31" value={rule.dayOfMonth || 1} onChange={(event) => onUpdateRecurring(rule.id, event.target.value)} />
            </label>
            <div className="ml3-ops-actions">
              <button type="button" disabled={!dueRuleIds.has(rule.id)} onClick={() => onRunRecurring(rule.id)}>
                تنفيذ
              </button>
              <button type="button" onClick={() => onDisableRecurring(rule.id)}>
                إيقاف
              </button>
            </div>
            <small>{dueRuleIds.has(rule.id) ? 'مستحقة الآن' : 'ليست مستحقة'} · مرة واحدة في الشهر</small>
          </div>
        ))}
      </article>
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>حفظ وأدلة</strong>
          <span>{formatCount(attachments.length)}</span>
        </div>
        <p className="ml3-empty">المرفقات محفوظة في مساحة خاصة وآمنة.</p>
        <small>مطابقات محفوظة: {formatCount(reconciliations.length)}</small>
      </article>
    </section>
  )
}

export default function MohammadLedgerApp() {
  const [initialState] = useState(loadInitialLedgerState)
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [movements, setMovements] = useState(initialState.movements)
  const [ledgerExtras, setLedgerExtras] = useState(() => ledgerExtrasFromState(initialState))
  const [activeSection, setActiveSection] = useState('entry')
  const [activeEntryMode, setActiveEntryMode] = useState('movement')
  const [activeAccountGroup, setActiveAccountGroup] = useState('people')
  const [activeAccountPresetGroup, setActiveAccountPresetGroup] = useState('')
  const [movementDraft, setMovementDraft] = useState(() => emptyMovementDraft())
  const [movementAttachmentFile, setMovementAttachmentFile] = useState(null)
  const [movementStep, setMovementStep] = useState(MOVEMENT_ENTRY_STEPS.TYPE)
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isHydrated, setIsHydrated] = useState(false)
  const [canPersist, setCanPersist] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [storageMode, setStorageMode] = useState(getMohammadPersistenceMode)
  const [canManageUsers, setCanManageUsers] = useState(false)
  const [userProfile, setUserProfile] = useState(null)
  const [uiLanguage, setUiLanguage] = useState(readRememberedUiLanguage)
  const [languageStatus, setLanguageStatus] = useState('idle')
  const [languageMessage, setLanguageMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('loading')
  const [, setSyncProblem] = useState(false)
  const [pendingUndo, setPendingUndo] = useState(null)
  const [activeReviewKey, setActiveReviewKey] = useState('')
  const [editingMovementId, setEditingMovementId] = useState('')
  const [isSavingMovement, setIsSavingMovement] = useState(false)
  const [isAddingAccountAttachment, setIsAddingAccountAttachment] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyType, setHistoryType] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [historyAccountId, setHistoryAccountId] = useState('')
  const [historyDimensionId, setHistoryDimensionId] = useState('')
  const [historyExpenseCategoryId, setHistoryExpenseCategoryId] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [peopleAccountView, setPeopleAccountView] = useState('balances')
  const [accountWizardStep, setAccountWizardStep] = useState(ACCOUNT_WIZARD_STEPS.GROUP)
  const [activeAccountPresetKey, setActiveAccountPresetKey] = useState('')
  const [activeAccountDetail, setActiveAccountDetail] = useState('')
  const saveCoordinatorRef = useRef(null)
  const hasHydratedSnapshotRef = useRef(false)
  const movementSaveLockRef = useRef(false)
  const accountAttachmentLockRef = useRef(false)
  const accountCreationLockRef = useRef('')
  const reconciliationLockRef = useRef('')
  const motionTimerRef = useRef(null)
  const normalizedUiLanguage = normalizeUiLanguage(uiLanguage)
  const uiDirection = uiLanguageDirection(normalizedUiLanguage)
  setActiveUiLanguage(normalizedUiLanguage)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const favicon = document.querySelector("link[rel='icon']")
    const previousIcon = favicon?.getAttribute('href')
    document.title = 'ADREEM'
    favicon?.setAttribute('href', `${import.meta.env.BASE_URL}adreem.svg`)
    return () => {
      document.title = previousTitle
      if (previousIcon) favicon?.setAttribute('href', previousIcon)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = normalizedUiLanguage
    document.documentElement.dir = uiDirection
  }, [normalizedUiLanguage, uiDirection])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const viewport = document.querySelector('.adreem-view')
    viewport?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [activeSection])

  const activeAccounts = useMemo(() => getActivePostingAccounts(accounts), [accounts])
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const activeDimensions = useMemo(() => dimensionsFromAccounts(accounts, ledgerExtras.dimensions), [accounts, ledgerExtras.dimensions])
  const dimensionById = useMemo(() => new Map(activeDimensions.map((dimension) => [dimension.id, dimension])), [activeDimensions])
  const activeExpenseCategories = useMemo(() => accounts.filter((account) => account.status === ACCOUNT_STATUSES.ACTIVE && account.valueKind === VALUE_KINDS.EXPENSE), [accounts])
  const balances = useMemo(() => summarizeBalances(accounts, movements), [accounts, movements])
  const balanceByAccountId = useMemo(() => new Map(balances.map((bucket) => [bucket.account.id, bucket])), [balances])
  const selectedAccountPreset = accountPresetFor(accountDraft.type, accountDraft.valueKind)
  const selectedAccountPresetGroup = accountPresetGroups.find((group) => group.key === activeAccountPresetGroup) || accountPresetGroups[0]
  const selectedAccountPresetCopy = accountPresetStepCopy[selectedAccountPresetGroup.key] || accountPresetStepCopy.people
  const selectedAccountDetails = accountDetailOptionsFor(accountDraft.type, accountDraft.valueKind)
  const accountDraftNameValue = accountNameValue(accountDraft)
  const hasAccountDraftName = Boolean(accountDraftNameValue.trim())
  const accountNeedsDetailChoice = !selectedAccountPreset.skipDetail && selectedAccountDetails.length > 0
  const accountNeedsCurrencyChoice = accountNeedsCurrency(accountDraft)
  const accountNeedsPresetChoice = selectedAccountPresetGroup.keys.length > 1
  const accountWizardStages = [
    {
      key: ACCOUNT_WIZARD_STEPS.GROUP,
      title: 'الفئة',
      summary: activeAccountPresetGroup ? selectedAccountPresetGroup.title : 'اختر',
    },
    ...(accountNeedsPresetChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.PRESET,
            title: selectedAccountPresetCopy.title,
            summary: activeAccountPresetKey ? selectedAccountPreset.title : 'اختر',
          },
        ]
      : []),
    {
      key: ACCOUNT_WIZARD_STEPS.NAME,
      title: selectedAccountPreset.nameLabel || 'الاسم',
      summary: accountDraftNameValue || 'اكتب الاسم',
    },
    ...(accountNeedsDetailChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.DETAIL,
            title: selectedAccountPreset.detailLabel || 'نوع التعامل',
            summary: activeAccountDetail || 'اختر',
          },
        ]
      : []),
    ...(accountNeedsCurrencyChoice
      ? [
          {
            key: ACCOUNT_WIZARD_STEPS.CURRENCY,
            title: 'العملة',
            summary: accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 'دولار' : 'دينار',
          },
        ]
      : []),
    {
      key: ACCOUNT_WIZARD_STEPS.SAVE,
      title: 'تأكيد الحساب',
      summary: hasAccountDraftName ? 'جاهز للحفظ' : 'ناقص الاسم',
    },
  ]
  const accountWizardStageKeys = accountWizardStages.map((step) => step.key)
  const currentAccountWizardStep = accountWizardStageKeys.includes(accountWizardStep) ? accountWizardStep : ACCOUNT_WIZARD_STEPS.GROUP
  const currentAccountWizardIndex = Math.max(0, accountWizardStageKeys.indexOf(currentAccountWizardStep))
  const accountWizardPreviousStep = accountWizardStages[Math.max(0, currentAccountWizardIndex - 1)]?.key || ACCOUNT_WIZARD_STEPS.GROUP
  const accountWizardNextStep = accountWizardStages[Math.min(accountWizardStages.length - 1, currentAccountWizardIndex + 1)]?.key || ACCOUNT_WIZARD_STEPS.SAVE
  const canAdvanceAccountWizard = currentAccountWizardStep !== ACCOUNT_WIZARD_STEPS.NAME || hasAccountDraftName
  const balancesByKind = useMemo(() => {
    const groups = {
      people: [],
      money: [],
      assets: [],
      expenses: [],
      review: [],
    }
    for (const bucket of balances) {
      const kind = bucket.account.valueKind
      if (bucket.account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || kind === VALUE_KINDS.REVIEW) groups.review.push(bucket)
      else if (kind === VALUE_KINDS.RECEIVABLE) groups.people.push(bucket)
      else if (kind === VALUE_KINDS.CASH || kind === VALUE_KINDS.BANK) groups.money.push(bucket)
      else if (kind === VALUE_KINDS.ASSET || kind === VALUE_KINDS.PROJECT) groups.assets.push(bucket)
      else if (kind === VALUE_KINDS.EXPENSE) groups.expenses.push(bucket)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(compareBalanceBuckets)
    }
    return groups
  }, [balances])

  const reviewMovements = movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const unresolvedExternalAccounts = knownExternalAccounts.filter((externalAccount) => {
    const ignored = ledgerExtras.ignoredExternalAccounts || []
    if (ignored.includes(externalAccountKey(externalAccount))) return false
    return !accounts.some((account) => account.ownerName === externalAccount.ownerName && account.subAccountName === externalAccount.subAccountName && account.status !== ACCOUNT_STATUSES.INACTIVE)
  })
  const reviewItems = useMemo(() => {
    const accountItems = (balancesByKind.review || []).map((bucket) => ({
      key: `account:${bucket.account.id}`,
      type: 'account',
      label: accountPrimaryName(bucket.account),
      detail: protectedAccountContext(bucket.account),
      tone: 'danger',
      bucket,
    }))
    const externalItems = unresolvedExternalAccounts.map((account) => ({
      key: `external:${account.id}`,
      type: 'external',
      label: accountPrimaryName(account),
      detail: protectedAccountContext(account),
      tone: 'info',
      account,
    }))
    const movementItems = reviewMovements.map((movement) => ({
      key: `movement:${movement.id}`,
      type: 'movement',
      label: movementLabels[movement.type] || 'حركة',
      detail: movement.amount ? money(movement.amount, movement.currency) : 'بلا مبلغ',
      tone: 'warning',
      movement,
    }))
    return [...accountItems, ...movementItems, ...externalItems]
  }, [balancesByKind.review, reviewMovements, unresolvedExternalAccounts])
  const activeReviewItem = reviewItems.find((item) => item.key === activeReviewKey) || reviewItems[0] || null
  const postedUserMovements = movements
    .filter((movement) => !movement.id?.startsWith('opening-'))
    .slice()
    .reverse()
  const filteredHistoryMovements = useMemo(() => filterMovementHistory({
    movements: postedUserMovements,
    query: historyQuery,
    type: historyType,
    status: historyStatus,
    accountId: historyAccountId,
    dimensionId: historyDimensionId,
    expenseCategoryId: historyExpenseCategoryId,
    accountById,
    dimensionById,
  }), [accountById, dimensionById, historyAccountId, historyDimensionId, historyExpenseCategoryId, historyQuery, historyStatus, historyType, postedUserMovements])
  const historyGroups = useMemo(() => {
    const groupsByKey = new Map()
    for (const movement of filteredHistoryMovements) {
      const value = movement.createdAt || movement.updatedAt
      const key = movementDayKey(value)
      const current = groupsByKey.get(key)
      if (current) current.movements.push(movement)
      else
        groupsByKey.set(key, {
          key,
          label: movementDayLabel(value),
          movements: [movement],
        })
    }
    return Array.from(groupsByKey.values())
  }, [filteredHistoryMovements])
  const todayMovements = postedUserMovements.filter((movement) => isToday(movement.createdAt || movement.updatedAt))
  const todayPreviewMovements = todayMovements.slice(0, 3)
  const totals = useMemo(() => {
    return balances.reduce(
      (acc, bucket) => {
        const kind = bucket.account.valueKind
        if (kind === VALUE_KINDS.CASH) acc.cash += bucket.dinar
        if (kind === VALUE_KINDS.BANK) acc.bank += bucket.dinar
        if (kind === VALUE_KINDS.RECEIVABLE && bucket.dinar > 0) acc.peopleOweMe += bucket.dinar
        if (kind === VALUE_KINDS.RECEIVABLE && bucket.dinar < 0) acc.iOwePeople += Math.abs(bucket.dinar)
        if (kind === VALUE_KINDS.ASSET) acc.assets += bucket.dinar
        if (kind === VALUE_KINDS.EXPENSE) acc.expenses += bucket.dinar
        acc.usd += bucket.usd
        return acc
      },
      {
        cash: 0,
        bank: 0,
        peopleOweMe: 0,
        iOwePeople: 0,
        assets: 0,
        expenses: 0,
        usd: 0,
      },
    )
  }, [balances])

  const movementConfig = movementConfigFor(movementDraft.type)
  const movementSourceRequired = movementNeedsSource(movementDraft.type)
  const movementUsesDimension = movementSupportsDimension(movementDraft.type)
  const normalizedDraft = {
    ...movementDraft,
    amount: parseMoneyAmount(movementDraft.amount, movementConfig.currency || movementDraft.currency),
    currency: movementConfig.currency || movementDraft.currency,
    sourceAccountId: movementSourceRequired ? movementDraft.sourceAccountId : null,
    destinationAccountId: movementConfig.needsDestination ? movementDraft.destinationAccountId : null,
    rate: movementDraft.rate === '' ? undefined : parseLocalizedDecimal(movementDraft.rate),
    dimensionId: movementUsesDimension ? movementDraft.dimensionId || '' : '',
    expenseCategoryId: movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? movementDraft.expenseCategoryId || '' : '',
  }
  const preview = previewMovement(normalizedDraft, accounts, movementHistoryForPreview(movements, editingMovementId))
  const hasMovementAmount = Number.isFinite(normalizedDraft.amount) && normalizedDraft.amount > 0
  const hasMovementRate = !movementConfig.needsRate || (Number.isFinite(normalizedDraft.rate) && normalizedDraft.rate > 0)
  const hasChosenMovementType = Boolean(editingMovementId || movementDraft.amount || movementDraft.sourceAccountId || movementDraft.destinationAccountId || movementDraft.note)
  const canChooseMovementAccounts = hasMovementAmount && hasMovementRate
  const selectedSourceAccount = accountById.get(movementDraft.sourceAccountId)
  const selectedDestinationAccount = accountById.get(movementDraft.destinationAccountId)
  const dimensionReports = useMemo(() => buildDimensionReports({ ...ledgerExtras, accounts, movements }), [accounts, movements, ledgerExtras])
  const expenseCategoryReports = useMemo(() => buildExpenseCategoryReports({ ...ledgerExtras, accounts, movements }), [accounts, movements, ledgerExtras])
  const dueRules = useMemo(() => dueRecurringRules(ledgerExtras.recurringRules), [ledgerExtras.recurringRules])
  const reconciliationDiffCount = useMemo(() => findUnresolvedReconciliationDifferences(ledgerExtras.reconciliations, movements).length, [ledgerExtras.reconciliations, movements])
  const hasMovementAccounts = (!movementSourceRequired || Boolean(movementDraft.sourceAccountId)) && (!movementConfig.needsDestination || Boolean(movementDraft.destinationAccountId)) && (!movementConfig.needsDestination || !selectedSourceAccount || !sameLogicalAccount(selectedSourceAccount, selectedDestinationAccount))
  const canReviewMovement = canChooseMovementAccounts && hasMovementAccounts && movementStep >= MOVEMENT_ENTRY_STEPS.REVIEW
  const selectedBucket = balances.find((bucket) => bucket.account.id === selectedAccountId) || null
  const draftSourceAccount = selectedSourceAccount
  const draftDestinationAccount = selectedDestinationAccount

  useEffect(() => {
    let cancelled = false

    async function hydrateLedger() {
      const result = await loadMohammadPersistedState(initialState)
      if (cancelled) return
      const normalizedState = normalizeLedgerState(result.state, initialState)
      setStorageMode(result.mode)
      setCanManageUsers(Boolean(result.access?.canManageUsers))
      setUserProfile(result.profile || null)
      if (result.profile?.language) {
        const nextLanguage = rememberUiLanguage(result.profile.language)
        setUiLanguage(nextLanguage)
      }
      setLedgerExtras(ledgerExtrasFromState(normalizedState))
      setAccounts(normalizeMohammadAccounts(normalizedState.accounts))
      setMovements(normalizedState.movements)
      setSaveStatus(result.loadError ? 'local-only' : 'saved')
      setLoadFailed(Boolean(result.loadError))
      setSyncProblem(Boolean(result.loadError))
      setCanPersist(!result.loadError && result.mode !== 'api-missing-token')
      setIsHydrated(true)
      if (result.loadError) {
        setFeedback(result.mode === 'api-missing-token' ? 'رابط الدفتر ناقص. افتح الرابط الخاص أو صفحة الإدارة.' : 'السحابة غير جاهزة الآن. لم يتم استخدام أي نسخة محلية.')
      }
    }

    hydrateLedger()
    return () => {
      cancelled = true
    }
  }, [initialState])

  async function changeUiLanguage(language) {
    const nextLanguage = normalizeUiLanguage(language)
    if (nextLanguage === normalizedUiLanguage || languageStatus === 'saving') return
    setLanguageStatus('saving')
    setLanguageMessage('')
    try {
      const profile = await updateAdreemUserProfile({ language: nextLanguage })
      if (!profile?.language) throw new Error('profile-language-not-confirmed')
      const confirmedLanguage = rememberUiLanguage(profile.language)
      setUserProfile(profile)
      setUiLanguage(confirmedLanguage)
      setLanguageStatus('saved')
    } catch {
      setLanguageStatus('error')
      setLanguageMessage('تعذر حفظ اللغة. حاول مرة أخرى.')
    }
  }

  useEffect(() => {
    if (!isHydrated || !canPersist) return
    if (!saveCoordinatorRef.current) {
      let coordinator = null
      coordinator = createLatestSaveCoordinator({
        async save(snapshot) {
          const result = await saveMohammadPersistedState(snapshot)
          const cloudMode = result.mode === 'supabase' || result.mode === 'api' || result.mode === 'api-missing-token'
          if (cloudMode && !result.supabaseOk) {
            const error = result.error || new Error('Cloud save was not confirmed.')
            error.persistenceResult = result
            throw error
          }
          return result
        },
        onStatus(status) {
          setSaveStatus(status)
        },
        onSaved(result, item) {
          setStorageMode(result.mode)
          setSyncProblem(false)
          setFeedback((current) => (current.startsWith('لم يتم تأكيد الحفظ') ? 'تم الحفظ في السحابة.' : current))
          if (!result.state || coordinator?.hasPending()) return
          const normalizedState = normalizeLedgerState(result.state, item.value)
          const nextExtras = ledgerExtrasFromState(normalizedState)
          const mergedAccounts = normalizeMohammadAccounts(normalizedState.accounts)
          const mergedMovements = normalizedState.movements || []
          setLedgerExtras((current) => (sameLedgerExtras(current, nextExtras) ? current : nextExtras))
          setAccounts((current) => (sameRecordVersions(current, mergedAccounts) ? current : mergedAccounts))
          setMovements((current) => (sameRecordVersions(current, mergedMovements) ? current : mergedMovements))
        },
        onError(error, _item, retryDelay) {
          console.warn('[adreem-ledger] cloud save failed:', error?.message || error)
          setStorageMode(error?.persistenceResult?.mode || getMohammadPersistenceMode())
          setSyncProblem(true)
          setFeedback(saveFailureMessage(error, retryDelay))
        },
      })
      saveCoordinatorRef.current = coordinator
    }

    if (!hasHydratedSnapshotRef.current) {
      hasHydratedSnapshotRef.current = true
      return
    }
    saveCoordinatorRef.current.submit({ ...ledgerExtras, accounts, movements })
  }, [accounts, movements, ledgerExtras, isHydrated, canPersist])

  useEffect(() => {
    function warnBeforeClose(event) {
      if (!saveCoordinatorRef.current?.hasPending()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [])

  useEffect(
    () => () => {
      saveCoordinatorRef.current?.stop()
      saveCoordinatorRef.current = null
      if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!pendingUndo) return undefined
    const timer = window.setTimeout(() => setPendingUndo(null), 18000)
    return () => window.clearTimeout(timer)
  }, [pendingUndo])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    if (selectedAccountId) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (activeSection !== 'review') return undefined
    const nextKey = reviewItems.length && reviewItems.some((item) => item.key === activeReviewKey) ? activeReviewKey : reviewItems[0]?.key || ''
    if (nextKey === activeReviewKey) return undefined
    const timer = window.setTimeout(() => setActiveReviewKey(nextKey), 0)
    return () => window.clearTimeout(timer)
  }, [activeSection, activeReviewKey, reviewItems])

  function commitFlowChange(update, direction = 'forward', scope = 'flow') {
    if (typeof document === 'undefined') {
      update()
      return
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      update()
      return
    }
    const root = document.documentElement
    const motionClasses = [
      'adreem-flow-forward',
      'adreem-flow-back',
      'adreem-mode-forward',
      'adreem-mode-back',
      'adreem-section-forward',
      'adreem-section-back',
      'adreem-motion-fallback',
    ]
    const directionClass = `adreem-${scope}-${direction === 'back' ? 'back' : 'forward'}`
    const clearMotion = () => {
      root.classList.remove(...motionClasses)
      motionTimerRef.current = null
    }

    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current)
    root.classList.remove(...motionClasses)
    root.classList.add(directionClass)

    if (typeof document.startViewTransition !== 'function') {
      root.classList.add('adreem-motion-fallback')
      flushSync(update)
      motionTimerRef.current = window.setTimeout(clearMotion, 240)
      return
    }
    try {
      const transition = document.startViewTransition(() => {
        flushSync(update)
      })
      transition.finished.finally(clearMotion)
    } catch {
      clearMotion()
      update()
    }
  }

  function updateMovementDraft(field, value) {
    setMovementDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'currency') {
        next.sourceAccountId = ''
        next.destinationAccountId = ''
      }
      return next
    })
  }

  function chooseMovementType(type) {
    const config = movementConfigFor(type)
    commitFlowChange(() => {
      setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
      setMovementDraft((current) => ({
        ...current,
        type,
        currency: config.currency || current.currency,
        sourceAccountId: '',
        destinationAccountId: '',
        rate: config.needsRate ? current.rate : '',
        dimensionId: movementSupportsDimension(type) ? current.dimensionId : '',
        expenseCategoryId: type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE ? current.expenseCategoryId : '',
      }))
    }, 'forward')
  }

  function nextMovementStep(step = movementStep) {
    const firstAccountStep = movementSourceRequired ? MOVEMENT_ENTRY_STEPS.SOURCE : movementConfig.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : MOVEMENT_ENTRY_STEPS.NOTE
    if (step === MOVEMENT_ENTRY_STEPS.TYPE) return MOVEMENT_ENTRY_STEPS.AMOUNT
    if (step === MOVEMENT_ENTRY_STEPS.AMOUNT) return movementConfig.currencyLocked ? (movementConfig.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : firstAccountStep) : MOVEMENT_ENTRY_STEPS.CURRENCY
    if (step === MOVEMENT_ENTRY_STEPS.CURRENCY) return movementConfig.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : firstAccountStep
    if (step === MOVEMENT_ENTRY_STEPS.RATE) return firstAccountStep
    if (step === MOVEMENT_ENTRY_STEPS.SOURCE) return movementConfig.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : MOVEMENT_ENTRY_STEPS.NOTE
    if (step === MOVEMENT_ENTRY_STEPS.DESTINATION) return MOVEMENT_ENTRY_STEPS.NOTE
    if (step === MOVEMENT_ENTRY_STEPS.NOTE) return MOVEMENT_ENTRY_STEPS.REVIEW
    return MOVEMENT_ENTRY_STEPS.REVIEW
  }

  function advanceMovementStep() {
    commitFlowChange(() => {
      setMovementStep((current) => nextMovementStep(current))
    }, 'forward')
  }

  function previousMovementStep(step = movementStep) {
    const index = visibleMovementSteps.indexOf(step)
    if (index > 0) return visibleMovementSteps[index - 1]
    return MOVEMENT_ENTRY_STEPS.TYPE
  }

  function retreatMovementStep() {
    commitFlowChange(() => {
      setMovementStep((current) => previousMovementStep(current))
    }, 'back')
  }

  function goToAccountWizardStep(step) {
    const targetStep = [ACCOUNT_WIZARD_STEPS.DETAIL, ACCOUNT_WIZARD_STEPS.CURRENCY, ACCOUNT_WIZARD_STEPS.SAVE].includes(step) && !hasAccountDraftName ? ACCOUNT_WIZARD_STEPS.NAME : step
    const currentIndex = accountWizardStageKeys.indexOf(currentAccountWizardStep)
    const targetIndex = accountWizardStageKeys.indexOf(targetStep)
    commitFlowChange(
      () => {
        setAccountWizardStep(targetStep)
      },
      targetIndex >= 0 && targetIndex < currentIndex ? 'back' : 'forward',
    )
  }

  function advanceAccountWizard() {
    if (!canAdvanceAccountWizard) return
    goToAccountWizardStep(accountWizardNextStep)
  }

  function retreatAccountWizard() {
    goToAccountWizardStep(accountWizardPreviousStep)
  }

  function switchEntryMode(mode) {
    if (mode === activeEntryMode) return
    commitFlowChange(
      () => {
        setActiveEntryMode(mode)
      },
      mode === 'account' ? 'forward' : 'back',
      'mode',
    )
  }

  function resetSectionScroll(behavior = 'auto') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    window.requestAnimationFrame(() => {
      document.querySelector('.adreem-view')?.scrollTo({ top: 0, left: 0, behavior })
    })
  }

  function switchSection(section) {
    if (section === activeSection) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      resetSectionScroll(reducedMotion ? 'auto' : 'smooth')
      return
    }
    commitFlowChange(
      () => {
        setActiveSection(section)
      },
      section === 'entry' ? 'back' : 'forward',
      'section',
    )
  }

  function editMovementStep(step) {
    const targetIndex = visibleMovementSteps.indexOf(step)
    const direction = targetIndex >= 0 && targetIndex < currentMovementStepIndex ? 'back' : 'forward'
    commitFlowChange(() => {
      setMovementStep(step)
    }, direction)
  }

  function movementAccountsFor(role) {
    return getMovementAccounts(accounts, balanceByAccountId, movementDraft.type, role, movementDraft)
  }

  function preferredMovementAccountIds(role) {
    const currency = movementAccountCurrencyForRole(movementDraft.type, role, movementDraft.currency)
    return preferredAccountIdsFor(movementAccountsFor(role), balanceByAccountId, currency)
  }

  const visibleMovementSteps = movementVisibleSteps(movementConfig, movementSourceRequired)
  const currentMovementStepIndex = Math.max(0, visibleMovementSteps.indexOf(movementStep))
  const movementProgressText = `${formatCount(currentMovementStepIndex + 1)}/${formatCount(visibleMovementSteps.length)}`
  const currentMovementStepCopy = movementStepCopy(movementStep, movementConfig)

  function chooseAccountPreset(preset, nextStep = ACCOUNT_WIZARD_STEPS.NAME) {
    const presetGroup = accountPresetGroups.find((group) => group.keys.includes(preset.key))
    commitFlowChange(
      () => {
        if (presetGroup) setActiveAccountPresetGroup(presetGroup.key)
        setActiveAccountPresetKey(preset.key)
        setActiveAccountDetail('')
        if (nextStep) setAccountWizardStep(nextStep)
        setAccountDraft((current) => ({
          ...current,
          ownerName: preset.ownerName || '',
          type: preset.type,
          valueKind: preset.valueKind,
          subAccountName: preset.nameTarget === 'subAccountName' ? '' : preset.subAccountName,
          currencyKind: accountNeedsCurrency(preset) ? current.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR : ACCOUNT_CURRENCY_KINDS.DINAR,
        }))
      },
      nextStep === ACCOUNT_WIZARD_STEPS.PRESET ? 'back' : 'forward',
    )
  }

  function chooseAccountPresetGroup(groupKey) {
    const group = accountPresetGroups.find((item) => item.key === groupKey)
    if (!group) return
    const firstPreset = accountPresets.find((preset) => preset.key === group.keys[0])
    if (!firstPreset) return
    const nextStep = group.keys.length > 1 ? ACCOUNT_WIZARD_STEPS.PRESET : ACCOUNT_WIZARD_STEPS.NAME
    commitFlowChange(() => {
      setActiveAccountPresetGroup(group.key)
      setActiveAccountPresetKey(group.keys.length === 1 ? firstPreset.key : '')
      setActiveAccountDetail('')
      setAccountWizardStep(nextStep)
      const currentPresetIsVisible = group.keys.includes(selectedAccountPreset.key)
      if (currentPresetIsVisible) return
      setAccountDraft((current) => ({
        ...current,
        ownerName: firstPreset.ownerName || '',
        type: firstPreset.type,
        valueKind: firstPreset.valueKind,
        subAccountName: firstPreset.nameTarget === 'subAccountName' ? '' : firstPreset.subAccountName,
        currencyKind: accountNeedsCurrency(firstPreset) ? current.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR : ACCOUNT_CURRENCY_KINDS.DINAR,
      }))
    }, 'forward')
  }

  async function saveMovement(event) {
    event.preventDefault()
    if (movementSaveLockRef.current) return
    movementSaveLockRef.current = true
    setIsSavingMovement(true)
    try {
      const originalMovement = editingMovementId ? movements.find((movement) => movement.id === editingMovementId) : null
      const validationMovements = originalMovement ? movements.filter((movementItem) => movementItem.id !== originalMovement.id) : movements
      const movement = postMovement(
        {
          ...originalMovement,
          ...normalizedDraft,
          id: originalMovement?.id,
          createdAt: originalMovement?.createdAt,
          note: movementDraft.note.trim(),
          dimensionId: movementSupportsDimension(movementDraft.type) ? movementDraft.dimensionId || '' : '',
          expenseCategoryId: movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? movementDraft.expenseCategoryId || '' : '',
        },
        accounts,
        validationMovements,
      )
      if (!canCommitMovementEdit(originalMovement, movement)) {
        setFeedback(`لم يتم حفظ التعديل. أصلح الحركة أولًا حتى لا يتغير الرصيد: ${movement.validation.errors.map((error) => error.message).join(' ')}`)
        return
      }
      let uploadedAttachment = null
      let attachmentError = ''
      if (movementAttachmentFile) {
        try {
          uploadedAttachment = await uploadAdreemAttachmentFile(movementAttachmentFile)
        } catch (error) {
          attachmentError = error?.message || 'تعذر رفع المرفق.'
        }
      }
      setMovements((current) => (originalMovement ? current.map((item) => (item.id === originalMovement.id ? movement : item)) : [...current, movement]))
      const baseFeedback = movement.status === MOVEMENT_STATUSES.POSTED ? (originalMovement ? 'تم تعديل الحركة وتحديث الأرصدة.' : 'تم الحفظ وتحديث الأرصدة.') : 'الحركة ناقصة وتحتاج مراجعة.'
      setFeedback(attachmentError ? `${baseFeedback} لم يتم رفع المرفق: ${attachmentError}` : baseFeedback)
      const attachment = createAttachment({
        movementId: movement.id,
        label: movementDraft.attachmentLabel || uploadedAttachment?.label,
        url: uploadedAttachment?.storagePath ? '' : uploadedAttachment?.url || movementDraft.attachmentUrl,
        mimeType: uploadedAttachment?.mimeType || '',
        sizeBytes: uploadedAttachment?.sizeBytes || 0,
        storagePath: uploadedAttachment?.storagePath || '',
        source: uploadedAttachment ? 'web-upload' : 'web',
      })
      const recurringRule =
        movementDraft.recurringEnabled && movement.status === MOVEMENT_STATUSES.POSTED
          ? createRecurringRuleFromMovement(movement, {
              frequency: movementDraft.recurringFrequency,
            })
          : null
      setLedgerExtras((current) => {
        const syncedRecurringRules = originalMovement ? syncRecurringRulesFromSourceMovement(current.recurringRules, movement) : current.recurringRules
        return {
          ...current,
          attachments: attachment ? [...(current.attachments || []), attachment] : current.attachments,
          recurringRules: recurringRule ? [...(syncedRecurringRules || []), recurringRule] : syncedRecurringRules,
          auditEvents: [
            ...(current.auditEvents || []),
            createAuditEvent(originalMovement ? 'movement.updated' : 'movement.created', {
              movementId: movement.id,
              status: movement.status,
            }),
          ],
        }
      })
      setPendingUndo({
        movementId: movement.id,
        label: `${movementLabels[movement.type] || 'حركة'} · ${money(movement.amount, movement.currency)}`,
      })
      if (movement.status === MOVEMENT_STATUSES.POSTED || originalMovement) {
        setEditingMovementId('')
        setMovementDraft(emptyMovementDraft(movementDraft.type))
        setMovementAttachmentFile(null)
        setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
      }
    } finally {
      movementSaveLockRef.current = false
      setIsSavingMovement(false)
    }
  }

  function cancelMovement(movementId) {
    const target = movements.find((movement) => movement.id === movementId)
    if (!target || target.status === MOVEMENT_STATUSES.VOIDED) return
    if (target?.status === MOVEMENT_STATUSES.POSTED && !canCancelMovement(target)) {
      setFeedback(`الإلغاء المباشر متاح فقط خلال آخر ${formatCount(CANCEL_WINDOW_HOURS)} ساعة. للحركات القديمة استخدم حركة تصحيح.`)
      return
    }
    if (typeof window !== 'undefined' && !window.confirm(cancelMovementConfirmation(target))) return
    const now = new Date().toISOString()
    const voidedMovement = target.status === MOVEMENT_STATUSES.NEEDS_REVIEW
      ? {
          ...target,
          status: MOVEMENT_STATUSES.VOIDED,
          voidReason: 'إلغاء حركة ناقصة',
          voidedAt: now,
          updatedAt: now,
        }
      : voidMovement(target, 'إلغاء من سجل الحركات', now).movement
    if (!voidedMovement) return
    setMovements((current) => current.map((movement) => (movement.id === movementId ? voidedMovement : movement)))
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: syncRecurringRulesFromSourceMovement(current.recurringRules, voidedMovement, now),
    }))
    setPendingUndo((current) => (current?.movementId === movementId ? null : current))
    setFeedback('تم إلغاء الحركة وبقيت في السجل.')
  }

  function undoPendingMovement() {
    if (!pendingUndo?.movementId) return
    cancelMovement(pendingUndo.movementId)
  }

  function addAccount(event) {
    event.preventDefault()
    if (!accountDraftNameValue.trim()) {
      setAccountWizardStep(ACCOUNT_WIZARD_STEPS.NAME)
      setFeedback('اكتب اسمًا واضحًا للحساب قبل الحفظ.')
      return
    }
    const submissionKey = JSON.stringify(['account', accountDraft])
    if (!claimSubmission(accountCreationLockRef, submissionKey)) return
    const account = createAccount(accountDraft)
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [...(current.auditEvents || []), createAuditEvent('account.created', { accountId: account.id })],
    }))
    setFeedback('تم إنشاء الحساب.')
    setAccountDraft(emptyAccountDraft())
    setActiveAccountPresetGroup('')
    setActiveAccountPresetKey('')
    setActiveAccountDetail('')
    setAccountWizardStep(ACCOUNT_WIZARD_STEPS.GROUP)
  }

  function resolveReviewAccount(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const selection = accountReviewSelection(formData.get('classification'), formData.get('currencyKind'))
    const reviewedAt = new Date().toISOString()
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      ...selection,
      notes: String(formData.get('notes') || '').trim(),
    }

    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            status: ACCOUNT_STATUSES.ACTIVE,
            reviewedAt,
            updatedAt: reviewedAt,
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(
      candidate,
      accounts.filter((account) => account.id !== accountId),
    )
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    const movementErrors = accountClassificationMovementErrors(accountId, candidateAccounts, movements)
    if (movementErrors.length) {
      setFeedback(`نوع الحساب لا يناسب الحركات السابقة: ${movementErrors.map((error) => error.message).join(' ')}`)
      return
    }
    setAccounts(candidateAccounts)
    setFeedback('تم حل الحساب واعتماده.')
  }

  function updateAccountClassification(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const currentAccount = accounts.find((account) => account.id === accountId)
    const result = prepareAccountClassificationUpdate({
      accounts,
      movements,
      accountId,
      ownerName: formData.get('ownerName'),
      subAccountName: formData.get('subAccountName'),
      classificationValue: formData.get('classification'),
      currencyKind: formData.get('currencyKind'),
    })
    if (!result.ok) {
      const message = result.errors.map((error) => error.message).join(' ')
      setFeedback(result.reason === 'movement-history' ? `نوع الحساب لا يناسب الحركات السابقة: ${message}` : message)
      return
    }
    const changes = accountEditChanges(currentAccount, result.account)
    if (!changes.length) {
      setFeedback('لا يوجد تغيير.')
      return
    }
    setAccounts(result.accounts)
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('account.updated', {
          accountId,
          before: accountEditSnapshot(currentAccount),
          after: accountEditSnapshot(result.account),
          source: 'web',
        }),
      ],
    }))
    setAccountQuery('')
    setFeedback('تم تعديل الحساب.')
  }

  function reconcileAccount(event, accountId, currentDinar, currentUsd) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const actualDinar = parseWholeAmount(formData.get('actualDinar'))
    const actualUsd = parseMoneyAmount(formData.get('actualUsd'), CURRENCIES.USD)
    const note = String(formData.get('note') || '').trim()
    if (!note) {
      setFeedback('المطابقة تحتاج ملاحظة واضحة.')
      return
    }
    const submissionKey = JSON.stringify([accountId, currentDinar, currentUsd, actualDinar, actualUsd, note])
    if (!claimSubmission(reconciliationLockRef, submissionKey)) return
    const record = createReconciliation({
      accountId,
      actualDinar,
      actualUsd,
      expectedDinar: currentDinar,
      expectedUsd: currentUsd,
      note,
    })
    const nextMovements = []
    let validationMovements = movements
    for (const draft of buildReconciliationCorrectionDrafts(record)) {
      const movement = postMovement(draft, accounts, validationMovements)
      nextMovements.push(movement)
      validationMovements = [...validationMovements, movement]
    }
    if (nextMovements.length) {
      setMovements((current) => [...current, ...nextMovements])
    }
    setLedgerExtras((current) => ({
      ...current,
      reconciliations: [...(current.reconciliations || []), record],
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('account.reconciled', {
          accountId,
          reconciliationId: record.id,
        }),
      ],
    }))
    if (!nextMovements.length) {
      setFeedback('تم حفظ المطابقة بدون تصحيح.')
      return
    }
    setFeedback(nextMovements.every((movement) => movement.status === MOVEMENT_STATUSES.POSTED) ? 'تم إنشاء تصحيح الرصيد.' : 'تم حفظ التصحيح في المراجعة.')
  }

  async function addAccountAttachment(event, accountId) {
    event.preventDefault()
    if (accountAttachmentLockRef.current) return
    accountAttachmentLockRef.current = true
    setIsAddingAccountAttachment(true)
    const form = event.currentTarget
    try {
      const formData = new FormData(form)
      let uploadedAttachment = null
      const file = formData.get('attachmentFile')
      if (file && typeof file === 'object' && file.size > 0) {
        try {
          uploadedAttachment = await uploadAdreemAttachmentFile(file)
        } catch (error) {
          setFeedback(`لم يتم رفع المرفق: ${error?.message || 'خطأ غير معروف.'}`)
          return
        }
      }
      const attachment = createAttachment({
        accountId,
        label: formData.get('attachmentLabel') || uploadedAttachment?.label,
        url: uploadedAttachment?.storagePath ? '' : uploadedAttachment?.url || formData.get('attachmentUrl'),
        mimeType: uploadedAttachment?.mimeType || '',
        sizeBytes: uploadedAttachment?.sizeBytes || 0,
        storagePath: uploadedAttachment?.storagePath || '',
        source: uploadedAttachment ? 'web-upload' : 'web',
      })
      if (!attachment) {
        setFeedback('اكتب اسم المرفق أو رابطه.')
        return
      }
      setLedgerExtras((current) => ({
        ...current,
        attachments: [...(current.attachments || []), attachment],
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('attachment.created', {
            accountId,
            attachmentId: attachment.id,
          }),
        ],
      }))
      form.reset()
      setFeedback('تم ربط المرفق بالحساب.')
    } finally {
      accountAttachmentLockRef.current = false
      setIsAddingAccountAttachment(false)
    }
  }

  function deleteAttachment(attachmentId) {
    const attachment = (ledgerExtras.attachments || []).find((item) => item.id === attachmentId)
    if (!attachment) return
    if (typeof window !== 'undefined' && !window.confirm(translateUiText('حذف هذا المرفق؟'))) return
    const hiddenAt = new Date().toISOString()
    setLedgerExtras((current) => ({
      ...current,
      attachments: (current.attachments || []).map((item) => (item.id === attachmentId ? hideAttachment(item, hiddenAt) : item)),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('attachment.hidden', {
          attachmentId,
          storagePath: attachment.storagePath || '',
        }),
      ],
    }))
    setFeedback('تم حذف المرفق من العرض وحفظ أثره بأمان.')
  }

  function runRecurring(ruleId) {
    const result = executeRecurringRuleInState({ ...ledgerExtras, accounts, movements }, ruleId)
    if (result.state !== undefined) {
      setMovements(result.state.movements || movements)
      setLedgerExtras(ledgerExtrasFromState(result.state))
    }
    setFeedback(result.message)
  }

  function disableRecurring(ruleId) {
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) => (item.id === ruleId ? disableRecurringRule(item) : item)),
      auditEvents: [...(current.auditEvents || []), createAuditEvent('recurring.disabled', { ruleId })],
    }))
    setFeedback('تم إيقاف الحركة المتكررة.')
  }

  function changeRecurringDay(ruleId, value) {
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) => (item.id === ruleId ? updateRecurringRule(item, { dayOfMonth: value }) : item)),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('recurring.updated', {
          ruleId,
          dayOfMonth: Number(value),
        }),
      ],
    }))
  }

  function disableAccount(accountId) {
    const bucket = balanceByAccountId.get(accountId)
    if (bucket && nonZero(bucket)) {
      setFeedback('لا يمكن إخفاء حساب عليه رصيد. صفّر الرصيد أو ادمجه أولًا.')
      return
    }
    const disabledAt = new Date().toISOString()
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? {
              ...account,
              status: ACCOUNT_STATUSES.INACTIVE,
              disabledAt,
              updatedAt: disabledAt,
            }
          : account,
      ),
    )
    setFeedback('تم إخفاء الحساب.')
  }

  function mergeReviewAccount(sourceAccountId, targetAccountId) {
    if (!targetAccountId || sourceAccountId === targetAccountId) return false
    const sourceAccount = accounts.find((account) => account.id === sourceAccountId)
    const targetAccount = accounts.find((account) => account.id === targetAccountId)
    if (!sourceAccount || !targetAccount) return false
    const mergedAt = new Date().toISOString()
    const candidate = mergeLedgerAccountState({
      accounts,
      movements,
      attachments: ledgerExtras.attachments || [],
      dimensions: ledgerExtras.dimensions || [],
      recurringRules: ledgerExtras.recurringRules || [],
      reconciliations: ledgerExtras.reconciliations || [],
    }, sourceAccountId, targetAccountId, mergedAt)
    const invalidMovement = candidate.movements.find((movement, index) => {
      if (movement === movements[index]) return false
      if (movement.status !== MOVEMENT_STATUSES.POSTED) return false
      return !validateMovement(
        movement,
        candidate.accounts,
        candidate.movements.filter((item) => item.id !== movement.id),
      ).ok
    })
    const referenceErrors = mergeAccountReferenceErrors({ candidate, sourceAccount, targetAccount })
    if (invalidMovement || referenceErrors.length) {
      setFeedback('لم يتم الدمج. الحساب المختار لا يناسب عملة أو نوع بعض الحركات المرتبطة.')
      return false
    }
    if (typeof window !== 'undefined' && !window.confirm(mergeAccountsConfirmation(sourceAccount, targetAccount))) return false
    setMovements(candidate.movements)
    setAccounts(candidate.accounts)
    setLedgerExtras((current) => {
      const mergedExtras = mergeLedgerAccountState({
        attachments: current.attachments || [],
        dimensions: current.dimensions || [],
        recurringRules: current.recurringRules || [],
        reconciliations: current.reconciliations || [],
      }, sourceAccountId, targetAccountId, mergedAt)
      return {
        ...current,
        attachments: mergedExtras.attachments,
        dimensions: mergedExtras.dimensions,
        recurringRules: mergedExtras.recurringRules,
        reconciliations: mergedExtras.reconciliations,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('account.merged', {
            sourceAccountId,
            targetAccountId,
          }),
        ],
      }
    })
    setFeedback('تم دمج الحساب.')
    return true
  }

  function addExternalAccount(event, externalAccount) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const selection = accountReviewSelection(formData.get('classification'), formData.get('currencyKind'))
    const submissionKey = JSON.stringify(['external-account', externalAccountKey(externalAccount), selection, formData.get('ownerName'), formData.get('subAccountName')])
    if (!claimSubmission(accountCreationLockRef, submissionKey)) return
    const account = createAccount({
      ownerName: String(formData.get('ownerName') || externalAccount.ownerName).trim(),
      subAccountName: String(formData.get('subAccountName') || externalAccount.subAccountName).trim(),
      ...selection,
      notes: externalAccount.notes,
    })
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), externalAccountKey(externalAccount)])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.created', {
          accountId: account.id,
          externalAccountId: externalAccount.id,
        }),
      ],
    }))
    setFeedback(`تم إنشاء حساب ${preserveUiData(externalAccount.ownerName)}.`)
  }

  function ignoreExternalAccount(externalAccount) {
    const key = externalAccountKey(externalAccount)
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), key])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.ignored', {
          externalAccountId: key,
        }),
      ],
    }))
    setFeedback('تم إخفاء الاسم من المراجعة.')
  }

  function editReviewMovement(movement) {
    if (movement.status === MOVEMENT_STATUSES.POSTED && !canCancelMovement(movement)) {
      setFeedback(`تعديل الحركات القديمة غير مباشر. استخدم حركة تصحيح بدل تعديل حركة أقدم من ${formatCount(CANCEL_WINDOW_HOURS)} ساعة.`)
      return
    }
    setEditingMovementId(movement.id)
    setSelectedAccountId('')
    switchSection('entry')
    setActiveEntryMode('movement')
    setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    setMovementDraft({
      type: movement.type || MOVEMENT_TYPES.TRANSFER,
      amount: movement.amount ? String(movement.amount) : '',
      currency: movement.currency || CURRENCIES.DINAR,
      sourceAccountId: movement.sourceAccountId || '',
      destinationAccountId: movement.destinationAccountId || '',
      rate: movement.rate ? String(movement.rate) : '',
      note: movement.note || '',
      dimensionId: movementSupportsDimension(movement.type) ? movement.dimensionId || '' : '',
      expenseCategoryId: movement.expenseCategoryId || '',
      attachmentLabel: '',
      attachmentUrl: '',
      recurringEnabled: false,
      recurringFrequency: RECURRING_FREQUENCIES.MONTHLY,
    })
    setFeedback('الحركة مفتوحة للتعديل. لن تتغير الأرصدة إلا بعد الحفظ.')
  }

  function resolveReviewMovement(event, movement, reviewDraft) {
    event.preventDefault()
    const config = movementConfigFor(reviewDraft.type)
    const candidate = postMovement(
      {
        ...movement,
        type: reviewDraft.type,
        amount: parseMoneyAmount(reviewDraft.amount, config.currency || reviewDraft.currency),
        currency: config.currency || reviewDraft.currency,
        sourceAccountId: movementNeedsSource(reviewDraft.type) ? reviewDraft.sourceAccountId || null : null,
        destinationAccountId: config.needsDestination ? reviewDraft.destinationAccountId || null : null,
        rate: reviewDraft.rate === '' ? undefined : parseLocalizedDecimal(reviewDraft.rate),
        note: String(reviewDraft.note || '').trim(),
        dimensionId: movementSupportsDimension(reviewDraft.type) ? movement.dimensionId || '' : '',
        expenseCategoryId: reviewDraft.expenseCategoryId || movement.expenseCategoryId || '',
      },
      accounts,
      movements.filter((item) => item.id !== movement.id),
    )
    setMovements((current) => current.map((item) => (item.id === movement.id ? candidate : item)))
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: syncRecurringRulesFromSourceMovement(syncRecurringRulesFromMovement(current.recurringRules, candidate), candidate),
    }))
    setFeedback(candidate.status === MOVEMENT_STATUSES.POSTED ? 'تم إصلاح الحركة.' : 'ما زالت ناقصة.')
  }

  function renderAccountsSection() {
    const activeGroup = accountGroupTabs.find((group) => group.key === activeAccountGroup) || accountGroupTabs[0]
    const moneyRows = balancesByKind.money || []
    const peopleRows = balancesByKind.people || []
    const normalizedAccountQuery = normalizeAccountSearchText(accountQuery)
    const accountMatchesQuery = (bucket) => {
      if (!normalizedAccountQuery) return true
      const haystack = normalizeAccountSearchText(`${bucket.account.ownerName} ${bucket.account.subAccountName} ${accountDetailName(bucket.account)} ${bucket.account.legacyName || ''}`)
      return haystack.includes(normalizedAccountQuery)
    }
    const filterRows = (rows) => rows.filter(accountMatchesQuery)
    const peopleViews = buildPeopleAccountViews(filterRows(peopleRows))
    const peoplePositive = peopleViews.positive
    const peopleNegative = peopleViews.negative
    const peopleDirectory = peopleViews.all
    const accountRowsByGroup = {
      people: peopleViews.withBalance,
      money: filterRows(moneyRows),
      assets: filterRows(balancesByKind.assets || []),
      expenses: filterRows(balancesByKind.expenses || []),
      review: filterRows(balancesByKind.review || []),
    }
    const rows = accountRowsByGroup[activeGroup.key] || []
    const activeGroupCount = activeGroup.key === 'people' && peopleAccountView === 'all' ? peopleDirectory.length : accountRowsByGroup[activeGroup.key]?.length || 0
    return (
      <section className="ml3-panel ml3-balances-surface" key={`accounts-${activeAccountGroup}`}>
        <div className="ml3-panel-head">
          <div>
            <h2>الأرصدة</h2>
            <p>
              {activeGroup.key === 'people' && peopleAccountView === 'all' ? 'كل الأشخاص' : activeGroup.title} · {formatCount(activeGroupCount)} عنصر
            </p>
          </div>
          <span>{money(totals.cash + totals.bank)}</span>
        </div>

        <div className="ml3-balance-ledger" aria-label="ملخص الأرصدة">
          <button type="button" className="is-money" onClick={() => setActiveAccountGroup('money')}>
            <span>فلوسي</span>
            <strong>{money(totals.cash + totals.bank)}</strong>
          </button>
          <button type="button" className="is-positive" onClick={() => {
            setActiveAccountGroup('people')
            setPeopleAccountView('balances')
          }}>
            <span>أقبض</span>
            <strong>{money(totals.peopleOweMe)}</strong>
          </button>
          <button type="button" className="is-negative" onClick={() => {
            setActiveAccountGroup('people')
            setPeopleAccountView('balances')
          }}>
            <span>أدفع</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
        </div>

        <div className="ml3-account-toolbar">
          <label>
            <span>
              <Search aria-hidden="true" size={14} /> بحث
            </span>
            <input
              aria-label="بحث في الأرصدة"
              value={accountQuery}
              onChange={(event) => {
                const value = event.target.value
                setAccountQuery(value)
                if (activeGroup.key === 'people' && value.trim()) setPeopleAccountView('all')
              }}
              placeholder="اسم، كاش، شيك..."
            />
          </label>
        </div>

        <div className="ml3-account-switcher" aria-label="أنواع الأرصدة">
          {accountGroupTabs.map((group) => (
            <button type="button" key={group.key} className={`ml3-account-switcher--${group.key} ${activeAccountGroup === group.key ? 'is-active' : ''}`} aria-current={activeAccountGroup === group.key ? 'true' : undefined} onClick={() => setActiveAccountGroup(group.key)}>
              <strong>{group.label}</strong>
              <span>{formatCount(accountRowsByGroup[group.key]?.length || 0)}</span>
            </button>
          ))}
        </div>
        {activeGroup.key === 'people' ? (
          <>
            <div className="ml3-people-view-switch" aria-label="عرض حسابات الناس">
              <button type="button" className={peopleAccountView === 'balances' ? 'is-active' : ''} aria-current={peopleAccountView === 'balances' ? 'true' : undefined} onClick={() => setPeopleAccountView('balances')}>
                <strong>بيننا رصيد</strong>
                <span>{formatCount(peopleViews.withBalance.length)}</span>
              </button>
              <button type="button" className={peopleAccountView === 'all' ? 'is-active' : ''} aria-current={peopleAccountView === 'all' ? 'true' : undefined} onClick={() => setPeopleAccountView('all')}>
                <strong>كل الأشخاص</strong>
                <span>{formatCount(peopleViews.all.length)}</span>
              </button>
            </div>
            {peopleAccountView === 'balances' ? (
              <div className="ml3-account-sections">
                <AccountList title="أقبض منهم" rows={peoplePositive} onOpen={setSelectedAccountId} embedded />
                <AccountList title="أدفع لهم" rows={peopleNegative} onOpen={setSelectedAccountId} embedded />
              </div>
            ) : (
              <AccountList title="دليل الأشخاص" subtitle="كل الحسابات المحفوظة" rows={peopleDirectory} onOpen={setSelectedAccountId} embedded />
            )}
          </>
        ) : activeGroup.key === 'money' ? (
          <AccountList title="فلوسي عندي" rows={rows} onOpen={setSelectedAccountId} embedded />
        ) : (
          <AccountList title={activeGroup.title} rows={rows} onOpen={setSelectedAccountId} embedded />
        )}
      </section>
    )
  }

  function renderSection() {
    if (activeSection === 'entry') {
      return null
    }
    if (activeSection === 'accounts') return renderAccountsSection()
    if (activeSection === 'review') {
      return (
        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>مراجعة</h2>
              <p>راجع أو ألغ</p>
            </div>
            <span>{formatCount(reviewItems.length)}</span>
          </div>
          <div className="ml3-review-workspace">
            <div className="ml3-review-queue" aria-label="قائمة المراجعة">
              {reviewItems.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
              {reviewItems.map((item, index) => (
                <button type="button" key={item.key} className={`ml3-review-ticket ml3-review-ticket--${item.tone} ${activeReviewItem?.key === item.key ? 'is-active' : ''}`} onClick={() => setActiveReviewKey(item.key)}>
                  <span>{formatCount(index + 1)}</span>
                  <strong>{item.type === 'movement' ? item.label : preserveUiData(item.label)}</strong>
                  <b>{item.detail}</b>
                </button>
              ))}
            </div>
            <div className="ml3-review-active">
              {activeReviewItem?.type === 'account' ? <ReviewAccountCard key={activeReviewItem.bucket.account.id} bucket={activeReviewItem.bucket} activeAccounts={activeAccounts} onResolve={resolveReviewAccount} onMerge={mergeReviewAccount} onDisable={disableAccount} /> : null}
              {activeReviewItem?.type === 'external' ? <ExternalAccountCard key={activeReviewItem.account.id} account={activeReviewItem.account} onCreate={addExternalAccount} onIgnore={ignoreExternalAccount} /> : null}
              {activeReviewItem?.type === 'movement' ? <ReviewMovementCard key={activeReviewItem.movement.id} movement={activeReviewItem.movement} activeAccounts={activeAccounts} balanceByAccountId={balanceByAccountId} onResolve={resolveReviewMovement} onEdit={editReviewMovement} onCancel={cancelMovement} /> : null}
            </div>
          </div>
          <details className="ml3-ops-disclosure">
            <summary>
              <Wrench aria-hidden="true" size={16} /> أدوات الدفتر
            </summary>
            <OperationsPanel reports={dimensionReports} expenseReports={expenseCategoryReports} dueRules={dueRules} recurringRules={ledgerExtras.recurringRules || []} attachments={ledgerExtras.attachments || []} reconciliations={ledgerExtras.reconciliations || []} onRunRecurring={runRecurring} onDisableRecurring={disableRecurring} onUpdateRecurring={changeRecurringDay} />
          </details>
        </section>
      )
    }
    if (activeSection === 'history') {
      return (
        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>السجل</h2>
              <p>كل الحركات والبحث</p>
            </div>
            <span>{formatCount(filteredHistoryMovements.length)}</span>
          </div>
          <details className="ml3-filter-disclosure">
            <summary>
              <span>
                <SlidersHorizontal aria-hidden="true" size={15} /> بحث وتصفية
              </span>
              {historyQuery || historyType || historyStatus || historyAccountId || historyDimensionId || historyExpenseCategoryId ? <b>مفعلة</b> : null}
            </summary>
            <div className="ml3-history-filters" aria-label="فلترة الحركات">
              <input aria-label="بحث في السجل" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="اسم أو ملاحظة" />
              <select aria-label="نوع الحركة" value={historyType} onChange={(event) => setHistoryType(event.target.value)}>
                <option value="">كل الأنواع</option>
                {movementTypeOptions.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
                <option value={MOVEMENT_TYPES.CORRECTION}>تعديل رصيد</option>
              </select>
              <select aria-label="حالة الحركة" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
                <option value="">كل الحالات</option>
                <option value={MOVEMENT_STATUSES.POSTED}>تم</option>
                <option value={MOVEMENT_STATUSES.NEEDS_REVIEW}>ناقص</option>
                <option value={MOVEMENT_STATUSES.VOIDED}>ملغي</option>
              </select>
              <select aria-label="حساب السجل" value={historyAccountId} onChange={(event) => setHistoryAccountId(event.target.value)}>
                <option value="">كل الحسابات</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {protectedAccountLabel(account)}
                  </option>
                ))}
              </select>
              <select aria-label="المشروع أو الأصل" value={historyDimensionId} onChange={(event) => setHistoryDimensionId(event.target.value)}>
                <option value="">كل المشاريع والأصول</option>
                {activeDimensions.map((dimension) => (
                  <option key={dimension.id} value={dimension.id}>
                    {preserveUiData(dimension.name)}
                  </option>
                ))}
              </select>
              <select aria-label="نوع المصروف" value={historyExpenseCategoryId} onChange={(event) => setHistoryExpenseCategoryId(event.target.value)}>
                <option value="">كل أنواع المصروف</option>
                {activeExpenseCategories.map((account) => (
                  <option key={account.id} value={account.id}>
                    {protectedAccountPrimaryName(account)}
                  </option>
                ))}
              </select>
            </div>
          </details>
          <div className="ml3-history-list">
            {filteredHistoryMovements.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
            {historyGroups.map((group) => (
              <section className="ml3-history-day" key={group.key}>
                <div className="ml3-history-day-head">
                  <strong>{group.label}</strong>
                  <span>{formatCount(group.movements.length)}</span>
                </div>
                {group.movements.map((movement) => (
                  <HistoryMovementRow key={movement.id} movement={movement} accountById={accountById} attachments={ledgerExtras.attachments || []} dimensions={activeDimensions} onCancel={cancelMovement} onDeleteAttachment={deleteAttachment} />
                ))}
              </section>
            ))}
          </div>
        </section>
      )
    }
    return (
      <section className="ml3-home">
        <div className="ml3-home-focus">
          <div>
            <span>الأهم الآن</span>
            <h2>{reviewMovements.length || balancesByKind.review.length ? 'يوجد شيء يحتاج مراجعة' : 'الدفتر مرتب الآن'}</h2>
            <p>{reviewMovements.length || balancesByKind.review.length ? 'ابدأ من قسم المراجعة قبل إدخال حركات جديدة كثيرة.' : 'افتح قسم الإدخال للحركة الجديدة، واترك الأرصدة للعرض والمراجعة فقط.'}</p>
          </div>
          <button type="button" onClick={() => switchSection(reviewMovements.length || balancesByKind.review.length ? 'review' : 'entry')}>
            {reviewMovements.length || balancesByKind.review.length ? 'فتح المراجعة' : 'إضافة حركة'}
          </button>
        </div>

        <div className="ml3-home-grid">
          <button
            type="button"
            className="ml3-home-card is-positive"
            onClick={() => {
              switchSection('accounts')
              setActiveAccountGroup('people')
              setPeopleAccountView('balances')
            }}
          >
            <span>أقبض من الناس</span>
            <strong>{money(totals.peopleOweMe)}</strong>
          </button>
          <button
            type="button"
            className="ml3-home-card is-negative"
            onClick={() => {
              switchSection('accounts')
              setActiveAccountGroup('people')
              setPeopleAccountView('balances')
            }}
          >
            <span>أدفع لهم</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
          <button
            type="button"
            className="ml3-home-card is-money"
            onClick={() => {
              switchSection('accounts')
              setActiveAccountGroup('money')
            }}
          >
            <span>أماكن الفلوس</span>
            <strong>{formatCount(balancesByKind.money.length)} حساب</strong>
          </button>
          <button type="button" className="ml3-home-card is-review" onClick={() => switchSection('review')}>
            <span>مراجعة</span>
            <strong>{formatCount(balancesByKind.review.length + reviewMovements.length + unresolvedExternalAccounts.length)}</strong>
          </button>
        </div>

        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>أكبر أرصدة الناس</h2>
              <p>للتفاصيل الكاملة افتح قسم الأرصدة.</p>
            </div>
            <span>{formatCount(balancesByKind.people.filter(nonZero).length)}</span>
          </div>
          <div className="ml3-list">
            {balancesByKind.people
              .filter(nonZero)
              .slice(0, 6)
              .map((bucket) => (
                <AccountRow key={bucket.account.id} bucket={bucket} onOpen={setSelectedAccountId} />
              ))}
          </div>
        </section>
      </section>
    )
  }

  const storageText = storageTextForStatus(saveStatus, storageMode)
  const canLogout = storageMode === 'api'
  const canOpenAdmin = storageMode === 'api' && canManageUsers
  const activeSectionTitle = sectionTitles[activeSection] || 'ADREEM'
  const movementReceipt = [
    {
      key: 'type',
      step: MOVEMENT_ENTRY_STEPS.TYPE,
      label: 'الحركة',
      value: movementLabels[movementDraft.type],
    },
    {
      key: 'amount',
      step: MOVEMENT_ENTRY_STEPS.AMOUNT,
      label: 'المبلغ',
      value: movementDraft.amount ? money(movementDraft.amount, movementConfig.currency || movementDraft.currency) : 'لم يدخل',
    },
    movementConfig.currencyLocked
      ? null
      : {
          key: 'currency',
          step: MOVEMENT_ENTRY_STEPS.CURRENCY,
          label: 'العملة',
          value: movementDraft.currency === CURRENCIES.USD ? 'دولار' : 'دينار',
        },
    movementConfig.needsRate
      ? {
          key: 'rate',
          step: MOVEMENT_ENTRY_STEPS.RATE,
          label: 'السعر',
          value: movementDraft.rate ? formatRate(movementDraft.rate) : 'لم يدخل',
        }
      : null,
    movementSourceRequired
      ? {
          key: 'source',
          step: MOVEMENT_ENTRY_STEPS.SOURCE,
          label: movementConfig.sourceLabel || 'من',
          value: draftSourceAccount ? protectedAccountLabel(draftSourceAccount) : 'اختر',
        }
      : null,
    movementConfig.needsDestination
      ? {
          key: 'destination',
          step: MOVEMENT_ENTRY_STEPS.DESTINATION,
          label: movementConfig.destinationLabel || 'إلى',
          value: draftDestinationAccount ? protectedAccountLabel(draftDestinationAccount) : 'اختر',
        }
      : null,
    {
      key: 'note',
      step: MOVEMENT_ENTRY_STEPS.NOTE,
      label: 'ملاحظة',
      value: movementDraft.note ? preserveUiData(movementDraft.note) : 'بدون',
    },
  ].filter(Boolean)
  const completedMovementReceipt = movementReceipt.filter((item) => visibleMovementSteps.indexOf(item.step) < currentMovementStepIndex)
  const completedAccountStages = accountWizardStages.slice(0, currentAccountWizardIndex).map((step) => ({
    key: step.key,
    step: step.key,
    label: step.title,
    value: step.key === ACCOUNT_WIZARD_STEPS.NAME ? preserveUiData(step.summary) : step.summary,
  }))

  if (!isHydrated || loadFailed) {
    return (
      <main className="adreem-app adreem-cloud-gate" dir={uiDirection} lang={normalizedUiLanguage}>
        <section role="status" aria-live="polite">
          <span>ADREEM</span>
          <h1>{isHydrated ? 'تعذر فتح الدفتر' : 'جاري فتح الدفتر'}</h1>
          <p>{isHydrated ? 'لم نعرض نسخة فارغة حتى تبقى بياناتك آمنة. أعد المحاولة بعد لحظة.' : 'يتم تحميل بياناتك من السحابة.'}</p>
          {isHydrated ? (
            <div>
              <button type="button" onClick={() => window.location.reload()}>
                إعادة المحاولة
              </button>
              <button type="button" className="is-secondary" onClick={logoutFromCloudSession}>
                تسجيل الدخول من جديد
              </button>
            </div>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <AdreemChrome activeSection={activeSection} activeSectionTitle={activeSectionTitle} saveStatus={saveStatus} storageText={storageText} todayCount={todayMovements.length} reviewCount={reviewItems.length} canOpenAdmin={canOpenAdmin} canLogout={canLogout} profile={protectedUserProfile(userProfile)} language={normalizedUiLanguage} languageStatus={languageStatus} languageMessage={languageMessage} onLanguageChange={changeUiLanguage} onRetrySave={() => saveCoordinatorRef.current?.retryNow()} onOpenAdmin={openAdminUsersPage} onLogout={logoutFromCloudSession} onSectionChange={switchSection}>
      {activeSection !== 'entry' ? <AlertBoard reviewAccounts={balancesByKind.review} reviewMovements={reviewMovements} externalMissing={unresolvedExternalAccounts} balances={balances} movements={postedUserMovements} totals={totals} dueRecurringCount={dueRules.length} reconciliationDiffCount={reconciliationDiffCount} /> : null}

      <section key={activeSection} className={`ml3-layout ml3-layout--${activeSection} ${activeSection === 'entry' ? 'is-entry' : 'is-content-only'}`}>
        {activeSection === 'entry' ? (
          <aside className={`adreem-entry adreem-desk-entry adreem-entry--${activeEntryMode}`}>
            <div className="ml3-entry-mode" aria-label="نوع الإضافة">
              <button type="button" className={activeEntryMode === 'movement' ? 'is-active' : ''} onClick={() => switchEntryMode('movement')}>
                <ArrowRightLeft aria-hidden="true" size={17} />
                حركة جديدة
              </button>
              <button type="button" className={activeEntryMode === 'account' ? 'is-active' : ''} onClick={() => switchEntryMode('account')}>
                <WalletCards aria-hidden="true" size={17} />
                حساب جديد
              </button>
            </div>
            {feedback || pendingUndo || editingMovementId ? (
              <div className="adreem-notice-stack">
                {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
                {pendingUndo ? (
                  <div className="ml3-undo-banner">
                    <span>{pendingUndo.label}</span>
                    <button type="button" onClick={undoPendingMovement}>تراجع</button>
                  </div>
                ) : null}
                {editingMovementId ? (
                  <div className="ml3-edit-banner">
                    <span>تعديل حركة محفوظة</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMovementId('')
                        setMovementDraft(emptyMovementDraft(movementDraft.type))
                        setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
                        setFeedback('تم ترك التعديل بدون تغيير الحركة.')
                      }}
                    >
                      ترك
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {activeEntryMode === 'movement' ? (
              <form className={`ml3-entry-card ml3-entry-card--movement ml3-entry-card--${movementTone(movementDraft.type)}`} aria-busy={isSavingMovement} onSubmit={saveMovement}>
                <header className="adreem-flow-head" aria-live="polite">
                  <div>
                    <span>{movementProgressText}</span>
                    <h2>{currentMovementStepCopy.title}</h2>
                    <p>{currentMovementStepCopy.summary}</p>
                  </div>
                  <b className={preview.validation.ok ? 'is-ready' : ''}>{preview.validation.ok ? 'جاهزة' : 'قيد الإدخال'}</b>
                </header>
                <FlowProgress current={currentMovementStepIndex + 1} total={visibleMovementSteps.length} items={completedMovementReceipt} onEdit={editMovementStep} />

                {movementStep === MOVEMENT_ENTRY_STEPS.TYPE ? (
                  <section className="ml3-step ml3-step--type is-open">
                    <div className="ml3-action-catalog">
                      <section className="ml3-action-lane ml3-action-lane--daily">
                        <div className="ml3-action-lane-head">
                          <strong>{movementOptionGroups[0].title}</strong>
                          <span>{movementOptionGroups[0].hint}</span>
                        </div>
                        <div className="ml3-option-grid">
                          {movementOptionGroups[0].types
                            .map((type) => movementTypeOptions.find((option) => option.type === type))
                            .filter(Boolean)
                            .map((option) => (
                              <MovementChoiceButton key={option.type} option={option} active={hasChosenMovementType && movementDraft.type === option.type} onChoose={chooseMovementType} />
                            ))}
                        </div>
                      </section>
                      <details className="ml3-more-actions">
                        <summary>
                          <span>
                            <CircleDollarSign aria-hidden="true" size={17} /> عمليات أخرى
                          </span>
                          <small>المصرف والدولار</small>
                        </summary>
                        <div className="ml3-more-actions-grid">
                          {movementOptionGroups.slice(1).map((group) => (
                            <section className={`ml3-action-lane ml3-action-lane--${group.key}`} key={group.key}>
                              <div className="ml3-action-lane-head">
                                <strong>{group.title}</strong>
                                <span>{group.hint}</span>
                              </div>
                              <div className="ml3-option-grid">
                                {group.types
                                  .map((type) => movementTypeOptions.find((option) => option.type === type))
                                  .filter(Boolean)
                                  .map((option) => (
                                    <MovementChoiceButton key={option.type} option={option} active={hasChosenMovementType && movementDraft.type === option.type} onChoose={chooseMovementType} />
                                  ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      </details>
                    </div>
                  </section>
                ) : null}

                {movementStep === MOVEMENT_ENTRY_STEPS.AMOUNT ? (
                  <section className="ml3-step ml3-step--amount is-open">
                    <div className="ml3-field-pair is-single">
                      <NumericEntry label={movementConfig.amountLabel} value={movementDraft.amount} onChange={(value) => updateMovementDraft('amount', value)} />
                    </div>
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" disabled={!hasMovementAmount} onClick={advanceMovementStep}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {movementStep === MOVEMENT_ENTRY_STEPS.CURRENCY ? (
                  <section className="ml3-step ml3-step--currency is-open">
                    {movementConfig.currencyLocked ? (
                      <div className="ml3-currency-lock">
                        <span>العملة</span>
                        <strong>{movementConfig.currencyText}</strong>
                      </div>
                    ) : (
                      <label>
                        العملة
                        <select value={movementDraft.currency} onChange={(event) => updateMovementDraft('currency', event.target.value)}>
                          <option value={CURRENCIES.DINAR}>دينار</option>
                          <option value={CURRENCIES.USD}>دولار</option>
                        </select>
                      </label>
                    )}
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {movementConfig.needsRate && movementStep === MOVEMENT_ENTRY_STEPS.RATE ? (
                  <section className="ml3-step ml3-step--rate is-open">
                    <NumericEntry label={movementConfig.rateLabel} value={movementDraft.rate} onChange={(value) => updateMovementDraft('rate', value)} placeholder="7.5" allowDecimal />
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" disabled={!hasMovementRate} onClick={advanceMovementStep}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {movementSourceRequired && movementStep === MOVEMENT_ENTRY_STEPS.SOURCE ? (
                  <section className="ml3-step ml3-step--source is-open">
                    <div className="ml3-route-picker is-single">
                      <AccountSearchSelect label={movementConfig.sourceLabel} value={movementDraft.sourceAccountId || ''} accounts={movementAccountsFor('source')} onChange={(value) => updateMovementDraft('sourceAccountId', value)} preferredAccountIds={preferredMovementAccountIds('source')} balanceByAccountId={balanceByAccountId} balanceCurrency={movementAccountCurrencyForRole(movementDraft.type, 'source', movementDraft.currency)} />
                    </div>
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" disabled={!movementDraft.sourceAccountId} onClick={advanceMovementStep}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {movementConfig.needsDestination && movementStep === MOVEMENT_ENTRY_STEPS.DESTINATION ? (
                  <section className="ml3-step ml3-step--destination is-open">
                    <div className="ml3-route-picker is-single">
                      <AccountSearchSelect label={movementConfig.destinationLabel} value={movementDraft.destinationAccountId || ''} accounts={movementAccountsFor('destination')} onChange={(value) => updateMovementDraft('destinationAccountId', value)} balanceByAccountId={balanceByAccountId} balanceCurrency={movementAccountCurrencyForRole(movementDraft.type, 'destination', movementDraft.currency)} />
                    </div>
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" disabled={!movementDraft.destinationAccountId || sameLogicalAccount(draftSourceAccount, draftDestinationAccount)} onClick={advanceMovementStep}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {movementStep === MOVEMENT_ENTRY_STEPS.NOTE ? (
                  <section className="ml3-step ml3-step--note is-open">
                    <label>
                      ملاحظة
                      <textarea value={movementDraft.note} onChange={(event) => updateMovementDraft('note', event.target.value)} placeholder="اختياري" />
                    </label>
                    <div className="ml3-extra-grid">
                      {movementUsesDimension ? (
                        <label>
                          مشروع / أصل
                          <select value={movementDraft.dimensionId} onChange={(event) => updateMovementDraft('dimensionId', event.target.value)}>
                            <option value="">بدون ربط</option>
                            {activeDimensions.map((dimension) => (
                              <option key={dimension.id} value={dimension.id}>
                                {preserveUiData(dimension.name)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? (
                        <label>
                          نوع المصروف
                          <select value={movementDraft.expenseCategoryId} onChange={(event) => updateMovementDraft('expenseCategoryId', event.target.value)}>
                            <option value="">بدون تصنيف</option>
                            {activeExpenseCategories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {protectedAccountPrimaryName(category)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        مرفق
                        <input value={movementDraft.attachmentLabel} onChange={(event) => updateMovementDraft('attachmentLabel', event.target.value)} placeholder="رقم إيصال أو وصف" />
                      </label>
                      <label>
                        رابط المرفق
                        <input value={movementDraft.attachmentUrl} onChange={(event) => updateMovementDraft('attachmentUrl', event.target.value)} placeholder="اختياري" />
                      </label>
                      <label className="ml3-file-field">
                        ملف
                        <span>{movementAttachmentFile?.name ? preserveUiData(movementAttachmentFile.name) : 'اختر ملفًا'}</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setMovementAttachmentFile(event.target.files?.[0] || null)} />
                      </label>
                      <label className="ml3-checkline">
                        <input type="checkbox" checked={movementDraft.recurringEnabled} onChange={(event) => updateMovementDraft('recurringEnabled', event.target.checked)} />
                        حركة شهرية
                      </label>
                    </div>
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                        مراجعة <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </section>
                ) : null}

                {canReviewMovement ? (
                  <section className="ml3-step ml3-step--review ml3-step--final is-open">
                    <div className={`ml3-preview ${preview.validation.ok ? 'is-ok' : 'is-review'}`}>
                      {preview.validation.errors.map((error) => (
                        <span key={`${error.field}-${error.message}`}>{error.message}</span>
                      ))}
                      {preview.effects.map((effect) => (
                        <div className="ml3-effect" key={`${effect.accountId}-${effect.currency}`}>
                          <span>{protectedAccountLabel(effect.account)}</span>
                          <b>{money(effect.before, effect.currency)}</b>
                          <i>{signedMoney(effect.delta, effect.currency)}</i>
                          <strong>{money(effect.after, effect.currency)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="ml3-step-controls">
                      <button type="button" className="ml3-step-back" onClick={retreatMovementStep}>
                        <ChevronRight aria-hidden="true" size={17} /> رجوع
                      </button>
                      <button className="ml3-save" type="submit" disabled={isSavingMovement}>
                        {isSavingMovement ? 'جاري الحفظ' : preview.validation.ok ? 'تأكيد وحفظ الحركة' : 'حفظ كحركة ناقصة'}
                      </button>
                    </div>
                  </section>
                ) : null}
              </form>
            ) : null}

            {activeEntryMode === 'movement' ? (
              <section className="ml3-today-panel">
                <div className="ml3-today-head">
                  <h2>آخر حركات اليوم</h2>
                  <button type="button" onClick={() => switchSection('history')}>
                    الكل <span>{formatCount(todayMovements.length)}</span>
                  </button>
                </div>
                <div className="ml3-today-list">
                  {todayMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات اليوم.</p> : null}
                  {todayPreviewMovements.map((movement) => (
                    <MovementMiniRow key={movement.id} movement={movement} accountById={accountById} attachments={ledgerExtras.attachments || []} dimensions={activeDimensions} onCancel={cancelMovement} onDeleteAttachment={deleteAttachment} />
                  ))}
                </div>
              </section>
            ) : null}
            {activeEntryMode === 'account' ? (
              <form className="ml3-add-account ml3-account-wizard" onSubmit={addAccount}>
                <header className="adreem-flow-head" aria-live="polite">
                  <div>
                    <span>
                      {formatCount(currentAccountWizardIndex + 1)}/{formatCount(accountWizardStages.length)}
                    </span>
                    <h2>{accountWizardStages[currentAccountWizardIndex]?.title}</h2>
                    <p>{currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME && hasAccountDraftName ? preserveUiData(accountWizardStages[currentAccountWizardIndex]?.summary) : accountWizardStages[currentAccountWizardIndex]?.summary}</p>
                  </div>
                  <b>{currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP ? 'حساب جديد' : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET ? selectedAccountPresetGroup.title : selectedAccountPreset.title}</b>
                </header>
                <FlowProgress current={currentAccountWizardIndex + 1} total={accountWizardStages.length} items={completedAccountStages} onEdit={goToAccountWizardStep} />

                <section key={currentAccountWizardStep} className={`ml3-account-stage ml3-account-stage--${currentAccountWizardStep}`}>
                  <div className="ml3-account-stage-head">
                    <h3>{currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP ? 'الحساب يخص ماذا؟' : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET ? selectedAccountPresetCopy.question : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME ? selectedAccountPreset.nameLabel : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.DETAIL ? selectedAccountPreset.detailLabel : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY ? 'بأي عملة؟' : 'راجع الحساب'}</h3>
                    <p>{currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP ? 'اختر الأقرب فقط.' : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET ? selectedAccountPresetCopy.hint : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME ? selectedAccountPreset.namePlaceholder : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.DETAIL ? 'اختر كاش بينكما أو شيك بينكما.' : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY ? 'اختر دينارًا أو دولارًا.' : 'تأكد من الاسم والنوع والعملة.'}</p>
                  </div>

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.GROUP ? (
                    <div className="ml3-account-choice-list" aria-label="نوع الحساب">
                      {accountPresetGroups.map((group) => {
                        return (
                          <button type="button" className={activeAccountPresetGroup === group.key ? 'is-active' : ''} key={group.key} onClick={() => chooseAccountPresetGroup(group.key)} aria-current={activeAccountPresetGroup === group.key ? 'true' : undefined}>
                            <i>
                              <AccountGroupIcon groupKey={group.key} />
                            </i>
                            <span>
                              <strong>{group.title}</strong>
                              <small>{group.hint}</small>
                            </span>
                            <ChevronLeft aria-hidden="true" size={16} />
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.PRESET ? (
                    <div className="ml3-account-choice-list" aria-label={selectedAccountPresetCopy.title}>
                      {selectedAccountPresetGroup.keys
                        .map((key) => accountPresets.find((preset) => preset.key === key))
                        .filter(Boolean)
                        .map((preset) => {
                          return (
                            <button type="button" key={preset.key} className={activeAccountPresetKey === preset.key ? 'is-active' : ''} onClick={() => chooseAccountPreset(preset)} aria-current={activeAccountPresetKey === preset.key ? 'true' : undefined}>
                              <i>
                                <AccountPresetIcon presetKey={preset.key} />
                              </i>
                              <span>
                                <strong>{preset.title}</strong>
                                <small>{preset.detail}</small>
                              </span>
                              <ChevronLeft aria-hidden="true" size={16} />
                            </button>
                          )
                        })}
                    </div>
                  ) : null}

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME ? (
                    <label className="ml3-account-field">
                      <span>{selectedAccountPreset.nameLabel || 'الاسم'}</span>
                      <input value={accountDraftNameValue} onChange={(event) => setAccountDraft((current) => applyAccountName(current, event.target.value))} placeholder={selectedAccountPreset.namePlaceholder || 'اكتب الاسم'} />
                      <small>هذا هو الاسم الذي سيظهر في الأرصدة والبحث.</small>
                    </label>
                  ) : null}

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.DETAIL ? (
                    <div className="ml3-account-choice-list is-compact" aria-label={selectedAccountPreset.detailLabel || 'نوع التعامل'}>
                      {selectedAccountDetails.map((option) => (
                        <button
                          type="button"
                          key={option}
                          className={activeAccountDetail === option ? 'is-active' : ''}
                          onClick={() => {
                            setAccountDraft((current) => ({
                              ...current,
                              subAccountName: option,
                            }))
                            setActiveAccountDetail(option)
                            goToAccountWizardStep(accountNeedsCurrencyChoice ? ACCOUNT_WIZARD_STEPS.CURRENCY : ACCOUNT_WIZARD_STEPS.SAVE)
                          }}
                        >
                          <strong>{option}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.CURRENCY ? (
                    <div className="ml3-account-choice-list is-compact" aria-label="عملة الحساب">
                      <button
                        type="button"
                        className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.DINAR ? 'is-active' : ''}
                        onClick={() => {
                          setAccountDraft((current) => ({
                            ...current,
                            currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
                          }))
                          goToAccountWizardStep(ACCOUNT_WIZARD_STEPS.SAVE)
                        }}
                      >
                        <strong>دينار</strong>
                      </button>
                      <button
                        type="button"
                        className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 'is-active' : ''}
                        onClick={() => {
                          setAccountDraft((current) => ({
                            ...current,
                            currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
                          }))
                          goToAccountWizardStep(ACCOUNT_WIZARD_STEPS.SAVE)
                        }}
                      >
                        <strong>دولار</strong>
                      </button>
                    </div>
                  ) : null}

                  {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.SAVE ? (
                    <div className="ml3-account-summary">
                      <span>الحساب بعد الحفظ</span>
                      <strong>{protectedAccountDraftSummary(accountDraft)}</strong>
                    </div>
                  ) : null}

                  <div className="ml3-account-stage-actions">
                    <button type="button" className="ml3-step-back" disabled={currentAccountWizardIndex === 0} onClick={retreatAccountWizard}>
                      <ChevronRight aria-hidden="true" size={17} /> رجوع
                    </button>
                    {currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.SAVE ? (
                      <button type="submit" className="ml3-step-next" disabled={!hasAccountDraftName}>
                        حفظ الحساب <Check aria-hidden="true" size={17} />
                      </button>
                    ) : currentAccountWizardStep === ACCOUNT_WIZARD_STEPS.NAME ? (
                      <button type="button" className="ml3-step-next" disabled={!canAdvanceAccountWizard} onClick={advanceAccountWizard}>
                        التالي <ChevronLeft aria-hidden="true" size={17} />
                      </button>
                    ) : (
                      <span className="adreem-choice-hint">اختر للمتابعة</span>
                    )}
                  </div>
                </section>
              </form>
            ) : null}
          </aside>
        ) : null}

        {activeSection !== 'entry' ? (
          <section className="ml3-content" key={`content-${activeSection}`}>
            {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
            {pendingUndo ? (
              <div className="ml3-undo-banner">
                <span>{pendingUndo.label}</span>
                <button type="button" onClick={undoPendingMovement}>
                  تراجع
                </button>
              </div>
            ) : null}
            {renderSection()}
          </section>
        ) : null}
      </section>
      <AccountProfile bucket={selectedBucket} movements={movements} accounts={accounts} attachments={ledgerExtras.attachments || []} reconciliations={ledgerExtras.reconciliations || []} auditEvents={ledgerExtras.auditEvents || []} isAddingAttachment={isAddingAccountAttachment} onClose={() => setSelectedAccountId('')} onEditMovement={editReviewMovement} onUpdateAccount={updateAccountClassification} onReconcile={reconcileAccount} onAddAttachment={addAccountAttachment} onDeleteAttachment={deleteAttachment} />
    </AdreemChrome>
  )
}
