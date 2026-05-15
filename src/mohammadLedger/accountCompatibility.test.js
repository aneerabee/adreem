import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import {
  accountSupportsTransferCurrency,
  areTransferAccountsCompatible,
  sameLogicalAccount,
  transferCompatibilityMessage,
} from './accountCompatibility.js'
import { CURRENCIES } from './ledgerCore.js'

describe('mohammad account compatibility', () => {
  it('does not treat different blank-name accounts as the same logical account', () => {
    expect(sameLogicalAccount({ id: 'a' }, { id: 'b' })).toBe(false)
  })

  it('treats missing accounts as incompatible', () => {
    const cash = { id: 'cash', subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }

    expect(accountSupportsTransferCurrency(null, CURRENCIES.DINAR)).toBe(false)
    expect(areTransferAccountsCompatible(cash, null, CURRENCIES.DINAR)).toBe(false)
    expect(transferCompatibilityMessage(cash, null, CURRENCIES.DINAR)).toBe('يجب اختيار حساب مصدر ووجهة صحيحين.')
  })

  it('allows dinar and dollar on cash and bank accounts while keeping transfer kind checks', () => {
    const cash = { id: 'cash', type: ACCOUNT_TYPES.CASH, subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }
    const anotherCash = { id: 'cash-2', type: ACCOUNT_TYPES.CASH, subAccountName: 'خزنة', valueKind: VALUE_KINDS.CASH }
    const bank = { id: 'bank', type: ACCOUNT_TYPES.BANK, subAccountName: 'الجمهورية', valueKind: VALUE_KINDS.BANK }

    expect(accountSupportsTransferCurrency(cash, CURRENCIES.USD)).toBe(true)
    expect(accountSupportsTransferCurrency(bank, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(cash, anotherCash, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(cash, bank, CURRENCIES.USD)).toBe(false)
  })
})
