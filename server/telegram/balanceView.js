import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { isAccountIncludedInNet } from '../../src/mohammadLedger/ledgerScope.js'

export const TELEGRAM_BALANCE_FILTERS = Object.freeze({
  MONEY: 'money',
  COLLECT: 'collect',
  PAY: 'pay',
  SEPARATE: 'separate',
  ALL: 'all',
})

const VALID_FILTERS = new Set(Object.values(TELEGRAM_BALANCE_FILTERS))

function amountForBucket(bucket = {}) {
  return bucket.account?.currencyKind === 'USD'
    ? Number(bucket.usd || 0)
    : Number(bucket.dinar || 0)
}

function sumBalances(rows = []) {
  return rows.reduce((total, bucket) => ({
    dinar: total.dinar + Number(bucket.dinar || 0),
    usd: total.usd + Number(bucket.usd || 0),
  }), { dinar: 0, usd: 0 })
}

export function buildTelegramBalanceView(balances = [], requestedFilter = TELEGRAM_BALANCE_FILTERS.MONEY) {
  const allBuckets = balances
    .filter((bucket) => bucket.account?.status === ACCOUNT_STATUSES.ACTIVE)
    .sort((left, right) => Math.abs(Number(right.dinar || 0)) - Math.abs(Number(left.dinar || 0)) || Math.abs(Number(right.usd || 0)) - Math.abs(Number(left.usd || 0)))
  const regularBuckets = allBuckets
  const separateBuckets = []
  const includedBuckets = allBuckets.filter((bucket) => isAccountIncludedInNet(bucket.account))
  const people = includedBuckets.filter((bucket) => bucket.account.valueKind === VALUE_KINDS.RECEIVABLE)
  const ownMoney = includedBuckets.filter((bucket) => bucket.account.valueKind === VALUE_KINDS.CASH || bucket.account.valueKind === VALUE_KINDS.BANK)
  const filter = VALID_FILTERS.has(requestedFilter) ? requestedFilter : TELEGRAM_BALANCE_FILTERS.MONEY
  const filteredBuckets = filter === TELEGRAM_BALANCE_FILTERS.MONEY
    ? ownMoney
    : filter === TELEGRAM_BALANCE_FILTERS.COLLECT
      ? people.filter((bucket) => amountForBucket(bucket) > 0)
      : filter === TELEGRAM_BALANCE_FILTERS.PAY
        ? people.filter((bucket) => amountForBucket(bucket) < 0)
        : filter === TELEGRAM_BALANCE_FILTERS.SEPARATE
          ? separateBuckets
          : regularBuckets
  const collect = people.reduce((total, bucket) => ({
    dinar: total.dinar + Math.max(0, Number(bucket.dinar || 0)),
    usd: total.usd + Math.max(0, Number(bucket.usd || 0)),
  }), { dinar: 0, usd: 0 })
  const pay = people.reduce((total, bucket) => ({
    dinar: total.dinar + Math.abs(Math.min(0, Number(bucket.dinar || 0))),
    usd: total.usd + Math.abs(Math.min(0, Number(bucket.usd || 0))),
  }), { dinar: 0, usd: 0 })

  return {
    allBuckets,
    regularBuckets,
    separateBuckets,
    includedBuckets,
    filteredBuckets,
    filter,
    summary: {
      money: sumBalances(ownMoney),
      collect,
      pay,
    },
  }
}
