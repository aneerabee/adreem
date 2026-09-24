import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore.js'
import { getMovementAccounts, rankMovementAccounts, rankMovementAccountsForRole, splitSourceAccountsByBalance } from './movementAccounts.js'

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
  it('offers USD cash, bank, and people as portfolio funding sources', () => {
    const accounts = [
      account('cash-usd', VALUE_KINDS.CASH, { currencyKind: CURRENCIES.USD }),
      account('bank-multi', VALUE_KINDS.BANK, { currencyKind: 'multi' }),
      account('cash-lyd', VALUE_KINDS.CASH, { currencyKind: CURRENCIES.DINAR }),
      account('person-usd', VALUE_KINDS.RECEIVABLE, { currencyKind: CURRENCIES.USD }),
    ]

    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.INVESTMENT_DEPOSIT, 'source', { currency: CURRENCIES.USD }).map((item) => item.id)).toEqual(['cash-usd', 'bank-multi', 'person-usd'])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL, 'destination', { currency: CURRENCIES.USD }).map((item) => item.id)).toEqual(['cash-usd', 'bank-multi'])
  })

  it('offers a source only when it can actually pay in the movement currency', () => {
    const accounts = [
      account('cash-empty', VALUE_KINDS.CASH, { ownerName: 'أنا' }),
      account('bank-funded', VALUE_KINDS.BANK, { ownerName: 'أنا', subAccountName: 'مصرف' }),
      account('cash-multi', VALUE_KINDS.CASH, { ownerName: 'أنا', currencyKind: 'multi' }),
      account('person-owes-me', VALUE_KINDS.RECEIVABLE, { ownerName: 'سالم' }),
      account('person-i-owe', VALUE_KINDS.RECEIVABLE, { ownerName: 'خالد' }),
      account('person-settled', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد' }),
    ]
    const balances = new Map([
      ['cash-empty', { dinar: 0, usd: 0 }],
      ['bank-funded', { dinar: 500, usd: 0 }],
      ['cash-multi', { dinar: -1, usd: 300 }],
      ['person-owes-me', { dinar: 1200, usd: 0 }],
      ['person-i-owe', { dinar: -800, usd: 0 }],
      ['person-settled', { dinar: 0, usd: 0 }],
    ])

    const dinar = splitSourceAccountsByBalance(accounts, balances, CURRENCIES.DINAR)
    expect(dinar.available.map((item) => item.id)).toEqual(['bank-funded', 'person-owes-me', 'person-i-owe'])
    expect(dinar.searchOnly.map((item) => item.id)).toEqual(['person-settled'])

    const usd = splitSourceAccountsByBalance(accounts, balances, CURRENCIES.USD)
    expect(usd.available.map((item) => item.id)).toEqual(['cash-multi'])
    expect(usd.searchOnly.map((item) => item.id)).toEqual(['person-owes-me', 'person-i-owe', 'person-settled'])
  })

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

  it('keeps closed accounts out of choices and exposes only relevant closed references when requested', () => {
    const accounts = [
      account('active-lyd', VALUE_KINDS.CASH),
      account('closed-lyd', VALUE_KINDS.CASH, { status: ACCOUNT_STATUSES.INACTIVE }),
      account('closed-usd', VALUE_KINDS.CASH, { status: ACCOUNT_STATUSES.INACTIVE, currencyKind: CURRENCIES.USD }),
    ]

    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.EXPENSE, 'source', { currency: CURRENCIES.DINAR }).map((item) => item.id)).toEqual(['active-lyd'])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.EXPENSE, 'source', { currency: CURRENCIES.DINAR }, { includeInactive: true }).map((item) => item.id)).toEqual(['active-lyd', 'closed-lyd'])
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

  it('matches every automatic person balance to the correct money account', () => {
    const accounts = [
      account('own-cash-lyd', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'الخزنة', currencyKind: CURRENCIES.DINAR }),
      account('own-bank-lyd', VALUE_KINDS.BANK, { ownerName: 'أنا', subAccountName: 'الجمهورية', currencyKind: CURRENCIES.DINAR }),
      account('own-cash-usd', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة دولار', currencyKind: CURRENCIES.USD }),
      account('person-cash-lyd', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد', subAccountName: 'كاش بيننا', counterpartyKind: 'cash-dinar', currencyKind: CURRENCIES.DINAR }),
      account('person-cheque-lyd', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد', subAccountName: 'شيك بيننا', counterpartyKind: 'cheque-dinar', currencyKind: CURRENCIES.DINAR }),
      account('person-cash-usd', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد', subAccountName: 'دولار بيننا', counterpartyKind: 'cash-usd', currencyKind: CURRENCIES.USD }),
    ]

    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'own-cash-lyd',
    }).map((item) => item.id)).toEqual(expect.arrayContaining(['person-cash-lyd']))
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'own-cash-lyd',
    }).map((item) => item.id)).not.toEqual(expect.arrayContaining(['person-cheque-lyd', 'person-cash-usd']))
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'own-bank-lyd',
    }).map((item) => item.id)).toEqual(expect.arrayContaining(['person-cheque-lyd']))
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'own-bank-lyd',
    }).map((item) => item.id)).not.toEqual(expect.arrayContaining(['person-cash-lyd', 'person-cash-usd']))
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.USD,
      sourceAccountId: 'own-cash-usd',
    }).map((item) => item.id)).toEqual(expect.arrayContaining(['person-cash-usd']))
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.USD,
      sourceAccountId: 'own-cash-usd',
    }).map((item) => item.id)).not.toEqual(expect.arrayContaining(['person-cash-lyd', 'person-cheque-lyd']))
  })

  it('shows a USD bank destination when receiving USD from a person', () => {
    const accounts = [
      account('person-usd', VALUE_KINDS.RECEIVABLE, { ownerName: 'سعيد', subAccountName: 'دولار بيننا', counterpartyKind: 'cash-usd', currencyKind: CURRENCIES.USD }),
      account('qnb-usd', VALUE_KINDS.BANK, { ownerName: 'أنا', subAccountName: 'QNB', currencyKind: CURRENCIES.USD }),
      account('qnb-lyd', VALUE_KINDS.BANK, { ownerName: 'أنا', subAccountName: 'QNB', currencyKind: CURRENCIES.DINAR }),
      account('cash-usd', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة USD', currencyKind: CURRENCIES.USD }),
    ]

    const destinations = getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'destination', {
      currency: CURRENCIES.USD,
      sourceAccountId: 'person-usd',
    }).map((item) => item.id)

    expect(destinations).toEqual(expect.arrayContaining(['qnb-usd', 'cash-usd']))
    expect(destinations).not.toContain('qnb-lyd')
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

  it('ranks TRY and EUR choices by their own balances', () => {
    const accounts = [
      account('large-try', VALUE_KINDS.CASH, { currencyKind: 'multi' }),
      account('large-eur', VALUE_KINDS.CASH, { currencyKind: 'multi' }),
    ]
    const balances = new Map([
      ['large-try', { dinar: 0, usd: 0, try: 90_000, eur: 4 }],
      ['large-eur', { dinar: 0, usd: 0, try: 10, eur: 700 }],
    ])

    expect(rankMovementAccounts(accounts, balances, '', CURRENCIES.TRY).map((item) => item.id)).toEqual(['large-try', 'large-eur'])
    expect(rankMovementAccounts(accounts, balances, '', CURRENCIES.EUR).map((item) => item.id)).toEqual(['large-eur', 'large-try'])
  })

  it('puts matching people first when money leaves an own account', () => {
    const ownCash = account('own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا' })
    const accounts = [
      account('other-own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة ثانية' }),
      account('person-a', VALUE_KINDS.RECEIVABLE, { ownerName: 'أحمد', subAccountName: 'كاش بيننا' }),
      account('person-b', VALUE_KINDS.RECEIVABLE, { ownerName: 'سالم', subAccountName: 'كاش بيننا' }),
    ]

    expect(rankMovementAccountsForRole(accounts, new Map(), '', CURRENCIES.DINAR, {
      movementType: MOVEMENT_TYPES.TRANSFER,
      role: 'destination',
      counterpartAccount: ownCash,
    }).map((item) => item.id)).toEqual(['person-a', 'person-b', 'other-own-cash'])
  })

  it('keeps direct search results exact even when destination preferences differ', () => {
    const ownCash = account('own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا' })
    const accounts = [
      account('other-own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة ثانية' }),
      account('person-a', VALUE_KINDS.RECEIVABLE, { ownerName: 'أحمد', subAccountName: 'كاش بيننا' }),
    ]

    expect(rankMovementAccountsForRole(accounts, new Map(), 'خزنة', CURRENCIES.DINAR, {
      movementType: MOVEMENT_TYPES.TRANSFER,
      role: 'destination',
      counterpartAccount: ownCash,
    }).map((item) => item.id)).toEqual(['other-own-cash'])
  })

  it('does not apply transfer destination preferences to exchange movements', () => {
    const ownCash = account('own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا' })
    const accounts = [
      account('other-own-cash', VALUE_KINDS.CASH, { ownerName: 'أنا', subAccountName: 'خزنة ثانية' }),
      account('person-a', VALUE_KINDS.RECEIVABLE, { ownerName: 'أحمد', subAccountName: 'كاش بيننا' }),
    ]

    expect(rankMovementAccountsForRole(accounts, new Map(), '', CURRENCIES.DINAR, {
      movementType: MOVEMENT_TYPES.USD_SALE,
      role: 'destination',
      counterpartAccount: ownCash,
    }).map((item) => item.id)).toEqual(['other-own-cash', 'person-a'])
  })
})
