import { VALUE_KINDS } from './accountCatalog.js'

const DINAR = 'LYD'
const USD = 'USD'
const MULTI = 'multi'

export function sameLogicalAccount(left, right) {
  if (!left || !right) return false
  const leftOwner = String(left.ownerName || '').trim()
  const leftDetail = String(left.subAccountName || '').trim()
  const rightOwner = String(right.ownerName || '').trim()
  const rightDetail = String(right.subAccountName || '').trim()
  const leftCurrency = accountCurrencyKind(left)
  const rightCurrency = accountCurrencyKind(right)
  return (
    left.id === right.id ||
    (
      Boolean(leftOwner || leftDetail || rightOwner || rightDetail) &&
      leftOwner === rightOwner &&
      leftDetail === rightDetail &&
      leftCurrency === rightCurrency
    )
  )
}

export function transferAccountKind(account) {
  const text = `${account?.subAccountName || ''} ${account?.legacyName || ''}`.toLowerCase()
  if (account?.valueKind === VALUE_KINDS.CASH || /كاش|نقد|cash/.test(text)) return 'cash'
  if (account?.valueKind === VALUE_KINDS.BANK || /مصرف|مصرفي|حساب|الجمهورية|الوحدة|تركيا|bank/.test(text)) return 'bank'
  return account?.valueKind || 'account'
}

export function accountCurrencyKind(account, bucket = null) {
  if (!account) return ''
  if (account.currencyKind === USD || account.currencyKind === DINAR || account.currencyKind === MULTI) return account.currencyKind
  const text = `${account?.ownerName || ''} ${account?.subAccountName || ''} ${account?.legacyName || ''}`.toLowerCase()
  const hasDinar = Math.abs(Number(bucket?.dinar || account.openingDinar || 0)) > 0.000001
  const hasUsd = Math.abs(Number(bucket?.usd || account.openingUsd || 0)) > 0.000001
  if (hasUsd && hasDinar) return MULTI
  if (hasUsd || /دولار|usd|\$/.test(text)) return USD
  return DINAR
}

export function accountCurrencyLabel(account, bucket = null) {
  const kind = accountCurrencyKind(account, bucket)
  if (kind === USD) return 'دولار'
  if (kind === MULTI) return 'دينار + دولار'
  return 'دينار'
}

export function accountSupportsTransferCurrency(account, currency = '', bucket = null) {
  if (!account) return false
  if (!currency) return true
  const kind = accountCurrencyKind(account, bucket)
  return kind === MULTI || kind === currency
}

export function areTransferAccountsCompatible(sourceAccount, destinationAccount, currency = '', sourceBucket = null, destinationBucket = null) {
  if (!sourceAccount || !destinationAccount) return false
  return transferAccountKind(sourceAccount) === transferAccountKind(destinationAccount) &&
    accountSupportsTransferCurrency(sourceAccount, currency, sourceBucket) &&
    accountSupportsTransferCurrency(destinationAccount, currency, destinationBucket)
}

export function transferCompatibilityMessage(sourceAccount, destinationAccount, currency = '', sourceBucket = null, destinationBucket = null) {
  if (!sourceAccount || !destinationAccount) return 'يجب اختيار حساب مصدر ووجهة صحيحين.'
  if (areTransferAccountsCompatible(sourceAccount, destinationAccount, currency, sourceBucket, destinationBucket)) return ''
  const kindLabel = (kind) => {
    if (kind === 'cash') return 'كاش'
    if (kind === 'bank') return 'مصرف'
    return 'حساب'
  }
  const sourceKind = kindLabel(transferAccountKind(sourceAccount))
  const destinationKind = kindLabel(transferAccountKind(destinationAccount))
  if (!accountSupportsTransferCurrency(sourceAccount, currency, sourceBucket) || !accountSupportsTransferCurrency(destinationAccount, currency, destinationBucket)) {
    return 'الحسابان يجب أن يدعما نفس عملة الحركة.'
  }
  return `التحويل يجب أن يكون بين نفس النوع: ${sourceKind} إلى ${destinationKind} غير مسموح.`
}
