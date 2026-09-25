import { describe, expect, it } from 'vitest'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { buildExpenseStatement } from './accountStatementData.js'

const expense = (id, amount, currency, createdAt, extra = {}) => ({ id, type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount, currency, createdAt, sourceAccountId: 'cash', expenseCategoryId: 'food', ...extra })

describe('expense category statement', () => {
  const movements = [
    expense('b', 40, 'USD', '2026-09-22T02:00:00Z'),
    expense('a', 85, 'LYD', '2026-09-20T07:00:00Z'),
    expense('c', 15, 'LYD', '2026-09-23T09:00:00Z'),
    expense('v', 999, 'LYD', '2026-09-23T10:00:00Z', { status: MOVEMENT_STATUSES.VOIDED }),
    expense('x', 50, 'LYD', '2026-09-23T11:00:00Z', { expenseCategoryId: 'fuel' }),
  ]

  it('lists the category spending newest first with a running total per currency', () => {
    const statement = buildExpenseStatement(movements, 'food')
    expect(statement.rows.map((row) => [row.movement.id, row.delta, row.balance])).toEqual([
      ['c', -15, -100],
      ['b', -40, -40],
      ['a', -85, -85],
    ])
    expect(statement.totals.LYD).toMatchObject({ outgoing: 100, balance: -100 })
    expect(statement.totals.USD).toMatchObject({ outgoing: 40, balance: -40 })
  })

  it('honours the chosen currencies', () => {
    const statement = buildExpenseStatement(movements, 'food', ['USD'])
    expect(statement.rows.map((row) => row.movement.id)).toEqual(['b'])
    expect(statement.totals.LYD.outgoing).toBe(0)
  })
})
