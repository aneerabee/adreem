import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { accountEditChanges, accountStructureUsage, prepareAccountUpdate } from './accountEditing.js'
import { buildCounterpartyAccountBundle } from './counterpartyAccounts.js'
import { emptyAccountDraft } from './accountConfig.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createAccount, createOpeningMovements } from './ledgerCore.js'
import { ACCOUNT_SUMMARY_SCOPES } from './ledgerScope.js'

const EDIT_CASES = [
  { type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE, ownerName: 'سعيد', subAccountName: 'كاش بيننا', nextName: 'شركة سعيد', field: 'ownerName' },
  { type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, ownerName: 'أنا', subAccountName: 'خزنة البيت', nextName: 'خزنة المكتب', field: 'subAccountName' },
  { type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, ownerName: 'أنا', subAccountName: 'الجمهورية', nextName: 'حساب التجارة', field: 'subAccountName' },
  { type: ACCOUNT_TYPES.ASSET, valueKind: VALUE_KINDS.ASSET, ownerName: 'الشاحنة', subAccountName: 'أصل', nextName: 'الشاحنة الثانية', field: 'ownerName' },
  { type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT, ownerName: 'مقر العمل', subAccountName: 'مشروع', nextName: 'فرع طرابلس', field: 'ownerName' },
  { type: ACCOUNT_TYPES.EXPENSE, valueKind: VALUE_KINDS.EXPENSE, ownerName: 'وقود', subAccountName: 'مصروف', nextName: 'وقود الشاحنات', field: 'ownerName' },
]

describe('account editing', () => {
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
      ownerName: 'محمد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    }
    const after = { ...before, ownerName: 'شركة محمد', subAccountName: 'شيك بيننا' }

    expect(accountEditChanges(before, after)).toEqual([
      expect.objectContaining({ key: 'name', label: 'الاسم', before: 'محمد', after: 'شركة محمد' }),
      expect.objectContaining({ key: 'type', label: 'نوع الحساب', before: 'شخص أو جهة · كاش بيننا', after: 'شخص أو جهة · شيك بيننا' }),
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
      ownerName: 'محمد',
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

  it('renames all three linked person balances atomically before their first movement', () => {
    const accounts = buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'سعيد' })
    const result = prepareAccountUpdate({
      accounts,
      movements: [],
      accountId: accounts[0].id,
      draft: { ...accounts[0], ownerName: 'شركة سعيد' },
      updatedAt: '2026-08-21T12:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(result.accountIds).toHaveLength(3)
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

  it('allows changing only the summary scope after movements and records the change clearly', () => {
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
      draft: { ...account, summaryScope: ACCOUNT_SUMMARY_SCOPES.SEPARATE },
    })

    expect(result).toMatchObject({
      ok: true,
      account: { summaryScope: ACCOUNT_SUMMARY_SCOPES.SEPARATE },
      changes: [expect.objectContaining({ key: 'summaryScope', before: 'داخل الصافي', after: 'حساب منفصل' })],
    })
  })
})
