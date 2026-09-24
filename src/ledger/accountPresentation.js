import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { accountChoiceKind, accountChoiceKindLabel, accountContextLabel, accountDetailName, accountDisplayName, accountDraftSummary, accountKindLabel, accountDetailOptionsFor, accountNameValue, accountPrimaryName } from './accountConfig'
import { accountCurrencyLabel } from './accountCompatibility'
import { CURRENCIES } from './ledgerCore'
import { normalizeAccountSearchText, rankMovementAccountsForRole } from './movementAccounts'
import { preserveUiData } from './uiTranslation'
import { hasMoneyValue, money } from './ledgerFormat'

export function accountLabel(account) {
  return account ? accountDisplayName(account) : ''
}

function accountPrimaryUserValue(account) {
  const primaryName = accountPrimaryName(account)
  const enteredName = String(accountNameValue(account) || '').trim().replace(/\s+/g, ' ')
  return enteredName && enteredName === primaryName ? primaryName : ''
}

export function protectUiValues(value, protectedValues = []) {
  const values = Array.from(new Set(protectedValues
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  if (!values.length) return String(value || '')
  const pattern = new RegExp(values.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu')
  return String(value || '').replace(pattern, (item) => preserveUiData(item))
}

export function protectedAccountLabel(account) {
  if (!account) return ''
  const protectedValues = [accountPrimaryUserValue(account)]
  const context = accountContextLabel(account)
  const detail = accountDetailName(account)
  const knownDetails = accountDetailOptionsFor(account.type, account.valueKind)
  if (detail && context.includes(detail) && !knownDetails.some((knownDetail) => context.startsWith(knownDetail))) {
    protectedValues.push(detail)
  }
  return protectUiValues(accountLabel(account), protectedValues)
}

export function protectedAccountPrimaryName(account) {
  if (!account) return ''
  return protectUiValues(accountPrimaryName(account), [accountPrimaryUserValue(account)])
}

export function protectedAccountContext(account) {
  if (!account) return ''
  const context = accountContextLabel(account)
  const detail = accountDetailName(account)
  const knownDetails = accountDetailOptionsFor(account.type, account.valueKind)
  if (knownDetails.some((knownDetail) => context.startsWith(knownDetail))) return context
  return detail && context.includes(detail) ? protectUiValues(context, [detail]) : context
}

export function conciseAccountChoiceContext(account) {
  if (!account) return ''
  const kind = accountChoiceKind(account)
  const kindLabel = accountChoiceKindLabel(account)
  if (![VALUE_KINDS.CASH, VALUE_KINDS.BANK, 'person-bank', 'person-cash', 'person-usd'].includes(kind)) return kindLabel
  const primary = normalizeAccountSearchText(accountPrimaryName(account))
  const normalizedKind = normalizeAccountSearchText(kindLabel)
  const currency = accountCurrencyLabel(account)
  if (primary.includes(normalizedKind)) return currency
  if (normalizedKind === normalizeAccountSearchText(currency)) return kindLabel
  return `${kindLabel} · ${currency}`
}

export function protectedAccountDraftSummary(accountDraft) {
  return protectUiValues(accountDraftSummary(accountDraft), [accountNameValue(accountDraft)])
}

export function protectedUserProfile(profile) {
  if (!profile) return profile
  return {
    ...profile,
    displayName: profile.displayName ? preserveUiData(profile.displayName) : profile.displayName,
    email: profile.email ? preserveUiData(profile.email) : profile.email,
    userId: profile.userId ? preserveUiData(profile.userId) : profile.userId,
  }
}

export function visualKind(account) {
  if (account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || account.valueKind === VALUE_KINDS.REVIEW) return 'review'
  if (account.valueKind === VALUE_KINDS.CASH) return 'cash'
  if (account.valueKind === VALUE_KINDS.BANK) return 'bank'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'expense'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'asset'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE) {
    const choiceKind = accountChoiceKind(account)
    if (['person-bank', 'person-usd', 'person-try', 'person-eur'].includes(choiceKind)) return choiceKind
  }
  return 'person'
}

export function accountKindText(account) {
  return account ? accountKindLabel(account) : ''
}

export function accountBalanceChip(account, bucket, currency = '') {
  const dinar = Number(bucket?.dinar || 0)
  const usd = Number(bucket?.usd || 0)
  const tryAmount = Number(bucket?.try || 0)
  const eurAmount = Number(bucket?.eur || 0)
  if (currency === CURRENCIES.DINAR) return accountBalanceChipForCurrency(account, dinar, CURRENCIES.DINAR)
  if (currency === CURRENCIES.USD) return accountBalanceChipForCurrency(account, usd, CURRENCIES.USD)
  if (currency === CURRENCIES.EUR) return accountBalanceChipForCurrency(account, eurAmount, CURRENCIES.EUR)
  if (currency === CURRENCIES.TRY) return accountBalanceChipForCurrency(account, tryAmount, CURRENCIES.TRY)
  const hasDinar = hasMoneyValue(dinar)
  const hasUsd = hasMoneyValue(usd)
  const hasTry = hasMoneyValue(tryAmount)
  const hasEur = hasMoneyValue(eurAmount)

  if (!hasDinar && !hasUsd && !hasTry && hasEur) return accountBalanceChipForCurrency(account, eurAmount, CURRENCIES.EUR)
  if (!hasDinar && !hasUsd && hasTry) return accountBalanceChipForCurrency(account, tryAmount, CURRENCIES.TRY)

  if (!hasDinar && hasUsd) {
    return {
      tone: usd > 0 ? 'positive' : 'negative',
      text: money(Math.abs(usd), CURRENCIES.USD),
    }
  }
  if (!hasDinar) return { tone: 'zero', text: 'صفر' }

  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return {
      tone: dinar > 0 ? 'positive' : 'negative',
      text: dinar > 0 ? money(dinar) : `ناقص ${money(Math.abs(dinar))}`,
    }
  }

  if (account?.valueKind === VALUE_KINDS.EXPENSE) {
    return { tone: 'expense', text: money(Math.abs(dinar)) }
  }

  if (account?.valueKind === VALUE_KINDS.ASSET) {
    return { tone: 'asset', text: money(Math.abs(dinar)) }
  }

  return {
    tone: dinar > 0 ? 'positive' : 'negative',
    text: dinar > 0 ? `أقبض ${money(dinar)}` : `أدفع ${money(Math.abs(dinar))}`,
  }
}

function accountBalanceChipForCurrency(account, amount, currency) {
  const value = Number(amount || 0)
  if (!hasMoneyValue(value)) return { tone: 'zero', text: money(0, currency) }
  const absolute = money(Math.abs(value), currency)

  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return {
      tone: value > 0 ? 'positive' : 'negative',
      text: value > 0 ? absolute : `ناقص ${absolute}`,
    }
  }
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return { tone: 'expense', text: absolute }
  if (account?.valueKind === VALUE_KINDS.ASSET) return { tone: 'asset', text: absolute }
  return {
    tone: value > 0 ? 'positive' : 'negative',
    text: value > 0 ? `أقبض ${absolute}` : `أدفع ${absolute}`,
  }
}

export function compareBalanceBuckets(a, b) {
  const aActive = Math.abs(a.dinar) > 0.000001 || Math.abs(a.usd) > 0.000001 || Math.abs(a.try) > 0.000001 || Math.abs(a.eur || 0) > 0.000001
  const bActive = Math.abs(b.dinar) > 0.000001 || Math.abs(b.usd) > 0.000001 || Math.abs(b.try) > 0.000001 || Math.abs(b.eur || 0) > 0.000001
  const aPrimary = accountPrimaryBalance(a)
  const bPrimary = accountPrimaryBalance(b)
  return Number(bActive) - Number(aActive)
    || Math.abs(bPrimary.amount) - Math.abs(aPrimary.amount)
    || Math.abs(bPrimary.secondaryAmount) - Math.abs(aPrimary.secondaryAmount)
    || accountLabel(a.account).localeCompare(accountLabel(b.account), 'ar')
    || String(a.account?.id || '').localeCompare(String(b.account?.id || ''))
}

export function accountPrimaryBalance(bucket = {}) {
  const balances = [
    { amount: Number(bucket.dinar || 0), currency: CURRENCIES.DINAR },
    { amount: Number(bucket.usd || 0), currency: CURRENCIES.USD },
    { amount: Number(bucket.try || 0), currency: CURRENCIES.TRY },
    { amount: Number(bucket.eur || 0), currency: CURRENCIES.EUR },
  ]
  const preferredCurrency = bucket.account?.currencyKind
  const ordered = preferredCurrency === ACCOUNT_CURRENCY_KINDS.MULTI
    ? balances.slice().sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
    : balances.slice().sort((left, right) => Number(right.currency === preferredCurrency) - Number(left.currency === preferredCurrency))
  const nonZero = ordered.filter((item) => hasMoneyValue(item.amount))
  const primary = nonZero[0] || ordered[0]
  const secondary = nonZero[1] || ordered.find((item) => item.currency !== primary.currency)
  return {
    amount: primary.amount,
    currency: primary.currency,
    secondaryAmount: secondary?.amount || 0,
    secondaryCurrency: secondary?.currency || CURRENCIES.USD,
  }
}

export function formatDisplayMeaning(account, amount, currency = CURRENCIES.DINAR) {
  const rounded = Math.round(Number(amount || 0))
  if (!rounded) return 'صفر'
  const formattedAmount = money(Math.abs(rounded), currency)
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return `مصروف ${formattedAmount}`
  if (account?.valueKind === VALUE_KINDS.ASSET) return `قيمة ${formattedAmount}`
  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return rounded > 0 ? `موجود ${formattedAmount}` : `ناقص ${formattedAmount}`
  }
  return rounded > 0 ? `أقبض منه ${formattedAmount}` : `أدفع له ${formattedAmount}`
}

export function closedAccountMatchesForSearch(referenceAccounts = [], selectableAccounts = [], query = '') {
  const normalizedQuery = normalizeAccountSearchText(query)
  if (!normalizedQuery) return []
  const selectableIds = new Set(selectableAccounts.map((account) => account.id))
  return referenceAccounts
    .filter((account) => {
      if (!account?.id || selectableIds.has(account.id)) return false
      if (account.status !== ACCOUNT_STATUSES.INACTIVE && !account.mergedIntoAccountId) return false
      const haystack = normalizeAccountSearchText(`${account.ownerName || ''} ${account.subAccountName || ''} ${accountDetailName(account)} ${account.legacyName || ''}`)
      return haystack.includes(normalizedQuery)
    })
    .sort((left, right) => accountLabel(left).localeCompare(accountLabel(right), 'ar') || left.id.localeCompare(right.id))
}

export function preferredAccountIdsFor(accounts, balanceByAccountId, currency = '', options = {}) {
  return rankMovementAccountsForRole(accounts, balanceByAccountId, '', currency, options)
    .slice(0, 4)
    .map((account) => account.id)
}
