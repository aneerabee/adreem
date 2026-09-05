import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS, buildAccountMap, inferAccountCurrencyKind, normalizeAccountCurrencyKind } from './accountCatalog.js'
import { counterpartyAccountChannels } from './accountConfig.js'
import {
  accountSupportsTransferCurrency,
  areTransferAccountsCompatible,
  canonicalAccountDetail,
  normalizeAccountText,
  sameLogicalAccount,
  transferCompatibilityMessage,
} from './accountCompatibility.js'
import { ACCOUNT_SUMMARY_SCOPES, accountSummaryScope, accountSupportsNetScope } from './ledgerScope.js'

export const CURRENCIES = {
  DINAR: 'LYD',
  USD: 'USD',
  TRY: 'TRY',
  EUR: 'EUR',
}

export const MAX_MONEY_AMOUNT = 999_999_999_999_999
export const MAX_EXCHANGE_RATE = 9_999_999

export const MOVEMENT_TYPES = {
  OPENING_BALANCE: 'opening_balance',
  TRANSFER: 'transfer',
  CASH_DEPOSIT: 'cash_deposit',
  CASH_WITHDRAWAL: 'cash_withdrawal',
  EXPENSE: 'expense',
  TRUCK_EXPENSE: 'truck_expense',
  TRUCK_INCOME: 'truck_income',
  USD_SALE: 'usd_sale',
  USD_PURCHASE: 'usd_purchase',
  EXTERNAL_INCOME: 'external_income',
  CORRECTION: 'correction',
  RECORD_ONLY: 'record_only',
}

export const MOVEMENT_STATUSES = {
  DRAFT: 'draft',
  NEEDS_REVIEW: 'needs_review',
  POSTED: 'posted',
  VOIDED: 'voided',
}

const TWO_SIDED_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.CASH_DEPOSIT,
  MOVEMENT_TYPES.CASH_WITHDRAWAL,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
])

const SOURCE_REQUIRED_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.CASH_DEPOSIT,
  MOVEMENT_TYPES.CASH_WITHDRAWAL,
  MOVEMENT_TYPES.EXPENSE,
  MOVEMENT_TYPES.TRUCK_EXPENSE,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
])

const DESTINATION_REQUIRED_TYPES = new Set([
  MOVEMENT_TYPES.OPENING_BALANCE,
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.CASH_DEPOSIT,
  MOVEMENT_TYPES.CASH_WITHDRAWAL,
  MOVEMENT_TYPES.TRUCK_INCOME,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
  MOVEMENT_TYPES.EXTERNAL_INCOME,
  MOVEMENT_TYPES.CORRECTION,
])

const optimisticPreviousMovements = new WeakMap()

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isoNow() {
  return new Date().toISOString()
}

export function roundMoney(value) {
  return Math.round(asNumber(value))
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
        note: account.createdFrom === 'synthetic_fixture'
          ? `رصيد افتتاحي من Numbers: ${account.legacyName}`
          : `رصيد افتتاحي: ${account.legacyName}`,
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
        note: account.createdFrom === 'synthetic_fixture'
          ? `رصيد افتتاحي USD من Numbers: ${account.legacyName}`
          : `رصيد افتتاحي: ${account.legacyName}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    if (asNumber(account.openingTry)) {
      entries.push({
        id: `opening-${account.id}-try`,
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.TRY,
        amount: roundMoney(account.openingTry),
        destinationAccountId: account.id,
        sourceAccountId: null,
        note: `رصيد افتتاحي: ${account.legacyName}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    if (asNumber(account.openingEur)) {
      entries.push({
        id: `opening-${account.id}-eur`,
        type: MOVEMENT_TYPES.OPENING_BALANCE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.EUR,
        amount: roundMoney(account.openingEur),
        destinationAccountId: account.id,
        sourceAccountId: null,
        note: `رصيد افتتاحي: ${account.legacyName}`,
        createdAt,
        updatedAt: createdAt,
      })
    }
    return entries
  })
}

export function currencyBalanceField(currency) {
  if (currency === CURRENCIES.EUR) return 'eur'
  if (currency === CURRENCIES.USD) return 'usd'
  if (currency === CURRENCIES.TRY) return 'try'
  return 'dinar'
}

function balanceValueForCurrency(bucket, currency) {
  return Number(bucket?.[currencyBalanceField(currency)] || 0)
}

function cannotGoNegative(account) {
  return account?.valueKind === VALUE_KINDS.CASH ||
    account?.valueKind === VALUE_KINDS.BANK ||
    account?.valueKind === VALUE_KINDS.ASSET
}

function hasDatabaseBalance(account) {
  return account?.balanceSource === 'database' &&
    Number.isFinite(Number(account.balanceDinar)) &&
    Number.isFinite(Number(account.balanceUsd)) &&
    Number.isFinite(Number(account.balanceTry ?? 0)) &&
    Number.isFinite(Number(account.balanceEur ?? 0))
}

function validateNonNegativeOwnBalances(movement, accounts = [], movements = [], accountMap = buildAccountMap(accounts), options = {}) {
  const errors = []
  const balances = summarizeBalances(accounts, movements)
  const balanceById = new Map(balances.map((bucket) => [bucket.account.id, bucket]))
  const adjustments = new Map()
  const addAdjustment = (entry, direction = 1) => {
    if (!entry?.accountId || !entry.currency) return
    const key = `${entry.accountId}:${entry.currency}`
    adjustments.set(key, {
      accountId: entry.accountId,
      currency: entry.currency,
      delta: roundMoney((adjustments.get(key)?.delta || 0) + (entry.delta * direction)),
    })
  }
  const originalMovement = options.originalMovement
  const originalEntries = originalMovement?.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(originalMovement) : []
  const balancesIncludeOriginal = originalEntries.length > 0 && (
    originalEntries.every((entry) => hasDatabaseBalance(accountMap.get(entry.accountId))) ||
    movements.some((item) => item?.id === originalMovement.id)
  )
  if (balancesIncludeOriginal) {
    originalEntries.forEach((entry) => addAdjustment(entry, -1))
  }
  buildPostingEntries({
    ...movement,
    status: options.candidateStatus || MOVEMENT_STATUSES.POSTED,
  }).forEach((entry) => addAdjustment(entry))

  for (const entry of adjustments.values()) {
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

export function validateMovement(movement, accounts = [], movements = [], options = {}) {
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
  if (typeof amount === 'number' && Number.isFinite(amount) && (!Number.isInteger(amount) || Math.abs(amount) > MAX_MONEY_AMOUNT)) {
    errors.push({ field: 'amount', message: 'القيمة يجب أن تكون عددًا صحيحًا ضمن الحد المسموح.' })
  }
  if (![MOVEMENT_TYPES.CORRECTION, MOVEMENT_TYPES.OPENING_BALANCE].includes(type) && typeof amount === 'number' && Number.isFinite(amount) && amount <= 0) {
    errors.push({ field: 'amount', message: 'القيمة يجب أن تكون أكبر من صفر.' })
  }
  if (!currency || !Object.values(CURRENCIES).includes(currency)) {
    errors.push({ field: 'currency', message: 'العملة مطلوبة.' })
  }
  if (type === MOVEMENT_TYPES.USD_SALE && currency && currency !== CURRENCIES.USD) {
    errors.push({ field: 'currency', message: 'بيع USD يبدأ بمبلغ USD.' })
  }
  if (type === MOVEMENT_TYPES.USD_PURCHASE && currency && currency !== CURRENCIES.DINAR) {
    errors.push({ field: 'currency', message: 'شراء USD يبدأ بمبلغ LYD.' })
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
  if (type === MOVEMENT_TYPES.OPENING_BALANCE) {
    if (sourceId) errors.push({ field: 'sourceAccountId', message: 'الرصيد الافتتاحي لا يحتاج حساب مصدر.' })
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, currency)) {
      errors.push({ field: 'destinationAccountId', message: 'عملة الرصيد الافتتاحي لا تطابق عملة الحساب.' })
    }
  }
  if (type === MOVEMENT_TYPES.CASH_DEPOSIT || type === MOVEMENT_TYPES.CASH_WITHDRAWAL) {
    const expectedSourceKind = type === MOVEMENT_TYPES.CASH_DEPOSIT ? VALUE_KINDS.CASH : VALUE_KINDS.BANK
    const expectedDestinationKind = type === MOVEMENT_TYPES.CASH_DEPOSIT ? VALUE_KINDS.BANK : VALUE_KINDS.CASH
    if (sourceAccount && sourceAccount.valueKind !== expectedSourceKind) {
      errors.push({ field: 'sourceAccountId', message: type === MOVEMENT_TYPES.CASH_DEPOSIT ? 'الإيداع يبدأ من حساب كاش.' : 'السحب يبدأ من حساب مصرفي.' })
    }
    if (destinationAccount && destinationAccount.valueKind !== expectedDestinationKind) {
      errors.push({ field: 'destinationAccountId', message: type === MOVEMENT_TYPES.CASH_DEPOSIT ? 'الإيداع ينتهي في حساب مصرفي.' : 'السحب ينتهي في حساب كاش.' })
    }
    if (sourceAccount && !accountSupportsTransferCurrency(sourceAccount, currency)) {
      errors.push({ field: 'sourceAccountId', message: 'حساب المصدر لا يدعم عملة الحركة.' })
    }
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, currency)) {
      errors.push({ field: 'destinationAccountId', message: 'حساب الوجهة لا يدعم عملة الحركة.' })
    }
  }
  if ((type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE) && sourceAccount && !accountSupportsTransferCurrency(sourceAccount, currency)) {
    errors.push({ field: 'sourceAccountId', message: 'حساب المصروف لا يدعم عملة الحركة.' })
  }
  if ((type === MOVEMENT_TYPES.EXTERNAL_INCOME || type === MOVEMENT_TYPES.TRUCK_INCOME || type === MOVEMENT_TYPES.CORRECTION) && destinationAccount && !accountSupportsTransferCurrency(destinationAccount, currency)) {
    errors.push({ field: 'destinationAccountId', message: 'حساب الوجهة لا يدعم عملة الحركة.' })
  }
  if (type === MOVEMENT_TYPES.USD_SALE) {
    if (sourceAccount && !accountSupportsTransferCurrency(sourceAccount, CURRENCIES.USD)) {
      errors.push({ field: 'sourceAccountId', message: 'بيع USD يحتاج حساب USD كمصدر.' })
    }
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, CURRENCIES.DINAR)) {
      errors.push({ field: 'destinationAccountId', message: 'بيع USD يحتاج حساب LYD للوجهة.' })
    }
  }
  if (type === MOVEMENT_TYPES.USD_PURCHASE) {
    if (sourceAccount && !accountSupportsTransferCurrency(sourceAccount, CURRENCIES.DINAR)) {
      errors.push({ field: 'sourceAccountId', message: 'شراء USD يحتاج حساب LYD كمصدر.' })
    }
    if (destinationAccount && !accountSupportsTransferCurrency(destinationAccount, CURRENCIES.USD)) {
      errors.push({ field: 'destinationAccountId', message: 'شراء USD يحتاج حساب USD للوجهة.' })
    }
  }
  if ((type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) && (!Number.isFinite(movement?.rate) || movement.rate <= 0)) {
    errors.push({ field: 'rate', message: 'سعر الصرف مطلوب ويجب أن يكون أكبر من صفر.' })
  }
  if ((type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) && Number(movement?.rate) > MAX_EXCHANGE_RATE) {
    errors.push({ field: 'rate', message: 'سعر الصرف أكبر من الحد المسموح.' })
  }
  if (
    type === MOVEMENT_TYPES.USD_SALE &&
    Number.isFinite(amount) &&
    Number.isFinite(movement?.rate) &&
    movement.rate > 0 &&
    Math.round(Math.abs(amount) * movement.rate) === 0
  ) {
    errors.push({ field: 'rate', message: 'نتيجة بيع USD أقل من أصغر قيمة يمكن تسجيلها.' })
  }
  if (
    type === MOVEMENT_TYPES.USD_PURCHASE &&
    Number.isFinite(amount) &&
    Number.isFinite(movement?.rate) &&
    movement.rate > 0 &&
    Math.round(Math.abs(amount) / movement.rate) === 0
  ) {
    errors.push({ field: 'rate', message: 'نتيجة شراء USD أقل من أصغر قيمة يمكن تسجيلها.' })
  }

  if (errors.length === 0) {
    const unsafeEntry = buildPostingEntries({ ...movement, status: MOVEMENT_STATUSES.POSTED })
      .find((entry) => !Number.isSafeInteger(entry.delta) || Math.abs(entry.delta) > MAX_MONEY_AMOUNT)
    if (unsafeEntry) errors.push({ field: 'amount', message: 'نتيجة الحركة أكبر من الحد المسموح.' })
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
    if (account.valueKind === VALUE_KINDS.PROJECT || account.valueKind === VALUE_KINDS.EXPENSE) {
      errors.push({ field, message: 'المشروع أو نوع المصروف يستخدم للتصنيف فقط، وليس كحساب فلوس.' })
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
  if (type === MOVEMENT_TYPES.RECORD_ONLY) {
    if (sourceId) errors.push({ field: 'sourceAccountId', message: 'التسجيل فقط لا يرتبط بحساب مصدر.' })
    if (destinationId) errors.push({ field: 'destinationAccountId', message: 'التسجيل فقط لا يرتبط بحساب وجهة.' })
    if (!String(movement?.note || '').trim()) errors.push({ field: 'note', message: 'اكتب ملاحظة توضح ما تريد تسجيله.' })
    if (String(movement?.relatedName || '').trim().length > 120) errors.push({ field: 'relatedName', message: 'الاسم المرتبط أطول من الحد المسموح.' })
    if (movement?.recordDirection && !['receivable', 'payable', 'note'].includes(movement.recordDirection)) {
      errors.push({ field: 'recordDirection', message: 'اتجاه السجل المنفصل غير معروف.' })
    }
    if (movement?.separateRecordPinned !== undefined && typeof movement.separateRecordPinned !== 'boolean') {
      errors.push({ field: 'separateRecordPinned', message: 'حالة تمييز الحساب المنفصل غير صالحة.' })
    }
  }
  if ((type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE) && movement?.expenseCategoryId) {
    const category = accountMap.get(movement.expenseCategoryId)
    if (!category || category.valueKind !== VALUE_KINDS.EXPENSE || category.status !== ACCOUNT_STATUSES.ACTIVE) {
      errors.push({ field: 'expenseCategoryId', message: 'نوع المصروف المختار غير صالح.' })
    }
  }

  if (errors.length === 0) {
    errors.push(...validateNonNegativeOwnBalances(movement, accounts, movements, accountMap, options))
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
    case MOVEMENT_TYPES.CASH_DEPOSIT:
    case MOVEMENT_TYPES.CASH_WITHDRAWAL:
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
          delta: Math.round(Math.abs(amount) * asNumber(movement.rate)),
        },
      ]
    case MOVEMENT_TYPES.USD_PURCHASE:
      return [
        { accountId: movement.sourceAccountId, currency: CURRENCIES.DINAR, delta: -Math.abs(amount) },
        {
          accountId: movement.destinationAccountId,
          currency: CURRENCIES.USD,
          delta: Math.round(Math.abs(amount) / asNumber(movement.rate)),
        },
      ]
    case MOVEMENT_TYPES.CORRECTION:
      return [{ accountId: movement.destinationAccountId, currency, delta: amount }]
    case MOVEMENT_TYPES.RECORD_ONLY:
      return []
    default:
      return []
  }
}

export function markOptimisticMovementChange(candidateMovement, previousMovement) {
  if (candidateMovement && typeof candidateMovement === 'object' && previousMovement && typeof previousMovement === 'object') {
    optimisticPreviousMovements.set(candidateMovement, optimisticPreviousMovements.get(previousMovement) || previousMovement)
  }
  return candidateMovement
}

export function summarizeBalances(accounts = [], movements = []) {
  const activeAccounts = accounts.filter((account) => account.status !== ACCOUNT_STATUSES.INACTIVE)
  const databaseAccountIds = new Set(activeAccounts.filter(hasDatabaseBalance).map((account) => account.id))
  const balances = new Map(activeAccounts.map((account) => [account.id, {
      account,
      dinar: databaseAccountIds.has(account.id) ? roundMoney(Number(account.balanceDinar)) : 0,
      usd: databaseAccountIds.has(account.id) ? roundMoney(Number(account.balanceUsd)) : 0,
      try: databaseAccountIds.has(account.id) ? roundMoney(Number(account.balanceTry || 0)) : 0,
      eur: databaseAccountIds.has(account.id) ? roundMoney(Number(account.balanceEur || 0)) : 0,
      postedCount: databaseAccountIds.has(account.id) ? Math.max(0, Math.round(Number(account.postedCount || 0))) : 0,
    }]))

  const applyEntry = (entry, direction = 1, databaseOnly = false) => {
    const bucket = balances.get(entry.accountId)
    if (!bucket || (databaseOnly && !databaseAccountIds.has(entry.accountId))) return
    const field = currencyBalanceField(entry.currency)
    bucket[field] = roundMoney(bucket[field] + (entry.delta * direction))
    bucket.postedCount = Math.max(0, bucket.postedCount + direction)
  }

  for (const movement of movements) {
    const previousMovement = optimisticPreviousMovements.get(movement)
    if (previousMovement?.status === MOVEMENT_STATUSES.POSTED) {
      buildPostingEntries(previousMovement).forEach((entry) => applyEntry(entry, -1, true))
    }
    if (movement.status !== MOVEMENT_STATUSES.POSTED) continue
    const persistedWithoutLocalChange = Number.isSafeInteger(movement.databaseSequence) && !previousMovement
    for (const entry of buildPostingEntries(movement)) {
      if (persistedWithoutLocalChange && databaseAccountIds.has(entry.accountId)) continue
      applyEntry(entry)
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
      const balanceField = currencyBalanceField(entry.currency)
      const before = current?.[balanceField] || 0
      return {
        accountId: entry.accountId,
        account: current?.account || null,
        currency: entry.currency,
        delta: entry.delta,
        before,
        after: roundMoney(before + entry.delta),
      }
    }),
  }
}

export function postMovement(movement, accounts = [], movements = [], options = {}) {
  const validation = validateMovement(movement, accounts, movements, options)
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

export function validateMovementBalanceTransition(originalMovement, candidateMovement, accounts = [], movements = []) {
  const errors = validateNonNegativeOwnBalances(
    candidateMovement,
    accounts,
    movements,
    buildAccountMap(accounts),
    {
      originalMovement,
      candidateStatus: candidateMovement?.status || MOVEMENT_STATUSES.NEEDS_REVIEW,
    },
  )
  return { ok: errors.length === 0, errors }
}

export function createAccount({
  id,
  ownerName,
  subAccountName,
  type,
  valueKind,
  openingDinar = 0,
  openingUsd = 0,
  openingTry = 0,
  openingEur = 0,
  currencyKind,
  notes = '',
  status = ACCOUNT_STATUSES.ACTIVE,
  counterpartyId = '',
  counterpartyKind = '',
  summaryScope,
}) {
  const normalizedOwner = normalizeAccountText(ownerName)
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
    openingTry,
    openingEur,
  }))
  const stableCurrencySuffix = normalizedCurrencyKind === 'multi' ? 'multi' : normalizedCurrencyKind.toLowerCase()
  const normalizedSummaryScope = accountSummaryScope({ valueKind: normalizedValueKind, summaryScope })

  return {
    id: id || `account-${stableBase || Date.now()}-${stableCurrencySuffix}`,
    legacyName: normalizedSub ? `${normalizedOwner} / ${normalizedSub}` : normalizedOwner,
    ownerName: normalizedOwner,
    subAccountName: normalizedSub || 'رئيسي',
    type: normalizedType,
    valueKind: normalizedValueKind,
    openingDinar: roundMoney(openingDinar),
    openingUsd: roundMoney(openingUsd),
    openingTry: roundMoney(openingTry),
    openingEur: roundMoney(openingEur),
    currencyKind: normalizedCurrencyKind,
    status,
    notes,
    ...(counterpartyId ? { counterpartyId: String(counterpartyId).trim() } : {}),
    ...(counterpartyKind ? { counterpartyKind: String(counterpartyKind).trim() } : {}),
    ...(normalizedSummaryScope ? { summaryScope: normalizedSummaryScope } : {}),
    createdFrom: 'manual',
    createdAt: isoNow(),
  }
}

export function validateAccount(account, existingAccounts = []) {
  const errors = []
  const ownerName = normalizeAccountText(account?.ownerName)
  const subAccountName = canonicalAccountDetail(account?.subAccountName)
  if (!account?.ownerName?.trim()) errors.push({ field: 'ownerName', message: 'الاسم الرئيسي مطلوب.' })
  if (!account?.subAccountName?.trim()) {
    errors.push({ field: 'subAccountName', message: 'نوع/اسم الحساب الفرعي مطلوب.' })
  }
  if (!Object.values(ACCOUNT_TYPES).includes(account?.type)) {
    errors.push({ field: 'type', message: 'نوع الحساب غير معروف.' })
  }
  if (!Object.values(ACCOUNT_CURRENCY_KINDS).includes(account?.currencyKind)) {
    errors.push({ field: 'currencyKind', message: 'عملة الحساب غير معروفة.' })
  }
  const openingDinar = Number(account?.openingDinar || 0)
  const openingUsd = Number(account?.openingUsd || 0)
  const openingTry = Number(account?.openingTry || 0)
  const openingEur = Number(account?.openingEur || 0)
  for (const [field, amount] of [['openingDinar', openingDinar], ['openingUsd', openingUsd], ['openingTry', openingTry], ['openingEur', openingEur]]) {
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_MONEY_AMOUNT) {
      errors.push({ field, message: 'الرصيد الافتتاحي يجب أن يكون عددًا صحيحًا ضمن الحد المسموح.' })
    }
  }
  const hasOpeningBalance = openingDinar !== 0 || openingUsd !== 0 || openingTry !== 0 || openingEur !== 0
  const supportsOpeningBalance = [VALUE_KINDS.RECEIVABLE, VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.ASSET].includes(account?.valueKind)
  if (hasOpeningBalance && !supportsOpeningBalance) {
    errors.push({ field: 'openingDinar', message: 'هذا النوع لا يحمل رصيدًا افتتاحيًا.' })
  }
  if (cannotGoNegative(account) && openingDinar < 0) {
    errors.push({ field: 'openingDinar', message: 'فلوسك أو قيمة الأصل لا يمكن أن تبدأ بالسالب.' })
  }
  if (cannotGoNegative(account) && openingUsd < 0) {
    errors.push({ field: 'openingUsd', message: 'فلوسك أو قيمة الأصل لا يمكن أن تبدأ بالسالب.' })
  }
  if (cannotGoNegative(account) && openingTry < 0) {
    errors.push({ field: 'openingTry', message: 'فلوسك أو قيمة الأصل لا يمكن أن تبدأ بالسالب.' })
  }
  if (cannotGoNegative(account) && openingEur < 0) {
    errors.push({ field: 'openingEur', message: 'فلوسك أو قيمة الأصل لا يمكن أن تبدأ بالسالب.' })
  }
  const currencyKind = normalizeAccountCurrencyKind(account?.currencyKind, inferAccountCurrencyKind(account))
  if (accountSupportsNetScope(account) && account?.summaryScope && !Object.values(ACCOUNT_SUMMARY_SCOPES).includes(account.summaryScope)) {
    errors.push({ field: 'summaryScope', message: 'حالة الحساب في الصافي غير معروفة.' })
  }
  if (!accountSupportsNetScope(account) && account?.summaryScope) {
    errors.push({ field: 'summaryScope', message: 'هذا النوع لا يدخل في الصافي العام.' })
  }
  const openingByCurrency = {
    [CURRENCIES.DINAR]: openingDinar,
    [CURRENCIES.USD]: openingUsd,
    [CURRENCIES.TRY]: openingTry,
    [CURRENCIES.EUR]: openingEur,
  }
  if (currencyKind !== 'multi' && Object.entries(openingByCurrency).some(([currency, amount]) => currency !== currencyKind && amount !== 0)) {
    errors.push({ field: 'currencyKind', message: 'الرصيد الافتتاحي يجب أن يطابق عملة الحساب.' })
  }
  if (existingAccounts.some((item) => item.id === account?.id)) {
    errors.push({ field: 'id', message: 'معرف الحساب مستخدم مسبقًا.' })
  }
  const hasDuplicateLogicalAccount = account.status !== ACCOUNT_STATUSES.INACTIVE && existingAccounts.some((item) => {
    if (!item || item.status === ACCOUNT_STATUSES.INACTIVE) return false
    return (
      normalizeAccountText(item.ownerName) === ownerName &&
      canonicalAccountDetail(item.subAccountName) === subAccountName &&
      normalizeAccountCurrencyKind(item.currencyKind, inferAccountCurrencyKind(item)) === normalizeAccountCurrencyKind(account.currencyKind, inferAccountCurrencyKind(account))
    )
  })
  if (ownerName && subAccountName && hasDuplicateLogicalAccount) {
    errors.push({ field: 'subAccountName', message: 'يوجد حساب بنفس الاسم ونفس التفصيل.' })
  }
  if (account?.counterpartyId || account?.counterpartyKind) {
    const channel = counterpartyAccountChannels.find((item) => item.key === account.counterpartyKind)
    if (!String(account.counterpartyId || '').trim()) {
      errors.push({ field: 'counterpartyId', message: 'ربط الشخص بالحسابات الثلاثة غير مكتمل.' })
    }
    if (!channel) {
      errors.push({ field: 'counterpartyKind', message: 'نوع رصيد الشخص غير معروف.' })
    } else if (
      account.type !== ACCOUNT_TYPES.PERSON ||
      account.valueKind !== VALUE_KINDS.RECEIVABLE ||
      canonicalAccountDetail(account.subAccountName) !== canonicalAccountDetail(channel.subAccountName) ||
      normalizeAccountCurrencyKind(account.currencyKind, inferAccountCurrencyKind(account)) !== channel.currencyKind
    ) {
      errors.push({ field: 'counterpartyKind', message: 'نوع رصيد الشخص لا يطابق العملة أو طريقة التعامل.' })
    }
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

export function canCommitMovementEdit(originalMovement, candidateMovement) {
  if (!originalMovement) return true
  const changesPostingMode = originalMovement.type !== candidateMovement?.type && (
    originalMovement.type === MOVEMENT_TYPES.RECORD_ONLY || candidateMovement?.type === MOVEMENT_TYPES.RECORD_ONLY
  )
  if (changesPostingMode) return false
  if (originalMovement.status === MOVEMENT_STATUSES.POSTED) {
    return candidateMovement?.status === MOVEMENT_STATUSES.POSTED
  }
  return originalMovement.status === MOVEMENT_STATUSES.NEEDS_REVIEW
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
