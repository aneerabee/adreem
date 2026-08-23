import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { COUNTERPARTY_ACCOUNT_KINDS } from './accountConfig.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createAccount, createOpeningMovements, postMovement } from './ledgerCore.js'
import {
  AccountProfile,
  NumericEntry,
  preventImplicitNumericSubmit,
  NetPositionPanel,
  SeparateLedgerPanel,
  AccountRow,
  AccountSearchSelect,
  AccountClassificationEditorFields,
  ExternalAccountCard,
  HistoryMovementRow,
  MovementActionDialog,
  ReviewAccountCard,
  CounterpartyCard,
  CounterpartyList,
  ExpenseCategoryDialog,
  ExpenseCategoryPicker,
  ExpenseReportList,
  accountBalanceChip,
  accountProfileMovements,
  areMergeAccountsCompatible,
  accountClassificationMovementErrors,
  accountEditChanges,
  accountReviewSelection,
  activeRecurringRuleForMovement,
  buildBalanceOverview,
  balanceAmountIsWide,
  buildExpenseBalanceRows,
  buildPeopleAccountViews,
  canEditMovement,
  cancelMovementConfirmation,
  claimSubmission,
  filterMovementHistory,
  filterCounterpartyGroups,
  filterCounterpartyGroupsByQuery,
  filterMoneyBalanceRows,
  formatMoneyNumber,
  expenseCategoryTone,
  compareBalanceBuckets,
  counterpartyMagnitudeForFilter,
  unifiedCounterpartyGroups,
  mergeAccountsConfirmation,
  mergeAccountReferenceErrors,
  mergeLedgerAccountState,
  mergeMovementHistoryPages,
  mergeMovementPageAttachments,
  mergeReviewMovementPage,
  money,
  movementStatusLabel,
  previewMovementEdit,
  movementChangedWhileOpen,
  movementEditChanges,
  movementRecordVersion,
  normalizeLocalizedNumericInput,
  parseMoneyAmount,
  parseWholeAmount,
  pendingUploadedOrphanPaths,
  prepareExpenseCategoryAccount,
  prepareAccountClassificationUpdate,
  releaseSubmission,
  saveFailureMessage,
  signedMoney,
  storageTextForStatus,
  TEMPORARY_NET_RESET_MS,
} from './LedgerApp.jsx'
import { setActiveUiLanguage, stripUiDataProtection } from './uiTranslation.js'

const previousReact = globalThis.React

beforeAll(() => {
  globalThis.React = React
})

afterAll(() => {
  globalThis.React = previousReact
})

describe('LedgerApp numeric entry', () => {
  it('keeps the calculator keypad while allowing direct numeric typing', () => {
    const markup = renderToStaticMarkup(<NumericEntry label="القيمة" value="12345" onChange={() => {}} />)

    expect(markup).toContain('class="ml3-number-input"')
    expect(markup).toContain('inputMode="numeric"')
    expect(markup).toContain('value="12,345"')
    expect(markup).toContain('class="ml3-number-pad"')
  })

  it('does not submit a movement implicitly from a numeric step', () => {
    const preventDefault = vi.fn()

    preventImplicitNumericSubmit({ key: 'Enter', preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('formats exact totals that exceed the ordinary numeric limit without rounding them', () => {
    expect(formatMoneyNumber(9_999_999_999_999_990n)).toBe('9,999,999,999,999,990')
    expect(formatMoneyNumber(-9_999_999_999_999_990n)).toBe('-9,999,999,999,999,990')
  })
})

describe('LedgerApp movement account balances', () => {
  it('shows only the currency used by the current movement side', () => {
    const account = { valueKind: VALUE_KINDS.CASH }
    const bucket = { dinar: 50_000, usd: 500 }

    expect(accountBalanceChip(account, bucket, CURRENCIES.USD)).toEqual({ tone: 'positive', text: '500 $' })
    expect(accountBalanceChip(account, bucket, CURRENCIES.DINAR)).toEqual({ tone: 'positive', text: '50,000 د.ل' })
    expect(accountBalanceChip(account, { dinar: 50_000, usd: 0 }, CURRENCIES.USD)).toEqual({ tone: 'zero', text: '0 $' })
  })
})

describe('LedgerApp large balance layout', () => {
  it('reserves a full mobile row only for balances that need the extra width', () => {
    expect(balanceAmountIsWide({ dinar: 1_250_000, usd: 900 })).toBe(false)
    expect(balanceAmountIsWide({ dinar: 999_999_999_999_999, usd: 0 })).toBe(true)
  })
})

describe('LedgerApp recurring movement binding', () => {
  it('finds only the active rule linked to the movement being edited', () => {
    const rules = [
      { id: 'old', sourceMovementId: 'salary', status: 'inactive' },
      { id: 'active', sourceMovementId: 'salary', status: 'active' },
      { id: 'other', sourceMovementId: 'rent', status: 'active' },
    ]

    expect(activeRecurringRuleForMovement(rules, 'salary')?.id).toBe('active')
    expect(activeRecurringRuleForMovement(rules, 'missing')).toBeNull()
  })
})

describe('LedgerApp net position controls', () => {
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

  it('shows temporary multi-account exclusions without hiding the excluded account from the picker', () => {
    const contributions = [
      { accountId: 'cash', account: { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش عندي', valueKind: VALUE_KINDS.CASH }, dinar: 12_000, usd: 0 },
      { accountId: 'friend', account: { id: 'friend', ownerName: 'سعيد', subAccountName: 'كاش بيننا', valueKind: VALUE_KINDS.RECEIVABLE }, dinar: -1_500, usd: 100 },
      { accountId: 'bank', account: { id: 'bank', ownerName: 'مصرف الجمهورية', subAccountName: 'حساب رئيسي', valueKind: VALUE_KINDS.BANK }, dinar: 2_000, usd: 0 },
    ]
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <NetPositionPanel
        position={{ dinar: 12_000, usd: 0, accountCount: 1, contributions: [contributions[0]] }}
        allContributions={contributions}
        excludedAccountIds={['friend', 'bank']}
        query="سعيد"
        rate=""
        targetCurrency={CURRENCIES.DINAR}
        onRateChange={() => {}}
        onTargetCurrencyChange={() => {}}
        onQueryChange={() => {}}
        onToggleAccount={() => {}}
        onResetExclusions={() => {}}
        onClose={() => {}}
      />,
    ))

    expect(markup).toContain('مستبعد 2')
    expect(markup).toContain('سعيد')
    expect(markup).toContain('مستبعد مؤقتًا')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).not.toContain('مصرف الجمهورية')
    expect(TEMPORARY_NET_RESET_MS).toBe(5 * 60 * 1000)
  })

  it('shows an exact oversized raw total and refuses an unsafe converted result', () => {
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <NetPositionPanel
        position={{
          dinar: 9_999_999_999_999_990n,
          usd: -9_999_999_999_999_990n,
          accountCount: 10,
          contributions: [],
        }}
        rate="7.5"
        targetCurrency={CURRENCIES.DINAR}
        onRateChange={() => {}}
        onTargetCurrencyChange={() => {}}
        onClose={() => {}}
      />,
    ))

    expect(markup).toContain('9,999,999,999,999,990 د.ل')
    expect(markup).toContain('-9,999,999,999,999,990 $')
    expect(markup).toContain('نتيجة الصافي أكبر من الحد المسموح.')
  })
})

describe('LedgerApp separate accounts', () => {
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

describe('LedgerApp movement account picker', () => {
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
    expect(markup).toContain('>كاش<')
    expect(markup).toContain('>شيك<')
    expect(markup).toContain('دولار')
    expect(markup).toContain('12,000 د.ل')
    expect(markup).toContain('أدفع 4,500 د.ل')
    expect(markup).toContain('700 $')
  })
})

describe('LedgerApp compact history rows', () => {
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

  it('shows distinct edit and cancellation actions only for recent posted movements', () => {
    const recent = {
      id: 'recent-1',
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'bank',
      createdAt: new Date().toISOString(),
    }
    const markup = renderToStaticMarkup(
      <HistoryMovementRow accountById={new Map()} movement={recent} onEdit={() => {}} onCancel={() => {}} />,
    )

    expect(canEditMovement(recent)).toBe(true)
    expect(markup).toContain('ml3-history-actions')
    expect(markup).toContain('is-edit')
    expect(markup).toContain('is-cancel')
    expect(markup).toContain('تعديل')
    expect(markup).toContain('إلغاء')

    const oldMarkup = renderToStaticMarkup(
      <HistoryMovementRow accountById={new Map()} movement={{ ...recent, id: 'old-1', createdAt: '2020-01-01T00:00:00.000Z' }} onEdit={() => {}} onCancel={() => {}} />,
    )
    expect(oldMarkup).not.toContain('ml3-history-actions')
  })

  it('renders a protected confirmation before reversing a movement', () => {
    const accountById = new Map([
      ['cash', { id: 'cash', ownerName: 'أنا', subAccountName: 'كاش', valueKind: VALUE_KINDS.CASH }],
      ['person', { id: 'person', ownerName: 'سعيد', subAccountName: 'كاش بيننا', valueKind: VALUE_KINDS.RECEIVABLE }],
    ])
    const movement = {
      id: 'recent-2',
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 300,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'person',
      createdAt: new Date().toISOString(),
    }
    const markup = stripUiDataProtection(renderToStaticMarkup(
      <MovementActionDialog action={{ kind: 'void', movement }} accountById={accountById} onClose={() => {}} onConfirm={() => {}} />,
    ))

    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain('تأكيد إلغاء الحركة')
    expect(markup).toContain('نعم، إلغاء الحركة')
    expect(markup).toContain('لن تُحذف من السجل')
    expect(markup).toContain('سعيد')
  })
})

describe('LedgerApp movement editing', () => {
  it('previews the exact balance difference when replacing a local or cloud movement', () => {
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

    const preview = previewMovementEdit({ ...original, amount: 150 }, original, accounts, [...openingMovements, original])

    expect(preview.validation.ok).toBe(true)
    expect(preview.effects.find((effect) => effect.accountId === 'cash')).toMatchObject({
      before: 900,
      delta: -50,
      after: 850,
    })
    expect(preview.effects.find((effect) => effect.accountId === 'bank')).toMatchObject({
      before: 600,
      delta: 50,
      after: 650,
    })

    const databaseAccounts = accounts.map((account) => ({
      ...account,
      balanceSource: 'database',
      balanceDinar: account.id === 'cash' ? 900 : 600,
      balanceUsd: 0,
      postedCount: 2,
    }))
    const cloudPreview = previewMovementEdit({ ...original, amount: 150 }, original, databaseAccounts, [])
    expect(cloudPreview.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'cash', before: 900, delta: -50, after: 850 }),
      expect.objectContaining({ accountId: 'bank', before: 600, delta: 50, after: 650 }),
    ]))
  })

  it('detects exactly which protected movement fields changed', () => {
    const original = {
      id: 'movement-1',
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 100,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'cash',
      destinationAccountId: 'bank',
      note: 'قديم',
      createdAt: '2026-08-22T10:00:00.000Z',
      updatedAt: '2026-08-22T10:00:00.000Z',
    }
    const candidate = { ...original, amount: 150, destinationAccountId: 'person', note: 'جديد', expenseCategoryId: 'fuel' }
    const labels = {
      accounts: new Map([['cash', 'كاش'], ['bank', 'المصرف'], ['person', 'سعيد']]),
      expenseCategories: new Map([['fuel', 'وقود']]),
    }

    expect(movementEditChanges(original, candidate, labels)).toEqual([
      { field: 'amount', label: 'المبلغ', before: '100 د.ل', after: '150 د.ل' },
      { field: 'destinationAccountId', label: 'إلى', before: 'المصرف', after: 'سعيد' },
      { field: 'note', label: 'الملاحظة', before: 'قديم', after: 'جديد' },
      { field: 'expenseCategoryId', label: 'نوع المصروف', before: 'بدون', after: 'وقود' },
    ])
    expect(movementEditChanges(original, original, labels)).toEqual([])
  })

  it('blocks a stale edit after the stored movement changes', () => {
    const baseline = { id: 'movement-1', status: MOVEMENT_STATUSES.POSTED, amount: 100, updatedAt: 'v1' }
    const current = { ...baseline, amount: 120, updatedAt: 'v2' }

    expect(movementRecordVersion(baseline)).not.toBe(movementRecordVersion(current))
    expect(movementChangedWhileOpen(baseline, current)).toBe(true)
    expect(movementChangedWhileOpen(baseline, { ...baseline })).toBe(false)
    expect(movementChangedWhileOpen(baseline, null)).toBe(true)
  })
})

describe('LedgerApp balance ordering', () => {
  it('places larger active values first and keeps ties deterministic', () => {
    const rows = [
      { account: { id: 'small', ownerName: 'ب', currencyKind: CURRENCIES.DINAR }, dinar: 100, usd: 0 },
      { account: { id: 'zero', ownerName: 'ج', currencyKind: CURRENCIES.DINAR }, dinar: 0, usd: 0 },
      { account: { id: 'large', ownerName: 'أ', currencyKind: CURRENCIES.DINAR }, dinar: -900, usd: 0 },
    ]

    expect(rows.sort(compareBalanceBuckets).map((row) => row.account.id)).toEqual(['large', 'small', 'zero'])
  })

  it('uses the selected people direction when ranking a filtered list', () => {
    const group = {
      rows: [],
      receivable: { dinar: 1_500, usd: 0 },
      payable: { dinar: 300, usd: 0 },
    }
    expect(counterpartyMagnitudeForFilter(group, 'receivable')).toBe(1_500)
    expect(counterpartyMagnitudeForFilter(group, 'payable')).toBe(300)
  })
})

describe('LedgerApp expense balances', () => {
  const expenseAccount = {
    id: 'fuel',
    ownerName: 'وقود',
    subAccountName: 'مصروف',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    status: ACCOUNT_STATUSES.ACTIVE,
  }

  it('keeps active categories and reveals posted expenses without a category', () => {
    const rows = buildExpenseBalanceRows([expenseAccount], [
      { categoryId: '', name: 'بدون تصنيف', dinar: 450, usd: 0, count: 1 },
    ])

    expect(rows).toEqual([
      expect.objectContaining({ id: 'uncategorized', name: 'بدون تصنيف', dinar: 450, count: 1, account: null }),
      expect.objectContaining({ id: 'fuel', name: 'وقود', dinar: 0, count: 0, account: expenseAccount }),
    ])
  })

  it('shows dinar and dollar totals without merging the currencies', () => {
    const rows = buildExpenseBalanceRows([expenseAccount], [
      { categoryId: 'fuel', name: 'وقود', dinar: 1200, usd: 35, count: 3 },
    ])
    const markup = stripUiDataProtection(renderToStaticMarkup(<ExpenseReportList rows={rows} onOpen={() => {}} />))

    expect(markup).toContain('وقود')
    expect(markup).toContain('3 حركة')
    expect(markup).toContain('1,200 د.ل')
    expect(markup).toContain('35 $')
  })

  it('creates a real expense category and rejects a duplicate name', () => {
    const prepared = prepareExpenseCategoryAccount('وقود', [])

    expect(prepared.validation.ok).toBe(true)
    expect(prepared.account).toMatchObject({
      ownerName: 'وقود',
      subAccountName: 'مصروف',
      type: ACCOUNT_TYPES.EXPENSE,
      valueKind: VALUE_KINDS.EXPENSE,
      openingDinar: 0,
      openingUsd: 0,
    })
    expect(prepareExpenseCategoryAccount('وقود', [prepared.account]).validation.ok).toBe(false)
    expect(prepareExpenseCategoryAccount('  وقود  ', [{
      id: 'legacy-fuel',
      ownerName: 'وقود',
      subAccountName: 'رئيسي',
      type: ACCOUNT_TYPES.EXPENSE,
      valueKind: VALUE_KINDS.EXPENSE,
      status: ACCOUNT_STATUSES.ACTIVE,
    }]).validation).toMatchObject({
      ok: false,
      errors: [{ field: 'ownerName', message: 'يوجد تصنيف مصروف بنفس الاسم.' }],
    })
  })

  it('renders stable colored category tags with a clear create action', () => {
    const tone = expenseCategoryTone('وقود')
    const pickerMarkup = stripUiDataProtection(renderToStaticMarkup(
      <ExpenseCategoryPicker value="fuel" categories={[expenseAccount]} onChange={() => {}} onCreate={() => {}} />,
    ))
    const dialogMarkup = stripUiDataProtection(renderToStaticMarkup(
      <ExpenseCategoryDialog name="وقود" onNameChange={() => {}} onClose={() => {}} onSave={() => {}} />,
    ))

    expect(['coral', 'blue', 'green', 'amber', 'plum', 'teal']).toContain(tone)
    expect(expenseCategoryTone('وقود')).toBe(tone)
    expect(pickerMarkup).toContain(`adreem-category-tone-${tone}`)
    expect(pickerMarkup).toContain('aria-pressed="true"')
    expect(pickerMarkup).toContain('جديد')
    expect(dialogMarkup).toContain('تصنيف مصروف جديد')
    expect(dialogMarkup).toContain('حفظ التصنيف')
  })
})

describe('LedgerApp account review', () => {
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
            ownerName: 'أحمد',
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

describe('LedgerApp people account views', () => {
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

  it('opens cash and bank summaries on only their matching money accounts', () => {
    const rows = [
      { account: { id: 'cash-lyd', valueKind: VALUE_KINDS.CASH } },
      { account: { id: 'cash-usd', valueKind: VALUE_KINDS.CASH } },
      { account: { id: 'bank', valueKind: VALUE_KINDS.BANK } },
      { account: { id: 'person', valueKind: VALUE_KINDS.RECEIVABLE } },
    ]

    expect(filterMoneyBalanceRows(rows, 'cash').map((bucket) => bucket.account.id)).toEqual(['cash-lyd', 'cash-usd'])
    expect(filterMoneyBalanceRows(rows, 'bank').map((bucket) => bucket.account.id)).toEqual(['bank'])
    expect(filterMoneyBalanceRows(rows, '')).toBe(rows)
    expect(filterMoneyBalanceRows(null, 'cash')).toEqual([])
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
      id: 'person:adreem',
      ownerName: 'أحمد',
      receivable: { dinar: 700, usd: 0 },
      payable: { dinar: 0, usd: 0 },
      rows: [
        { account: { ownerName: 'أحمد', subAccountName: 'كاش بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR } },
        { account: { ownerName: 'أحمد', subAccountName: 'شيك بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR } },
        { account: { ownerName: 'أحمد', subAccountName: 'دولار بيننا', counterpartyKind: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD } },
      ],
    }

    const byName = filterCounterpartyGroupsByQuery([group], 'أحمد')
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
    expect(markup.match(/أقبض 1,200 د\.ل/g)).toHaveLength(1)
    expect(markup.match(/أدفع 450 د\.ل/g)).toHaveLength(1)
    expect(markup.match(/أقبض 80 \$/g)).toHaveLength(1)
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
    expect(markup.match(/adreem-counterparty-channel-preview/g)).toHaveLength(1)
    expect(markup.match(/adreem-counterparty-channels/g)).toHaveLength(1)
    expect(markup).toContain('>كاش<')
    expect(markup).toContain('>شيك<')
    expect(markup).toContain('دولار')
    expect(markup).toContain('أقبض 1,200 د.ل')
    expect(markup).toContain('أدفع 450 د.ل')
    expect(markup).toContain('أقبض 80 $')
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
      expect.objectContaining({ key: 'type', before: 'شخص أو جهة · كاش', after: 'شخص أو جهة · شيك' }),
      expect.objectContaining({ key: 'currency', before: 'دينار', after: 'دولار' }),
    ])
  })
})

describe('LedgerApp English user data protection', () => {
  it('translates standard account details but preserves custom details', () => {
    setActiveUiLanguage('en')
    try {
      const account = {
        id: 'person-detail',
        ownerName: 'أحمد',
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
      expect(standard).toContain('>Cash · Dinar<')
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

describe('LedgerApp cloud state', () => {
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

describe('LedgerApp localized money', () => {
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

describe('LedgerApp history filtering', () => {
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
      ownerName: 'أحمد',
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
    expect(markup).not.toContain('حذف الحساب')
  })

  it('shows permanent deletion only for a completely unused account', () => {
    const account = {
      id: 'unused',
      ownerName: 'أنا',
      subAccountName: 'خزنة إضافية',
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      currencyKind: CURRENCIES.DINAR,
      status: ACCOUNT_STATUSES.ACTIVE,
      postedCount: 0,
      structureLocked: false,
    }

    const markup = renderToStaticMarkup(
      <AccountProfile
        bucket={{ account, dinar: 0, usd: 0, postedCount: 0 }}
        movements={[]}
        accounts={[account]}
        onClose={() => {}}
        onEditMovement={() => {}}
        onUpdateAccount={() => {}}
        onDeleteAccount={() => {}}
        onReconcile={() => {}}
        onAddAttachment={() => {}}
        onDeleteAttachment={() => {}}
        onLoadMoreMovements={() => {}}
      />,
    )

    expect(markup).toContain('حذف الحساب')
    expect(markup).not.toContain('تأكيد الحذف')
  })
})

describe('LedgerApp destructive operations', () => {
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
