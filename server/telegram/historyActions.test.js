import { describe, expect, it } from 'vitest'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import {
  buildHistorySession,
  canVoidRecentMovement,
  historyMovementStatusLabel,
  movementsForDate,
  relatedReportMovements,
  voidRecentMovementInState,
} from './historyActions.js'
import { stableActionToken } from './actionTokens.js'

const now = '2026-06-02T08:00:00.000Z'

function movement(overrides = {}) {
  return {
    id: 'movement-1',
    type: MOVEMENT_TYPES.EXPENSE,
    status: MOVEMENT_STATUSES.POSTED,
    amount: 100,
    currency: 'LYD',
    sourceAccountId: 'me-cash',
    createdAt: '2026-06-02T07:30:00.000Z',
    ...overrides,
  }
}

describe('telegram history actions', () => {
  it('shows approved, canceled, and incomplete movements while only offering valid cancellation', () => {
    const session = buildHistorySession({
      movements: [
        movement({ id: 'opening-me-cash', type: MOVEMENT_TYPES.OPENING_BALANCE }),
        movement({ id: 'separate-1', type: MOVEMENT_TYPES.RECORD_ONLY, sourceAccountId: '' }),
        movement({ id: 'posted-1' }),
        movement({ id: 'voided-1', status: MOVEMENT_STATUSES.VOIDED }),
        movement({ id: 'review-1', status: MOVEMENT_STATUSES.NEEDS_REVIEW }),
      ],
    }, undefined, 0, new Date(now).getTime())

    expect(session.flow).toBe('history')
    expect(session.total).toBe(3)
    expect(session.page).toBe(0)
    expect(session.pageCount).toBe(1)
    expect(session.choices.movements[stableActionToken('posted-1')]).toBe('posted-1')
    expect(Object.values(session.choices.movements)).toEqual(['posted-1'])
    expect(session.items).toEqual([
      expect.objectContaining({ id: 'review-1', number: 1, status: MOVEMENT_STATUSES.NEEDS_REVIEW, canCancel: false }),
      expect.objectContaining({ id: 'voided-1', number: 2, status: MOVEMENT_STATUSES.VOIDED, canCancel: false }),
      expect.objectContaining({ id: 'posted-1', number: 3, status: MOVEMENT_STATUSES.POSTED, canCancel: true }),
    ])
  })

  it('paginates the full history and clamps invalid pages', () => {
    const movements = Array.from({ length: 19 }, (_, index) => movement({ id: `posted-${index + 1}` }))

    const middle = buildHistorySession({ movements }, 8, 1, new Date(now).getTime())
    const afterEnd = buildHistorySession({ movements }, 8, 99, new Date(now).getTime())
    const beforeStart = buildHistorySession({ movements }, 8, -5, new Date(now).getTime())

    expect(middle).toMatchObject({ page: 1, pageCount: 3, total: 19 })
    expect(Object.values(middle.choices.movements)).toEqual([
      'posted-11',
      'posted-10',
      'posted-9',
      'posted-8',
      'posted-7',
      'posted-6',
      'posted-5',
      'posted-4',
    ])
    expect(afterEnd.page).toBe(2)
    expect(Object.values(afterEnd.choices.movements)).toEqual(['posted-3', 'posted-2', 'posted-1'])
    expect(beforeStart.page).toBe(0)
  })

  it('keeps an empty history on a stable first page', () => {
    expect(buildHistorySession({ movements: [] })).toMatchObject({
      flow: 'history',
      page: 0,
      pageCount: 1,
      total: 0,
      items: [],
      choices: { movements: {} },
    })
  })

  it('rotates the action session when history is rendered again', () => {
    const state = { movements: [movement()] }

    const first = buildHistorySession(state)
    const second = buildHistorySession(state)

    expect(first.actionSessionId).not.toBe(second.actionSessionId)
    expect(Object.keys(first.choices.movements)).toEqual(Object.keys(second.choices.movements))
  })

  it('voids a recent posted movement without deleting it', () => {
    const state = { movements: [movement()] }
    const metadata = { idempotencyKey: 'telegram-update-8200-movement-cancel' }

    const result = voidRecentMovementInState(state, 'movement-1', now, metadata)

    expect(result.ok).toBe(true)
    expect(result.state.movements).toHaveLength(1)
    expect(result.state.movements[0]).toMatchObject({
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'إلغاء من سجل Telegram',
      voidedAt: now,
    })
    expect(result.state.auditEvents).toHaveLength(1)
    expect(result.state.auditEvents[0]).toMatchObject({
      action: 'movement.updated',
      details: {
        movementId: 'movement-1',
        status: MOVEMENT_STATUSES.VOIDED,
        telegramIdempotencyKey: metadata.idempotencyKey,
      },
    })

    const duplicate = voidRecentMovementInState(result.state, 'movement-1', now, metadata)
    expect(duplicate.ok).toBe(true)
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.state.auditEvents).toHaveLength(1)
  })

  it('blocks old or opening movement cancellation', () => {
    expect(canVoidRecentMovement(movement({ createdAt: '2026-05-30T08:00:00.000Z' }), new Date(now).getTime())).toBe(false)
    expect(canVoidRecentMovement(movement({ id: 'opening-me-cash' }), new Date(now).getTime())).toBe(false)

    const result = voidRecentMovementInState(
      { movements: [movement({ createdAt: '2026-05-30T08:00:00.000Z' })] },
      'movement-1',
      now,
    )

    expect(result.ok).toBe(false)
    expect(result.state.movements[0].status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(result.message).toContain('آخر 24 ساعة')
  })

  it('keeps a recent income posted when canceling it would overdraw owned cash', () => {
    const income = movement({
      id: 'income-100',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      sourceAccountId: null,
      destinationAccountId: 'me-cash',
    })
    const state = {
      accounts: [{
        id: 'me-cash',
        valueKind: 'cash',
        status: 'active',
        balanceSource: 'database',
        balanceDinar: 0,
        balanceUsd: 0,
        postedCount: 2,
      }],
      movements: [income],
    }

    const result = voidRecentMovementInState(state, income.id, now)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('بالسالب')
    expect(result.state.movements[0].status).toBe(MOVEMENT_STATUSES.POSTED)
  })

  it('uses one local-day set for approved, canceled, and incomplete counters', () => {
    const state = {
      movements: [
        movement({ id: 'posted-today', status: MOVEMENT_STATUSES.POSTED }),
        movement({ id: 'voided-today', status: MOVEMENT_STATUSES.VOIDED, createdAt: '', updatedAt: '2026-06-02T01:00:00.000Z' }),
        movement({ id: 'review-today', status: MOVEMENT_STATUSES.NEEDS_REVIEW }),
        movement({ id: 'opening-me-cash', type: MOVEMENT_TYPES.OPENING_BALANCE }),
        movement({ id: 'yesterday', createdAt: '2026-06-01T18:00:00.000Z' }),
        movement({ id: 'bad-date', createdAt: 'not-a-date' }),
      ],
    }

    expect(movementsForDate(state, new Date(now)).map((item) => item.id)).toEqual([
      'review-today',
      'voided-today',
      'posted-today',
    ])
  })

  it('uses the Tripoli day at midnight regardless of the server time zone', () => {
    const state = {
      movements: [
        movement({ id: 'tripoli-today', createdAt: '2026-06-01T22:30:00.000Z' }),
        movement({ id: 'tripoli-yesterday', createdAt: '2026-06-01T21:59:59.000Z' }),
      ],
    }

    expect(movementsForDate(state, new Date('2026-06-02T10:00:00.000Z')).map((item) => item.id))
      .toEqual(['tripoli-today'])
  })

  it('labels every history status clearly', () => {
    expect(historyMovementStatusLabel(MOVEMENT_STATUSES.POSTED)).toBe('معتمدة')
    expect(historyMovementStatusLabel(MOVEMENT_STATUSES.VOIDED)).toBe('ملغاة')
    expect(historyMovementStatusLabel(MOVEMENT_STATUSES.NEEDS_REVIEW)).toBe('ناقصة')
    expect(historyMovementStatusLabel(MOVEMENT_STATUSES.DRAFT)).toBe('مسودة')
  })

  it('finds project and expense details only through their relation fields', () => {
    const state = {
      movements: [
        movement({ id: 'project-match', dimensionId: 'project-9' }),
        movement({ id: 'category-match', expenseCategoryId: 'expense-9' }),
        movement({ id: 'account-only', sourceAccountId: 'project-9', destinationAccountId: 'expense-9' }),
        movement({ id: 'other', dimensionId: 'project-8', expenseCategoryId: 'expense-8' }),
      ],
    }

    expect(relatedReportMovements(state, 'project', 'project-9').map((item) => item.id)).toEqual(['project-match'])
    expect(relatedReportMovements(state, 'expense', 'expense-9').map((item) => item.id)).toEqual(['category-match'])
    expect(relatedReportMovements(state, 'unknown', 'project-9')).toEqual([])
  })

  it('shows only posted expenses in the uncategorized expense report', () => {
    const state = {
      movements: [
        movement({ id: 'uncategorized-expense', expenseCategoryId: '' }),
        movement({ id: 'uncategorized-truck-expense', type: MOVEMENT_TYPES.TRUCK_EXPENSE, expenseCategoryId: '' }),
        movement({ id: 'categorized-expense', expenseCategoryId: 'fuel' }),
        movement({ id: 'income-without-category', type: MOVEMENT_TYPES.EXTERNAL_INCOME, expenseCategoryId: '' }),
        movement({ id: 'voided-expense', status: MOVEMENT_STATUSES.VOIDED, expenseCategoryId: '' }),
      ],
    }

    expect(relatedReportMovements(state, 'expense', '').map((item) => item.id)).toEqual([
      'uncategorized-truck-expense',
      'uncategorized-expense',
    ])
  })
})
