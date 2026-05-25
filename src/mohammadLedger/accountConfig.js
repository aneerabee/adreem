import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS, normalizeAccountCurrencyKind } from './accountCatalog.js'
import { accountCurrencyLabel } from './accountCompatibility.js'

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص / جهة',
    detail: 'رصيد بيني وبينه',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'نقدي معه',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الشخص أو الجهة',
    namePlaceholder: 'مثال: سعيد، المقر، شركة',
    detailLabel: 'شكل الحساب بينكم',
    detailOptions: ['نقدي معه', 'حساب بنكي له'],
  },
  {
    key: 'own-cash',
    title: 'صندوق نقدي عندي',
    detail: 'دينار أو دولار في اليد',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    ownerName: 'أنا',
    subAccountName: 'صندوق نقدي',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم الصندوق',
    namePlaceholder: 'مثال: كاش البيت، الخزنة، سعيد',
    skipDetail: true,
  },
  {
    key: 'own-bank',
    title: 'حساب بنكي عندي',
    detail: 'مصرف / بطاقة / محفظة',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    ownerName: 'أنا',
    subAccountName: 'حساب بنكي',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم البنك أو المحفظة',
    namePlaceholder: 'مثال: الجمهورية، الوحدة، بطاقة',
    skipDetail: true,
  },
  {
    key: 'asset',
    title: 'أصل أملكه',
    detail: 'شيء له قيمة',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'أصل',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الأصل',
    namePlaceholder: 'مثال: شاحنة أو أرض',
    skipDetail: true,
  },
  {
    key: 'project',
    title: 'أصل / مشروع للتتبع',
    detail: 'قيمة أو ملف متابعة',
    type: ACCOUNT_TYPES.PROJECT,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'مشروع',
    nameTarget: 'ownerName',
    nameLabel: 'اسم المشروع',
    namePlaceholder: 'مثال: شاحنة تعمل، مقر، ورشة',
    skipDetail: true,
  },
  {
    key: 'expense',
    title: 'نوع مصروف',
    detail: 'تكلفة نهائية',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    subAccountName: 'مصروف',
    nameTarget: 'ownerName',
    nameLabel: 'اسم المصروف',
    namePlaceholder: 'مثال: مصروف شخصي أو وقود',
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
    subAccountName: 'نقدي معه',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
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

export function accountNeedsCurrency(draftOrPreset = {}) {
  const valueKind = draftOrPreset.valueKind
  return valueKind === VALUE_KINDS.CASH || valueKind === VALUE_KINDS.BANK || valueKind === VALUE_KINDS.RECEIVABLE
}

export function accountCurrencyKindFor(draft = {}) {
  return normalizeAccountCurrencyKind(draft.currencyKind, ACCOUNT_CURRENCY_KINDS.DINAR)
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
      currencyKind: accountCurrencyKindFor(draft),
    }
  }
  return {
    ...draft,
    ownerName: cleanValue,
    subAccountName: draft.subAccountName || preset.subAccountName,
    currencyKind: accountCurrencyKindFor(draft),
  }
}

export function accountDisplayName(account = {}) {
  const ownerName = String(account.ownerName || '').trim()
  const subAccountName = String(account.subAccountName || '').trim()
  const isMine = /^أنا$|^انا$/i.test(ownerName)
  const currencySuffix = accountNeedsCurrency(account) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (account.valueKind === VALUE_KINDS.CASH || (isMine && /كاش|نقد|خزنة|cash/i.test(subAccountName))) return `صندوقي: ${subAccountName || ownerName || 'نقدي'}${currencySuffix}`
  if (account.valueKind === VALUE_KINDS.BANK || (isMine && /مصرف|بنك|حساب|الجمهورية|الوحدة|bank/i.test(subAccountName))) return `بنكي: ${subAccountName || ownerName || 'حساب'}${currencySuffix}`
  if (account.type === ACCOUNT_TYPES.PROJECT) return `مشروع: ${ownerName || subAccountName || 'بدون اسم'}`
  if (account.valueKind === VALUE_KINDS.ASSET) return `أصل: ${ownerName || subAccountName || 'بدون اسم'}`
  if (account.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${ownerName || subAccountName || 'بدون اسم'}`
  if (ownerName && subAccountName) return `${ownerName} · ${subAccountName}${currencySuffix}`
  return ownerName || subAccountName || 'حساب بدون اسم'
}

export function accountKindLabel(account = {}) {
  const currencySuffix = accountNeedsCurrency(account) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (account.valueKind === VALUE_KINDS.CASH) return `صندوق نقدي عندي${currencySuffix}`
  if (account.valueKind === VALUE_KINDS.BANK) return `حساب بنكي عندي${currencySuffix}`
  if (account.type === ACCOUNT_TYPES.PROJECT) return 'أصل / مشروع للتتبع'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'أصل أملكه'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'مصروف'
  if (account.valueKind === VALUE_KINDS.REVIEW || account.type === ACCOUNT_TYPES.REVIEW) return 'مراجعة'
  return `شخص / جهة${currencySuffix}`
}

export function accountDraftSummary(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const nameValue = accountNameValue(draft)
  const currencySuffix = accountNeedsCurrency(draft) ? ` · ${accountCurrencyLabel({ currencyKind: accountCurrencyKindFor(draft) })}` : ''
  if (draft.valueKind === VALUE_KINDS.CASH) return `صندوقي: ${nameValue || preset.subAccountName}${currencySuffix}`
  if (draft.valueKind === VALUE_KINDS.BANK) return `بنكي: ${nameValue || preset.subAccountName}${currencySuffix}`
  if (draft.type === ACCOUNT_TYPES.PROJECT) return `مشروع: ${nameValue || 'بدون اسم'}`
  if (draft.valueKind === VALUE_KINDS.ASSET) return `أصل أملكه: ${nameValue || 'بدون اسم'}`
  if (draft.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${nameValue || 'بدون اسم'}`
  return `${nameValue || 'بدون اسم'} · ${draft.subAccountName || preset.subAccountName}${currencySuffix}`
}

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
