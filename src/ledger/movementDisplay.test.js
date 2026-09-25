import { describe, expect, it } from 'vitest'
import { createAccount, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { stripUiDataProtection } from './uiTranslation.js'
import { accountMovementFilter, expenseTotalsByCurrency, isExpenseCategoryAccount, isExpenseMovement, movementAccountContext, movementAccountLabel, postedCategoryExpenses } from './movementDisplay.js'

const plain = (value) => stripUiDataProtection(value)
const expense = (id, amount, currency, extra = {}) => ({ id, type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount, currency, sourceAccountId: 'cash', expenseCategoryId: 'food', ...extra })

describe('movement display', () => {
  it('recognizes expenses and expense categories', () => {
    expect(isExpenseMovement({ type: MOVEMENT_TYPES.EXPENSE })).toBe(true)
    expect(isExpenseMovement({ type: MOVEMENT_TYPES.TRANSFER })).toBe(false)
    expect(isExpenseCategoryAccount(createAccount({ ownerName: 'وقود', subAccountName: 'مصروف', type: 'expense', valueKind: 'expense' }))).toBe(true)
  })

  it('counts only posted expenses of the chosen category', () => {
    const movements = [
      expense('a', 85, 'LYD'),
      expense('b', 40, 'USD'),
      expense('c', 30, 'LYD', { status: MOVEMENT_STATUSES.VOIDED }),
      expense('d', 20, 'LYD', { expenseCategoryId: 'fuel' }),
      { id: 'e', type: MOVEMENT_TYPES.TRANSFER, status: MOVEMENT_STATUSES.POSTED, amount: 900, currency: 'LYD', expenseCategoryId: 'food' },
    ]
    expect(postedCategoryExpenses(movements, 'food').map((movement) => movement.id)).toEqual(['a', 'b'])
    expect(postedCategoryExpenses(movements, '')).toEqual([])
  })

  it('totals spending per currency in a stable order', () => {
    expect(expenseTotalsByCurrency([expense('a', 40, 'USD'), expense('b', 85, 'LYD'), expense('c', 15, 'LYD'), expense('d', 0, 'TRY')]))
      .toEqual([{ currency: 'LYD', amount: 100 }, { currency: 'USD', amount: 40 }])
  })

  it('drops the currency list of a multi-currency account but keeps single-currency detail', () => {
    const cash = createAccount({ id: 'cash', ownerName: 'كاش عندي', subAccountName: 'كاش', type: 'cash', valueKind: 'cash', currencyKind: 'multi' })
    const bank = createAccount({ id: 'bank', ownerName: 'مصرف الجمهورية', subAccountName: 'حساب مصرفي', type: 'bank', valueKind: 'bank', currencyKind: 'LYD' })
    expect(plain(movementAccountLabel(cash))).toBe('كاش عندي')
    expect(plain(movementAccountContext(cash))).toBe('')
    expect(plain(movementAccountLabel(bank))).toContain('LYD')
    expect(movementAccountLabel(null)).toBe('')
  })

  it('finds a category\'s expenses by category, other accounts by source or destination', () => {
    expect(accountMovementFilter('food', true)).toEqual({ expenseCategoryId: 'food' })
    expect(accountMovementFilter('cash', false)).toEqual({ accountId: 'cash' })
  })
})
