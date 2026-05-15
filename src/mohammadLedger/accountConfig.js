import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص / جهة',
    detail: 'دين أو رصيد بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الشخص أو الجهة',
    namePlaceholder: 'مثال: سعيد',
    detailLabel: 'نوع التعامل',
    detailOptions: ['كاش', 'حساب مصرفي'],
  },
  {
    key: 'own-cash',
    title: 'مالي - كاش',
    detail: 'نقد عندي',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    ownerName: 'أنا',
    subAccountName: 'كاش',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم مكان الكاش',
    namePlaceholder: 'مثال: كاش أو خزنة',
    skipDetail: true,
  },
  {
    key: 'own-bank',
    title: 'مالي - حساب مصرفي',
    detail: 'مصرف أو بطاقة',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    ownerName: 'أنا',
    subAccountName: 'حساب مصرفي',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم المصرف أو الحساب',
    namePlaceholder: 'مثال: الجمهورية',
    skipDetail: true,
  },
  {
    key: 'asset',
    title: 'أصل',
    detail: 'شيء له قيمة',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'أصل',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الأصل',
    namePlaceholder: 'مثال: سيارة',
    skipDetail: true,
  },
  {
    key: 'expense',
    title: 'بند مصروف',
    detail: 'تصنيف للصرف',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    subAccountName: 'مصروف',
    nameTarget: 'ownerName',
    nameLabel: 'اسم بند المصروف',
    namePlaceholder: 'مثال: مصروف شخصي',
    skipDetail: true,
  },
]

export const accountClassificationOptions = accountPresets.map((preset) => ({
  value: `${preset.type}|${preset.valueKind}`,
  label: preset.title,
  type: preset.type,
  valueKind: preset.valueKind,
}))

export function emptyAccountDraft() {
  return {
    ownerName: '',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    notes: '',
  }
}

export function accountPresetFor(type, valueKind) {
  return accountPresets.find((preset) => preset.type === type && preset.valueKind === valueKind) || accountPresets[0]
}

export function accountDetailOptionsFor(type, valueKind) {
  const preset = accountPresetFor(type, valueKind)
  return preset.detailOptions || [preset.subAccountName].filter(Boolean)
}

export function accountNameValue(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  return preset.nameTarget === 'subAccountName' ? draft.subAccountName || '' : draft.ownerName || ''
}

export function applyAccountName(draft = {}, value = '') {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const cleanValue = String(value || '').trim()
  if (preset.nameTarget === 'subAccountName') {
    return {
      ...draft,
      ownerName: preset.ownerName || draft.ownerName || '',
      subAccountName: cleanValue || preset.subAccountName,
    }
  }
  return {
    ...draft,
    ownerName: cleanValue,
    subAccountName: draft.subAccountName || preset.subAccountName,
  }
}

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
