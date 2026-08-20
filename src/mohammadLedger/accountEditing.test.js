import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { accountEditChanges, prepareAccountUpdate } from './accountEditing.js'
import { createAccount } from './ledgerCore.js'

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
})
