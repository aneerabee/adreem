import { CURRENCIES, MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import {
  accountChoiceKind,
  accountChoiceKindLabel,
  accountContextLabel,
  accountDetailName,
  accountDetailOptionsFor,
  accountNeedsCurrency,
  accountNameValue,
  accountOpeningAmounts,
  accountPresetFor,
  accountPresetGroupFor,
  accountPresetStepCopy,
  accountPrimaryName,
  accountSupportsOpeningBalance,
  counterpartyAccountChannels,
  counterpartyOpeningFor,
  isCounterpartyBundleDraft,
} from '../../src/mohammadLedger/accountConfig.js'
import { VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { accountEditChanges } from '../../src/mohammadLedger/accountEditing.js'
import {
  movementConfigFor,
  movementLabels,
  movementNeedsDestination,
  movementNeedsRate,
  movementNeedsSource,
  movementSupportsDimension,
  movementSupportsExpenseCategory,
  movementTone,
} from '../../src/mohammadLedger/movementConfig.js'
import { formatMoney, formatRate } from '../mohammadLedger/ledgerService.js'
import { preserveUiData } from '../../src/mohammadLedger/uiTranslation.js'
import { formatZonedDate, formatZonedTime } from './dateRange.js'
import { numericBufferDisplay } from './numericKeypad.js'

export { movementLabels }

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlLine(label, value) {
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`
}

function htmlDataLine(label, value) {
  return htmlLine(label, preserveUiData(value))
}

export function protectedAccountLabel(account) {
  if (!account) return ''
  const primaryName = protectedAccountPrimaryName(account)
  const context = protectedAccountContext(account)
  return context && context !== primaryName ? `${primaryName} · ${context}` : primaryName
}

function protectedAccountPrimaryName(account) {
  if (!account) return ''
  const primaryName = accountPrimaryName(account)
  const enteredName = String(accountNameValue(account) || '').trim().replace(/\s+/g, ' ')
  return enteredName && enteredName === primaryName ? preserveUiData(primaryName) : primaryName
}

function protectedAccountContext(account) {
  if (!account) return ''
  const context = accountContextLabel(account)
  const detail = accountDetailName(account)
  const knownDetails = accountDetailOptionsFor(account.type, account.valueKind)
  if (knownDetails.some((knownDetail) => context.startsWith(knownDetail))) return context
  return detail && context.includes(detail) ? context.replace(detail, preserveUiData(detail)) : context
}

function currencyLabel(currency) {
  if (currency === CURRENCIES.USD) return 'دولار'
  if (currency === CURRENCIES.DINAR) return 'دينار'
  return 'غير محددة'
}

function movementIcon(type) {
  const tone = movementTone(type)
  if (tone === 'expense') return '🔴'
  if (tone === 'income') return '🟢'
  if (tone === 'sale') return '🟢'
  if (tone === 'purchase') return '🔵'
  if (tone === 'transfer') return '🔁'
  if (tone === 'deposit') return '🏦'
  if (tone === 'withdrawal') return '💵'
  return '◼'
}

function movementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'معتمدة'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغاة'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقصة'
  return 'مسودة'
}

function movementDateLabel(movement, { includeDate = false } = {}) {
  const value = movement?.createdAt || movement?.updatedAt || ''
  const time = formatZonedTime(value, 'ar-LY', { hour: '2-digit', minute: '2-digit' })
  if (!time) return ''
  if (!includeDate) return time
  const day = formatZonedDate(value, 'ar-LY', { month: '2-digit', day: '2-digit' })
  return `${day} · ${time}`
}

function cleanMovementNote(note) {
  const text = String(note || '').trim()
  if (!text) return ''
  return text.length > 42 ? `${text.slice(0, 39)}...` : text
}

function currentStepTitle(session) {
  const draft = session?.draft || {}
  const config = movementConfigFor(draft.type)
  if (session?.step === 'type') return 'اختر نوع الحركة'
  if (session?.step === 'amount') return config.amountLabel || 'اكتب المبلغ'
  if (session?.step === 'currency') return 'اختر العملة'
  if (session?.step === 'rate') return config.rateLabel || 'اكتب سعر الصرف'
  if (session?.step === 'source') return config.sourceQuestion || `اختر ${config.sourceLabel}`
  if (session?.step === 'destination') return config.destinationQuestion || `اختر ${config.destinationLabel}`
  if (session?.step === 'note') return 'أضف ملاحظة'
  if (session?.step === 'dimension') return 'اربط مشروعًا'
  if (session?.step === 'category') return 'اختر نوع المصروف'
  if (session?.step === 'attachment') return 'أضف مرفقًا'
  if (session?.step === 'recurring') return 'هل تتكرر؟'
  if (session?.step === 'review') return 'راجع قبل الحفظ'
  return 'إدخال حركة'
}

function currentStepHelp(session) {
  if (session?.step === 'type') return ''
  if (session?.step === 'amount') return ''
  if (session?.step === 'currency') return ''
  if (session?.step === 'rate') return ''
  if (session?.step === 'source') return ''
  if (session?.step === 'destination') return ''
  if (session?.step === 'note') return 'اختياري.'
  if (session?.step === 'dimension') return 'اختياري.'
  if (session?.step === 'category') return 'اختياري.'
  if (session?.step === 'attachment') return 'اختياري.'
  if (session?.step === 'recurring') return ''
  if (session?.step === 'review') return ''
  return ''
}

export function mainMenuText(summary = null) {
  const lines = ['<b>ADREEM</b>']
  if (summary) {
    lines.push('')
    lines.push(`<blockquote>${escapeHtml(`اليوم: ${summary.todayCount} حركة\nالمراجعة: ${summary.reviewCount}`)}</blockquote>`)
  }
  lines.push('', '<b>ماذا تريد الآن؟</b>')
  return lines.join('\n')
}

export function alertsText(alerts = []) {
  const safeAlerts = Array.isArray(alerts) ? alerts : []
  const lines = ['<b>ADREEM · تنبيهات</b>', `<code>${safeAlerts.length} تنبيه</code>`]
  if (!safeAlerts.length) {
    lines.push('', '<blockquote>لا توجد تنبيهات الآن.</blockquote>')
    return lines.join('\n')
  }
  lines.push('')
  safeAlerts.forEach((alert) => {
    const icon = alertIcon(alert.tone)
    const value = alert.format === 'money' ? formatMoney(alert.value, CURRENCIES.DINAR) : String(Math.round(Number(alert.value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    lines.push(`<blockquote>${escapeHtml(`${icon} ${alert.title}\n${value}`)}</blockquote>`)
  })
  return lines.join('\n')
}

function alertIcon(tone) {
  if (tone === 'danger') return '🔴'
  if (tone === 'warning') return '🟠'
  if (tone === 'info') return '🔵'
  return '⚪'
}

function accountStepTitle(session) {
  const preset = accountPresetFor(session?.draft?.type, session?.draft?.valueKind)
  const group = accountPresetGroupFor(session?.presetGroup || preset)
  if (session?.step === 'group') return 'ماذا تريد أن تضيف؟'
  if (session?.step === 'type') return accountPresetStepCopy[group.key]?.question || 'اختر النوع'
  if (session?.step === 'owner') return preset.nameLabel || 'اكتب الاسم'
  if (session?.step === 'detail') return preset.detailLabel || 'اختر التفصيل'
  if (session?.step === 'currency') return 'اختر العملة'
  const bundleChannel = isCounterpartyBundleDraft(session?.draft) ? counterpartyAccountChannels[session?.bundleOpeningIndex || 0] : null
  if (session?.step === 'opening') return bundleChannel ? `رصيد ${bundleChannel.label}` : 'أدخل الرصيد عند البداية'
  if (session?.step === 'direction') return bundleChannel ? `${bundleChannel.label}: لمن الرصيد؟` : 'لمن الرصيد؟'
  if (session?.step === 'review') return 'راجع الحساب'
  return 'حساب جديد'
}

function accountStepHelp(session) {
  const preset = accountPresetFor(session?.draft?.type, session?.draft?.valueKind)
  if (session?.step === 'group') return ''
  if (session?.step === 'type') return ''
  if (session?.step === 'owner') return preset.namePlaceholder || 'اكتب الاسم فقط.'
  if (session?.step === 'detail') return ''
  if (session?.step === 'currency') return ''
  if (session?.step === 'opening') return isCounterpartyBundleDraft(session?.draft) ? 'صفر إذا لا يوجد رصيد سابق.' : 'اكتب صفرًا إذا لا يوجد رصيد سابق.'
  if (session?.step === 'direction') return ''
  if (session?.step === 'review') return ''
  return ''
}

export function accountStepText(session) {
  const draft = session?.draft || {}
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const group = accountPresetGroupFor(session?.presetGroup || preset)
  const hasTypeStep = group.keys.length > 1
  const structureLocked = session?.mode === 'edit' && session?.structureLocked
  const hasOpeningStep = session?.mode === 'create' && accountSupportsOpeningBalance(draft)
  const isBundle = session?.mode === 'create' && isCounterpartyBundleDraft(draft)
  const bundleChannel = isBundle ? counterpartyAccountChannels[session?.bundleOpeningIndex || 0] : null
  const openingAmount = Number(session?.openingBuffer || draft.openingBalanceAmount || 0)
  const hasDirectionStep = hasOpeningStep && draft.valueKind === VALUE_KINDS.RECEIVABLE && openingAmount > 0
  const steps = structureLocked
    ? ['owner', 'review']
    : isBundle
      ? ['group', 'owner', 'opening', 'review']
      : ['group', ...(hasTypeStep ? ['type'] : []), 'owner', ...(preset.skipDetail ? [] : ['detail']), ...(accountNeedsCurrency(draft) ? ['currency'] : []), ...(hasOpeningStep ? ['opening'] : []), ...(hasDirectionStep ? ['direction'] : []), 'review']
  const currentStep = isBundle && session?.step === 'direction' ? 'opening' : session?.step
  const currentIndex = Math.max(0, steps.indexOf(currentStep))
  const progress = `${currentIndex + 1}/${steps.length}${bundleChannel && ['opening', 'direction'].includes(session?.step) ? ` · ${Number(session.bundleOpeningIndex || 0) + 1}/${counterpartyAccountChannels.length}` : ''}`
  const summary = []
  if (currentIndex > steps.indexOf('group')) summary.push(htmlLine('الفئة', group.title))
  if (hasTypeStep && currentIndex > steps.indexOf('type') && draft.type) summary.push(htmlLine('الحساب', preset.title))
  const nameValue = accountNameValue(draft)
  if (currentIndex > steps.indexOf('owner') && nameValue) summary.push(htmlDataLine(preset.nameLabel || 'الاسم', nameValue))
  if (!isBundle && !preset.skipDetail && currentIndex > steps.indexOf('detail') && draft.subAccountName) {
    summary.push(htmlLine(preset.detailLabel || 'التفصيل', accountDetailName(draft)))
  }
  if (!isBundle && accountNeedsCurrency(draft) && currentIndex > steps.indexOf('currency') && draft.currencyKind) {
    summary.push(htmlLine('العملة', draft.currencyKind === CURRENCIES.USD ? 'دولار' : 'دينار'))
  }
  if (isBundle && ['opening', 'direction', 'review'].includes(session?.step)) {
    const completedChannelCount = session?.step === 'review'
      ? counterpartyAccountChannels.length
      : Number(session?.bundleOpeningIndex || 0)
    counterpartyAccountChannels.slice(0, completedChannelCount).forEach((channel) => {
      summary.push(htmlLine(channel.label, counterpartyOpeningText(draft, channel)))
    })
  } else if (hasOpeningStep && currentIndex > steps.indexOf('opening')) {
    const currency = draft.currencyKind === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR
    const openingText = session?.step === 'direction' && !draft.openingBalanceDirection
      ? formatMoney(Math.abs(openingAmount), currency)
      : accountOpeningText(draft)
    summary.push(htmlLine('الرصيد الأول', openingText))
  }

  const title = session?.mode === 'review' ? 'ADREEM · إصلاح حساب' : session?.mode === 'edit' ? 'ADREEM · تعديل حساب' : 'ADREEM · حساب جديد'
  const help = accountStepHelp(session)
  const lines = [
    `<b>${title}</b> · <code>${progress}</code>`,
    '',
    ...(session?.mode !== 'create' && session.reviewOriginalLabel
      ? [`<blockquote>${escapeHtml(`الحساب الحالي:\n${session.reviewOriginalLabel}`)}</blockquote>`, '']
      : []),
    ...(structureLocked
      ? ['<code>الاسم قابل للتعديل. النوع وطريقة التعامل والعملة ثابتة بعد استعمال الحساب.</code>', '']
      : []),
    ...(summary.length ? [`<blockquote>${summary.map((item) => `✓ ${item}`).join('\n')}</blockquote>`, ''] : []),
    `<b>${escapeHtml(accountStepTitle(session))}</b>`,
    ...(help ? [`<code>${escapeHtml(help)}</code>`] : []),
    ...(session?.step === 'opening'
      ? ['', `<blockquote>${escapeHtml(`${numericBufferDisplay(session.openingBuffer)} ${(bundleChannel?.currencyKind || draft.currencyKind) === CURRENCIES.USD ? '$' : 'د.ل'}`)}</blockquote>`]
      : []),
  ]
  return lines.join('\n')
}

export function accountReviewText(session, result = null) {
  const draft = session?.draft || {}
  const isBundle = session?.mode === 'create' && isCounterpartyBundleDraft(draft)
  const lines = [
    `<b>${session?.mode === 'edit' ? 'تأكيد تعديل الحساب' : session?.mode === 'review' ? 'تأكيد إصلاح الحساب' : 'تأكيد الحساب'}</b>`,
    '<blockquote>',
    escapeHtml(protectedAccountPrimaryName(draft)),
    '\n',
    ...(isBundle
      ? counterpartyAccountChannels.flatMap((channel, index) => [...(index ? ['\n'] : []), escapeHtml(`${channel.label}: ${counterpartyOpeningText(draft, channel)}`)])
      : [escapeHtml(protectedAccountContext(draft)), '\n', escapeHtml(`الرصيد الأول: ${accountOpeningText(draft)}`)]),
    '</blockquote>',
  ]
  const errors = result?.validation?.errors || []
  if (errors.length) {
    lines.push('', '<b>لا يمكن الحفظ الآن</b>')
    errors.forEach((error) => lines.push(`- ${escapeHtml(error.message)}`))
  }
  return lines.join('\n')
}

export function accountCreatedText(account, { accounts = [], bundle = false, duplicate = false, reviewed = false, edited = false, unchanged = false } = {}) {
  const title = unchanged
    ? 'لا يوجد تغيير في الحساب.'
    : reviewed ? 'تم إصلاح الحساب واعتماده.' : edited ? 'تم تعديل الحساب وحفظ السجل.' : (duplicate ? 'كان محفوظًا سابقًا ولم يتكرر.' : 'تم إنشاء الحساب.')
  return [
    `<b>${escapeHtml(title)}</b>`,
    '<blockquote>',
    escapeHtml(protectedAccountPrimaryName(account)),
    '\n',
    ...(bundle && accounts.length > 1
      ? accounts.flatMap((item, index) => [...(index ? ['\n'] : []), escapeHtml(`${accountChoiceKindLabel(item)}: ${accountOpeningText(item)}`)])
      : [escapeHtml(protectedAccountContext(account)), '\n', escapeHtml(`الرصيد: ${accountOpeningText(account)}`)]),
    '</blockquote>',
  ].join('')
}

function counterpartyOpeningText(draft = {}, channel = {}) {
  const opening = counterpartyOpeningFor(draft, channel.key)
  if (!opening.amount) return 'صفر'
  const currency = channel.currencyKind === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR
  return `${opening.direction === 'i_owe' ? 'عليّ له' : 'لي عنده'} ${formatMoney(opening.amount, currency)}`
}

function accountOpeningText(account = {}) {
  const opening = accountOpeningAmounts(account)
  const currency = account.currencyKind === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR
  const amount = currency === CURRENCIES.USD ? opening.openingUsd : opening.openingDinar
  if (!amount) return 'صفر'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE) {
    return `${amount > 0 ? 'لي عنده' : 'عليّ له'} ${formatMoney(Math.abs(amount), currency)}`
  }
  if (account.valueKind === VALUE_KINDS.ASSET) return `القيمة ${formatMoney(amount, currency)}`
  return `الموجود ${formatMoney(amount, currency)}`
}

export function movementStepText(session, accountsById = new Map(), dimensionsById = new Map(), expenseCategoriesById = new Map()) {
  const draft = session?.draft || {}
  const config = movementConfigFor(draft.type)
  const amountCurrency = draft.currencyConfirmed ? draft.currency : config.currency
  const amountText = draft.amount
    ? (amountCurrency ? formatMoney(draft.amount, amountCurrency) : String(draft.amount))
    : ''
  const source = accountsById.get(draft.sourceAccountId)
  const destination = accountsById.get(draft.destinationAccountId)
  const dimension = dimensionsById.get(draft.dimensionId)
  const expenseCategory = expenseCategoriesById.get(draft.expenseCategoryId)
  const steps = [
    'type',
    'amount',
    ...(config.currencyLocked ? [] : ['currency']),
    ...(movementNeedsRate(draft.type) ? ['rate'] : []),
    ...(movementNeedsSource(draft.type) ? ['source'] : []),
    ...(movementNeedsDestination(draft.type) ? ['destination'] : []),
    'note',
    ...(movementSupportsDimension(draft.type) ? ['dimension'] : []),
    ...(movementSupportsExpenseCategory(draft.type) ? ['category'] : []),
    'attachment',
    'recurring',
    'review',
  ]
  const currentIndex = Math.max(0, steps.indexOf(session?.step))
  const progress = `${currentIndex + 1}/${steps.length}`
  const summary = []
  if (session?.mode === 'review' && draft.type) summary.push(htmlLine('الحركة', movementLabels[draft.type] || draft.type))
  if (amountText) summary.push(htmlLine('المبلغ', amountText))
  if (movementNeedsRate(draft.type) && draft.rate) summary.push(htmlLine('السعر', formatRate(draft.rate)))
  if (!movementNeedsRate(draft.type) && draft.currencyConfirmed) summary.push(htmlLine('العملة', currencyLabel(draft.currency)))
  if (source) summary.push(htmlLine(config.sourceLabel, protectedAccountLabel(source)))
  if (movementNeedsDestination(draft.type) && destination) summary.push(htmlLine(config.destinationLabel, protectedAccountLabel(destination)))
  if (draft.note) summary.push(htmlDataLine('ملاحظة', draft.note))
  if (dimension) summary.push(htmlDataLine('مشروع', dimension.name))
  if (expenseCategory) summary.push(htmlDataLine('نوع المصروف', accountPrimaryName(expenseCategory)))
  if (draft.attachmentLabel || draft.attachmentUrl) summary.push(htmlDataLine('مرفق', draft.attachmentLabel || draft.attachmentUrl))
  if (draft.recurringEnabled) summary.push(htmlLine('تكرار', 'شهري'))
  const movementTitle = draft.type ? movementLabels[draft.type] || draft.type : 'حركة جديدة'
  const title = session?.mode === 'review' ? 'ADREEM · إصلاح حركة' : `ADREEM · ${movementTitle}`
  const help = currentStepHelp(session)
  const lines = [
    `<b>${escapeHtml(title)}</b> · <code>${progress}</code>`,
    '',
    ...(summary.length ? [`<blockquote>${summary.map((item) => `✓ ${item}`).join('\n')}</blockquote>`] : []),
    ...(summary.length ? [''] : []),
    `<b>${escapeHtml(currentStepTitle(session))}</b>`,
    ...(help ? [`<code>${escapeHtml(help)}</code>`] : []),
  ]
  return lines.join('\n')
}

export function reconciliationStepText(session, accountsById = new Map()) {
  const draft = session?.draft || {}
  const account = accountsById.get(draft.accountId)
  const steps = ['account', 'currency', 'actual', 'note', 'review']
  const currentIndex = Math.max(0, steps.indexOf(session?.step))
  const progress = `${currentIndex + 1}/${steps.length}`
  const summary = []
  if (account) summary.push(htmlLine('الحساب', protectedAccountLabel(account)))
  if (draft.currency) summary.push(htmlLine('العملة', currencyLabel(draft.currency)))
  if (typeof draft.actualBalance === 'number') summary.push(htmlLine('الرصيد الفعلي', formatMoney(draft.actualBalance, draft.currency)))
  if (draft.note) summary.push(htmlDataLine('ملاحظة', draft.note))

  const lines = [
    `<b>ADREEM · مطابقة رصيد</b> · <code>${progress}</code>`,
    '',
    ...(summary.length ? [`<blockquote>${summary.map((item) => `✓ ${item}`).join('\n')}</blockquote>`, ''] : []),
    `<b>${escapeHtml(reconciliationStepTitle(session))}</b>`,
    ...(reconciliationStepHelp(session) ? [`<code>${escapeHtml(reconciliationStepHelp(session))}</code>`] : []),
  ]
  return lines.join('\n')
}

function reconciliationStepTitle(session) {
  if (session?.step === 'account') return 'اختر الحساب الذي عدّدت رصيده'
  if (session?.step === 'currency') return 'اختر عملة المطابقة'
  if (session?.step === 'actual') return 'الرصيد الفعلي؟'
  if (session?.step === 'note') return 'اكتب سبب المطابقة'
  if (session?.step === 'review') return 'راجع الفرق قبل الحفظ'
  return 'مطابقة رصيد'
}

function reconciliationStepHelp(session) {
  if (session?.step === 'account') return 'تظهر حسابات فلوسك فقط.'
  if (session?.step === 'currency') return ''
  if (session?.step === 'actual') return ''
  if (session?.step === 'note') return 'الملاحظة إلزامية حتى نعرف سبب التصحيح.'
  if (session?.step === 'review') return 'الحفظ سيضيف مطابقة، وقد ينشئ تصحيحًا.'
  return ''
}

export function reconciliationReviewText(session, preview = {}) {
  const draft = session?.draft || {}
  const account = preview.account
  const expected = Math.round(Number(preview.expected || 0))
  const actual = Math.round(Number(draft.actualBalance || 0))
  const diff = actual - expected
  const sign = diff > 0 ? '+' : ''
  const lines = [
    '<b>تأكيد المطابقة</b>',
    `<blockquote>${escapeHtml(protectedAccountLabel(account))}\n${escapeHtml(`دفتر: ${formatMoney(expected, draft.currency)}`)}\n${escapeHtml(`فعلي: ${formatMoney(actual, draft.currency)}`)}\n${escapeHtml(`الفرق: ${sign}${formatMoney(diff, draft.currency)}`)}\n${escapeHtml(`ملاحظة: ${preserveUiData(draft.note || '')}`)}</blockquote>`,
  ]
  if (!diff) {
    lines.push('', '<blockquote>لا يوجد فرق. سيتم حفظ المطابقة بدون حركة تصحيح.</blockquote>')
  } else {
    lines.push('', `<blockquote>${escapeHtml(`سيتم إنشاء تعديل رصيد بقيمة ${sign}${formatMoney(diff, draft.currency)}.`)}</blockquote>`)
  }
  return lines.join('\n')
}

export function accountChoiceText(session, account, bucket, index) {
  const presentation = accountBalancePresentation(account, bucket)
  return `${index + 1}. ${presentation.icon} ${protectedAccountPrimaryName(account)}\n   ${protectedAccountContext(account)} · ${presentation.text}`
}

export function compactAccountChoiceText(account, bucket) {
  const presentation = accountBalancePresentation(account, bucket)
  return `${presentation.icon} ${protectedAccountPrimaryName(account)} · ${presentation.text}`
}

export function accountChoiceButtonText(account, bucket, currency = '') {
  const presentation = accountBalancePresentation(account, bucket, currency)
  return `${accountChoiceKindIcon(account)} ${protectedAccountPrimaryName(account)} · ${presentation.text}`
}

export function accountChoiceLegendText(accounts = []) {
  const uniqueAccounts = [...new Map(accounts.map((account) => [accountChoiceKind(account), account])).values()]
  return uniqueAccounts.map((account) => `${accountChoiceKindIcon(account)} ${accountChoiceKindLabel(account)}`).join(' · ')
}

export function accountChoiceButtonStyle(account, bucket, currency = '') {
  return accountBalancePresentation(account, bucket, currency).buttonStyle
}

function accountChoiceKindIcon(account) {
  const kind = accountChoiceKind(account)
  if (kind === VALUE_KINDS.CASH) return '💵'
  if (kind === VALUE_KINDS.BANK) return '🏦'
  if (kind === 'person-bank') return '🧾'
  if (kind === 'person-usd') return '💲'
  if (kind === VALUE_KINDS.ASSET) return '📦'
  if (kind === VALUE_KINDS.PROJECT) return '📊'
  if (kind === VALUE_KINDS.EXPENSE) return '🧾'
  return '👤'
}

export function accountBlockquote(account, bucket) {
  const presentation = accountBalancePresentation(account, bucket)
  return [
    '<blockquote>',
    escapeHtml(`${presentation.icon} ${protectedAccountPrimaryName(account)}`),
    '\n',
    escapeHtml(protectedAccountContext(account)),
    '\n',
    escapeHtml(presentation.text),
    '</blockquote>',
  ].join('')
}

export function accountEditHistoryText(accountId, auditEvents = [], limit = 3) {
  const edits = auditEvents
    .filter((event) => event.action === 'account.updated' && event.details?.accountId === accountId)
    .map((event) => ({ ...event, changes: accountEditChanges(event.details?.before, event.details?.after) }))
    .filter((event) => event.changes.length)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  if (!edits.length) return ''

  const visible = edits.slice(0, Math.max(1, Number(limit) || 1))
  const blocks = visible.map((event) => {
    const time = movementDateLabel({ createdAt: event.createdAt }, { includeDate: true })
    const lines = time ? [time] : []
    event.changes.forEach((change) => {
      const before = change.protectsUserData ? preserveUiData(change.before) : change.before
      const after = change.protectsUserData ? preserveUiData(change.after) : change.after
      lines.push(change.label, `قبل: ${before}`, `بعد: ${after}`)
    })
    return `<blockquote>${escapeHtml(lines.join('\n'))}</blockquote>`
  })
  return [`<b>سجل التعديلات · ${edits.length}</b>`, ...blocks].join('\n')
}

export function formatAccountBalance(account, bucket) {
  return accountBalancePresentation(account, bucket).text
}

export function movementBlockquote(movement, accountsById = new Map(), options = {}) {
  const config = movementConfigFor(movement?.type)
  const source = accountsById.get(movement?.sourceAccountId)
  const destination = accountsById.get(movement?.destinationAccountId)
  const compactHistory = options.variant === 'history'
  const time = options.showTime === false ? '' : movementDateLabel(movement, options)
  const note = cleanMovementNote(movement?.note)
  const status = movementStatusLabel(movement?.status)
  const headerParts = [
    options.number ? `#${options.number}` : '',
    `${movementIcon(movement?.type)} ${movementLabels[movement?.type] || movement?.type || 'حركة'}`,
    formatMoney(movement?.amount, movement?.currency),
  ].filter(Boolean)
  if (!compactHistory || movement?.status !== MOVEMENT_STATUSES.POSTED) headerParts.push(status)
  const header = headerParts.join(' · ')
  const lines = [header]

  if (time) lines.push(`الوقت: ${time}`)
  if (movementNeedsRate(movement?.type) && movement?.rate) lines.push(`السعر: ${formatRate(movement.rate)}`)

  if (source && destination) {
    lines.push(`${protectedAccountLabel(source)} ← ${protectedAccountLabel(destination)}`)
  } else if (source) {
    lines.push(`${config.sourceLabel || 'من'}: ${protectedAccountLabel(source)}`)
  } else if (destination) {
    lines.push(`${config.destinationLabel || 'إلى'}: ${protectedAccountLabel(destination)}`)
  }

  if (note) lines.push(compactHistory ? `📝 ${preserveUiData(note)}` : `ملاحظة: ${preserveUiData(note)}`)
  return `<blockquote>${escapeHtml(lines.join('\n'))}</blockquote>`
}

function accountBalancePresentation(account, bucket, currency = '') {
  const dinar = Math.round(Number(bucket?.dinar || 0))
  const usd = Math.round(Number(bucket?.usd || 0))
  if (currency === CURRENCIES.USD) return balancePresentationFor(account, usd, CURRENCIES.USD)
  if (currency === CURRENCIES.DINAR) return balancePresentationFor(account, dinar, CURRENCIES.DINAR)
  if (usd && !dinar) return balancePresentationFor(account, usd, CURRENCIES.USD)
  if (!dinar) {
    return {
      icon: '⚪',
      text: 'صفر',
      tone: 'zero',
      buttonStyle: 'primary',
    }
  }
  return balancePresentationFor(account, dinar, CURRENCIES.DINAR)
}

function balancePresentationFor(account, amount, currency) {
  const value = Math.round(Number(amount || 0))
  const absolute = formatMoney(Math.abs(value), currency)
  const positive = value > 0

  if (!value) {
    return {
      icon: '⚪',
      text: formatMoney(0, currency),
      tone: 'zero',
      buttonStyle: 'primary',
    }
  }

  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return {
      icon: positive ? '🟢' : '🔴',
      text: positive ? `موجود ${absolute}` : `ناقص ${absolute}`,
      tone: positive ? 'positive' : 'negative',
      buttonStyle: positive ? 'success' : 'danger',
    }
  }
  if (account?.valueKind === VALUE_KINDS.ASSET) {
    return {
      icon: '🟣',
      text: `قيمة ${absolute}`,
      tone: 'asset',
      buttonStyle: 'primary',
    }
  }
  if (account?.valueKind === VALUE_KINDS.EXPENSE) {
    return {
      icon: '🟠',
      text: `مصروف ${absolute}`,
      tone: 'expense',
      buttonStyle: 'primary',
    }
  }
  return {
    icon: positive ? '🟢' : '🔴',
    text: positive ? `أقبض منه ${absolute}` : `أدفع له ${absolute}`,
    tone: positive ? 'positive' : 'negative',
    buttonStyle: positive ? 'success' : 'danger',
  }
}

export function reviewMovementText(session, preview, context = {}) {
  const draft = session?.draft || {}
  const config = movementConfigFor(draft.type)
  const source = context.accountsById?.get(draft.sourceAccountId)
  const destination = context.accountsById?.get(draft.destinationAccountId)
  const dimension = context.dimensionsById?.get(draft.dimensionId)
  const expenseCategory = context.expenseCategoriesById?.get(draft.expenseCategoryId)
  const lines = [
    '<b>تأكيد الحركة</b>',
    '<code>راجع التأثير قبل الحفظ</code>',
    '',
    `<blockquote>${escapeHtml(`${movementLabels[draft.type] || draft.type} ${formatMoney(draft.amount, draft.currency)}`)}</blockquote>`,
  ]
  if (draft.rate) lines.push(htmlLine('السعر', formatRate(draft.rate)))
  if (dimension) lines.push(htmlDataLine('مشروع', dimension.name))
  if (expenseCategory) lines.push(htmlDataLine('نوع المصروف', accountPrimaryName(expenseCategory)))
  if (draft.note) lines.push(htmlDataLine('ملاحظة', draft.note))
  if (draft.attachmentLabel || draft.attachmentUrl) lines.push(htmlDataLine('مرفق', draft.attachmentLabel || draft.attachmentUrl))
  if (draft.recurringEnabled) lines.push(htmlLine('تكرار', 'شهري'))
  lines.push('')

  if (!preview.validation.ok) {
    if (source) lines.push(htmlLine(config.sourceLabel, protectedAccountLabel(source)))
    if (movementNeedsDestination(draft.type) && destination) lines.push(htmlLine(config.destinationLabel, protectedAccountLabel(destination)))
    if (source || destination) lines.push('')
    lines.push('<b>الحركة ناقصة</b>')
    preview.validation.errors.forEach((error) => lines.push(`- ${escapeHtml(error.message)}`))
    return lines.join('\n')
  }

  preview.effects.forEach((effect) => {
    const title = effect.account?.id === draft.sourceAccountId ? config.sourceLabel : config.destinationLabel
    lines.push(movementEffectBlockquote(title, effect))
    lines.push('')
  })
  return lines.join('\n').trim()
}

function movementEffectBlockquote(title, effect) {
  const isIncrease = Number(effect?.delta || 0) > 0
  const icon = isIncrease ? '🟢' : '🔴'
  const sign = isIncrease ? '+' : '-'
  const lines = [
    `${icon} ${title}: ${protectedAccountLabel(effect.account)}`,
    `قبل: ${formatMoney(effect.before, effect.currency)}`,
    `التغيير: ${sign}${formatMoney(Math.abs(effect.delta), effect.currency)}`,
    `بعد: ${formatMoney(effect.after, effect.currency)}`,
  ]
  return `<blockquote>${escapeHtml(lines.join('\n'))}</blockquote>`
}
