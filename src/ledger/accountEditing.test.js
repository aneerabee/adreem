import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { accountDeletionEligibility, accountEditChanges, accountStructureUsage, deleteUnusedAccountFromLedgerState, prepareAccountUpdate } from './accountEditing.js'
import { buildCounterpartyAccountBundle } from './counterpartyAccounts.js'
import { emptyAccountDraft } from './accountConfig.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createAccount, createOpeningMovements } from './ledgerCore.js'

const EDIT_CASES = [
  { type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, ownerName: 'سعيد', subAccountName: 'كاش بيننا', nextName: 'شركة سعيد', field: 'ownerName' },
  { type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, ownerName: 'أنا', subAccountName: 'خزنة البيت', nextName: 'خزنة المكتب', field: 'subAccountName' },
  { type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, ownerName: 'أنا', subAccountName: 'الجمهورية', nextName: 'حساب التجارة', field: 'subAccountName' },
  { type: ACCOUNT_TYPES.ASSET, valueKind: VALUE_KINDS.ASSET, ownerName: 'الشاحنة', subAccountName: 'أصل', nextName: 'الشاحنة الثانية', field: 'ownerName' },
  { type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT, ownerName: 'مقر العمل', subAccountName: 'مشروع', nextName: 'فرع طرابلس', field: 'ownerName' },
  { type: ACCOUNT_TYPES.EXPENSE, valueKind: VALUE_KINDS.EXPENSE, ownerName: 'وقود', subAccountName: 'مصروف', nextName: 'وقود الشاحنات', field: 'ownerName' },
]

describe('account editing', () => {
  it('allows deleting a completely unused standalone account', () => {
    const account = createAccount({
      id: 'unused-cash',
      ownerName: 'أنا',
      subAccountName: 'خزنة إضافية',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
    })

    expect(accountDeletionEligibility(account, { accounts: [account] })).toEqual({
      canDelete: true,
      accountIds: ['unused-cash'],
      blockers: [],
      isCounterpartyBundle: false,
    })
  })

  it('deletes a linked person only as one complete unused bundle', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })

    expect(accountDeletionEligibility(accounts[1], { accounts })).toMatchObject({
      canDelete: true,
      accountIds: expect.arrayContaining(accounts.map((account) => account.id)),
      isCounterpartyBundle: true,
    })
  })

  it('keeps the requested linked account in scope when the loaded account list is incomplete', () => {
    const account = { id: 'person-cash', counterpartyId: 'person-1', valueKind: VALUE_KINDS.RECEIVABLE }

    expect(accountDeletionEligibility(account, { accounts: [] })).toMatchObject({
      canDelete: true,
      accountIds: ['person-cash'],
      isCounterpartyBundle: true,
    })
  })

  it.each([
    ['movement', { movements: [{ id: 'draft', status: MOVEMENT_STATUSES.NEEDS_REVIEW, sourceAccountId: 'unused' }] }],
    ['attachment', { attachments: [{ id: 'file', accountId: 'unused' }] }],
    ['reconciliation', { reconciliations: [{ id: 'match', accountId: 'unused' }] }],
    ['recurring-rule', { recurringRules: [{ id: 'rule', template: { destinationAccountId: 'unused' } }] }],
  ])('blocks deletion when the account has a %s link', (blocker, context) => {
    const account = createAccount({
      id: 'unused',
      ownerName: 'حساب',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
    })

    expect(accountDeletionEligibility(account, { accounts: [account], ...context })).toMatchObject({
      canDelete: false,
      blockers: expect.arrayContaining([blocker]),
    })
  })

  it('blocks the full person bundle when only one linked balance was used', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const movement = { id: 'person-movement', status: MOVEMENT_STATUSES.POSTED, destinationAccountId: accounts[2].id }

    expect(accountDeletionEligibility(accounts[0], { accounts, movements: [movement] })).toMatchObject({
      canDelete: false,
      blockers: expect.arrayContaining(['movement']),
    })
  })

  it('blocks deletion when a generated project dimension is used', () => {
    const project = createAccount({
      id: 'unused-project',
      ownerName: 'مشروع',
      subAccountName: 'متابعة',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.PROJECT,
    })

    expect(accountDeletionEligibility(project, {
      accounts: [project],
      dimensions: [{ id: 'project-dimension', linkedAccountId: project.id }],
      recurringRules: [{ id: 'rule', template: { dimensionId: 'project-dimension' } }],
    })).toMatchObject({ canDelete: false, blockers: expect.arrayContaining(['recurring-rule']) })
  })

  it('removes an unused person bundle and its operational traces from legacy state', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const accountIds = accounts.map((account) => account.id)
    const result = deleteUnusedAccountFromLedgerState({
      accounts: [...accounts, createAccount({ id: 'kept', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH })],
      movements: [],
      attachments: [],
      reconciliations: [],
      recurringRules: [],
      dimensions: [{ id: 'linked', linkedAccountId: accountIds[0] }, { id: 'kept-dimension' }],
      ignoredExternalAccounts: [accountIds[1], 'kept'],
      auditEvents: [
        { id: 'created', details: { accountIds } },
        { id: 'kept-event', details: { accountId: 'kept' } },
      ],
      futureField: { preserved: true },
    }, accountIds[0])

    expect(result).toMatchObject({ ok: true, isCounterpartyBundle: true })
    expect(result.deletedAccountIds).toEqual(expect.arrayContaining(accountIds))
    expect(result.state.accounts.map((account) => account.id)).toEqual(['kept'])
    expect(result.state.dimensions.map((dimension) => dimension.id)).toEqual(['kept-dimension'])
    expect(result.state.ignoredExternalAccounts).toEqual(['kept'])
    expect(result.state.auditEvents.map((event) => event.id)).toEqual(['kept-event'])
    expect(result.state.futureField).toEqual({ preserved: true })
  })

  it('does not change legacy state when any deletion blocker exists', () => {
    const account = createAccount({ id: 'linked', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH })
    const state = { accounts: [account], movements: [], attachments: [{ id: 'file', accountId: account.id }] }

    const result = deleteUnusedAccountFromLedgerState(state, account.id)

    expect(result).toMatchObject({ ok: false, blockers: expect.arrayContaining(['attachment']) })
    expect(result.state).toBe(state)
  })

  it.each(EDIT_CASES)('edits the visible name of every active account kind', ({ type, valueKind, ownerName, subAccountName, nextName, field }) => {
    const account = {
      ...createAccount({
        id: `${type}-${valueKind}`,
        ownerName,
        subAccountName,
        type,
        valueKind,
        currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      }),
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const result = prepareAccountUpdate({
      accounts: [account],
      movements: [],
      accountId: account.id,
      draft: { ...account, [field]: nextName },
      updatedAt: '2026-08-20T10:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(result.account[field]).toBe(nextName)
    expect(result.changes).toEqual([expect.objectContaining({ key: 'name', before: expect.any(String), after: nextName })])
  })

  it('keeps name history understandable even when a person detail changes too', () => {
    const before = {
      ownerName: 'أحمد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    }
    const after = { ...before, ownerName: 'شركة أحمد', subAccountName: 'شيك بيننا' }

    expect(accountEditChanges(before, after)).toEqual([
      expect.objectContaining({ key: 'name', label: 'الاسم', before: 'أحمد', after: 'شركة أحمد' }),
      expect.objectContaining({ key: 'type', label: 'نوع الحساب', before: 'شخص أو جهة · كاش', after: 'شخص أو جهة · شيك' }),
    ])
  })

  it('rejects a rename that would create a duplicate account', () => {
    const first = createAccount({
      id: 'person-first',
      ownerName: 'سعيد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const second = createAccount({
      id: 'person-second',
      ownerName: 'أحمد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })

    const result = prepareAccountUpdate({
      accounts: [first, second],
      movements: [],
      accountId: second.id,
      draft: { ...second, ownerName: 'سعيد' },
    })

    expect(result).toMatchObject({ ok: false, reason: 'account-validation' })
    expect(result.errors.map((error) => error.field)).toContain('subAccountName')
  })

  it('locks type, person balance method, and currency after the first posted movement', () => {
    const account = createAccount({
      id: 'used-person',
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const movement = {
      id: 'posted-transfer',
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      destinationAccountId: account.id,
    }
    const result = prepareAccountUpdate({
      accounts: [account],
      movements: [movement],
      accountId: account.id,
      draft: {
        ...account,
        subAccountName: 'شيك بيننا',
        currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
      },
    })

    expect(result).toMatchObject({ ok: false, reason: 'account-structure-locked' })
  })

  it('rejects renaming a used account after its first posted movement', () => {
    const account = createAccount({
      id: 'used-person',
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingDinar: 100,
    })
    const movement = createOpeningMovements([account])[0]
    const result = prepareAccountUpdate({
      accounts: [account],
      movements: [movement],
      accountId: account.id,
      draft: { ...account, ownerName: 'شركة سيف' },
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'account-structure-locked',
      errors: [expect.objectContaining({ field: 'ownerName' })],
    })
  })

  it('locks structural fields when an account is linked to reconciliation, recurrence, or a dimension', () => {
    const accountId = 'linked-account'
    expect(accountStructureUsage(accountId, { reconciliations: [{ accountId }] }).locked).toBe(true)
    expect(accountStructureUsage(accountId, { recurringRules: [{ template: { sourceAccountId: accountId } }] }).locked).toBe(true)
    expect(accountStructureUsage(accountId, { dimensions: [{ linkedAccountId: accountId }] }).locked).toBe(true)
    expect(accountStructureUsage(accountId, { movements: [{ status: MOVEMENT_STATUSES.VOIDED, sourceAccountId: accountId }] }).locked).toBe(true)
    expect(accountStructureUsage(accountId, { movements: [{ status: MOVEMENT_STATUSES.NEEDS_REVIEW, sourceAccountId: accountId }] }).locked).toBe(false)
  })

  it('honors a database structure lock even when old movements are not loaded', () => {
    expect(accountStructureUsage({ id: 'database-locked', structureLocked: true, postedCount: 0 }, {
      movements: [],
      reconciliations: [],
      recurringRules: [],
      dimensions: [],
    })).toMatchObject({ locked: true, movement: false, databaseStructureLock: true })
    expect(accountStructureUsage({ id: 'database-counted', structureLocked: false, postedCount: 4 }, {
      movements: [],
    })).toMatchObject({ locked: true, movement: true })
  })

  it('keeps a linked project name editable until its first movement', () => {
    const project = createAccount({
      id: 'linked-project',
      ownerName: 'الشاحنة الأولى',
      subAccountName: 'مشروع',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.PROJECT,
    })
    const result = prepareAccountUpdate({
      accounts: [project],
      dimensions: [{ id: 'dimension-project', linkedAccountId: project.id }],
      movements: [],
      accountId: project.id,
      draft: { ...project, ownerName: 'شاحنة التوزيع' },
    })

    expect(result).toMatchObject({ ok: true, account: { ownerName: 'شاحنة التوزيع' } })
  })

  it('locks a project after a posted movement uses its generated tracking dimension', () => {
    const project = createAccount({
      id: 'truck-project',
      ownerName: 'الشاحنة',
      subAccountName: 'مشروع',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.PROJECT,
    })
    const usage = accountStructureUsage(project, {
      movements: [{
        id: 'truck-expense',
        status: MOVEMENT_STATUSES.POSTED,
        dimensionId: `dimension-account-${project.id}`,
      }],
    })

    expect(usage).toMatchObject({ movement: true, locked: true })
  })

  it('renames all four linked person balances atomically before their first movement', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const result = prepareAccountUpdate({
      accounts,
      movements: [],
      accountId: accounts[0].id,
      draft: { ...accounts[0], ownerName: 'شركة سعيد' },
      updatedAt: '2026-08-21T12:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(result.accountIds).toHaveLength(4)
    expect(new Set(result.accounts.map((account) => account.ownerName))).toEqual(new Set(['شركة سعيد']))
  })

  it('keeps linked person channel types immutable and freezes the whole person after any channel moves', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const structuralEdit = prepareAccountUpdate({
      accounts,
      movements: [],
      accountId: accounts[0].id,
      draft: { ...accounts[0], currencyKind: ACCOUNT_CURRENCY_KINDS.USD },
    })
    const movement = {
      id: 'person-first-movement',
      status: MOVEMENT_STATUSES.POSTED,
      destinationAccountId: accounts[1].id,
    }
    const renameAfterMovement = prepareAccountUpdate({
      accounts,
      movements: [movement],
      accountId: accounts[2].id,
      draft: { ...accounts[2], ownerName: 'اسم جديد' },
    })

    expect(structuralEdit).toMatchObject({ ok: false, reason: 'account-structure-locked' })
    expect(renameAfterMovement).toMatchObject({ ok: false, reason: 'account-structure-locked' })
    expect(accountStructureUsage(accounts[0], { accounts, movements: [movement] })).toMatchObject({
      movement: true,
      linkedBundle: true,
      locked: true,
    })
  })

  it('ignores the retired account separation flag after movements', () => {
    const account = createAccount({
      id: 'used-cash-scope',
      ownerName: 'أنا',
      subAccountName: 'خزنة خاصة',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      openingDinar: 500,
    })
    const result = prepareAccountUpdate({
      accounts: [account],
      movements: createOpeningMovements([account]),
      accountId: account.id,
      draft: { ...account, summaryScope: 'separate' },
    })

    expect(result).toMatchObject({
      ok: true,
      account: { summaryScope: 'included' },
      changes: [],
    })
  })
})
