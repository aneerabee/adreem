const MAX_INTEGER_DIGITS = 15
const MAX_DECIMAL_DIGITS = 6

export function normalizeNumericBuffer(value = '', { allowDecimal = false } = {}) {
  const normalized = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '')
  const [integer = '', ...fractionParts] = normalized.split('.')
  const safeInteger = integer.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS) || (normalized ? '0' : '')
  if (!allowDecimal || !fractionParts.length) return safeInteger
  return `${safeInteger || '0'}.${fractionParts.join('').slice(0, MAX_DECIMAL_DIGITS)}`
}

export function applyNumericKey(value = '', key = '', { allowDecimal = false } = {}) {
  const current = normalizeNumericBuffer(value, { allowDecimal })
  if (key === 'clear') return ''
  if (key === 'delete') return current.slice(0, -1)
  if (key === 'dot') return allowDecimal && !current.includes('.') ? `${current || '0'}.` : current
  if (!/^\d$/.test(key)) return current

  const [integer = '', fraction = ''] = current.split('.')
  if (current.includes('.')) {
    if (!allowDecimal || fraction.length >= MAX_DECIMAL_DIGITS) return current
    return `${integer}.${fraction}${key}`
  }
  if (integer.length >= MAX_INTEGER_DIGITS) return current
  return integer === '0' ? key : `${integer}${key}`
}

export function numericBufferDisplay(value = '') {
  const normalized = String(value || '')
  if (!normalized) return '0'
  const [integer = '0', fraction] = normalized.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

export function numericBufferValue(value = '', { allowDecimal = false, allowZero = false } = {}) {
  const normalized = normalizeNumericBuffer(value, { allowDecimal })
  if (!normalized || normalized.endsWith('.')) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) return null
  return allowDecimal ? parsed : Math.round(parsed)
}
