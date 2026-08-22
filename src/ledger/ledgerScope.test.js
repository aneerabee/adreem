import { describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog.js'
import {
  ACCOUNT_SUMMARY_SCOPES,
  accountSummaryScope,
  buildNetPosition,
  convertNetPosition,
  filterNetContributions,
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
  it('includes every real balance account by default', () => {
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.CASH })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.BANK })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.RECEIVABLE })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.ASSET })).toBe(ACCOUNT_SUMMARY_SCOPES.INCLUDED)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.EXPENSE })).toBe(null)
    expect(accountSummaryScope({ valueKind: VALUE_KINDS.PROJECT })).toBe(null)
  })

  it('ignores the retired account separation flag without changing balances', () => {
    const rows = [
      bucket('cash', VALUE_KINDS.CASH, 1_000),
      bucket('private-cash', VALUE_KINDS.CASH, 500, 0, ACCOUNT_SUMMARY_SCOPES.SEPARATE),
      bucket('asset', VALUE_KINDS.ASSET, 4_000),
      bucket('fuel', VALUE_KINDS.EXPENSE, 300),
    ]

    const result = splitBalanceRowsByScope(rows)

    expect(result.included.map((row) => row.account.id)).toEqual(['cash', 'private-cash', 'asset'])
    expect(result.separate).toEqual([])
    expect(result.ineligible.map((row) => row.account.id)).toEqual(['fuel'])
  })

  it('builds the raw net from all eligible accounts and keeps its audit contributions', () => {
    const position = buildNetPosition([
      bucket('cash', VALUE_KINDS.CASH, 10_000),
      bucket('bank', VALUE_KINDS.BANK, 2_000),
      bucket('friend-lyd', VALUE_KINDS.RECEIVABLE, -1_500),
      bucket('friend-usd', VALUE_KINDS.RECEIVABLE, 0, 100),
      bucket('private', VALUE_KINDS.CASH, 50_000, 0, ACCOUNT_SUMMARY_SCOPES.SEPARATE),
      bucket('asset', VALUE_KINDS.ASSET, 90_000),
      bucket('expense', VALUE_KINDS.EXPENSE, 800),
    ])

    expect(position).toMatchObject({ dinar: 150_500, usd: 100, accountCount: 6 })
    expect(position.contributions.map((item) => item.accountId)).toEqual(['cash', 'bank', 'friend-lyd', 'friend-usd', 'private', 'asset'])
  })

  it('temporarily excludes several accounts without changing the source rows', () => {
    const rows = [
      bucket('cash', VALUE_KINDS.CASH, 10_000),
      bucket('bank', VALUE_KINDS.BANK, 2_000),
      bucket('friend', VALUE_KINDS.RECEIVABLE, -1_500, 100),
      bucket('asset', VALUE_KINDS.ASSET, 90_000),
    ]

    const position = buildNetPosition(rows, ['bank', 'asset'])

    expect(position).toMatchObject({ dinar: 8_500, usd: 100, accountCount: 2 })
    expect(position.contributions.map((item) => item.accountId)).toEqual(['cash', 'friend'])
    expect(rows).toHaveLength(4)
  })

  it('handles sets, duplicate ids, unknown ids, and excluding every account', () => {
    const rows = [
      bucket('cash', VALUE_KINDS.CASH, 10_000),
      bucket('bank', VALUE_KINDS.BANK, 2_000),
    ]

    expect(buildNetPosition(rows, new Set(['cash', 'missing']))).toMatchObject({
      dinar: 2_000,
      usd: 0,
      accountCount: 1,
    })
    expect(buildNetPosition(rows, ['cash', 'cash', 'bank', 'missing'])).toEqual({
      dinar: 0,
      usd: 0,
      accountCount: 0,
      contributions: [],
    })
  })

  it('orders non-zero accounts first and filters by account name or detail', () => {
    const contributions = [
      { accountId: 'zero', account: { id: 'zero', ownerName: 'صندوق', subAccountName: 'احتياطي', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }, dinar: 0, usd: 0 },
      { accountId: 'nader', account: { id: 'nader', ownerName: 'NADER', subAccountName: 'كاش بيننا', valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }, dinar: 450, usd: 0 },
      { accountId: 'bank', account: { id: 'bank', ownerName: 'مصرف الجمهورية', subAccountName: 'حساب رئيسي', valueKind: VALUE_KINDS.BANK, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }, dinar: 1_000, usd: 0 },
    ]

    expect(filterNetContributions(contributions).map((item) => item.accountId)).toEqual(['bank', 'nader', 'zero'])
    expect(filterNetContributions(contributions, 'كاش').map((item) => item.accountId)).toEqual(['nader', 'zero'])
    expect(filterNetContributions(contributions, 'nader').map((item) => item.accountId)).toEqual(['nader'])
    expect(filterNetContributions(contributions, 'دولار').map((item) => item.accountId)).toEqual(['nader'])
    expect(filterNetContributions(contributions, 'مصرف').map((item) => item.accountId)).toEqual(['bank'])
    expect(filterNetContributions(contributions, 'دينار').map((item) => item.accountId)).toEqual(['bank', 'zero'])
  })

  it('converts the net in both directions only with a valid positive rate', () => {
    const position = { dinar: 10_500, usd: 100 }

    expect(convertNetPosition(position, 7.5, 'LYD')).toEqual({ ok: true, currency: 'LYD', amount: 11_250, rate: 7.5 })
    expect(convertNetPosition(position, 7.5, 'USD')).toEqual({ ok: true, currency: 'USD', amount: 1_500, rate: 7.5 })
    expect(convertNetPosition(position, 0, 'LYD')).toMatchObject({ ok: false })
    expect(convertNetPosition(position, Number.NaN, 'USD')).toMatchObject({ ok: false })
  })
})
