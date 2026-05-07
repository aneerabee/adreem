import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, mohammadAccountCatalog, mohammadSummaryAccounts } from './accountCatalog'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  createAccount,
  createOpeningMovements,
  formatBalanceMeaning,
  getAccountBalance,
  postMovement,
  previewMovement,
  summarizeBalances,
  voidMovement,
  validateAccount,
} from './ledgerCore'

describe('mohammad ledger core', () => {
  it('creates opening balances from the Numbers catalog without losing cash or bank separation', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const balances = summarizeBalances(mohammadAccountCatalog, openings)

    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).dinar).toBe(47164.675)
    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).usd).toBe(0.220779)
    expect(getAccountBalance('me-jumhouria', mohammadAccountCatalog, openings).dinar).toBe(-27290)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-cash').dinar).toBe(18260)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-bank').dinar).toBe(13569.99889)
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
      expect.objectContaining({ accountId: 'me-cash', before: 47164.675, delta: -500, after: 46664.675 }),
      expect.objectContaining({ accountId: 'saeed-cash', before: 18260, delta: 500, after: 18760 }),
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
      expect.objectContaining({ accountId: 'me-cash', before: 47164.675, delta: -100, after: 47064.675 }),
    ])
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
    const balance = getAccountBalance('saeed-cash', mohammadAccountCatalog, [...openings, badMovement])
    expect(balance.dinar).toBe(18260)
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
    )
    const withMovement = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, movement])
    expect(withMovement.dinar).toBe(25500)

    const result = voidMovement(movement, 'إدخال بالخطأ')
    expect(result.ok).toBe(true)
    const afterVoid = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, result.movement])
    expect(afterVoid.dinar).toBe(24500)
    expect(result.movement.status).toBe(MOVEMENT_STATUSES.VOIDED)
  })

  it('calculates usd sale and purchase as different currency effects', () => {
    const salePreview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
      createOpeningMovements(mohammadAccountCatalog),
    )

    expect(salePreview.validation.ok).toBe(true)
    expect(salePreview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-cash', currency: CURRENCIES.USD, delta: -100 }),
      expect.objectContaining({ accountId: 'me-jumhouria', currency: CURRENCIES.DINAR, delta: 750 }),
    ])

    const purchasePreview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_PURCHASE,
        amount: 750,
        currency: CURRENCIES.DINAR,
        rate: 7.5,
        sourceAccountId: 'me-jumhouria',
        destinationAccountId: 'me-cash',
      },
      mohammadAccountCatalog,
      createOpeningMovements(mohammadAccountCatalog),
    )

    expect(purchasePreview.validation.ok).toBe(true)
    expect(purchasePreview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-jumhouria', currency: CURRENCIES.DINAR, delta: -750 }),
      expect.objectContaining({ accountId: 'me-cash', currency: CURRENCIES.USD, delta: 100 }),
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

    expect(formatBalanceMeaning(person, -24942.2)).toBe('عليّ له 24,942')
    expect(formatBalanceMeaning(bank, -27290)).toBe('ناقص 27,290')
    expect(formatBalanceMeaning(expense, 112240)).toBe('تكلفة 112,240')
    expect(formatBalanceMeaning(asset, 15550)).toBe('قيمة/رصيد أصل 15,550')
  })

  it('creates dynamic accounts with validation before use', () => {
    const account = createAccount({
      ownerName: 'محمد الكيفو',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
    })

    expect(account.id).toContain('محمد-الكيفو-كاش')
    expect(validateAccount(account, mohammadAccountCatalog).ok).toBe(true)
    expect(validateAccount({ ...account, ownerName: '' }, mohammadAccountCatalog).ok).toBe(false)
  })

  it('rejects duplicate active accounts with the same owner and detail', () => {
    const account = createAccount({
      id: 'duplicate-saeed-cash',
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
    })
    const inactiveAccount = createAccount({
      id: 'inactive-saeed-cash',
      ownerName: 'سعيد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
      status: ACCOUNT_STATUSES.INACTIVE,
    })

    expect(validateAccount(account, mohammadAccountCatalog).ok).toBe(false)
    expect(validateAccount(account, [inactiveAccount]).ok).toBe(true)
  })
})
