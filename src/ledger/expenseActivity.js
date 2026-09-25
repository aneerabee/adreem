import { MOVEMENT_TYPES } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'
import { movementDayKey, movementDayLabel } from './movementPresentation'

export const EXPENSE_MOVEMENT_TYPES = Object.freeze([
  MOVEMENT_TYPES.EXPENSE,
  MOVEMENT_TYPES.TRUCK_EXPENSE,
])

export function expenseCategoryRequestFilter(categoryId = '') {
  return categoryId ? { expenseCategoryId: categoryId } : {}
}

function movementTimestamp(movement) {
  const value = Date.parse(movement?.createdAt || movement?.updatedAt || '')
  return Number.isFinite(value) ? value : 0
}

export function expenseActivityMovements({ movements = [], accountById = new Map(), categoryId = '', query = '' } = {}) {
  const normalizedQuery = normalizeAccountSearchText(query)
  return movements
    .filter((movement) => EXPENSE_MOVEMENT_TYPES.includes(movement?.type))
    .filter((movement) => !categoryId || movement.expenseCategoryId === categoryId)
    .filter((movement) => {
      if (!normalizedQuery) return true
      const source = accountById.get(movement.sourceAccountId)
      const category = accountById.get(movement.expenseCategoryId)
      const haystack = normalizeAccountSearchText([
        movement.note,
        movement.amount,
        movement.currency,
        source?.ownerName,
        source?.subAccountName,
        category?.ownerName,
        category?.subAccountName,
      ].filter(Boolean).join(' '))
      return haystack.includes(normalizedQuery)
    })
    .slice()
    .sort((left, right) => {
      const leftSequence = Number(left?.databaseSequence)
      const rightSequence = Number(right?.databaseSequence)
      if (Number.isSafeInteger(leftSequence) && Number.isSafeInteger(rightSequence)) return rightSequence - leftSequence
      return movementTimestamp(right) - movementTimestamp(left)
    })
}

export function groupExpenseActivityByDay(movements = []) {
  const groups = new Map()
  for (const movement of movements) {
    const occurredAt = movement.createdAt || movement.updatedAt
    const key = movementDayKey(occurredAt)
    const current = groups.get(key)
    if (current) current.movements.push(movement)
    else groups.set(key, { key, label: movementDayLabel(occurredAt), movements: [movement] })
  }
  return Array.from(groups.values())
}
