import { describe, expect, it } from 'vitest'
import { VALUE_KINDS } from './accountCatalog.js'
import {
  ACCOUNT_SUMMARY_SCOPES,
  accountSummaryScope,
  buildNetPosition,
  convertNetPosition,
  splitBalanceRowsByScope,
} from './ledgerScope.js'

function bucket(id, valueKind, dinar = 0, usd = 0, summaryScope) {
  return {
    account: { id, valueKind, ...(summaryScope ? { summaryScope } : {}) },
    dinar,
    usd,
  }
}

describe('ADREEM account summary scope', () => {
  it('includes money and people by default while keeping assets separate', () => {
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.CASH })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.BANK })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.RECEIVABLE })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.ASSET })).toBe(ACCOUNT_SUMMARY_SCOPES.SEPARATE)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.EXPENSE })).toBe(null)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.PROJECT })).toBe(null)
  })

  it('splits explicitly separate accounts without hiding or changing their balances', () => {
    const rows = [
      bucket('cash', VALUE_KINDS.CASH, 1_000),
      bucket('private-cash', VALUE_KINDS.CASH, 500, 0, ACCOUNT_SUMMARY_SCOPES.SEPARATE),
      bucket('asset', VALUE_KINDS.ASSET, 4_000),
      bucket('fuel', VALUE_KINDS.EXPENSE, 300),
    ]

    const result = splitBalanceRowsByScope(rows)

    expect(result.included.map((row) => row.account.id)).toEqual(['cash'])
    expect(result.separate.map((row) => row.account.id)).toEqual(['private-cash', 'asset'])
    expect(result.ineligible.map((row) => row.account.id)).toEqual(['fuel'])
  })

  it('builds the raw net from included accounts only and keeps its audit contributions', () => {
    const position = buildNetPosition([
      bucket('cash', VALUE_KINDS.CASH, 10_000),
      bucket('bank', VALUE_KINDS.BANK, 2_000),
      bucket('friend-lyd', VALUE_KINDS.RECEIVABLE, -1_500),
      bucket('friend-usd', VALUE_KINDS.RECEIVABLE, 0, 100),
      bucket('private', VALUE_KINDS.CASH, 50_000, 0, ACCOUNT_SUMMARY_SCOPES.SEPARATE),
      bucket('asset', VALUE_KINDS.ASSET, 90_000),
      bucket('expense', VALUE_KINDS.EXPENSE, 800),
    ])

    expect(position).toMatchObject({ dinar: 10_500, usd: 100, accountCount: 4 })
    expect(position.contributions.map((item) => item.accountId)).toEqual(['cash', 'bank', 'friend-lyd', 'friend-usd'])
  })

  it('converts the net in both directions only with a valid positive rate', () => {
    const position = { dinar: 10_500, usd: 100 }

    expect(convertNetPosition(position, 7.5, 'LYD')).toEqual({ ok: true, currency: 'LYD', amount: 11_250, rate: 7.5 })
    expect(convertNetPosition(position, 7.5, 'USD')).toEqual({ ok: true, currency: 'USD', amount: 1_500, rate: 7.5 })
    expect(convertNetPosition(position, 0, 'LYD')).toMatchObject({ ok: false })
    expect(convertNetPosition(position, Number.NaN, 'USD')).toMatchObject({ ok: false })
  })
})
