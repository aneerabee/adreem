import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import { ACCOUNT_SUMMARY_SCOPES } from '../../src/ledger/ledgerScope.js'
import { buildTelegramBalanceView, TELEGRAM_BALANCE_FILTERS } from './balanceView.js'

function bucket(id, valueKind, dinar = 0, usd = 0, summaryScope) {
  return {
    account: {
      id,
      valueKind,
      currencyKind: usd ? 'USD' : 'LYD',
      status: ACCOUNT_STATUSES.ACTIVE,
      ...(summaryScope ? { summaryScope } : {}),
    },
    dinar,
    usd,
  }
}

describe('Telegram balance view', () => {
  const balances = [
    bucket('cash', VALUE_KINDS.CASH, 10_000),
    bucket('private', VALUE_KINDS.CASH, 90_000, 0, ACCOUNT_SUMMARY_SCOPES.SEPARATE),
    bucket('collect', VALUE_KINDS.RECEIVABLE, 2_000),
    bucket('pay', VALUE_KINDS.RECEIVABLE, -750),
    bucket('asset', VALUE_KINDS.ASSET, 50_000),
    bucket('expense', VALUE_KINDS.EXPENSE, 300),
  ]

  it('keeps every active account in its normal balance group', () => {
    const result = buildTelegramBalanceView(balances, TELEGRAM_BALANCE_FILTERS.ALL)

    expect(result.filteredBuckets.map((item) => item.account.id)).toEqual(['private', 'asset', 'cash', 'collect', 'pay', 'expense'])
    expect(result.summary).toEqual({
      money: { dinar: 100_000, usd: 0 },
      collect: { dinar: 2_000, usd: 0 },
      pay: { dinar: 750, usd: 0 },
    })
  })

  it('does not use accounts as separate records', () => {
    const result = buildTelegramBalanceView(balances, TELEGRAM_BALANCE_FILTERS.SEPARATE)

    expect(result.filteredBuckets).toEqual([])
  })
})
