import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore.js'
import { getMovementAccounts, rankMovementAccounts } from './movementAccounts.js'

function account(id, valueKind, overrides = {}) {
  return {
    id,
    ownerName: overrides.ownerName || id,
    subAccountName: overrides.subAccountName || 'كاش',
    valueKind,
    currencyKind: overrides.currencyKind || CURRENCIES.DINAR,
    status: overrides.status || ACCOUNT_STATUSES.ACTIVE,
    ...overrides,
  }
}

describe('shared movement account choices', () => {
  it('ranks arbitrary own money accounts before people without fixed ids', () => {
    const accounts = [
      account('person-large', VALUE_KINDS.RECEIVABLE),
      account('vault-new-user', VALUE_KINDS.CASH, { ownerName: 'أنا' }),
      account('bank-new-user', VALUE_KINDS.BANK, { ownerName: 'أنا', subAccountName: 'مصرف' }),
    ]
    const balances = new Map([
      ['person-large', { dinar: 90000, usd: 0 }],
      ['vault-new-user', { dinar: 1000, usd: 0 }],
      ['bank-new-user', { dinar: 5000, usd: 0 }],
    ])

    expect(rankMovementAccounts(accounts, balances).map((item) => item.id)).toEqual([
      'bank-new-user',
      'vault-new-user',
      'person-large',
    ])
  })

  it('finds multi-word Arabic names despite extra spaces and common alef forms', () => {
    const accounts = [
      account('company', VALUE_KINDS.RECEIVABLE, { ownerName: 'شركة الأمان الجديدة', subAccountName: 'كاش بيننا' }),
      account('other', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد' }),
    ]

    expect(rankMovementAccounts(accounts, new Map(), 'شركة   الامان').map((item) => item.id)).toEqual(['company'])
  })

  it('never offers assets, projects, or expense categories as money endpoints', () => {
    const accounts = [
      account('cash', VALUE_KINDS.CASH),
      account('asset', VALUE_KINDS.ASSET),
      account('project', VALUE_KINDS.PROJECT),
      account('expense', VALUE_KINDS.EXPENSE),
    ]

    const result = getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.EXPENSE, 'source', { currency: CURRENCIES.DINAR })

    expect(result.map((item) => item.id)).toEqual(['cash'])
  })

  it('filters transfer destinations to the same kind and currency', () => {
    const accounts = [
      account('cash-lyd-a', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة 1' }),
      account('cash-lyd-b', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة 2' }),
      account('cash-usd', VALUE_KINDS.CASH, { currencyKind: CURRENCIES.USD }),
      account('bank-lyd', VALUE_KINDS.BANK, { subAccountName: 'مصرف' }),
    ]

    const result = getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash-lyd-a',
    })

    expect(result.map((item) => item.id)).toEqual(['cash-lyd-b'])
  })

  it('offers only cash-to-bank for deposits and bank-to-cash for withdrawals', () => {
    const accounts = [
      account('cash', VALUE_KINDS.CASH),
      account('bank', VALUE_KINDS.BANK),
      account('person', VALUE_KINDS.RECEIVABLE),
    ]

    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CASH_DEPOSIT, 'source', { currency: CURRENCIES.DINAR }).map((item) => item.id)).toEqual(['cash'])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CASH_DEPOSIT, 'destination', { currency: CURRENCIES.DINAR }).map((item) => item.id)).toEqual(['bank'])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CASH_WITHDRAWAL, 'source', { currency: CURRENCIES.DINAR }).map((item) => item.id)).toEqual(['bank'])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CASH_WITHDRAWAL, 'destination', { currency: CURRENCIES.DINAR }).map((item) => item.id)).toEqual(['cash'])
  })

  it('ranks accounts by the currency of the current movement side', () => {
    const accounts = [
      account('large-dinar', VALUE_KINDS.CASH, { currencyKind: 'multi' }),
      account('large-usd', VALUE_KINDS.CASH, { currencyKind: 'multi' }),
    ]
    const balances = new Map([
      ['large-dinar', { dinar: 100_000, usd: 5 }],
      ['large-usd', { dinar: 100, usd: 500 }],
    ])

    expect(rankMovementAccounts(accounts, balances, '', CURRENCIES.USD).map((item) => item.id)).toEqual(['large-usd', 'large-dinar'])
    expect(rankMovementAccounts(accounts, balances, '', CURRENCIES.DINAR).map((item) => item.id)).toEqual(['large-dinar', 'large-usd'])
  })
})
