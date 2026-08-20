import { MOVEMENT_STATUSES, MOVEMENT_TYPES, voidMovement } from '../../src/mohammadLedger/ledgerCore.js'
import { createActionSessionId, stableActionToken } from './actionTokens.js'

export const HISTORY_ACTION_LIMIT = 8
export const CANCEL_WINDOW_HOURS = 24
const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000

export function buildHistorySession(state, limit = HISTORY_ACTION_LIMIT, requestedPage = 0, nowMs = Date.now()) {
  const allMovements = recentHistoryMovements(state)
  const pageCount = Math.max(1, Math.ceil(allMovements.length / limit))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const movements = allMovements.slice(page * limit, (page + 1) * limit)
  const items = movements.map((movement, index) => ({
    id: movement.id,
    number: page * limit + index + 1,
    status: movement.status,
    token: stableActionToken(movement.id),
    canCancel: canVoidRecentMovement(movement, nowMs),
  }))
  return {
    flow: 'history',
    actionSessionId: createActionSessionId(),
    page,
    pageCount,
    total: allMovements.length,
    items,
    choices: {
      movements: Object.fromEntries(items.filter((item) => item.canCancel).map((item) => [item.token, item.id])),
    },
  }
}

export function recentHistoryMovements(state = {}) {
  return (state.movements || [])
    .filter((movement) => movement && !movement.id?.startsWith('opening-'))
    .slice()
    .reverse()
}

export function movementsForDate(state = {}, targetDate = new Date()) {
  const year = targetDate.getFullYear()
  const month = targetDate.getMonth()
  const day = targetDate.getDate()
  return recentHistoryMovements(state).filter((movement) => {
    const date = new Date(movement.createdAt || movement.updatedAt || '')
    if (Number.isNaN(date.getTime())) return false
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
  })
}

export function historyMovementStatusLabel(status) {
  if (status === MOVEMENT_STATUSES.POSTED) return 'معتمدة'
  if (status === MOVEMENT_STATUSES.VOIDED) return 'ملغاة'
  if (status === MOVEMENT_STATUSES.NEEDS_REVIEW) return 'ناقصة'
  return 'مسودة'
}

export function relatedReportMovements(state = {}, kind, reportId) {
  const field = kind === 'project'
    ? 'dimensionId'
    : kind === 'expense'
      ? 'expenseCategoryId'
      : ''
  if (!field) return []
  const expectedId = String(reportId || '')
  return recentHistoryMovements(state).filter((movement) => {
    if (movement?.status !== MOVEMENT_STATUSES.POSTED) return false
    if (kind === 'expense' && movement.type !== MOVEMENT_TYPES.EXPENSE && movement.type !== MOVEMENT_TYPES.TRUCK_EXPENSE) return false
    return String(movement?.[field] || '') === expectedId
  })
}

export function canVoidRecentMovement(movement, nowMs = Date.now()) {
  if (!movement || movement.status !== MOVEMENT_STATUSES.POSTED || movement.id?.startsWith('opening-')) return false
  const date = new Date(movement.createdAt || movement.updatedAt || '')
  if (Number.isNaN(date.getTime())) return false
  return nowMs - date.getTime() <= CANCEL_WINDOW_MS
}

export function voidRecentMovementInState(state, movementId, now = new Date().toISOString()) {
  let changed = false
  let message = 'لم أجد الحركة في السجل.'
  const nowMs = new Date(now).getTime()
  const movements = (state.movements || []).map((movement) => {
    if (movement.id !== movementId) return movement
    if (!canVoidRecentMovement(movement, nowMs)) {
      message = `الإلغاء المباشر متاح فقط خلال آخر ${CANCEL_WINDOW_HOURS} ساعة. للحركات القديمة استخدم تصحيح.`
      return movement
    }
    const result = voidMovement(movement, 'إلغاء من سجل Telegram', now)
    if (!result.ok) {
      message = result.error || 'لم يتم الإلغاء.'
      return movement
    }
    changed = true
    message = 'تم إلغاء الحركة وبقيت في السجل.'
    return result.movement
  })

  if (!changed) return { ok: false, state, message }
  return { ok: true, state: { ...state, movements }, message }
}
