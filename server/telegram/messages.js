import { CURRENCIES } from '../../src/mohammadLedger/ledgerCore.js'
import {
  accountDisplayName,
  accountDraftSummary,
  accountNeedsCurrency,
  accountKindLabel,
  accountNameValue,
  accountPresetFor,
} from '../../src/mohammadLedger/accountConfig.js'
import { VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { transferAccountKind } from '../../src/mohammadLedger/accountCompatibility.js'
import {
  movementConfigFor,
  movementLabels,
  movementNeedsDestination,
  movementNeedsRate,
  movementNeedsSource,
  movementTone,
} from '../../src/mohammadLedger/movementConfig.js'
import { accountLabel, formatMoney, formatRate } from '../mohammadLedger/ledgerService.js'

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
  return '◼'
}

function movementDateLabel(movement, { includeDate = false } = {}) {
  const date = new Date(movement?.createdAt || movement?.updatedAt || '')
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' })
  if (!includeDate) return time
  const day = date.toLocaleDateString('ar-LY', { month: '2-digit', day: '2-digit' })
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
  if (session?.step === 'review') return 'راجع قبل الحفظ'
  return 'إدخال حركة'
}

function currentStepHelp(session) {
  if (session?.step === 'type') return 'اختر العملية التي تريد تسجيلها.'
  if (session?.step === 'amount') return 'اكتب الرقم فقط. مثال: 1250'
  if (session?.step === 'currency') return 'اختر العملة حتى تظهر الحسابات المناسبة فقط.'
  if (session?.step === 'rate') return 'اكتب سعر الصرف بالأرقام. مثال: 7.45'
  if (session?.step === 'source') return 'اضغط الحساب المناسب من الأزرار.'
  if (session?.step === 'destination') return 'اضغط الحساب المناسب من الأزرار.'
  if (session?.step === 'note') return 'اختياري. اكتب سببًا قصيرًا أو اضغط بدون ملاحظة.'
  if (session?.step === 'review') return 'تأكد من التأثير على الأرصدة قبل الحفظ.'
  return ''
}

function typeTag(account) {
  if (!account) return ''
  const route = transferAccountKind(account) === 'cash' ? 'كاش' : 'بنكي'
  if (account.valueKind === VALUE_KINDS.RECEIVABLE) return `${accountKindLabel(account)} · ${route}`
  return accountKindLabel(account)
}

export function mainMenuText(summary = null) {
  const lines = ['<b>ADREEM</b>', '<blockquote>الحالة: متصل بالدفتر السحابي</blockquote>']
  if (summary) {
    lines.push('')
    lines.push(htmlLine('اليوم', `${summary.todayCount} حركة`))
    lines.push(htmlLine('مراجعة', summary.reviewCount))
  }
  lines.push('', '<b>اختر العملية</b>')
  return lines.join('\n')
}

function accountStepTitle(session) {
  const preset = accountPresetFor(session?.draft?.type, session?.draft?.valueKind)
  if (session?.step === 'type') return 'اختر التصنيف'
  if (session?.step === 'owner') return preset.nameLabel || 'اكتب الاسم'
  if (session?.step === 'detail') return preset.detailLabel || 'اختر التفصيل'
  if (session?.step === 'currency') return 'اختر العملة'
  if (session?.step === 'review') return 'راجع الحساب'
  return 'حساب جديد'
}

function accountStepHelp(session) {
  const preset = accountPresetFor(session?.draft?.type, session?.draft?.valueKind)
  if (session?.step === 'type') return 'اختر ماذا تريد إضافته بالضبط.'
  if (session?.step === 'owner') return preset.namePlaceholder || 'اكتب الاسم فقط.'
  if (session?.step === 'detail') return 'حدد هل التعامل نقدي أو عبر حساب بنكي.'
  if (session?.step === 'currency') return 'هذه العملة تحدد أين يظهر الحساب عند إدخال الحركات.'
  if (session?.step === 'review') return 'تأكد من الاسم والتصنيف قبل الحفظ.'
  return ''
}

export function accountStepText(session) {
  const draft = session?.draft || {}
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const steps = ['type', 'owner', ...(preset.skipDetail ? [] : ['detail']), ...(accountNeedsCurrency(draft) ? ['currency'] : []), 'review']
  const currentIndex = Math.max(0, steps.indexOf(session?.step))
  const progress = steps.map((step, index) => (index <= currentIndex ? '●' : '○')).join('')
  const summary = []
  if (currentIndex > steps.indexOf('type') && draft.type) summary.push(htmlLine('التصنيف', preset.title))
  const nameValue = accountNameValue(draft)
  if (currentIndex > steps.indexOf('owner') && nameValue) summary.push(htmlLine(preset.nameLabel || 'الاسم', nameValue))
  if (!preset.skipDetail && currentIndex > steps.indexOf('detail') && draft.subAccountName) {
    summary.push(htmlLine(preset.detailLabel || 'التفصيل', draft.subAccountName))
  }
  if (accountNeedsCurrency(draft) && currentIndex > steps.indexOf('currency') && draft.currencyKind) {
    summary.push(htmlLine('العملة', draft.currencyKind === CURRENCIES.USD ? 'دولار' : 'دينار'))
  }

  const lines = [
    '<b>حساب جديد</b>',
    `<code>${progress}  ${currentIndex + 1}/${steps.length}</code>`,
    '',
    ...(summary.length ? [`<blockquote>${summary.map((item) => `✓ ${item}`).join('\n')}</blockquote>`, ''] : []),
    '<b>الآن</b>',
    `<blockquote>${escapeHtml(accountStepTitle(session))}\n${escapeHtml(accountStepHelp(session))}</blockquote>`,
  ]
  return lines.join('\n')
}

export function accountReviewText(session, result = null) {
  const draft = session?.draft || {}
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const lines = [
    '<b>تأكيد الحساب</b>',
    '',
    '<blockquote>',
    escapeHtml(accountDraftSummary(draft)),
    '\n',
    escapeHtml(preset.title),
    '\n',
    escapeHtml('الرصيد الافتتاحي: صفر'),
    '</blockquote>',
  ]
  const errors = result?.validation?.errors || []
  if (errors.length) {
    lines.push('', '<b>لا يمكن الحفظ الآن</b>')
    errors.forEach((error) => lines.push(`- ${escapeHtml(error.message)}`))
  }
  return lines.join('\n')
}

export function accountCreatedText(account, { duplicate = false } = {}) {
  const title = duplicate ? 'كان محفوظًا سابقًا ولم يتكرر.' : 'تم إنشاء الحساب.'
  const preset = accountPresetFor(account?.type, account?.valueKind)
  return [
    `<b>${escapeHtml(title)}</b>`,
    '<blockquote>',
    escapeHtml(accountLabel(account)),
    '\n',
    escapeHtml(preset.title),
    '\n',
    escapeHtml('الرصيد: صفر'),
    '</blockquote>',
  ].join('')
}

export function movementStepText(session, accountsById = new Map()) {
  const draft = session?.draft || {}
  const config = movementConfigFor(draft.type)
  const amountCurrency = draft.currencyConfirmed ? draft.currency : config.currency
  const amountText = draft.amount
    ? (amountCurrency ? formatMoney(draft.amount, amountCurrency) : String(draft.amount))
    : ''
  const source = accountsById.get(draft.sourceAccountId)
  const destination = accountsById.get(draft.destinationAccountId)
  const steps = [
    'type',
    'amount',
    ...(config.currencyLocked ? [] : ['currency']),
    ...(movementNeedsRate(draft.type) ? ['rate'] : []),
    ...(movementNeedsSource(draft.type) ? ['source'] : []),
    ...(movementNeedsDestination(draft.type) ? ['destination'] : []),
    'note',
    'review',
  ]
  const currentIndex = Math.max(0, steps.indexOf(session?.step))
  const progress = steps.map((step, index) => (index <= currentIndex ? '●' : '○')).join('')
  const summary = []
  if (draft.type) summary.push(htmlLine('الحركة', movementLabels[draft.type] || draft.type))
  if (amountText) summary.push(htmlLine('المبلغ', amountText))
  if (movementNeedsRate(draft.type) && draft.rate) summary.push(htmlLine('السعر', formatRate(draft.rate)))
  if (!movementNeedsRate(draft.type) && draft.currencyConfirmed) summary.push(htmlLine('العملة', currencyLabel(draft.currency)))
  if (source) summary.push(htmlLine(config.sourceLabel, accountLabel(source)))
  if (movementNeedsDestination(draft.type) && destination) summary.push(htmlLine(config.destinationLabel, accountLabel(destination)))
  if (draft.note) summary.push(htmlLine('ملاحظة', draft.note))
  const lines = [
    '<b>ADREEM</b>',
    `<code>${progress}  ${currentIndex + 1}/${steps.length}</code>`,
    '',
    ...(summary.length ? [`<blockquote>${summary.map((item) => `✓ ${item}`).join('\n')}</blockquote>`] : []),
    ...(summary.length ? [''] : []),
    `<b>الآن</b>`,
    `<blockquote>${escapeHtml(currentStepTitle(session))}\n${escapeHtml(currentStepHelp(session))}</blockquote>`,
  ]
  return lines.join('\n')
}

export function stepPromptText(session) {
  if (session?.step === 'amount') return 'أرسل المبلغ الآن كرقم فقط.'
  if (session?.step === 'rate') return 'أرسل سعر الصرف الآن.'
  if (session?.step === 'currency') return 'اضغط على العملة المناسبة.'
  if (session?.step === 'source') return `اضغط على الحساب الذي ستخرج منه القيمة.`
  if (session?.step === 'destination') return `اضغط على الحساب الذي ستدخل إليه القيمة.`
  if (session?.step === 'note') return 'اكتب ملاحظة قصيرة أو اضغط بدون ملاحظة.'
  if (session?.step === 'review') return 'راجع التأثير، ثم اضغط تأكيد الحفظ.'
  return 'اختر من الأزرار.'
}

export function accountChoiceText(session, account, bucket, index) {
  const presentation = accountBalancePresentation(account, bucket)
  return `${index + 1}. ${presentation.icon} ${accountLabel(account)}\n   ${typeTag(account)} · ${presentation.text}`
}

export function compactAccountChoiceText(account, bucket) {
  const presentation = accountBalancePresentation(account, bucket)
  return `${presentation.icon} ${typeTag(account)} · ${presentation.text}`
}

export function accountChoiceButtonText(account, bucket) {
  const presentation = accountBalancePresentation(account, bucket)
  return `${presentation.icon} ${accountDisplayName(account)} · ${presentation.text}`
}

export function accountChoiceButtonStyle(account, bucket) {
  return accountBalancePresentation(account, bucket).buttonStyle
}

export function accountBlockquote(account, bucket) {
  const presentation = accountBalancePresentation(account, bucket)
  return [
    '<blockquote>',
    escapeHtml(`${presentation.icon} ${accountLabel(account)}`),
    '\n',
    escapeHtml(presentation.text),
    '\n',
    escapeHtml(typeTag(account)),
    '</blockquote>',
  ].join('')
}

export function formatAccountBalance(account, bucket) {
  return accountBalancePresentation(account, bucket).text
}

export function movementBlockquote(movement, accountsById = new Map(), options = {}) {
  const config = movementConfigFor(movement?.type)
  const source = accountsById.get(movement?.sourceAccountId)
  const destination = accountsById.get(movement?.destinationAccountId)
  const time = movementDateLabel(movement, options)
  const note = cleanMovementNote(movement?.note)
  const header = `${movementIcon(movement?.type)} ${movementLabels[movement?.type] || movement?.type || 'حركة'} · ${formatMoney(movement?.amount, movement?.currency)}`
  const lines = [header]

  if (time) lines.push(`الوقت: ${time}`)
  if (movementNeedsRate(movement?.type) && movement?.rate) lines.push(`السعر: ${formatRate(movement.rate)}`)

  if (source && destination) {
    lines.push(`من: ${accountLabel(source)}`)
    lines.push(`إلى: ${accountLabel(destination)}`)
  } else if (source) {
    lines.push(`${config.sourceLabel || 'من'}: ${accountLabel(source)}`)
  } else if (destination) {
    lines.push(`${config.destinationLabel || 'إلى'}: ${accountLabel(destination)}`)
  }

  if (note) lines.push(`ملاحظة: ${note}`)
  return `<blockquote>${escapeHtml(lines.join('\n'))}</blockquote>`
}

function accountBalancePresentation(account, bucket) {
  const dinar = Math.round(Number(bucket?.dinar || 0))
  const usd = Math.round(Number(bucket?.usd || 0))
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

export function reviewMovementText(session, preview) {
  const draft = session?.draft || {}
  const config = movementConfigFor(draft.type)
  const lines = [
    '<b>تأكيد الحركة</b>',
    '',
    `<blockquote>${escapeHtml(`${movementLabels[draft.type] || draft.type} ${formatMoney(draft.amount, draft.currency)}`)}</blockquote>`,
  ]
  if (draft.rate) lines.push(htmlLine('السعر', formatRate(draft.rate)))
  if (draft.note) lines.push(htmlLine('ملاحظة', draft.note))
  lines.push('')

  if (!preview.validation.ok) {
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
    `${icon} ${title}: ${accountLabel(effect.account)}`,
    `قبل: ${formatMoney(effect.before, effect.currency)}`,
    `التغيير: ${sign}${formatMoney(Math.abs(effect.delta), effect.currency)}`,
    `بعد: ${formatMoney(effect.after, effect.currency)}`,
  ]
  return `<blockquote>${escapeHtml(lines.join('\n'))}</blockquote>`
}
