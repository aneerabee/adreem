import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'

export const SEPARATE_RECORD_DIRECTIONS = Object.freeze({
  RECEIVABLE: 'receivable',
  PAYABLE: 'payable',
  NOTE: 'note',
})

export const MAIN_LEDGER_MOVEMENT_TYPES = Object.freeze(
  Object.values(MOVEMENT_TYPES).filter((type) => (
    type !== MOVEMENT_TYPES.OPENING_BALANCE && type !== MOVEMENT_TYPES.RECORD_ONLY
  )),
)

export const separateRecordDirectionOptions = Object.freeze([
  { value: SEPARATE_RECORD_DIRECTIONS.RECEIVABLE, label: 'لي' },
  { value: SEPARATE_RECORD_DIRECTIONS.PAYABLE, label: 'عليّ' },
  { value: SEPARATE_RECORD_DIRECTIONS.NOTE, label: 'معلومة' },
])

export function normalizeSeparateRecordName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120)
}

export function normalizeSeparateRecordDirection(value = '') {
  return Object.values(SEPARATE_RECORD_DIRECTIONS).includes(value)
    ? value
    : SEPARATE_RECORD_DIRECTIONS.NOTE
}

export function isSeparateRecord(movement = {}) {
  return movement.type === MOVEMENT_TYPES.RECORD_ONLY
}

export function isMainLedgerMovement(movement = {}) {
  return Boolean(movement) && !movement.id?.startsWith('opening-') && !isSeparateRecord(movement)
}

export function isActiveSeparateRecord(movement = {}) {
  return isSeparateRecord(movement) && movement.status === MOVEMENT_STATUSES.POSTED
}

function compareSeparateRecordRecency(left, right) {
  const leftSequence = Number(left?.databaseSequence)
  const rightSequence = Number(right?.databaseSequence)
  if (Number.isSafeInteger(leftSequence) && Number.isSafeInteger(rightSequence) && leftSequence !== rightSequence) {
    return rightSequence - leftSequence
  }
  const dateComparison = String(right?.createdAt || right?.updatedAt || '')
    .localeCompare(String(left?.createdAt || left?.updatedAt || ''))
  if (dateComparison) return dateComparison
  return String(right?.id || '').localeCompare(String(left?.id || ''))
}

export function activeSeparateRecords(movements = []) {
  const activeRecords = movements.filter(isActiveSeparateRecord)
  const supersededIds = new Set(
    activeRecords.map((movement) => String(movement.supersedesSeparateRecordId || '')).filter(Boolean),
  )
  const currentRecords = activeRecords
    .filter((movement) => !supersededIds.has(String(movement.id || '')))
    .slice()
    .sort(compareSeparateRecordRecency)
  const visibleAccountIds = new Set()
  return currentRecords.filter((movement) => {
    const accountId = String(movement.separateAccountId || '').trim()
    if (!accountId) return movement.separateRecordAction !== 'void'
    if (visibleAccountIds.has(accountId)) return false
    visibleAccountIds.add(accountId)
    return movement.separateRecordAction !== 'void'
  })
}

export function separateRecordNames(accounts = [], movements = []) {
  const names = [
    ...accounts.map((account) => account?.ownerName),
    ...activeSeparateRecords(movements).map((movement) => movement?.relatedName),
  ]
  return Array.from(new Set(names.map(normalizeSeparateRecordName).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'ar'))
}

export function separateRecordTotals(movements = []) {
  const emptyCurrency = () => ({ receivable: 0, payable: 0 })
  const totals = {
    [CURRENCIES.DINAR]: emptyCurrency(),
    [CURRENCIES.USD]: emptyCurrency(),
  }
  for (const movement of activeSeparateRecords(movements)) {
    const currency = movement.currency === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR
    const direction = normalizeSeparateRecordDirection(movement.recordDirection)
    const amount = Math.abs(Math.round(Number(movement.amount || 0)))
    if (direction === SEPARATE_RECORD_DIRECTIONS.RECEIVABLE) totals[currency].receivable += amount
    if (direction === SEPARATE_RECORD_DIRECTIONS.PAYABLE) totals[currency].payable += amount
  }
  return totals
}

export function filterSeparateRecords(movements = [], query = '') {
  const normalizedQuery = normalizeSeparateRecordName(query).toLocaleLowerCase('ar')
  return activeSeparateRecords(movements)
    .filter((movement) => {
      if (!normalizedQuery) return true
      return `${movement.relatedName || ''} ${movement.note || ''}`.toLocaleLowerCase('ar').includes(normalizedQuery)
    })
}

export function separateRecordCancellationDraft(target = {}) {
  return {
    type: MOVEMENT_TYPES.RECORD_ONLY,
    amount: Math.max(1, Math.abs(Math.round(Number(target.amount || 0)))),
    currency: target.currency === CURRENCIES.USD ? CURRENCIES.USD : CURRENCIES.DINAR,
    sourceAccountId: null,
    destinationAccountId: null,
    separateAccountId: String(target.separateAccountId || (target.id ? `separate-account-${target.id}` : '')).trim(),
    relatedName: normalizeSeparateRecordName(target.relatedName) || 'بدون اسم',
    recordDirection: normalizeSeparateRecordDirection(target.recordDirection),
    note: String(target.note || '').trim() || 'حساب منفصل',
    supersedesSeparateRecordId: String(target.id || '').trim(),
    separateRecordAction: 'void',
  }
}
