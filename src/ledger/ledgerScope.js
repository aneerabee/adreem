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
  [ACCOUNT_CURRENCY_KINDS.MULTI]: 'دينار دولار متعدد',
})

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

function netContributionImpact(item = {}) {
  return Math.abs(Number(item.dinar || 0)) + Math.abs(Number(item.usd || 0))
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
    .sort((left, right) => {
      const impactDifference = netContributionImpact(right) - netContributionImpact(left)
      if (impactDifference !== 0) return impactDifference
      const leftName = `${left?.account?.ownerName || ''} ${left?.account?.subAccountName || ''}`.trim()
      const rightName = `${right?.account?.ownerName || ''} ${right?.account?.subAccountName || ''}`.trim()
      return leftName.localeCompare(rightName, 'ar', { numeric: true, sensitivity: 'base' })
    })
}

export function buildNetPosition(rows = [], excludedAccountIds = []) {
  const excluded = excludedAccountIds instanceof Set
    ? excludedAccountIds
    : new Set(Array.isArray(excludedAccountIds) ? excludedAccountIds : [])
  const contributions = rows
    .filter((row) => isAccountIncludedInNet(row?.account))
    .filter((row) => !excluded.has(row.account.id))
    .map((row) => ({
      accountId: row.account.id,
      account: row.account,
      dinar: Math.round(Number(row.dinar || 0)),
      usd: Math.round(Number(row.usd || 0)),
    }))
  return {
    dinar: contributions.reduce((total, item) => total + item.dinar, 0),
    usd: contributions.reduce((total, item) => total + item.usd, 0),
    accountCount: contributions.length,
    contributions,
  }
}

export function convertNetPosition(position = {}, requestedRate, targetCurrency = 'LYD') {
  const rate = Number(requestedRate)
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, error: 'أدخل سعر صرف أكبر من صفر.' }
  }
  const dinar = Number(position.dinar || 0)
  const usd = Number(position.usd || 0)
  const currency = targetCurrency === 'USD' ? 'USD' : 'LYD'
  const amount = currency === 'USD'
    ? Math.round(usd + (dinar / rate))
    : Math.round(dinar + (usd * rate))
  return { ok: true, currency, amount, rate }
}
