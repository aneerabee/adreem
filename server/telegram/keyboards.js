import { createHash } from 'node:crypto'
import { CURRENCIES } from '../../src/mohammadLedger/ledgerCore.js'
import { movementTypeOptions } from '../../src/mohammadLedger/movementConfig.js'
import {
  accountChoiceButtonStyle,
  accountChoiceButtonText,
} from './messages.js'

export function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ إدخال حركة', callback_data: 'main:movement', style: 'success' }],
      [{ text: '👥 الحسابات', callback_data: 'main:accounts', style: 'primary' }, { text: '📊 اليوم', callback_data: 'main:today', style: 'primary' }],
      [{ text: '📒 السجل', callback_data: 'main:history' }, { text: '⚠️ مراجعة', callback_data: 'main:review' }],
      [{ text: '🔎 بحث', callback_data: 'main:search' }],
    ],
  }
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
  if (option.tone === 'transfer') return `🔁 ${option.label} · ${option.detail}`
  if (option.tone === 'expense') return `🔴 ${option.label} · يخصم من حساب واحد`
  if (option.tone === 'sale') return `🟢 ${option.label} · دولار يخرج ودينار يدخل`
  if (option.tone === 'purchase') return `🔵 ${option.label} · دينار يخرج ودولار يدخل`
  return option.label
}

function movementTypeButtonStyle(tone) {
  if (tone === 'expense') return 'danger'
  if (tone === 'sale' || tone === 'purchase' || tone === 'transfer') return 'primary'
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
      [{ text: 'تأكيد الحفظ', callback_data: 'mv:confirm', style: 'success' }],
      [{ text: '↩️ تعديل آخر خطوة', callback_data: 'mv:back', style: 'primary' }, { text: 'إلغاء', callback_data: 'mv:cancel', style: 'danger' }],
    ],
  }
}
