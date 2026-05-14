import { describe, expect, it } from 'vitest'
import { VALUE_KINDS } from './accountCatalog.js'
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
})
