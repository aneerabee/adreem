import { accountPrimaryName } from './accountConfig'
import { formatZonedDate, formatZonedDateTime, formatZonedTime, isZonedToday, isZonedYesterday, zonedDayKey } from './dateRange'
import { MOVEMENT_STATUSES, buildPostingEntries } from './ledgerCore'
import { MOVEMENT_ENTRY_STEPS } from './movementConfig'
import { normalizeAccountSearchText } from './movementAccounts'
import { normalizeRecurringDateKey } from './ledgerOperations'
import { uiLanguageLocale } from './uiLanguage'
import { getActiveUiLanguage } from './uiTranslation'
import { formatRate, hasMoneyValue, money } from './ledgerFormat'
import { CANCEL_WINDOW_MS, MOVEMENT_EDITABLE_FIELDS } from './ledgerUiConfig'

export function movementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'تم'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقص'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغي'
  return 'مسودة'
}

export function movementErrorFieldLabel(field) {
  const labels = {
    type: 'نوع الحركة',
    amount: 'المبلغ',
    currency: 'العملة',
    rate: 'سعر الصرف',
    sourceAccountId: 'الحساب الذي خرجت منه الفلوس',
    destinationAccountId: 'الحساب الذي دخلت إليه الفلوس',
    expenseCategoryId: 'نوع المصروف',
  }
  return labels[field] || 'بيانات ناقصة'
}

export function movementTime(value) {
  return formatZonedTime(value || Date.now(), uiLanguageLocale(getActiveUiLanguage()), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function movementDateTime(value) {
  return formatZonedDateTime(value || Date.now(), uiLanguageLocale(getActiveUiLanguage()), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function movementDayKey(value) {
  try {
    return zonedDayKey(value || Date.now())
  } catch {
    return 'unknown'
  }
}

export function movementDayLabel(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return 'تاريخ غير معروف'
  if (isToday(value)) return 'اليوم'
  if (isZonedYesterday(date)) return 'أمس'
  return formatZonedDate(date, uiLanguageLocale(getActiveUiLanguage()), {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

export function recurringDateLabel(value) {
  const dateKey = normalizeRecurringDateKey(value)
  if (!dateKey) return 'غير محدد'
  return formatZonedDate(`${dateKey}T12:00:00.000Z`, uiLanguageLocale(getActiveUiLanguage()), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function isToday(value) {
  return isZonedToday(value)
}

function isRecentMovement(movement, now = Date.now()) {
  const date = new Date(movement?.createdAt || movement?.updatedAt || '')
  if (Number.isNaN(date.getTime())) return false
  return now - date.getTime() <= CANCEL_WINDOW_MS
}

export function canCancelMovement(movement) {
  return movement?.status === MOVEMENT_STATUSES.POSTED && !movement.id?.startsWith('opening-') && isRecentMovement(movement)
}

export function canEditMovement(movement) {
  return canCancelMovement(movement)
}

export function movementRecordVersion(movement = {}) {
  return JSON.stringify([
    movement.id || '',
    movement.status || '',
    movement.updatedAt || '',
    movement.createdAt || '',
    ...MOVEMENT_EDITABLE_FIELDS.map((field) => movement[field] ?? null),
  ])
}

export function movementChangedWhileOpen(originalMovement, currentMovement) {
  return !originalMovement || !currentMovement || movementRecordVersion(originalMovement) !== movementRecordVersion(currentMovement)
}

export function movementEditChanges(originalMovement = {}, candidateMovement = {}, labels = {}) {
  const entries = [
    { field: 'amount', label: 'المبلغ', format: (value, movement) => money(value, movement.currency) },
    { field: 'rate', label: 'سعر الصرف', format: (value) => value ? formatRate(value) : 'بدون' },
    { field: 'sourceAccountId', label: 'من', format: (value) => labels.accounts?.get(value) || 'بدون' },
    { field: 'destinationAccountId', label: 'إلى', format: (value) => labels.accounts?.get(value) || 'بدون' },
    { field: 'investmentPlatformId', label: 'المنصة', format: (value) => labels.platforms?.get(value) || 'بدون' },
    { field: 'note', label: 'الملاحظة', format: (value) => String(value || '').trim() || 'بدون' },
    { field: 'dimensionId', label: 'المشروع / الأصل', format: (value) => labels.dimensions?.get(value) || 'بدون' },
    { field: 'expenseCategoryId', label: 'نوع المصروف', format: (value) => labels.expenseCategories?.get(value) || 'بدون' },
  ]

  return entries.flatMap((entry) => {
    const beforeValue = originalMovement?.[entry.field] ?? ''
    const afterValue = candidateMovement?.[entry.field] ?? ''
    if (String(beforeValue) === String(afterValue)) return []
    return [{
      field: entry.field,
      label: entry.label,
      before: entry.format(beforeValue, originalMovement),
      after: entry.format(afterValue, candidateMovement),
    }]
  })
}

export function movementRouteSteps(config = {}, needsSource = false) {
  return (config.platformAfterSource
    ? [needsSource ? MOVEMENT_ENTRY_STEPS.SOURCE : null, config.needsInvestmentPlatform ? MOVEMENT_ENTRY_STEPS.INVESTMENT_PLATFORM : null, config.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : null]
    : [config.needsInvestmentPlatform ? MOVEMENT_ENTRY_STEPS.INVESTMENT_PLATFORM : null, needsSource ? MOVEMENT_ENTRY_STEPS.SOURCE : null, config.needsDestination ? MOVEMENT_ENTRY_STEPS.DESTINATION : null])
    .filter(Boolean)
}

export function movementVisibleSteps(config, needsSource) {
  const routeSteps = movementRouteSteps(config, needsSource)
  return [MOVEMENT_ENTRY_STEPS.TYPE, MOVEMENT_ENTRY_STEPS.AMOUNT, config.currencyLocked ? null : MOVEMENT_ENTRY_STEPS.CURRENCY, config.needsRate ? MOVEMENT_ENTRY_STEPS.RATE : null, ...routeSteps, MOVEMENT_ENTRY_STEPS.NOTE, MOVEMENT_ENTRY_STEPS.REVIEW].filter(Boolean)
}

export function movementStepCopy(step, config = {}) {
  if (step === MOVEMENT_ENTRY_STEPS.TYPE) return { title: 'نوع الحركة', summary: '' }
  if (step === MOVEMENT_ENTRY_STEPS.AMOUNT) return { title: config.amountLabel || 'المبلغ', summary: '' }
  if (step === MOVEMENT_ENTRY_STEPS.CURRENCY) return { title: 'العملة', summary: '' }
  if (step === MOVEMENT_ENTRY_STEPS.RATE)
    return {
      title: 'سعر الصرف',
      summary: '',
    }
  if (step === MOVEMENT_ENTRY_STEPS.INVESTMENT_PLATFORM) return { title: config.platformQuestion || 'اختر المنصة', summary: '' }
  if (step === MOVEMENT_ENTRY_STEPS.SOURCE)
    return {
      title: config.sourceQuestion || config.sourceLabel || 'من',
      summary: '',
    }
  if (step === MOVEMENT_ENTRY_STEPS.DESTINATION)
    return {
      title: config.destinationQuestion || config.destinationLabel || 'إلى',
      summary: '',
    }
  if (step === MOVEMENT_ENTRY_STEPS.NOTE)
    return {
      title: config.noteLabel || 'تفاصيل',
      summary: '',
    }
  return { title: 'المراجعة', summary: '' }
}

export function nonZero(bucket) {
  return hasMoneyValue(bucket.dinar) || hasMoneyValue(bucket.usd) || hasMoneyValue(bucket.try) || hasMoneyValue(bucket.eur)
}

export function externalAccountKey(account = {}) {
  return String(account.id || `${account.ownerName || ''}:${account.subAccountName || ''}`).trim()
}

export function movementNoteAddsContext(movement, expenseCategory) {
  if (!movement.note) return false
  if (!expenseCategory) return true
  return normalizeAccountSearchText(movement.note) !== normalizeAccountSearchText(accountPrimaryName(expenseCategory))
}

export function movementAccountImpact(movement, accountId) {
  return buildPostingEntries(movement).filter((entry) => entry.accountId === accountId)
}

export function statementMovementDate(value) {
  const locale = uiLanguageLocale(getActiveUiLanguage())
  return formatZonedDate(value || Date.now(), locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
}
