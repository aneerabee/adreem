import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص أو جهة',
    detail: 'رصيد بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش',
  },
  {
    key: 'own-cash',
    title: 'كاش عندي',
    detail: 'مكان مال نقدي',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    subAccountName: 'كاش',
  },
  {
    key: 'own-bank',
    title: 'حساب مصرفي',
    detail: 'مكان مال مصرفي',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    subAccountName: 'مصرفي',
  },
  {
    key: 'asset',
    title: 'أصل',
    detail: 'شيء له قيمة',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'أصل',
  },
  {
    key: 'expense',
    title: 'مصروف',
    detail: 'خرج نهائيًا',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    subAccountName: 'مصروف',
  },
]

export const accountDetailOptions = ['كاش', 'مصرفي', 'دولار', 'حساب', 'أصل', 'مصروف']

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

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
