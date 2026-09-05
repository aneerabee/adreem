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

  it('shows and counts only accounts with a non-zero rounded balance', () => {
    const position = buildNetPosition([
      bucket('zero', VALUE_KINDS.CASH, 0, 0),
      bucket('tiny', VALUE_KINDS.CASH, 0.49, -0.49),
      bucket('invalid', VALUE_KINDS.BANK, Number.NaN, Number.POSITIVE_INFINITY),
      bucket('unsafe', VALUE_KINDS.BANK, Number.MAX_SAFE_INTEGER + 1, 0),
      bucket('owed-to-me', VALUE_KINDS.RECEIVABLE, 1, 0),
      bucket('i-owe', VALUE_KINDS.RECEIVABLE, -1, 0),
      bucket('usd', VALUE_KINDS.CASH, 0, 1),
    ])

    expect(position).toMatchObject({ dinar: 0, usd: 1, accountCount: 3 })
    expect(position.contributions.map((item) => item.accountId)).toEqual(['owed-to-me', 'i-owe', 'usd'])
  })

  it('preserves every supported whole-number sign and currency exactly', () => {
    const supportedValues = [
      -999_999_999_999_999,
      -1_000_000,
      -1,
      0,
      1,
      1_000_000,
      999_999_999_999_999,
    ]

    for (const amount of supportedValues) {
      const dinar = buildNetPosition([bucket(`dinar-${amount}`, VALUE_KINDS.CASH, amount, 0)])
      const usd = buildNetPosition([bucket(`usd-${amount}`, VALUE_KINDS.CASH, 0, amount)])
      expect(dinar).toMatchObject({ dinar: amount, usd: 0, accountCount: amount === 0 ? 0 : 1 })
      expect(usd).toMatchObject({ dinar: 0, usd: amount, accountCount: amount === 0 ? 0 : 1 })
    }
  })

  it('keeps a multi-account total exact beyond the ordinary numeric limit', () => {
    const perAccount = 999_999_999_999_999
    const rows = Array.from({ length: 10 }, (_, index) => (
      bucket(`large-${index}`, VALUE_KINDS.CASH, perAccount, -perAccount)
    ))
    const position = buildNetPosition(rows)

    expect(position).toMatchObject({
      dinar: 9_999_999_999_999_990n,
      usd: -9_999_999_999_999_990n,
      accountCount: 10,
    })
    expect(convertNetPosition(position, 7.5, 'LYD')).toEqual({
      ok: false,
      error: 'نتيجة الصافي أكبر من الحد المسموح.',
    })
  })

  it('fails closed when the balance-row collection is missing or malformed', () => {
    expect(buildNetPosition(null)).toEqual({ dinar: 0, usd: 0, try: 0, eur: 0, accountCount: 0, contributions: [] })
    expect(buildNetPosition({ account: { id: 'not-a-list' } })).toEqual({ dinar: 0, usd: 0, try: 0, eur: 0, accountCount: 0, contributions: [] })
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
      try: 0, eur: 0,
      accountCount: 0,
      contributions: [],
    })
  })

  it('groups net accounts by kind and name without using their amounts for order', () => {
    const contributions = [
      { accountId: 'zero', account: { id: 'zero', ownerName: 'صندوق', subAccountName: 'احتياطي', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }, dinar: 0, usd: 0 },
      { accountId: 'nader', account: { id: 'nader', ownerName: 'NADER', subAccountName: 'كاش بيننا', valueKind: VALUE_KINDS.RECEIVABLE, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }, dinar: 450, usd: 0 },
      { accountId: 'bank', account: { id: 'bank', ownerName: 'مصرف الجمهورية', subAccountName: 'حساب رئيسي', valueKind: VALUE_KINDS.BANK, currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR }, dinar: 1_000, usd: 0 },
      { accountId: 'cash-zulu', account: { id: 'cash-zulu', ownerName: 'Zulu', subAccountName: 'Cash', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }, dinar: 999_999, usd: 0 },
      { accountId: 'cash-alpha', account: { id: 'cash-alpha', ownerName: 'Alpha', subAccountName: 'Cash', valueKind: VALUE_KINDS.CASH, currencyKind: ACCOUNT_CURRENCY_KINDS.USD }, dinar: 1, usd: 0 },
    ]

    expect(filterNetContributions(contributions).map((item) => item.accountId)).toEqual(['zero', 'cash-alpha', 'cash-zulu', 'bank', 'nader'])
    expect(filterNetContributions(contributions, 'كاش').map((item) => item.accountId)).toEqual(['zero', 'cash-alpha', 'cash-zulu', 'nader'])
    expect(filterNetContributions(contributions, 'nader').map((item) => item.accountId)).toEqual(['nader'])
    expect(filterNetContributions(contributions, 'دولار').map((item) => item.accountId)).toEqual(['cash-alpha', 'cash-zulu', 'nader'])
    expect(filterNetContributions(contributions, 'مصرف').map((item) => item.accountId)).toEqual(['bank'])
    expect(filterNetContributions(contributions, 'دينار').map((item) => item.accountId)).toEqual(['zero', 'bank'])
  })

  it('converts every net currency through rates quoted against USD', () => {
    const position = { dinar: 10_500, usd: 100 }

    expect(convertNetPosition(position, 7.5, 'LYD')).toEqual({ ok: true, currency: 'LYD', amount: 11_250, rate: 7.5 })
    expect(convertNetPosition(position, 7.5, 'USD')).toEqual({ ok: true, currency: 'USD', amount: 1_500, rate: 7.5 })
    expect(convertNetPosition(position, 0, 'LYD')).toMatchObject({ ok: false })
    expect(convertNetPosition(position, Number.NaN, 'USD')).toMatchObject({ ok: false })
    expect(convertNetPosition({ dinar: 7_250, usd: 0, try: 0, eur: 0 }, 7.25, 'TRY', 46)).toEqual({
      ok: true,
      currency: 'TRY',
      amount: 46_000,
      rate: 7.25,
      tryRate: 46,
    })
    const mixedPosition = { dinar: 700, usd: 100, try: 460, eur: 0 }
    expect(convertNetPosition(mixedPosition, 7, 'LYD', 46)).toEqual({ ok: true, currency: 'LYD', amount: 1_470, rate: 7, tryRate: 46 })
    expect(convertNetPosition(mixedPosition, 7, 'USD', 46)).toEqual({ ok: true, currency: 'USD', amount: 210, rate: 7, tryRate: 46 })
    expect(convertNetPosition(mixedPosition, 7, 'TRY', 46)).toEqual({ ok: true, currency: 'TRY', amount: 9_660, rate: 7, tryRate: 46 })
    const opposingPosition = { dinar: 700, usd: -100, try: 460, eur: 0 }
    expect(convertNetPosition(opposingPosition, 7, 'LYD', 46)).toEqual({ ok: true, currency: 'LYD', amount: 70, rate: 7, tryRate: 46 })
    expect(convertNetPosition(opposingPosition, 7, 'USD', 46)).toEqual({ ok: true, currency: 'USD', amount: 10, rate: 7, tryRate: 46 })
    expect(convertNetPosition(opposingPosition, 7, 'TRY', 46)).toEqual({ ok: true, currency: 'TRY', amount: 460, rate: 7, tryRate: 46 })
    expect(convertNetPosition({ dinar: 700, usd: 0, try: 0, eur: 0 }, 0, 'LYD', 0)).toEqual({ ok: true, currency: 'LYD', amount: 700, rate: 0 })
    expect(convertNetPosition({ dinar: 0, usd: 100, try: 0, eur: 0 }, 0, 'USD', 0)).toEqual({ ok: true, currency: 'USD', amount: 100, rate: 0 })
    expect(convertNetPosition({ dinar: 0, usd: 0, try: 460, eur: 0 }, 0, 'TRY', 0)).toEqual({ ok: true, currency: 'TRY', amount: 460, rate: 0 })
    expect(convertNetPosition({ dinar: 0, usd: 100, try: 0, eur: 0 }, 0, 'TRY', 46)).toEqual({ ok: true, currency: 'TRY', amount: 4_600, rate: 0, tryRate: 46 })
    expect(convertNetPosition({ dinar: 0, usd: 0, try: 460, eur: 0 }, 0, 'USD', 46)).toEqual({ ok: true, currency: 'USD', amount: 10, rate: 0, tryRate: 46 })
    expect(convertNetPosition({ dinar: 700, usd: 0, try: 0, eur: 0 }, 0, 'TRY', 46)).toEqual({ ok: false, error: 'أدخل سعر LYD مقابل USD.' })
    expect(convertNetPosition({ dinar: 700, usd: 0, try: 0, eur: 0 }, 7, 'TRY', 0)).toEqual({ ok: false, error: 'أدخل سعر TRY مقابل USD.' })
    expect(convertNetPosition({ dinar: 0, usd: 0, try: 460, eur: 0 }, 0, 'LYD', 0)).toEqual({ ok: false, error: 'أدخل سعري LYD وTRY مقابل USD.' })
    expect(convertNetPosition({ dinar: Number.MAX_SAFE_INTEGER + 1, usd: 0 }, 7.5, 'USD')).toMatchObject({ ok: false })
    expect(convertNetPosition({ dinar: 0, usd: Number.MAX_SAFE_INTEGER }, 2, 'LYD')).toEqual({
      ok: false,
      error: 'نتيجة الصافي أكبر من الحد المسموح.',
    })
    expect(convertNetPosition({ dinar: 1, usd: 1 }, Number.MAX_VALUE, 'LYD')).toMatchObject({ ok: false })
  })
})
