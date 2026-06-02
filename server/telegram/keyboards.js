import { createHash } from 'node:crypto'
import { accountPresets } from '../../src/mohammadLedger/accountConfig.js'
import { CURRENCIES } from '../../src/mohammadLedger/ledgerCore.js'
import { movementTypeOptions } from '../../src/mohammadLedger/movementConfig.js'
import {
  accountChoiceButtonStyle,
  accountChoiceButtonText,
} from './messages.js'

export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '+ إدخال', callback_data: 'main:movement', style: 'success' }, { text: '= الأرصدة', callback_data: 'main:accounts', style: 'primary' }],
      [{ text: '≡ السجل', callback_data: 'main:history' }, { text: '! مراجعة', callback_data: 'main:review' }],
      [{ text: '+ حساب جديد', callback_data: 'main:account', style: 'primary' }],
      [{ text: 'سجل اليوم', callback_data: 'main:today' }, { text: 'بحث عن حساب', callback_data: 'main:search' }],
    ],
  }
}

export function accountTypeKeyboard(selectedKey = '') {
  return {
    inline_keyboard: [
      ...accountPresets.map((preset) => ([{
        text: `${selectedKey === preset.key ? '✓ ' : ''}${accountTypeIcon(preset.key)} ${preset.title} · ${preset.detail}`,
        callback_data: `acct:type:${preset.key}`,
        style: selectedKey === preset.key ? 'success' : 'primary',
      }])),
      [{ text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
    ],
  }
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

export function accountConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'تأكيد إنشاء الحساب', callback_data: 'acct:confirm', style: 'success' }],
      [{ text: '↩️ تعديل التفصيل', callback_data: 'acct:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'acct:cancel', style: 'danger' }],
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
  const rows = [
    ...movementTypeOptions.map((option) => ([{
      text: movementTypeButtonText(option),
      callback_data: `mv:type:${option.type}`,
      style: movementTypeButtonStyle(option.tone),
    }])),
  ]
  rows.push([{ text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }])
  return {
    inline_keyboard: rows,
  }
}

function movementTypeButtonText(option) {
  if (option.tone === 'transfer') return `🔁 ${option.label}`
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
  const movementTokens = Object.keys(reviewSession?.choices?.movements || {})
  const accountTokens = Object.keys(reviewSession?.choices?.accounts || {})

  movementTokens.forEach((token) => {
    rows.push([{ text: `إلغاء حركة #${Number(token) + 1}`, callback_data: `review:movement:cancel:${token}`, style: 'danger' }])
  })
  accountTokens.forEach((token) => {
    rows.push([
      { text: `إصلاح حساب #${Number(token) + 1}`, callback_data: `review:account:fix:${token}`, style: 'success' },
      { text: `إخفاء إذا صفر #${Number(token) + 1}`, callback_data: `review:account:hide:${token}`, style: 'primary' },
    ])
  })
  rows.push([{ text: '↩️ القائمة', callback_data: 'main:home', style: 'primary' }])
  return { inline_keyboard: rows }
}
