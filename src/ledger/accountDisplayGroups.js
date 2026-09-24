import { VALUE_KINDS } from './accountCatalog.js'
import { accountChoiceKind, accountPrimaryName, counterpartyGroupKey, isCounterpartyAccount } from './accountConfig.js'
import { normalizeAccountText } from './accountCompatibility.js'

const DISPLAY_CURRENCY_ORDER = Object.freeze(['LYD', 'USD', 'TRY', 'EUR', 'multi'])
const DISPLAY_CHANNEL_ORDER = Object.freeze([
  'person-cash',
  'person-bank',
  'person-usd',
  'person-try',
  'person-eur',
  VALUE_KINDS.CASH,
  VALUE_KINDS.BANK,
  VALUE_KINDS.ASSET,
  VALUE_KINDS.PROJECT,
  VALUE_KINDS.EXPENSE,
])

function displayOrderIndex(order, value) {
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

function compareDisplayChannels(left, right) {
  return displayOrderIndex(DISPLAY_CHANNEL_ORDER, accountChoiceKind(left)) - displayOrderIndex(DISPLAY_CHANNEL_ORDER, accountChoiceKind(right))
    || displayOrderIndex(DISPLAY_CURRENCY_ORDER, left.currencyKind) - displayOrderIndex(DISPLAY_CURRENCY_ORDER, right.currencyKind)
    || String(left.id || '').localeCompare(String(right.id || ''))
}

function moneyLocationKey(account = {}) {
  return [
    account.valueKind,
    normalizeAccountText(account.ownerName).toLocaleLowerCase('ar'),
    normalizeAccountText(account.subAccountName).toLocaleLowerCase('ar'),
  ].join(':')
}

export function accountDisplayGroupKey(account = {}) {
  if (isCounterpartyAccount(account)) return `counterparty:${counterpartyGroupKey(account)}`
  if ([VALUE_KINDS.CASH, VALUE_KINDS.BANK].includes(account.valueKind)) return `money:${moneyLocationKey(account)}`
  return `account:${String(account.id || '')}`
}

export function groupAccountsForDisplay(accounts = []) {
  const groups = new Map()
  const seenAccountIds = new Set()

  for (const account of accounts) {
    if (!account?.id || seenAccountIds.has(account.id)) continue
    seenAccountIds.add(account.id)
    const id = accountDisplayGroupKey(account)
    const current = groups.get(id) || {
      id,
      label: accountPrimaryName(account),
      accounts: [],
    }
    current.accounts.push(account)
    groups.set(id, current)
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    accounts: group.accounts.slice().sort(compareDisplayChannels),
  }))
}

export function groupBalanceRowsForDisplay(rows = []) {
  const bucketByAccountId = new Map(rows
    .filter((bucket) => bucket?.account?.id)
    .map((bucket) => [bucket.account.id, bucket]))

  return groupAccountsForDisplay(rows.map((bucket) => bucket?.account).filter(Boolean))
    .map((group) => ({
      ...group,
      rows: group.accounts
        .map((account) => bucketByAccountId.get(account.id))
        .filter(Boolean)
        .sort((left, right) => compareDisplayChannels(left.account, right.account)),
    }))
}

export function accountsWithLedgerActivity(accounts = [], balancesByAccountId = new Map(), movements = [], selectedAccountId = '') {
  const usedIds = new Set()
  for (const movement of movements) {
    if (movement?.sourceAccountId) usedIds.add(movement.sourceAccountId)
    if (movement?.destinationAccountId) usedIds.add(movement.destinationAccountId)
  }
  return accounts.filter((account) => {
    if (account.id === selectedAccountId || usedIds.has(account.id)) return true
    const bucket = balancesByAccountId.get(account.id)
    return ['dinar', 'usd', 'try', 'eur'].some((field) => Number(bucket?.[field] || 0) !== 0)
  })
}
