import { useEffect, useMemo, useState } from 'react'
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  VALUE_KINDS,
  getActivePostingAccounts,
  knownExternalAccounts,
  mohammadAccountCatalog,
} from './accountCatalog'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  createAccount,
  createOpeningMovements,
  postMovement,
  previewMovement,
  summarizeBalances,
  validateAccount,
  voidMovement,
} from './ledgerCore'
import {
  getMohammadPersistenceMode,
  loadLocalMohammadState,
  loadMohammadPersistedState,
  saveMohammadPersistedState,
} from './mohammadPersistence'

const movementLabels = {
  [MOVEMENT_TYPES.TRANSFER]: 'تحويل',
  [MOVEMENT_TYPES.EXPENSE]: 'مصروف',
  [MOVEMENT_TYPES.TRUCK_EXPENSE]: 'مصروف شاحنة',
  [MOVEMENT_TYPES.TRUCK_INCOME]: 'دخل شاحنة',
  [MOVEMENT_TYPES.USD_SALE]: 'بعت دولار',
  [MOVEMENT_TYPES.USD_PURCHASE]: 'اشتريت دولار',
  [MOVEMENT_TYPES.EXTERNAL_INCOME]: 'دخل',
  [MOVEMENT_TYPES.CORRECTION]: 'تعديل رصيد',
}

const sectionTabs = [
  { key: 'entry', label: 'إدخال' },
  { key: 'accounts', label: 'الأرصدة' },
  { key: 'review', label: 'مراجعة' },
  { key: 'history', label: 'السجل' },
]

const movementTypeOptions = [
  {
    type: MOVEMENT_TYPES.TRANSFER,
    label: 'تحويل',
    detail: 'من حساب إلى حساب',
    tone: 'transfer',
  },
  {
    type: MOVEMENT_TYPES.EXPENSE,
    label: 'مصروف',
    detail: 'يخصم من مكان واحد',
    tone: 'expense',
  },
  {
    type: MOVEMENT_TYPES.USD_SALE,
    label: 'بعت دولار',
    detail: 'دولار يخرج ودينار يدخل',
    tone: 'sale',
  },
  {
    type: MOVEMENT_TYPES.USD_PURCHASE,
    label: 'اشتريت دولار',
    detail: 'دينار يخرج ودولار يدخل',
    tone: 'purchase',
  },
]

const movementConfigs = {
  [MOVEMENT_TYPES.TRANSFER]: {
    amountLabel: 'المبلغ',
    currencyLocked: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'من',
    destinationLabel: 'إلى',
    routeTitle: 'الأطراف',
  },
  [MOVEMENT_TYPES.EXPENSE]: {
    amountLabel: 'المبلغ',
    currencyLocked: false,
    needsDestination: false,
    needsRate: false,
    sourceLabel: 'يخصم من',
    routeTitle: 'الحساب',
  },
  [MOVEMENT_TYPES.USD_SALE]: {
    amountLabel: 'كم دولار بعت؟',
    currency: CURRENCIES.USD,
    currencyText: 'دولار',
    currencyLocked: true,
    needsDestination: true,
    needsRate: true,
    rateLabel: 'سعر بيع الدولار',
    sourceLabel: 'الدولار يخرج من',
    destinationLabel: 'الدينار يدخل إلى',
    routeTitle: 'اتجاه البيع',
  },
  [MOVEMENT_TYPES.USD_PURCHASE]: {
    amountLabel: 'كم دينار دفعت؟',
    currency: CURRENCIES.DINAR,
    currencyText: 'دينار',
    currencyLocked: true,
    needsDestination: true,
    needsRate: true,
    rateLabel: 'سعر شراء الدولار',
    sourceLabel: 'الدينار يخرج من',
    destinationLabel: 'الدولار يدخل إلى',
    routeTitle: 'اتجاه الشراء',
  },
}

const movementDefaultAccounts = {
  [MOVEMENT_TYPES.TRANSFER]: { sourceAccountId: 'me-cash', destinationAccountId: 'saeed-cash' },
  [MOVEMENT_TYPES.EXPENSE]: { sourceAccountId: 'me-cash', destinationAccountId: '' },
  [MOVEMENT_TYPES.USD_SALE]: { sourceAccountId: 'me-cash', destinationAccountId: 'me-jumhouria' },
  [MOVEMENT_TYPES.USD_PURCHASE]: { sourceAccountId: 'me-jumhouria', destinationAccountId: 'me-cash' },
}

const MOVEMENT_ENTRY_STEPS = {
  TYPE: 1,
  AMOUNT: 2,
  CURRENCY: 3,
  RATE: 4,
  SOURCE: 5,
  DESTINATION: 6,
  NOTE: 7,
  REVIEW: 8,
}

const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص أو جهة',
    detail: 'رصيد بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش',
  },
  {
    key: 'own-cash',
    title: 'كاش عندي',
    detail: 'مكان مال نقدي',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    subAccountName: 'كاش',
  },
  {
    key: 'own-bank',
    title: 'حساب مصرفي',
    detail: 'مكان مال مصرفي',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    subAccountName: 'مصرفي',
  },
  {
    key: 'asset',
    title: 'أصل',
    detail: 'شيء له قيمة',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'أصل',
  },
  {
    key: 'expense',
    title: 'مصروف',
    detail: 'خرج نهائيًا',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    subAccountName: 'مصروف',
  },
]

const accountDetailOptions = ['كاش', 'مصرفي', 'دولار', 'حساب', 'أصل', 'مصروف']

const accountClassificationOptions = accountPresets.map((preset) => ({
  value: `${preset.type}|${preset.valueKind}`,
  label: preset.title,
  type: preset.type,
  valueKind: preset.valueKind,
}))

const accountGroupTabs = [
  { key: 'people', label: 'الناس + مالي', title: 'الناس + مالي' },
  { key: 'assets', label: 'أصول', title: 'الأصول' },
  { key: 'expenses', label: 'مصروف', title: 'المصروف' },
  { key: 'review', label: 'مراجعة', title: 'مراجعة' },
]

const accountTypeLabels = {
  [ACCOUNT_TYPES.PERSON]: 'شخص/جهة',
  [ACCOUNT_TYPES.CASH]: 'كاش',
  [ACCOUNT_TYPES.BANK]: 'مصرفي',
  [ACCOUNT_TYPES.EXPENSE]: 'مصروف',
  [ACCOUNT_TYPES.ASSET]: 'شيء',
  [ACCOUNT_TYPES.PROJECT]: 'مشروع',
  [ACCOUNT_TYPES.REVIEW]: 'يحتاج حل',
}

function normalizeStoredAccounts(accounts = []) {
  return accounts.map((account) => {
    if (account.id === 'saeed-bank' && account.type === ACCOUNT_TYPES.BANK && account.valueKind === VALUE_KINDS.BANK) {
      return {
        ...account,
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        notes: account.notes || 'فرع مصرفي لشخص، وليس مكان مال خاص بي.',
      }
    }
    return account
  })
}

function sameRecordVersions(left = [], right = []) {
  if (left.length !== right.length) return false
  const version = (item) => item.updatedAt || item.reviewedAt || item.disabledAt || item.mergedIntoAccountId || item.createdAt || item.voidedAt || item.status || ''
  const leftKeys = left.map((item) => `${item.id}:${version(item)}`).sort()
  const rightKeys = right.map((item) => `${item.id}:${version(item)}`).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}

function loadInitialLedgerState() {
  const fallback = {
    accounts: normalizeStoredAccounts(mohammadAccountCatalog),
    movements: createOpeningMovements(mohammadAccountCatalog),
  }
  const localState = loadLocalMohammadState(fallback)
  return { ...localState, accounts: normalizeStoredAccounts(localState.accounts) }
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
  const config = movementConfigs[type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
  const defaults = movementDefaultAccounts[type] || movementDefaultAccounts[MOVEMENT_TYPES.TRANSFER]
  return {
    type,
    amount: '',
    currency: config.currency || CURRENCIES.DINAR,
    sourceAccountId: defaults.sourceAccountId,
    destinationAccountId: config.needsDestination ? defaults.destinationAccountId : '',
    rate: '',
    note: '',
  }
}

function emptyAccountDraft() {
  return {
    ownerName: '',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    notes: '',
  }
}

function accountLabel(account) {
  return account ? `${account.ownerName} / ${account.subAccountName}` : ''
}

function movementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'تم'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقص'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغي'
  return 'مسودة'
}

function movementTone(type) {
  if (type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE) return 'expense'
  if (type === MOVEMENT_TYPES.USD_SALE) return 'sale'
  if (type === MOVEMENT_TYPES.USD_PURCHASE) return 'purchase'
  if (type === MOVEMENT_TYPES.TRANSFER) return 'transfer'
  return 'neutral'
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

function classificationValue(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

function parseClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}

function nonZero(bucket) {
  return Math.round(Math.abs(bucket.dinar)) !== 0 || Math.round(Math.abs(bucket.usd)) !== 0
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
  if (account.valueKind === VALUE_KINDS.RECEIVABLE && /مصرف|بنك|حساب/i.test(account.subAccountName || '')) return 'person-bank'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE && /دولار|usd/i.test(account.subAccountName || '')) return 'person-usd'
  return 'person'
}

function accountKindText(account) {
  if (!account) return ''
  if (account.valueKind === VALUE_KINDS.CASH) return 'مالي كاش'
  if (account.valueKind === VALUE_KINDS.BANK) return 'مالي مصرفي'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'أصل'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'مصروف'
  if (account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || account.valueKind === VALUE_KINDS.REVIEW) return 'مراجعة'
  return account.subAccountName || 'شخص'
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

function sameLogicalAccount(left, right) {
  if (!left || !right) return false
  return (
    left.id === right.id ||
    (
      String(left.ownerName || '').trim() === String(right.ownerName || '').trim() &&
      String(left.subAccountName || '').trim() === String(right.subAccountName || '').trim()
    )
  )
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
  const showKind = kindText && kindText !== account.subAccountName
  return (
    <article className={`ml3-account-row ml3-account-row--${visualKind(account)} ${balanceTone} ${muted ? 'is-muted' : ''}`}>
      <button type="button" className="ml3-account-main" onClick={() => onOpen?.(account.id)}>
        <strong>{account.ownerName}</strong>
        <span>{account.subAccountName}</span>
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

function AccountList({ title, subtitle, rows, emptyText = 'لا توجد عناصر في هذا القسم.', onConfirm, onDisable, onOpen, embedded = false }) {
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
    if (quickFilter === 'kind:bank') return account.valueKind === VALUE_KINDS.BANK || /مصرف|بنك|حساب/i.test(account.subAccountName || '')
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
      const haystack = `${account.ownerName} ${account.subAccountName} ${account.legacyName || ''}`.toLowerCase()
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
                  <span>{account.subAccountName}</span>
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
                  <span>{account.subAccountName}</span>
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

function MovementMiniRow({ movement, accountById, onCancel }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []

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
      {movement.status === MOVEMENT_STATUSES.POSTED ? (
        <button type="button" onClick={() => onCancel(movement.id)}>إلغاء</button>
      ) : null}
    </article>
  )
}

function HistoryMovementRow({ movement, accountById, onCancel }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const statusTone = movement.status === MOVEMENT_STATUSES.POSTED ? 'تم' : movementStatusLabel(movement.status)

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
      {movement.status === MOVEMENT_STATUSES.POSTED ? (
        <button type="button" onClick={() => onCancel(movement.id)}>إلغاء</button>
      ) : null}
    </article>
  )
}

function movementAccountImpact(movement, accountId) {
  return buildPostingEntries(movement).filter((entry) => entry.accountId === accountId)
}

function AccountProfile({ bucket, movements, accounts, onClose, onEditMovement, onUpdateAccount }) {
  if (!bucket) return null

  const { account, dinar, usd, postedCount } = bucket
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
            <span>{accountTypeLabels[account.type] || account.type}</span>
            <h2>{account.ownerName}</h2>
            <p>{account.subAccountName}</p>
          </div>
        </div>

        <div className={`ml3-profile-balance ${dinar > 0 ? 'is-positive' : dinar < 0 ? 'is-negative' : 'is-zero'}`}>
          <strong>{formatDisplayMeaning(account, dinar)}</strong>
          <span>{Math.round(Math.abs(usd)) !== 0 ? money(usd, CURRENCIES.USD) : 'لا يوجد دولار'}</span>
        </div>

        <div className="ml3-profile-facts">
          <div>
            <span>التصنيف</span>
            <strong>{accountTypeLabels[account.type] || account.type}</strong>
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

        <form className="ml3-profile-editor" onSubmit={(event) => onUpdateAccount(event, account.id)}>
          <h3>تعديل التصنيف</h3>
          <div className="ml3-profile-editor-grid">
            <label>
              الاسم
              <input name="ownerName" defaultValue={account.ownerName} />
            </label>
            <label>
              تفصيل الحساب
              <input name="subAccountName" defaultValue={account.subAccountName} />
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
          <h3>حركات الحساب</h3>
          {relatedMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات لهذا الحساب.</p> : null}
          {relatedMovements.map((movement) => {
            const impacts = movementAccountImpact(movement, account.id)
            const source = accountMap.get(movement.sourceAccountId)
            const destination = accountMap.get(movement.destinationAccountId)
            return (
              <article className="ml3-profile-movement" key={movement.id}>
                <div>
                  <strong>{movementLabels[movement.type] || movement.type}</strong>
                  <span>{accountLabel(source) || 'بدون مصدر'} ← {accountLabel(destination) || 'بدون وجهة'}</span>
                  {movement.note ? <small>{movement.note}</small> : null}
                </div>
                <div className="ml3-profile-impact">
                  {impacts.map((impact) => (
                    <b key={`${movement.id}-${impact.currency}`}>{signedMoney(impact.delta, impact.currency)}</b>
                  ))}
                  {!movement.id?.startsWith('opening-') ? (
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
          تفصيل الحساب
          <input name="subAccountName" defaultValue={account.subAccountName} />
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

function ExternalAccountCard({ account, onCreate }) {
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
          تفصيل الحساب
          <input name="subAccountName" defaultValue={account.subAccountName} />
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
  const reviewConfig = movementConfigs[reviewDraft.type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
  const reviewSourceAccount = activeAccounts.find((account) => account.id === reviewDraft.sourceAccountId)
  const reviewDestinationAccount = activeAccounts.find((account) => account.id === reviewDraft.destinationAccountId)
  const postingAccounts = activeAccounts.filter((account) =>
    account.valueKind !== VALUE_KINDS.EXPENSE &&
    account.valueKind !== VALUE_KINDS.ASSET &&
    account.status === ACCOUNT_STATUSES.ACTIVE
  )
  const reviewSourceAccounts = reviewDestinationAccount
    ? postingAccounts.filter((account) => !sameLogicalAccount(account, reviewDestinationAccount))
    : postingAccounts
  const reviewDestinationAccounts = reviewSourceAccount
    ? postingAccounts.filter((account) => !sameLogicalAccount(account, reviewSourceAccount))
    : postingAccounts

  function updateReviewDraft(field, value) {
    setReviewDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'type') {
        const config = movementConfigs[value] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
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
        <div className="ml3-decision-wide">
          <AccountSearchSelect
            label={reviewConfig.sourceLabel || 'من'}
            value={reviewDraft.sourceAccountId || ''}
            accounts={reviewSourceAccounts}
            onChange={(value) => updateReviewDraft('sourceAccountId', value || '')}
            preferredAccountIds={['me-cash', 'me-jumhouria', 'saeed-cash', 'saeed-bank']}
            balanceByAccountId={balanceByAccountId}
          />
        </div>
        {reviewConfig.needsDestination ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect
              label={reviewConfig.destinationLabel || 'إلى'}
              value={reviewDraft.destinationAccountId || ''}
              accounts={reviewDestinationAccounts}
              onChange={(value) => updateReviewDraft('destinationAccountId', value || '')}
              preferredAccountIds={['me-cash', 'me-jumhouria', 'saeed-cash', 'saeed-bank']}
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

function AlertBoard({ reviewAccounts, reviewMovements, externalMissing }) {
  const alerts = []
  if (reviewMovements.length) alerts.push({ tone: 'danger', title: 'حركات ناقصة', detail: formatCount(reviewMovements.length) })
  if (reviewAccounts.length) alerts.push({ tone: 'warning', title: 'حسابات للتصنيف', detail: formatCount(reviewAccounts.length) })
  if (externalMissing.length) alerts.push({ tone: 'info', title: 'أسماء جديدة', detail: formatCount(externalMissing.length) })
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
            <span>{alert.detail}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function MohammadLedgerApp() {
  const [initialState] = useState(loadInitialLedgerState)
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [movements, setMovements] = useState(initialState.movements)
  const [activeSection, setActiveSection] = useState('entry')
  const [activeEntryMode, setActiveEntryMode] = useState('movement')
  const [activeAccountGroup, setActiveAccountGroup] = useState('people')
  const [movementDraft, setMovementDraft] = useState(() => emptyMovementDraft())
  const [movementStep, setMovementStep] = useState(MOVEMENT_ENTRY_STEPS.TYPE)
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isHydrated, setIsHydrated] = useState(false)
  const [storageMode, setStorageMode] = useState(getMohammadPersistenceMode)
  const [saveStatus, setSaveStatus] = useState('loading')
  const [, setSyncProblem] = useState(false)
  const [pendingUndo, setPendingUndo] = useState(null)
  const [activeReviewKey, setActiveReviewKey] = useState('')

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousTitle = document.title
    const favicon = document.querySelector("link[rel='icon']")
    const previousIcon = favicon?.getAttribute('href')
    document.title = 'دفتر محمد'
    favicon?.setAttribute('href', `${import.meta.env.BASE_URL}mohammad-ledger.svg`)
    return () => {
      document.title = previousTitle
      if (previousIcon) favicon?.setAttribute('href', previousIcon)
    }
  }, [])

  const activeAccounts = useMemo(() => getActivePostingAccounts(accounts), [accounts])
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const balances = useMemo(() => summarizeBalances(accounts, movements), [accounts, movements])
  const balanceByAccountId = useMemo(() => new Map(balances.map((bucket) => [bucket.account.id, bucket])), [balances])
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
  const unresolvedExternalAccounts = knownExternalAccounts.filter(
    (externalAccount) =>
      !accounts.some(
        (account) =>
          account.ownerName === externalAccount.ownerName &&
          account.subAccountName === externalAccount.subAccountName &&
          account.status !== ACCOUNT_STATUSES.INACTIVE,
      ),
  )
  const reviewItems = useMemo(() => {
    const accountItems = (balancesByKind.review || []).map((bucket) => ({
      key: `account:${bucket.account.id}`,
      type: 'account',
      label: bucket.account.ownerName,
      detail: bucket.account.subAccountName,
      tone: 'danger',
      bucket,
    }))
    const externalItems = unresolvedExternalAccounts.map((account) => ({
      key: `external:${account.id}`,
      type: 'external',
      label: account.ownerName,
      detail: account.subAccountName,
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

  const movementConfig = movementConfigs[movementDraft.type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
  const normalizedDraft = {
    ...movementDraft,
    amount: parseWholeAmount(movementDraft.amount),
    currency: movementConfig.currency || movementDraft.currency,
    destinationAccountId: movementConfig.needsDestination ? movementDraft.destinationAccountId : null,
    rate: movementDraft.rate === '' ? undefined : Number(movementDraft.rate),
  }
  const preview = previewMovement(normalizedDraft, accounts, movements)
  const hasMovementAmount = Number.isFinite(normalizedDraft.amount) && normalizedDraft.amount > 0
  const hasMovementRate = !movementConfig.needsRate || (Number.isFinite(normalizedDraft.rate) && normalizedDraft.rate > 0)
  const canChooseMovementAccounts = hasMovementAmount && hasMovementRate
  const selectedSourceAccount = accountById.get(movementDraft.sourceAccountId)
  const selectedDestinationAccount = accountById.get(movementDraft.destinationAccountId)
  const hasMovementAccounts =
    Boolean(movementDraft.sourceAccountId) &&
    (!movementConfig.needsDestination || Boolean(movementDraft.destinationAccountId)) &&
    (!movementConfig.needsDestination || !sameLogicalAccount(selectedSourceAccount, selectedDestinationAccount))
  const canReviewMovement = canChooseMovementAccounts && hasMovementAccounts && movementStep >= MOVEMENT_ENTRY_STEPS.REVIEW
  const selectedBucket = balances.find((bucket) => bucket.account.id === selectedAccountId) || null
  const draftSourceAccount = selectedSourceAccount
  const draftDestinationAccount = selectedDestinationAccount

  useEffect(() => {
    let cancelled = false

    async function hydrateLedger() {
      const result = await loadMohammadPersistedState(initialState)
      if (cancelled) return
      setStorageMode(result.mode)
      setAccounts(normalizeStoredAccounts(result.state.accounts))
      setMovements(result.state.movements)
      setSaveStatus(result.loadError ? 'local-only' : 'saved')
      setSyncProblem(Boolean(result.loadError))
      setIsHydrated(true)
      if (result.loadError) {
        setFeedback('تم فتح النسخة المحلية. السحابة غير جاهزة الآن.')
      }
    }

    hydrateLedger()
    return () => {
      cancelled = true
    }
  }, [initialState])

  useEffect(() => {
    if (!isHydrated) return undefined
    let cancelled = false
    setSaveStatus('saving')

    saveMohammadPersistedState({ accounts, movements })
      .then((result) => {
        if (cancelled) return
        setStorageMode(result.mode)
        const hasSyncProblem = result.mode === 'supabase' && !result.supabaseOk
        setSyncProblem(hasSyncProblem)
        setSaveStatus(result.supabaseOk ? 'saved' : (result.mode === 'supabase' ? 'local-only' : 'local'))
        if (result.state) {
          const mergedAccounts = normalizeStoredAccounts(result.state.accounts)
          const mergedMovements = result.state.movements || []
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
    }
  }, [accounts, movements, isHydrated])

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
    if (activeSection !== 'review') return
    if (!reviewItems.length) {
      setActiveReviewKey('')
      return
    }
    if (!reviewItems.some((item) => item.key === activeReviewKey)) {
      setActiveReviewKey(reviewItems[0].key)
    }
  }, [activeSection, activeReviewKey, reviewItems])

  function updateMovementDraft(field, value) {
    setMovementDraft((current) => ({ ...current, [field]: value }))
  }

  function chooseMovementType(type) {
    const config = movementConfigs[type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
    const defaults = movementDefaultAccounts[type] || movementDefaultAccounts[MOVEMENT_TYPES.TRANSFER]
    setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    setMovementDraft((current) => ({
      ...current,
      type,
      currency: config.currency || current.currency,
      sourceAccountId: defaults.sourceAccountId,
      destinationAccountId: config.needsDestination ? defaults.destinationAccountId : '',
      rate: config.needsRate ? current.rate : '',
    }))
  }

  function swapMovementSides() {
    if (!movementConfig.needsDestination) return
    setMovementDraft((current) => ({
      ...current,
      sourceAccountId: current.destinationAccountId || '',
      destinationAccountId: current.sourceAccountId || '',
    }))
  }

  function nextMovementStep(step = movementStep) {
    if (step === MOVEMENT_ENTRY_STEPS.TYPE) return MOVEMENT_ENTRY_STEPS.AMOUNT
    if (step === MOVEMENT_ENTRY_STEPS.AMOUNT) return MOVEMENT_ENTRY_STEPS.CURRENCY
    if (step === MOVEMENT_ENTRY_STEPS.CURRENCY) return movementConfig.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : MOVEMENT_ENTRY_STEPS.SOURCE
    if (step === MOVEMENT_ENTRY_STEPS.RATE) return MOVEMENT_ENTRY_STEPS.SOURCE
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
    const isPostingAccount = (account) =>
      account.valueKind !== VALUE_KINDS.EXPENSE &&
      account.valueKind !== VALUE_KINDS.ASSET &&
      account.status === ACCOUNT_STATUSES.ACTIVE
    const moneyOrPerson = activeAccounts.filter(isPostingAccount)
    const usdReadyAccounts = moneyOrPerson.filter((account) => {
      const hasUsdBalance = Math.abs(balanceByAccountId.get(account.id)?.usd || 0) > 0.000001
      const text = `${account.ownerName || ''} ${account.subAccountName || ''} ${account.legacyName || ''}`.toLowerCase()
      return hasUsdBalance || /دولار|usd|\$/.test(text)
    })
    const sourceAccount = accountById.get(movementDraft.sourceAccountId)
    const destinationAccount = accountById.get(movementDraft.destinationAccountId)
    const removeLogicalDuplicate = (list, compareAccount) =>
      compareAccount ? list.filter((account) => !sameLogicalAccount(account, compareAccount)) : list

    if (movementDraft.type === MOVEMENT_TYPES.USD_SALE && role === 'source') {
      return usdReadyAccounts.length ? usdReadyAccounts : moneyOrPerson
    }
    if (movementDraft.type === MOVEMENT_TYPES.USD_PURCHASE && role === 'destination') {
      return removeLogicalDuplicate(usdReadyAccounts.length ? usdReadyAccounts : moneyOrPerson, sourceAccount)
    }
    if (role === 'destination') {
      return removeLogicalDuplicate(moneyOrPerson, sourceAccount)
    }
    if (role === 'source') {
      return removeLogicalDuplicate(moneyOrPerson, destinationAccount)
    }
    return moneyOrPerson
  }

  function preferredMovementAccountIds(role) {
    if (movementDraft.type === MOVEMENT_TYPES.EXPENSE && role === 'source') {
      return ['me-cash', 'me-jumhouria', 'saeed-cash', 'saeed-bank']
    }
    return []
  }

  function chooseAccountPreset(preset) {
    setAccountDraft((current) => ({
      ...current,
      type: preset.type,
      valueKind: preset.valueKind,
      subAccountName: preset.subAccountName,
    }))
  }

  function saveMovement(event) {
    event.preventDefault()
    const movement = postMovement({ ...normalizedDraft, note: movementDraft.note.trim() }, accounts)
    setMovements((current) => [...current, movement])
    setFeedback(movement.status === MOVEMENT_STATUSES.POSTED ? 'تم الحفظ وتحديث الأرصدة.' : 'الحركة ناقصة وتحتاج حل.')
    setPendingUndo({
      movementId: movement.id,
      label: `${movementLabels[movement.type] || 'حركة'} · ${money(movement.amount, movement.currency)}`,
    })
    if (movement.status === MOVEMENT_STATUSES.POSTED) {
      setMovementDraft(emptyMovementDraft(movementDraft.type))
      setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
    }
  }

  function cancelMovement(movementId) {
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
    setFeedback('تم إنشاء الحساب.')
    setAccountDraft(emptyAccountDraft())
  }

  function confirmAccount(accountId) {
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? { ...account, status: ACCOUNT_STATUSES.ACTIVE, type: account.type === ACCOUNT_TYPES.REVIEW ? ACCOUNT_TYPES.PERSON : account.type, valueKind: account.valueKind === VALUE_KINDS.REVIEW ? VALUE_KINDS.RECEIVABLE : account.valueKind, updatedAt: new Date().toISOString() }
          : account,
      ),
    )
    setFeedback('تم اعتماد الحساب.')
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
    setMovements((current) =>
      current.map((movement) => ({
        ...movement,
        sourceAccountId: movement.sourceAccountId === sourceAccountId ? targetAccountId : movement.sourceAccountId,
        destinationAccountId: movement.destinationAccountId === sourceAccountId ? targetAccountId : movement.destinationAccountId,
        mergedFromAccountId: movement.sourceAccountId === sourceAccountId || movement.destinationAccountId === sourceAccountId ? sourceAccountId : movement.mergedFromAccountId,
      })),
    )
    setAccounts((current) =>
      current.map((account) =>
        account.id === sourceAccountId
          ? { ...account, status: ACCOUNT_STATUSES.INACTIVE, mergedIntoAccountId: targetAccountId, updatedAt: new Date().toISOString() }
          : account,
      ),
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
    setFeedback(`تم إنشاء حساب ${externalAccount.ownerName}.`)
  }

  function editReviewMovement(movement) {
    setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    setMovementDraft({
      type: movement.type || MOVEMENT_TYPES.TRANSFER,
      amount: movement.amount ? String(movement.amount) : '',
      currency: movement.currency || CURRENCIES.DINAR,
      sourceAccountId: movement.sourceAccountId || '',
      destinationAccountId: movement.destinationAccountId || '',
      rate: movement.rate ? String(movement.rate) : '',
      note: movement.note || '',
    })
    setMovements((current) => current.filter((item) => item.id !== movement.id))
    setFeedback('الحركة جاهزة للتعديل.')
  }

  function resolveReviewMovement(event, movement, reviewDraft) {
    event.preventDefault()
    const config = movementConfigs[reviewDraft.type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
    const candidate = postMovement(
      {
        ...movement,
        type: reviewDraft.type,
        amount: parseWholeAmount(reviewDraft.amount),
        currency: config.currency || reviewDraft.currency,
        sourceAccountId: reviewDraft.sourceAccountId || null,
        destinationAccountId: config.needsDestination ? reviewDraft.destinationAccountId || null : null,
        rate: reviewDraft.rate === '' ? undefined : Number(reviewDraft.rate),
        note: String(reviewDraft.note || '').trim(),
      },
      accounts,
    )
    setMovements((current) => current.map((item) => (item.id === movement.id ? candidate : item)))
    setFeedback(candidate.status === MOVEMENT_STATUSES.POSTED ? 'تم إصلاح الحركة.' : 'ما زالت ناقصة.')
  }

  function renderAccountsSection() {
    const activeGroup = accountGroupTabs.find((group) => group.key === activeAccountGroup) || accountGroupTabs[0]
    const moneyRows = balancesByKind.money || []
    const peopleRows = balancesByKind.people || []
    const peoplePositive = peopleRows.filter((bucket) => Math.round(bucket.dinar) > 0).sort(compareBalanceBuckets)
    const peopleNegative = peopleRows.filter((bucket) => Math.round(bucket.dinar) < 0).sort(compareBalanceBuckets)
    const peopleZero = peopleRows.filter((bucket) => !nonZero(bucket)).sort(compareBalanceBuckets)
    const accountRowsByGroup = {
      people: [...moneyRows, ...peoplePositive, ...peopleNegative, ...peopleZero],
      assets: balancesByKind.assets || [],
      expenses: balancesByKind.expenses || [],
      review: balancesByKind.review || [],
    }
    const rows = accountRowsByGroup[activeGroup.key] || []
    return (
      <section className="ml3-panel">
        <div className="ml3-panel-head">
          <div>
            <h2>الأرصدة</h2>
          </div>
          <span>{formatCount(balances.length)}</span>
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
            <AccountList title="مالي" rows={moneyRows} onOpen={setSelectedAccountId} embedded />
            <AccountList title="أقبض منهم" rows={peoplePositive} onOpen={setSelectedAccountId} embedded />
            <AccountList title="أدفع لهم" rows={peopleNegative} onOpen={setSelectedAccountId} embedded />
            <AccountList title="صفر" rows={peopleZero} onOpen={setSelectedAccountId} embedded />
          </div>
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
                <ExternalAccountCard key={activeReviewItem.account.id} account={activeReviewItem.account} onCreate={addExternalAccount} />
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
        </section>
      )
    }
    if (activeSection === 'history') {
      return (
        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
            <h2>السجل</h2>
            </div>
            <span>{formatCount(postedUserMovements.length)}</span>
          </div>
          <div className="ml3-history-list">
            {postedUserMovements.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
            {postedUserMovements.map((movement) => (
              <HistoryMovementRow
                key={movement.id}
                movement={movement}
                accountById={accountById}
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
            <span>أدفع للناس</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
          <button type="button" className="ml3-home-card is-money" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('people') }}>
            <span>أماكن المال</span>
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

  const storageText = {
    loading: 'تحميل',
    saving: 'حفظ',
    saved: storageMode === 'supabase' ? 'سحابي' : 'محلي',
    local: 'هذا الجهاز',
    'local-only': 'سحابة ناقصة',
  }[saveStatus] || 'محلي'

  return (
    <main className="ml3-app" dir="rtl">
      <section className="ml3-shell">
        <header className="ml3-topbar">
          <div className="ml3-brand">
            <span className="ml3-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32">
                <rect x="7" y="5" width="18" height="22" rx="4" />
                <path d="M12 12h8M12 16h8M12 20h5" />
                <circle cx="23" cy="23" r="5" />
              </svg>
            </span>
            <div>
            <span>دفتر محمد</span>
            <h1>{activeSection === 'entry' ? 'إدخال حركة' : 'الأرصدة الآن'}</h1>
            </div>
          </div>
          <div className="ml3-top-actions">
            <b className={`ml3-save-state ml3-save-state--${saveStatus}`}>{storageText}</b>
            <b>{formatCount(activeAccounts.length)} حساب</b>
            <b>{formatCount(reviewMovements.length)} مشكلة</b>
          </div>
        </header>

        {activeSection !== 'entry' ? (
          <>
            <section className="ml3-metrics">
              <MetricChip label="كاش" value={totals.cash} tone="cash" />
              <MetricChip label="مصرفي" value={totals.bank} tone="bank" />
              <MetricChip label="أقبض" value={totals.peopleOweMe} tone="positive" />
              <MetricChip label="أدفع" value={totals.iOwePeople} tone="negative" />
              <MetricChip label="أصول" value={totals.assets} tone="asset" />
              <MetricChip label="مصروف" value={totals.expenses} tone="expense" />
            </section>

            <AlertBoard
              reviewAccounts={balancesByKind.review}
              reviewMovements={reviewMovements}
              externalMissing={unresolvedExternalAccounts}
            />
          </>
        ) : null}

        <nav className="ml3-tabs" aria-label="أقسام الدفتر">
          {sectionTabs.map((tab) => (
            <button
              type="button"
              className={activeSection === tab.key ? 'is-active' : ''}
              key={tab.key}
              onClick={() => setActiveSection(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className={`ml3-layout ${activeSection === 'entry' ? 'is-entry' : 'is-content-only'}`}>
          {activeSection === 'entry' ? (
          <aside className="ml3-entry">
            {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
            {pendingUndo ? (
              <div className="ml3-undo-banner">
                <span>{pendingUndo.label}</span>
                <button type="button" onClick={undoPendingMovement}>تراجع</button>
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
                  <h2>{movementLabels[movementDraft.type]}</h2>
                </div>
                <b>{preview.validation.ok ? 'جاهزة' : 'ناقصة'}</b>
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

              {movementStep > MOVEMENT_ENTRY_STEPS.SOURCE ? (
                <section className="ml3-step ml3-step--source is-done">
                  <div className="ml3-step-head">
                    <span>{movementConfig.needsRate ? 5 : 4}</span>
                    <strong>{movementConfig.sourceLabel}</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.SOURCE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{accountLabel(draftSourceAccount)}</b>
                </section>
              ) : null}

              {movementStep === MOVEMENT_ENTRY_STEPS.SOURCE ? (
              <section className="ml3-step ml3-step--source is-open">
                <div className="ml3-step-head">
                  <span>{movementConfig.needsRate ? 5 : 4}</span>
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
                    <span>{movementConfig.needsRate ? 6 : 5}</span>
                    <strong>{movementConfig.destinationLabel}</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.DESTINATION)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{accountLabel(draftDestinationAccount)}</b>
                </section>
              ) : null}

              {movementConfig.needsDestination && movementStep === MOVEMENT_ENTRY_STEPS.DESTINATION ? (
              <section className="ml3-step ml3-step--destination is-open">
                <div className="ml3-step-head">
                  <span>{movementConfig.needsRate ? 6 : 5}</span>
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
                    <span>{movementConfig.needsRate ? (movementConfig.needsDestination ? 7 : 6) : (movementConfig.needsDestination ? 6 : 5)}</span>
                    <strong>ملاحظة</strong>
                    <button type="button" onClick={() => editMovementStep(MOVEMENT_ENTRY_STEPS.NOTE)}>تعديل</button>
                  </div>
                  <b className="ml3-step-summary">{movementDraft.note || 'بدون ملاحظة'}</b>
                </section>
              ) : null}

              {movementStep === MOVEMENT_ENTRY_STEPS.NOTE ? (
              <section className="ml3-step ml3-step--note is-open">
                <div className="ml3-step-head">
                  <span>{movementConfig.needsRate ? (movementConfig.needsDestination ? 7 : 6) : (movementConfig.needsDestination ? 6 : 5)}</span>
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
                <button type="button" className="ml3-step-next" onClick={advanceMovementStep}>
                  مراجعة
                </button>
              </section>
              ) : null}

              {canReviewMovement ? (
              <section className="ml3-step ml3-step--review ml3-step--final is-open">
                <div className="ml3-step-head">
                  <span>{movementConfig.needsRate ? (movementConfig.needsDestination ? 8 : 7) : (movementConfig.needsDestination ? 7 : 6)}</span>
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
              <section className="ml3-today-panel">
                <div className="ml3-today-head">
                  <h2>اليوم</h2>
                  <span>{formatCount(todayMovements.length)}</span>
                </div>
                <div className="ml3-today-list">
                  {todayMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات اليوم.</p> : null}
                  {todayMovements.map((movement) => (
                    <MovementMiniRow
                      key={movement.id}
                      movement={movement}
                      accountById={accountById}
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
                  <h2>{accountPresets.find((preset) => preset.type === accountDraft.type && preset.valueKind === accountDraft.valueKind)?.title || 'حساب'}</h2>
                </div>
                <b>{accountDraft.subAccountName}</b>
              </div>
              <div className="ml3-account-presets">
                {accountPresets.map((preset) => (
                  <button
                    type="button"
                    key={preset.key}
                    className={accountDraft.type === preset.type && accountDraft.valueKind === preset.valueKind ? 'is-active' : ''}
                    onClick={() => chooseAccountPreset(preset)}
                  >
                    <strong>{preset.title}</strong>
                  </button>
                ))}
              </div>
              <label>
                الاسم
                <input
                  value={accountDraft.ownerName}
                  onChange={(event) => setAccountDraft((current) => ({ ...current, ownerName: event.target.value }))}
                  placeholder="اسم الشخص أو المكان أو الأصل"
                />
              </label>
              <div className="ml3-account-detail-choice" aria-label="تفصيل الحساب">
                {accountDetailOptions.map((option) => (
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
              <div className="ml3-account-summary">
                <strong>{accountDraft.ownerName || 'الاسم'} · {accountDraft.subAccountName} · {accountTypeLabels[accountDraft.type]}</strong>
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
          onClose={() => setSelectedAccountId('')}
          onEditMovement={editReviewMovement}
          onUpdateAccount={updateAccountClassification}
        />
      </section>
    </main>
  )
}
