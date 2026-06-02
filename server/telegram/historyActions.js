import { MOVEMENT_STATUSES, voidMovement } from '../../src/mohammadLedger/ledgerCore.js'

export const HISTORY_ACTION_LIMIT = 8
export const CANCEL_WINDOW_HOURS = 24
const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000

export function buildHistorySession(state, limit = HISTORY_ACTION_LIMIT) {
  const movements = recentHistoryMovements(state).slice(0, limit)
  return {
    flow: 'history',
    choices: {
      movements: Object.fromEntries(movements.map((movement, index) => [String(index), movement.id])),
    },
  }
}

export function recentHistoryMovements(state = {}) {
  return (state.movements || [])
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && !movement.id?.startsWith('opening-'))
    .slice()
    .reverse()
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
