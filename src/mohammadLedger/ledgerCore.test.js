import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS, mohammadAccountCatalog, mohammadSummaryAccounts } from './accountCatalog'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  MAX_MONEY_AMOUNT,
  buildPostingEntries,
  canCommitMovementEdit,
  createAccount,
  createOpeningMovements,
  formatBalanceMeaning,
  getAccountBalance,
  postMovement,
  previewMovement,
  summarizeBalances,
  validateMovement,
  validateMovementBalanceTransition,
  voidMovement,
  validateAccount,
} from './ledgerCore'

describe('mohammad ledger core', () => {
  it('allows a person opening debt but rejects a negative owned-money opening', () => {
    const person = createAccount({
      id: 'person-opening-debt',
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: CURRENCIES.DINAR,
      openingDinar: -500,
    })
    const cash = createAccount({
      id: 'cash-opening-negative',
      ownerName: 'أنا',
      subAccountName: 'الخزنة',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      openingDinar: -500,
    })

    expect(validateAccount(person, [])).toEqual({ ok: true, errors: [] })
    expect(validateAccount(cash, []).errors).toContainEqual(expect.objectContaining({ field: 'openingDinar' }))
    expect(validateMovement(createOpeningMovements([person])[0], [person], []).ok).toBe(true)
  })
  it('rejects values that cannot fit exactly in the relational database', () => {
    const account = createAccount({
      id: 'cash-limit',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
    })
    const result = postMovement({
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      amount: MAX_MONEY_AMOUNT + 1,
      currency: CURRENCIES.DINAR,
      destinationAccountId: account.id,
    }, [account], [])

    expect(result.validation.ok).toBe(false)
    expect(result.validation.errors).toContainEqual(expect.objectContaining({ field: 'amount' }))
  })

  it('creates opening balances from the Numbers catalog without losing cash or bank separation', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const balances = summarizeBalances(mohammadAccountCatalog, openings)

    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).dinar).toBe(50000)
    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).usd).toBe(500)
    expect(getAccountBalance('me-jumhouria', mohammadAccountCatalog, openings).dinar).toBe(30000)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-cash').dinar).toBe(12000)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-bank').dinar).toBe(8000)
  })

  it('uses database balances without recounting a paginated movement page', () => {
    const accounts = [{
      id: 'cash',
      status: ACCOUNT_STATUSES.ACTIVE,
      balanceSource: 'database',
      balanceDinar: 1200,
      balanceUsd: 50,
      postedCount: 9,
    }]
    const visibleMovements = [{
      id: 'visible',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 200,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash',
    }]

    expect(summarizeBalances(accounts, visibleMovements)[0]).toMatchObject({
      dinar: 1200,
      usd: 50,
      postedCount: 9,
    })
  })

  it('validates an edit against the balance before the original posted movement', () => {
    const accounts = [{
      id: 'cash',
      ownerName: 'أنا',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
      balanceSource: 'database',
      balanceDinar: 10,
      balanceUsd: 0,
      postedCount: 1,
    }]
    const originalMovement = {
      id: 'expense-90',
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 90,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    }

    const edited = postMovement(
      { ...originalMovement, amount: 20 },
      accounts,
      [],
      { originalMovement },
    )

    expect(edited.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(edited.validation.ok).toBe(true)
  })

  it('rejects voiding income that has already been spent from owned money', () => {
    const accounts = [{
      id: 'cash',
      ownerName: 'أنا',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
      balanceSource: 'database',
      balanceDinar: 0,
      balanceUsd: 0,
      postedCount: 2,
    }]
    const income = {
      id: 'income-100',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: null,
      destinationAccountId: 'cash',
      createdAt: '2026-08-20T10:00:00.000Z',
    }
    const voided = voidMovement(income, 'إلغاء', '2026-08-20T10:05:00.000Z').movement

    const validation = validateMovementBalanceTransition(income, voided, accounts, [])

    expect(validation.ok).toBe(false)
    expect(validation.errors).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('بالسالب'),
    }))
  })

  it('previews transfer effects before posting', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const preview = previewMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 500,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
      openings,
    )

    expect(preview.validation.ok).toBe(true)
    expect(preview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-cash', before: 50000, delta: -500, after: 49500 }),
      expect.objectContaining({ accountId: 'saeed-cash', before: 12000, delta: 500, after: 12500 }),
    ])
  })

  it('treats expense as one-sided money leaving the selected account', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const preview = previewMovement(
      {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: null,
      },
      mohammadAccountCatalog,
      openings,
    )

    expect(preview.validation.ok).toBe(true)
    expect(preview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-cash', before: 50000, delta: -100, after: 49900 }),
    ])
  })

  it('prevents own cash, bank, and assets from going below zero', () => {
    const accounts = [
      createAccount({ id: 'my-cash', ownerName: 'أنا', subAccountName: 'كاش', type: ACCOUNT_TYPES.CASH, valueKind: 'cash', openingDinar: 100 }),
      createAccount({ id: 'my-asset', ownerName: 'شاحنة', subAccountName: 'أصل', type: ACCOUNT_TYPES.ASSET, valueKind: 'asset', openingDinar: 100 }),
    ]
    const openings = createOpeningMovements(accounts)
    const expense = postMovement(
      {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 150,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'my-cash',
        destinationAccountId: null,
      },
      accounts,
      openings,
    )
    const correction = postMovement(
      {
        type: MOVEMENT_TYPES.CORRECTION,
        amount: -150,
        currency: CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: 'my-asset',
        note: 'مطابقة',
      },
      accounts,
      openings,
    )

    expect(expense.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(expense.validation.errors.some((error) => error.message.includes('السالب'))).toBe(true)
    expect(correction.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(correction.validation.errors.some((error) => error.message.includes('السالب'))).toBe(true)
    expect(buildPostingEntries(expense)).toEqual([])
  })

  it('still allows person balances to become negative because that means I owe them', () => {
    const accounts = [
      createAccount({ id: 'person-a', ownerName: 'سعيد', subAccountName: 'كاش بيننا', type: ACCOUNT_TYPES.PERSON, valueKind: 'receivable' }),
      createAccount({ id: 'person-b', ownerName: 'ربيع', subAccountName: 'كاش بيننا', type: ACCOUNT_TYPES.PERSON, valueKind: 'receivable' }),
    ]
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'person-a',
        destinationAccountId: 'person-b',
      },
      accounts,
      [],
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.POSTED)
  })

  it('keeps incomplete movements out of posted balances', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const badMovement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 250,
        currency: CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
    )

    expect(badMovement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(buildPostingEntries(badMovement)).toEqual([])
    const balance = getAccountBalance('saeed-cash', mohammadAccountCatalog, [...openings, badMovement])
    expect(balance.dinar).toBe(12000)
  })

  it('rejects summary accounts as posting endpoints', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'trucks-income-summary',
      },
      [...mohammadAccountCatalog, ...mohammadSummaryAccounts],
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('الملخص'))).toBe(true)
  })

  it('rejects transfers between the same owner and same account detail', () => {
    const accounts = [
      createAccount({ id: 'saeed-cash-a', ownerName: 'سعيد', subAccountName: 'كاش', type: ACCOUNT_TYPES.PERSON, valueKind: 'receivable' }),
      createAccount({ id: 'saeed-cash-b', ownerName: 'سعيد', subAccountName: 'كاش', type: ACCOUNT_TYPES.PERSON, valueKind: 'receivable' }),
    ]
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'saeed-cash-a',
        destinationAccountId: 'saeed-cash-b',
      },
      accounts,
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('نفس الاسم'))).toBe(true)
  })

  it('rejects normal transfers between different account kinds', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('نفس النوع'))).toBe(true)
  })

  it('supports cash deposits and withdrawals as explicit same-currency bank routes', () => {
    const accounts = [
      createAccount({ id: 'cash', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, openingDinar: 1_000 }),
      createAccount({ id: 'bank', ownerName: 'أنا', subAccountName: 'الجمهورية', type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, openingDinar: 500 }),
    ]
    const openings = createOpeningMovements(accounts)
    const deposit = postMovement({
      type: MOVEMENT_TYPES.CASH_DEPOSIT,
      amount: 300,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'bank',
    }, accounts, openings)
    const afterDeposit = [...openings, deposit]
    const withdrawal = postMovement({
      type: MOVEMENT_TYPES.CASH_WITHDRAWAL,
      amount: 200,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'bank',
      destinationAccountId: 'cash',
    }, accounts, afterDeposit)

    expect(deposit.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(withdrawal.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(getAccountBalance('cash', accounts, [...afterDeposit, withdrawal]).dinar).toBe(900)
    expect(getAccountBalance('bank', accounts, [...afterDeposit, withdrawal]).dinar).toBe(600)
  })

  it('rejects reversed or mixed-currency cash and bank routes', () => {
    const accounts = [
      createAccount({ id: 'cash', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, currencyKind: CURRENCIES.DINAR, openingDinar: 1_000 }),
      createAccount({ id: 'bank', ownerName: 'أنا', subAccountName: 'الجمهورية', type: ACCOUNT_TYPES.BANK, valueKind: VALUE_KINDS.BANK, currencyKind: CURRENCIES.DINAR, openingDinar: 500 }),
    ]
    const reversed = postMovement({
      type: MOVEMENT_TYPES.CASH_DEPOSIT,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'bank',
      destinationAccountId: 'cash',
    }, accounts, createOpeningMovements(accounts))
    const wrongCurrency = postMovement({
      type: MOVEMENT_TYPES.CASH_WITHDRAWAL,
      amount: 100,
      currency: CURRENCIES.USD,
      sourceAccountId: 'bank',
      destinationAccountId: 'cash',
    }, accounts, createOpeningMovements(accounts))

    expect(reversed.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(wrongCurrency.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
  })

  it('keeps projects and expense categories out of financial posting endpoints', () => {
    const accounts = [
      createAccount({ id: 'cash', ownerName: 'أنا', subAccountName: 'الخزنة', type: ACCOUNT_TYPES.CASH, valueKind: VALUE_KINDS.CASH, openingDinar: 1_000 }),
      createAccount({ id: 'truck-project', ownerName: 'الشاحنة', subAccountName: 'مشروع', type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT }),
      createAccount({ id: 'fuel', ownerName: 'وقود', subAccountName: 'مصروف', type: ACCOUNT_TYPES.EXPENSE, valueKind: VALUE_KINDS.EXPENSE }),
    ]
    const invalidDestination = postMovement({
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'truck-project',
    }, accounts, createOpeningMovements(accounts))
    const categorizedExpense = postMovement({
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: null,
      expenseCategoryId: 'fuel',
    }, accounts, createOpeningMovements(accounts))

    expect(invalidDestination.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(categorizedExpense.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(buildPostingEntries(categorizedExpense)).toHaveLength(1)
  })

  it('keeps currency exchange flows available for cash-to-bank conversion', () => {
    const accounts = [
      createAccount({ id: 'usd-cash', ownerName: 'أنا', subAccountName: 'خزنة دولار', type: ACCOUNT_TYPES.CASH, valueKind: 'cash', currencyKind: CURRENCIES.USD, openingUsd: 200 }),
      createAccount({ id: 'dinar-bank', ownerName: 'أنا', subAccountName: 'الجمهورية', type: ACCOUNT_TYPES.BANK, valueKind: 'bank', currencyKind: CURRENCIES.DINAR }),
    ]
    const sale = postMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'usd-cash',
        destinationAccountId: 'dinar-bank',
      },
      accounts,
      createOpeningMovements(accounts),
    )

    expect(sale.status).toBe(MOVEMENT_STATUSES.POSTED)
  })

  it('posts exchange results as whole balances while keeping a decimal rate', () => {
    const purchaseEntries = buildPostingEntries({
      type: MOVEMENT_TYPES.USD_PURCHASE,
      amount: 100,
      currency: CURRENCIES.DINAR,
      rate: 7.5,
      sourceAccountId: 'dinar-cash',
      destinationAccountId: 'usd-cash',
      status: MOVEMENT_STATUSES.POSTED,
    })
    const saleEntries = buildPostingEntries({
      type: MOVEMENT_TYPES.USD_SALE,
      amount: 13,
      currency: CURRENCIES.USD,
      rate: 7.55,
      sourceAccountId: 'usd-cash',
      destinationAccountId: 'dinar-cash',
      status: MOVEMENT_STATUSES.POSTED,
    })

    expect(purchaseEntries[1].delta).toBe(13)
    expect(saleEntries[1].delta).toBe(98)
  })

  it('rejects normal usd transfers into dinar-only accounts', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.USD,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('عملة'))).toBe(true)
  })

  it('allows normal usd transfers between usd-compatible same-kind accounts', () => {
    const accounts = [
      createAccount({
        id: 'my-usd-cash',
        ownerName: 'أنا',
        subAccountName: 'دولار الخزنة',
        type: ACCOUNT_TYPES.CASH,
        valueKind: 'cash',
        currencyKind: CURRENCIES.USD,
        openingUsd: 150,
      }),
      createAccount({
        id: 'saeed-usd-cash',
        ownerName: 'سعيد',
        subAccountName: 'نقدي معه',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: 'receivable',
        currencyKind: CURRENCIES.USD,
      }),
    ]
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.USD,
        sourceAccountId: 'my-usd-cash',
        destinationAccountId: 'saeed-usd-cash',
      },
      accounts,
      createOpeningMovements(accounts),
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.POSTED)
  })

  it('keeps inactive accounts out of balances and posting endpoints', () => {
    const accounts = [
      createAccount({
        id: 'hidden-review',
        ownerName: 'مخفي',
        subAccountName: 'كاش',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: 'receivable',
        openingDinar: 500,
        status: ACCOUNT_STATUSES.INACTIVE,
      }),
      createAccount({
        id: 'active-cash',
        ownerName: 'أنا',
        subAccountName: 'كاش',
        type: ACCOUNT_TYPES.CASH,
        valueKind: 'cash',
      }),
    ]
    const openings = createOpeningMovements(accounts)
    const balances = summarizeBalances(accounts, openings)
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'active-cash',
        destinationAccountId: 'hidden-review',
      },
      accounts,
    )

    expect(balances.some((bucket) => bucket.account.id === 'hidden-review')).toBe(false)
    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('مخفي'))).toBe(true)
  })

  it('supports voiding a posted movement without deleting it', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 1000,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'omar-gold',
      },
      mohammadAccountCatalog,
      openings,
    )
    const withMovement = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, movement])
    expect(withMovement.dinar).toBe(21000)

    const result = voidMovement(movement, 'إدخال بالخطأ')
    expect(result.ok).toBe(true)
    const afterVoid = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, result.movement])
    expect(afterVoid.dinar).toBe(20000)
    expect(result.movement.status).toBe(MOVEMENT_STATUSES.VOIDED)
  })

  it('blocks replacing a posted movement with a review movement during edit', () => {
    const accounts = [
      createAccount({ id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', type: ACCOUNT_TYPES.CASH, valueKind: 'cash', openingDinar: 1000 }),
      createAccount({ id: 'person', ownerName: 'سعيد', subAccountName: 'كاش بيننا', type: ACCOUNT_TYPES.PERSON, valueKind: 'receivable' }),
    ]
    const openings = createOpeningMovements(accounts)
    const posted = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 400,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'cash',
        destinationAccountId: 'person',
      },
      accounts,
      openings,
    )
    const invalidEdit = postMovement(
      {
        ...posted,
        amount: 5000,
      },
      accounts,
      openings,
    )
    const validEdit = postMovement(
      {
        ...posted,
        amount: 300,
      },
      accounts,
      openings,
    )

    expect(invalidEdit.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(canCommitMovementEdit(posted, invalidEdit)).toBe(false)
    expect(canCommitMovementEdit(posted, validEdit)).toBe(true)
  })

  it('calculates usd sale and purchase as different currency effects', () => {
    const accounts = [
      createAccount({ id: 'cash-usd', ownerName: 'أنا', subAccountName: 'خزنة دولار', type: ACCOUNT_TYPES.CASH, valueKind: 'cash', currencyKind: CURRENCIES.USD, openingUsd: 200 }),
      createAccount({ id: 'bank-lyd', ownerName: 'أنا', subAccountName: 'الجمهورية', type: ACCOUNT_TYPES.BANK, valueKind: 'bank', currencyKind: CURRENCIES.DINAR, openingDinar: 2000 }),
      createAccount({ id: 'cash-usd-2', ownerName: 'أنا', subAccountName: 'خزنة دولار ثانية', type: ACCOUNT_TYPES.CASH, valueKind: 'cash', currencyKind: CURRENCIES.USD, openingUsd: 0 }),
    ]
    const openings = createOpeningMovements(accounts)
    const salePreview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'cash-usd',
        destinationAccountId: 'bank-lyd',
      },
      accounts,
      openings,
    )

    expect(salePreview.validation.ok).toBe(true)
    expect(salePreview.effects).toEqual([
      expect.objectContaining({ accountId: 'cash-usd', currency: CURRENCIES.USD, delta: -100 }),
      expect.objectContaining({ accountId: 'bank-lyd', currency: CURRENCIES.DINAR, delta: 750 }),
    ])

    const purchasePreview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_PURCHASE,
        amount: 750,
        currency: CURRENCIES.DINAR,
        rate: 7.5,
        sourceAccountId: 'bank-lyd',
        destinationAccountId: 'cash-usd-2',
      },
      accounts,
      openings,
    )

    expect(purchasePreview.validation.ok).toBe(true)
    expect(purchasePreview.effects).toEqual([
      expect.objectContaining({ accountId: 'bank-lyd', currency: CURRENCIES.DINAR, delta: -750 }),
      expect.objectContaining({ accountId: 'cash-usd-2', currency: CURRENCIES.USD, delta: 100 }),
    ])
  })

  it('does not allow usd sale or purchase without a valid exchange rate', () => {
    const preview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
      createOpeningMovements(mohammadAccountCatalog),
    )

    expect(preview.validation.ok).toBe(false)
    expect(preview.validation.errors.some((error) => error.field === 'rate')).toBe(true)
  })

  it('enforces account currency compatibility for exchange and one-sided movements', () => {
    const usdSaleFromDinarBank = postMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
    )
    const usdPurchaseIntoDinarBank = postMovement(
      {
        type: MOVEMENT_TYPES.USD_PURCHASE,
        amount: 750,
        currency: CURRENCIES.DINAR,
        rate: 7.5,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
    )
    const usdExpenseFromDinarBank = postMovement(
      {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 50,
        currency: CURRENCIES.USD,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: null,
      },
      mohammadAccountCatalog,
    )

    expect(usdSaleFromDinarBank.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(usdSaleFromDinarBank.validation.errors.some((error) => error.message.includes('حساب دولار'))).toBe(true)
    expect(usdPurchaseIntoDinarBank.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(usdPurchaseIntoDinarBank.validation.errors.some((error) => error.message.includes('حساب دولار'))).toBe(true)
    expect(usdExpenseFromDinarBank.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(usdExpenseFromDinarBank.validation.errors.some((error) => error.message.includes('عملة الحركة'))).toBe(true)
  })

  it('rejects negative amounts for normal posted movements', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: -100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.field === 'amount')).toBe(true)
  })

  it('requires a destination account for correction movements', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.CORRECTION,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: '',
        note: 'مطابقة',
      },
      mohammadAccountCatalog,
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.field === 'destinationAccountId')).toBe(true)
    expect(buildPostingEntries(movement)).toEqual([])
  })

  it('enforces the starting currency for usd sale and purchase', () => {
    const sale = postMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.DINAR,
        rate: 7.5,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
    )
    const purchase = postMovement(
      {
        type: MOVEMENT_TYPES.USD_PURCHASE,
        amount: 750,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-cash',
      },
      mohammadAccountCatalog,
    )

    expect(sale.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(purchase.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(sale.validation.errors.some((error) => error.field === 'currency')).toBe(true)
    expect(purchase.validation.errors.some((error) => error.field === 'currency')).toBe(true)
  })

  it('labels balance direction based on account kind', () => {
    const person = mohammadAccountCatalog.find((account) => account.id === 'rabee-cash')
    const bank = mohammadAccountCatalog.find((account) => account.id === 'me-jumhouria')
    const expense = mohammadAccountCatalog.find((account) => account.id === 'personal-expense')
    const asset = mohammadAccountCatalog.find((account) => account.type === ACCOUNT_TYPES.ASSET)

    expect(formatBalanceMeaning(person, -20000)).toBe('أدفع له 20,000')
    expect(formatBalanceMeaning(bank, -30000)).toBe('ناقص 30,000')
    expect(formatBalanceMeaning(expense, 100000)).toBe('تكلفة 100,000')
    expect(formatBalanceMeaning(asset, 15000)).toBe('قيمة/رصيد أصل 15,000')
  })

  it('creates dynamic accounts with validation before use', () => {
    const account = createAccount({
      ownerName: 'سعيد الجديد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
    })

    expect(account.id).toContain('سعيد-الجديد-كاش-lyd')
    expect(account.currencyKind).toBe(CURRENCIES.DINAR)
    expect(validateAccount(account, mohammadAccountCatalog).ok).toBe(true)
    expect(validateAccount({ ...account, ownerName: '' }, mohammadAccountCatalog).ok).toBe(false)
  })

  it('rejects duplicate active accounts with the same owner and detail', () => {
    const account = createAccount({
      id: 'duplicate-saeed-cash',
      ownerName: 'شخص أ',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
    })
    const inactiveAccount = createAccount({
      id: 'inactive-saeed-cash',
      ownerName: 'شخص أ',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
      status: ACCOUNT_STATUSES.INACTIVE,
    })

    expect(validateAccount(account, mohammadAccountCatalog).ok).toBe(false)
    expect(validateAccount(account, [inactiveAccount]).ok).toBe(true)
  })

  it('allows same owner and detail when account currency is different', () => {
    const dinarAccount = createAccount({
      ownerName: 'سعيد',
      subAccountName: 'نقدي معه',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
      currencyKind: CURRENCIES.DINAR,
    })
    const usdAccount = createAccount({
      ownerName: 'سعيد',
      subAccountName: 'نقدي معه',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
      currencyKind: CURRENCIES.USD,
    })

    expect(dinarAccount.id).not.toBe(usdAccount.id)
    expect(validateAccount(usdAccount, [dinarAccount]).ok).toBe(true)
  })

  it('posts a record-only movement without changing any account balance', () => {
    const accounts = [createAccount({
      id: 'cash-record-only',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      openingDinar: 1_000,
    })]
    const movements = createOpeningMovements(accounts)
    const record = postMovement({
      type: MOVEMENT_TYPES.RECORD_ONLY,
      amount: 250,
      currency: CURRENCIES.DINAR,
      note: 'وعد دفع لم يدخل الحسابات',
    }, accounts, movements)

    expect(record.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(buildPostingEntries(record)).toEqual([])
    expect(previewMovement(record, accounts, movements)).toMatchObject({ validation: { ok: true }, effects: [] })
    expect(summarizeBalances(accounts, [...movements, record])[0].dinar).toBe(1_000)
  })

  it('requires a note and rejects account links for record-only movements', () => {
    const account = createAccount({
      id: 'record-only-account',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
    })
    const missingNote = validateMovement({
      type: MOVEMENT_TYPES.RECORD_ONLY,
      amount: 100,
      currency: CURRENCIES.DINAR,
    }, [account], [])
    const linkedAccount = validateMovement({
      type: MOVEMENT_TYPES.RECORD_ONLY,
      amount: 100,
      currency: CURRENCIES.DINAR,
      note: 'تسجيل',
      sourceAccountId: account.id,
    }, [account], [])

    expect(missingNote.errors).toContainEqual(expect.objectContaining({ field: 'note' }))
    expect(linkedAccount.errors).toContainEqual(expect.objectContaining({ field: 'sourceAccountId' }))
  })

  it('does not allow a posted movement to change between financial and record-only modes', () => {
    const posted = {
      id: 'posted-income',
      type: MOVEMENT_TYPES.EXTERNAL_INCOME,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      destinationAccountId: 'cash',
    }

    expect(canCommitMovementEdit(posted, { ...posted, type: MOVEMENT_TYPES.RECORD_ONLY, destinationAccountId: null, note: 'تسجيل' })).toBe(false)
    expect(canCommitMovementEdit({ ...posted, type: MOVEMENT_TYPES.RECORD_ONLY }, posted)).toBe(false)
  })
})
