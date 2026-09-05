import { ACCOUNT_STATUSES, VALUE_KINDS } from './accountCatalog.js'
import { accountCurrencyKind, normalizeAccountText } from './accountCompatibility.js'
import { counterpartyAccountChannels, counterpartyGroupKey, isCounterpartyAccount } from './accountConfig.js'
import { createAccount, validateAccount } from './ledgerCore.js'

const CURRENCY_CHANNEL_VERSION = 1
const ADDED_CURRENCIES = ['TRY', 'EUR']

function upgradeGroupKey(account) {
  if (isCounterpartyAccount(account)) return counterpartyGroupKey(account)
  if (![VALUE_KINDS.CASH, VALUE_KINDS.BANK].includes(account.valueKind)) return ''
  return JSON.stringify([account.valueKind, normalizeAccountText(account.ownerName), normalizeAccountText(account.subAccountName)])
}

// Run after cloud hydration so added records pass through the normal versioned save path.
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
    const anchor = group.filter((account) => account.status === ACCOUNT_STATUSES.ACTIVE && !account.mergedIntoAccountId)
      .sort((a, b) => a.id.localeCompare(b.id))[0]
    if (!anchor) continue
    const currencies = new Set(group.map((account) => accountCurrencyKind(account)))
    const missing = currencies.has('multi') ? [] : ADDED_CURRENCIES.filter((currency) => !currencies.has(currency))
    const candidates = missing.map((currency) => {
      const person = isCounterpartyAccount(anchor)
      const channel = counterpartyAccountChannels.find((item) => item.currencyKind === currency)
      return {
        ...createAccount({
          id: `${anchor.id}-currency-${currency.toLowerCase()}`,
          ownerName: anchor.ownerName,
          subAccountName: person ? channel.subAccountName : anchor.subAccountName,
          type: anchor.type,
          valueKind: anchor.valueKind,
          currencyKind: currency,
          counterpartyId: person ? anchor.counterpartyId || '' : '',
          counterpartyKind: person && anchor.counterpartyId ? channel.key : '',
        }),
        createdAt: now,
        updatedAt: now,
        currencyChannelsVersion: CURRENCY_CHANNEL_VERSION,
        createdFrom: 'currency_upgrade',
        ...(anchor.settlementPinned ? { settlementPinned: true, settlementPinnedAt: anchor.settlementPinnedAt } : {}),
      }
    })
    // An ambiguous duplicate leaves this group unchanged, never half upgraded.
    if (candidates.some((candidate) => !validateAccount(candidate, [...accounts, ...additions, ...candidates.filter((item) => item !== candidate)]).ok)) continue
    additions.push(...candidates)
    replacements.set(anchor.id, { ...anchor, currencyChannelsVersion: CURRENCY_CHANNEL_VERSION, updatedAt: now })
  }
  if (!replacements.size) return accounts
  return [...accounts.map((account) => replacements.get(account.id) || account), ...additions]
}
