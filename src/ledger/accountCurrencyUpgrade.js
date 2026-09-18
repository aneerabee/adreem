import { ACCOUNT_STATUSES, VALUE_KINDS } from './accountCatalog.js'
import { accountCurrencyKind, normalizeAccountText } from './accountCompatibility.js'
import { counterpartyAccountChannels, counterpartyChannelForAccount, counterpartyGroupKey, isCounterpartyAccount } from './accountConfig.js'
import { createAccount, validateAccount } from './ledgerCore.js'

const CURRENCY_CHANNEL_VERSION = 2
const FINANCIAL_CURRENCIES = Object.freeze(['LYD', 'USD', 'TRY', 'EUR'])

function upgradeGroupKey(account) {
  if (isCounterpartyAccount(account)) return counterpartyGroupKey(account)
  if (![VALUE_KINDS.CASH, VALUE_KINDS.BANK].includes(account.valueKind)) return ''
  return JSON.stringify([account.valueKind, normalizeAccountText(account.ownerName), normalizeAccountText(account.subAccountName)])
}

function accountUpgradeMetadata(anchor, now) {
  return {
    createdAt: now,
    updatedAt: now,
    currencyChannelsVersion: CURRENCY_CHANNEL_VERSION,
    createdFrom: 'currency_upgrade',
    ...(anchor.settlementPinned ? { settlementPinned: true, settlementPinnedAt: anchor.settlementPinnedAt } : {}),
  }
}

function personChannelCandidates(group, anchor, now) {
  const existingChannels = new Set(group.map((account) => counterpartyChannelForAccount(account)?.key).filter(Boolean))
  return counterpartyAccountChannels
    .filter((channel) => !existingChannels.has(channel.key))
    .map((channel) => ({
      ...createAccount({
        id: `${anchor.id}-channel-${channel.key}`,
        ownerName: anchor.ownerName,
        subAccountName: channel.subAccountName,
        type: anchor.type,
        valueKind: anchor.valueKind,
        currencyKind: channel.currencyKind,
        notes: anchor.notes || '',
        counterpartyId: anchor.counterpartyId || '',
        counterpartyKind: anchor.counterpartyId ? channel.key : '',
      }),
      ...accountUpgradeMetadata(anchor, now),
    }))
}

function financialChannelCandidates(group, anchor, now) {
  const currencies = new Set(group.map((account) => accountCurrencyKind(account)))
  if (currencies.has('multi')) return []
  return FINANCIAL_CURRENCIES
    .filter((currency) => !currencies.has(currency))
    .map((currency) => ({
      ...createAccount({
        id: `${anchor.id}-currency-${currency.toLowerCase()}`,
        ownerName: anchor.ownerName,
        subAccountName: anchor.subAccountName,
        type: anchor.type,
        valueKind: anchor.valueKind,
        currencyKind: currency,
        notes: anchor.notes || '',
      }),
      ...accountUpgradeMetadata(anchor, now),
    }))
}

function groupUpgradeCandidates(group, anchor, now) {
  return isCounterpartyAccount(anchor)
    ? personChannelCandidates(group, anchor, now)
    : financialChannelCandidates(group, anchor, now)
}

function validCandidateSet(candidates, existingAccounts) {
  const accepted = [...existingAccounts]
  for (const candidate of candidates) {
    const validation = validateAccount(candidate, accepted)
    if (!validation.ok) return false
    accepted.push(candidate)
  }
  return true
}

// Runs after cloud hydration. Existing balances and movements stay untouched;
// only missing zero-balance channels are added through the normal save path.
export function completeAccountCurrencies(accounts = [], now = new Date().toISOString()) {
  const groups = new Map()
  for (const account of accounts) {
    const key = upgradeGroupKey(account)
    if (!key) continue
    groups.set(key, [...(groups.get(key) || []), account])
  }

  const replacements = new Map()
  const additions = []
  for (const group of groups.values()) {
    if (group.some((account) => Number(account.currencyChannelsVersion || 0) >= CURRENCY_CHANNEL_VERSION)) continue
    const anchor = group
      .filter((account) => account.status === ACCOUNT_STATUSES.ACTIVE && !account.mergedIntoAccountId)
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    if (!anchor) continue

    const candidates = groupUpgradeCandidates(group, anchor, now)
    if (!validCandidateSet(candidates, [...accounts, ...additions])) continue

    for (const account of group) {
      replacements.set(account.id, {
        ...account,
        currencyChannelsVersion: CURRENCY_CHANNEL_VERSION,
        updatedAt: now,
      })
    }
    additions.push(...candidates)
  }

  if (!replacements.size) return accounts
  return [...accounts.map((account) => replacements.get(account.id) || account), ...additions]
}

export function buildFinancialAccountCurrencyBundle(account, now = account?.createdAt || new Date().toISOString()) {
  if (!account || ![VALUE_KINDS.CASH, VALUE_KINDS.BANK].includes(account.valueKind)) return account ? [account] : []
  return completeAccountCurrencies([account], now)
}
