export const ADREEM_TIME_ZONE = 'Africa/Tripoli'

function validDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid reference date.')
  return date
}

function zonedParts(value, timeZone = ADREEM_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(validDate(value))
  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]))
}

function offsetAt(value, timeZone) {
  const date = validDate(value)
  const parts = zonedParts(date, timeZone)
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return representedAsUtc - Math.trunc(date.getTime() / 1_000) * 1_000
}

function localMidnight(year, month, day, timeZone) {
  const targetAsUtc = Date.UTC(year, month - 1, day)
  let instant = new Date(targetAsUtc - offsetAt(new Date(targetAsUtc), timeZone))
  instant = new Date(targetAsUtc - offsetAt(instant, timeZone))
  return instant
}

export function zonedDayKey(value = new Date(), timeZone = ADREEM_TIME_ZONE) {
  const { year, month, day } = zonedParts(value, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function zonedDayRange(reference = new Date(), timeZone = ADREEM_TIME_ZONE) {
  const parts = zonedParts(reference, timeZone)
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
  return {
    from: localMidnight(parts.year, parts.month, parts.day, timeZone).toISOString(),
    before: localMidnight(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), timeZone).toISOString(),
  }
}

export function isZonedToday(value, reference = new Date(), timeZone = ADREEM_TIME_ZONE) {
  if (value === undefined || value === null || value === '') return false
  try {
    return zonedDayKey(value, timeZone) === zonedDayKey(reference, timeZone)
  } catch {
    return false
  }
}

export function isZonedYesterday(value, reference = new Date(), timeZone = ADREEM_TIME_ZONE) {
  if (value === undefined || value === null || value === '') return false
  try {
    const { from } = zonedDayRange(reference, timeZone)
    return zonedDayKey(value, timeZone) === zonedDayKey(new Date(new Date(from).getTime() - 1), timeZone)
  } catch {
    return false
  }
}

export function formatZonedTime(value, locale, options = {}, timeZone = ADREEM_TIME_ZONE) {
  try {
    return validDate(value).toLocaleTimeString(locale, { ...options, timeZone })
  } catch {
    return ''
  }
}

export function formatZonedDate(value, locale, options = {}, timeZone = ADREEM_TIME_ZONE) {
  try {
    return validDate(value).toLocaleDateString(locale, { ...options, timeZone })
  } catch {
    return ''
  }
}

export function formatZonedDateTime(value, locale, options = {}, timeZone = ADREEM_TIME_ZONE) {
  try {
    return validDate(value).toLocaleString(locale, { ...options, timeZone })
  } catch {
    return ''
  }
}
