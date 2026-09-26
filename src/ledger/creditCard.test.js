import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { accountOpeningAmounts, accountOpeningDraftErrors } from './accountConfig.js'
import { accountBalanceChip } from './accountPresentation.js'
import { buildBalanceOverview } from './balanceViews.js'
import { getMovementAccounts } from './movementAccounts.js'
import {
  CURRENCIES,
  MOVEMENT_TYPES,
  createAccount,
  createOpeningMovements,
  postMovement,
  summarizeBalances,
  validateAccount,
  validateMovement,
  validateMovementBalanceTransition,
  voidMovement,
} from './ledgerCore.js'
import { createEmptyAdreemState } from './ledgerState.js'
import { validateLedgerStateTransition } from '../../server/ledger/stateValidation.js'

const card = createAccount({
  id: 'maximum', ownerName: 'أنا', subAccountName: 'Maximum',
  type: ACCOUNT_TYPES.CREDIT_CARD, valueKind: VALUE_KINDS.CREDIT_CARD,
  currencyKind: 'multi', cardCurrencies: [CURRENCIES.DINAR, CURRENCIES.USD],
  openingDinar: -300, openingUsd: -20,
})
const companyCash = createAccount({
  id: 'brix-cash', ownerName: 'BRIX TURIZM', subAccountName: 'كاش',
  type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE,
  currencyKind: CURRENCIES.DINAR,
})
const companyCheque = createAccount({
  id: 'brix-cheque', ownerName: 'BRIX TURIZM', subAccountName: 'شيك',
  type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE,
  currencyKind: CURRENCIES.DINAR,
})
const ownCash = createAccount({
  id: 'own-cash', ownerName: 'أنا', subAccountName: 'كاش',
  type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH,
  currencyKind: CURRENCIES.DINAR, openingDinar: 1_000,
})
const accounts = [card, companyCash, companyCheque, ownCash]
const openings = createOpeningMovements(accounts)
const charge = (destinationAccountId = companyCheque, amount = 200, currency = CURRENCIES.DINAR) => ({
  type: MOVEMENT_TYPES.CARD_CHARGE, amount, currency,
  sourceAccountId: card.id, destinationAccountId: typeof destinationAccountId === 'string' ? destinationAccountId : destinationAccountId.id,
})
const payment = (sourceAccountId, amount = 100) => ({
  type: MOVEMENT_TYPES.CARD_PAYMENT, amount, currency: CURRENCIES.DINAR,
  sourceAccountId, destinationAccountId: card.id,
})
const balance = (movements, id) => summarizeBalances(accounts, movements).find((item) => item.account.id === id)

describe('credit card ledger', () => {
  it('creates one multi-currency card with separate negative opening debt', () => {
    expect(validateAccount(card, [])).toEqual({ ok: true, errors: [] })
    expect(openings.filter((item) => item.destinationAccountId === card.id).map((item) => [item.currency, item.amount]))
      .toEqual([[CURRENCIES.DINAR, -300], [CURRENCIES.USD, -20]])
    expect(balance(openings, card.id)).toMatchObject({ dinar: -300, usd: -20 })
    expect(buildBalanceOverview(summarizeBalances(accounts, openings)).cardDebt)
      .toMatchObject({ dinar: 300, usd: 20 })
    expect(accountOpeningAmounts({ valueKind: VALUE_KINDS.CREDIT_CARD, cardCurrencies: ['LYD', 'USD'], cardOpenings: { LYD: '300', USD: '20' } }))
      .toMatchObject({ openingDinar: -300, openingUsd: -20 })
  })

  it('rejects invalid opening debt and currencies', () => {
    expect(validateAccount({ ...card, cardCurrencies: ['LYD'], currencyKind: 'LYD' }, []).ok).toBe(false)
    expect(validateAccount({ ...card, openingDinar: 300 }, []).ok).toBe(false)
    expect(accountOpeningDraftErrors({ valueKind: VALUE_KINDS.CREDIT_CARD, cardCurrencies: ['LYD'], cardOpenings: { LYD: '-100' } }).length).toBeGreaterThan(0)
  })

  it('charges the selected cheque or cash receivable, then repays through owned money', () => {
    const posted = postMovement(charge(), accounts, openings)
    expect(posted.validation.ok).toBe(true)
    expect(balance([...openings, posted], card.id).dinar).toBe(-500)
    expect(balance([...openings, posted], companyCheque.id).dinar).toBe(200)
    expect(balance([...openings, posted], companyCash.id).dinar).toBe(0)

    const repayment = postMovement(payment(ownCash.id), accounts, [...openings, posted])
    expect(repayment.validation.ok).toBe(true)
    expect(balance([...openings, posted, repayment], card.id).dinar).toBe(-400)
    expect(balance([...openings, posted, repayment], ownCash.id).dinar).toBe(900)
    expect(balance([...openings, posted, repayment], companyCheque.id).dinar).toBe(200)
    expect(postMovement(charge(companyCash.id), accounts, openings).validation.ok).toBe(true)
  })

  it('repays directly from a receivable and rejects excess repayment', () => {
    const posted = postMovement(charge(companyCheque.id), accounts, openings)
    const repayment = postMovement(payment(companyCheque.id, 150), accounts, [...openings, posted])
    expect(repayment.validation.ok).toBe(true)
    expect(balance([...openings, posted, repayment], card.id).dinar).toBe(-350)
    expect(balance([...openings, posted, repayment], companyCheque.id).dinar).toBe(50)
    expect(postMovement(payment(companyCheque.id, 201), accounts, [...openings, posted]).validation.ok).toBe(false)
    expect(postMovement(payment(ownCash.id, 501), accounts, [...openings, posted]).validation.ok).toBe(false)
  })

  it('records reimbursement to owned cash before the separate card payment', () => {
    const posted = postMovement(charge(companyCash.id, 200), accounts, openings)
    const reimbursement = postMovement({
      type: MOVEMENT_TYPES.TRANSFER, amount: 200, currency: CURRENCIES.DINAR,
      sourceAccountId: companyCash.id, destinationAccountId: ownCash.id,
    }, accounts, [...openings, posted])
    expect(reimbursement.validation.ok).toBe(true)
    const repaid = postMovement(payment(ownCash.id, 200), accounts, [...openings, posted, reimbursement])
    expect(repaid.validation.ok).toBe(true)
    const all = [...openings, posted, reimbursement, repaid]
    expect(balance(all, card.id).dinar).toBe(-300)
    expect(balance(all, companyCash.id).dinar).toBe(0)
    expect(balance(all, ownCash.id).dinar).toBe(1_000)
  })

  it('limits account choices and rejects other routes or unsupported currency', () => {
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CARD_CHARGE, 'source', { currency: 'LYD' }).map((item) => item.id)).toEqual([card.id])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CARD_CHARGE, 'destination', { currency: 'LYD' }).map((item) => item.id))
      .toEqual([companyCash.id, companyCheque.id])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.CARD_CHARGE, 'source', { currency: 'EUR' })).toEqual([])
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.TRANSFER, 'source', { currency: 'LYD' }).map((item) => item.id)).not.toContain(card.id)
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.EXPENSE, 'source', { currency: 'LYD' }).map((item) => item.id)).not.toContain(card.id)
    expect(getMovementAccounts(accounts, new Map(), MOVEMENT_TYPES.USD_SALE, 'source', { currency: 'USD' }).map((item) => item.id)).not.toContain(card.id)
    const balanceMap = new Map(summarizeBalances(accounts, [...openings, postMovement(charge(), accounts, openings)]).map((item) => [item.account.id, item]))
    expect(getMovementAccounts(accounts, balanceMap, MOVEMENT_TYPES.CARD_PAYMENT, 'source', { currency: 'LYD' }).map((item) => item.id))
      .toEqual([companyCheque.id, ownCash.id])
    expect(validateMovement(charge(companyCheque.id, 50, 'EUR'), accounts, openings).ok).toBe(false)
    expect(validateMovement(charge(companyCheque.id, 50, 'USD'), accounts, openings).ok).toBe(false)
    expect(validateMovement({ ...charge(), destinationAccountId: ownCash.id }, accounts, openings).ok).toBe(false)
    expect(validateMovement({ ...payment(card.id), sourceAccountId: card.id }, accounts, openings).ok).toBe(false)
    expect(validateMovement({ ...charge(), type: MOVEMENT_TYPES.TRANSFER }, accounts, openings).ok).toBe(false)
    expect(accountBalanceChip(card, { dinar: 0, usd: -20 }).text).toContain('دين البطاقة')
  })

  it('does not allow voiding a charge after its debt was already paid', () => {
    const posted = postMovement(charge(companyCheque.id, 200), accounts, openings)
    const repayment = postMovement(payment(ownCash.id, 450), accounts, [...openings, posted])
    expect(repayment.validation.ok).toBe(true)
    const voided = voidMovement(posted, 'خطأ').movement
    expect(validateMovementBalanceTransition(posted, voided, accounts, [...openings, posted, repayment]).ok).toBe(false)
  })

  it('accepts card creation and its linked movements through server state validation', () => {
    const empty = createEmptyAdreemState()
    const withAccounts = { ...empty, accounts, movements: openings }
    expect(validateLedgerStateTransition(withAccounts, empty).ok).toBe(true)

    const posted = postMovement(charge(companyCheque.id, 200), accounts, openings)
    const withCharge = { ...withAccounts, movements: [...openings, posted] }
    expect(validateLedgerStateTransition(withCharge, withAccounts).ok).toBe(true)

    const repaid = postMovement(payment(companyCheque.id, 100), accounts, withCharge.movements)
    const withPayment = { ...withCharge, movements: [...withCharge.movements, repaid] }
    expect(validateLedgerStateTransition(withPayment, withCharge).ok).toBe(true)

    const overpaid = { ...withCharge, movements: [...withCharge.movements, { ...repaid, amount: 201 }] }
    expect(validateLedgerStateTransition(overpaid, withCharge).ok).toBe(false)
  })
})
