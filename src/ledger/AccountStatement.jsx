/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ReceiptText, X } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { buildPostingEntries } from './ledgerCore'
import { preserveUiData } from './uiTranslation'
import { protectedAccountPrimaryName } from './accountPresentation'
import { accountStatementAccountIds, buildAccountStatement } from './accountStatementData'
import { money, signedMoney } from './ledgerFormat'
import { CURRENCY_OPTIONS, UI_MOTION_TRANSITION } from './ledgerUiConfig'
import { statementMovementDate } from './movementPresentation'

export function AccountStatement({ account, accounts, movements, isLoading = false, loadError = '', onClose }) {
  const accountIds = accountStatementAccountIds(account, accounts)
  const availableCurrencies = CURRENCY_OPTIONS.filter((option) => (
    accounts.some((item) => accountIds.includes(item.id) && item.currencyKind === option.value)
    || movements.some((movement) => buildPostingEntries(movement).some((entry) => accountIds.includes(entry.accountId) && entry.currency === option.value))
  ))
  const currencyOptions = availableCurrencies.length ? availableCurrencies : CURRENCY_OPTIONS
  const [selectedCurrencies, setSelectedCurrencies] = useState(() => currencyOptions.map((option) => option.value))
  const [visibleCount, setVisibleCount] = useState(100)
  const statement = buildAccountStatement(movements, accountIds, selectedCurrencies)
  const visibleRows = statement.rows.slice(0, visibleCount)
  const chronologicalRows = statement.rows.slice().reverse()
  const firstMovementAt = chronologicalRows[0]?.movement?.createdAt || chronologicalRows[0]?.movement?.updatedAt
  const lastMovementAt = statement.rows[0]?.movement?.createdAt || statement.rows[0]?.movement?.updatedAt
  const statementRange = firstMovementAt && lastMovementAt
    ? `${statementMovementDate(firstMovementAt)} — ${statementMovementDate(lastMovementAt)}`
    : 'لا توجد حركات'

  function toggleCurrency(currency) {
    setVisibleCount(100)
    setSelectedCurrencies((current) => current.includes(currency)
      ? current.length === 1 ? current : current.filter((item) => item !== currency)
      : [...current, currency])
  }

  function printStatement() {
    flushSync(() => setVisibleCount(statement.rows.length))
    window.print()
  }

  return (
    <Motion.section className="adreem-statement" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={UI_MOTION_TRANSITION} aria-label="كشف الحساب">
      <header className="adreem-statement-head">
        <div className="adreem-statement-title">
          <i><ReceiptText aria-hidden="true" size={18} /></i>
          <div>
            <small>ADREEM · كشف الحساب</small>
            <h3 className="adreem-account-name">{protectedAccountPrimaryName(account)}</h3>
            <p>{statementRange}</p>
          </div>
        </div>
        <div className="adreem-statement-actions">
          <button type="button" onClick={printStatement}><ReceiptText aria-hidden="true" size={15} /> طباعة</button>
          <button type="button" aria-label="إغلاق كشف الحساب" title="إغلاق" onClick={onClose}><X aria-hidden="true" size={16} /></button>
        </div>
      </header>
      <div className="adreem-statement-currencies" aria-label="عملات كشف الحساب">
        {currencyOptions.map((option) => (
          <button type="button" key={option.value} className={selectedCurrencies.includes(option.value) ? 'is-active' : ''} aria-pressed={selectedCurrencies.includes(option.value)} onClick={() => toggleCurrency(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="adreem-statement-summary">
        {currencyOptions.filter((option) => selectedCurrencies.includes(option.value)).map((option) => {
          const total = statement.totals[option.value]
          return (
            <article className={total.balance > 0 ? 'is-positive' : total.balance < 0 ? 'is-negative' : 'is-zero'} key={option.value}>
              <strong>{option.label}</strong>
              <span className="is-balance"><small>الرصيد</small><b>{money(total.balance, option.value)}</b></span>
            </article>
          )
        })}
      </div>
      {isLoading ? <p className="ml3-empty">جاري تجهيز الكشف الكامل...</p> : null}
      {loadError ? <p className="adreem-statement-error">{loadError}</p> : null}
      <div className="adreem-statement-column-head" aria-hidden="true">
        <span>التاريخ</span><span>الملاحظة</span><span>القيمة</span>
      </div>
      <div className="adreem-statement-list">
        {visibleRows.map(({ movement, currency, delta }) => {
          const occurredAt = movement.createdAt || movement.updatedAt
          return (
            <article className={delta > 0 ? 'is-positive' : 'is-negative'} key={`${movement.id}-${currency}`}>
              <time dateTime={occurredAt || undefined}>
                <strong>{statementMovementDate(occurredAt)}</strong>
              </time>
              <p className={`adreem-statement-row-note${movement.note ? '' : ' is-empty'}`}>{movement.note ? preserveUiData(movement.note) : 'بدون ملاحظة'}</p>
              <div className="adreem-statement-row-value">
                <strong>{signedMoney(delta, currency)}</strong>
              </div>
            </article>
          )
        })}
        {!statement.rows.length && !isLoading ? <p className="ml3-empty">لا توجد حركات بهذه العملة.</p> : null}
      </div>
      {visibleCount < statement.rows.length ? (
        <button type="button" className="adreem-statement-more" onClick={() => setVisibleCount((current) => current + 100)}>
          حركات أقدم
        </button>
      ) : null}
      <footer className="adreem-statement-print-foot">
        <strong>ADREEM</strong>
        <span>كشف حساب</span>
      </footer>
    </Motion.section>
  )
}
