import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { COUNTERPARTY_ACCOUNT_KINDS } from './accountConfig.js'
import { accountDisplayGroupKey, accountsWithLedgerActivity, groupAccountsForDisplay, groupBalanceRowsForDisplay } from './accountDisplayGroups.js'

const activePerson = {
  ownerName: 'سعيد',
  type: ACCOUNT_TYPES.PERSON,
  valueKind: VALUE_KINDS.RECEIVABLE,
  status: ACCOUNT_STATUSES.ACTIVE,
  counterpartyId: 'person:saeed',
}

describe('account display groups', () => {
  it('shows one person while preserving every financial channel', () => {
    const accounts = [
      { ...activePerson, id: 'cash', subAccountName: 'كاش بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR },
      { ...activePerson, id: 'cheque', subAccountName: 'شيك بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR },
      { ...activePerson, id: 'usd', subAccountName: 'دولار بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.USD, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD },
    ]

    const groups = groupAccountsForDisplay(accounts)

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('سعيد')
    expect(groups[0].accounts.map((account) => account.id)).toEqual(['cash', 'cheque', 'usd'])
  })

  it('groups currency channels for the same cash or bank location', () => {
    const accounts = [
      { id: 'safe-lyd', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR },
      { id: 'safe-eur', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.EUR },
      { id: 'bank-eur', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, currencyKind: ACCOUNT_CURRENCY_KINDS.EUR },
    ]

    const groups = groupAccountsForDisplay(accounts)

    expect(groups).toHaveLength(2)
    expect(groups[0].accounts.map((account) => account.id)).toEqual(['safe-lyd', 'safe-eur'])
    expect(accountDisplayGroupKey(accounts[0])).not.toBe(accountDisplayGroupKey(accounts[2]))
  })

  it('removes only a repeated record id and keeps distinct channels', () => {
    const cash = { ...activePerson, id: 'cash', subAccountName: 'كاش بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR }
    const cheque = { ...activePerson, id: 'cheque', subAccountName: 'شيك بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR }

    expect(groupAccountsForDisplay([cash, cash, cheque])[0].accounts).toEqual([cash, cheque])
  })

  it('keeps financial channels in a stable human order', () => {
    const accounts = [
      { ...activePerson, id: 'eur', subAccountName: 'EUR بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.EUR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_EUR },
      { ...activePerson, id: 'cheque', subAccountName: 'شيك بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR },
      { ...activePerson, id: 'cash', subAccountName: 'كاش بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR },
      { ...activePerson, id: 'usd', subAccountName: 'دولار بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.USD, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD },
    ]

    expect(groupAccountsForDisplay(accounts)[0].accounts.map((account) => account.id)).toEqual(['cash', 'cheque', 'usd', 'eur'])
  })

  it('groups balance rows without combining the stored currency values', () => {
    const lyd = { id: 'safe-lyd', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }
    const eur = { ...lyd, id: 'safe-eur', currencyKind: ACCOUNT_CURRENCY_KINDS.EUR }
    const tryAccount = { ...lyd, id: 'safe-try', currencyKind: ACCOUNT_CURRENCY_KINDS.TRY }
    const groups = groupBalanceRowsForDisplay([
      { account: eur, dinar: 0, usd: 0, try: 0, eur: 50 },
      { account: tryAccount, dinar: 0, usd: 0, try: 75, eur: 0 },
      { account: lyd, dinar: 100, usd: 0, try: 0, eur: 0 },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((row) => [row.account.id, row.dinar, row.try, row.eur])).toEqual([
      ['safe-lyd', 100, 0, 0],
      ['safe-try', 0, 75, 0],
      ['safe-eur', 0, 0, 50],
    ])
  })

  it('lists only accounts that moved money or hold a balance, plus the current choice', () => {
    const accounts = [
      { ...activePerson, id: 'used' },
      { ...activePerson, id: 'balance-only' },
      { ...activePerson, id: 'empty' },
      { ...activePerson, id: 'selected-empty' },
      { ...activePerson, id: 'destination' },
    ]
    const balances = new Map([['balance-only', { dinar: 0, usd: 0, try: 250, eur: 0 }], ['empty', { dinar: 0, usd: 0, try: 0, eur: 0 }]])
    const movements = [{ id: 'm1', sourceAccountId: 'used', destinationAccountId: 'destination' }]

    expect(accountsWithLedgerActivity(accounts, balances, movements, 'selected-empty').map((account) => account.id))
      .toEqual(['used', 'balance-only', 'selected-empty', 'destination'])
  })
})
