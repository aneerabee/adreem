import { createHash } from 'node:crypto'
import { accountPresetGroups, accountPresets, accountPrimaryName } from '../../src/ledger/accountConfig.js'
import { CURRENCIES } from '../../src/ledger/ledgerCore.js'
import { movementTypeOptions } from '../../src/ledger/movementConfig.js'
import { preserveUiData } from '../../src/ledger/uiTranslation.js'
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

export function numericKeypadKeyboard(prefix, { allowDecimal = false } = {}) {
  const keyButton = (text, key) => ({ text, callback_data: `${prefix}:num:${key}` })
  const bottomLeft = allowDecimal ? keyButton('٫', 'dot') : keyButton('مسح', 'clear')
  return {
    inline_keyboard: [
      [keyButton('7', '7'), keyButton('8', '8'), keyButton('9', '9')],
      [keyButton('4', '4'), keyButton('5', '5'), keyButton('6', '6')],
      [keyButton('1', '1'), keyButton('2', '2'), keyButton('3', '3')],
      [bottomLeft, keyButton('0', '0'), keyButton('⌫', 'delete')],
      ...(allowDecimal ? [[keyButton('مسح', 'clear')]] : []),
      [{ text: 'التالي', callback_data: `${prefix}:num:done`, style: 'success' }],
      [
        { text: '↩️ رجوع', callback_data: `${prefix}:back`, style: 'primary' },
        { text: 'إلغاء', callback_data: `${prefix}:cancel`, style: 'danger' },
      ],
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

export function accountOpeningDirectionKeyboard(selectedDirection = '') {
  return {
    inline_keyboard: [
      [
        { text: `${selectedDirection === 'owed_to_me' ? '✓ ' : ''}لي عنده`, callback_data: 'acct:opening-direction:owed_to_me', style: 'success' },
        { text: `${selectedDirection === 'i_owe' ? '✓ ' : ''}عليّ له`, callback_data: 'acct:opening-direction:i_owe', style: 'danger' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'acct:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
}

export function accountConfirmKeyboard(mode = 'create') {
  const isReview = mode === true || mode === 'review'
  const isEdit = mode === 'edit'
  return {
    inline_keyboard: [
      [{ text: isReview ? 'تأكيد إصلاح الحساب' : isEdit ? 'حفظ تعديل الحساب' : 'تأكيد إنشاء الحساب', callback_data: 'acct:confirm', style: 'success' }],
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

export function movementTypeKeyboard(selectedType = '') {
  const buttonFor = (option) => ({
      text: `${selectedType === option.type ? '✓ ' : ''}${movementTypeButtonText(option)}`,
      callback_data: `mv:type:${option.type}`,
      style: selectedType === option.type ? 'success' : movementTypeButtonStyle(option.tone),
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

export function separateNameKeyboard(items = [], query = '') {
  const rows = items.map((item) => ([{
    text: `${item.selected ? '✓ ' : ''}${preserveUiData(item.name)}`,
    callback_data: `mv:link:${item.token}`,
    style: item.selected ? 'success' : 'primary',
  }]))
  if (query) rows.push([{ text: `استخدام «${preserveUiData(query)}»`, callback_data: 'mv:link:use', style: 'success' }])
  rows.push([{ text: 'اكتب اسمًا للبحث أو الإضافة', callback_data: 'mv:link:hint', style: 'primary' }])
  rows.push([{ text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function separateDirectionKeyboard(selected = '') {
  const button = (label, value, style) => ({
    text: `${selected === value ? '✓ ' : ''}${label}`,
    callback_data: `mv:direction:${value}`,
    style: selected === value ? 'success' : style,
  })
  return {
    inline_keyboard: [
      [button('🟢 لي', 'receivable', 'success'), button('🔴 عليّ', 'payable', 'danger')],
      [button('📝 معلومة', 'note', 'primary')],
      [{ text: '↩️ رجوع', callback_data: 'mv:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function separateLedgerKeyboard(session = {}) {
  const filterButton = (label, value) => ({
    text: `${session.balanceFilter === value ? '✓ ' : ''}${label}`,
    callback_data: `accounts:filter:${value}`,
    style: session.balanceFilter === value ? 'success' : 'primary',
  })
  return {
    inline_keyboard: [
      [filterButton('فلوسي', 'money'), filterButton('لي', 'collect')],
      [filterButton('عليّ', 'pay'), filterButton('منفصل', 'separate')],
      [{ text: '➕ حساب منفصل', callback_data: 'accounts:separate:add', style: 'success' }],
      ...(session.items || []).map((item) => ([
        { text: `تعديل #${item.number}`, callback_data: `accounts:separate:edit:${item.token}`, style: 'primary' },
        { text: `إلغاء #${item.number}`, callback_data: `accounts:separate:void:${item.token}`, style: 'danger' },
      ])),
      ...paginationRows('accounts:separate', session.page, session.pageCount),
      [{ text: '↩️ الأرصدة', callback_data: 'accounts:filter:money', style: 'primary' }, { text: 'الرئيسية', callback_data: 'main:home' }],
    ],
  }
}

export function separateVoidConfirmKeyboard(session = {}, token = '') {
  return {
    inline_keyboard: [
      [{ text: 'نعم، إلغاء الحساب', callback_data: `accounts:separate:void-confirm:${token}`, style: 'danger' }],
      [{ text: '↩️ تراجع', callback_data: `accounts:separate:page:${Math.max(0, Number(session.page) || 0)}`, style: 'primary' }],
    ],
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
  if (option.tone === 'record') return `📝 ${option.label}`
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
        { text: `${selectedCurrency === CURRENCIES.DINAR ? '✓ ' : ''}دينار د.ل`, callback_data: `mv:currency:${CURRENCIES.DINAR}`, style: selectedCurrency === CURRENCIES.DINAR ? 'success' : 'primary' },
        { text: `${selectedCurrency === CURRENCIES.USD ? '✓ ' : ''}دولار $`, callback_data: `mv:currency:${CURRENCIES.USD}`, style: selectedCurrency === CURRENCIES.USD ? 'success' : 'primary' },
      ],
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function movementTextStepKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '↩️ رجوع', callback_data: 'mv:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function accountChoicesKeyboard(accounts, role, balancesByAccountId = new Map(), currency = '', options = {}) {
  const rows = accounts.map((account) => {
    const bucket = balancesByAccountId.get(account.id)
    return [{
      text: accountChoiceButtonText(account, bucket, currency),
      callback_data: `mv:account:${role}:${accountChoiceToken(account)}`,
      style: accountChoiceButtonStyle(account, bucket, currency),
    }]
  })
  rows.push(...paginationRows(`mv:accounts:${role}`, options.page, options.pageCount))
  rows.push([{ text: '🔎 اكتب اسمًا للبحث', callback_data: `mv:searchhint:${role}`, style: 'primary' }])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function accountsBrowserKeyboard(buckets = [], session = {}) {
  const activeFilter = session.balanceFilter || 'all'
  const filterButton = (label, value) => ({
    text: `${activeFilter === value ? '✓ ' : ''}${label}`,
    callback_data: `accounts:filter:${value}`,
    style: activeFilter === value ? 'success' : 'primary',
  })
  const rows = buckets.map((bucket) => ([{
    text: accountChoiceButtonText(bucket.account, bucket),
    callback_data: `accounts:open:${accountChoiceToken(bucket.account)}`,
    style: accountChoiceButtonStyle(bucket.account, bucket),
  }]))
  rows.unshift(
    [filterButton('فلوسي', 'money'), filterButton('لي', 'collect')],
    [filterButton('عليّ', 'pay'), filterButton('منفصل', 'separate')],
    [filterButton('الكل', 'all'), { text: 'الصافي', callback_data: 'accounts:net', style: 'primary' }],
  )
  rows.push(...paginationRows('accounts', session.page, session.pageCount))
  rows.push([{ text: '🔎 بحث', callback_data: 'main:search', style: 'primary' }, { text: '↩️ الرئيسية', callback_data: 'main:home' }])
  return { inline_keyboard: rows }
}

export function accountProfileKeyboard(page = 0, accountToken = '', options = {}) {
  return {
    inline_keyboard: [
      ...(accountToken && options.canEdit !== false ? [[{ text: 'تعديل الحساب', callback_data: `accounts:edit:${accountToken}`, style: 'success' }]] : []),
      ...(accountToken && options.canDelete === true ? [[{ text: 'حذف الحساب', callback_data: `accounts:delete:${accountToken}`, style: 'danger' }]] : []),
      [{ text: '↩️ الأرصدة', callback_data: `accounts:page:${Math.max(0, Number(page) || 0)}`, style: 'primary' }],
      [{ text: 'الرئيسية', callback_data: 'main:home' }],
    ],
  }
}

export function accountDeleteConfirmKeyboard(page = 0, accountToken = '') {
  return {
    inline_keyboard: [
      [{ text: 'نعم، حذف نهائي', callback_data: `accounts:delete-confirm:${accountToken}`, style: 'danger' }],
      [{ text: '↩️ رجوع', callback_data: `accounts:open:${accountToken}`, style: 'primary' }],
      [{ text: 'الأرصدة', callback_data: `accounts:page:${Math.max(0, Number(page) || 0)}` }],
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

export function noteKeyboard({ required = false } = {}) {
  return {
    inline_keyboard: [
      ...(required ? [] : [[{ text: 'بدون ملاحظة', callback_data: 'mv:note:skip', style: 'primary' }]]),
      [{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}

export function netTargetKeyboard(targetCurrency = CURRENCIES.DINAR, options = {}) {
  const showAccounts = Boolean(options.showAccounts)
  const page = Math.max(0, Number(options.page) || 0)
  const pageCount = Math.max(1, Number(options.pageCount) || 1)
  return {
    inline_keyboard: [
      [
        { text: `${targetCurrency === CURRENCIES.DINAR ? '✓ ' : ''}بالدينار`, callback_data: `net:target:${CURRENCIES.DINAR}`, style: targetCurrency === CURRENCIES.DINAR ? 'success' : 'primary' },
        { text: `${targetCurrency === CURRENCIES.USD ? '✓ ' : ''}بالدولار`, callback_data: `net:target:${CURRENCIES.USD}`, style: targetCurrency === CURRENCIES.USD ? 'success' : 'primary' },
      ],
      [{ text: showAccounts ? 'إخفاء الحسابات' : 'الحسابات الداخلة', callback_data: 'net:accounts' }],
      ...(showAccounts ? paginationRows('net:accounts', page, pageCount) : []),
      [{ text: 'تغيير السعر', callback_data: 'net:rate' }, { text: '↩️ الأرصدة', callback_data: 'main:accounts', style: 'primary' }],
    ],
  }
}

export function dimensionKeyboard(dimensions = [], options = {}) {
  const { items, page, pageCount } = paginatedItems(dimensions, options)
  const rows = items.map((dimension, index) => ([{
    text: `${options.selectedId === dimension.id ? '✓ ' : ''}📍 ${preserveUiData(dimension.name)}`,
    callback_data: `mv:dimension:${index}`,
    style: options.selectedId === dimension.id ? 'success' : 'primary',
  }]))
  rows.push(...paginationRows('mv:dimension', page, pageCount))
  rows.push([{ text: 'بدون مشروع', callback_data: 'mv:dimension:skip', style: 'primary' }])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
}

export function expenseCategoryKeyboard(categories = [], options = {}) {
  const { items, page, pageCount } = paginatedItems(categories, options)
  const rows = items.map((category, index) => ([{
    text: `${options.selectedId === category.id ? '✓ ' : ''}🧾 ${preserveUiData(accountPrimaryName(category))}`,
    callback_data: `mv:category:${index}`,
    style: options.selectedId === category.id ? 'success' : 'primary',
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

export function recurringDateKeyboard(monthKey, selectedDate = '') {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''))
  const now = new Date()
  const year = match ? Number(match[1]) : now.getUTCFullYear()
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const normalizedMonth = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
  const previous = new Date(Date.UTC(year, month - 2, 1))
  const next = new Date(Date.UTC(year, month, 1))
  const monthValue = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  const rows = [[{ text: normalizedMonth, callback_data: 'mv:recurring-date:noop', style: 'primary' }]]

  for (let day = 1; day <= lastDay; day += 7) {
    rows.push(Array.from({ length: Math.min(7, lastDay - day + 1) }, (_unused, index) => {
      const value = `${normalizedMonth}-${String(day + index).padStart(2, '0')}`
      return {
        text: value === selectedDate ? `✓ ${day + index}` : String(day + index),
        callback_data: `mv:recurring-date:${value}`,
        ...(value === selectedDate ? { style: 'success' } : {}),
      }
    }))
  }

  rows.push([
    { text: '‹', callback_data: `mv:recurring-month:${monthValue(previous)}` },
    { text: '›', callback_data: `mv:recurring-month:${monthValue(next)}` },
  ])
  rows.push([{ text: '↩️ رجوع', callback_data: 'mv:back' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return { inline_keyboard: rows }
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
