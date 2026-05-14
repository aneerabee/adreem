import { VALUE_KINDS } from './accountCatalog.js'

export function sameLogicalAccount(left, right) {
  if (!left || !right) return false
  const leftOwner = String(left.ownerName || '').trim()
  const leftDetail = String(left.subAccountName || '').trim()
  const rightOwner = String(right.ownerName || '').trim()
  const rightDetail = String(right.subAccountName || '').trim()
  return (
    left.id === right.id ||
    (
      Boolean(leftOwner || leftDetail || rightOwner || rightDetail) &&
      leftOwner === rightOwner &&
      leftDetail === rightDetail
    )
  )
}

export function transferAccountKind(account) {
  const text = `${account?.subAccountName || ''} ${account?.legacyName || ''}`.toLowerCase()
  if (account?.valueKind === VALUE_KINDS.CASH || /كاش|نقد|cash/.test(text)) return 'cash'
  if (account?.valueKind === VALUE_KINDS.BANK || /مصرف|مصرفي|حساب|الجمهورية|الوحدة|تركيا|bank/.test(text)) return 'bank'
  return account?.valueKind || 'account'
}

function accountCurrencyText(account) {
  return `${account?.ownerName || ''} ${account?.subAccountName || ''} ${account?.legacyName || ''} ${account?.notes || ''}`.toLowerCase()
}

export function accountSupportsTransferCurrency(account, currency, bucket = null) {
  if (!account) return false
  if (!currency || currency === 'LYD') return true
  if (currency !== 'USD') return true
  const hasUsdBalance = Math.abs(Number(bucket?.usd || 0)) > 0.000001
  const hasOpeningUsd = Math.abs(Number(account.openingUsd || 0)) > 0.000001
  return hasUsdBalance || hasOpeningUsd || /دولار|usd|\$/.test(accountCurrencyText(account))
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
  if (
    currency === 'USD' &&
    (
      !accountSupportsTransferCurrency(sourceAccount, currency, sourceBucket) ||
      !accountSupportsTransferCurrency(destinationAccount, currency, destinationBucket)
    )
  ) {
    return 'تحويل الدولار مسموح فقط بين حسابات دولار واضحة.'
  }
  const kindLabel = (kind) => {
    if (kind === 'cash') return 'كاش'
    if (kind === 'bank') return 'مصرف'
    return 'حساب'
  }
  const sourceKind = kindLabel(transferAccountKind(sourceAccount))
  const destinationKind = kindLabel(transferAccountKind(destinationAccount))
  return `التحويل يجب أن يكون بين نفس النوع: ${sourceKind} إلى ${destinationKind} غير مسموح.`
}
