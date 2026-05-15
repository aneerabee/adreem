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

export function accountSupportsTransferCurrency(account) {
  return Boolean(account)
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
  return `التحويل يجب أن يكون بين نفس النوع: ${sourceKind} إلى ${destinationKind} غير مسموح.`
}
