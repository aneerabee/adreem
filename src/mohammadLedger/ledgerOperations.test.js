import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  buildDimensionReports,
  createAttachment,
  createReconciliation,
  createRecurringRuleFromMovement,
  dueRecurringRules,
  runRecurringRule,
} from './ledgerOperations.js'

describe('adreem operational features', () => {
  const accounts = [
    {
      id: 'me-cash',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      status: 'active',
    },
    {
      id: 'truck',
      ownerName: 'الشاحنة',
      subAccountName: 'مشروع',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.ASSET,
      status: 'active',
    },
  ]

  it('reports project income and expense without changing financial balances itself', () => {
    const state = {
      accounts,
      dimensions: [{ id: 'dimension-account-truck', name: 'الشاحنة', type: 'project' }],
      movements: [
        {
          id: 'expense-1',
          type: MOVEMENT_TYPES.EXPENSE,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 200,
          sourceAccountId: 'me-cash',
          dimensionId: 'dimension-account-truck',
        },
        {
          id: 'income-1',
          type: MOVEMENT_TYPES.EXTERNAL_INCOME,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 700,
          destinationAccountId: 'me-cash',
          dimensionId: 'dimension-account-truck',
        },
        {
          id: 'income-usd-1',
          type: MOVEMENT_TYPES.EXTERNAL_INCOME,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.USD,
          amount: 50,
          destinationAccountId: 'me-cash',
          dimensionId: 'dimension-account-truck',
        },
      ],
    }

    expect(buildDimensionReports(state)[0]).toMatchObject({
      income: 700,
      expense: 200,
      net: 500,
      incomeUsd: 50,
      expenseUsd: 0,
      netUsd: 50,
      movementCount: 3,
    })
  })

  it('keeps attachments as ledger records linked to a movement or account', () => {
    const attachment = createAttachment({ movementId: 'm1', label: 'إيصال', url: 'https://example.com/a.png' })

    expect(attachment).toMatchObject({
      movementId: 'm1',
      label: 'إيصال',
      url: 'https://example.com/a.png',
      source: 'web',
    })
  })

  it('records reconciliation expectations and actual values', () => {
    const reconciliation = createReconciliation({
      accountId: 'me-cash',
      expectedDinar: 1000,
      actualDinar: 950,
      expectedUsd: 0,
      actualUsd: 0,
      note: 'عد نقدي',
    })

    expect(reconciliation).toMatchObject({
      accountId: 'me-cash',
      expectedDinar: 1000,
      actualDinar: 950,
      note: 'عد نقدي',
    })
  })

  it('runs monthly recurring rules once per month', () => {
    const movement = {
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار',
    }
    const rule = createRecurringRuleFromMovement(movement)
    const date = new Date('2026-05-25T12:00:00.000Z')
    const run = runRecurringRule(rule, accounts, date)

    expect(run.movement.id).toContain('2026-05')
    expect(run.rule.lastRunKey).toBe('2026-05')
    expect(dueRecurringRules([run.rule], date)).toHaveLength(0)
  })

  it('keeps an invalid recurring rule due after a failed review run', () => {
    const movement = {
      id: 'bad-rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'missing-account',
      note: 'إيجار',
    }
    const rule = createRecurringRuleFromMovement(movement)
    const date = new Date('2026-05-25T12:00:00.000Z')
    const run = runRecurringRule(rule, accounts, date)

    expect(run.movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(run.rule.lastRunKey).toBe('')
    expect(run.rule.lastFailedRunKey).toBe('2026-05')
    expect(dueRecurringRules([run.rule], date)).toHaveLength(1)
  })
})
