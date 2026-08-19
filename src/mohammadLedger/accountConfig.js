import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS, normalizeAccountCurrencyKind } from './accountCatalog.js'
import { accountCurrencyLabel, normalizeAccountText } from './accountCompatibility.js'

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص أو جهة',
    detail: 'له أو عليه',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش بيننا',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الشخص أو الجهة',
    namePlaceholder: 'مثال: سعيد، المقر، شركة',
    detailLabel: 'طريقة الرصيد',
    detailOptions: ['كاش بيننا', 'شيك بيننا'],
  },
  {
    key: 'own-cash',
    title: 'فلوسي كاش',
    detail: 'كاش عندي',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    ownerName: 'أنا',
    subAccountName: 'كاش',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم مكان الكاش',
    namePlaceholder: 'مثال: كاش البيت، الخزنة، عند سعيد',
    skipDetail: true,
  },
  {
    key: 'own-bank',
    title: 'فلوسي في حساب مصرفي',
    detail: 'بنك أو بطاقة أو محفظة',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    ownerName: 'أنا',
    subAccountName: 'مصرف',
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
    title: 'مشروع / مركز تكلفة',
    detail: 'إيراد ومصاريف',
    type: ACCOUNT_TYPES.PROJECT,
    valueKind: VALUE_KINDS.PROJECT,
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

export const accountPresetGroups = [
  {
    key: 'people',
    title: 'شخص أو جهة',
    hint: 'حساب بيننا',
    keys: ['person-cash'],
  },
  {
    key: 'money',
    title: 'فلوسي',
    hint: 'كاش أو حساب مصرفي',
    keys: ['own-cash', 'own-bank'],
  },
  {
    key: 'tracking',
    title: 'مشروع أو أصل',
    hint: 'إيراد وتكلفة وقيمة',
    keys: ['asset', 'project', 'expense'],
  },
]

export const accountPresetStepCopy = {
  people: {
    title: 'العلاقة',
    question: 'ما نوع الحساب بينكم؟',
    hint: 'هذا للحسابات التي بينك وبين شخص أو جهة.',
  },
  money: {
    title: 'مكان الفلوس',
    question: 'أين موجودة فلوسك؟',
    hint: 'اختر هل هي كاش عندك أو في مصرف أو محفظة.',
  },
  tracking: {
    title: 'نوع التتبع',
    question: 'ماذا تريد أن تتابع؟',
    hint: 'أصل، مشروع، أو نوع مصروف مستقل.',
  },
}

export const accountClassificationOptions = accountPresets.map((preset) => ({
  value: `${preset.type}|${preset.valueKind}`,
  label: preset.title,
  type: preset.type,
  valueKind: preset.valueKind,
}))

export function emptyAccountDraft() {
  return {
    ownerName: '',
    subAccountName: 'كاش بيننا',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    notes: '',
  }
}

export function accountPresetFor(type, valueKind) {
  return accountPresets.find((preset) => preset.type === type && preset.valueKind === valueKind) || accountPresets[0]
}

export function accountPresetGroupFor(presetOrKey = '') {
  const presetKey = typeof presetOrKey === 'string' ? presetOrKey : presetOrKey?.key
  return accountPresetGroups.find((group) => group.key === presetKey || group.keys.includes(presetKey)) || accountPresetGroups[0]
}

export function accountDetailOptionsFor(type, valueKind) {
  const preset = accountPresetFor(type, valueKind)
  return preset.detailOptions || [preset.subAccountName].filter(Boolean)
}

export function displaySubAccountName(value = '') {
  const text = normalizeAccountText(value)
  if (text === 'مصرفي بيننا') return 'شيك بيننا'
  return text
}

export function accountDetailName(account = {}) {
  const text = normalizeAccountText(account.subAccountName)
  const isPersonBalance = account.valueKind === VALUE_KINDS.RECEIVABLE || account.type === ACCOUNT_TYPES.PERSON
  if (!isPersonBalance) return displaySubAccountName(text)
  if (/^(كاش|نقد|نقدي)$/i.test(text)) return 'كاش بيننا'
  if (/^(مصرفي|مصرفي بيننا|حساب|شيك)$/i.test(text)) return 'شيك بيننا'
  return displaySubAccountName(text)
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
  const inputValue = String(value || '')
  if (preset.nameTarget === 'subAccountName') {
    return {
      ...draft,
      ownerName: preset.ownerName || draft.ownerName || '',
      subAccountName: inputValue,
      currencyKind: accountCurrencyKindFor(draft),
    }
  }
  return {
    ...draft,
    ownerName: inputValue,
    subAccountName: draft.subAccountName || preset.subAccountName,
    currencyKind: accountCurrencyKindFor(draft),
  }
}

export function accountDisplayName(account = {}) {
  const ownerName = normalizeAccountText(account.ownerName)
  const subAccountName = accountDetailName(account)
  const isMine = /^أنا$|^انا$/i.test(ownerName)
  const currencySuffix = accountNeedsCurrency(account) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (account.valueKind === VALUE_KINDS.CASH || (isMine && /كاش|نقد|خزنة|cash/i.test(subAccountName))) return `كاش: ${subAccountName || ownerName || 'كاش'}${currencySuffix}`
  if (account.valueKind === VALUE_KINDS.BANK || (isMine && /مصرف|بنك|حساب|الجمهورية|الوحدة|bank/i.test(subAccountName))) return `مصرف: ${subAccountName || ownerName || 'حساب'}${currencySuffix}`
  if (account.type === ACCOUNT_TYPES.PROJECT) return `مشروع: ${ownerName || subAccountName || 'بدون اسم'}`
  if (account.valueKind === VALUE_KINDS.ASSET) return `أصل: ${ownerName || subAccountName || 'بدون اسم'}`
  if (account.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${ownerName || subAccountName || 'بدون اسم'}`
  if (ownerName && subAccountName) return `${ownerName} · ${subAccountName}${currencySuffix}`
  return ownerName || subAccountName || 'حساب بدون اسم'
}

export function accountKindLabel(account = {}) {
  const currencySuffix = accountNeedsCurrency(account) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (account.valueKind === VALUE_KINDS.CASH) return `كاش${currencySuffix}`
  if (account.valueKind === VALUE_KINDS.BANK) return `مصرف${currencySuffix}`
  if (account.type === ACCOUNT_TYPES.PROJECT) return 'مشروع / مركز تكلفة'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'أصل أملكه'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'مصروف'
  if (account.valueKind === VALUE_KINDS.REVIEW || account.type === ACCOUNT_TYPES.REVIEW) return 'مراجعة'
  return `شخص أو جهة${currencySuffix}`
}

export function accountDraftSummary(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const nameValue = accountNameValue(draft)
  const currencySuffix = accountNeedsCurrency(draft) ? ` · ${accountCurrencyLabel({ currencyKind: accountCurrencyKindFor(draft) })}` : ''
  if (draft.valueKind === VALUE_KINDS.CASH) return `كاش: ${nameValue || preset.subAccountName}${currencySuffix}`
  if (draft.valueKind === VALUE_KINDS.BANK) return `مصرف: ${nameValue || preset.subAccountName}${currencySuffix}`
  if (draft.type === ACCOUNT_TYPES.PROJECT) return `مشروع: ${nameValue || 'بدون اسم'}`
  if (draft.valueKind === VALUE_KINDS.ASSET) return `أصل أملكه: ${nameValue || 'بدون اسم'}`
  if (draft.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${nameValue || 'بدون اسم'}`
  return `${nameValue || 'بدون اسم'} · ${displaySubAccountName(draft.subAccountName || preset.subAccountName)}${currencySuffix}`
}

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
