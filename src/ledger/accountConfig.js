import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS, normalizeAccountCurrencyKind } from './accountCatalog.js'
import { accountCurrencyLabel, normalizeAccountText } from './accountCompatibility.js'

export const ACCOUNT_OPENING_DIRECTIONS = {
  OWED_TO_ME: 'owed_to_me',
  I_OWE: 'i_owe',
}

export const COUNTERPARTY_ACCOUNT_KINDS = {
  CASH_DINAR: 'cash-dinar',
  CHEQUE_DINAR: 'cheque-dinar',
  CASH_USD: 'cash-usd',
}

export const counterpartyAccountChannels = [
  {
    key: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR,
    label: 'دينار كاش',
    shortLabel: 'كاش',
    subAccountName: 'كاش بيننا',
    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
  },
  {
    key: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR,
    label: 'دينار شيك',
    shortLabel: 'شيك',
    subAccountName: 'شيك بيننا',
    currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
  },
  {
    key: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD,
    label: 'دولار',
    shortLabel: 'دولار',
    subAccountName: 'دولار بيننا',
    currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
  },
]

const OPENING_BALANCE_VALUE_KINDS = new Set([
  VALUE_KINDS.RECEIVABLE,
  VALUE_KINDS.CASH,
  VALUE_KINDS.BANK,
  VALUE_KINDS.ASSET,
])

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص أو جهة',
    detail: 'كاش وشيك ودولار',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش بيننا',
    counterpartyBundle: true,
    nameTarget: 'ownerName',
    nameLabel: 'اسم الشخص أو الجهة',
    namePlaceholder: 'مثال: سعيد، المقر، شركة',
    detailLabel: 'نوع التعامل',
    detailOptions: counterpartyAccountChannels.map((channel) => channel.subAccountName),
  },
  {
    key: 'own-cash',
    title: 'كاش عندي',
    detail: 'خزنة أو مكان كاش',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    ownerName: 'أنا',
    subAccountName: 'كاش',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم مكان الكاش',
    namePlaceholder: 'مثال: خزنة البيت أو كاش المكتب',
    skipDetail: true,
  },
  {
    key: 'own-bank',
    title: 'حساب مصرفي',
    detail: 'مصرف أو بطاقة أو محفظة',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    ownerName: 'أنا',
    subAccountName: 'مصرف',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم المصرف أو المحفظة',
    namePlaceholder: 'مثال: مصرف الجمهورية أو بطاقة الفيزا',
    skipDetail: true,
  },
  {
    key: 'asset',
    title: 'أصل',
    detail: 'شيء أملكه وله قيمة',
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
    title: 'مشروع',
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
    detail: 'مصروفات متشابهة',
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
    hint: 'أقبض منه أو أدفع له',
    keys: ['person-cash'],
  },
  {
    key: 'money',
    title: 'فلوسي',
    hint: 'كاش أو مصرف',
    keys: ['own-cash', 'own-bank'],
  },
  {
    key: 'tracking',
    title: 'متابعة',
    hint: 'أصل أو مشروع أو مصروف',
    keys: ['asset', 'project', 'expense'],
  },
]

export const accountPresetStepCopy = {
  people: {
    title: 'الحساب بينكما',
    question: 'من هو الشخص أو الجهة؟',
    hint: 'سنسجل ما لك وما عليك معه.',
  },
  money: {
    title: 'أين الفلوس؟',
    question: 'أين تحتفظ بفلوسك؟',
    hint: 'اختر كاش أو حسابًا مصرفيًا.',
  },
  tracking: {
    title: 'ماذا تتابع؟',
    question: 'ماذا تريد أن تتابع؟',
    hint: 'اختر أصلًا أو مشروعًا أو نوع مصروف.',
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
    counterpartyBundle: true,
    counterpartyOpenings: emptyCounterpartyOpenings(),
    openingBalanceAmount: '',
    openingBalanceDirection: '',
    notes: '',
  }
}

export function emptyCounterpartyOpenings() {
  return Object.fromEntries(counterpartyAccountChannels.map((channel) => [
    channel.key,
    { amount: '', direction: '' },
  ]))
}

function openingInputNumber(value) {
  const normalized = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[,،\s]/g, '')
  const number = Number(normalized)
  return Number.isFinite(number) ? Math.round(number) : 0
}

export function accountSupportsOpeningBalance(draftOrAccount = {}) {
  return OPENING_BALANCE_VALUE_KINDS.has(draftOrAccount.valueKind)
}

export function accountOpeningAmounts(draft = {}) {
  if (!accountSupportsOpeningBalance(draft)) return { openingDinar: 0, openingUsd: 0 }

  const hasWizardAmount = Object.hasOwn(draft, 'openingBalanceAmount')
  if (!hasWizardAmount) {
    return {
      openingDinar: openingInputNumber(draft.openingDinar),
      openingUsd: openingInputNumber(draft.openingUsd),
    }
  }

  const unsignedAmount = Math.max(0, openingInputNumber(draft.openingBalanceAmount))
  const direction = draft.valueKind === VALUE_KINDS.RECEIVABLE && draft.openingBalanceDirection === ACCOUNT_OPENING_DIRECTIONS.I_OWE
    ? -1
    : 1
  const signedAmount = unsignedAmount * direction
  return accountCurrencyKindFor(draft) === ACCOUNT_CURRENCY_KINDS.USD
    ? { openingDinar: 0, openingUsd: signedAmount }
    : { openingDinar: signedAmount, openingUsd: 0 }
}

export function accountOpeningDraftErrors(draft = {}) {
  if (!Object.hasOwn(draft, 'openingBalanceAmount')) return []
  const amount = Math.max(0, openingInputNumber(draft.openingBalanceAmount))
  if (
    draft.valueKind === VALUE_KINDS.RECEIVABLE &&
    amount > 0 &&
    !Object.values(ACCOUNT_OPENING_DIRECTIONS).includes(draft.openingBalanceDirection)
  ) {
    return [{ field: 'openingBalanceDirection', message: 'حدد هل الرصيد لك عنده أو عليك له.' }]
  }
  return []
}

export function isCounterpartyBundleDraft(draft = {}) {
  return draft.counterpartyBundle === true && draft.type === ACCOUNT_TYPES.PERSON && draft.valueKind === VALUE_KINDS.RECEIVABLE
}

export function isCounterpartyAccount(account = {}) {
  return account.type === ACCOUNT_TYPES.PERSON && account.valueKind === VALUE_KINDS.RECEIVABLE
}

export function counterpartyOpeningFor(draft = {}, channelKey = '') {
  const opening = draft.counterpartyOpenings?.[channelKey] || {}
  const amount = Math.max(0, openingInputNumber(opening.amount))
  const direction = Object.values(ACCOUNT_OPENING_DIRECTIONS).includes(opening.direction) ? opening.direction : ''
  return { amount, direction }
}

export function counterpartyOpeningDraftErrors(draft = {}) {
  if (!isCounterpartyBundleDraft(draft)) return []
  return counterpartyAccountChannels.flatMap((channel) => {
    const opening = counterpartyOpeningFor(draft, channel.key)
    if (opening.amount > 0 && !opening.direction) {
      return [{
        field: `counterpartyOpenings.${channel.key}.direction`,
        message: `حدد هل رصيد ${channel.label} لك عنده أو عليك له.`,
      }]
    }
    return []
  })
}

export function counterpartyAccountDrafts(draft = {}) {
  if (!isCounterpartyBundleDraft(draft)) return []
  const ownerName = normalizeAccountText(draft.ownerName)
  return counterpartyAccountChannels.map((channel) => {
    const opening = counterpartyOpeningFor(draft, channel.key)
    const signedAmount = opening.direction === ACCOUNT_OPENING_DIRECTIONS.I_OWE ? -opening.amount : opening.amount
    return {
      ownerName,
      subAccountName: channel.subAccountName,
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: channel.currencyKind,
      openingDinar: channel.currencyKind === ACCOUNT_CURRENCY_KINDS.DINAR ? signedAmount : 0,
      openingUsd: channel.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? signedAmount : 0,
      counterpartyKind: channel.key,
      notes: String(draft.notes || '').trim(),
    }
  })
}

export function counterpartyChannelForAccount(account = {}) {
  const explicit = counterpartyAccountChannels.find((channel) => channel.key === account.counterpartyKind)
  if (explicit) return explicit
  const detail = normalizeAccountText(account.subAccountName)
  if (accountCurrencyKindFor(account) === ACCOUNT_CURRENCY_KINDS.USD || /دولار|usd/i.test(detail)) {
    return counterpartyAccountChannels.find((channel) => channel.key === COUNTERPARTY_ACCOUNT_KINDS.CASH_USD)
  }
  if (/شيك|مصرف|بنك|حساب/i.test(detail)) {
    return counterpartyAccountChannels.find((channel) => channel.key === COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR)
  }
  return counterpartyAccountChannels.find((channel) => channel.key === COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR)
}

export function counterpartyGroupKey(account = {}) {
  if (!isCounterpartyAccount(account)) return ''
  return String(account.counterpartyId || `legacy:${normalizeAccountText(account.ownerName).toLocaleLowerCase('ar')}`).trim()
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
  return preset.detailOptions || (preset.counterpartyBundle ? counterpartyAccountChannels.map((channel) => channel.subAccountName) : [preset.subAccountName].filter(Boolean))
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
  if (/^(دولار|دولار بيننا|usd)$/i.test(text)) return 'دولار بيننا'
  return displaySubAccountName(text)
}

export function accountDetailDisplayName(account = {}) {
  const detail = accountDetailName(account)
  if (detail === 'كاش بيننا') return 'كاش'
  if (detail === 'شيك بيننا') return 'شيك'
  if (detail === 'دولار بيننا') return 'دولار'
  return detail
}

export function accountNeedsCurrency(draftOrPreset = {}) {
  if (isCounterpartyBundleDraft(draftOrPreset) || draftOrPreset.counterpartyBundle === true) return false
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

export function applyAccountClassification(draft = {}, type, valueKind) {
  if (draft.type === type && draft.valueKind === valueKind) return { ...draft }
  const currentName = accountNameValue(draft)
  const preset = accountPresetFor(type, valueKind)
  const nextDraft = {
    ...draft,
    type: preset.type,
    valueKind: preset.valueKind,
    currencyKind: accountCurrencyKindFor(draft),
    counterpartyBundle: draft.counterpartyBundle === true && Boolean(preset.counterpartyBundle),
  }
  if (preset.nameTarget === 'subAccountName') {
    return {
      ...nextDraft,
      ownerName: preset.ownerName || 'أنا',
      subAccountName: currentName,
    }
  }
  return {
    ...nextDraft,
    ownerName: currentName,
    subAccountName: preset.subAccountName,
  }
}

function accountPresentationValueKind(account = {}) {
  if (Object.values(VALUE_KINDS).includes(account.valueKind)) return account.valueKind
  if (account.type === ACCOUNT_TYPES.CASH) return VALUE_KINDS.CASH
  if (account.type === ACCOUNT_TYPES.BANK) return VALUE_KINDS.BANK
  if (account.type === ACCOUNT_TYPES.ASSET) return VALUE_KINDS.ASSET
  if (account.type === ACCOUNT_TYPES.PROJECT) return VALUE_KINDS.PROJECT
  if (account.type === ACCOUNT_TYPES.EXPENSE) return VALUE_KINDS.EXPENSE
  if (account.type === ACCOUNT_TYPES.REVIEW) return VALUE_KINDS.REVIEW
  const ownerName = normalizeAccountText(account.ownerName)
  const detail = normalizeAccountText(account.subAccountName)
  const isMine = /^(أنا|انا)$/i.test(ownerName)
  if (isMine && /كاش|نقد|خزنة|cash/i.test(detail)) return VALUE_KINDS.CASH
  if (isMine && /مصرف|بنك|حساب|بطاقة|محفظة|bank/i.test(detail)) return VALUE_KINDS.BANK
  if (account.type === ACCOUNT_TYPES.PERSON || ownerName) return VALUE_KINDS.RECEIVABLE
  return VALUE_KINDS.REVIEW
}

export function accountPrimaryName(account = {}) {
  const preset = accountPresetFor(account.type, account.valueKind)
  const kind = accountPresentationValueKind(account)
  const name = normalizeAccountText(kind === VALUE_KINDS.CASH || kind === VALUE_KINDS.BANK ? account.subAccountName : account.ownerName || accountNameValue(account))
  if (kind === VALUE_KINDS.CASH && /^(كاش|نقد|نقدي|cash)$/i.test(name)) return 'كاش عندي'
  if (kind === VALUE_KINDS.BANK && /^(مصرف|بنك|حساب|حساب مصرفي|bank)$/i.test(name)) return 'حسابي المصرفي'
  if (name) return name
  if (kind === VALUE_KINDS.CASH) return 'كاش عندي'
  if (kind === VALUE_KINDS.BANK) return 'حسابي المصرفي'
  return preset.title || 'حساب بدون اسم'
}

export function accountContextLabel(account = {}) {
  const kind = accountPresentationValueKind(account)
  const currencySuffix = [VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.RECEIVABLE].includes(kind) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (kind === VALUE_KINDS.CASH) return `كاش${currencySuffix}`
  if (kind === VALUE_KINDS.BANK) return `حساب مصرفي${currencySuffix}`
  if (kind === VALUE_KINDS.PROJECT) return 'مشروع'
  if (kind === VALUE_KINDS.ASSET) return 'أصل'
  if (kind === VALUE_KINDS.EXPENSE) return 'نوع مصروف'
  if (kind === VALUE_KINDS.REVIEW) return 'مراجعة'
  if (kind === VALUE_KINDS.RECEIVABLE) {
    const detail = accountDetailDisplayName({ ...account, type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE })
    return `${detail || 'رصيد'}${currencySuffix}`
  }
  return accountKindLabel(account)
}

export function accountChoiceKind(account = {}) {
  const kind = accountPresentationValueKind(account)
  if (kind !== VALUE_KINDS.RECEIVABLE) return kind
  if (counterpartyChannelForAccount(account)?.key === COUNTERPARTY_ACCOUNT_KINDS.CASH_USD) return 'person-usd'
  return /مصرف|بنك|شيك|حساب|bank/i.test(account.subAccountName || '') ? 'person-bank' : 'person-cash'
}

export function accountChoiceKindLabel(account = {}) {
  const kind = accountChoiceKind(account)
  if (kind === VALUE_KINDS.CASH) return 'كاش'
  if (kind === VALUE_KINDS.BANK) return 'مصرف'
  if (kind === 'person-bank') return 'شيك'
  if (kind === 'person-cash') return 'كاش'
  if (kind === 'person-usd') return 'دولار'
  if (kind === VALUE_KINDS.PROJECT) return 'مشروع'
  if (kind === VALUE_KINDS.ASSET) return 'أصل'
  if (kind === VALUE_KINDS.EXPENSE) return 'نوع مصروف'
  return 'حساب'
}

export function accountDisplayName(account = {}) {
  const primaryName = accountPrimaryName(account)
  const context = accountContextLabel(account)
  return context && context !== primaryName ? `${primaryName} · ${context}` : primaryName
}

export function accountKindLabel(account = {}) {
  const kind = accountPresentationValueKind(account)
  const currencySuffix = [VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.RECEIVABLE].includes(kind) ? ` · ${accountCurrencyLabel(account)}` : ''
  if (kind === VALUE_KINDS.CASH) return `كاش${currencySuffix}`
  if (kind === VALUE_KINDS.BANK) return `حساب مصرفي${currencySuffix}`
  if (kind === VALUE_KINDS.PROJECT) return 'مشروع'
  if (kind === VALUE_KINDS.ASSET) return 'أصل'
  if (kind === VALUE_KINDS.EXPENSE) return 'نوع مصروف'
  if (kind === VALUE_KINDS.REVIEW) return 'مراجعة'
  return `شخص أو جهة${currencySuffix}`
}

export function accountDraftSummary(draft = {}) {
  return accountDisplayName(draft)
}

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
