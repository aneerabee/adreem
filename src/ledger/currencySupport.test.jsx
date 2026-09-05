import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { completeAccountCurrencies } from './accountCurrencyUpgrade.js'
import { createAccount, createOpeningMovements, summarizeBalances, validateAccount, validateMovement, currencyBalanceField } from './ledgerCore.js'
import { buildCounterpartyAccountBundle, buildCounterpartyBalanceViews } from './counterpartyAccounts.js'
import { emptyAccountDraft } from './accountConfig.js'
import { buildNetPosition, convertNetPosition } from './ledgerScope.js'
import { buildDimensionReports, buildExpenseCategoryReports } from './ledgerOperations.js'
import { createEmptyAdreemState, mergeLedgerStates } from './ledgerState.js'
import { validateLedgerStateTransition } from '../../server/ledger/stateValidation.js'
import { accountDeletionEligibility } from './accountEditing.js'
import { AccountRow, NetPositionPanel, buildBalanceOverview, filterCounterpartyGroups, accountBalanceChip } from './LedgerApp.jsx'

const at = '2026-09-05T12:00:00.000Z'
const currencies = ['LYD', 'USD', 'TRY', 'EUR']
const openingFields = { LYD: 'openingDinar', USD: 'openingUsd', TRY: 'openingTry', EUR: 'openingEur' }
const bank = (currency, id = 'cash', kind = 'cash') => ({ ...createAccount({ id, ownerName: 'أنا', subAccountName: id, type: kind, valueKind: kind, currencyKind: currency, [openingFields[currency]]: 1000 }), createdAt: at })
const person = () => buildCounterpartyAccountBundle({ ...emptyAccountDraft(), ownerName: 'شخص طويل الاسم للاختبار' })
const entry = (currency, type, overrides = {}) => ({ id: 'entry', type, currency, amount: 100, status: 'posted', sourceAccountId: 'cash', destinationAccountId: null, note: 'اختبار', createdAt: at, updatedAt: at, ...overrides })

describe.each(currencies)('%s full currency paths', (currency) => {
  it('preserves opening balances, renders the correct unit, and rejects negative owned money', () => {
    const account = bank(currency)
    const openings = createOpeningMovements([account], at)
    const rows = summarizeBalances([account], openings)
    expect(openings).toHaveLength(1)
    expect(openings[0].currency).toBe(currency)
    expect(rows[0][currencyBalanceField(currency)]).toBe(1000)
    expect(renderToStaticMarkup(<AccountRow bucket={rows[0]} />)).toContain(currency)
    expect(accountBalanceChip(account, rows[0], currency).text).toContain(currency)
    expect(validateAccount({ ...account, [openingFields[currency]]: -1 }).ok).toBe(false)
    expect(validateAccount({ ...account, [openingFields[currency]]: 1.5 }).ok).toBe(false)
  })

  it.each(['expense', 'truck_expense', 'external_income', 'truck_income', 'transfer', 'cash_deposit', 'cash_withdrawal'])('posts, edits and cancels %s without affecting another currency', (type) => {
    const sourceKind = type === 'cash_withdrawal' ? 'bank' : 'cash'
    const destinationKind = type === 'cash_deposit' ? 'bank' : 'cash'
    const accounts = [bank(currency, 'cash', sourceKind), bank(currency, 'other', destinationKind)]
    const openings = createOpeningMovements(accounts, at)
    const income = type === 'external_income' || type === 'truck_income'
    const expense = type === 'expense' || type === 'truck_expense'
    const movement = entry(currency, type, { sourceAccountId: income ? null : 'cash', destinationAccountId: expense ? null : 'other' })
    expect(validateMovement(movement, accounts, openings).ok).toBe(true)
    const state = { ...createEmptyAdreemState(at), accounts, movements: openings }
    expect(validateLedgerStateTransition({ ...state, movements: [...openings, movement] }, state, { now: at }).ok).toBe(true)
    for (const amount of [100, 250]) {
      const rows = summarizeBalances(accounts, [...openings, { ...movement, amount }])
      expect(rows[0][currencyBalanceField(currency)]).toBe(income ? 1000 : 1000 - amount)
      expect(rows[1][currencyBalanceField(currency)]).toBe(expense ? 1000 : 1000 + amount)
      for (const other of currencies.filter((item) => item !== currency)) expect(rows[0][currencyBalanceField(other)]).toBe(0)
    }
    const cancelled = summarizeBalances(accounts, [...openings, { ...movement, status: 'voided' }])
    expect(cancelled[0][currencyBalanceField(currency)]).toBe(1000)
    if (!income) expect(validateMovement({ ...movement, amount: 1001 }, accounts, openings).ok).toBe(false)
  })

  it('rejects cross-currency transfers', () => {
    const other = currencies.find((item) => item !== currency)
    const accounts = [bank(currency), bank(other, 'other')]
    expect(validateMovement(entry(currency, 'transfer', { destinationAccountId: 'other' }), accounts, createOpeningMovements(accounts)).ok).toBe(false)
  })
})

describe('currency account upgrades', () => {
  it('adds only missing TRY/EUR with zero openings and preserves financial identity and movements', () => {
    const old = person().filter((account) => !['TRY','EUR'].includes(account.currencyKind))
    old[0] = { ...old[0], openingDinar: 550, settlementPinned: true, settlementPinnedAt: at }
    const openings = createOpeningMovements(old, at)
    const before = structuredClone(old)
    const upgraded = completeAccountCurrencies(old, at)
    expect(upgraded).toHaveLength(5)
    expect(old).toEqual(before)
    expect(upgraded.slice(3).map((account) => account.currencyKind)).toEqual(['TRY','EUR'])
    expect(createOpeningMovements(upgraded, at)).toEqual(openings)
    expect(summarizeBalances(upgraded, openings).map((row) => row.dinar)).toEqual([550,0,0,0,0])
    expect(new Set(upgraded.map((account) => account.counterpartyId)).size).toBe(1)
    const state = { ...createEmptyAdreemState(at), accounts: old, movements: openings }
    const result = validateLedgerStateTransition({ ...state, accounts: upgraded }, state, { now: at })
    expect(result.errors).toEqual([])
    expect(completeAccountCurrencies(upgraded, at)).toBe(upgraded)
  })
  it('does not duplicate an existing lira account or recreate a later deleted currency channel', () => {
    const old = person().filter((account) => account.currencyKind !== 'EUR')
    const upgraded = completeAccountCurrencies(old, at)
    expect(upgraded.filter((account) => account.currencyKind === 'TRY')).toHaveLength(1)
    const removed = upgraded.filter((account) => account.currencyKind !== 'EUR')
    expect(completeAccountCurrencies(removed, at)).toBe(removed)
  })
  it('preserves legacy name-based grouping when adding currencies without an explicit bundle', () => {
    const accounts = [createAccount({ id: 'legacy-person', ownerName: 'Legacy Person', subAccountName: 'كاش بيننا', type: 'person', valueKind: 'receivable', currencyKind: 'LYD', openingDinar: 550 })]
    const state = { ...createEmptyAdreemState(at), accounts, movements: createOpeningMovements(accounts, at) }
    const upgraded = completeAccountCurrencies(accounts, at)
    expect(upgraded).toHaveLength(3)
    expect(upgraded.every((account) => !account.counterpartyId)).toBe(true)
    expect(validateLedgerStateTransition({ ...state, accounts: upgraded }, state, { now: at }).errors).toEqual([])
  })
  it('leaves inactive people, unrelated expenses and assets untouched', () => {
    const inactive = person().map((account) => ({ ...account, status: 'inactive' }))
    const accounts = [...inactive, bank('LYD','asset','asset'), bank('LYD','expense','expense')]
    expect(completeAccountCurrencies(accounts, at)).toBe(accounts)
  })
  it('groups own cash and bank by place without mixing them or changing the old currency', () => {
    const accounts = [bank('LYD','cash'), bank('USD','bank','bank')]
    const upgraded = completeAccountCurrencies(accounts, at)
    expect(upgraded).toHaveLength(6)
    expect(upgraded.filter((a) => a.valueKind === 'bank').map((a) => a.currencyKind)).toEqual(['USD','TRY','EUR'])
    expect(upgraded[0].openingDinar).toBe(1000)
  })
  it('uses stable IDs across retries and concurrent devices within the same isolated ledger', () => {
    const accounts = person().filter((a) => !['TRY','EUR'].includes(a.currencyKind))
    const base = { ...createEmptyAdreemState(at, { tenantId: 'owner-a', ledgerId: 'book-a' }), accounts }
    const left = { ...base, accounts: completeAccountCurrencies(accounts, at) }
    const right = { ...base, accounts: completeAccountCurrencies(accounts, '2026-09-05T12:01:00.000Z') }
    expect(mergeLedgerStates(left, right, base).accounts).toHaveLength(5)
    expect(completeAccountCurrencies([], at)).toEqual([])
    expect(base.accounts).toHaveLength(3)
  })
})

describe('EUR totals and reports', () => {
  it('shows euro-only people in the correct direction and only EUR when filtered', () => {
    const accounts = person()
    const rows = accounts.map((account) => ({ account, dinar: account.currencyKind === 'LYD' ? 50 : 0, usd: 0, try: 0, eur: account.currencyKind === 'EUR' ? -90 : 0 }))
    const groups = buildCounterpartyBalanceViews(rows)
    expect(groups.payable).toHaveLength(1)
    const filtered = filterCounterpartyGroups(groups.all, 'cash-eur')
    expect(filtered[0].rows).toHaveLength(1)
    expect(filtered[0].payable).toEqual({ dinar: 0, usd: 0, try: 0, eur: 90 })
    expect(buildBalanceOverview(rows).payable.eur).toBe(90)
    expect(buildNetPosition(rows).eur).toBe(-90)
  })
  it('includes EUR expenses and project income without adding them to LYD', () => {
    const cash = bank('EUR')
    const dimension = { id: 'truck', name: 'Truck', type: 'project', status: 'active' }
    const movements = [entry('EUR','truck_income',{ sourceAccountId: null, destinationAccountId: 'cash', amount: 300, dimensionId: 'truck' }), entry('EUR','truck_expense',{ id:'expense', amount:100, dimensionId:'truck' })]
    const state = { accounts: [cash], dimensions: [dimension], movements }
    expect(buildExpenseCategoryReports(state)[0]).toMatchObject({ dinar:0,eur:100 })
    expect(buildDimensionReports(state)[0]).toMatchObject({ income:0, incomeEur:300,expenseEur:100,netEur:200 })
    expect(accountDeletionEligibility({ ...cash, balanceEur: 1 }, { accounts:[cash] }).canDelete).toBe(false)
  })
  it.each(currencies.flatMap((source) => currencies.map((target) => [source,target])))('converts %s to %s using each currency per USD', (source,target) => {
    const rates = { LYD: 7, USD: 1, TRY: 46, EUR: 0.9 }
    const position = { [currencyBalanceField(source)]: rates[source] * 100 }
    const result = convertNetPosition(position,7,target,46,0.9)
    expect(result.ok).toBe(true)
    expect(result.amount).toBe(Math.round(rates[target]*100))
  })
  it('requires a valid EUR rate only when conversion needs it', () => {
    expect(convertNetPosition({ eur:90 },0,'EUR',0,0)).toMatchObject({ok:true,amount:90})
    expect(convertNetPosition({ eur:90 },7,'USD',46,0).ok).toBe(false)
    expect(convertNetPosition({ eur:90 },7,'USD',46,Infinity).ok).toBe(false)
    const markup = renderToStaticMarkup(<NetPositionPanel position={{dinar:0,usd:0,try:0,eur:90,contributions:[]}} rate={7} tryRate={46} eurRate={0.9} targetCurrency="USD" />)
    expect(markup).toContain('1 USD = ? EUR')
    expect(markup).toContain('100')
  })
})
import React from 'react'
