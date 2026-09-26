import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog'
import { accountDetailName, counterpartyGroupKey } from './accountConfig'
import { groupAccountsForDisplay } from './accountDisplayGroups'
import { CURRENCIES, createAccount, validateAccount } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'
import { compareBalanceBuckets } from './accountPresentation'
import { hasMoneyValue } from './ledgerFormat'
import { CURRENCY_OPTIONS, currencyField, EXPENSE_CATEGORY_TONES } from './ledgerUiConfig'
import { nonZero } from './movementPresentation'

export function buildPeopleAccountViews(rows = []) {
  const sorted = [...rows].sort(compareBalanceBuckets)
  const withBalance = sorted.filter(nonZero)
  const signedView = (bucket, direction) => ({
    ...bucket,
    dinar: direction > 0 ? Math.max(0, Number(bucket.dinar || 0)) : Math.min(0, Number(bucket.dinar || 0)),
    usd: direction > 0 ? Math.max(0, Number(bucket.usd || 0)) : Math.min(0, Number(bucket.usd || 0)),
    try: direction > 0 ? Math.max(0, Number(bucket.try || 0)) : Math.min(0, Number(bucket.try || 0)),
    eur: direction > 0 ? Math.max(0, Number(bucket.eur || 0)) : Math.min(0, Number(bucket.eur || 0)),
  })
  const positive = withBalance.map((bucket) => signedView(bucket, 1)).filter(nonZero).sort(compareBalanceBuckets)
  const negative = withBalance.map((bucket) => signedView(bucket, -1)).filter(nonZero).sort(compareBalanceBuckets)
  const zero = sorted.filter((bucket) => !nonZero(bucket))
  return {
    positive,
    negative,
    zero,
    withBalance,
    all: sorted,
  }
}

export function buildBalanceOverview(rows = []) {
  let cashDinar = 0
  let cashUsd = 0
  let cashTry = 0
  let cashEur = 0
  let bankDinar = 0
  let bankUsd = 0
  let bankTry = 0
  let bankEur = 0
  const cardDebt = { dinar: 0, usd: 0, try: 0, eur: 0 }
  let receivableDinar = 0
  let receivableUsd = 0
  let receivableTry = 0
  let receivableEur = 0
  let payableDinar = 0
  let payableUsd = 0
  let payableTry = 0
  let payableEur = 0
  for (const bucket of rows) {
    const kind = bucket.account?.valueKind
    const dinar = Number(bucket.dinar || 0)
    const usd = Number(bucket.usd || 0)
    const tryAmount = Number(bucket.try || 0)
    const eurAmount = Number(bucket.eur || 0)
    if (kind === VALUE_KINDS.CASH) {
      cashDinar += dinar
      cashUsd += usd
      cashTry += tryAmount
      cashEur += eurAmount
    }
    if (kind === VALUE_KINDS.BANK) {
      bankDinar += dinar
      bankUsd += usd
      bankTry += tryAmount
      bankEur += eurAmount
    }
    if (kind === VALUE_KINDS.CREDIT_CARD) {
      cardDebt.dinar += Math.abs(Math.min(0, dinar))
      cardDebt.usd += Math.abs(Math.min(0, usd))
      cardDebt.try += Math.abs(Math.min(0, tryAmount))
      cardDebt.eur += Math.abs(Math.min(0, eurAmount))
    }
    if (kind === VALUE_KINDS.RECEIVABLE) {
      if (dinar > 0) receivableDinar += dinar
      if (dinar < 0) payableDinar += Math.abs(dinar)
      if (usd > 0) receivableUsd += usd
      if (usd < 0) payableUsd += Math.abs(usd)
      if (tryAmount > 0) receivableTry += tryAmount
      if (eurAmount > 0) receivableEur += eurAmount
      if (tryAmount < 0) payableTry += Math.abs(tryAmount)
      if (eurAmount < 0) payableEur += Math.abs(eurAmount)
    }
  }
  return {
    cash: { dinar: cashDinar, usd: cashUsd, try: cashTry, eur: cashEur },
    bank: { dinar: bankDinar, usd: bankUsd, try: bankTry, eur: bankEur },
    money: { dinar: cashDinar + bankDinar, usd: cashUsd + bankUsd, try: cashTry + bankTry, eur: cashEur + bankEur },
    receivable: { dinar: receivableDinar, usd: receivableUsd, try: receivableTry, eur: receivableEur },
    payable: { dinar: payableDinar, usd: payableUsd, try: payableTry, eur: payableEur },
    cardDebt,
  }
}

export function netContributionDisplayValues(item = {}) {
  return CURRENCY_OPTIONS
    .map((option) => ({ currency: option.value, amount: Number(item[option.field] || 0) }))
    .filter((value) => Number.isFinite(value.amount) && value.amount !== 0)
}

export function groupNetContributionsForDisplay(items = []) {
  const itemByAccountId = new Map(items
    .filter((item) => item?.accountId && item?.account)
    .map((item) => [item.accountId, item]))
  return groupAccountsForDisplay(items.map((item) => item?.account).filter(Boolean))
    .map((group) => ({
      ...group,
      items: group.accounts.map((account) => itemByAccountId.get(account.id)).filter(Boolean),
    }))
}

export function expenseCategoryTone(value = '') {
  const normalized = normalizeAccountSearchText(value) || 'uncategorized'
  let hash = 0
  for (const character of normalized) hash = ((hash * 31) + character.codePointAt(0)) >>> 0
  return EXPENSE_CATEGORY_TONES[hash % EXPENSE_CATEGORY_TONES.length]
}

export function prepareExpenseCategoryAccount(name, existingAccounts = []) {
  const account = createAccount({
    ownerName: String(name || '').trim(),
    subAccountName: 'مصروف',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
  })
  const validation = validateAccount(account, existingAccounts)
  const normalizedName = normalizeAccountSearchText(account.ownerName)
  const hasDuplicateCategory = normalizedName && existingAccounts.some((existingAccount) => (
    existingAccount?.status !== ACCOUNT_STATUSES.INACTIVE &&
    existingAccount?.valueKind === VALUE_KINDS.EXPENSE &&
    normalizeAccountSearchText(existingAccount.ownerName) === normalizedName
  ))
  if (!hasDuplicateCategory) return { account, validation }
  return {
    account,
    validation: {
      ok: false,
      errors: [
        ...validation.errors.filter((error) => error.field !== 'subAccountName'),
        { field: 'ownerName', message: 'يوجد تصنيف مصروف بنفس الاسم.' },
      ],
    },
  }
}

export function buildExpenseBalanceRows(accounts = [], reports = []) {
  const categoryAccounts = new Map(
    accounts
      .filter((account) => account?.valueKind === VALUE_KINDS.EXPENSE)
      .map((account) => [account.id, account]),
  )
  const rowsById = new Map()

  for (const account of categoryAccounts.values()) {
    if (account.status === ACCOUNT_STATUSES.INACTIVE) continue
    rowsById.set(account.id, {
      id: account.id,
      categoryId: account.id,
      name: account.ownerName || 'مصروف',
      account,
      dinar: 0,
      usd: 0,
      try: 0,
      eur: 0,
      count: 0,
    })
  }

  for (const report of Array.isArray(reports) ? reports : []) {
    const categoryId = String(report?.categoryId || '')
    const account = categoryAccounts.get(categoryId) || null
    const id = categoryId || 'uncategorized'
    const current = rowsById.get(id)
    rowsById.set(id, {
      id,
      categoryId,
      name: report?.name || account?.ownerName || 'بدون تصنيف',
      account: current?.account || account,
      dinar: Math.abs(Number(report?.dinar || 0)),
      usd: Math.abs(Number(report?.usd || 0)),
      try: Math.abs(Number(report?.try || 0)),
      eur: Math.abs(Number(report?.eur || 0)),
      count: Math.max(0, Number(report?.count || 0)),
    })
  }

  return Array.from(rowsById.values()).sort((left, right) => (
    (right.dinar + right.usd + right.try + right.eur) - (left.dinar + left.usd + left.try + left.eur)
    || right.count - left.count
    || left.name.localeCompare(right.name, 'ar')
    || left.id.localeCompare(right.id)
  ))
}

export function counterpartyBucketAmount(bucket = {}) {
  const currency = CURRENCY_OPTIONS.find((option) => option.value === bucket.account?.currencyKind)?.value || CURRENCIES.DINAR
  return {
    amount: Number(bucket[currencyField(currency)] || 0),
    currency,
  }
}

function counterpartyHasDirection(group = {}, direction) {
  const value = group?.[direction] || {}
  return Number(value.dinar || 0) > 0 || Number(value.usd || 0) > 0 || Number(value.try || 0) > 0 || Number(value.eur || 0) > 0
}

export function setCounterpartySettlementPin(accounts = [], groupId = '', pinned = true, updatedAt = new Date().toISOString()) {
  const targetId = String(groupId || '').trim()
  if (!targetId) return accounts
  const nextPinned = Boolean(pinned)
  let changed = false
  const nextAccounts = accounts.map((account) => {
    if (counterpartyGroupKey(account) !== targetId) return account
    changed = true
    return {
      ...account,
      settlementPinned: nextPinned,
      settlementPinnedAt: nextPinned ? updatedAt : null,
      updatedAt,
    }
  })
  return changed ? nextAccounts : accounts
}

function counterpartyGroupFromRows(group = {}, rows = []) {
  const totals = rows.reduce((result, bucket) => {
    for (const { field } of CURRENCY_OPTIONS) {
      const amount = Number(bucket?.[field] || 0)
      result.receivable[field] += Math.max(0, amount)
      result.payable[field] += Math.abs(Math.min(0, amount))
    }
    return result
  }, {
    receivable: { dinar: 0, usd: 0, try: 0, eur: 0 },
    payable: { dinar: 0, usd: 0, try: 0, eur: 0 },
  })
  return { ...group, rows, ...totals }
}

function counterpartyRowsForDirection(group = {}, direction) {
  const keepPositive = direction === 'receivable'
  return group.rows.map((bucket) => ({
    ...bucket,
    dinar: keepPositive ? Math.max(0, Number(bucket.dinar || 0)) : Math.min(0, Number(bucket.dinar || 0)),
    usd: keepPositive ? Math.max(0, Number(bucket.usd || 0)) : Math.min(0, Number(bucket.usd || 0)),
    try: keepPositive ? Math.max(0, Number(bucket.try || 0)) : Math.min(0, Number(bucket.try || 0)),
    eur: keepPositive ? Math.max(0, Number(bucket.eur || 0)) : Math.min(0, Number(bucket.eur || 0)),
  })).filter((bucket) => hasMoneyValue(counterpartyBucketAmount(bucket).amount))
}

export function projectCounterpartyGroupForFilter(group = {}, filterKey = 'all') {
  if (filterKey === 'all' || filterKey === 'zero') return group
  if (filterKey === 'receivable' || filterKey === 'payable') {
    const rows = counterpartyRowsForDirection(group, filterKey)
    return rows.length ? counterpartyGroupFromRows(group, rows) : null
  }
  const rows = group.rows.filter((bucket) => (
    bucket.account?.counterpartyKind === filterKey
    && hasMoneyValue(counterpartyBucketAmount(bucket).amount)
  ))
  return rows.length ? counterpartyGroupFromRows(group, rows) : null
}

export function filterCounterpartyGroups(groups = [], filterKey = 'all') {
  if (filterKey === 'all') return groups
  if (filterKey === 'zero') {
    return groups.filter((group) => !counterpartyHasDirection(group, 'receivable') && !counterpartyHasDirection(group, 'payable'))
  }
  return groups.map((group) => projectCounterpartyGroupForFilter(group, filterKey)).filter(Boolean)
}

export function filterCounterpartyGroupsByQuery(groups = [], query = '') {
  const normalizedQuery = normalizeAccountSearchText(query)
  if (!normalizedQuery) return groups
  return groups.filter((group) => group.rows.some((bucket) => {
    const account = bucket.account || {}
    const haystack = normalizeAccountSearchText(`${account.ownerName || ''} ${account.subAccountName || ''} ${accountDetailName(account)} ${account.legacyName || ''}`)
    return haystack.includes(normalizedQuery)
  }))
}

export function filterMoneyBalanceRows(rows = [], focus = '') {
  const source = Array.isArray(rows) ? rows : []
  if (focus === 'cash') return source.filter((bucket) => bucket.account?.valueKind === VALUE_KINDS.CASH)
  if (focus === 'bank') return source.filter((bucket) => bucket.account?.valueKind === VALUE_KINDS.BANK)
  return source
}

export function counterpartyMagnitudeForFilter(group = {}, filterKey = 'all') {
  if (filterKey === 'receivable' || filterKey === 'payable') {
    return Math.max(Number(group?.[filterKey]?.dinar || 0), Number(group?.[filterKey]?.usd || 0), Number(group?.[filterKey]?.try || 0), Number(group?.[filterKey]?.eur || 0))
  }
  if (filterKey && !['all', 'zero'].includes(filterKey)) {
    return Math.max(0, ...group.rows
      .filter((bucket) => bucket.account?.counterpartyKind === filterKey)
      .map((bucket) => Math.abs(counterpartyBucketAmount(bucket).amount)))
  }
  return Math.max(
    Number(group.receivable?.dinar || 0),
    Number(group.receivable?.usd || 0),
    Number(group.receivable?.try || 0),
    Number(group.receivable?.eur || 0),
    Number(group.payable?.dinar || 0),
    Number(group.payable?.usd || 0),
    Number(group.payable?.try || 0),
    Number(group.payable?.eur || 0),
  )
}

export function unifiedCounterpartyGroups(views = {}, query = '', filterKey = 'all') {
  const directionalSource = filterKey === 'receivable' || filterKey === 'payable' ? views[filterKey] : null
  const source = directionalSource || (normalizeAccountSearchText(query) ? views.all || [] : views.withBalance || [])
  return filterCounterpartyGroupsByQuery(filterCounterpartyGroups(source, filterKey), query)
    .slice()
    .sort((left, right) => Number(Boolean(right?.settlementPinned)) - Number(Boolean(left?.settlementPinned))
      || (left?.settlementPinned && right?.settlementPinned
        ? String(right?.settlementPinnedAt || '').localeCompare(String(left?.settlementPinnedAt || ''))
        : 0)
      || counterpartyMagnitudeForFilter(right, filterKey) - counterpartyMagnitudeForFilter(left, filterKey)
      || left.ownerName.localeCompare(right.ownerName, 'ar')
      || left.id.localeCompare(right.id))
}
