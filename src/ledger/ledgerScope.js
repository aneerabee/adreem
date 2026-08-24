import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog.js'

export const ACCOUNT_SUMMARY_SCOPES = Object.freeze({
  INCLUDED: 'included',
  SEPARATE: 'separate',
})

const NET_ELIGIBLE_VALUE_KINDS = new Set([
  VALUE_KINDS.CASH,
  VALUE_KINDS.BANK,
  VALUE_KINDS.RECEIVABLE,
  VALUE_KINDS.ASSET,
])

const NET_SEARCH_LABELS = Object.freeze({
  [VALUE_KINDS.CASH]: 'كاش نقد فلوسي',
  [VALUE_KINDS.BANK]: 'مصرف حساب بنكي شيك',
  [VALUE_KINDS.RECEIVABLE]: 'شخص جهة بيننا',
  [VALUE_KINDS.ASSET]: 'اصل ممتلكات',
  [ACCOUNT_CURRENCY_KINDS.DINAR]: 'دينار د ل',
  [ACCOUNT_CURRENCY_KINDS.USD]: 'دولار امريكي',
  [ACCOUNT_CURRENCY_KINDS.TRY]: 'ليرة تركية try tl',
  [ACCOUNT_CURRENCY_KINDS.MULTI]: 'lyd usd try متعدد',
})

const NET_ACCOUNT_KIND_ORDER = Object.freeze({
  [VALUE_KINDS.CASH]: 0,
  [VALUE_KINDS.BANK]: 1,
  [VALUE_KINDS.RECEIVABLE]: 2,
  [VALUE_KINDS.ASSET]: 3,
})

const NET_CURRENCY_ORDER = Object.freeze({
  [ACCOUNT_CURRENCY_KINDS.DINAR]: 0,
  [ACCOUNT_CURRENCY_KINDS.USD]: 1,
  [ACCOUNT_CURRENCY_KINDS.TRY]: 2,
  [ACCOUNT_CURRENCY_KINDS.MULTI]: 3,
})

const NET_ACCOUNT_COLLATOR = new Intl.Collator(['ar', 'en'], {
  numeric: true,
  sensitivity: 'base',
})

const MAX_SAFE_MONEY_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_MONEY_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)

export function accountSupportsNetScope(account = {}) {
  return NET_ELIGIBLE_VALUE_KINDS.has(account.valueKind)
}

export function accountSummaryScope(account = {}) {
  if (!accountSupportsNetScope(account)) return null
  return ACCOUNT_SUMMARY_SCOPES.INCLUDED
}

export function isAccountIncludedInNet(account = {}) {
  return accountSummaryScope(account) === ACCOUNT_SUMMARY_SCOPES.INCLUDED
}

export function isAccountSeparateFromNet() {
  return false
}

export function splitBalanceRowsByScope(rows = []) {
  return rows.reduce((groups, row) => {
    const scope = accountSummaryScope(row?.account)
    if (scope === ACCOUNT_SUMMARY_SCOPES.INCLUDED) groups.included.push(row)
    else if (scope === ACCOUNT_SUMMARY_SCOPES.SEPARATE) groups.separate.push(row)
    else groups.ineligible.push(row)
    return groups
  }, { included: [], separate: [], ineligible: [] })
}

function normalizedNetSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .trim()
}

function compareNetContributions(left = {}, right = {}) {
  const leftAccount = left.account || {}
  const rightAccount = right.account || {}
  const kindDifference = (NET_ACCOUNT_KIND_ORDER[leftAccount.valueKind] ?? 99) - (NET_ACCOUNT_KIND_ORDER[rightAccount.valueKind] ?? 99)
  if (kindDifference !== 0) return kindDifference
  const ownerDifference = NET_ACCOUNT_COLLATOR.compare(
    leftAccount.ownerName || leftAccount.name || '',
    rightAccount.ownerName || rightAccount.name || '',
  )
  if (ownerDifference !== 0) return ownerDifference
  const detailDifference = NET_ACCOUNT_COLLATOR.compare(
    leftAccount.subAccountName || leftAccount.legacyName || '',
    rightAccount.subAccountName || rightAccount.legacyName || '',
  )
  if (detailDifference !== 0) return detailDifference
  const currencyDifference = (NET_CURRENCY_ORDER[leftAccount.currencyKind] ?? 99) - (NET_CURRENCY_ORDER[rightAccount.currencyKind] ?? 99)
  if (currencyDifference !== 0) return currencyDifference
  return NET_ACCOUNT_COLLATOR.compare(left.accountId || '', right.accountId || '')
}

function roundedNetAmount(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  const rounded = Math.round(amount)
  return Number.isSafeInteger(rounded) ? rounded : 0
}

function exactNetTotal(contributions, currencyField) {
  const total = contributions.reduce((sum, item) => sum + BigInt(item[currencyField]), 0n)
  if (total >= MIN_SAFE_MONEY_BIGINT && total <= MAX_SAFE_MONEY_BIGINT) return Number(total)
  return total
}

export function filterNetContributions(contributions = [], query = '') {
  const normalizedQuery = normalizedNetSearchText(query)
  return (Array.isArray(contributions) ? contributions : [])
    .filter((item) => {
      if (!normalizedQuery) return true
      const account = item?.account || {}
      return normalizedNetSearchText([
        account.ownerName,
        account.subAccountName,
        account.name,
        account.valueKind,
        account.currencyKind,
        NET_SEARCH_LABELS[account.valueKind],
        NET_SEARCH_LABELS[account.currencyKind],
      ].filter(Boolean).join(' ')).includes(normalizedQuery)
    })
    .sort(compareNetContributions)
}

export function buildNetPosition(rows = [], excludedAccountIds = []) {
  const balanceRows = Array.isArray(rows) ? rows : []
  const excluded = excludedAccountIds instanceof Set
    ? excludedAccountIds
    : new Set(Array.isArray(excludedAccountIds) ? excludedAccountIds : [])
  const contributions = balanceRows
    .filter((row) => isAccountIncludedInNet(row?.account))
    .filter((row) => !excluded.has(row.account.id))
    .map((row) => ({
      accountId: row.account.id,
      account: row.account,
      dinar: roundedNetAmount(row.dinar),
      usd: roundedNetAmount(row.usd),
      try: roundedNetAmount(row.try),
    }))
    .filter((item) => item.dinar !== 0 || item.usd !== 0 || item.try !== 0)
  return {
    dinar: exactNetTotal(contributions, 'dinar'),
    usd: exactNetTotal(contributions, 'usd'),
    try: exactNetTotal(contributions, 'try'),
    accountCount: contributions.length,
    contributions,
  }
}

export function convertNetPosition(position = {}, requestedRate, targetCurrency = 'LYD', requestedTryRate = 0) {
  const currency = ['USD', 'TRY'].includes(targetCurrency) ? targetCurrency : 'LYD'
  const lydPerUsd = Number(requestedRate)
  const tryPerUsd = Number(requestedTryRate)
  const dinar = Number(position.dinar || 0)
  const usd = Number(position.usd || 0)
  const tryAmount = Number(position.try || 0)
  if (![dinar, usd, tryAmount].every(Number.isSafeInteger)) {
    return { ok: false, error: 'نتيجة الصافي أكبر من الحد المسموح.' }
  }
  const needsLydRate = currency === 'LYD' ? usd !== 0 || tryAmount !== 0 : dinar !== 0
  const needsTryRate = currency === 'TRY' ? dinar !== 0 || usd !== 0 : tryAmount !== 0
  const missingLydRate = needsLydRate && (!Number.isFinite(lydPerUsd) || lydPerUsd <= 0)
  const missingTryRate = needsTryRate && (!Number.isFinite(tryPerUsd) || tryPerUsd <= 0)
  if (missingLydRate || missingTryRate) {
    return {
      ok: false,
      error: missingLydRate && missingTryRate
        ? 'أدخل سعري LYD وTRY مقابل USD.'
        : missingTryRate ? 'أدخل سعر TRY مقابل USD.' : 'أدخل سعر LYD مقابل USD.',
    }
  }
  const dinarAsUsd = dinar === 0 ? 0 : dinar / lydPerUsd
  const usdAsLyd = usd === 0 ? 0 : usd * lydPerUsd
  const usdAsTry = usd === 0 ? 0 : usd * tryPerUsd
  const tryAsUsd = tryAmount === 0 ? 0 : tryAmount / tryPerUsd
  const rawAmount = currency === 'USD'
    ? Math.round(usd + dinarAsUsd + tryAsUsd)
    : currency === 'TRY'
      ? Math.round(tryAmount + usdAsTry + (dinarAsUsd * tryPerUsd))
      : Math.round(dinar + usdAsLyd + (tryAsUsd * lydPerUsd))
  if (!Number.isSafeInteger(rawAmount)) {
    return { ok: false, error: 'نتيجة الصافي أكبر من الحد المسموح.' }
  }
  const amount = rawAmount
  return {
    ok: true,
    currency,
    amount,
    rate: Number.isFinite(lydPerUsd) && lydPerUsd > 0 ? lydPerUsd : 0,
    ...(needsTryRate ? { tryRate: tryPerUsd } : {}),
  }
}
