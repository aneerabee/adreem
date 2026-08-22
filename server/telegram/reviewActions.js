import { ACCOUNT_STATUSES } from '../../src/ledger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES } from '../../src/ledger/ledgerCore.js'
import { buildLedgerSnapshot } from '../ledger/ledgerService.js'
import { createActionSessionId, stableActionToken } from './actionTokens.js'

export const REVIEW_ACTION_LIMIT = 8

function normalizedReviewLimit(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : REVIEW_ACTION_LIMIT
}

function normalizedReviewPage(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function reviewAccounts(state) {
  return state.accounts
    .filter((account) => account.status === ACCOUNT_STATUSES.NEEDS_REVIEW)
    .map((account) => ({ kind: 'account', id: account.id, value: account }))
}

function reviewPageWindow(accountCount, limit, requestedPage) {
  const page = normalizedReviewPage(requestedPage)
  const start = page * limit
  const visibleAccountCount = Math.max(0, Math.min(limit, accountCount - start))
  const movementSlots = limit - visibleAccountCount
  return {
    page,
    start,
    visibleAccountCount,
    movementOffset: Math.max(0, start - accountCount),
    movementLimit: Math.max(1, movementSlots),
    movementSlots,
  }
}

function normalizedMovementTotal(value) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null
}

function assertReviewRevision(result, expectedRevision) {
  if (expectedRevision === null || expectedRevision === undefined) return
  if (!Number.isSafeInteger(Number(expectedRevision))) return
  if (Number(result?.revision) === Number(expectedRevision)) return
  const error = new Error('Review changed while it was loading.')
  error.code = 'ADREEM_REVIEW_REVISION_CHANGED'
  throw error
}

export function stableReviewRequestedPage(previousSession, currentRevision, requestedPage) {
  const page = normalizedReviewPage(requestedPage)
  const previousRevision = Number(previousSession?.ledgerRevision)
  const revision = Number(currentRevision)
  const changed = previousSession?.flow === 'review'
    && page > 0
    && Number.isSafeInteger(previousRevision)
    && Number.isSafeInteger(revision)
    && previousRevision !== revision
  return { page: changed ? 0 : page, changed }
}

function reviewSessionFromItems(items, limit, page, total, movementTotal = null) {
  const numberedItems = items.map((item, index) => ({
    ...item,
    number: page * limit + index + 1,
    token: stableActionToken(item.id),
  }))
  return {
    flow: 'review',
    actionSessionId: createActionSessionId(),
    page,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    pageSize: limit,
    total,
    movementTotal,
    items: numberedItems,
    choices: {
      accounts: Object.fromEntries(numberedItems.filter((item) => item.kind === 'account').map((item) => [item.token, item.id])),
      movements: Object.fromEntries(numberedItems.filter((item) => item.kind === 'movement').map((item) => [item.token, item.id])),
    },
  }
}

export function buildReviewSession(state, limit = REVIEW_ACTION_LIMIT, requestedPage = 0) {
  const pageSize = normalizedReviewLimit(limit)
  const allItems = [
    ...reviewAccounts(state),
    ...state.movements
      .filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
      .map((movement) => ({ kind: 'movement', id: movement.id, value: movement })),
  ]
  const pageCount = Math.max(1, Math.ceil(allItems.length / pageSize))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  const items = allItems
    .slice(page * pageSize, page * pageSize + pageSize)

  return reviewSessionFromItems(items, pageSize, page, allItems.length)
}

export async function loadReviewSession(repository, state, limit = REVIEW_ACTION_LIMIT, requestedPage = 0, expectedRevision = null) {
  const pageSize = normalizedReviewLimit(limit)
  const accountItems = reviewAccounts(state)
  let window = reviewPageWindow(accountItems.length, pageSize, requestedPage)
  let movementResult = await repository.loadMovements({
    status: MOVEMENT_STATUSES.NEEDS_REVIEW,
    movementOffset: window.movementOffset,
    movementLimit: window.movementLimit,
  })
  assertReviewRevision(movementResult, expectedRevision)
  let movementTotal = normalizedMovementTotal(movementResult.page?.total)

  if (movementTotal === null && window.movementOffset > 0) {
    const countResult = await repository.loadMovements({
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      movementOffset: 0,
      movementLimit: 1,
    })
    assertReviewRevision(countResult, expectedRevision)
    movementTotal = normalizedMovementTotal(countResult.page?.total)
  }
  if (movementTotal === null) {
    throw new Error('Unable to determine the complete Telegram review movement count.')
  }

  const total = accountItems.length + movementTotal
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(window.page, pageCount - 1)
  const boundedWindow = reviewPageWindow(accountItems.length, pageSize, page)
  if (
    boundedWindow.movementOffset !== window.movementOffset ||
    boundedWindow.movementLimit !== window.movementLimit
  ) {
    movementResult = await repository.loadMovements({
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      movementOffset: boundedWindow.movementOffset,
      movementLimit: boundedWindow.movementLimit,
    })
    assertReviewRevision(movementResult, expectedRevision)
  }
  window = boundedWindow

  const visibleAccounts = accountItems.slice(window.start, window.start + window.visibleAccountCount)
  const visibleMovements = (movementResult.movements || [])
    .slice(0, window.movementSlots)
    .map((movement) => ({ kind: 'movement', id: movement.id, value: movement }))

  return reviewSessionFromItems(
    [...visibleAccounts, ...visibleMovements],
    pageSize,
    page,
    total,
    movementTotal,
  )
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
