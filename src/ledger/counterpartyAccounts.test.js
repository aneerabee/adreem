import { describe, expect, it } from 'vitest'
import { ACCOUNT_OPENING_DIRECTIONS, COUNTERPARTY_ACCOUNT_KINDS, emptyAccountDraft } from './accountConfig.js'
import {
  buildCounterpartyAccountBundle,
  buildCounterpartyBalanceViews,
  buildCounterpartyOpeningMovements,
  validateCounterpartyAccountBundle,
} from './counterpartyAccounts.js'
import { CURRENCIES, summarizeBalances } from './ledgerCore.js'

function personDraft(overrides = {}) {
  return {
    ...emptyAccountDraft(),
    ownerName: 'شركة النور',
    ...overrides,
  }
}

describe('counterparty account bundles', () => {
  it('creates cash dinar, cheque dinar, and dollar accounts as one linked bundle', () => {
    const accounts = buildCounterpartyAccountBundle(personDraft())

    expect(accounts).toHaveLength(3)
    expect(new Set(accounts.map((account) => account.counterpartyId)).size).toBe(1)
    expect(accounts.map((account) => [account.counterpartyKind, account.subAccountName, account.currencyKind])).toEqual([
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 'كاش بيننا', CURRENCIES.DINAR],
      [COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, 'شيك بيننا', CURRENCIES.DINAR],
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 'دولار بيننا', CURRENCIES.USD],
    ])
  })

  it('keeps each opening balance and direction on its matching account', () => {
    const draft = personDraft({
      counterpartyOpenings: {
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR]: { amount: '1,200', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
        [COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR]: { amount: '450', direction: ACCOUNT_OPENING_DIRECTIONS.I_OWE },
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD]: { amount: '80', direction: ACCOUNT_OPENING_DIRECTIONS.OWED_TO_ME },
      },
    })
    const accounts = buildCounterpartyAccountBundle(draft)
    const opening = buildCounterpartyOpeningMovements(accounts)
    const balances = summarizeBalances(accounts, opening.movements)

    expect(opening.validation.ok).toBe(true)
    expect(balances.map((bucket) => [bucket.account.counterpartyKind, bucket.dinar, bucket.usd])).toEqual([
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 1200, 0],
      [COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, -450, 0],
      [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 0, 80],
    ])
  })

  it('rejects a non-zero opening balance with no direction before creating anything', () => {
    const draft = personDraft({
      counterpartyOpenings: {
        ...emptyAccountDraft().counterpartyOpenings,
        [COUNTERPARTY_ACCOUNT_KINDS.CASH_USD]: { amount: '25', direction: '' },
      },
    })
    const result = validateCounterpartyAccountBundle(draft)

    expect(result.validation.ok).toBe(false)
    expect(result.validation.errors).toContainEqual(expect.objectContaining({
      field: `counterpartyOpenings.${COUNTERPARTY_ACCOUNT_KINDS.CASH_USD}.direction`,
    }))
  })

  it('rejects recreating the same person bundle', () => {
    const draft = personDraft()
    const existing = buildCounterpartyAccountBundle(draft)
    const result = validateCounterpartyAccountBundle(draft, existing)

    expect(result.validation.ok).toBe(false)
    expect(result.validation.errors.filter((error) => error.field === 'subAccountName')).toHaveLength(3)
  })

  it('groups mixed directions under one person while exposing receivable and payable views', () => {
    const accounts = buildCounterpartyAccountBundle(personDraft())
    const rows = [
      { account: accounts[0], dinar: 1200, usd: 0 },
      { account: accounts[1], dinar: -450, usd: 0 },
      { account: accounts[2], dinar: 0, usd: 80 },
    ]
    const views = buildCounterpartyBalanceViews(rows)

    expect(views.all).toHaveLength(1)
    expect(views.receivable).toHaveLength(1)
    expect(views.payable).toHaveLength(1)
    expect(views.all[0].receivable).toEqual({ dinar: 1200, usd: 80 })
    expect(views.all[0].payable).toEqual({ dinar: 450, usd: 0 })
  })

  it('sorts each direction by its own largest value instead of the opposite balance', () => {
    const firstAccounts = buildCounterpartyAccountBundle(personDraft({ ownerName: 'الأول' }))
    const secondAccounts = buildCounterpartyAccountBundle(personDraft({ ownerName: 'الثاني' }))
    const views = buildCounterpartyBalanceViews([
      { account: firstAccounts[0], dinar: 10_000, usd: 0 },
      { account: firstAccounts[1], dinar: -100, usd: 0 },
      { account: secondAccounts[0], dinar: 500, usd: 0 },
      { account: secondAccounts[1], dinar: -4_000, usd: 0 },
    ])

    expect(views.receivable.map((group) => group.ownerName)).toEqual(['الأول', 'الثاني'])
    expect(views.payable.map((group) => group.ownerName)).toEqual(['الثاني', 'الأول'])
  })
})
