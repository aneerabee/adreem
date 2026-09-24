import { VALUE_KINDS } from './accountCatalog'
import { CURRENCIES } from './ledgerCore'
import { USD_MAXIMUM_FRACTION_DIGITS } from './ledgerUiConfig'

function localizeDigit(character) {
  const code = character.charCodeAt(0)
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660)
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0)
  return character
}

export function normalizeLocalizedNumericInput(value, { allowDecimal = false, allowNegative = false } = {}) {
  const raw = String(value ?? '')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, localizeDigit)
    .replace(/\u2212/g, '-')
  const decimalIndex = raw.search(/[.\u066b]/)
  const wholeSource = decimalIndex >= 0 ? raw.slice(0, decimalIndex) : raw
  const whole = wholeSource.replace(/\D/g, '')
  const sign = allowNegative && /^\s*-/.test(raw) && whole ? '-' : ''

  if (!allowDecimal) return whole ? `${sign}${whole}` : ''
  const fractionSource = decimalIndex >= 0 ? raw.slice(decimalIndex + 1).split(/[.\u066b]/, 1)[0] : ''
  const fraction = fractionSource.replace(/\D/g, '')
  if (!whole && decimalIndex < 0) return ''
  return `${sign}${whole || '0'}${decimalIndex >= 0 ? `.${fraction}` : ''}`
}

export function parseLocalizedDecimal(value) {
  const normalized = normalizeLocalizedNumericInput(value, { allowDecimal: true, allowNegative: true })
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

export function parseWholeAmount(value) {
  return Math.round(parseLocalizedDecimal(value))
}

export function parseMoneyAmount(value) {
  return parseWholeAmount(value)
}

export function formatMoneyNumber(value) {
  if (typeof value === 'bigint') return value.toLocaleString('en-US')
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return Math.round(number).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function hasMoneyValue(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number !== 0
}

const BALANCE_AMOUNT_FIELDS = ['dinar', 'usd', 'try', 'eur']
const BALANCE_PAIR_INLINE_MAX_LENGTH = 5
const BALANCE_CARD_INLINE_MAX_LENGTH = 13

function longestBalanceAmountLength(value) {
  return Math.max(...BALANCE_AMOUNT_FIELDS.map((field) => formatMoneyNumber(value?.[field]).length))
}

export function balanceAmountNeedsStack(value) {
  return longestBalanceAmountLength(value) > BALANCE_PAIR_INLINE_MAX_LENGTH
}

export function balanceAmountIsWide(value) {
  return longestBalanceAmountLength(value) > BALANCE_CARD_INLINE_MAX_LENGTH
}

export function money(value, currency = CURRENCIES.DINAR) {
  return `${formatMoneyNumber(value, currency)} ${currency}`
}

export function signedMoney(value, currency = CURRENCIES.DINAR) {
  const number = Number(value || 0)
  const displayValue = Math.round(number)
  const prefix = displayValue > 0 ? '+' : displayValue < 0 ? '-' : ''
  return `${prefix}${formatMoneyNumber(Math.abs(displayValue), currency)} ${currency}`
}

export function formatInteger(value) {
  const rounded = parseWholeAmount(value)
  return rounded.toLocaleString('en-US')
}

export function formatCount(value) {
  return formatInteger(value)
}

export function formatRate(value) {
  const number = parseLocalizedDecimal(value)
  if (!Number.isFinite(number)) return ''
  return number.toLocaleString('en-US', {
    maximumFractionDigits: USD_MAXIMUM_FRACTION_DIGITS,
  })
}

export function formatNumericEntryValue(value, allowDecimal = false) {
  const raw = normalizeLocalizedNumericInput(value, { allowDecimal })
  if (!raw) return ''
  if (allowDecimal) {
    const [whole, fraction = ''] = raw.split('.')
    const formattedWhole = whole ? formatInteger(whole) : '0'
    return raw.includes('.') ? `${formattedWhole}.${fraction}` : formattedWhole
  }
  return formatInteger(raw)
}

export function netUsdMicrosText(value) {
  return `${(Number(value || 0) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
}

export function compactDisplayValue(account, amount, currency) {
  const value = Number(amount || 0)
  if (account?.valueKind === VALUE_KINDS.RECEIVABLE) return value > 0 ? `لي ${money(value, currency)}` : `عليّ ${money(Math.abs(value), currency)}`
  if (account?.valueKind === VALUE_KINDS.EXPENSE || account?.valueKind === VALUE_KINDS.ASSET) return money(Math.abs(value), currency)
  return money(value, currency)
}
