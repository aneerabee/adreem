/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'
import { ACCOUNT_CURRENCY_KINDS, ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore'
import { movementAccountCurrencyForRole, movementConfigFor, movementLabels, movementNeedsSource } from './movementConfig'
import { getMovementAccounts } from './movementAccounts'
import { buildLedgerAlerts } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { accountPrimaryBalance, formatDisplayMeaning, preferredAccountIdsFor, protectedAccountLabel, protectedAccountPrimaryName } from './accountPresentation'
import { AccountClassificationEditorFields } from './AccountProfile'
import { AccountSearchSelect } from './AccountSearchSelect'
import { areMergeAccountsCompatible } from './ledgerAppState'
import { formatCount, hasMoneyValue, money } from './ledgerFormat'
import { CURRENCY_OPTIONS } from './ledgerUiConfig'
import { movementErrorFieldLabel } from './movementPresentation'
import { NumericEntry } from './NumericEntry'

export function ReviewAccountCard({ bucket, activeAccounts, onResolve, onMerge, onDisable }) {
  const { account } = bucket
  const mergeTargets = activeAccounts.filter((target) => areMergeAccountsCompatible(account, target))
  const primaryBalance = accountPrimaryBalance(bucket)

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong className="adreem-account-name">{protectedAccountPrimaryName(account)}</strong>
          <span>{account.notes ? preserveUiData(account.notes) : 'يحتاج تحديد طريقة التعامل معه.'}</span>
        </div>
        <b>{formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</b>
      </div>
      {hasMoneyValue(primaryBalance.secondaryAmount) ? <p className="ml3-review-usd">{money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency)}</p> : null}
      <form className="ml3-decision-grid" onSubmit={(event) => onResolve(event, account.id)}>
        <AccountClassificationEditorFields account={account} className="ml3-decision-wide" />
        <label className="ml3-decision-wide">
          ملاحظة
          <input name="notes" defaultValue={account.notes || ''} placeholder="اختياري" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            اعتماد الحساب
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>
            إخفاء كغير مستخدم
          </button>
        </div>
      </form>
      <div className="ml3-merge-box">
        <label>
          دمج بدل إنشاء حساب مستقل
          <select defaultValue="" onChange={(event) => event.target.value && onMerge(account.id, event.target.value)}>
            <option value="">اختر حسابًا موجودًا للدمج</option>
            {mergeTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {protectedAccountLabel(target)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  )
}

export function ExternalAccountCard({ account, onCreate, onIgnore }) {
  const draftAccount = {
    ...account,
    type: account.type || ACCOUNT_TYPES.PERSON,
    valueKind: account.valueKind || VALUE_KINDS.RECEIVABLE,
    currencyKind: account.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
  }

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong className="adreem-account-name">{protectedAccountPrimaryName(draftAccount)}</strong>
          <span>{preserveUiData(account.notes)}</span>
        </div>
        <b>اسم جديد</b>
      </div>
      <form className="ml3-decision-grid" onSubmit={(event) => onCreate(event, account)}>
        <AccountClassificationEditorFields account={draftAccount} className="ml3-decision-wide" />
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            إنشاء الحساب
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onIgnore(account)}>
            تجاهل الاسم
          </button>
        </div>
      </form>
    </article>
  )
}

export function ReviewMovementCard({ movement, activeAccounts, referenceAccounts = activeAccounts, balanceByAccountId, investmentPlatforms = [], onResolve, onEdit, onCancel }) {
  const errors = movement.validation?.errors || []
  const [reviewDraft, setReviewDraft] = useState({
    type: movement.type || MOVEMENT_TYPES.TRANSFER,
    amount: movement.amount ? String(movement.amount) : '',
    currency: movement.currency || CURRENCIES.DINAR,
    sourceAccountId: movement.sourceAccountId || '',
    destinationAccountId: movement.destinationAccountId || '',
    investmentPlatformId: movement.investmentPlatformId || '',
    rate: movement.rate ? String(movement.rate) : '',
    note: movement.note || '',
  })
  const reviewConfig = movementConfigFor(reviewDraft.type)
  const reviewNeedsSource = movementNeedsSource(reviewDraft.type)
  const reviewSourceAccounts = getMovementAccounts(activeAccounts, balanceByAccountId, reviewDraft.type, 'source', reviewDraft)
  const reviewDestinationAccounts = getMovementAccounts(activeAccounts, balanceByAccountId, reviewDraft.type, 'destination', reviewDraft)
  const reviewSourceReferenceAccounts = getMovementAccounts(referenceAccounts, balanceByAccountId, reviewDraft.type, 'source', reviewDraft, { includeInactive: true })
  const reviewDestinationReferenceAccounts = getMovementAccounts(referenceAccounts, balanceByAccountId, reviewDraft.type, 'destination', reviewDraft, { includeInactive: true })
  const reviewSourceCurrency = movementAccountCurrencyForRole(reviewDraft.type, 'source', reviewDraft.currency)
  const reviewDestinationCurrency = movementAccountCurrencyForRole(reviewDraft.type, 'destination', reviewDraft.currency)
  const reviewSourceAccount = activeAccounts.find((account) => account.id === reviewDraft.sourceAccountId)

  function updateReviewDraft(field, value) {
    setReviewDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'type') {
        const config = movementConfigFor(value)
        next.currency = config.currency || next.currency
        next.destinationAccountId = config.needsDestination ? next.destinationAccountId : ''
        next.investmentPlatformId = config.needsInvestmentPlatform ? next.investmentPlatformId : ''
        next.rate = config.needsRate ? next.rate : ''
      }
      return next
    })
  }

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{movementLabels[movement.type] || 'حركة غير محددة'}</strong>
          <span>{errors.length ? errors.map((error) => error.message).join(' ') : 'تحتاج مراجعة قبل الاعتماد.'}</span>
        </div>
        <b>{movement.amount ? money(movement.amount, movement.currency) : 'لا مبلغ'}</b>
      </div>
      <div className="ml3-issue-chips">
        {errors.map((error) => (
          <span key={`${movement.id}-${error.field}-${error.message}`}>{movementErrorFieldLabel(error.field)}</span>
        ))}
      </div>
      <form className="ml3-decision-grid ml3-decision-grid--movement" onSubmit={(event) => onResolve(event, movement, reviewDraft)}>
        <label>
          نوع الحركة
          <select value={reviewDraft.type} onChange={(event) => updateReviewDraft('type', event.target.value)}>
            {Object.entries(movementLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <NumericEntry compact label={reviewConfig.amountLabel || 'المبلغ'} value={reviewDraft.amount} onChange={(value) => updateReviewDraft('amount', value)} />
        </div>
        {reviewConfig.currencyLocked ? (
          <div className="ml3-currency-lock">
            <span>العملة</span>
            <strong>{reviewConfig.currencyText}</strong>
          </div>
        ) : (
          <label>
            العملة
            <select value={reviewDraft.currency} onChange={(event) => updateReviewDraft('currency', event.target.value)}>
              {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        )}
        {reviewConfig.needsRate ? (
          <div>
            <NumericEntry label={reviewConfig.rateLabel || 'سعر الصرف'} value={reviewDraft.rate} onChange={(value) => updateReviewDraft('rate', value)} placeholder="7.5" allowDecimal compact />
          </div>
        ) : null}
        {reviewConfig.needsInvestmentPlatform ? (
          <label className="ml3-decision-wide">
            المنصة
            <select value={reviewDraft.investmentPlatformId} onChange={(event) => updateReviewDraft('investmentPlatformId', event.target.value)}>
              <option value="">اختر المنصة</option>
              {investmentPlatforms.map((platform) => <option key={platform.id} value={platform.id}>{preserveUiData(platform.name)}</option>)}
            </select>
          </label>
        ) : null}
        {reviewNeedsSource ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect label={reviewConfig.sourceLabel || 'من'} value={reviewDraft.sourceAccountId || ''} accounts={reviewSourceAccounts} referenceAccounts={reviewSourceReferenceAccounts} onChange={(value) => updateReviewDraft('sourceAccountId', value || '')} preferredAccountIds={preferredAccountIdsFor(reviewSourceAccounts, balanceByAccountId, reviewSourceCurrency)} balanceByAccountId={balanceByAccountId} balanceCurrency={reviewSourceCurrency} />
          </div>
        ) : null}
        {reviewConfig.needsDestination ? (
          <div className="ml3-decision-wide">
            <AccountSearchSelect label={reviewConfig.destinationLabel || 'إلى'} value={reviewDraft.destinationAccountId || ''} accounts={reviewDestinationAccounts} referenceAccounts={reviewDestinationReferenceAccounts} onChange={(value) => updateReviewDraft('destinationAccountId', value || '')} preferredAccountIds={preferredAccountIdsFor(reviewDestinationAccounts, balanceByAccountId, reviewDestinationCurrency, { movementType: reviewDraft.type, role: 'destination', counterpartAccount: reviewSourceAccount })} balanceByAccountId={balanceByAccountId} balanceCurrency={reviewDestinationCurrency} />
          </div>
        ) : null}
        <label className="ml3-decision-wide">
          ملاحظة
          <input value={reviewDraft.note} onChange={(event) => updateReviewDraft('note', event.target.value)} placeholder="سبب الحركة أو التصحيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">
            إصلاح واعتماد
          </button>
          <button type="button" className="ml3-mini-action" onClick={() => onEdit(movement)}>
            فتح في الإدخال
          </button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onCancel(movement.id)}>
            إلغاء
          </button>
        </div>
      </form>
    </article>
  )
}

export function AlertBoard({ reviewAccounts, reviewMovements, externalMissing, balances, movements, totals, dueRecurringCount = 0, reconciliationDiffCount = 0 }) {
  const alerts = buildLedgerAlerts({
    reviewAccounts,
    reviewMovements,
    externalMissing,
    balances,
    movements,
    totals,
    dueRecurringCount,
    reconciliationDiffCount,
  })
  if (!alerts.length) return null

  return (
    <section className="ml3-alert-board">
      <div className="ml3-alert-title">
        <strong>تنبيه</strong>
        <span>{formatCount(alerts.length)}</span>
      </div>
      <div className="ml3-alert-list">
        {alerts.map((alert) => (
          <article className={`ml3-alert ml3-alert--${alert.tone}`} key={alert.title}>
            <strong>{alert.title}</strong>
            <span>{alert.format === 'money' ? money(alert.value) : formatCount(alert.value)}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
