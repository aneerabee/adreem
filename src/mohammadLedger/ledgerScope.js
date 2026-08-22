import { VALUE_KINDS } from './accountCatalog.js'

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

export function buildNetPosition(rows = []) {
  const contributions = rows
    .filter((row) => isAccountIncludedInNet(row?.account))
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
