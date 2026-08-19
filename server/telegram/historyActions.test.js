import { describe, expect, it } from 'vitest'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { buildHistorySession, canVoidRecentMovement, voidRecentMovementInState } from './historyActions.js'

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
  it('builds action choices from recent posted non-opening movements', () => {
    const session = buildHistorySession({
      movements: [
        movement({ id: 'opening-me-cash', type: MOVEMENT_TYPES.OPENING_BALANCE }),
        movement({ id: 'posted-1' }),
        movement({ id: 'voided-1', status: MOVEMENT_STATUSES.VOIDED }),
      ],
    })

    expect(session.flow).toBe('history')
    expect(session.total).toBe(1)
    expect(session.page).toBe(0)
    expect(session.pageCount).toBe(1)
    expect(Object.values(session.choices.movements)).toEqual(['posted-1'])
  })

  it('paginates the full posted history and clamps invalid pages', () => {
    const movements = Array.from({ length: 19 }, (_, index) => movement({ id: `posted-${index + 1}` }))

    const middle = buildHistorySession({ movements }, 8, 1)
    const afterEnd = buildHistorySession({ movements }, 8, 99)
    const beforeStart = buildHistorySession({ movements }, 8, -5)

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
    expect(buildHistorySession({ movements: [] })).toEqual({
      flow: 'history',
      page: 0,
      pageCount: 1,
      total: 0,
      choices: { movements: {} },
    })
  })

  it('voids a recent posted movement without deleting it', () => {
    const state = { movements: [movement()] }

    const result = voidRecentMovementInState(state, 'movement-1', now)

    expect(result.ok).toBe(true)
    expect(result.state.movements).toHaveLength(1)
    expect(result.state.movements[0]).toMatchObject({
      status: MOVEMENT_STATUSES.VOIDED,
      voidReason: 'إلغاء من سجل Telegram',
      voidedAt: now,
    })
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
})
