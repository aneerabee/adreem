import { ACCOUNT_STATUSES } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { buildLedgerSnapshot } from '../mohammadLedger/ledgerService.js'

export const REVIEW_ACTION_LIMIT = 8

export function buildReviewSession(state, limit = REVIEW_ACTION_LIMIT) {
  const accounts = state.accounts
    .filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
    .slice(0, limit)
  const movements = state.movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
    .slice(0, limit)

  return {
    flow: 'review',
    choices: {
      accounts: Object.fromEntries(accounts.map((account, index) => [String(index), account.id])),
      movements: Object.fromEntries(movements.map((movement, index) => [String(index), movement.id])),
    },
  }
}

export function cancelReviewMovementInState(state, movementId, now = new Date().toISOString()) {
  let changed = false
  let blockedReason = ''
  const movements = state.movements.map((movement) => {
    if (movement.id !== movementId) return movement
    if (movement.status !== MOVEMENT_STATUSES.NEEDS_REVIEW) {
      blockedReason = 'هذه الحركة لم تعد في المراجعة.'
      return movement
    }
    changed = true
    return {
      ...movement,
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'إلغاء حركة ناقصة من البوت',
      voidedAt: now,
      updatedAt: now,
    }
  })

  if (!changed) {
    return {
      ok: false,
      message: blockedReason || 'لم أجد الحركة في المراجعة.',
    }
  }

  return {
    ok: true,
    state: { ...state, movements },
    message: 'تم إلغاء الحركة الناقصة. الأرصدة لم تتغير.',
  }
}

export function hideZeroReviewAccountInState(state, accountId, now = new Date().toISOString()) {
  const snapshot = buildLedgerSnapshot(state)
  const bucket = snapshot.balanceByAccountId.get(accountId)
  const account = snapshot.accountById.get(accountId)
  if (!account || account.status !== ACCOUNT_STATUSES.NEEDS_REVIEW) {
    return {
      ok: false,
      message: 'لم أجد الحساب في المراجعة.',
    }
  }
  const dinar = Math.round(Number(bucket?.dinar || 0))
  const usd = Math.round(Number(bucket?.usd || 0))
  if (dinar !== 0 || usd !== 0) {
    return {
      ok: false,
      message: `هذا الحساب عليه رصيد: ${formatReviewBalance(dinar, usd)}. أصلحه من الويب بدل إخفائه.`,
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      accounts: state.accounts.map((item) =>
        item.id === accountId
          ? {
              ...item,
              status: ACCOUNT_STATUSES.INACTIVE,
              disabledAt: now,
              updatedAt: now,
              disabledReason: 'إخفاء حساب مراجعة صفر من البوت',
            }
          : item,
      ),
    },
    message: 'تم إخفاء الحساب الصفري من المراجعة.',
  }
}

function formatReviewBalance(dinar, usd) {
  const parts = []
  if (dinar) parts.push(`${Math.abs(dinar).toLocaleString('en-US')} ${CURRENCIES.DINAR}`)
  if (usd) parts.push(`${Math.abs(usd).toLocaleString('en-US')} ${CURRENCIES.USD}`)
  return parts.join(' + ') || 'صفر'
}
