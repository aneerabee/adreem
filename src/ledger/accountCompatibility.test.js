import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import {
  accountSupportsTransferCurrency,
  areTransferAccountsCompatible,
  sameLogicalAccount,
  transferCompatibilityMessage,
} from './accountCompatibility.js'
import { CURRENCIES } from './ledgerCore.js'

describe('adreem account compatibility', () => {
  it('does not treat different blank-name accounts as the same logical account', () => {
    expect(sameLogicalAccount({ id: 'a' }, { id: 'b' })).toBe(false)
  })

  it('treats missing accounts as incompatible', () => {
    const cash = { id: 'cash', subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }

    expect(accountSupportsTransferCurrency(null, CURRENCIES.DINAR)).toBe(false)
    expect(areTransferAccountsCompatible(cash, null, CURRENCIES.DINAR)).toBe(false)
    expect(transferCompatibilityMessage(cash, null, CURRENCIES.DINAR)).toBe('يجب اختيار حساب مصدر ووجهة صحيحين.')
  })

  it('enforces currency and transfer kind checks together', () => {
    const cash = { id: 'cash', type: ACCOUNT_TYPES.CASH, subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }
    const usdCash = { id: 'cash-usd', type: ACCOUNT_TYPES.CASH, subAccountName: 'خزنة دولار', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }
    const multiCash = { id: 'cash-2', type: ACCOUNT_TYPES.CASH, subAccountName: 'خزنة', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.MULTI }
    const bank = { id: 'bank', type: ACCOUNT_TYPES.BANK, subAccountName: 'الجمهورية', valueKind: VALUE_KINDS.BANK }

    expect(accountSupportsTransferCurrency(cash, CURRENCIES.USD)).toBe(false)
    expect(accountSupportsTransferCurrency(usdCash, CURRENCIES.USD)).toBe(true)
    expect(accountSupportsTransferCurrency(multiCash, CURRENCIES.USD)).toBe(true)
    expect(accountSupportsTransferCurrency(multiCash, CURRENCIES.DINAR)).toBe(true)
    expect(accountSupportsTransferCurrency(bank, CURRENCIES.USD)).toBe(false)
    expect(areTransferAccountsCompatible(usdCash, multiCash, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(cash, bank, CURRENCIES.DINAR)).toBe(false)
  })

  it('does not treat same owner and detail with different currencies as the same logical account', () => {
    const dinar = { id: 'saeed-lyd', ownerName: 'سعيد', subAccountName: 'نقدي معه', valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }
    const usd = { id: 'saeed-usd', ownerName: 'سعيد', subAccountName: 'نقدي معه', valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }

    expect(sameLogicalAccount(dinar, usd)).toBe(false)
  })

  it('treats legacy "مصرفي بيننا" and new "شيك بيننا" as the same route', () => {
    const legacy = { id: 'old-bank-person', ownerName: 'سعيد', subAccountName: 'مصرفي بيننا', valueKind: VALUE_KINDS.RECEIVABLE }
    const next = { id: 'new-bank-person', ownerName: 'سعيد', subAccountName: 'شيك بيننا', valueKind: VALUE_KINDS.RECEIVABLE }

    expect(sameLogicalAccount(legacy, next)).toBe(true)
    expect(areTransferAccountsCompatible(legacy, next, CURRENCIES.DINAR)).toBe(true)
  })

  it('allows a foreign-currency person balance to move to cash or bank in the same currency', () => {
    const personUsd = { id: 'person-usd', ownerName: 'سعيد', subAccountName: 'دولار بيننا', valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: CURRENCIES.USD }
    const cashUsd = { id: 'cash-usd', ownerName: 'أنا', subAccountName: 'خزنة USD', valueKind: VALUE_KINDS.CASH, currencyKind: CURRENCIES.USD }
    const qnbUsd = { id: 'qnb-usd', ownerName: 'أنا', subAccountName: 'QNB', valueKind: VALUE_KINDS.BANK, currencyKind: CURRENCIES.USD }
    const qnbDinar = { id: 'qnb-lyd', ownerName: 'أنا', subAccountName: 'QNB', valueKind: VALUE_KINDS.BANK, currencyKind: CURRENCIES.DINAR }

    expect(areTransferAccountsCompatible(personUsd, cashUsd, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(personUsd, qnbUsd, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(qnbUsd, personUsd, CURRENCIES.USD)).toBe(true)
    expect(areTransferAccountsCompatible(personUsd, qnbDinar, CURRENCIES.USD)).toBe(false)
    expect(areTransferAccountsCompatible(cashUsd, qnbUsd, CURRENCIES.USD)).toBe(false)
  })
})
