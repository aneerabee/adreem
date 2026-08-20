import { ACCOUNT_STATUSES, VALUE_KINDS } from './accountCatalog.js'
import {
  accountSupportsTransferCurrency,
  areTransferAccountsCompatible,
  sameLogicalAccount,
} from './accountCompatibility.js'
import { MOVEMENT_TYPES } from './ledgerCore.js'

export { sameLogicalAccount }

export function normalizeAccountSearchText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u0640/gu, '')
    .replace(/\p{M}/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ar')
}

function searchableText(account) {
  return normalizeAccountSearchText(`${account?.ownerName || ''} ${account?.subAccountName || ''} ${account?.legacyName || ''}`)
}

function isPostingAccount(account) {
  return account?.status === ACCOUNT_STATUSES.ACTIVE &&
    account.valueKind !== VALUE_KINDS.EXPENSE &&
    account.valueKind !== VALUE_KINDS.ASSET &&
    account.valueKind !== VALUE_KINDS.PROJECT
}

export function getMovementAccounts(accounts = [], balancesByAccountId = new Map(), movementType, role, selected = {}) {
  const moneyOrPerson = accounts.filter(isPostingAccount)
  const supportsCurrency = (account, currency = selected.currency) =>
    accountSupportsTransferCurrency(account, currency, balancesByAccountId.get(account.id))
  const currencyReadyAccounts = moneyOrPerson.filter((account) => supportsCurrency(account))
  const transferReadyAccounts = currencyReadyAccounts
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const sourceAccount = accountById.get(selected.sourceAccountId)
  const destinationAccount = accountById.get(selected.destinationAccountId)
  const removeDuplicate = (list, compareAccount) =>
    compareAccount ? list.filter((account) => !sameLogicalAccount(account, compareAccount)) : list
  const removeTransferMismatch = (list, compareAccount) =>
    movementType === MOVEMENT_TYPES.TRANSFER && compareAccount
      ? list.filter((account) => {
        const accountBucket = balancesByAccountId.get(account.id)
        const compareBucket = balancesByAccountId.get(compareAccount.id)
        return role === 'source'
          ? areTransferAccountsCompatible(account, compareAccount, selected.currency, accountBucket, compareBucket)
          : areTransferAccountsCompatible(compareAccount, account, selected.currency, compareBucket, accountBucket)
      })
      : list

  if (movementType === MOVEMENT_TYPES.USD_SALE && role === 'source') {
    return moneyOrPerson.filter((account) => supportsCurrency(account, 'USD'))
  }
  if (movementType === MOVEMENT_TYPES.USD_SALE && role === 'destination') {
    return removeDuplicate(moneyOrPerson.filter((account) => supportsCurrency(account, 'LYD')), sourceAccount)
  }
  if (movementType === MOVEMENT_TYPES.USD_PURCHASE && role === 'source') {
    return moneyOrPerson.filter((account) => supportsCurrency(account, 'LYD'))
  }
  if (movementType === MOVEMENT_TYPES.USD_PURCHASE && role === 'destination') {
    return removeDuplicate(moneyOrPerson.filter((account) => supportsCurrency(account, 'USD')), sourceAccount)
  }
  if (movementType === MOVEMENT_TYPES.CASH_DEPOSIT) {
    return currencyReadyAccounts.filter((account) => account.valueKind === (role === 'source' ? VALUE_KINDS.CASH : VALUE_KINDS.BANK))
  }
  if (movementType === MOVEMENT_TYPES.CASH_WITHDRAWAL) {
    return currencyReadyAccounts.filter((account) => account.valueKind === (role === 'source' ? VALUE_KINDS.BANK : VALUE_KINDS.CASH))
  }
  if (role === 'destination') return removeTransferMismatch(removeDuplicate(transferReadyAccounts, sourceAccount), sourceAccount)
  if (role === 'source') return removeTransferMismatch(removeDuplicate(transferReadyAccounts, destinationAccount), destinationAccount)
  return transferReadyAccounts
}

export function rankMovementAccounts(accounts = [], balancesByAccountId = new Map(), query = '', currency = '') {
  const normalizedQuery = normalizeAccountSearchText(query)
  const magnitude = (account) => {
    const bucket = balancesByAccountId.get(account.id)
    if (currency === 'USD') return Math.abs(Math.round(bucket?.usd || 0))
    if (currency === 'LYD') return Math.abs(Math.round(bucket?.dinar || 0))
    return Math.max(Math.abs(Math.round(bucket?.dinar || 0)), Math.abs(Math.round(bucket?.usd || 0)))
  }

  return accounts
    .filter((account) => !normalizedQuery || searchableText(account).includes(normalizedQuery))
    .sort((a, b) => {
      const ownRank = (account) => account.valueKind === VALUE_KINDS.CASH || account.valueKind === VALUE_KINDS.BANK ? 0 : 1
      return ownRank(a) - ownRank(b) || magnitude(b) - magnitude(a) || searchableText(a).localeCompare(searchableText(b), 'ar')
    })
}
