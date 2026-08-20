import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { accountEditChanges, accountStructureUsage, prepareAccountUpdate } from './accountEditing.js'
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

  it('still allows renaming a used account without changing its accounting identity', () => {
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

    expect(result).toMatchObject({ ok: true, account: { ownerName: 'شركة سيف' } })
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
    })).toMatchObject({ locked: true })
    expect(accountStructureUsage({ id: 'database-counted', structureLocked: false, postedCount: 4 }, {
      movements: [],
    })).toMatchObject({ locked: true })
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
})
