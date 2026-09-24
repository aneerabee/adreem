/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'
import { BriefcaseBusiness, ReceiptText } from 'lucide-react'
import { CURRENCIES } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'
import { DIMENSION_TYPES, recurringRuleDueOn } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { formatCount, money } from './ledgerFormat'
import { recurringDateLabel } from './movementPresentation'

export function TrackingPanel({ reports, recurringRules, dueRules, query = '', onOpenAccount, onOpenHistory, onRunRecurring, onDisableRecurring, onUpdateRecurring }) {
  const [pendingRuleAction, setPendingRuleAction] = useState(null)
  const activeRules = recurringRules.filter((rule) => rule.status === 'active')
  const dueIds = new Set(dueRules.map((rule) => rule.id))
  const normalizedQuery = normalizeAccountSearchText(query)
  const visibleReports = reports.filter((report) => (
    normalizeAccountSearchText(report.dimension.name).includes(normalizedQuery)
    || activeRules.some((rule) => rule.template?.dimensionId === report.dimension.id && normalizeAccountSearchText(rule.name).includes(normalizedQuery))
  ))
  const knownDimensionIds = new Set(reports.map((report) => report.dimension.id))
  const unlinkedRules = activeRules.filter((rule) => !knownDimensionIds.has(rule.template?.dimensionId) && normalizeAccountSearchText(rule.name).includes(normalizedQuery))

  function renderRule(rule) {
    const dueOn = recurringRuleDueOn(rule)
    const isDue = dueIds.has(rule.id)
    const pendingAction = pendingRuleAction?.id === rule.id ? pendingRuleAction.action : ''
    return (
      <div className={`adreem-tracking-recurring ${isDue ? 'is-due' : ''}`} key={rule.id}>
        <div>
          <strong className="adreem-account-name">{preserveUiData(rule.name)}</strong>
          <span>{money(rule.template?.amount || 0, rule.template?.currency || CURRENCIES.DINAR)} · {isDue ? 'مستحقة' : 'القادمة'} {recurringDateLabel(dueOn)}</span>
        </div>
        <div className="adreem-tracking-recurring-actions">
          <label>الموعد القادم <input type="date" value={dueOn} onChange={(event) => { setPendingRuleAction(null); onUpdateRecurring(rule.id, event.target.value) }} /></label>
          <button type="button" disabled={!isDue} onClick={() => setPendingRuleAction({ id: rule.id, action: 'run' })}>تنفيذ</button>
          <button type="button" onClick={() => setPendingRuleAction({ id: rule.id, action: 'stop' })}>إيقاف</button>
        </div>
        {pendingAction ? (
          <div className="adreem-tracking-confirm" role="group" aria-label={pendingAction === 'run' ? 'تأكيد التنفيذ' : 'تأكيد الإيقاف'}>
            <strong>{pendingAction === 'run' ? 'تنفيذ الحركة الآن وتحديث الأرصدة؟' : 'إيقاف الحركة الشهرية؟'}</strong>
            <button type="button" onClick={() => {
              if (pendingAction === 'run') onRunRecurring(rule.id)
              else onDisableRecurring(rule.id)
              setPendingRuleAction(null)
            }}>تأكيد</button>
            <button type="button" onClick={() => setPendingRuleAction(null)}>تراجع</button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="adreem-tracking-list">
      {visibleReports.length === 0 && unlinkedRules.length === 0 ? <p className="ml3-empty">{normalizedQuery ? 'لا توجد نتائج' : 'لا توجد مشاريع أو حركات شهرية.'}</p> : null}
      {visibleReports.map((report) => {
        const currencyRows = [
          { currency: CURRENCIES.DINAR, income: report.income, expense: report.expense },
          { currency: CURRENCIES.USD, income: report.incomeUsd, expense: report.expenseUsd },
          { currency: CURRENCIES.TRY, income: report.incomeTry, expense: report.expenseTry },
          { currency: CURRENCIES.EUR, income: report.incomeEur, expense: report.expenseEur },
        ].filter(({ income, expense }) => income || expense)
        const linkedRules = activeRules.filter((rule) => rule.template?.dimensionId === report.dimension.id)
        return (
          <article className="adreem-tracking-item" key={report.dimension.id}>
            <header>
              <div className="adreem-tracking-identity">
                <i><BriefcaseBusiness aria-hidden="true" size={17} /></i>
                <div>
                  <span>{report.dimension.type === DIMENSION_TYPES.ASSET ? 'أصل' : report.dimension.type === DIMENSION_TYPES.COST_CENTER ? 'مركز تكلفة' : 'مشروع'}</span>
                  {report.dimension.linkedAccountId ? (
                    <button type="button" className="adreem-tracking-name" onClick={() => onOpenAccount(report.dimension.linkedAccountId)}>{preserveUiData(report.dimension.name)}</button>
                  ) : <strong className="adreem-account-name">{preserveUiData(report.dimension.name)}</strong>}
                </div>
              </div>
              <button type="button" className="adreem-tracking-history" onClick={() => onOpenHistory(report.dimension.id)}>
                <ReceiptText aria-hidden="true" size={15} /> الحركات {formatCount(report.movementCount)}
              </button>
            </header>
            {currencyRows.length ? (
              <div className="adreem-tracking-values">
                {currencyRows.map(({ currency, income, expense }) => (
                  <div className="adreem-tracking-currency" key={currency}>
                    <b>{currency}</b>
                    <span>دخل <strong>{money(income, currency)}</strong></span>
                    <span>مصروف <strong>{money(expense, currency)}</strong></span>
                    <span className={income - expense < 0 ? 'is-negative' : 'is-positive'}>الصافي <strong>{money(income - expense, currency)}</strong></span>
                  </div>
                ))}
              </div>
            ) : <p className="adreem-tracking-empty">لا توجد حركات مرتبطة بعد.</p>}
            {linkedRules.length ? <div className="adreem-tracking-rule-list">{linkedRules.map(renderRule)}</div> : null}
          </article>
        )
      })}
      {unlinkedRules.length ? (
        <section className="adreem-tracking-unlinked">
          <h3>حركات شهرية</h3>
          {unlinkedRules.map(renderRule)}
        </section>
      ) : null}
    </div>
  )
}
