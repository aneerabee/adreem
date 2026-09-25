import { describe, expect, it } from 'vitest'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { expenseActivityMovements, expenseCategoryRequestFilter, groupExpenseActivityByDay } from './expenseActivity.js'

const movement = (id, createdAt, extra = {}) => ({
  id,
  type: MOVEMENT_TYPES.EXPENSE,
  status: MOVEMENT_STATUSES.POSTED,
  amount: 25,
  currency: 'LYD',
  sourceAccountId: 'cash',
  expenseCategoryId: 'food',
  createdAt,
  ...extra,
})

const accountById = new Map([
  ['cash', { ownerName: 'خزنة البيت', subAccountName: 'كاش' }],
  ['food', { ownerName: 'طعام', subAccountName: 'مصروف' }],
  ['travel', { ownerName: 'سفر', subAccountName: 'مصروف' }],
])

describe('expense activity', () => {
  it('lists every expense newest first instead of grouping by category', () => {
    const result = expenseActivityMovements({
      movements: [
        movement('old', '2026-09-23T09:00:00Z'),
        movement('new', '2026-09-24T18:30:00Z', { type: MOVEMENT_TYPES.TRUCK_EXPENSE }),
        movement('transfer', '2026-09-25T20:00:00Z', { type: MOVEMENT_TYPES.TRANSFER }),
      ],
      accountById,
    })

    expect(result.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('uses category only as a filter and searches description or source', () => {
    const movements = [
      movement('food', '2026-09-24T18:30:00Z', { note: 'عشاء' }),
      movement('travel', '2026-09-24T19:30:00Z', { expenseCategoryId: 'travel', note: 'تذكرة' }),
    ]

    expect(expenseActivityMovements({ movements, accountById, categoryId: 'travel' }).map((item) => item.id)).toEqual(['travel'])
    expect(expenseActivityMovements({ movements, accountById, query: 'خزنة' }).map((item) => item.id)).toEqual(['travel', 'food'])
    expect(expenseActivityMovements({ movements, accountById, query: 'عشاء' }).map((item) => item.id)).toEqual(['food'])
  })

  it('maps the chosen category to the API filter', () => {
    expect(expenseCategoryRequestFilter('food')).toEqual({ expenseCategoryId: 'food' })
    expect(expenseCategoryRequestFilter('')).toEqual({})
  })

  it('groups the ordered list by day without hiding individual records', () => {
    const groups = groupExpenseActivityByDay([
      movement('a', '2026-09-24T20:00:00Z'),
      movement('b', '2026-09-24T10:00:00Z'),
      movement('c', '2026-09-23T10:00:00Z'),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].movements.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups[1].movements.map((item) => item.id)).toEqual(['c'])
  })
})
