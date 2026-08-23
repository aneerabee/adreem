import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createOpeningMovements } from './ledgerCore.js'
import {
  attachmentsForRecord,
  buildDimensionReports,
  buildExpenseCategoryReports,
  buildLedgerAlerts,
  buildReconciliationCorrectionDrafts,
  createAttachment,
  createReconciliation,
  createRecurringRuleFromMovement,
  defaultRecurringFirstRunOn,
  disableRecurringRule,
  dueRecurringRules,
  executeRecurringRuleInState,
  findUnresolvedReconciliationDifferences,
  hideAttachment,
  runRecurringRule,
  recurringRuleDueOn,
  syncRecurringRuleFromSourceMovement,
  syncRecurringRulesFromMovement,
  syncRecurringRulesFromSourceMovement,
  updateRecurringRule,
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
      valueKind: VALUE_KINDS.PROJECT,
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

  it('keeps hidden projects with posted history in dimension reports', () => {
    const reports = buildDimensionReports({
      accounts: [
        accounts[0],
        { ...accounts[1], status: 'inactive', disabledAt: '2026-05-20T00:00:00.000Z' },
      ],
      dimensions: [
        {
          id: 'dimension-account-truck',
          name: 'الشاحنة',
          type: 'project',
          linkedAccountId: 'truck',
          status: 'inactive',
        },
      ],
      movements: [
        {
          id: 'historic-expense-1',
          type: MOVEMENT_TYPES.EXPENSE,
          status: MOVEMENT_STATUSES.POSTED,
          currency: CURRENCIES.DINAR,
          amount: 200,
          sourceAccountId: 'me-cash',
          dimensionId: 'dimension-account-truck',
        },
      ],
    })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      dimension: {
        id: 'dimension-account-truck',
        status: 'inactive',
      },
      expense: 200,
      movementCount: 1,
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
    expect(validateAttachmentDraft({ label: 'رابط', url: 'javascript:alert(1)' }).ok).toBe(false)
    expect(validateAttachmentDraft({ label: 'رابط', url: 'https://example.com/receipt.pdf' }).ok).toBe(true)
    expect(createAttachment({ label: '', url: '' })).toBeNull()
  })

  it('hides attachments without deleting their storage reference', () => {
    const attachment = createAttachment({
      movementId: 'movement-1',
      label: 'إيصال',
      storagePath: 'main/2026-08-19/receipt.pdf',
      mimeType: 'application/pdf',
    })
    const hidden = hideAttachment(attachment, '2026-08-19T12:00:00.000Z')

    expect(hidden).toMatchObject({
      status: 'inactive',
      storagePath: 'main/2026-08-19/receipt.pdf',
      disabledAt: '2026-08-19T12:00:00.000Z',
    })
    expect(attachmentsForRecord([hidden], { movementId: 'movement-1' })).toEqual([])
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

  it('normalizes reconciliation balances to whole currency units', () => {
    const reconciliation = createReconciliation({
      accountId: 'me-cash',
      expectedDinar: 100.125,
      actualDinar: 100.375,
      expectedUsd: 2.5,
      actualUsd: 2.25,
      note: 'مطابقة دقيقة',
    })

    expect(reconciliation).toMatchObject({
      expectedDinar: 100,
      actualDinar: 100,
      diffDinar: 0,
      expectedUsd: 3,
      actualUsd: 2,
      diffUsd: -1,
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

  it('finds only reconciliation differences not settled by posted corrections', () => {
    const reconciliations = [
      { id: 'settled', accountId: 'me-cash', diffDinar: -50, diffUsd: 0 },
      { id: 'pending', accountId: 'me-cash', diffDinar: 25, diffUsd: -5 },
      { id: 'matched', accountId: 'me-cash', diffDinar: 0, diffUsd: 0 },
    ]
    const movements = [
      {
        id: 'settled-correction',
        type: MOVEMENT_TYPES.CORRECTION,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: -50,
        destinationAccountId: 'me-cash',
        reconciliationId: 'settled',
      },
      {
        id: 'pending-review-correction',
        type: MOVEMENT_TYPES.CORRECTION,
        status: MOVEMENT_STATUSES.NEEDS_REVIEW,
        currency: CURRENCIES.DINAR,
        amount: 25,
        destinationAccountId: 'me-cash',
        reconciliationId: 'pending',
      },
    ]

    expect(findUnresolvedReconciliationDifferences(reconciliations, movements)).toEqual([
      {
        reconciliation: reconciliations[1],
        unresolvedDinar: 25,
        unresolvedUsd: -5,
      },
    ])
  })

  it('reports expense totals by category without treating the category as a money account', () => {
    const expenseAccounts = [
      ...accounts,
      { id: 'fuel', ownerName: 'وقود', subAccountName: 'مصروف', type: ACCOUNT_TYPES.EXPENSE, valueKind: VALUE_KINDS.EXPENSE, status: 'active' },
    ]
    const reports = buildExpenseCategoryReports({
      accounts: expenseAccounts,
      movements: [
        { id: 'fuel-1', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount: 150, currency: CURRENCIES.DINAR, sourceAccountId: 'me-cash', expenseCategoryId: 'fuel' },
        { id: 'other-1', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount: 50, currency: CURRENCIES.DINAR, sourceAccountId: 'me-cash' },
      ],
    })

    expect(reports).toEqual([
      expect.objectContaining({ categoryId: 'fuel', name: 'وقود', dinar: 150, count: 1 }),
      expect.objectContaining({ categoryId: '', name: 'بدون تصنيف', dinar: 50, count: 1 }),
    ])
  })

  it('counts only posted expenses and keeps dinars separate from dollars', () => {
    const reports = buildExpenseCategoryReports({
      accounts,
      movements: [
        { id: 'posted-dinar', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount: 450, currency: CURRENCIES.DINAR, sourceAccountId: 'me-cash' },
        { id: 'posted-usd', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.POSTED, amount: 25, currency: CURRENCIES.USD, sourceAccountId: 'me-cash' },
        { id: 'voided', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.VOIDED, amount: 900, currency: CURRENCIES.DINAR, sourceAccountId: 'me-cash' },
        { id: 'review', type: MOVEMENT_TYPES.EXPENSE, status: MOVEMENT_STATUSES.NEEDS_REVIEW, amount: 800, currency: CURRENCIES.DINAR, sourceAccountId: 'me-cash' },
      ],
    })

    expect(reports).toEqual([
      expect.objectContaining({ categoryId: '', name: 'بدون تصنيف', dinar: 450, usd: 25, count: 2 }),
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
    const run = runRecurringRule(rule, accounts, createOpeningMovements([{ ...accounts[0], openingDinar: 500 }]), date)

    expect(run.movement.id).toContain('2026-05')
    expect(run.rule.lastRunKey).toBe('2026-05')
    expect(dueRecurringRules([run.rule], date)).toHaveLength(0)
  })

  it('executes a due recurring rule idempotently in the full ledger state', () => {
    const rule = createRecurringRuleFromMovement({
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار',
    }, { dayOfMonth: 1 })
    const state = {
      accounts,
      movements: createOpeningMovements([{ ...accounts[0], openingDinar: 500 }]),
      recurringRules: [rule],
      auditEvents: [],
    }
    const date = new Date('2026-05-25T12:00:00.000Z')

    const first = executeRecurringRuleInState(state, rule.id, date)
    const second = executeRecurringRuleInState(first.state, rule.id, date)

    expect(first.ok).toBe(true)
    expect(first.state.movements.filter((item) => item.recurringRuleId === rule.id)).toHaveLength(1)
    expect(first.state.recurringRules[0].lastRunKey).toBe('2026-05')
    expect(second.ok).toBe(false)
    expect(second.state.movements).toHaveLength(first.state.movements.length)
  })

  it('allows rerunning a recurring rule when its previous monthly movement was voided', () => {
    const rule = createRecurringRuleFromMovement({
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار',
    }, { dayOfMonth: 1 })
    const state = {
      accounts,
      movements: createOpeningMovements([{ ...accounts[0], openingDinar: 500 }]),
      recurringRules: [rule],
      auditEvents: [],
    }
    const date = new Date('2026-05-25T12:00:00.000Z')
    const first = executeRecurringRuleInState(state, rule.id, date)
    const firstMovement = first.state.movements.find((item) => item.recurringRuleId === rule.id)
    const voidedState = {
      ...first.state,
      movements: first.state.movements.map((item) => item.id === firstMovement.id
        ? {
            ...item,
            status: MOVEMENT_STATUSES.VOIDED,
            voidReason: 'إلغاء التنفيذ السابق',
            voidedAt: '2026-05-25T12:30:00.000Z',
            updatedAt: '2026-05-25T12:30:00.000Z',
          }
        : item),
    }

    const rerun = executeRecurringRuleInState(voidedState, rule.id, date)
    const monthlyMovements = rerun.state.movements.filter((item) => item.recurringRuleId === rule.id)

    expect(rerun.ok).toBe(true)
    expect(rerun.duplicate).toBe(false)
    expect(monthlyMovements).toHaveLength(2)
    expect(monthlyMovements.map((item) => item.status)).toEqual([
      MOVEMENT_STATUSES.VOIDED,
      MOVEMENT_STATUSES.POSTED,
    ])
    expect(new Set(monthlyMovements.map((item) => item.id)).size).toBe(2)
  })

  it('marks a repaired recurring movement as completed for its month', () => {
    const rule = {
      ...createRecurringRuleFromMovement({
        id: 'rent-1',
        type: MOVEMENT_TYPES.EXPENSE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: 100,
        sourceAccountId: 'me-cash',
      }),
      lastFailedRunKey: '2026-05',
    }
    const repaired = {
      id: `recurring-${rule.id}-2026-05`,
      recurringRuleId: rule.id,
      recurringRunKey: '2026-05',
      status: MOVEMENT_STATUSES.POSTED,
      updatedAt: '2026-05-25T12:00:00.000Z',
    }

    const [synced] = syncRecurringRulesFromMovement([rule], repaired, '2026-05-25T12:01:00.000Z')

    expect(synced.lastRunKey).toBe('2026-05')
    expect(dueRecurringRules([synced], new Date('2026-05-30T12:00:00.000Z'))).toHaveLength(0)
  })

  it('does not mark a new monthly rule due during its creation month', () => {
    const rule = {
      ...createRecurringRuleFromMovement({
        id: 'rent-1',
        type: MOVEMENT_TYPES.EXPENSE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: 100,
        sourceAccountId: 'me-cash',
      }, { dayOfMonth: 1 }),
      createdAt: '2026-05-05T12:00:00.000Z',
    }

    expect(dueRecurringRules([rule], new Date('2026-05-31T12:00:00.000Z'))).toHaveLength(0)
    expect(dueRecurringRules([rule], new Date('2026-06-01T12:00:00.000Z'))).toEqual([rule])
  })

  it('only marks a monthly rule due on or after its chosen day', () => {
    const movement = {
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار',
    }
    const rule = createRecurringRuleFromMovement(movement, { dayOfMonth: 20 })

    expect(dueRecurringRules([rule], new Date('2026-05-19T12:00:00.000Z'))).toHaveLength(0)
    expect(dueRecurringRules([rule], new Date('2026-05-20T12:00:00.000Z'))).toHaveLength(1)
  })

  it('anchors a new monthly income to an explicit next date and advances only after posting', () => {
    const movement = {
      id: 'salary-august',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 2_500,
      destinationAccountId: 'me-cash',
      note: 'راتب',
      createdAt: '2026-08-25T12:00:00.000Z',
    }
    const rule = createRecurringRuleFromMovement(movement, { firstRunOn: '2026-09-25' })
    const state = { accounts, movements: [], recurringRules: [rule], auditEvents: [] }

    expect(rule).toMatchObject({
      name: 'دخل · راتب',
      firstRunOn: '2026-09-25',
      nextRunOn: '2026-09-25',
      dayOfMonth: 25,
      executionMode: 'manual',
    })
    expect(recurringRuleDueOn(rule, new Date('2026-09-24T12:00:00.000Z'))).toBe('2026-09-25')
    expect(dueRecurringRules([rule], new Date('2026-09-24T12:00:00.000Z'))).toEqual([])

    const result = executeRecurringRuleInState(state, rule.id, new Date('2026-09-25T12:00:00.000Z'))

    expect(result.ok).toBe(true)
    expect(result.movement).toMatchObject({
      recurringRuleId: rule.id,
      recurringRunKey: '2026-09',
      status: MOVEMENT_STATUSES.POSTED,
    })
    expect(result.state.recurringRules[0]).toMatchObject({
      lastRunKey: '2026-09',
      nextRunOn: '2026-10-25',
    })
  })

  it('keeps a missed monthly date due and uses the scheduled month as its unique run key', () => {
    const rule = createRecurringRuleFromMovement({
      id: 'rent-income',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 900,
      destinationAccountId: 'me-cash',
      note: 'إيجار',
    }, { firstRunOn: '2026-09-30' })
    const state = { accounts, movements: [], recurringRules: [rule], auditEvents: [] }

    const lateRun = executeRecurringRuleInState(state, rule.id, new Date('2026-10-03T12:00:00.000Z'))

    expect(lateRun.ok).toBe(true)
    expect(lateRun.movement.recurringRunKey).toBe('2026-09')
    expect(lateRun.state.recurringRules[0].nextRunOn).toBe('2026-10-30')
    expect(dueRecurringRules(lateRun.state.recurringRules, new Date('2026-10-03T12:00:00.000Z'))).toEqual([])
  })

  it('calculates the default next date in the shared Tripoli calendar', () => {
    expect(defaultRecurringFirstRunOn(new Date('2026-08-31T22:30:00.000Z'))).toBe('2026-10-01')
    expect(defaultRecurringFirstRunOn(new Date('2026-01-31T12:00:00.000Z'))).toBe('2026-02-28')
  })

  it.each([29, 30, 31])('makes day %i due on the last day of a shorter month', (dayOfMonth) => {
    const rule = {
      ...createRecurringRuleFromMovement({
        id: `rent-${dayOfMonth}`,
        type: MOVEMENT_TYPES.EXPENSE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: 100,
        sourceAccountId: 'me-cash',
      }, { dayOfMonth }),
      createdAt: '2026-01-10T12:00:00.000Z',
    }

    expect(dueRecurringRules([rule], new Date('2026-02-27T12:00:00.000Z'))).toHaveLength(0)
    expect(dueRecurringRules([rule], new Date('2026-02-28T12:00:00.000Z'))).toEqual([rule])

    const leapYearRule = { ...rule, createdAt: '2028-01-10T12:00:00.000Z' }
    expect(dueRecurringRules([leapYearRule], new Date('2028-02-28T12:00:00.000Z'))).toHaveLength(0)
    expect(dueRecurringRules([leapYearRule], new Date('2028-02-29T12:00:00.000Z'))).toEqual([leapYearRule])
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

  it('updates the recurring day without losing execution history', () => {
    const rule = {
      ...createRecurringRuleFromMovement({
        id: 'rent-1',
        type: MOVEMENT_TYPES.EXPENSE,
        status: MOVEMENT_STATUSES.POSTED,
        currency: CURRENCIES.DINAR,
        amount: 100,
        sourceAccountId: 'me-cash',
      }, { dayOfMonth: 5 }),
      lastRunKey: '2026-04',
    }

    const updated = updateRecurringRule(rule, { dayOfMonth: 20, name: 'إيجار المقر' }, '2026-05-01T00:00:00.000Z')

    expect(updated).toMatchObject({
      id: rule.id,
      dayOfMonth: 20,
      name: 'إيجار المقر',
      lastRunKey: '2026-04',
      updatedAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('syncs source movement edits and cancellation into their monthly rules', () => {
    const source = {
      id: 'rent-1',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.DINAR,
      amount: 100,
      sourceAccountId: 'me-cash',
      note: 'إيجار قديم',
    }
    const rule = createRecurringRuleFromMovement(source, { dayOfMonth: 5 })
    const editedSource = {
      ...source,
      amount: 150,
      note: 'إيجار محدث',
      expenseCategoryId: 'rent-expense',
    }

    const synced = syncRecurringRuleFromSourceMovement(rule, editedSource, '2026-05-01T00:00:00.000Z')

    expect(synced).toMatchObject({
      sourceMovementId: source.id,
      status: 'active',
      template: {
        amount: 150,
        note: 'إيجار محدث',
        expenseCategoryId: 'rent-expense',
      },
      updatedAt: '2026-05-01T00:00:00.000Z',
    })

    const [disabled] = syncRecurringRulesFromSourceMovement([
      synced,
      { ...rule, id: 'unrelated-rule', sourceMovementId: 'other-movement' },
    ], {
      ...editedSource,
      status: MOVEMENT_STATUSES.VOIDED,
      voidedAt: '2026-05-02T00:00:00.000Z',
    }, '2026-05-02T00:01:00.000Z')

    expect(disabled).toMatchObject({
      id: rule.id,
      status: 'inactive',
      disabledAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:01:00.000Z',
    })
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
