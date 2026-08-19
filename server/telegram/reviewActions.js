import { ACCOUNT_STATUSES } from '../../src/mohammadLedger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES } from '../../src/mohammadLedger/ledgerCore.js'
import { buildLedgerSnapshot } from '../mohammadLedger/ledgerService.js'
import { createActionSessionId, stableActionToken } from './actionTokens.js'

export const REVIEW_ACTION_LIMIT = 8

export function buildReviewSession(state, limit = REVIEW_ACTION_LIMIT, requestedPage = 0) {
  const allItems = [
    ...state.accounts
      .filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
      .map((account) => ({ kind: 'account', id: account.id, value: account })),
    ...state.movements
      .filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
      .map((movement) => ({ kind: 'movement', id: movement.id, value: movement })),
  ]
  const pageCount = Math.max(1, Math.ceil(allItems.length / limit))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const items = allItems
    .slice(page * limit, page * limit + limit)
    .map((item, index) => ({ ...item, number: page * limit + index + 1, token: stableActionToken(item.id) }))

  return {
    flow: 'review',
    actionSessionId: createActionSessionId(),
    page,
    pageCount,
    pageSize: limit,
    total: allItems.length,
    items,
    choices: {
      accounts: Object.fromEntries(items.filter((item) => item.kind === 'account').map((item) => [item.token, item.id])),
      movements: Object.fromEntries(items.filter((item) => item.kind === 'movement').map((item) => [item.token, item.id])),
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
