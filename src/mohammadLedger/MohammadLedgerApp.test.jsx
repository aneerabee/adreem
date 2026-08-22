import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { COUNTERPARTY_ACCOUNT_KINDS } from './accountConfig.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createAccount, createOpeningMovements, postMovement, previewMovement } from './ledgerCore.js'
import {
  AccountProfile,
  NetPositionPanel,
  SeparateLedgerPanel,
  AccountRow,
  AccountSearchSelect,
  AccountClassificationEditorFields,
  ExternalAccountCard,
  HistoryMovementRow,
  ReviewAccountCard,
  CounterpartyCard,
  CounterpartyList,
  accountBalanceChip,
  accountProfileMovements,
  areMergeAccountsCompatible,
  accountClassificationMovementErrors,
  accountEditChanges,
  accountReviewSelection,
  buildBalanceOverview,
  buildPeopleAccountViews,
  cancelMovementConfirmation,
  claimSubmission,
  filterMovementHistory,
  filterCounterpartyGroups,
  filterCounterpartyGroupsByQuery,
  unifiedCounterpartyGroups,
  mergeAccountsConfirmation,
  mergeAccountReferenceErrors,
  mergeLedgerAccountState,
  mergeMovementHistoryPages,
  mergeMovementPageAttachments,
  mergeReviewMovementPage,
  money,
  movementStatusLabel,
  movementHistoryForPreview,
  normalizeLocalizedNumericInput,
  parseMoneyAmount,
  parseWholeAmount,
  pendingUploadedOrphanPaths,
  prepareAccountClassificationUpdate,
  releaseSubmission,
  saveFailureMessage,
  signedMoney,
  storageTextForStatus,
} from './MohammadLedgerApp.jsx'
import { setActiveUiLanguage, stripUiDataProtection } from './uiTranslation.js'

const previousReact = globalThis.React

beforeAll(() => {
  globalThis.React = React
})

afterAll(() => {
  globalThis.React = previousReact
})

describe('MohammadLedgerApp movement account balances', () => {
  it('shows only the currency used by the current movement side', () => {
    const account = { valueKind: VALUE_KINDS.CASH }
    const bucket = { dinar: 50_000, usd: 500 }

    expect(accountBalanceChip(account, bucket, CURRENCIES.USD)).toEqual({ tone: 'positive', text: '500 $' })
    expect(accountBalanceChip(account, bucket, CURRENCIES.DINAR)).toEqual({ tone: 'positive', text: '50,000 د.ل' })
    expect(accountBalanceChip(account, { dinar: 50_000, usd: 0 }, CURRENCIES.USD)).toEqual({ tone: 'zero', text: '0 $' })
  })
})

describe('MohammadLedgerApp net position controls', () => {
  it('reveals raw currencies, the converted result, and every included account', () => {
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <NetPositionPanel
        position={{
          dinar: 10_500,
          usd: 100,
          accountCount: 2,
          contributions: [
            { accountId: 'cash', account: { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }, dinar: 12_000, usd: 0 },
            { accountId: 'friend', account: { id: 'friend', ownerName: 'سعيد', subAccountName: 'كاش بيننا', valueKind: VALUE_KINDS.RECEIVABLE }, dinar: -1_500, usd: 100 },
          ],
        }}
        rate="7.5"
        targetCurrency={CURRENCIES.DINAR}
        onRateChange={() => {}}
        onTargetCurrencyChange={() => {}}
        onClose={() => {}}
      />,
    ))

    expect(markup).toContain('الصافي')
    expect(markup).toContain('10,500 د.ل')
    expect(markup).toContain('100 $')
    expect(markup).toContain('11,250 د.ل')
    expect(markup).toContain('كاش عندي')
    expect(markup).toContain('سعيد')
  })
})

describe('MohammadLedgerApp separate accounts', () => {
  it('offers existing names while keeping a new name available in the dedicated editor', () => {
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <SeparateLedgerPanel
        records={[]}
        names={['شخص أ', 'شركة جديدة']}
        totals={{
          [CURRENCIES.DINAR]: { receivable: 0, payable: 0 },
          [CURRENCIES.USD]: { receivable: 0, payable: 0 },
        }}
        query=""
        draft={{ relatedName: 'شخص', recordDirection: 'receivable', amount: '', currency: CURRENCIES.DINAR, note: '' }}
        editorOpen
        editingId=""
        isSaving={false}
        hasMore={false}
        isLoadingMore={false}
        onQueryChange={() => {}}
        onDraftChange={() => {}}
        onOpenEditor={() => {}}
        onCloseEditor={() => {}}
        onSave={() => {}}
        onEdit={() => {}}
        onVoid={() => {}}
        onLoadMore={() => {}}
      />,
    ))

    expect(markup).toContain('أسماء موجودة')
    expect(markup).toContain('شخص أ')
    expect(markup).not.toContain('شركة جديدة')
    expect(markup).not.toContain('فصله عن الصافي')
  })
})

describe('MohammadLedgerApp movement account picker', () => {
  it('distinguishes the same counterparty cash, cheque, and dollar accounts in quick and search results', () => {
    const sharedAccount = {
      ownerName: 'سعيد',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const accounts = [
      { ...sharedAccount, id: 'saeed-cash', subAccountName: 'كاش بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR },
      { ...sharedAccount, id: 'saeed-cheque', subAccountName: 'شيك بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR },
      { ...sharedAccount, id: 'saeed-usd', subAccountName: 'دولار بيننا', currencyKind: ACCOUNT_CURRENCY_KINDS.USD, counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD },
    ]
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <AccountSearchSelect
        label="اختر الطرف"
        value={null}
        accounts={accounts}
        onChange={() => {}}
        allowEmpty={false}
        preferredAccountIds={['saeed-cash', 'saeed-cheque']}
        balanceByAccountId={new Map([
          ['saeed-cash', { dinar: 12_000, usd: 0 }],
          ['saeed-cheque', { dinar: -4_500, usd: 0 }],
          ['saeed-usd', { dinar: 0, usd: 700 }],
        ])}
      />,
    ))

    expect(markup).toContain('ml3-picker-channel-tag is-person-cash')
    expect(markup).toContain('ml3-picker-channel-tag is-person-bank')
    expect(markup).toContain('ml3-picker-channel-tag is-person-usd')
    expect(markup).toContain('lucide-banknote')
    expect(markup).toContain('lucide-landmark')
    expect(markup).toContain('lucide-circle-dollar-sign')
    expect(markup).toContain('كاش بيننا')
    expect(markup).toContain('شيك بيننا')
    expect(markup).toContain('دولار')
    expect(markup).toContain('12,000 د.ل')
    expect(markup).toContain('أدفع 4,500 د.ل')
    expect(markup).toContain('700 $')
  })
})

describe('MohammadLedgerApp compact history rows', () => {
  it('keeps the exchange result and rate visible without restoring the full posting breakdown', () => {
    const accountById = new Map([
      ['usd', { id: 'usd', ownerName: 'أنا', subAccountName: 'دولار', valueKind: VALUE_KINDS.CASH }],
      ['cash', { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }],
    ])
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <HistoryMovementRow
        accountById={accountById}
        movement={{
          id: 'sale-1',
          type: MOVEMENT_TYPES.USD_SALE,
          status: MOVEMENT_STATUSES.POSTED,
          amount: 100,
          currency: CURRENCIES.USD,
          rate: 7,
          sourceAccountId: 'usd',
          destinationAccountId: 'cash',
        }}
      />,
    ))

    expect(markup).toContain('100 $')
    expect(markup).toContain('↔ 700 د.ل')
    expect(markup).toContain('× 7')
  })

  it('keeps review errors visible on incomplete movements', () => {
    const markup = renderToStaticMarkup(
      <HistoryMovementRow
        accountById={new Map()}
        movement={{
          id: 'review-1',
          type: MOVEMENT_TYPES.TRANSFER,
          status: MOVEMENT_STATUSES.NEEDS_REVIEW,
          amount: 100,
          currency: CURRENCIES.DINAR,
          validation: { errors: [{ field: 'destinationAccountId', message: 'اختر المستلم' }] },
        }}
      />,
    )

    expect(markup).toContain('ناقص')
    expect(markup).toContain('اختر المستلم')
  })
})

describe('MohammadLedgerApp movement editing', () => {
  it('previews an edit after removing the stored version of the movement', () => {
    const accounts = [
      createAccount({
        id: 'cash',
        ownerName: 'أنا',
        subAccountName: 'كاش',
        type: ACCOUNT_TYPES.CASH,
        valueKind: VALUE_KINDS.CASH,
        currencyKind: CURRENCIES.DINAR,
        openingDinar: 1_000,
      }),
      createAccount({
        id: 'bank',
        ownerName: 'أنا',
        subAccountName: 'مصرف',
        type: ACCOUNT_TYPES.BANK,
        valueKind: VALUE_KINDS.BANK,
        currencyKind: CURRENCIES.DINAR,
        openingDinar: 500,
      }),
    ]
    const openingMovements = createOpeningMovements(accounts)
    const original = postMovement({
      id: 'movement-1',
      type: MOVEMENT_TYPES.CASH_DEPOSIT,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'bank',
    }, accounts, openingMovements)

    const preview = previewMovement(
      { ...original, amount: 150 },
      accounts,
      movementHistoryForPreview([...openingMovements, original], original.id),
    )

    expect(preview.validation.ok).toBe(true)
    expect(preview.effects.find((effect) => effect.accountId === 'cash')).toMatchObject({
      before: 1_000,
      delta: -150,
      after: 850,
    })
    expect(preview.effects.find((effect) => effect.accountId === 'bank')).toMatchObject({
      before: 500,
      delta: 150,
      after: 650,
    })
  })
})

describe('MohammadLedgerApp account review', () => {
  it('keeps the selected currency only for account kinds that use currency', () => {
    expect(accountReviewSelection(
      `${ACCOUNT_TYPES.PERSON}|${VALUE_KINDS.RECEIVABLE}`,
      ACCOUNT_CURRENCY_KINDS.USD,
    )).toMatchObject({
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })

    expect(accountReviewSelection(
      `${ACCOUNT_TYPES.ASSET}|${VALUE_KINDS.ASSET}`,
      ACCOUNT_CURRENCY_KINDS.USD,
    ).currencyKind).toBe(ACCOUNT_CURRENCY_KINDS.DINAR)
  })

  it('renders the currency choice for creation and eligible corrections', () => {
    const externalMarkup = renderToStaticMarkup(
      <ExternalAccountCard
        account={{ ownerName: 'شركة طويلة الاسم', subAccountName: 'كاش بيننا', notes: '' }}
        onCreate={() => {}}
        onIgnore={() => {}}
      />,
    )
    const reviewMarkup = renderToStaticMarkup(
      <ReviewAccountCard
        bucket={{
          account: {
            id: 'review-person',
            ownerName: 'محمد',
            subAccountName: 'كاش بيننا',
            type: ACCOUNT_TYPES.PERSON,
            valueKind: VALUE_KINDS.RECEIVABLE,
            currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
            status: ACCOUNT_STATUSES.NEEDS_REVIEW,
          },
          dinar: 0,
          usd: 0,
        }}
        activeAccounts={[]}
        onResolve={() => {}}
        onMerge={() => {}}
        onDisable={() => {}}
      />,
    )

    expect(externalMarkup).toContain('name="currencyKind"')
    expect(reviewMarkup).toContain('name="currencyKind"')
    expect(reviewMarkup).toContain(`value="${ACCOUNT_CURRENCY_KINDS.USD}" selected=""`)
  })

  it('rejects a classification that makes a related posted movement invalid', () => {
    const cash = createAccount({
      id: 'cash',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingDinar: 100,
    })
    const movements = createOpeningMovements([cash])
    const invalidAccounts = [{ ...cash, type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT }]

    expect(accountClassificationMovementErrors('cash', invalidAccounts, movements)).not.toHaveLength(0)
  })

  it('offers currency correction for financial accounts', () => {
    const account = createAccount({
      id: 'owner-balance',
      ownerName: 'مالك',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })

    const markup = renderToStaticMarkup(<AccountClassificationEditorFields account={account} />)

    expect(markup).toContain('name="currencyKind"')
    expect(markup).toContain(`value="${ACCOUNT_CURRENCY_KINDS.DINAR}" selected=""`)
    expect(markup).toContain(`value="${ACCOUNT_CURRENCY_KINDS.USD}"`)
  })

  it('shows every used account field as fixed', () => {
    const account = createAccount({
      id: 'used-person',
      ownerName: 'سيف',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })

    const markup = renderToStaticMarkup(<AccountClassificationEditorFields account={account} structureLocked accountLocked />)

    expect(markup).toContain('بيانات الحساب ثابتة بعد أول حركة')
    expect(markup.match(/disabled=""/g)).toHaveLength(4)
    expect(markup).toContain('name="classification"')
    expect(markup).toContain('name="currencyKind"')
  })

  it('updates an eligible account currency and preserves non-financial currency data', () => {
    const person = createAccount({
      id: 'person',
      ownerName: 'مالك',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const accepted = prepareAccountClassificationUpdate({
      accounts: [person],
      movements: [],
      accountId: person.id,
      ownerName: person.ownerName,
      subAccountName: person.subAccountName,
      classificationValue: `${ACCOUNT_TYPES.PERSON}|${VALUE_KINDS.RECEIVABLE}`,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
      updatedAt: '2026-08-20T10:00:00.000Z',
    })
    expect(accepted).toMatchObject({
      ok: true,
      account: { currencyKind: ACCOUNT_CURRENCY_KINDS.USD },
    })

    const asset = {
      ...createAccount({
        id: 'asset',
        ownerName: 'أصل',
        type: ACCOUNT_TYPES.ASSET,
        valueKind: VALUE_KINDS.ASSET,
      }),
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    }
    const preserved = prepareAccountClassificationUpdate({
      accounts: [asset],
      movements: [],
      accountId: asset.id,
      ownerName: asset.ownerName,
      subAccountName: asset.subAccountName,
      classificationValue: `${ACCOUNT_TYPES.ASSET}|${VALUE_KINDS.ASSET}`,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    expect(preserved).toMatchObject({
      ok: true,
      account: { currencyKind: ACCOUNT_CURRENCY_KINDS.USD },
    })
  })

  it('rejects a currency change that conflicts with posted movement history', () => {
    const cash = createAccount({
      id: 'cash-history',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      openingDinar: 500,
    })
    const person = createAccount({
      id: 'person-history',
      ownerName: 'مالك',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    })
    const accounts = [cash, person]
    const openingMovements = createOpeningMovements(accounts)
    const movement = postMovement({
      id: 'posted-history',
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: cash.id,
      destinationAccountId: person.id,
    }, accounts, openingMovements)

    const result = prepareAccountClassificationUpdate({
      accounts,
      movements: [...openingMovements, movement],
      accountId: person.id,
      ownerName: person.ownerName,
      subAccountName: person.subAccountName,
      classificationValue: `${ACCOUNT_TYPES.PERSON}|${VALUE_KINDS.RECEIVABLE}`,
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    })

    expect(movement.status).toBe(MOVEMENT_STATUSES.POSTED)
    expect(result).toMatchObject({ ok: false, reason: 'account-structure-locked' })
    expect(result.errors).not.toHaveLength(0)
  })
})

describe('MohammadLedgerApp people account views', () => {
  it('keeps own money, receivables, and payables separated in both currencies', () => {
    const bucket = (id, valueKind, dinar, usd) => ({
      account: { id, valueKind },
      dinar,
      usd,
    })

    expect(buildBalanceOverview([
      bucket('cash', VALUE_KINDS.CASH, 1500, 0),
      bucket('bank-usd', VALUE_KINDS.BANK, 0, 300),
      bucket('person-dinar', VALUE_KINDS.RECEIVABLE, 700, 0),
      bucket('person-usd', VALUE_KINDS.RECEIVABLE, 0, -80),
      bucket('asset', VALUE_KINDS.ASSET, 9000, 0),
    ])).toEqual({
      cash: { dinar: 1500, usd: 0 },
      bank: { dinar: 0, usd: 300 },
      money: { dinar: 1500, usd: 300 },
      receivable: { dinar: 700, usd: 0 },
      payable: { dinar: 0, usd: 80 },
    })
  })

  it('keeps zero-balance people out of current balances but available in the full directory', () => {
    const person = (id, currencyKind) => ({
      id,
      ownerName: id,
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind,
      status: ACCOUNT_STATUSES.ACTIVE,
    })
    const views = buildPeopleAccountViews([
      { account: person('dinar-positive', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: 500, usd: 0 },
      { account: person('usd-negative', ACCOUNT_CURRENCY_KINDS.USD), dinar: 0, usd: -250 },
      { account: person('zero-person', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: 0, usd: 0 },
    ])

    expect(views.positive.map((bucket) => bucket.account.id)).toEqual(['dinar-positive'])
    expect(views.negative.map((bucket) => bucket.account.id)).toEqual(['usd-negative'])
    expect(views.withBalance.map((bucket) => bucket.account.id)).not.toContain('zero-person')
    expect(views.all.map((bucket) => bucket.account.id)).toContain('zero-person')
  })

  it('shows the direction of a USD person balance instead of a false zero', () => {
    const markup = renderToStaticMarkup(
      <AccountRow
        bucket={{
          account: {
            id: 'usd-person',
            ownerName: 'سعيد',
            subAccountName: 'كاش بيننا',
            type: ACCOUNT_TYPES.PERSON,
            valueKind: VALUE_KINDS.RECEIVABLE,
            currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
            status: ACCOUNT_STATUSES.ACTIVE,
          },
          dinar: 0,
          usd: -250,
        }}
      />,
    )

    expect(markup).toContain('is-negative')
    expect(markup).toContain('أدفع له')
    expect(markup).not.toContain('>صفر<')
  })

  it('keeps each currency direction visible in compact mixed-currency balances', () => {
    const mixedBucket = {
      account: {
        id: 'mixed-person',
        ownerName: 'سعيد',
        subAccountName: 'كاش بيننا',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        currencyKind: ACCOUNT_CURRENCY_KINDS.MULTI,
        status: ACCOUNT_STATUSES.ACTIVE,
      },
      dinar: 500,
      usd: -250,
    }
    const markup = renderToStaticMarkup(
      <AccountRow
        compactValue
        bucket={mixedBucket}
      />,
    )
    const views = buildPeopleAccountViews([mixedBucket])

    expect(markup).toContain('class="is-positive">لي 500 د.ل')
    expect(markup).toContain('class="is-negative">عليّ 250 $')
    expect(views.positive).toEqual([expect.objectContaining({ dinar: 500, usd: 0 })])
    expect(views.negative).toEqual([expect.objectContaining({ dinar: 0, usd: -250 })])
    expect(views.withBalance).toHaveLength(1)
    expect(views.all).toHaveLength(1)
  })

  it('filters whole people without hiding the rest of a matched person balances', () => {
    const group = (id, rows, receivable, payable) => ({ id, ownerName: id, rows, receivable, payable })
    const row = (counterpartyKind, amount, currencyKind = ACCOUNT_CURRENCY_KINDS.DINAR) => ({
      account: { counterpartyKind, currencyKind },
      dinar: currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 0 : amount,
      usd: currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? amount : 0,
    })
    const mixed = group('mixed', [
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 1_200),
      row(COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, -450),
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 80, ACCOUNT_CURRENCY_KINDS.USD),
    ], { dinar: 1_200, usd: 80 }, { dinar: 450, usd: 0 })
    const chequeOnly = group('cheque', [
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 0),
      row(COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, -300),
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 0, ACCOUNT_CURRENCY_KINDS.USD),
    ], { dinar: 0, usd: 0 }, { dinar: 300, usd: 0 })
    const zero = group('zero', [
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 0),
      row(COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, 0),
      row(COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 0, ACCOUNT_CURRENCY_KINDS.USD),
    ], { dinar: 0, usd: 0 }, { dinar: 0, usd: 0 })
    const groups = [mixed, chequeOnly, zero]

    expect(filterCounterpartyGroups(groups, 'receivable').map((item) => item.id)).toEqual(['mixed'])
    expect(filterCounterpartyGroups(groups, 'payable').map((item) => item.id)).toEqual(['mixed', 'cheque'])
    expect(filterCounterpartyGroups(groups, COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR).map((item) => item.id)).toEqual(['mixed'])
    expect(filterCounterpartyGroups(groups, COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR).map((item) => item.id)).toEqual(['mixed', 'cheque'])
    expect(filterCounterpartyGroups(groups, COUNTERPARTY_ACCOUNT_KINDS.CASH_USD).map((item) => item.id)).toEqual(['mixed'])
    expect(filterCounterpartyGroups(groups, 'zero').map((item) => item.id)).toEqual(['zero'])
    expect(filterCounterpartyGroups(groups, 'all')).toBe(groups)
  })

  it('searches by one account while preserving every balance channel for the matched person', () => {
    const group = {
      id: 'person:mohammad',
      ownerName: 'محمد',
      receivable: { dinar: 700, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [
        { account: { ownerName: 'محمد', subAccountName: 'كاش بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR } },
        { account: { ownerName: 'محمد', subAccountName: 'شيك بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR } },
        { account: { ownerName: 'محمد', subAccountName: 'دولار بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD } },
      ],
    }

    const byName = filterCounterpartyGroupsByQuery([group], 'محمد')
    const byChannel = filterCounterpartyGroupsByQuery([group], 'شيك')

    expect(byName).toEqual([group])
    expect(byName[0].rows).toHaveLength(3)
    expect(byChannel).toEqual([group])
    expect(byChannel[0].rows).toHaveLength(3)
  })

  it('finds a settled person through the unified people search without a second directory', () => {
    const settled = {
      id: 'person:settled',
      ownerName: 'شخص مسكر',
      receivable: { dinar: 0, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [{ account: { ownerName: 'شخص مسكر', subAccountName: 'كاش بيننا' }, dinar: 0, usd: 0 }],
    }
    const active = {
      id: 'person:active',
      ownerName: 'شخص نشط',
      receivable: { dinar: 500, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [{ account: { ownerName: 'شخص نشط', subAccountName: 'كاش بيننا' }, dinar: 500, usd: 0 }],
    }
    const views = { all: [active, settled], withBalance: [active] }

    expect(unifiedCounterpartyGroups(views).map((group) => group.id)).toEqual(['person:active'])
    expect(unifiedCounterpartyGroups(views, 'مسكر').map((group) => group.id)).toEqual(['person:settled'])
  })

  it('separates cash, cheque, and dollar balances before opening a person', () => {
    const account = (id, counterpartyKind, subAccountName, currencyKind) => ({
      id,
      ownerName: 'سعيد',
      subAccountName,
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind,
      counterpartyKind,
      status: ACCOUNT_STATUSES.ACTIVE,
    })
    const group = {
      id: 'person:saeed',
      ownerName: 'سعيد',
      receivable: { dinar: 1_200, usd: 80 },
      payable: { dinar: 450, usd: 0 },
      rows: [
        { account: account('cash', COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 'كاش بيننا', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: 1_200, usd: 0 },
        { account: account('cheque', COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, 'شيك بيننا', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: -450, usd: 0 },
        { account: account('usd', COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 'دولار بيننا', ACCOUNT_CURRENCY_KINDS.USD), dinar: 0, usd: 80 },
      ],
    }

    const markup = stripUiDataProtection(renderToStaticMarkup(<CounterpartyCard group={group} />))

    expect(markup).toContain('is-balances-view')
    expect(markup).toContain('adreem-counterparty-channel-preview')
    expect(markup).toContain('is-cash-dinar is-positive')
    expect(markup).toContain('is-cheque-dinar is-negative')
    expect(markup).toContain('is-cash-usd is-positive')
    expect(markup.match(/لي 1,200 د\.ل/g)).toHaveLength(1)
    expect(markup.match(/عليّ 450 د\.ل/g)).toHaveLength(1)
    expect(markup.match(/لي 80 \$/g)).toHaveLength(1)
  })

  it('shows a settled search result in the same people card without empty balance rows', () => {
    const group = {
      id: 'person:zero',
      ownerName: 'شخص جديد',
      receivable: { dinar: 0, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [{
        account: {
          id: 'zero-cash',
          ownerName: 'شخص جديد',
          subAccountName: 'كاش بيننا',
          type: ACCOUNT_TYPES.PERSON,
          valueKind: VALUE_KINDS.RECEIVABLE,
          currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
          counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR,
          status: ACCOUNT_STATUSES.ACTIVE,
        },
        dinar: 0,
        usd: 0,
      }],
    }

    const markup = stripUiDataProtection(renderToStaticMarkup(<CounterpartyCard group={group} />))

    expect(markup).toContain('is-balances-view')
    expect(markup).toContain('مسكر')
    expect(markup).not.toContain('adreem-counterparty-channel-preview')
  })

  it('spotlights one person and reveals all three balances while dimming the rest', () => {
    const account = (id, counterpartyKind, subAccountName, currencyKind) => ({
      id,
      ownerName: id.startsWith('first') ? 'سعيد' : 'إدريس',
      subAccountName,
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind,
      counterpartyKind,
      status: ACCOUNT_STATUSES.ACTIVE,
    })
    const first = {
      id: 'person:first',
      ownerName: 'سعيد',
      receivable: { dinar: 1_200, usd: 80 },
      payable: { dinar: 450, usd: 0 },
      rows: [
        { account: account('first-cash', COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 'كاش بيننا', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: 1_200, usd: 0 },
        { account: account('first-cheque', COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, 'شيك بيننا', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: -450, usd: 0 },
        { account: account('first-usd', COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, 'دولار بيننا', ACCOUNT_CURRENCY_KINDS.USD), dinar: 0, usd: 80 },
      ],
    }
    const second = {
      id: 'person:second',
      ownerName: 'إدريس',
      receivable: { dinar: 300, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [{ account: account('second-cash', COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, 'كاش بيننا', ACCOUNT_CURRENCY_KINDS.DINAR), dinar: 300, usd: 0 }],
    }
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <CounterpartyList groups={[first, second]} focusedId={first.id} hideHeader />,
    ))

    expect(markup).toContain('adreem-counterparty-list has-focus')
    expect(markup).toContain('is-mixed is-balances-view is-focused')
    expect(markup).toContain('is-receivable is-balances-view is-dimmed')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('كاش بيننا')
    expect(markup).toContain('شيك بيننا')
    expect(markup).toContain('دولار')
    expect(markup).toContain('لي 1,200 د.ل')
    expect(markup).toContain('عليّ 450 د.ل')
    expect(markup).toContain('لي 80 $')
  })

  it('describes account edits using clear before and after values', () => {
    const before = {
      ownerName: 'سعيد',
      subAccountName: 'كاش بيننا',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
    }
    const after = {
      ...before,
      ownerName: 'شركة سعيد',
      subAccountName: 'شيك بيننا',
      currencyKind: ACCOUNT_CURRENCY_KINDS.USD,
    }

    expect(accountEditChanges(before, after)).toEqual([
      expect.objectContaining({ key: 'name', before: 'سعيد', after: 'شركة سعيد' }),
      expect.objectContaining({ key: 'type', before: 'شخص أو جهة · كاش بيننا', after: 'شخص أو جهة · شيك بيننا' }),
      expect.objectContaining({ key: 'currency', before: 'دينار', after: 'دولار' }),
    ])
  })
})

describe('MohammadLedgerApp English user data protection', () => {
  it('translates standard account details but preserves custom details', () => {
    setActiveUiLanguage('en')
    try {
      const account = {
        id: 'person-detail',
        ownerName: 'محمد',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
        status: ACCOUNT_STATUSES.ACTIVE,
      }
      const custom = stripUiDataProtection(renderToStaticMarkup(
        <AccountRow bucket={{ account: { ...account, subAccountName: 'دخل' }, dinar: 0, usd: 0 }} />,
      ))
      const standard = stripUiDataProtection(renderToStaticMarkup(
        <AccountRow bucket={{ account: { ...account, subAccountName: 'كاش بيننا' }, dinar: 0, usd: 0 }} />,
      ))

      expect(custom).toContain('>دخل · Dinar<')
      expect(custom).not.toContain('>Income · Dinar<')
      expect(standard).toContain('>Cash between us · Dinar<')
    } finally {
      setActiveUiLanguage('ar')
    }
  })

  it('keeps dictionary-colliding account names and notes unchanged', () => {
    setActiveUiLanguage('en')
    try {
      const markup = stripUiDataProtection(renderToStaticMarkup(
        <ReviewAccountCard
          bucket={{
            account: {
              id: 'protected-account',
              ownerName: 'دخل',
              subAccountName: 'كاش بيننا',
              notes: 'مالك',
              type: ACCOUNT_TYPES.PERSON,
              valueKind: VALUE_KINDS.RECEIVABLE,
              currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
              status: ACCOUNT_STATUSES.NEEDS_REVIEW,
            },
            dinar: 0,
            usd: 0,
          }}
          activeAccounts={[]}
          onResolve={() => {}}
          onMerge={() => {}}
          onDisable={() => {}}
        />,
      ))

      expect(markup).toContain('>دخل<')
      expect(markup).toContain('>مالك<')
      expect(markup).not.toContain('>Income<')
      expect(markup).not.toContain('>Owner<')
    } finally {
      setActiveUiLanguage('ar')
    }
  })

  it('translates confirmations while preserving merge account names', () => {
    setActiveUiLanguage('en')
    try {
      const source = { ownerName: 'دخل', type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT }
      const target = { ownerName: 'مالك', type: ACCOUNT_TYPES.PROJECT, valueKind: VALUE_KINDS.PROJECT }
      const mergeMessage = stripUiDataProtection(mergeAccountsConfirmation(source, target))
      const cancelMessage = cancelMovementConfirmation({ type: MOVEMENT_TYPES.TRANSFER, amount: 1200, currency: CURRENCIES.DINAR })

      expect(mergeMessage).toContain('Merge account')
      expect(mergeMessage).toContain('دخل')
      expect(mergeMessage).toContain('مالك')
      expect(mergeMessage).not.toContain('Income')
      expect(mergeMessage).not.toContain('Owner')
      expect(cancelMessage).toBe('Cancel Transfer worth 1,200 LYD? The entry will remain visible in history.')
    } finally {
      setActiveUiLanguage('ar')
    }
  })
})

describe('MohammadLedgerApp cloud state', () => {
  it('reports terminal save failures without promising another automatic retry', () => {
    expect(storageTextForStatus('failed', 'api')).toBe('فشل الحفظ')
    expect(saveFailureMessage({ status: 409 }, null)).toContain('أعد تحميل الصفحة')
    expect(saveFailureMessage({ status: 409 }, null)).not.toContain('سيحاول النظام تلقائيًا')
    expect(saveFailureMessage({}, 3_000)).toContain('3 ث')
  })

  it('selects only newly uploaded paths that belong to the permanently failed snapshot', () => {
    expect(pendingUploadedOrphanPaths({
      attachments: [
        { storagePath: 'owner/ledger/failed.pdf' },
        { storagePath: 'owner/ledger/existing.pdf' },
      ],
    }, [
      'owner/ledger/failed.pdf',
      'owner/ledger/newer.pdf',
      'owner/ledger/failed.pdf',
    ])).toEqual(['owner/ledger/failed.pdf'])
  })
})

describe('MohammadLedgerApp localized money', () => {
  it('normalizes Arabic and Persian digits with localized separators', () => {
    expect(normalizeLocalizedNumericInput('١٬٢٣٤٫٥٠', { allowDecimal: true })).toBe('1234.50')
    expect(normalizeLocalizedNumericInput('۱٬۲۳۴٫۵۰', { allowDecimal: true })).toBe('1234.50')
    expect(parseMoneyAmount('۱۲۳٫۴۵', CURRENCIES.USD)).toBe(123)
  })

  it('does not concatenate a decimal fraction into a whole amount', () => {
    expect(normalizeLocalizedNumericInput('10.5')).toBe('10')
    expect(parseWholeAmount('10.5')).toBe(11)
    expect(parseWholeAmount('١٠٫٥')).not.toBe(105)
  })

  it('keeps all money amounts whole while rates may remain decimal', () => {
    expect(money(10.5, CURRENCIES.USD)).toBe('11 $')
    expect(signedMoney(-1.6, CURRENCIES.USD)).toBe('-2 $')
  })
})

describe('MohammadLedgerApp history filtering', () => {
  const movements = [
    { id: 'fuel-truck', dimensionId: 'truck', expenseCategoryId: 'fuel' },
    { id: 'repair-truck', dimensionId: 'truck', expenseCategoryId: 'repair' },
    { id: 'fuel-office', dimensionId: 'office', expenseCategoryId: 'fuel' },
  ]

  it('filters by the stored dimension and expense category identifiers', () => {
    expect(filterMovementHistory({ movements, dimensionId: 'truck' }).map((movement) => movement.id)).toEqual(['fuel-truck', 'repair-truck'])
    expect(filterMovementHistory({ movements, expenseCategoryId: 'fuel' }).map((movement) => movement.id)).toEqual(['fuel-truck', 'fuel-office'])
    expect(filterMovementHistory({ movements, dimensionId: 'truck', expenseCategoryId: 'fuel' }).map((movement) => movement.id)).toEqual(['fuel-truck'])
  })

  it('merges paginated history by id and keeps the newest database sequence first', () => {
    expect(mergeMovementHistoryPages(
      [{ id: 'newest', databaseSequence: 10 }, { id: 'same', databaseSequence: 9, note: 'old' }],
      [{ id: 'same', databaseSequence: 9, note: 'fresh' }, { id: 'older', databaseSequence: 8 }],
    )).toEqual([
      { id: 'newest', databaseSequence: 10 },
      { id: 'same', databaseSequence: 9, note: 'fresh' },
      { id: 'older', databaseSequence: 8 },
    ])
  })

  it('merges page attachments into the web extras without loss or duplication', () => {
    const currentAttachment = { id: 'current', movementId: 'new', updatedAt: '2026-08-20T12:00:00.000Z' }
    const extras = { dimensions: [], attachments: [currentAttachment] }

    const merged = mergeMovementPageAttachments(extras, [
      { ...currentAttachment, updatedAt: '2026-08-20T11:00:00.000Z' },
      { id: 'older-page', movementId: 'old', updatedAt: '2026-08-19T12:00:00.000Z' },
    ])

    expect(merged.attachments).toEqual([
      currentAttachment,
      { id: 'older-page', movementId: 'old', updatedAt: '2026-08-19T12:00:00.000Z' },
    ])
    expect(mergeMovementPageAttachments(merged, [merged.attachments[1]])).toBe(merged)
  })

  it('merges review pages into movement state without duplicates and preserves the server total', () => {
    const first = mergeReviewMovementPage({
      movements: [
        { id: 'existing', databaseSequence: 12, note: 'old' },
        { id: 'unrelated', databaseSequence: 13 },
        { id: 'bootstrap-review', databaseSequence: 11, status: MOVEMENT_STATUSES.NEEDS_REVIEW },
      ],
    }, {
      revision: 7,
      movements: [
        { id: 'existing', databaseSequence: 12, note: 'fresh' },
        { id: 'review-older', databaseSequence: 10, status: MOVEMENT_STATUSES.NEEDS_REVIEW },
      ],
      page: { total: 3, hasMore: true, nextCursor: 10, limit: 2 },
    }, 7, true)

    expect(first.page).toMatchObject({ revision: 7, total: 3, loaded: 2, hasMore: true, nextCursor: 10 })
    expect(first.movements.filter((movement) => movement.id === 'existing')).toEqual([
      { id: 'existing', databaseSequence: 12, note: 'fresh' },
    ])
    expect(first.movements.find((movement) => movement.id === 'review-older')).toMatchObject({ status: MOVEMENT_STATUSES.NEEDS_REVIEW })
    expect(first.movements.find((movement) => movement.id === 'bootstrap-review')).toBeUndefined()

    const next = mergeReviewMovementPage(first, {
      revision: 7,
      movements: [
        { id: 'review-older', databaseSequence: 10, status: MOVEMENT_STATUSES.NEEDS_REVIEW },
        { id: 'review-oldest', databaseSequence: 8, status: MOVEMENT_STATUSES.NEEDS_REVIEW },
      ],
      page: { total: null, hasMore: false, nextCursor: 8, limit: 2 },
    }, 7)

    expect(next.page).toMatchObject({ total: 3, loaded: 3, hasMore: false })
    expect(new Set(next.movements.map((movement) => movement.id)).size).toBe(next.movements.length)
  })

  it('rejects stale review pages and pages from another ledger revision', () => {
    expect(mergeReviewMovementPage({}, { stale: true, revision: 4 }, 4, true)).toBeNull()
    expect(mergeReviewMovementPage({}, { revision: 5, movements: [{ id: 'late' }] }, 4, true)).toBeNull()
  })

  it('shows every related movement status consistently in the account profile', () => {
    const account = {
      id: 'cash',
      ownerName: 'أنا',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const destination = {
      id: 'person',
      ownerName: 'محمد',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      currencyKind: CURRENCIES.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const movements = [
      { id: 'posted', type: MOVEMENT_TYPES.TRANSFER, amount: 10, currency: CURRENCIES.DINAR, sourceAccountId: 'cash', destinationAccountId: 'person', status: MOVEMENT_STATUSES.POSTED, createdAt: '2026-08-20T10:00:00.000Z' },
      { id: 'review', type: MOVEMENT_TYPES.EXPENSE, amount: 20, currency: CURRENCIES.DINAR, sourceAccountId: 'cash', status: MOVEMENT_STATUSES.NEEDS_REVIEW, createdAt: '2026-08-20T11:00:00.000Z' },
      { id: 'voided', type: MOVEMENT_TYPES.TRANSFER, amount: 30, currency: CURRENCIES.DINAR, sourceAccountId: 'cash', destinationAccountId: 'person', status: MOVEMENT_STATUSES.VOIDED, createdAt: '2026-08-20T12:00:00.000Z' },
    ]

    expect(accountProfileMovements(movements, account.id).map((movement) => movement.id)).toEqual(['voided', 'review', 'posted'])
    expect(movements.map((movement) => movementStatusLabel(movement.status))).toEqual(['تم', 'ناقص', 'ملغي'])

    const markup = renderToStaticMarkup(
      <AccountProfile
        bucket={{ account, dinar: 100, usd: 0, postedCount: 1 }}
        movements={movements}
        accounts={[account, destination]}
        onClose={() => {}}
        onEditMovement={() => {}}
        onUpdateAccount={() => {}}
        onUpdateSummaryScope={() => {}}
        onReconcile={() => {}}
        onAddAttachment={() => {}}
        onDeleteAttachment={() => {}}
        onLoadMoreMovements={() => {}}
      />,
    )

    expect(markup).toContain('· تم')
    expect(markup).toContain('· ناقص')
    expect(markup).toContain('· ملغي')
    expect(markup).toContain('مطابقة الرصيد')
    expect(markup).toContain('الرصيد الفعلي بالدينار')
    expect(markup).not.toContain('داخل الصافي')
    expect(markup).not.toContain('>حفظ التعديل</button>')
  })
})

describe('MohammadLedgerApp destructive operations', () => {
  it('locks identical submissions until explicitly released', () => {
    const lock = { current: '' }
    expect(claimSubmission(lock, 'same-request')).toBe(true)
    expect(claimSubmission(lock, 'same-request')).toBe(false)
    releaseSubmission(lock, 'same-request')
    expect(claimSubmission(lock, 'same-request')).toBe(true)
  })

  it('moves account references and attachments while timestamping affected records', () => {
    const mergedAt = '2026-08-19T10:00:00.000Z'
    const state = {
      accounts: [
        { id: 'source', status: ACCOUNT_STATUSES.NEEDS_REVIEW, updatedAt: 'old' },
        { id: 'target', status: ACCOUNT_STATUSES.ACTIVE, updatedAt: 'old' },
      ],
      movements: [
        { id: 'from-source', sourceAccountId: 'source', destinationAccountId: 'cash', updatedAt: 'old' },
        { id: 'source-category', sourceAccountId: 'cash', expenseCategoryId: 'source', updatedAt: 'old' },
        { id: 'unrelated', sourceAccountId: 'cash', destinationAccountId: 'bank', updatedAt: 'old' },
      ],
      attachments: [
        { id: 'account-file', accountId: 'source', updatedAt: 'old' },
        { id: 'movement-file', movementId: 'from-source', updatedAt: 'old' },
      ],
      dimensions: [{ id: 'dimension-source', linkedAccountId: 'source', updatedAt: 'old' }],
      recurringRules: [{ id: 'rule-source', template: { sourceAccountId: 'source', destinationAccountId: 'cash' }, updatedAt: 'old' }],
      reconciliations: [{ id: 'reconciliation-source', accountId: 'source', updatedAt: 'old' }],
    }

    const merged = mergeLedgerAccountState(state, 'source', 'target', mergedAt)

    expect(merged.accounts.find((account) => account.id === 'source')).toMatchObject({
      status: ACCOUNT_STATUSES.INACTIVE,
      mergedIntoAccountId: 'target',
      updatedAt: mergedAt,
    })
    expect(merged.movements.find((movement) => movement.id === 'from-source')).toMatchObject({
      sourceAccountId: 'target',
      mergedFromAccountId: 'source',
      updatedAt: mergedAt,
    })
    expect(merged.movements.find((movement) => movement.id === 'source-category')).toMatchObject({
      expenseCategoryId: 'target',
      updatedAt: mergedAt,
    })
    expect(merged.movements.find((movement) => movement.id === 'unrelated')).toBe(state.movements[2])
    expect(merged.attachments.find((attachment) => attachment.id === 'account-file')).toMatchObject({
      accountId: 'target',
      mergedFromAccountId: 'source',
      updatedAt: mergedAt,
    })
    expect(merged.attachments.find((attachment) => attachment.id === 'movement-file')).toBe(state.attachments[1])
    expect(merged.dimensions[0]).toMatchObject({ linkedAccountId: 'target', mergedFromAccountId: 'source', updatedAt: mergedAt })
    expect(merged.recurringRules[0]).toMatchObject({
      template: { sourceAccountId: 'target', destinationAccountId: 'cash' },
      mergedFromAccountId: 'source',
      updatedAt: mergedAt,
    })
    expect(merged.reconciliations[0]).toMatchObject({ accountId: 'target', mergedFromAccountId: 'source', updatedAt: mergedAt })
  })

  it('blocks incompatible merge targets before changing the ledger', () => {
    const cash = {
      id: 'cash-target',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const project = {
      id: 'project-source',
      type: ACCOUNT_TYPES.PROJECT,
      valueKind: VALUE_KINDS.PROJECT,
      currencyKind: ACCOUNT_CURRENCY_KINDS.DINAR,
      status: ACCOUNT_STATUSES.NEEDS_REVIEW,
    }
    const review = { ...project, valueKind: VALUE_KINDS.REVIEW }
    const candidate = mergeLedgerAccountState({
      accounts: [review, cash],
      dimensions: [{ id: 'project-dimension', type: 'project', linkedAccountId: review.id }],
    }, review.id, cash.id)

    expect(areMergeAccountsCompatible(project, cash)).toBe(false)
    expect(areMergeAccountsCompatible(review, cash)).toBe(true)
    expect(mergeAccountReferenceErrors({ candidate, sourceAccount: review, targetAccount: cash })).toContain(
      'المشروع أو الأصل لا يطابق الحساب المختار.',
    )
  })
})
