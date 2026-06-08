import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ACCOUNT_STATUSES,
  ACCOUNT_CURRENCY_KINDS,
  ACCOUNT_TYPES,
  VALUE_KINDS,
  getActivePostingAccounts,
  knownExternalAccounts,
} from './accountCatalog'
import {
  accountClassificationOptions,
  accountDisplayName,
  accountDraftSummary,
  accountKindLabel,
  accountDetailOptionsFor,
  accountNameValue,
  accountNeedsCurrency,
  accountPresetFor,
  accountPresets,
  applyAccountName,
  classificationValueFor as classificationValue,
  displaySubAccountName,
  emptyAccountDraft,
  parseAccountClassification as parseClassification,
} from './accountConfig'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  canCommitMovementEdit,
  createAccount,
  postMovement,
  previewMovement,
  summarizeBalances,
  validateAccount,
  validateMovement,
  voidMovement,
} from './ledgerCore'
import {
  ADREEM_API_TOKEN_SESSION_KEY,
  getMohammadPersistenceMode,
  loadLocalMohammadState,
  loadMohammadPersistedState,
  saveMohammadPersistedState,
} from './mohammadPersistence'
import {
  createEmptyAdreemState,
  createMohammadFallbackState,
  normalizeLedgerState,
  normalizeMohammadAccounts,
  sameRecordVersions,
} from './ledgerState'
import {
  MOVEMENT_ENTRY_STEPS,
  movementConfigFor,
  movementDefaultsFor,
  movementLabels,
  movementNeedsSource,
  movementPreferredAccountIds,
  movementSupportsDimension,
  movementTone,
  movementTypeOptions,
} from './movementConfig'
import {
  getMovementAccounts,
  sameLogicalAccount,
} from './movementAccounts'
import {
  RECURRING_FREQUENCIES,
  attachmentsForRecord,
  buildDimensionReports,
  buildLedgerAlerts,
  buildReconciliationCorrectionDrafts,
  createAttachment,
  createAuditEvent,
  createReconciliation,
  createRecurringRuleFromMovement,
  disableRecurringRule,
  dimensionsFromAccounts,
  dueRecurringRules,
  lastReconciliationForAccount,
  runRecurringRule,
} from './ledgerOperations'

const sectionTabs = [
  { key: 'entry', label: 'عملية', mark: '+' },
  { key: 'accounts', label: 'أرصدة', mark: '=' },
  { key: 'history', label: 'حركات', mark: '≡' },
  { key: 'review', label: 'مراجعة', mark: '!' },
]


const CANCEL_WINDOW_HOURS = 24
const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000

const accountGroupTabs = [
  { key: 'people', label: 'الناس', title: 'الناس' },
  { key: 'money', label: 'فلوسي', title: 'فلوسي' },
  { key: 'assets', label: 'أصول', title: 'الأصول' },
  { key: 'expenses', label: 'مصروفات', title: 'المصروفات' },
  { key: 'review', label: 'مراجعة', title: 'مراجعة' },
]

const sectionTitles = {
  entry: 'عملية جديدة',
  accounts: 'الأرصدة',
  history: 'الحركات',
  review: 'المراجعة',
}

function accountPresetMark(key) {
  if (key === 'person-cash') return 'ش'
  if (key === 'own-cash') return 'ك'
  if (key === 'own-bank') return 'م'
  if (key === 'asset') return 'أ'
  if (key === 'project') return 'ع'
  if (key === 'expense') return 'ص'
  return 'ح'
}

function loadInitialLedgerState() {
  const mode = getMohammadPersistenceMode()
  const fallback = mode === 'api' || mode === 'api-missing-token'
    ? createEmptyAdreemState()
    : createMohammadFallbackState()
  const state = mode === 'api' || mode === 'api-missing-token'
    ? fallback
    : loadLocalMohammadState(fallback)
  return { ...state, accounts: normalizeMohammadAccounts(state.accounts) }
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

function money(value, currency = CURRENCIES.DINAR) {
  const unit = currency === CURRENCIES.USD ? '$' : 'د.ل'
  const rounded = Math.round(Number(value || 0))
  return `${formatInteger(rounded)} ${unit}`
}

function signedMoney(value, currency = CURRENCIES.DINAR) {
  const rounded = Math.round(Number(value || 0))
  const prefix = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  return `${prefix}${formatInteger(Math.abs(rounded))} ${currency === CURRENCIES.USD ? '$' : 'د.ل'}`
}

function formatInteger(value) {
  const rounded = Math.round(Number(value || 0))
  return rounded.toLocaleString('en-US')
}

function formatCount(value) {
  return formatInteger(value)
}

function formatRate(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return ''
  return number.toLocaleString('en-US', {
    maximumFractionDigits: 6,
  })
}

function formatNumericEntryValue(value, allowDecimal = false) {
  const raw = String(value || '')
  if (!raw) return ''
  if (allowDecimal) {
    const [whole, fraction = ''] = raw.split('.')
    const formattedWhole = whole ? formatInteger(whole) : '0'
    return raw.includes('.') ? `${formattedWhole}.${fraction}` : formattedWhole
  }
  return formatInteger(raw.replace(/\D/g, ''))
}

function parseWholeAmount(value) {
  const number = Number(String(value || '').replace(/,/g, ''))
  return Number.isFinite(number) ? Math.round(number) : 0
}

function emptyMovementDraft(type = MOVEMENT_TYPES.TRANSFER) {
  const config = movementConfigFor(type)
  const defaults = movementDefaultsFor(type)
  return {
    type,
    amount: '',
    currency: config.currency || CURRENCIES.DINAR,
    sourceAccountId: config.needsSource === false ? '' : defaults.sourceAccountId,
    destinationAccountId: config.needsDestination ? defaults.destinationAccountId : '',
    rate: '',
    note: '',
    dimensionId: '',
    attachmentLabel: '',
    attachmentUrl: '',
    recurringEnabled: false,
    recurringFrequency: RECURRING_FREQUENCIES.MONTHLY,
  }
}

function accountLabel(account) {
  return account ? accountDisplayName(account) : ''
}

function movementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'تم'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقص'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغي'
  return 'مسودة'
}

function movementTime(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' })
}

function movementDateTime(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ar-LY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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

function storageTextForStatus(saveStatus, storageMode) {
  return {
    loading: 'تحميل',
    saving: 'حفظ',
    saved: storageMode === 'supabase' || storageMode === 'api' ? 'سحابي' : 'تطوير',
    local: storageMode === 'api-missing-token' ? 'دخول ناقص' : 'تطوير',
    'local-only': storageMode === 'api-missing-token' ? 'دخول ناقص' : 'سحابة متوقفة',
  }[saveStatus] || 'تطوير'
}

function logoutFromCloudSession() {
  if (typeof window === 'undefined') return
  window.sessionStorage?.removeItem(ADREEM_API_TOKEN_SESSION_KEY)
  window.location.assign(`${window.location.pathname}${window.location.search}`)
}

function openAdminUsersPage() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('admin', 'users')
  url.hash = ''
  window.location.assign(`${url.pathname}${url.search}`)
}

function movementVisibleSteps(config, needsSource) {
  return [
    MOVEMENT_ENTRY_STEPS.TYPE,
    MOVEMENT_ENTRY_STEPS.AMOUNT,
    config.currencyLocked ? null : MOVEMENT_ENTRY_STEPS.CURRENCY,
    config.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : null,
    needsSource ? MOVEMENT_ENTRY_STEPS.SOURCE : null,
    config.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : null,
    MOVEMENT_ENTRY_STEPS.NOTE,
    MOVEMENT_ENTRY_STEPS.REVIEW,
  ].filter(Boolean)
}

function nonZero(bucket) {
  return Math.round(Math.abs(bucket.dinar)) !== 0 || Math.round(Math.abs(bucket.usd)) !== 0
}

function externalAccountKey(account = {}) {
  return String(account.id || `${account.ownerName || ''}:${account.subAccountName || ''}`).trim()
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

function accountBalanceChip(account, bucket) {
  const dinar = Number(bucket?.dinar || 0)
  const usd = Number(bucket?.usd || 0)
  const hasDinar = Math.round(Math.abs(dinar)) !== 0
  const hasUsd = Math.round(Math.abs(usd)) !== 0

  if (!hasDinar && hasUsd) {
    return { tone: usd > 0 ? 'positive' : 'negative', text: money(Math.abs(usd), CURRENCIES.USD) }
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

function compareBalanceBuckets(a, b) {
  const aActive = Math.abs(a.dinar) > 0.000001 || Math.abs(a.usd) > 0.000001
  const bActive = Math.abs(b.dinar) > 0.000001 || Math.abs(b.usd) > 0.000001
  return Number(bActive) - Number(aActive) || Math.abs(b.dinar) - Math.abs(a.dinar) || Math.abs(b.usd) - Math.abs(a.usd)
}

function AccountRow({ bucket, muted = false, onConfirm, onDisable, onOpen }) {
  const { account, dinar, usd } = bucket
  const balanceTone = dinar > 0 ? 'is-positive' : dinar < 0 ? 'is-negative' : 'is-zero'
  const kindText = accountKindText(account)
  const detailText = displaySubAccountName(account.subAccountName)
  const showKind = kindText && kindText !== detailText
  return (
    <article className={`ml3-account-row ml3-account-row--${visualKind(account)} ${balanceTone} ${muted ? 'is-muted' : ''}`}>
      <button type="button" className="ml3-account-main" onClick={() => onOpen?.(account.id)}>
        <strong>{account.ownerName}</strong>
        <span>{detailText}</span>
      </button>
      <div className="ml3-account-meta">
        {showKind ? <span>{kindText}</span> : null}
        {account.status === ACCOUNT_STATUSES.NEEDS_REVIEW ? <b>تأكيد</b> : null}
      </div>
      <div className={`ml3-account-values ${balanceTone}`}>
        {Math.round(Math.abs(dinar)) !== 0 ? <strong>{formatDisplayMeaning(account, dinar)}</strong> : <span>صفر</span>}
        {Math.round(Math.abs(usd)) !== 0 ? <strong>{money(usd, CURRENCIES.USD)}</strong> : null}
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

function formatDisplayMeaning(account, amount) {
  const rounded = Math.round(Number(amount || 0))
  if (!rounded) return 'صفر'
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return `مصروف ${money(Math.abs(rounded))}`
  if (account?.valueKind === VALUE_KINDS.ASSET) return `قيمة ${money(Math.abs(rounded))}`
  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return rounded > 0 ? `موجود ${money(rounded)}` : `ناقص ${money(Math.abs(rounded))}`
  }
  return rounded > 0 ? `أقبض منه ${money(rounded)}` : `أدفع له ${money(Math.abs(rounded))}`
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
      <div className="ml3-list">
        {rows.length === 0 ? (
          <p className="ml3-empty">{emptyText}</p>
        ) : (
          rows.map((bucket) => (
            <AccountRow
              key={bucket.account.id}
              bucket={bucket}
              onConfirm={onConfirm}
              onDisable={onDisable}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </Tag>
  )
}

function AccountSearchSelect({ label, value, accounts, onChange, allowEmpty = true, preferredAccountIds = [], balanceByAccountId = new Map() }) {
  const [query, setQuery] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const selectedAccount = accounts.find((account) => account.id === value)
  const selectedBalance = selectedAccount ? accountBalanceChip(selectedAccount, balanceByAccountId.get(selectedAccount.id)) : null
  const showChooser = !selectedAccount || isChanging
  const preferredIndexById = new Map(preferredAccountIds.map((accountId, index) => [accountId, index]))
  const accountBucket = (account) => balanceByAccountId.get(account.id) || { dinar: 0, usd: 0 }
  const accountMagnitude = (account) => {
    const bucket = accountBucket(account)
    return Math.max(Math.abs(Math.round(bucket.dinar || 0)), Math.abs(Math.round(bucket.usd || 0)))
  }
  const hasVisibleBalance = (account) => accountMagnitude(account) > 0
  const preferredAccounts = preferredAccountIds
    .map((accountId) => accounts.find((account) => account.id === accountId))
    .filter(Boolean)
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
    const labelText = accountLabel(account).toLowerCase()
    const magnitude = accountMagnitude(account)
    if (preferredIndexById.has(account.id)) return -1000 + preferredIndexById.get(account.id)
    if (account.id === value) return -900
    if (ownerName === normalizedPreferredOwner) return -820
    if (magnitude > 0) return -700 - Math.min(magnitude / 1000, 250)
    if (normalizedQuery && labelText.startsWith(normalizedQuery)) return -500
    if (normalizedQuery && ownerName.toLowerCase().startsWith(normalizedQuery)) return -480
    return 0
  }
  const filteredAccounts = accounts
    .filter((account) => {
      const haystack = `${account.ownerName} ${account.subAccountName} ${displaySubAccountName(account.subAccountName)} ${account.legacyName || ''}`.toLowerCase()
      if (normalizedQuery) return haystack.includes(normalizedQuery)
      return matchesQuickFilter(account)
    })
    .sort((a, b) => rankAccount(a) - rankAccount(b) || accountLabel(a).localeCompare(accountLabel(b), 'ar'))
  const visibleAccounts = selectedAccount && !filteredAccounts.some((account) => account.id === selectedAccount.id)
    ? [selectedAccount, ...filteredAccounts]
    : filteredAccounts
  const resultAccounts = visibleAccounts

  function chooseAccount(accountId) {
    onChange(accountId)
    setQuery('')
    setQuickFilter('')
    setIsChanging(false)
  }

  return (
    <div className="ml3-account-picker" aria-label={label}>
      <div className={`ml3-picked-account ${selectedAccount ? `is-selected ml3-picked-account--${visualKind(selectedAccount)}` : ''}`}>
        <div>
          <strong>{selectedAccount ? accountLabel(selectedAccount) : 'اختر الحساب'}</strong>
        </div>
        {selectedAccount ? (
          <div className="ml3-picked-actions">
            <b className={`ml3-balance-chip is-${selectedBalance.tone}`}>{selectedBalance.text}</b>
            <button type="button" onClick={() => setIsChanging(true)}>تغيير</button>
            {allowEmpty ? <button type="button" onClick={() => chooseAccount(null)}>مسح</button> : null}
          </div>
        ) : null}
      </div>
      {showChooser ? (
        <>
          <label className="ml3-search-box">
            <span>بحث</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setQuickFilter('')
              }}
              placeholder="اكتب الاسم أو كاش أو مصرف"
            />
          </label>
          {!normalizedQuery && !quickFilter && preferredAccounts.length ? (
            <div className="ml3-picker-favorites" aria-label="اختيارات سريعة">
              {preferredAccounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className={`ml3-picker-favorite--${visualKind(account)} ${account.id === value ? 'is-selected' : ''}`}
                  onClick={() => chooseAccount(account.id)}
                >
                  <strong>{account.ownerName}</strong>
                  <span>{displaySubAccountName(account.subAccountName)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="ml3-picker-chips" aria-label="تصفية سريعة">
            {quickFilters.map((filter) => (
              <button
                type="button"
                key={filter.key || 'all'}
                className={quickFilter === filter.key && !normalizedQuery ? 'is-active' : ''}
                onClick={() => { setQuickFilter(filter.key); setQuery('') }}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="ml3-picker-results">
            {resultAccounts.map((account) => {
              const balanceChip = accountBalanceChip(account, balanceByAccountId.get(account.id))
              const hasBalance = hasVisibleBalance(account)
              return (
                <button
                  type="button"
                  key={account.id}
                  className={`ml3-picker-option--${visualKind(account)} ${account.ownerName === normalizedPreferredOwner ? 'is-preferred' : ''} ${hasBalance ? 'has-balance' : ''} ${account.id === value ? 'is-selected' : ''}`}
                  onClick={() => chooseAccount(account.id)}
                >
                  <span className={`ml3-picker-dot ml3-picker-dot--${visualKind(account)}`} aria-hidden="true" />
                  <strong>{account.ownerName}</strong>
                  <span>{displaySubAccountName(account.subAccountName)}</span>
                  <b className={`ml3-balance-chip is-${balanceChip.tone}`}>{balanceChip.text}</b>
                  {account.id === value ? <em>مختار</em> : null}
                </button>
              )
            })}
            {normalizedQuery && resultAccounts.length === 0 ? <p>لا توجد نتيجة</p> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function NumericEntry({ label, value, onChange, name, placeholder = '0', allowDecimal = false }) {
  const textValue = String(value || '')
  const keys = allowDecimal
    ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '000']
    : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '000']

  function pushKey(key) {
    if (!allowDecimal && key === '.') return
    if (key === '.' && textValue.includes('.')) return
    const next = textValue === '0' && key !== '.' ? key : `${textValue}${key}`
    onChange(next)
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
          <button type="button" key={key} onClick={() => pushKey(key)}>{key}</button>
        ))}
        <button type="button" onClick={() => onChange(textValue.slice(0, -1))}>حذف</button>
        <button type="button" onClick={() => onChange('')}>مسح</button>
      </div>
    </div>
  )
}

function MovementMiniRow({ movement, accountById, attachments = [], dimensions = [], onCancel }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const movementAttachments = attachmentsForRecord(attachments, { movementId: movement.id })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)

  return (
    <article className={`ml3-today-row ml3-today-row--${movementTone(movement.type)} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-today-main">
        <strong>{movementLabels[movement.type] || movement.type}</strong>
        <span>{movementTime(movement.createdAt)} · {money(movement.amount, movement.currency)} · {movementStatusLabel(movement.status)}</span>
      </div>
      <div className="ml3-today-route">
        {source ? <b>{accountLabel(source)}</b> : null}
        {destination ? <b>{accountLabel(destination)}</b> : null}
      </div>
      {effects.length ? (
        <div className="ml3-today-effects">
          {effects.map((effect) => {
            const account = accountById.get(effect.accountId)
            return (
              <span key={`${effect.accountId}-${effect.currency}`}>
                {account?.ownerName || effect.accountId} {signedMoney(effect.delta, effect.currency)}
              </span>
            )
          })}
        </div>
      ) : null}
      {movement.note ? <small>{movement.note}</small> : null}
      {dimension ? <small>ملف: {dimension.name}</small> : null}
      {movementAttachments.length ? <small>مرفق: {movementAttachments.map((item) => item.label).join('، ')}</small> : null}
      {canCancelMovement(movement) ? (
        <button type="button" onClick={() => onCancel(movement.id)}>إلغاء</button>
      ) : null}
    </article>
  )
}

function HistoryMovementRow({ movement, accountById, attachments = [], dimensions = [], onCancel }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const statusTone = movement.status === MOVEMENT_STATUSES.POSTED ? 'تم' : movementStatusLabel(movement.status)
  const movementAttachments = attachmentsForRecord(attachments, { movementId: movement.id })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)

  return (
    <article className={`ml3-history-row ml3-history-row--${movementTone(movement.type)} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-history-main">
        <strong>{movementLabels[movement.type] || movement.type}</strong>
        <span>{movementDateTime(movement.createdAt || movement.updatedAt)} · {money(movement.amount, movement.currency)} · {statusTone}</span>
      </div>
      <div className="ml3-history-route">
        {source ? <b>{accountLabel(source)}</b> : <b>بدون مصدر</b>}
        {destination ? <b>{accountLabel(destination)}</b> : null}
      </div>
      {effects.length ? (
        <div className="ml3-history-effects">
          {effects.map((effect) => {
            const account = accountById.get(effect.accountId)
            return (
              <span key={`${movement.id}-${effect.accountId}-${effect.currency}`}>
                {account?.ownerName || effect.accountId}: {signedMoney(effect.delta, effect.currency)}
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
      {movement.note ? <small>{movement.note}</small> : null}
      {dimension ? <small>ملف: {dimension.name}</small> : null}
      {movementAttachments.length ? <small>مرفق: {movementAttachments.map((item) => item.label).join('، ')}</small> : null}
      {canCancelMovement(movement) ? (
        <button type="button" onClick={() => onCancel(movement.id)}>إلغاء</button>
      ) : null}
    </article>
  )
}

function movementAccountImpact(movement, accountId) {
  return buildPostingEntries(movement).filter((entry) => entry.accountId === accountId)
}

function AccountProfile({ bucket, movements, accounts, attachments = [], reconciliations = [], onClose, onEditMovement, onUpdateAccount, onReconcile, onAddAttachment }) {
  if (!bucket) return null

  const { account, dinar, usd, postedCount } = bucket
  const accountAttachments = attachmentsForRecord(attachments, { accountId: account.id })
  const lastReconciliation = lastReconciliationForAccount(reconciliations, account.id)
  const relatedMovements = movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && movementAccountImpact(movement, account.id).length)
    .slice()
    .reverse()
  const accountMap = new Map(accounts.map((item) => [item.id, item]))

  return (
    <div className="ml3-profile-layer" role="dialog" aria-modal="true" aria-label="ملف الحساب" onClick={onClose}>
      <aside className="ml3-profile" onClick={(event) => event.stopPropagation()}>
        <div className="ml3-profile-head">
          <button type="button" onClick={onClose}>إغلاق</button>
          <div>
            <span>{accountKindText(account)}</span>
            <h2>{accountLabel(account)}</h2>
            <p>{account.valueKind === VALUE_KINDS.RECEIVABLE ? 'دين / رصيد' : 'داخل الدفتر'}</p>
          </div>
        </div>

        <div className={`ml3-profile-balance ${dinar > 0 ? 'is-positive' : dinar < 0 ? 'is-negative' : 'is-zero'}`}>
          <strong>{formatDisplayMeaning(account, dinar)}</strong>
          <span>{Math.round(Math.abs(usd)) !== 0 ? money(usd, CURRENCIES.USD) : 'لا يوجد دولار'}</span>
        </div>

        <div className="ml3-profile-facts">
          <div>
            <span>التصنيف</span>
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

        <form className="ml3-profile-reconcile ml3-profile-reconcile--balance" onSubmit={(event) => onReconcile(event, account.id, dinar, usd)}>
          <h3>مطابقة</h3>
          {lastReconciliation ? (
            <p className="ml3-profile-note">
              آخر مطابقة: {movementDateTime(lastReconciliation.createdAt)} · {lastReconciliation.note}
            </p>
          ) : null}
          <div className="ml3-profile-editor-grid">
            <label>
              الدينار الفعلي
              <input name="actualDinar" inputMode="numeric" defaultValue={formatInteger(dinar)} />
            </label>
            <label>
              الدولار الفعلي
              <input name="actualUsd" inputMode="numeric" defaultValue={formatInteger(usd)} />
            </label>
            <label>
              ملاحظة
              <input name="note" placeholder="الملاحظة مطلوبة" />
            </label>
          </div>
          <button type="submit">إنشاء تصحيح</button>
        </form>

        <form className="ml3-profile-reconcile ml3-profile-reconcile--attachment" onSubmit={(event) => onAddAttachment(event, account.id)}>
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
          </div>
          <button type="submit">ربط مرفق</button>
          {accountAttachments.length ? (
            <div className="ml3-attachment-list">
              {accountAttachments.slice(0, 5).map((attachment) => (
                <span key={attachment.id}>{attachment.label}</span>
              ))}
            </div>
          ) : null}
        </form>

        <form className="ml3-profile-editor" onSubmit={(event) => onUpdateAccount(event, account.id)}>
          <h3>تصنيف الحساب</h3>
          <div className="ml3-profile-editor-grid">
            <label>
              الاسم الظاهر
              <input name="ownerName" defaultValue={account.ownerName} />
            </label>
            <label>
              الوصف
              <input name="subAccountName" defaultValue={displaySubAccountName(account.subAccountName)} />
            </label>
            <label>
              التصنيف
              <select name="classification" defaultValue={classificationValue(account)}>
                {accountClassificationOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit">حفظ التصنيف</button>
        </form>

        <div className="ml3-profile-movements">
          <h3>الحركات</h3>
          {relatedMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات لهذا الحساب.</p> : null}
          {relatedMovements.map((movement) => {
            const impacts = movementAccountImpact(movement, account.id)
            const source = accountMap.get(movement.sourceAccountId)
            const destination = accountMap.get(movement.destinationAccountId)
            const movementAttachments = attachmentsForRecord(attachments, { movementId: movement.id })
            return (
              <article className="ml3-profile-movement" key={movement.id}>
                <div>
                  <strong>{movementLabels[movement.type] || movement.type}</strong>
                  <span>{accountLabel(source) || 'بدون مصدر'} ← {accountLabel(destination) || 'بدون وجهة'}</span>
                  {movement.note ? <small>{movement.note}</small> : null}
                  {movementAttachments.length ? <small>مرفق: {movementAttachments.map((item) => item.label).join('، ')}</small> : null}
                </div>
                <div className="ml3-profile-impact">
                  {impacts.map((impact) => (
                    <b key={`${movement.id}-${impact.currency}`}>{signedMoney(impact.delta, impact.currency)}</b>
                  ))}
                  {!movement.id?.startsWith('opening-') && canCancelMovement(movement) ? (
                    <button type="button" onClick={() => onEditMovement(movement)}>تعديل</button>
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

function ReviewAccountCard({ bucket, activeAccounts, onResolve, onMerge, onDisable }) {
  const { account, dinar, usd } = bucket
  const mergeTargets = activeAccounts.filter((target) => target.id !== account.id)

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{account.ownerName}</strong>
          <span>{account.notes || 'يحتاج تحديد طريقة التعامل معه.'}</span>
        </div>
        <b>{formatDisplayMeaning(account, dinar)}</b>
      </div>
      {Math.round(Math.abs(usd)) !== 0 ? <p className="ml3-review-usd">{money(usd, CURRENCIES.USD)}</p> : null}
      <form className="ml3-decision-grid" onSubmit={(event) => onResolve(event, account.id)}>
        <label>
          الاسم
          <input name="ownerName" defaultValue={account.ownerName} />
        </label>
        <label>
          الوصف
          <input name="subAccountName" defaultValue={displaySubAccountName(account.subAccountName)} />
        </label>
        <label>
          التصنيف
          <select name="classification" defaultValue={classificationValue(account)}>
            {accountClassificationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="ml3-decision-wide">
          ملاحظة القرار
          <input name="notes" defaultValue={account.notes || ''} placeholder="سبب التصنيف أو أي توضيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">اعتماد بهذا التصنيف</button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>إخفاء كغير مستخدم</button>
        </div>
      </form>
      <div className="ml3-merge-box">
        <label>
          دمج بدل إنشاء حساب مستقل
          <select defaultValue="" onChange={(event) => event.target.value && onMerge(account.id, event.target.value)}>
            <option value="">اختر حسابًا موجودًا للدمج</option>
            {mergeTargets.map((target) => (
              <option key={target.id} value={target.id}>{accountLabel(target)}</option>
            ))}
          </select>
        </label>
      </div>
    </article>
  )
}

function ExternalAccountCard({ account, onCreate, onIgnore }) {
  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{account.ownerName}</strong>
          <span>{account.notes}</span>
        </div>
        <b>اسم جديد</b>
      </div>
      <form className="ml3-decision-grid" onSubmit={(event) => onCreate(event, account)}>
        <label>
          الوصف
          <input name="subAccountName" defaultValue={displaySubAccountName(account.subAccountName)} />
        </label>
        <label>
          التصنيف
          <select name="classification" defaultValue={`${ACCOUNT_TYPES.PERSON}|${VALUE_KINDS.RECEIVABLE}`}>
            {accountClassificationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">إنشاء بهذا التصنيف</button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onIgnore(account)}>تجاهل الاسم</button>
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
        {errors.map((error) => <span key={`${movement.id}-${error.field}-${error.message}`}>{error.field}</span>)}
      </div>
      <form className="ml3-decision-grid ml3-decision-grid--movement" onSubmit={(event) => onResolve(event, movement, reviewDraft)}>
        <label>
          نوع الحركة
          <select value={reviewDraft.type} onChange={(event) => updateReviewDraft('type', event.target.value)}>
            {Object.entries(movementLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div>
          <NumericEntry label={reviewConfig.amountLabel || 'المبلغ'} value={reviewDraft.amount} onChange={(value) => updateReviewDraft('amount', value)} />
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
            <NumericEntry
              label={reviewConfig.rateLabel || 'سعر الصرف'}
              value={reviewDraft.rate}
              onChange={(value) => updateReviewDraft('rate', value)}
              placeholder="7.5"
              allowDecimal
            />
          </div>
        ) : null}
        {reviewNeedsSource ? (
        <div className="ml3-decision-wide">
          <AccountSearchSelect
            label={reviewConfig.sourceLabel || 'من'}
            value={reviewDraft.sourceAccountId || ''}
            accounts={reviewSourceAccounts}
            onChange={(value) => updateReviewDraft('sourceAccountId', value || '')}
            preferredAccountIds={movementPreferredAccountIds(reviewDraft.type, 'source')}
            balanceByAccountId={balanceByAccountId}
          />
        </div>
        ) : null}
        {reviewConfig.needsDestination ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect
              label={reviewConfig.destinationLabel || 'إلى'}
              value={reviewDraft.destinationAccountId || ''}
              accounts={reviewDestinationAccounts}
              onChange={(value) => updateReviewDraft('destinationAccountId', value || '')}
              preferredAccountIds={movementPreferredAccountIds(reviewDraft.type, 'destination')}
              balanceByAccountId={balanceByAccountId}
            />
          </div>
        ) : null}
        <label className="ml3-decision-wide">
          ملاحظة
          <input value={reviewDraft.note} onChange={(event) => updateReviewDraft('note', event.target.value)} placeholder="سبب الحركة أو التصحيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">إصلاح واعتماد</button>
          <button type="button" className="ml3-mini-action" onClick={() => onEdit(movement)}>فتح في الإدخال</button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onCancel(movement.id)}>إلغاء</button>
        </div>
      </form>
    </article>
  )
}

function AlertBoard({ reviewAccounts, reviewMovements, externalMissing, balances, movements, totals, dueRecurringCount = 0, reconciliationDiffCount = 0 }) {
  const alerts = buildLedgerAlerts({ reviewAccounts, reviewMovements, externalMissing, balances, movements, totals, dueRecurringCount, reconciliationDiffCount })
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

function OperationsPanel({
  reports,
  dueRules,
  attachments,
  reconciliations,
  onRunRecurring,
  onDisableRecurring,
}) {
  return (
    <section className="ml3-ops-grid">
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>مشاريع وأصول</strong>
          <span>{formatCount(reports.length)}</span>
        </div>
        {reports.length === 0 ? <p className="ml3-empty">لا توجد مراكز متابعة بعد.</p> : null}
        {reports.slice(0, 6).map((item) => (
          <div className="ml3-ops-row" key={item.dimension.id}>
            <span>{item.dimension.name}</span>
            <b className={(item.net || item.netUsd) >= 0 ? 'is-positive' : 'is-negative'}>{signedMoney(item.net)}</b>
            <small>دخل {money(item.income)} · مصروف {money(item.expense)}</small>
            {item.incomeUsd || item.expenseUsd ? (
              <small>دولار: دخل {money(item.incomeUsd, CURRENCIES.USD)} · مصروف {money(item.expenseUsd, CURRENCIES.USD)}</small>
            ) : null}
          </div>
        ))}
      </article>
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>متكرر</strong>
          <span>{formatCount(dueRules.length)}</span>
        </div>
        {dueRules.length === 0 ? <p className="ml3-empty">لا شيء مستحق.</p> : null}
        {dueRules.slice(0, 5).map((rule) => (
          <div className="ml3-ops-row" key={rule.id}>
            <span>{rule.name}</span>
            <div className="ml3-ops-actions">
              <button type="button" onClick={() => onRunRecurring(rule.id)}>تنفيذ</button>
              <button type="button" onClick={() => onDisableRecurring(rule.id)}>إيقاف</button>
            </div>
            <small>شهري · يمنع تكرار نفس الشهر</small>
          </div>
        ))}
      </article>
      <article className="ml3-ops-card">
        <div className="ml3-ops-head">
          <strong>حفظ وأدلة</strong>
          <span>{formatCount(attachments.length)}</span>
        </div>
        <p className="ml3-empty">المرفقات محفوظة كرابط/مرجع داخل الدفتر. الملفات نفسها تحتاج bucket آمن لاحقًا.</p>
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
  const [movementDraft, setMovementDraft] = useState(() => emptyMovementDraft())
  const [movementStep, setMovementStep] = useState(MOVEMENT_ENTRY_STEPS.TYPE)
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isHydrated, setIsHydrated] = useState(false)
  const [canPersist, setCanPersist] = useState(false)
  const [storageMode, setStorageMode] = useState(getMohammadPersistenceMode)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [, setSyncProblem] = useState(false)
  const [pendingUndo, setPendingUndo] = useState(null)
  const [activeReviewKey, setActiveReviewKey] = useState('')
  const [editingMovementId, setEditingMovementId] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyType, setHistoryType] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [historyAccountId, setHistoryAccountId] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [showZeroAccounts, setShowZeroAccounts] = useState(false)
  const todayPanelRef = useRef(null)

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

  const activeAccounts = useMemo(() => getActivePostingAccounts(accounts), [accounts])
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const balances = useMemo(() => summarizeBalances(accounts, movements), [accounts, movements])
  const balanceByAccountId = useMemo(() => new Map(balances.map((bucket) => [bucket.account.id, bucket])), [balances])
  const selectedAccountPreset = accountPresetFor(accountDraft.type, accountDraft.valueKind)
  const selectedAccountDetails = accountDetailOptionsFor(accountDraft.type, accountDraft.valueKind)
  const accountDraftNameValue = accountNameValue(accountDraft)
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
      else if (kind === VALUE_KINDS.ASSET) groups.assets.push(bucket)
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
    return !accounts.some(
        (account) =>
          account.ownerName === externalAccount.ownerName &&
          account.subAccountName === externalAccount.subAccountName &&
          account.status !== ACCOUNT_STATUSES.INACTIVE,
      )
  })
  const reviewItems = useMemo(() => {
    const accountItems = (balancesByKind.review || []).map((bucket) => ({
      key: `account:${bucket.account.id}`,
      type: 'account',
      label: bucket.account.ownerName,
      detail: displaySubAccountName(bucket.account.subAccountName),
      tone: 'danger',
      bucket,
    }))
    const externalItems = unresolvedExternalAccounts.map((account) => ({
      key: `external:${account.id}`,
      type: 'external',
      label: account.ownerName,
      detail: displaySubAccountName(account.subAccountName),
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
  const postedUserMovements = movements.filter((movement) => !movement.id?.startsWith('opening-')).slice().reverse()
  const filteredHistoryMovements = useMemo(() => {
    const normalizedQuery = historyQuery.trim().toLowerCase()
    return postedUserMovements.filter((movement) => {
      if (historyType && movement.type !== historyType) return false
      if (historyStatus && movement.status !== historyStatus) return false
      if (historyAccountId && movement.sourceAccountId !== historyAccountId && movement.destinationAccountId !== historyAccountId) return false
      if (!normalizedQuery) return true
      const source = accountById.get(movement.sourceAccountId)
      const destination = accountById.get(movement.destinationAccountId)
      const haystack = [
        movementLabels[movement.type],
        movementStatusLabel(movement.status),
        movement.note,
        source ? accountLabel(source) : '',
        destination ? accountLabel(destination) : '',
      ].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [accountById, historyAccountId, historyQuery, historyStatus, historyType, postedUserMovements])
  const todayMovements = postedUserMovements.filter((movement) => isToday(movement.createdAt || movement.updatedAt))
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
      { cash: 0, bank: 0, peopleOweMe: 0, iOwePeople: 0, assets: 0, expenses: 0, usd: 0 },
    )
  }, [balances])

  const movementConfig = movementConfigFor(movementDraft.type)
  const movementSourceRequired = movementNeedsSource(movementDraft.type)
  const movementUsesDimension = movementSupportsDimension(movementDraft.type)
  const normalizedDraft = {
    ...movementDraft,
    amount: parseWholeAmount(movementDraft.amount),
    currency: movementConfig.currency || movementDraft.currency,
    sourceAccountId: movementSourceRequired ? movementDraft.sourceAccountId : null,
    destinationAccountId: movementConfig.needsDestination ? movementDraft.destinationAccountId : null,
    rate: movementDraft.rate === '' ? undefined : Number(movementDraft.rate),
    dimensionId: movementUsesDimension ? movementDraft.dimensionId || '' : '',
  }
  const preview = previewMovement(normalizedDraft, accounts, movements)
  const hasMovementAmount = Number.isFinite(normalizedDraft.amount) && normalizedDraft.amount > 0
  const hasMovementRate = !movementConfig.needsRate || (Number.isFinite(normalizedDraft.rate) && normalizedDraft.rate > 0)
  const canChooseMovementAccounts = hasMovementAmount && hasMovementRate
  const selectedSourceAccount = accountById.get(movementDraft.sourceAccountId)
  const selectedDestinationAccount = accountById.get(movementDraft.destinationAccountId)
  const activeDimensions = useMemo(() => dimensionsFromAccounts(accounts, ledgerExtras.dimensions), [accounts, ledgerExtras.dimensions])
  const dimensionReports = useMemo(
    () => buildDimensionReports({ ...ledgerExtras, accounts, movements }),
    [accounts, movements, ledgerExtras],
  )
  const dueRules = useMemo(() => dueRecurringRules(ledgerExtras.recurringRules), [ledgerExtras.recurringRules])
  const reconciliationDiffCount = useMemo(
    () => (ledgerExtras.reconciliations || []).filter((item) =>
      Math.round(Number(item.actualDinar || 0)) !== Math.round(Number(item.expectedDinar || 0)) ||
      Math.round(Number(item.actualUsd || 0)) !== Math.round(Number(item.expectedUsd || 0)),
    ).length,
    [ledgerExtras.reconciliations],
  )
  const hasMovementAccounts =
    (!movementSourceRequired || Boolean(movementDraft.sourceAccountId)) &&
    (!movementConfig.needsDestination || Boolean(movementDraft.destinationAccountId)) &&
    (!movementConfig.needsDestination || !selectedSourceAccount || !sameLogicalAccount(selectedSourceAccount, selectedDestinationAccount))
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
      setLedgerExtras(ledgerExtrasFromState(normalizedState))
      setAccounts(normalizeMohammadAccounts(normalizedState.accounts))
      setMovements(normalizedState.movements)
      setSaveStatus(result.loadError ? 'local-only' : 'saved')
      setSyncProblem(Boolean(result.loadError))
      setCanPersist(!result.loadError && result.mode !== 'api-missing-token')
      setIsHydrated(true)
      if (result.loadError) {
        setFeedback(result.mode === 'api-missing-token'
          ? 'رابط الدفتر ناقص. افتح الرابط الخاص أو صفحة الإدارة.'
          : 'السحابة غير جاهزة الآن. لم يتم استخدام أي نسخة محلية.')
      }
    }

    hydrateLedger()
    return () => {
      cancelled = true
    }
  }, [initialState])

  useEffect(() => {
    if (!isHydrated || !canPersist) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) setSaveStatus('saving')
    }, 0)

    saveMohammadPersistedState({ ...ledgerExtras, accounts, movements })
      .then((result) => {
        if (cancelled) return
        setStorageMode(result.mode)
        const hasSyncProblem = (result.mode === 'supabase' || result.mode === 'api' || result.mode === 'api-missing-token') && !result.supabaseOk
        setSyncProblem(hasSyncProblem)
        setSaveStatus(result.supabaseOk ? 'saved' : (hasSyncProblem ? 'local-only' : 'local'))
        if (result.state) {
          const normalizedState = normalizeLedgerState(result.state, { ...ledgerExtras, accounts, movements })
          const nextExtras = ledgerExtrasFromState(normalizedState)
          const mergedAccounts = normalizeMohammadAccounts(normalizedState.accounts)
          const mergedMovements = normalizedState.movements || []
          if (!sameLedgerExtras(ledgerExtras, nextExtras)) setLedgerExtras(nextExtras)
          if (!sameRecordVersions(accounts, mergedAccounts)) setAccounts(mergedAccounts)
          if (!sameRecordVersions(movements, mergedMovements)) setMovements(mergedMovements)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[mohammad-ledger] save failed:', err?.message || err)
        setSyncProblem(true)
        setSaveStatus('local-only')
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [accounts, movements, ledgerExtras, isHydrated, canPersist])

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
    const nextKey = reviewItems.length && reviewItems.some((item) => item.key === activeReviewKey)
      ? activeReviewKey
      : (reviewItems[0]?.key || '')
    if (nextKey === activeReviewKey) return undefined
    const timer = window.setTimeout(() => setActiveReviewKey(nextKey), 0)
    return () => window.clearTimeout(timer)
  }, [activeSection, activeReviewKey, reviewItems])

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
    const defaults = movementDefaultsFor(type)
    setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    setMovementDraft((current) => ({
      ...current,
      type,
      currency: config.currency || current.currency,
      sourceAccountId: movementNeedsSource(type) ? defaults.sourceAccountId : '',
      destinationAccountId: config.needsDestination ? defaults.destinationAccountId : '',
      rate: config.needsRate ? current.rate : '',
      dimensionId: movementSupportsDimension(type) ? current.dimensionId : '',
    }))
  }

  function nextMovementStep(step = movementStep) {
    const firstAccountStep = movementSourceRequired
      ? MOVEMENT_ENTRY_STEPS.SOURCE
      : (movementConfig.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : MOVEMENT_ENTRY_STEPS.NOTE)
    if (step === MOVEMENT_ENTRY_STEPS.TYPE) return MOVEMENT_ENTRY_STEPS.AMOUNT
    if (step === MOVEMENT_ENTRY_STEPS.AMOUNT) return movementConfig.currencyLocked
      ? (movementConfig.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : firstAccountStep)
      : MOVEMENT_ENTRY_STEPS.CURRENCY
    if (step === MOVEMENT_ENTRY_STEPS.CURRENCY) return movementConfig.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : firstAccountStep
    if (step === MOVEMENT_ENTRY_STEPS.RATE) return firstAccountStep
    if (step === MOVEMENT_ENTRY_STEPS.SOURCE) return movementConfig.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : MOVEMENT_ENTRY_STEPS.NOTE
    if (step === MOVEMENT_ENTRY_STEPS.DESTINATION) return MOVEMENT_ENTRY_STEPS.NOTE
    if (step === MOVEMENT_ENTRY_STEPS.NOTE) return MOVEMENT_ENTRY_STEPS.REVIEW
    return MOVEMENT_ENTRY_STEPS.REVIEW
  }

  function advanceMovementStep() {
    setMovementStep((current) => nextMovementStep(current))
  }

  function editMovementStep(step) {
    setMovementStep(step)
  }

  function movementAccountsFor(role) {
    return getMovementAccounts(accounts, balanceByAccountId, movementDraft.type, role, movementDraft)
  }

  function preferredMovementAccountIds(role) {
    return movementPreferredAccountIds(movementDraft.type, role)
  }

  const visibleMovementSteps = movementVisibleSteps(movementConfig, movementSourceRequired)
  const currentMovementStepIndex = Math.max(0, visibleMovementSteps.indexOf(movementStep))
  const movementProgressText = `${formatCount(currentMovementStepIndex + 1)}/${formatCount(visibleMovementSteps.length)}`

  function movementStepNumber(step) {
    const visibleSteps = visibleMovementSteps
    const index = visibleSteps.indexOf(step)
    return index >= 0 ? index + 1 : step
  }

  function chooseAccountPreset(preset) {
    setAccountDraft((current) => ({
      ...current,
      ownerName: preset.ownerName || '',
      type: preset.type,
      valueKind: preset.valueKind,
      subAccountName: preset.subAccountName,
      currencyKind: accountNeedsCurrency(preset) ? current.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR : ACCOUNT_CURRENCY_KINDS.DINAR,
    }))
  }

  function saveMovement(event) {
    event.preventDefault()
    const originalMovement = editingMovementId ? movements.find((movement) => movement.id === editingMovementId) : null
    const validationMovements = originalMovement
      ? movements.filter((movementItem) => movementItem.id !== originalMovement.id)
      : movements
    const movement = postMovement(
      {
        ...originalMovement,
        ...normalizedDraft,
        id: originalMovement?.id,
        createdAt: originalMovement?.createdAt,
        note: movementDraft.note.trim(),
        dimensionId: movementSupportsDimension(movementDraft.type) ? movementDraft.dimensionId || '' : '',
      },
      accounts,
      validationMovements,
    )
    if (!canCommitMovementEdit(originalMovement, movement)) {
      setFeedback(`لم يتم حفظ التعديل. أصلح الحركة أولًا حتى لا يتغير الرصيد: ${movement.validation.errors.map((error) => error.message).join(' ')}`)
      return
    }
    setMovements((current) =>
      originalMovement
        ? current.map((item) => (item.id === originalMovement.id ? movement : item))
        : [...current, movement],
    )
    setFeedback(movement.status === MOVEMENT_STATUSES.POSTED ? (originalMovement ? 'تم تعديل الحركة وتحديث الأرصدة.' : 'تم الحفظ وتحديث الأرصدة.') : 'الحركة ناقصة وتحتاج مراجعة.')
    const attachment = createAttachment({
      movementId: movement.id,
      label: movementDraft.attachmentLabel,
      url: movementDraft.attachmentUrl,
    })
    const recurringRule = movementDraft.recurringEnabled && movement.status === MOVEMENT_STATUSES.POSTED
      ? createRecurringRuleFromMovement(movement, { frequency: movementDraft.recurringFrequency })
      : null
    setLedgerExtras((current) => ({
      ...current,
      attachments: attachment ? [...(current.attachments || []), attachment] : current.attachments,
      recurringRules: recurringRule ? [...(current.recurringRules || []), recurringRule] : current.recurringRules,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent(originalMovement ? 'movement.updated' : 'movement.created', {
          movementId: movement.id,
          status: movement.status,
        }),
      ],
    }))
    setPendingUndo({
      movementId: movement.id,
      label: `${movementLabels[movement.type] || 'حركة'} · ${money(movement.amount, movement.currency)}`,
    })
    if (movement.status === MOVEMENT_STATUSES.POSTED || originalMovement) {
      setEditingMovementId('')
      setMovementDraft(emptyMovementDraft(movementDraft.type))
      setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
    }
  }

  function cancelMovement(movementId) {
    const target = movements.find((movement) => movement.id === movementId)
    if (target?.status === MOVEMENT_STATUSES.POSTED && !canCancelMovement(target)) {
      setFeedback(`الإلغاء المباشر متاح فقط خلال آخر ${formatCount(CANCEL_WINDOW_HOURS)} ساعة. للحركات القديمة استخدم حركة تصحيح.`)
      return
    }
    setMovements((current) =>
      current.map((movement) => {
        if (movement.id !== movementId) return movement
        if (movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW) {
          return {
            ...movement,
            status: MOVEMENT_STATUSES.VOIDED,
            voidReason: 'إلغاء حركة ناقصة',
            voidedAt: new Date().toISOString(),
          }
        }
        const result = voidMovement(movement, 'إلغاء من سجل الحركات')
        return result.ok ? result.movement : movement
      }),
    )
    setPendingUndo((current) => (current?.movementId === movementId ? null : current))
    setFeedback('تم إلغاء الحركة وبقيت في السجل.')
  }

  function undoPendingMovement() {
    if (!pendingUndo?.movementId) return
    cancelMovement(pendingUndo.movementId)
  }

  function addAccount(event) {
    event.preventDefault()
    const account = createAccount(accountDraft)
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('account.created', { accountId: account.id }),
      ],
    }))
    setFeedback('تم إنشاء الحساب.')
    setAccountDraft(emptyAccountDraft())
  }

  function resolveReviewAccount(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const classification = parseClassification(formData.get('classification'))
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      type: classification.type,
      valueKind: classification.valueKind,
      notes: String(formData.get('notes') || '').trim(),
    }

    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            status: ACCOUNT_STATUSES.ACTIVE,
            reviewedAt: new Date().toISOString(),
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(candidate, accounts.filter((account) => account.id !== accountId))
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts(candidateAccounts)
    setFeedback('تم حل الحساب واعتماده.')
  }

  function updateAccountClassification(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const classification = parseClassification(formData.get('classification'))
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      type: classification.type,
      valueKind: classification.valueKind,
    }
    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            updatedAt: new Date().toISOString(),
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(candidate, accounts.filter((account) => account.id !== accountId))
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts(candidateAccounts)
    setFeedback('تم تعديل الحساب.')
  }

  function reconcileAccount(event, accountId, currentDinar, currentUsd) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const actualDinar = parseWholeAmount(formData.get('actualDinar'))
    const actualUsd = parseWholeAmount(formData.get('actualUsd'))
    const note = String(formData.get('note') || '').trim()
    if (!note) {
      setFeedback('المطابقة تحتاج ملاحظة واضحة.')
      return
    }
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
        createAuditEvent('account.reconciled', { accountId, reconciliationId: record.id }),
      ],
    }))
    if (!nextMovements.length) {
      setFeedback('تم حفظ المطابقة بدون تصحيح.')
      return
    }
    setFeedback(nextMovements.every((movement) => movement.status === MOVEMENT_STATUSES.POSTED) ? 'تم إنشاء تصحيح الرصيد.' : 'تم حفظ التصحيح في المراجعة.')
  }

  function addAccountAttachment(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const attachment = createAttachment({
      accountId,
      label: formData.get('attachmentLabel'),
      url: formData.get('attachmentUrl'),
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
        createAuditEvent('attachment.created', { accountId, attachmentId: attachment.id }),
      ],
    }))
    event.currentTarget.reset()
    setFeedback('تم ربط المرفق بالحساب.')
  }

  function runRecurring(ruleId) {
    const rule = (ledgerExtras.recurringRules || []).find((item) => item.id === ruleId)
    if (!rule) return
    const result = runRecurringRule(rule, accounts, movements)
    setMovements((current) => {
      if (current.some((movement) => movement.id === result.movement.id)) return current
      return [...current, result.movement]
    })
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) => (item.id === ruleId ? result.rule : item)),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('recurring.executed', { ruleId, movementId: result.movement.id }),
      ],
    }))
    setFeedback(result.movement.status === MOVEMENT_STATUSES.POSTED ? 'تم تنفيذ الحركة المتكررة.' : 'تم حفظ الحركة المتكررة في المراجعة.')
  }

  function disableRecurring(ruleId) {
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) =>
        item.id === ruleId ? disableRecurringRule(item) : item,
      ),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('recurring.disabled', { ruleId }),
      ],
    }))
    setFeedback('تم إيقاف الحركة المتكررة.')
  }

  function disableAccount(accountId) {
    const bucket = balanceByAccountId.get(accountId)
    if (bucket && nonZero(bucket)) {
      setFeedback('لا يمكن إخفاء حساب عليه رصيد. صفّر الرصيد أو ادمجه أولًا.')
      return
    }
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? {
              ...account,
              status: ACCOUNT_STATUSES.INACTIVE,
              disabledAt: new Date().toISOString(),
            }
          : account,
      ),
    )
    setFeedback('تم إخفاء الحساب.')
  }

  function mergeReviewAccount(sourceAccountId, targetAccountId) {
    if (!targetAccountId || sourceAccountId === targetAccountId) return
    const candidateMovements = movements.map((movement) => ({
      ...movement,
      sourceAccountId: movement.sourceAccountId === sourceAccountId ? targetAccountId : movement.sourceAccountId,
      destinationAccountId: movement.destinationAccountId === sourceAccountId ? targetAccountId : movement.destinationAccountId,
      mergedFromAccountId: movement.sourceAccountId === sourceAccountId || movement.destinationAccountId === sourceAccountId ? sourceAccountId : movement.mergedFromAccountId,
    }))
    const candidateAccounts = accounts.map((account) =>
      account.id === sourceAccountId
        ? { ...account, status: ACCOUNT_STATUSES.INACTIVE, mergedIntoAccountId: targetAccountId, updatedAt: new Date().toISOString() }
        : account,
    )
    const invalidMovement = candidateMovements.find((movement) => {
      if (movement.status !== MOVEMENT_STATUSES.POSTED) return false
      if (movement.sourceAccountId !== targetAccountId && movement.destinationAccountId !== targetAccountId) return false
      return !validateMovement(movement, candidateAccounts, candidateMovements.filter((item) => item.id !== movement.id)).ok
    })
    if (invalidMovement) {
      setFeedback('لم يتم الدمج. الحساب المختار لا يناسب عملة أو نوع بعض الحركات المرتبطة.')
      return
    }
    setMovements((current) =>
      current.map((movement) => candidateMovements.find((candidate) => candidate.id === movement.id) || movement),
    )
    setAccounts((current) =>
      current.map((account) => candidateAccounts.find((candidate) => candidate.id === account.id) || account),
    )
    setFeedback('تم دمج الحساب.')
  }

  function addExternalAccount(event, externalAccount) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const classification = parseClassification(formData.get('classification'))
    const account = createAccount({
      ownerName: externalAccount.ownerName,
      subAccountName: String(formData.get('subAccountName') || externalAccount.subAccountName).trim(),
      type: classification.type,
      valueKind: classification.valueKind,
      notes: externalAccount.notes,
    })
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), externalAccountKey(externalAccount)])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.created', { accountId: account.id, externalAccountId: externalAccount.id }),
      ],
    }))
    setFeedback(`تم إنشاء حساب ${externalAccount.ownerName}.`)
  }

  function ignoreExternalAccount(externalAccount) {
    const key = externalAccountKey(externalAccount)
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), key])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.ignored', { externalAccountId: key }),
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
    setActiveSection('entry')
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
        amount: parseWholeAmount(reviewDraft.amount),
        currency: config.currency || reviewDraft.currency,
        sourceAccountId: movementNeedsSource(reviewDraft.type) ? reviewDraft.sourceAccountId || null : null,
        destinationAccountId: config.needsDestination ? reviewDraft.destinationAccountId || null : null,
        rate: reviewDraft.rate === '' ? undefined : Number(reviewDraft.rate),
        note: String(reviewDraft.note || '').trim(),
        dimensionId: movementSupportsDimension(reviewDraft.type) ? movement.dimensionId || '' : '',
      },
      accounts,
      movements.filter((item) => item.id !== movement.id),
    )
    setMovements((current) => current.map((item) => (item.id === movement.id ? candidate : item)))
    setFeedback(candidate.status === MOVEMENT_STATUSES.POSTED ? 'تم إصلاح الحركة.' : 'ما زالت ناقصة.')
  }

  function renderAccountsSection() {
    const activeGroup = accountGroupTabs.find((group) => group.key === activeAccountGroup) || accountGroupTabs[0]
    const moneyRows = balancesByKind.money || []
    const peopleRows = balancesByKind.people || []
    const normalizedAccountQuery = accountQuery.trim().toLowerCase()
    const accountMatchesQuery = (bucket) => {
      if (!normalizedAccountQuery) return true
      const haystack = `${bucket.account.ownerName} ${bucket.account.subAccountName} ${displaySubAccountName(bucket.account.subAccountName)} ${bucket.account.legacyName || ''}`.toLowerCase()
      return haystack.includes(normalizedAccountQuery)
    }
    const filterRows = (rows) => rows.filter(accountMatchesQuery)
    const peoplePositive = filterRows(peopleRows).filter((bucket) => Math.round(bucket.dinar) > 0).sort(compareBalanceBuckets)
    const peopleNegative = filterRows(peopleRows).filter((bucket) => Math.round(bucket.dinar) < 0).sort(compareBalanceBuckets)
    const peopleZero = filterRows(peopleRows).filter((bucket) => !nonZero(bucket)).sort(compareBalanceBuckets)
    const accountRowsByGroup = {
      people: [...peoplePositive, ...peopleNegative, ...(showZeroAccounts ? peopleZero : [])],
      money: filterRows(moneyRows),
      assets: filterRows(balancesByKind.assets || []),
      expenses: filterRows(balancesByKind.expenses || []),
      review: filterRows(balancesByKind.review || []),
    }
    const rows = accountRowsByGroup[activeGroup.key] || []
    return (
      <section className="ml3-panel ml3-balances-surface">
        <div className="ml3-panel-head">
          <div>
            <h2>الأرصدة</h2>
            <p>{activeGroup.title} · {formatCount(rows.length)} عنصر</p>
          </div>
          <span>{formatCount(balances.length)}</span>
        </div>

        <div className="ml3-balance-ledger" aria-label="ملخص الأرصدة">
          <button type="button" className="is-money" onClick={() => setActiveAccountGroup('money')}>
            <span>فلوسي</span>
            <strong>{money(totals.cash + totals.bank)}</strong>
          </button>
          <button type="button" className="is-positive" onClick={() => setActiveAccountGroup('people')}>
            <span>أقبض</span>
            <strong>{money(totals.peopleOweMe)}</strong>
          </button>
          <button type="button" className="is-negative" onClick={() => setActiveAccountGroup('people')}>
            <span>أدفع</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
          <button type="button" className="is-review" onClick={() => setActiveAccountGroup('review')}>
            <span>مراجعة</span>
            <strong>{formatCount(accountRowsByGroup.review.length)}</strong>
          </button>
        </div>

        <div className="ml3-account-toolbar">
          <label>
            بحث
            <input
              value={accountQuery}
              onChange={(event) => setAccountQuery(event.target.value)}
              placeholder="اسم، كاش، مصرف..."
            />
          </label>
          <button
            type="button"
            className={showZeroAccounts ? 'is-active' : ''}
            onClick={() => setShowZeroAccounts((current) => !current)}
          >
            صفر · {formatCount(peopleZero.length)}
          </button>
        </div>

        <div className="ml3-account-switcher" aria-label="أنواع الأرصدة">
          {accountGroupTabs.map((group) => (
            <button
              type="button"
              key={group.key}
              className={`ml3-account-switcher--${group.key} ${activeAccountGroup === group.key ? 'is-active' : ''}`}
              onClick={() => setActiveAccountGroup(group.key)}
            >
              <strong>{group.label}</strong>
              <span>{formatCount(accountRowsByGroup[group.key]?.length || 0)}</span>
            </button>
          ))}
        </div>
        {activeGroup.key === 'people' ? (
          <div className="ml3-account-sections">
            <AccountList title="أقبض منهم" rows={peoplePositive} onOpen={setSelectedAccountId} embedded />
            <AccountList title="أدفع لهم" rows={peopleNegative} onOpen={setSelectedAccountId} embedded />
            {showZeroAccounts ? <AccountList title="صفر" rows={peopleZero} onOpen={setSelectedAccountId} embedded /> : null}
          </div>
        ) : activeGroup.key === 'money' ? (
          <AccountList title="فلوسي عندي" rows={rows} onOpen={setSelectedAccountId} embedded />
        ) : (
          <AccountList
            title={activeGroup.title}
            rows={rows}
            onOpen={setSelectedAccountId}
            embedded
          />
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
                <button
                  type="button"
                  key={item.key}
                  className={`ml3-review-ticket ml3-review-ticket--${item.tone} ${activeReviewItem?.key === item.key ? 'is-active' : ''}`}
                  onClick={() => setActiveReviewKey(item.key)}
                >
                  <span>{formatCount(index + 1)}</span>
                  <strong>{item.label}</strong>
                  <b>{item.detail}</b>
                </button>
              ))}
            </div>
          <div className="ml3-review-active">
              {activeReviewItem?.type === 'account' ? (
                <ReviewAccountCard
                  key={activeReviewItem.bucket.account.id}
                  bucket={activeReviewItem.bucket}
                  activeAccounts={activeAccounts}
                  onResolve={resolveReviewAccount}
                  onMerge={mergeReviewAccount}
                  onDisable={disableAccount}
                />
              ) : null}
              {activeReviewItem?.type === 'external' ? (
                <ExternalAccountCard key={activeReviewItem.account.id} account={activeReviewItem.account} onCreate={addExternalAccount} onIgnore={ignoreExternalAccount} />
              ) : null}
              {activeReviewItem?.type === 'movement' ? (
                <ReviewMovementCard
                  key={activeReviewItem.movement.id}
                  movement={activeReviewItem.movement}
                  activeAccounts={activeAccounts}
                  balanceByAccountId={balanceByAccountId}
                  onResolve={resolveReviewMovement}
                  onEdit={editReviewMovement}
                  onCancel={cancelMovement}
                />
              ) : null}
            </div>
          </div>
          <OperationsPanel
            reports={dimensionReports}
            dueRules={dueRules}
            attachments={ledgerExtras.attachments || []}
            reconciliations={ledgerExtras.reconciliations || []}
            onRunRecurring={runRecurring}
            onDisableRecurring={disableRecurring}
          />
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
          <div className="ml3-history-filters" aria-label="فلترة الحركات">
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="بحث باسم أو ملاحظة"
            />
            <select value={historyType} onChange={(event) => setHistoryType(event.target.value)}>
              <option value="">كل الأنواع</option>
              {movementTypeOptions.map((option) => (
                <option key={option.type} value={option.type}>{option.label}</option>
              ))}
              <option value={MOVEMENT_TYPES.CORRECTION}>تعديل رصيد</option>
            </select>
            <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
              <option value="">كل الحالات</option>
              <option value={MOVEMENT_STATUSES.POSTED}>تم</option>
              <option value={MOVEMENT_STATUSES.NEEDS_REVIEW}>ناقص</option>
              <option value={MOVEMENT_STATUSES.VOIDED}>ملغي</option>
            </select>
            <select value={historyAccountId} onChange={(event) => setHistoryAccountId(event.target.value)}>
              <option value="">كل الحسابات</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </div>
          <div className="ml3-history-list">
            {filteredHistoryMovements.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
            {filteredHistoryMovements.map((movement) => (
              <HistoryMovementRow
                key={movement.id}
                movement={movement}
                accountById={accountById}
                attachments={ledgerExtras.attachments || []}
                dimensions={activeDimensions}
                onCancel={cancelMovement}
              />
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
            <p>
              {reviewMovements.length || balancesByKind.review.length
                ? 'ابدأ من قسم المراجعة قبل إدخال حركات جديدة كثيرة.'
                : 'افتح قسم الإدخال للحركة الجديدة، واترك الأرصدة للعرض والمراجعة فقط.'}
            </p>
          </div>
          <button type="button" onClick={() => setActiveSection(reviewMovements.length || balancesByKind.review.length ? 'review' : 'entry')}>
            {reviewMovements.length || balancesByKind.review.length ? 'فتح المراجعة' : 'إضافة حركة'}
          </button>
        </div>

        <div className="ml3-home-grid">
          <button type="button" className="ml3-home-card is-positive" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('people') }}>
            <span>أقبض من الناس</span>
            <strong>{money(totals.peopleOweMe)}</strong>
          </button>
          <button type="button" className="ml3-home-card is-negative" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('people') }}>
            <span>أدفع لهم</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
          <button type="button" className="ml3-home-card is-money" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('money') }}>
            <span>أماكن الفلوس</span>
            <strong>{formatCount(balancesByKind.money.length)} حساب</strong>
          </button>
          <button type="button" className="ml3-home-card is-review" onClick={() => setActiveSection('review')}>
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
            {balancesByKind.people.filter(nonZero).slice(0, 6).map((bucket) => (
              <AccountRow key={bucket.account.id} bucket={bucket} onOpen={setSelectedAccountId} />
            ))}
          </div>
        </section>
      </section>
    )
  }

  const storageText = storageTextForStatus(saveStatus, storageMode)
  const canLogout = storageMode === 'api'
  const canOpenAdmin = storageMode === 'api'
  const activeSectionTitle = sectionTitles[activeSection] || 'ADREEM'
  const movementReceipt = [
    { key: 'type', label: 'الحركة', value: movementLabels[movementDraft.type] },
    { key: 'amount', label: 'المبلغ', value: movementDraft.amount ? money(movementDraft.amount, movementConfig.currency || movementDraft.currency) : 'لم يدخل' },
    { key: 'source', label: movementConfig.sourceLabel || 'من', value: draftSourceAccount ? accountLabel(draftSourceAccount) : (movementSourceRequired ? 'اختر' : 'بدون') },
    { key: 'destination', label: movementConfig.destinationLabel || 'إلى', value: draftDestinationAccount ? accountLabel(draftDestinationAccount) : (movementConfig.needsDestination ? 'اختر' : 'بدون') },
  ]

  return (
    <main className={`adreem-app adreem-app--${activeSection}`} dir="rtl">
      <section className="adreem-shell">
        <header className="adreem-header">
          <div className="adreem-brand">
            <span className="adreem-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32">
                <rect x="7" y="5" width="18" height="22" rx="4" />
                <path d="M12 12h8M12 16h8M12 20h5" />
                <circle cx="23" cy="23" r="5" />
              </svg>
            </span>
            <div>
              <span>ADREEM</span>
              <h1>{activeSectionTitle}</h1>
            </div>
          </div>
          <div className={`adreem-status ${canLogout || canOpenAdmin ? 'has-cloud-actions' : ''}`}>
            <b className={`ml3-save-state ml3-save-state--${saveStatus}`}>{storageText}</b>
            <b>اليوم {formatCount(todayMovements.length)}</b>
            <b>مراجعة {formatCount(reviewItems.length)}</b>
            {canOpenAdmin ? <button type="button" className="adreem-admin-open" onClick={openAdminUsersPage}>إدارة</button> : null}
            {canLogout ? <button type="button" className="adreem-logout" onClick={logoutFromCloudSession}>خروج</button> : null}
          </div>
        </header>

        <nav className="adreem-nav" aria-label="أقسام الدفتر">
          {sectionTabs.map((tab) => (
            <button
              type="button"
              className={activeSection === tab.key ? 'is-active' : ''}
              key={tab.key}
              onClick={() => setActiveSection(tab.key)}
            >
              <span aria-hidden="true">{tab.mark}</span>
              <strong>{tab.label}</strong>
            </button>
          ))}
        </nav>

        {activeSection !== 'entry' ? (
          <AlertBoard
            reviewAccounts={balancesByKind.review}
            reviewMovements={reviewMovements}
            externalMissing={unresolvedExternalAccounts}
            balances={balances}
            movements={postedUserMovements}
            totals={totals}
            dueRecurringCount={dueRules.length}
            reconciliationDiffCount={reconciliationDiffCount}
          />
        ) : null}

        <section className={`ml3-layout ${activeSection === 'entry' ? 'is-entry' : 'is-content-only'}`}>
          {activeSection === 'entry' ? (
          <aside className="adreem-entry">
            <section className="adreem-receipt" aria-label="ملخص الحركة الحالي">
              <div className="adreem-receipt-head">
                <span>{activeEntryMode === 'movement' ? 'ملخص الحركة' : 'ملخص الحساب'}</span>
                <strong>{activeEntryMode === 'movement' ? movementProgressText : 'جديد'}</strong>
              </div>
              {activeEntryMode === 'movement' ? (
                movementReceipt.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => {
                      const targetStep = {
                        type: MOVEMENT_ENTRY_STEPS.TYPE,
                        amount: MOVEMENT_ENTRY_STEPS.AMOUNT,
                        source: MOVEMENT_ENTRY_STEPS.SOURCE,
                        destination: MOVEMENT_ENTRY_STEPS.DESTINATION,
                      }[item.key]
                      const targetIndex = visibleMovementSteps.indexOf(targetStep)
                      if (targetIndex >= 0 && targetIndex <= currentMovementStepIndex) editMovementStep(targetStep)
                    }}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </button>
                ))
              ) : (
                <>
                  <button type="button">
                    <span>التصنيف</span>
                    <strong>{selectedAccountPreset.title}</strong>
                  </button>
                  <button type="button">
                    <span>الاسم</span>
                    <strong>{accountDraftNameValue || 'اكتب الاسم'}</strong>
                  </button>
                </>
              )}
            </section>
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
                <button type="button" onClick={() => { setEditingMovementId(''); setMovementDraft(emptyMovementDraft(movementDraft.type)); setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE); setFeedback('تم ترك التعديل بدون تغيير الحركة.') }}>ترك</button>
              </div>
            ) : null}
            <div className="ml3-entry-mode">
              <button
                type="button"
                className={activeEntryMode === 'movement' ? 'is-active' : ''}
                onClick={() => setActiveEntryMode('movement')}
              >
                إدخال حركة
              </button>
              <button
                type="button"
                className={activeEntryMode === 'account' ? 'is-active' : ''}
                onClick={() => setActiveEntryMode('account')}
              >
                حساب جديد
              </button>
            </div>
            {activeEntryMode === 'movement' ? (
            <form className={`ml3-entry-card ml3-entry-card--movement ml3-entry-card--${movementTone(movementDraft.type)}`} onSubmit={saveMovement}>
              <div className="ml3-entry-head">
                <div>
                  <span>إدخال حركة · {movementProgressText}</span>
                  <h2>{movementLabels[movementDraft.type]}</h2>
                </div>
                <b>{preview.validation.ok ? 'جاهزة' : 'ناقصة'}</b>
              </div>
              <div className="ml3-step-meter" aria-label="تقدم الإدخال">
                {visibleMovementSteps.map((step) => (
                  <span
                    key={step}
                    className={step < movementStep ? 'is-done' : step === movementStep ? 'is-current' : ''}
                  />
                ))}
              </div>

              {movementStep > MOVEMENT_ENTRY_STEPS.TYPE ? (
                <section className="ml3-step ml3-step--type is-done">
                  <div className="ml3-step-head">
                    <span>1</span>
                    <strong>الحركة</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{movementLabels[movementDraft.type]}</b>
                </section>
              ) : (
              <section className="ml3-step ml3-step--type is-open">
                <div className="ml3-step-head">
                  <span>1</span>
                  <strong>نوع الحركة</strong>
                </div>
                <div className="ml3-quick-actions">
                  {movementTypeOptions.map((option) => (
                    <button
                      type="button"
                      className={`ml3-action-choice ml3-action-choice--${option.tone} ${movementDraft.type === option.type ? 'is-active' : ''}`}
                      key={option.type}
                      onClick={() => chooseMovementType(option.type)}
                    >
                      <strong>{option.label}</strong>
                    </button>
                  ))}
                </div>
              </section>
              )}

              {movementStep > MOVEMENT_ENTRY_STEPS.AMOUNT ? (
                <section className="ml3-step ml3-step--amount is-done">
                  <div className="ml3-step-head">
                    <span>2</span>
                    <strong>المبلغ</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{money(movementDraft.amount, movementConfig.currency || movementDraft.currency)}</b>
                </section>
              ) : null}

              {movementStep === MOVEMENT_ENTRY_STEPS.AMOUNT ? (
              <section className="ml3-step ml3-step--amount is-open">
                <div className="ml3-step-head">
                  <span>2</span>
                  <strong>المبلغ</strong>
                </div>
                <div className="ml3-field-pair is-single">
                  <NumericEntry
                    label={movementConfig.amountLabel}
                    value={movementDraft.amount}
                    onChange={(value) => updateMovementDraft('amount', value)}
                  />
                </div>
                <button type="button" className="ml3-step-next" disabled={!hasMovementAmount} onClick={advanceMovementStep}>
                  التالي
                </button>
              </section>
              ) : null}

              {movementStep > MOVEMENT_ENTRY_STEPS.CURRENCY ? (
                <section className="ml3-step ml3-step--currency is-done">
                  <div className="ml3-step-head">
                    <span>3</span>
                    <strong>العملة</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.CURRENCY)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{movementConfig.currencyText || (movementDraft.currency === CURRENCIES.USD ? 'دولار' : 'دينار')}</b>
                </section>
              ) : null}

              {movementStep === MOVEMENT_ENTRY_STEPS.CURRENCY ? (
              <section className="ml3-step ml3-step--currency is-open">
                <div className="ml3-step-head">
                  <span>3</span>
                  <strong>العملة</strong>
                </div>
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
                <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                  التالي
                </button>
              </section>
              ) : null}

              {movementConfig.needsRate && movementStep > MOVEMENT_ENTRY_STEPS.RATE ? (
                <section className="ml3-step ml3-step--rate is-done">
                  <div className="ml3-step-head">
                    <span>4</span>
                    <strong>السعر</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.RATE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{formatRate(movementDraft.rate)}</b>
                </section>
              ) : null}

              {movementConfig.needsRate && movementStep === MOVEMENT_ENTRY_STEPS.RATE ? (
              <section className="ml3-step ml3-step--rate is-open">
                <div className="ml3-step-head">
                  <span>4</span>
                  <strong>السعر</strong>
                </div>
                <NumericEntry
                  label={movementConfig.rateLabel}
                  value={movementDraft.rate}
                  onChange={(value) => updateMovementDraft('rate', value)}
                  placeholder="7.5"
                  allowDecimal
                />
                <button type="button" className="ml3-step-next" disabled={!hasMovementRate} onClick={advanceMovementStep}>
                  التالي
                </button>
              </section>
              ) : null}

              {movementSourceRequired && movementStep > MOVEMENT_ENTRY_STEPS.SOURCE ? (
                <section className="ml3-step ml3-step--source is-done">
                  <div className="ml3-step-head">
                    <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.SOURCE)}</span>
                    <strong>{movementConfig.sourceLabel}</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.SOURCE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{accountLabel(draftSourceAccount)}</b>
                </section>
              ) : null}

              {movementSourceRequired && movementStep === MOVEMENT_ENTRY_STEPS.SOURCE ? (
              <section className="ml3-step ml3-step--source is-open">
                <div className="ml3-step-head">
                  <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.SOURCE)}</span>
                  <strong>{movementConfig.sourceLabel}</strong>
                </div>
                <div className="ml3-route-picker is-single">
                  <AccountSearchSelect
                    label={movementConfig.sourceLabel}
                    value={movementDraft.sourceAccountId || ''}
                    accounts={movementAccountsFor('source')}
                    onChange={(value) => updateMovementDraft('sourceAccountId', value)}
                    preferredAccountIds={preferredMovementAccountIds('source')}
                    balanceByAccountId={balanceByAccountId}
                  />
                </div>
                <button type="button" className="ml3-step-next" disabled={!movementDraft.sourceAccountId} onClick={advanceMovementStep}>
                  التالي
                </button>
              </section>
              ) : null}

              {movementConfig.needsDestination && movementStep > MOVEMENT_ENTRY_STEPS.DESTINATION ? (
                <section className="ml3-step ml3-step--destination is-done">
                  <div className="ml3-step-head">
                    <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.DESTINATION)}</span>
                    <strong>{movementConfig.destinationLabel}</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.DESTINATION)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{accountLabel(draftDestinationAccount)}</b>
                </section>
              ) : null}

              {movementConfig.needsDestination && movementStep === MOVEMENT_ENTRY_STEPS.DESTINATION ? (
              <section className="ml3-step ml3-step--destination is-open">
                <div className="ml3-step-head">
                  <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.DESTINATION)}</span>
                  <strong>{movementConfig.destinationLabel}</strong>
                </div>
                <div className="ml3-route-picker is-single">
                  <AccountSearchSelect
                    label={movementConfig.destinationLabel}
                    value={movementDraft.destinationAccountId || ''}
                    accounts={movementAccountsFor('destination')}
                    onChange={(value) => updateMovementDraft('destinationAccountId', value)}
                    balanceByAccountId={balanceByAccountId}
                  />
                </div>
                <button type="button" className="ml3-step-next" disabled={!movementDraft.destinationAccountId || sameLogicalAccount(draftSourceAccount, draftDestinationAccount)} onClick={advanceMovementStep}>
                  التالي
                </button>
              </section>
              ) : null}

              {movementStep > MOVEMENT_ENTRY_STEPS.NOTE ? (
                <section className="ml3-step ml3-step--note is-done">
                  <div className="ml3-step-head">
                    <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.NOTE)}</span>
                    <strong>ملاحظة</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.NOTE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{movementDraft.note || 'بدون ملاحظة'}</b>
                </section>
              ) : null}

              {movementStep === MOVEMENT_ENTRY_STEPS.NOTE ? (
              <section className="ml3-step ml3-step--note is-open">
                <div className="ml3-step-head">
                  <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.NOTE)}</span>
                  <strong>ملاحظة</strong>
                </div>
                <label>
                  ملاحظة
                  <textarea
                    value={movementDraft.note}
                    onChange={(event) => updateMovementDraft('note', event.target.value)}
                    placeholder="اختياري"
                  />
                </label>
                <div className="ml3-extra-grid">
                  {movementUsesDimension ? (
                    <label>
                      مشروع / أصل
                      <select value={movementDraft.dimensionId} onChange={(event) => updateMovementDraft('dimensionId', event.target.value)}>
                        <option value="">بدون ربط</option>
                        {activeDimensions.map((dimension) => (
                          <option key={dimension.id} value={dimension.id}>{dimension.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    مرفق
                    <input
                      value={movementDraft.attachmentLabel}
                      onChange={(event) => updateMovementDraft('attachmentLabel', event.target.value)}
                      placeholder="رقم إيصال أو وصف"
                    />
                  </label>
                  <label>
                    رابط المرفق
                    <input
                      value={movementDraft.attachmentUrl}
                      onChange={(event) => updateMovementDraft('attachmentUrl', event.target.value)}
                      placeholder="اختياري"
                    />
                  </label>
                  <label className="ml3-checkline">
                    <input
                      type="checkbox"
                      checked={movementDraft.recurringEnabled}
                      onChange={(event) => updateMovementDraft('recurringEnabled', event.target.checked)}
                    />
                    حركة شهرية
                  </label>
                </div>
                <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                  مراجعة
                </button>
              </section>
              ) : null}

              {canReviewMovement ? (
              <section className="ml3-step ml3-step--review ml3-step--final is-open">
                <div className="ml3-step-head">
                  <span>{movementStepNumber(MOVEMENT_ENTRY_STEPS.REVIEW)}</span>
                  <strong>{preview.validation.ok ? 'راجع التأثير' : 'أكمل الناقص'}</strong>
                </div>
                <div className={`ml3-preview ${preview.validation.ok ? 'is-ok' : 'is-review'}`}>
                  {preview.validation.errors.map((error) => (
                    <span key={`${error.field}-${error.message}`}>{error.message}</span>
                  ))}
                  {preview.effects.map((effect) => (
                    <div className="ml3-effect" key={`${effect.accountId}-${effect.currency}`}>
                      <span>{accountLabel(effect.account)}</span>
                      <b>{money(effect.before, effect.currency)}</b>
                      <i>{signedMoney(effect.delta, effect.currency)}</i>
                      <strong>{money(effect.after, effect.currency)}</strong>
                    </div>
                  ))}
                </div>
                <button className="ml3-save" type="submit">
                  {preview.validation.ok ? 'تأكيد وحفظ الحركة' : 'حفظ كحركة ناقصة'}
                </button>
              </section>
              ) : null}
            </form>
            ) : null}

            {activeEntryMode === 'movement' ? (
              <section className="ml3-today-panel" ref={todayPanelRef}>
                <div className="ml3-today-head">
                  <h2>سجل اليوم</h2>
                  <span>{formatCount(todayMovements.length)}</span>
                </div>
                <div className="ml3-today-list">
                  {todayMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات اليوم.</p> : null}
                  {todayMovements.map((movement) => (
                    <MovementMiniRow
                      key={movement.id}
                      movement={movement}
                      accountById={accountById}
                      attachments={ledgerExtras.attachments || []}
                      dimensions={activeDimensions}
                      onCancel={cancelMovement}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {activeEntryMode === 'account' ? (
            <form className="ml3-add-account" onSubmit={addAccount}>
              <div className="ml3-entry-head">
                <div>
                  <span>حساب جديد</span>
                  <h2>{selectedAccountPreset.title}</h2>
                </div>
                <b>{accountDraftSummary(accountDraft)}</b>
              </div>
              <div className="ml3-account-build-steps" aria-label="خطوات إنشاء الحساب">
                <span className="is-done">1 التصنيف</span>
                <span className={accountDraftNameValue ? 'is-done' : 'is-current'}>2 الاسم</span>
                <span className={accountNeedsCurrency(accountDraft) ? 'is-current' : 'is-muted'}>3 العملة</span>
              </div>
              <div className="ml3-account-presets">
                {accountPresets.map((preset) => (
                  <button
                    type="button"
                    key={preset.key}
                    className={`ml3-account-preset--${preset.key} ${accountDraft.type === preset.type && accountDraft.valueKind === preset.valueKind ? 'is-active' : ''}`}
                    onClick={() => chooseAccountPreset(preset)}
                  >
                    <i aria-hidden="true">{accountPresetMark(preset.key)}</i>
                    <strong>{preset.title}</strong>
                    <span>{preset.detail}</span>
                  </button>
                ))}
              </div>
              <label>
                {selectedAccountPreset.nameLabel || 'الاسم'}
                <input
                  value={accountDraftNameValue}
                  onChange={(event) => setAccountDraft((current) => applyAccountName(current, event.target.value))}
                  placeholder={selectedAccountPreset.namePlaceholder || 'اكتب الاسم'}
                />
              </label>
              {!selectedAccountPreset.skipDetail ? (
              <>
              <span className="ml3-choice-label">{selectedAccountPreset.detailLabel || 'التفصيل'}</span>
              <div className="ml3-account-detail-choice" aria-label={selectedAccountPreset.detailLabel || 'الوصف'}>
                {selectedAccountDetails.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={accountDraft.subAccountName === option ? 'is-active' : ''}
                    onClick={() => setAccountDraft((current) => ({ ...current, subAccountName: option }))}
                  >
                    {option}
                  </button>
                ))}
              </div>
              </>
              ) : null}
              {accountNeedsCurrency(accountDraft) ? (
              <>
              <span className="ml3-choice-label">عملة الحساب</span>
              <div className="ml3-account-detail-choice is-currency" aria-label="عملة الحساب">
                <button
                  type="button"
                  className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.DINAR ? 'is-active' : ''}
                  onClick={() => setAccountDraft((current) => ({ ...current, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }))}
                >
                  دينار
                </button>
                <button
                  type="button"
                  className={accountDraft.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 'is-active' : ''}
                  onClick={() => setAccountDraft((current) => ({ ...current, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }))}
                >
                  دولار
                </button>
              </div>
              </>
              ) : null}
              <div className="ml3-account-summary">
                <strong>{accountDraftSummary(accountDraft)}</strong>
              </div>
              <button type="submit">إضافة حساب</button>
            </form>
            ) : null}
          </aside>
          ) : null}

          {activeSection !== 'entry' ? (
          <section className="ml3-content">
            {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
            {pendingUndo ? (
              <div className="ml3-undo-banner">
                <span>{pendingUndo.label}</span>
                <button type="button" onClick={undoPendingMovement}>تراجع</button>
              </div>
            ) : null}
            {renderSection()}
          </section>
          ) : null}
        </section>
        <AccountProfile
          bucket={selectedBucket}
          movements={movements}
          accounts={accounts}
          attachments={ledgerExtras.attachments || []}
          reconciliations={ledgerExtras.reconciliations || []}
          onClose={() => setSelectedAccountId('')}
          onEditMovement={editReviewMovement}
          onUpdateAccount={updateAccountClassification}
          onReconcile={reconcileAccount}
          onAddAttachment={addAccountAttachment}
        />
      </section>
    </main>
  )
}
