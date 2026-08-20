import { createHash } from 'node:crypto'
import { accountPresetGroups, accountPresets, accountPrimaryName } from '../../src/mohammadLedger/accountConfig.js'
import { CURRENCIES } from '../../src/mohammadLedger/ledgerCore.js'
import { movementTypeOptions } from '../../src/mohammadLedger/movementConfig.js'
import { preserveUiData } from '../../src/mohammadLedger/uiTranslation.js'
import {
  accountChoiceButtonStyle,
  accountChoiceButtonText,
} from './messages.js'
import { actionCallbackData } from './actionTokens.js'

export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ حركة جديدة', callback_data: 'main:movement', style: 'success' }],
      [{ text: 'الأرصدة', callback_data: 'main:accounts', style: 'primary' }, { text: 'السجل', callback_data: 'main:history', style: 'primary' }],
      [{ text: 'المراجعة', callback_data: 'main:review', style: 'danger' }, { text: 'المزيد', callback_data: 'main:more' }],
    ],
  }
}

export function moreMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ حساب جديد', callback_data: 'main:account', style: 'success' }],
      [{ text: 'تنبيهات', callback_data: 'main:alerts', style: 'danger' }, { text: 'مطابقة رصيد', callback_data: 'main:reconcile', style: 'primary' }],
      [{ text: 'التقارير', callback_data: 'main:reports', style: 'primary' }, { text: 'الحركات الشهرية', callback_data: 'main:recurring' }],
      [{ text: 'حركات اليوم', callback_data: 'main:today' }, { text: 'بحث عن حساب', callback_data: 'main:search' }],
      [{ text: '↩️ الرئيسية', callback_data: 'main:home', style: 'primary' }],
    ],
  }
}

export function reconciliationAccountKeyboard(accounts, balancesByAccountId = new Map()) {
  const rows = accounts.map((account) => ([{
    text: accountChoiceButtonText(account, balancesByAccountId.get(account.id)),
    callback_data: `rec:account:${accountChoiceToken(account)}`,
    style: accountChoiceButtonStyle(account, balancesByAccountId.get(account.id)),
  }]))
  rows.push([{ text: '🔎 اكتب اسمًا للبحث', callback_data: 'rec:search', style: 'primary' }])
  rows.push([{ text: '↩️ القائمة', callback_data: 'rec:cancel', style: 'primary' }])
  return { inline_keyboard: rows }
}

export function reconciliationCurrencyKeyboard(selectedCurrency = '') {
  return {
    inline_keyboard: [
      [
        { text: `${selectedCurrency === CURRENCIES.DINAR ? '✓ ' : ''}دينار د.ل`, callback_data: `rec:currency:${CURRENCIES.DINAR}`, style: 'primary' },
        { text: `${selectedCurrency === CURRENCIES.USD ? '✓ ' : ''}دولار $`, callback_data: `rec:currency:${CURRENCIES.USD}`, style: 'primary' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'rec:back' }, { text: 'إلغاء', callback_data: 'rec:cancel', style: 'danger' }],
    ],
  }
}

export function reconciliationTextStepKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '↩️ رجوع', callback_data: 'rec:back' }, { text: 'إلغاء', callback_data: 'rec:cancel', style: 'danger' }],
    ],
  }
}

export function reconciliationConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'تأكيد المطابقة', callback_data: 'rec:confirm', style: 'success' }],
      [{ text: '↩️ تعديل', callback_data: 'rec:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'rec:cancel', style: 'danger' }],
    ],
  }
}

export function accountGroupKeyboard(selectedKey = '') {
  return {
    inline_keyboard: [
      ...accountPresetGroups.map((group) => ([{
        text: `${selectedKey === group.key ? '✓ ' : ''}${accountGroupIcon(group.key)} ${group.title} · ${group.hint}`,
        callback_data: `acct:group:${group.key}`,
        style: selectedKey === group.key ? 'success' : 'primary',
      }])),
      [{ text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

export function accountTypeKeyboard(selectedKey = '', groupKey = 'people') {
  const group = accountPresetGroups.find((item) => item.key === groupKey) || accountPresetGroups[0]
  const presets = group.keys.map((key) => accountPresets.find((preset) => preset.key === key)).filter(Boolean)
  return {
    inline_keyboard: [
      ...presets.map((preset) => ([{
        text: `${selectedKey === preset.key ? '✓ ' : ''}${accountTypeIcon(preset.key)} ${preset.title} · ${preset.detail}`,
        callback_data: `acct:type:${preset.key}`,
        style: selectedKey === preset.key ? 'success' : 'primary',
      }])),
      [{ text: '↩️ رجوع', callback_data: 'acct:back' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

function accountGroupIcon(key) {
  if (key === 'people') return '👤'
  if (key === 'money') return '💰'
  return '📊'
}

export function accountDetailKeyboard(selectedDetail = '', detailOptions = []) {
  const rows = detailOptions.map((detail, index) => ([{
    text: `${selectedDetail === detail ? '✓ ' : ''}${detail}`,
    callback_data: `acct:detail:${index}`,
    style: selectedDetail === detail ? 'success' : 'primary',
  }]))
  rows.push([{ text: '↩️ رجوع', callback_data: 'acct:back' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function accountCurrencyKeyboard(selectedCurrency = CURRENCIES.DINAR) {
  return {
    inline_keyboard: [
      [
        { text: `${selectedCurrency === CURRENCIES.DINAR ? '✓ ' : ''}دينار`, callback_data: `acct:currency:${CURRENCIES.DINAR}`, style: selectedCurrency === CURRENCIES.DINAR ? 'success' : 'primary' },
        { text: `${selectedCurrency === CURRENCIES.USD ? '✓ ' : ''}دولار`, callback_data: `acct:currency:${CURRENCIES.USD}`, style: selectedCurrency === CURRENCIES.USD ? 'success' : 'primary' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'acct:back' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

export function accountConfirmKeyboard(isReview = false) {
  return {
    inline_keyboard: [
      [{ text: isReview ? 'تأكيد إصلاح الحساب' : 'تأكيد إنشاء الحساب', callback_data: 'acct:confirm', style: 'success' }],
      [{ text: '↩️ تعديل الحساب', callback_data: 'acct:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

export function accountTextStepKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '↩️ رجوع', callback_data: 'acct:back' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

function accountTypeIcon(key) {
  if (key === 'person-cash') return '👤'
  if (key === 'own-cash') return '💵'
  if (key === 'own-bank') return '🏦'
  if (key === 'asset') return '🟣'
  if (key === 'project') return '📍'
  if (key === 'expense') return '🟠'
  return '◼'
}

export function movementTypeKeyboard() {
  const buttonFor = (option) => ({
      text: movementTypeButtonText(option),
      callback_data: `mv:type:${option.type}`,
      style: movementTypeButtonStyle(option.tone),
    })
  const optionsByTone = new Map(movementTypeOptions.map((option) => [option.tone, option]))
  const rows = [
    [buttonFor(optionsByTone.get('transfer')), buttonFor(optionsByTone.get('expense'))],
    [buttonFor(optionsByTone.get('income'))],
    [buttonFor(optionsByTone.get('deposit')), buttonFor(optionsByTone.get('withdrawal'))],
    [buttonFor(optionsByTone.get('sale')), buttonFor(optionsByTone.get('purchase'))],
  ]
  rows.push([{ text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return {
    inline_keyboard: rows,
  }
}

function movementTypeButtonText(option) {
  if (option.tone === 'transfer') return `🔁 ${option.label}`
  if (option.tone === 'deposit') return `🏦 ${option.label}`
  if (option.tone === 'withdrawal') return `💵 ${option.label}`
  if (option.tone === 'expense') return `🔴 ${option.label}`
  if (option.tone === 'income') return `🟢 ${option.label}`
  if (option.tone === 'sale') return `🟢 ${option.label}`
  if (option.tone === 'purchase') return `🔵 ${option.label}`
  return option.label
}

function movementTypeButtonStyle(tone) {
  if (tone === 'expense') return 'danger'
  if (tone === 'sale' || tone === 'purchase' || tone === 'transfer' || tone === 'income') return 'primary'
  return 'primary'
}

export function currencyKeyboard(selectedCurrency = '') {
  return {
    inline_keyboard: [
      [
        { text: `${selectedCurrency === CURRENCIES.DINAR ? '✓ ' : ''}دينار د.ل`, callback_data: `mv:currency:${CURRENCIES.DINAR}`, style: 'primary' },
        { text: `${selectedCurrency === CURRENCIES.USD ? '✓ ' : ''}دولار $`, callback_data: `mv:currency:${CURRENCIES.USD}`, style: 'primary' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function accountChoicesKeyboard(accounts, role, balancesByAccountId = new Map()) {
  const rows = accounts.map((account) => {
    const bucket = balancesByAccountId.get(account.id)
    return [{
      text: accountChoiceButtonText(account, bucket),
      callback_data: `mv:account:${role}:${accountChoiceToken(account)}`,
      style: accountChoiceButtonStyle(account, bucket),
    }]
  })
  rows.push([{ text: '🔎 اكتب اسمًا للبحث', callback_data: `mv:searchhint:${role}`, style: 'primary' }])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function accountsBrowserKeyboard(buckets = [], session = {}) {
  const rows = buckets.map((bucket) => ([{
    text: accountChoiceButtonText(bucket.account, bucket),
    callback_data: `accounts:open:${accountChoiceToken(bucket.account)}`,
    style: accountChoiceButtonStyle(bucket.account, bucket),
  }]))
  rows.push(...paginationRows('accounts', session.page, session.pageCount))
  rows.push([{ text: '🔎 بحث', callback_data: 'main:search', style: 'primary' }, { text: '↩️ الرئيسية', callback_data: 'main:home' }])
  return { inline_keyboard: rows }
}

export function accountProfileKeyboard(page = 0) {
  return {
    inline_keyboard: [
      [{ text: '↩️ الأرصدة', callback_data: `accounts:page:${Math.max(0, Number(page) || 0)}`, style: 'primary' }],
      [{ text: 'الرئيسية', callback_data: 'main:home' }],
    ],
  }
}

export function recurringRulesKeyboard(session = {}) {
  const dueRuleIds = new Set(session.dueRuleIds || [])
  const items = session.items || Object.entries(session.choices?.rules || {}).map(([token, id], index) => ({
    id,
    number: index + 1,
    token,
  }))
  const rows = items.map((item) => {
    const row = []
    if (dueRuleIds.has(item.id)) {
      row.push({ text: `تنفيذ #${item.number}`, callback_data: actionCallbackData('repeat', session.actionSessionId, 'run', item.token), style: 'success' })
    }
    row.push({ text: `إيقاف #${item.number}`, callback_data: actionCallbackData('repeat', session.actionSessionId, 'disable', item.token), style: 'danger' })
    return row
  })
  rows.push(...paginationRows('repeat', session.page, session.pageCount))
  rows.push([{ text: '↩️ المزيد', callback_data: 'main:more', style: 'primary' }])
  return { inline_keyboard: rows }
}

export function reportKeyboard(counts = {}) {
  return {
    inline_keyboard: [
      [{ text: `المشاريع والأصول · ${Number(counts.projects) || 0}`, callback_data: 'reports:project:page:0', style: 'primary' }],
      [{ text: `أنواع المصروف · ${Number(counts.expenses) || 0}`, callback_data: 'reports:expense:page:0', style: 'primary' }],
      [{ text: '↩️ المزيد', callback_data: 'main:more', style: 'primary' }],
    ],
  }
}

export function reportListKeyboard(session = {}) {
  const kind = session.kind === 'expense' ? 'expense' : 'project'
  const rows = (session.items || []).map((item) => ([{
    text: `تفاصيل #${item.number}`,
    callback_data: `reports:open:${kind}:${item.token}`,
    style: 'primary',
  }]))
  rows.push(...paginationRows(`reports:${kind}`, session.page, session.pageCount))
  rows.push([{ text: '↩️ التقارير', callback_data: 'reports:home', style: 'primary' }])
  return { inline_keyboard: rows }
}

export function reportDetailKeyboard(session = {}) {
  const rows = paginationRows('reports:detail', session.page, session.pageCount)
  rows.push([{
    text: '↩️ القائمة',
    callback_data: `reports:${session.kind === 'expense' ? 'expense' : 'project'}:page:${Math.max(0, Number(session.listPage) || 0)}`,
    style: 'primary',
  }])
  return { inline_keyboard: rows }
}

function paginationRows(prefix, page = 0, pageCount = 1) {
  const current = Math.max(0, Number(page) || 0)
  const count = Math.max(1, Number(pageCount) || 1)
  if (count <= 1) return []
  const buttons = []
  if (current > 0) buttons.push({ text: 'السابق', callback_data: `${prefix}:page:${current - 1}` })
  buttons.push({ text: `${current + 1}/${count}`, callback_data: `${prefix}:page:${current}`, style: 'primary' })
  if (current < count - 1) buttons.push({ text: 'التالي', callback_data: `${prefix}:page:${current + 1}` })
  return [buttons]
}

export function accountChoiceToken(account) {
  return createHash('sha1').update(String(account?.id || '')).digest('base64url').slice(0, 10)
}

export function noteKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'بدون ملاحظة', callback_data: 'mv:note:skip', style: 'primary' }],
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function dimensionKeyboard(dimensions = [], options = {}) {
  const { items, page, pageCount } = paginatedItems(dimensions, options)
  const rows = items.map((dimension, index) => ([{
    text: `📍 ${preserveUiData(dimension.name)}`,
    callback_data: `mv:dimension:${index}`,
    style: 'primary',
  }]))
  rows.push(...paginationRows('mv:dimension', page, pageCount))
  rows.push([{ text: 'بدون مشروع', callback_data: 'mv:dimension:skip', style: 'primary' }])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function expenseCategoryKeyboard(categories = [], options = {}) {
  const { items, page, pageCount } = paginatedItems(categories, options)
  const rows = items.map((category, index) => ([{
    text: `🧾 ${preserveUiData(accountPrimaryName(category))}`,
    callback_data: `mv:category:${index}`,
    style: 'primary',
  }]))
  rows.push(...paginationRows('mv:category', page, pageCount))
  rows.push([{ text: 'بدون تصنيف', callback_data: 'mv:category:skip', style: 'primary' }])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

function paginatedItems(items = [], options = {}) {
  const pageSize = Math.max(1, Number(options.pageSize) || 8)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(0, Number(options.page) || 0), pageCount - 1)
  return {
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    page,
    pageCount,
  }
}

export function attachmentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'بدون مرفق', callback_data: 'mv:attachment:skip', style: 'primary' }],
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function recurringKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'ليست متكررة', callback_data: 'mv:recurring:no', style: 'primary' }],
      [{ text: 'حركة شهرية', callback_data: 'mv:recurring:monthly', style: 'success' }],
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function confirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'تأكيد وحفظ الحركة', callback_data: 'mv:confirm', style: 'success' }],
      [{ text: '↩️ تعديل', callback_data: 'mv:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function reviewKeyboard(reviewSession) {
  const rows = []

  ;(reviewSession?.items || []).forEach((item) => {
    const number = item.number
    if (item.kind === 'movement') {
      rows.push([
        { text: `إصلاح حركة #${number}`, callback_data: actionCallbackData('review', reviewSession.actionSessionId, 'movement', 'fix', item.token), style: 'success' },
        { text: `إلغاء #${number}`, callback_data: actionCallbackData('review', reviewSession.actionSessionId, 'movement', 'cancel', item.token), style: 'danger' },
      ])
      return
    }
    rows.push([
      { text: `إصلاح حساب #${number}`, callback_data: actionCallbackData('review', reviewSession.actionSessionId, 'account', 'fix', item.token), style: 'success' },
      { text: `إخفاء إذا صفر #${number}`, callback_data: actionCallbackData('review', reviewSession.actionSessionId, 'account', 'hide', item.token), style: 'primary' },
    ])
  })
  rows.push(...paginationRows('review', reviewSession?.page, reviewSession?.pageCount))
  rows.push([{ text: '↩️ القائمة', callback_data: 'main:home', style: 'primary' }])
  return { inline_keyboard: rows }
}

export function historyKeyboard(historySession) {
  const rows = []
  const items = historySession?.items || Object.keys(historySession?.choices?.movements || {}).map((token, index) => ({
    canCancel: true,
    number: index + 1,
    token,
  }))
  items.filter((item) => item.canCancel).forEach((item) => {
    rows.push([{ text: `إلغاء حركة #${item.number}`, callback_data: actionCallbackData('history', historySession.actionSessionId, 'cancel', item.token), style: 'danger' }])
  })
  rows.push(...paginationRows('history', historySession?.page, historySession?.pageCount))
  rows.push([{ text: '↩️ القائمة', callback_data: 'main:home', style: 'primary' }])
  return { inline_keyboard: rows }
}

export function historyCancelConfirmKeyboard(actionSessionId, token) {
  return {
    inline_keyboard: [
      [{ text: 'تأكيد الإلغاء', callback_data: actionCallbackData('history', actionSessionId, 'confirm', token), style: 'danger' }],
      [{ text: '↩️ رجوع للسجل', callback_data: 'main:history', style: 'primary' }],
    ],
  }
}
