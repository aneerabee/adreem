import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS, buildAccountMap, inferAccountCurrencyKind, normalizeAccountCurrencyKind } from './accountCatalog.js'
import {
  accountSupportsTransferCurrency,
  areTransferAccountsCompatible,
  canonicalAccountDetail,
  sameLogicalAccount,
  transferCompatibilityMessage,
} from './accountCompatibility.js'

export const CURRENCIES = {
  DINAR: 'LYD',
  USD: 'USD',
}

export const MOVEMENT_TYPES = {
  OPENING_BALANCE: 'opening_balance',
  TRANSFER: 'transfer',
  EXPENSE: 'expense',
  TRUCK_EXPENSE: 'truck_expense',
  TRUCK_INCOME: 'truck_income',
  USD_SALE: 'usd_sale',
  USD_PURCHASE: 'usd_purchase',
  EXTERNAL_INCOME: 'external_income',
  CORRECTION: 'correction',
}

export const MOVEMENT_STATUSES = {
  DRAFT: 'draft',
  NEEDS_REVIEW: 'needs_review',
  POSTED: 'posted',
  VOIDED: 'voided',
}

const TWO_SIDED_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
])

const SOURCE_REQUIRED_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.EXPENSE,
  MOVEMENT_TYPES.TRUCK_EXPENSE,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
])

const DESTINATION_REQUIRED_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.TRUCK_INCOME,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
  MOVEMENT_TYPES.EXTERNAL_INCOME,
  MOVEMENT_TYPES.CORRECTION,
])

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isoNow() {
  return new Date().toISOString()
}

export function roundMoney(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 1_000_000) / 1_000_000
}

export function createOpeningMovements(accounts = [], createdAt = isoNow()) {
  return accounts.flatMap((account) => {
    const entries = []
    if (asNumber(account.openingDinar)) {
      entries.push({
        id: `opening-${account.id}-dinar`,
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: roundMoney(account.openingDinar),
        destinationAccountId: account.id,
        sourceAccountId: null,
        note: `رصيد افتتاحي من Numbers: ${account.legacyName}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    if (asNumber(account.openingUsd)) {
      entries.push({
        id: `opening-${account.id}-usd`,
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.USD,
        amount: roundMoney(account.openingUsd),
        destinationAccountId: account.id,
        sourceAccountId: null,
        note: `رصيد افتتاحي دولار من Numbers: ${account.legacyName}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    return entries
  })
}

function balanceValueForCurrency(bucket, currency) {
  return currency === CURRENCIES.USD ? Number(bucket?.usd || 0) : Number(bucket?.dinar || 0)
}

function cannotGoNegative(account) {
  return account?.valueKind === VALUE_KINDS.CASH ||
    account?.valueKind === VALUE_KINDS.BANK ||
    account?.valueKind === VALUE_KINDS.ASSET
}

function validateNonNegativeOwnBalances(movement, accounts = [], movements = [], accountMap = buildAccountMap(accounts)) {
  const errors = []
  const balances = summarizeBalances(accounts, movements)
  const balanceById = new Map(balances.map((bucket) => [bucket.account.id, bucket]))
  const entries = buildPostingEntries({ ...movement, status: MOVEMENT_STATUSES.POSTED })

  for (const entry of entries) {
    if (!entry.accountId || entry.delta >= 0) continue
    const account = accountMap.get(entry.accountId)
    if (!cannotGoNegative(account)) continue
    const before = balanceValueForCurrency(balanceById.get(entry.accountId), entry.currency)
    const after = roundMoney(before + entry.delta)
    if (after >= 0) continue
    const field = entry.accountId === movement?.sourceAccountId ? 'sourceAccountId' : 'destinationAccountId'
    errors.push({
      field,
      message: 'لا يمكن أن يصبح حساب فلوسك أو الأصل بالسالب. الرصيد المتاح أقل من قيمة الحركة.',
    })
  }

  return errors
}

export function validateMovement(movement, accounts = [], movements = []) {
  const accountMap = buildAccountMap(accounts)
  const errors = []
  const warnings = []
  const type = movement?.type
  const amount = movement?.amount
  const currency = movement?.currency
  const sourceId = movement?.sourceAccountId || null
  const destinationId = movement?.destinationAccountId || null

  if (!type || !Object.values(MOVEMENT_TYPES).includes(type)) {
    errors.push({ field: 'type', message: 'نوع الحركة مطلوب وغير معروف.' })
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    errors.push({ field: 'amount', message: 'القيمة يجب أن تكون رقمًا غير صفري.' })
  }
  if (type !== MOVEMENT_TYPES.CORRECTION && typeof amount === 'number' && Number.isFinite(amount) && amount <= 0) {
    errors.push({ field: 'amount', message: 'القيمة يجب أن تكون أكبر من صفر.' })
  }
  if (!currency || !Object.values(CURRENCIES).includes(currency)) {
    errors.push({ field: 'currency', message: 'العملة مطلوبة.' })
  }
  if (type === MOVEMENT_TYPES.USD_SALE && currency && currency !== CURRENCIES.USD) {
    errors.push({ field: 'currency', message: 'بيع الدولار يبدأ بمبلغ دولار.' })
  }
  if (type === MOVEMENT_TYPES.USD_PURCHASE && currency && currency !== CURRENCIES.DINAR) {
    errors.push({ field: 'currency', message: 'شراء الدولار يبدأ بمبلغ دينار.' })
  }
  if (SOURCE_REQUIRED_TYPES.has(type) && !sourceId) {
    errors.push({ field: 'sourceAccountId', message: 'حساب المصدر مطلوب لهذه الحركة.' })
  }
  if (DESTINATION_REQUIRED_TYPES.has(type) && !destinationId) {
    errors.push({ field: 'destinationAccountId', message: 'حساب الوجهة مطلوب لهذه الحركة.' })
  }
  if (TWO_SIDED_TYPES.has(type) && sourceId && destinationId && sourceId === destinationId) {
    errors.push({ field: 'destinationAccountId', message: 'لا يمكن أن يكون المصدر والوجهة نفس الحساب.' })
  }
  if (TWO_SIDED_TYPES.has(type) && sourceId && destinationId && sourceId !== destinationId) {
    const sourceAccount = accountMap.get(sourceId)
    const destinationAccount = accountMap.get(destinationId)
    if (sameLogicalAccount(sourceAccount, destinationAccount)) {
      errors.push({ field: 'destinationAccountId', message: 'لا يمكن التحويل بين نفس الاسم ونفس التفصيل.' })
    }
    if (type === MOVEMENT_TYPES.TRANSFER && !areTransferAccountsCompatible(sourceAccount, destinationAccount, currency)) {
      errors.push({ field: 'destinationAccountId', message: transferCompatibilityMessage(sourceAccount, destinationAccount, currency) })
    }
  }
  const sourceAccount = sourceId ? accountMap.get(sourceId) : null
  const destinationAccount = destinationId ? accountMap.get(destinationId) : null
  if ((type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE) && sourceAccount && !accountSupportsTransferCurrency(sourceAccount, currency)) {
    errors.push({ field: 'sourceAccountId', message: 'حساب المصروف لا يدعم عملة الحركة.' })
  }
  if ((type === MOVEMENT_TYPES.EXTERNAL_INCOME || type === MOVEMENT_TYPES.TRUCK_INCOME || type === MOVEMENT_TYPES.CORRECTION) && destinationAccount && !accountSupportsTransferCurrency(destinationAccount, currency)) {
    errors.push({ field: 'destinationAccountId', message: 'حساب الوجهة لا يدعم عملة الحركة.' })
  }
  if (type === MOVEMENT_TYPES.USD_SALE) {
    if (sourceAccount && !accountSupportsTransferCurrency(sourceAccount, CURRENCIES.USD)) {
      errors.push({ field: 'sourceAccountId', message: 'بيع الدولار يحتاج حساب دولار كمصدر.' })
    }
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, CURRENCIES.DINAR)) {
      errors.push({ field: 'destinationAccountId', message: 'بيع الدولار يحتاج حساب دينار للوجهة.' })
    }
  }
  if (type === MOVEMENT_TYPES.USD_PURCHASE) {
    if (sourceAccount && !accountSupportsTransferCurrency(sourceAccount, CURRENCIES.DINAR)) {
      errors.push({ field: 'sourceAccountId', message: 'شراء الدولار يحتاج حساب دينار كمصدر.' })
    }
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, CURRENCIES.USD)) {
      errors.push({ field: 'destinationAccountId', message: 'شراء الدولار يحتاج حساب دولار للوجهة.' })
    }
  }
  if ((type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) && (!Number.isFinite(movement?.rate) || movement.rate <= 0)) {
    errors.push({ field: 'rate', message: 'سعر الصرف مطلوب ويجب أن يكون أكبر من صفر.' })
  }

  for (const [field, accountId] of [
    ['sourceAccountId', sourceId],
    ['destinationAccountId', destinationId],
  ]) {
    if (!accountId) continue
    const account = accountMap.get(accountId)
    if (!account) {
      errors.push({ field, message: 'الحساب غير موجود.' })
      continue
    }
    if (account.type === ACCOUNT_TYPES.SUMMARY) {
      errors.push({ field, message: 'حسابات الملخص لا تستخدم كطرف حركة.' })
    }
    if (account.status === ACCOUNT_STATUSES.INACTIVE) {
      errors.push({ field, message: 'الحساب مخفي ولا يستخدم كطرف حركة.' })
    }
    if (account.status === ACCOUNT_STATUSES.NEEDS_REVIEW) {
      warnings.push({ field, message: 'الحساب يحتاج مراجعة قبل الاعتماد النهائي.' })
    }
  }

  if (type === MOVEMENT_TYPES.CORRECTION && !movement?.note) {
    errors.push({ field: 'note', message: 'التصحيح يحتاج ملاحظة توضح السبب.' })
  }

  if (errors.length === 0) {
    errors.push(...validateNonNegativeOwnBalances(movement, accounts, movements, accountMap))
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? MOVEMENT_STATUSES.NEEDS_REVIEW : MOVEMENT_STATUSES.POSTED,
    errors,
    warnings,
  }
}

export function buildPostingEntries(movement) {
  const amount = roundMoney(movement.amount)
  const currency = movement.currency

  if (movement.status && movement.status !== MOVEMENT_STATUSES.POSTED) return []

  switch (movement.type) {
    case MOVEMENT_TYPES.OPENING_BALANCE:
    case MOVEMENT_TYPES.EXTERNAL_INCOME:
    case MOVEMENT_TYPES.TRUCK_INCOME:
      return [{ accountId: movement.destinationAccountId, currency, delta: amount }]
    case MOVEMENT_TYPES.EXPENSE:
    case MOVEMENT_TYPES.TRUCK_EXPENSE:
      return [{ accountId: movement.sourceAccountId, currency, delta: -Math.abs(amount) }]
    case MOVEMENT_TYPES.TRANSFER:
      return [
        { accountId: movement.sourceAccountId, currency, delta: -Math.abs(amount) },
        { accountId: movement.destinationAccountId, currency, delta: Math.abs(amount) },
      ]
    case MOVEMENT_TYPES.USD_SALE:
      return [
        { accountId: movement.sourceAccountId, currency: CURRENCIES.USD, delta: -Math.abs(amount) },
        {
          accountId: movement.destinationAccountId,
          currency: CURRENCIES.DINAR,
          delta: roundMoney(Math.abs(amount) * asNumber(movement.rate)),
        },
      ]
    case MOVEMENT_TYPES.USD_PURCHASE:
      return [
        { accountId: movement.sourceAccountId, currency: CURRENCIES.DINAR, delta: -Math.abs(amount) },
        {
          accountId: movement.destinationAccountId,
          currency: CURRENCIES.USD,
          delta: roundMoney(Math.abs(amount) / asNumber(movement.rate)),
        },
      ]
    case MOVEMENT_TYPES.CORRECTION:
      return [{ accountId: movement.destinationAccountId, currency, delta: amount }]
    default:
      return []
  }
}

export function summarizeBalances(accounts = [], movements = []) {
  const balances = new Map()

  for (const account of accounts) {
    if (account.status === ACCOUNT_STATUSES.INACTIVE) continue
    balances.set(account.id, {
      account,
      dinar: 0,
      usd: 0,
      postedCount: 0,
    })
  }

  for (const movement of movements) {
    if (movement.status !== MOVEMENT_STATUSES.POSTED) continue
    for (const entry of buildPostingEntries(movement)) {
      const bucket = balances.get(entry.accountId)
      if (!bucket) continue
      if (entry.currency === CURRENCIES.DINAR) bucket.dinar = roundMoney(bucket.dinar + entry.delta)
      if (entry.currency === CURRENCIES.USD) bucket.usd = roundMoney(bucket.usd + entry.delta)
      bucket.postedCount += 1
    }
  }

  return Array.from(balances.values())
}

export function getAccountBalance(accountId, accounts = [], movements = []) {
  return summarizeBalances(accounts, movements).find((bucket) => bucket.account.id === accountId) || null
}

export function previewMovement(movement, accounts = [], movements = []) {
  const validation = validateMovement(movement, accounts, movements)
  const before = summarizeBalances(accounts, movements)
  const beforeById = new Map(before.map((bucket) => [bucket.account.id, bucket]))
  const postingEntries = validation.ok ? buildPostingEntries({ ...movement, status: MOVEMENT_STATUSES.POSTED }) : []

  return {
    validation,
    effects: postingEntries.map((entry) => {
      const current = beforeById.get(entry.accountId)
      const beforeDinar = current?.dinar || 0
      const beforeUsd = current?.usd || 0
      return {
        accountId: entry.accountId,
        account: current?.account || null,
        currency: entry.currency,
        delta: entry.delta,
        before: entry.currency === CURRENCIES.DINAR ? beforeDinar : beforeUsd,
        after: roundMoney((entry.currency === CURRENCIES.DINAR ? beforeDinar : beforeUsd) + entry.delta),
      }
    }),
  }
}

export function postMovement(movement, accounts = [], movements = []) {
  const validation = validateMovement(movement, accounts, movements)
  const now = isoNow()
  return {
    ...movement,
    id: movement.id || `movement-${now}-${Math.random().toString(36).slice(2, 8)}`,
    status: validation.status,
    validation,
    createdAt: movement.createdAt || now,
    updatedAt: now,
  }
}

export function createAccount({
  id,
  ownerName,
  subAccountName,
  type,
  valueKind,
  openingDinar = 0,
  openingUsd = 0,
  currencyKind,
  notes = '',
  status = ACCOUNT_STATUSES.ACTIVE,
}) {
  const normalizedOwner = String(ownerName || '').trim()
  const normalizedSub = canonicalAccountDetail(subAccountName)
  const normalizedType = type || ACCOUNT_TYPES.PERSON
  const normalizedValueKind = valueKind || 'receivable'
  const stableBase = `${normalizedOwner}-${normalizedSub || normalizedType}`
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
  const normalizedCurrencyKind = normalizeAccountCurrencyKind(currencyKind, inferAccountCurrencyKind({
    ownerName: normalizedOwner,
    subAccountName: normalizedSub,
    openingDinar,
    openingUsd,
  }))
  const stableCurrencySuffix = normalizedCurrencyKind === 'multi' ? 'multi' : normalizedCurrencyKind.toLowerCase()

  return {
    id: id || `account-${stableBase || Date.now()}-${stableCurrencySuffix}`,
    legacyName: normalizedSub ? `${normalizedOwner} / ${normalizedSub}` : normalizedOwner,
    ownerName: normalizedOwner,
    subAccountName: normalizedSub || 'رئيسي',
    type: normalizedType,
    valueKind: normalizedValueKind,
    openingDinar: roundMoney(openingDinar),
    openingUsd: roundMoney(openingUsd),
    currencyKind: normalizedCurrencyKind,
    status,
    notes,
    createdFrom: 'manual',
    createdAt: isoNow(),
  }
}

export function validateAccount(account, existingAccounts = []) {
  const errors = []
  const ownerName = String(account?.ownerName || '').trim()
  const subAccountName = canonicalAccountDetail(account?.subAccountName)
  if (!account?.ownerName?.trim()) errors.push({ field: 'ownerName', message: 'الاسم الرئيسي مطلوب.' })
  if (!account?.subAccountName?.trim()) {
    errors.push({ field: 'subAccountName', message: 'نوع/اسم الحساب الفرعي مطلوب.' })
  }
  if (!Object.values(ACCOUNT_TYPES).includes(account?.type)) {
    errors.push({ field: 'type', message: 'نوع الحساب غير معروف.' })
  }
  if (existingAccounts.some((item) => item.id === account?.id)) {
    errors.push({ field: 'id', message: 'معرف الحساب مستخدم مسبقًا.' })
  }
  const hasDuplicateLogicalAccount = existingAccounts.some((item) => {
    if (!item || item.status === ACCOUNT_STATUSES.INACTIVE) return false
    return (
      String(item.ownerName || '').trim() === ownerName &&
      canonicalAccountDetail(item.subAccountName) === subAccountName &&
      normalizeAccountCurrencyKind(item.currencyKind, inferAccountCurrencyKind(item)) === normalizeAccountCurrencyKind(account.currencyKind, inferAccountCurrencyKind(account))
    )
  })
  if (ownerName && subAccountName && hasDuplicateLogicalAccount) {
    errors.push({ field: 'subAccountName', message: 'يوجد حساب بنفس الاسم ونفس التفصيل.' })
  }

  return { ok: errors.length === 0, errors }
}

export function voidMovement(movement, reason = '', voidedAt = isoNow()) {
  if (!movement || movement.status !== MOVEMENT_STATUSES.POSTED) {
    return {
      movement,
      ok: false,
      error: 'يمكن إلغاء الحركات المعتمدة فقط.',
    }
  }

  return {
    ok: true,
    movement: {
      ...movement,
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: reason,
      voidedAt,
      updatedAt: voidedAt,
    },
  }
}

export function formatBalanceMeaning(account, amount) {
  const value = Math.round(asNumber(amount))
  const formatted = Math.abs(value).toLocaleString('en-US')
  if (!value) return 'مسكر'
  if (account?.valueKind === 'expense') return `تكلفة ${formatted}`
  if (account?.valueKind === 'asset') return `قيمة/رصيد أصل ${formatted}`
  if (account?.valueKind === 'cash' || account?.valueKind === 'bank') {
    return value > 0 ? `موجود ${formatted}` : `ناقص ${formatted}`
  }
  return value > 0 ? `أقبض منه ${formatted}` : `أدفع له ${formatted}`
}
