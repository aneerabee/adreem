import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  buildDimensionReports,
  buildLedgerAlerts,
  buildReconciliationCorrectionDrafts,
  createAttachment,
  createReconciliation,
  createRecurringRuleFromMovement,
  disableRecurringRule,
  dueRecurringRules,
  runRecurringRule,
  validateAttachmentDraft,
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
    const attachment = createAttachment({
      movementId: 'm1',
      label: 'إيصال',
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      sizeBytes: 4000,
    })

    expect(attachment).toMatchObject({
      movementId: 'm1',
      label: 'إيصال',
      url: 'https://example.com/a.png',
      mimeType: 'image/png',
      sizeBytes: 4000,
      source: 'web',
    })
  })

  it('rejects unsafe attachment drafts before saving metadata', () => {
    expect(validateAttachmentDraft({ label: 'ملف', mimeType: 'application/x-msdownload' }).ok).toBe(false)
    expect(validateAttachmentDraft({ label: 'ملف كبير', sizeBytes: 11 * 1024 * 1024 }).ok).toBe(false)
    expect(createAttachment({ label: '', url: '' })).toBeNull()
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
      diffDinar: -50,
      note: 'عد نقدي',
    })
  })

  it('builds correction drafts from reconciliation diffs only', () => {
    const reconciliation = createReconciliation({
      accountId: 'me-cash',
      expectedDinar: 1000,
      actualDinar: 950,
      expectedUsd: 20,
      actualUsd: 20,
      note: 'مطابقة الصندوق',
    })

    expect(buildReconciliationCorrectionDrafts(reconciliation)).toEqual([
      {
        type: MOVEMENT_TYPES.CORRECTION,
        amount: -50,
        currency: CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: 'me-cash',
        note: 'مطابقة الصندوق',
        reconciliationId: reconciliation.id,
      },
    ])
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

  it('disables recurring rules without deleting their history', () => {
    const rule = createRecurringRuleFromMovement({
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار',
    })

    const disabled = disableRecurringRule(rule, '2026-05-26T00:00:00.000Z')

    expect(disabled).toMatchObject({
      id: rule.id,
      status: 'inactive',
      disabledAt: '2026-05-26T00:00:00.000Z',
    })
    expect(dueRecurringRules([disabled], new Date('2026-06-01T00:00:00.000Z'))).toHaveLength(0)
  })

  it('builds actionable ledger alerts without false positives', () => {
    expect(buildLedgerAlerts()).toEqual([])

    const alerts = buildLedgerAlerts({
      reviewMovements: [{ id: 'm1' }],
      balances: [{ account: accounts[0], dinar: -100, usd: 0 }],
      totals: { iOwePeople: 250 },
      dueRecurringCount: 1,
      reconciliationDiffCount: 1,
      movements: [
        {
          id: 'large-1',
          type: MOVEMENT_TYPES.EXPENSE,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 150000,
          sourceAccountId: 'me-cash',
          createdAt: '2026-05-26T10:00:00.000Z',
        },
        {
          id: 'dup-1',
          type: MOVEMENT_TYPES.EXPENSE,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 300,
          sourceAccountId: 'me-cash',
          createdAt: '2026-05-26T11:00:00.000Z',
        },
        {
          id: 'dup-2',
          type: MOVEMENT_TYPES.EXPENSE,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 300,
          sourceAccountId: 'me-cash',
          createdAt: '2026-05-26T11:01:00.000Z',
        },
      ],
    })

    expect(alerts.map((alert) => alert.title)).toEqual([
      'حركات ناقصة',
      'فلوس ناقصة',
      'أدفع',
      'حركات متكررة',
      'فروق مطابقة',
      'حركة كبيرة',
      'تكرار محتمل',
    ])
  })
})
