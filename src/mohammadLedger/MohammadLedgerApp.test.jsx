import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, createAccount, createOpeningMovements, postMovement, previewMovement } from './ledgerCore.js'
import {
  AccountRow,
  AccountClassificationEditorFields,
  ExternalAccountCard,
  ReviewAccountCard,
  areMergeAccountsCompatible,
  accountClassificationMovementErrors,
  accountReviewSelection,
  cancelMovementConfirmation,
  claimSubmission,
  filterMovementHistory,
  mergeAccountsConfirmation,
  mergeAccountReferenceErrors,
  mergeLedgerAccountState,
  money,
  movementHistoryForPreview,
  normalizeLocalizedNumericInput,
  parseMoneyAmount,
  parseWholeAmount,
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
    expect(result).toMatchObject({ ok: false, reason: 'movement-history' })
    expect(result.errors).not.toHaveLength(0)
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
