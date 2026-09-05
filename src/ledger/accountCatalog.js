export const ACCOUNT_TYPES = {
  PERSON: 'person',
  CASH: 'cash',
  BANK: 'bank',
  EXPENSE: 'expense',
  ASSET: 'asset',
  PROJECT: 'project',
  SUMMARY: 'summary',
  REVIEW: 'review',
}

export const ACCOUNT_STATUSES = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  NEEDS_REVIEW: 'needs_review',
}

export const VALUE_KINDS = {
  CASH: 'cash',
  BANK: 'bank',
  RECEIVABLE: 'receivable',
  EXPENSE: 'expense',
  ASSET: 'asset',
  PROJECT: 'project',
  SUMMARY: 'summary',
  REVIEW: 'review',
}

export const ACCOUNT_CURRENCY_KINDS = {
  DINAR: 'LYD',
  USD: 'USD',
  TRY: 'TRY',
  EUR: 'EUR',
  MULTI: 'multi',
}

export function normalizeAccountCurrencyKind(value, fallback = ACCOUNT_CURRENCY_KINDS.DINAR) {
  if (value === 'EUR' || value === 'eur' || value === '€') return ACCOUNT_CURRENCY_KINDS.EUR
  if (value === ACCOUNT_CURRENCY_KINDS.USD || value === 'usd' || value === '$') return ACCOUNT_CURRENCY_KINDS.USD
  if (value === ACCOUNT_CURRENCY_KINDS.TRY || value === 'try' || value === 'tl' || value === '₺') return ACCOUNT_CURRENCY_KINDS.TRY
  if (value === ACCOUNT_CURRENCY_KINDS.MULTI || value === 'both') return ACCOUNT_CURRENCY_KINDS.MULTI
  if (value === ACCOUNT_CURRENCY_KINDS.DINAR || value === 'dinar' || value === 'lyd') return ACCOUNT_CURRENCY_KINDS.DINAR
  return fallback
}

export function inferAccountCurrencyKind(account = {}) {
  const openingDinar = Number(account.openingDinar || 0)
  const openingUsd = Number(account.openingUsd || 0)
  const openingTry = Number(account.openingTry || 0)
  const openingEur = Number(account.openingEur || 0)
  const text = `${account.ownerName || ''} ${account.subAccountName || ''} ${account.legacyName || ''}`.toLowerCase()
  if ([openingDinar, openingUsd, openingTry, openingEur].filter(Boolean).length > 1) return ACCOUNT_CURRENCY_KINDS.MULTI
  if (openingEur || /يورو|eur|€/.test(text)) return ACCOUNT_CURRENCY_KINDS.EUR
  if (openingTry || /ليره|ليرة|try|tl|₺/.test(text)) return ACCOUNT_CURRENCY_KINDS.TRY
  if (openingUsd || /دولار|usd|\$/.test(text)) return ACCOUNT_CURRENCY_KINDS.USD
  return ACCOUNT_CURRENCY_KINDS.DINAR
}

function catalogAccount({
  id,
  ownerName,
  subAccountName,
  type,
  valueKind,
  openingDinar = 0,
  openingUsd = 0,
  openingTry = 0,
  currencyKind,
  status = ACCOUNT_STATUSES.ACTIVE,
}) {
  return {
    id,
    legacyName: `${ownerName} / ${subAccountName}`,
    ownerName,
    subAccountName,
    type,
    valueKind,
    openingDinar,
    openingUsd,
    openingTry,
    currencyKind: normalizeAccountCurrencyKind(
      currencyKind,
      inferAccountCurrencyKind({ ownerName, subAccountName, openingDinar, openingUsd, openingTry }),
    ),
    status,
    notes: '',
    createdFrom: 'synthetic_fixture',
  }
}

// Compatibility fixture for automated tests and explicit legacy migrations only.
// New ledgers always start empty and never read this catalog implicitly.
export const adreemAccountCatalog = [
  catalogAccount({
    id: 'me-cash',
    ownerName: 'أنا',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    openingDinar: 50_000,
    openingUsd: 500,
    currencyKind: ACCOUNT_CURRENCY_KINDS.MULTI,
  }),
  catalogAccount({
    id: 'me-jumhouria',
    ownerName: 'أنا',
    subAccountName: 'مصرف تجريبي',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    openingDinar: 30_000,
  }),
  catalogAccount({
    id: 'saeed-cash',
    ownerName: 'شخص أ',
    subAccountName: 'كاش بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    openingDinar: 12_000,
  }),
  catalogAccount({
    id: 'saeed-bank',
    ownerName: 'شخص أ',
    subAccountName: 'شيك بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    openingDinar: 8_000,
  }),
  catalogAccount({
    id: 'rabee-cash',
    ownerName: 'شخص ب',
    subAccountName: 'كاش بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    openingDinar: -20_000,
  }),
  catalogAccount({
    id: 'omar-gold',
    ownerName: 'شخص ج',
    subAccountName: 'كاش بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    openingDinar: 20_000,
  }),
  catalogAccount({
    id: 'demo-asset',
    ownerName: 'أصل تجريبي',
    subAccountName: 'أصل',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    openingDinar: 15_000,
  }),
  catalogAccount({
    id: 'personal-expense',
    ownerName: 'مصروف تجريبي',
    subAccountName: 'مصروف',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    openingDinar: 100_000,
  }),
]

export const adreemSummaryAccounts = [
  catalogAccount({
    id: 'trucks-income-summary',
    ownerName: 'ملخص تجريبي',
    subAccountName: 'دخل',
    type: ACCOUNT_TYPES.SUMMARY,
    valueKind: VALUE_KINDS.SUMMARY,
  }),
]

export const knownExternalAccounts = []

export function buildAccountMap(accounts = []) {
  return new Map(accounts.map((accountItem) => [accountItem.id, accountItem]))
}

export function getActivePostingAccounts(accounts = []) {
  return accounts.filter(
    (accountItem) =>
      accountItem.status === ACCOUNT_STATUSES.ACTIVE && accountItem.type !== ACCOUNT_TYPES.SUMMARY,
  )
}
