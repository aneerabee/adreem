/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { Plus, ReceiptText } from 'lucide-react'
import { AnimatePresence, motion as Motion } from 'motion/react'
import { CURRENCIES } from './ledgerCore'
import { preserveUiData } from './uiTranslation'
import { protectedAccountPrimaryName } from './accountPresentation'
import { expenseCategoryTone } from './balanceViews'
import { formatCount, money } from './ledgerFormat'
import { UI_MOTION_TRANSITION } from './ledgerUiConfig'

export function ExpenseCategoryPicker({ value = '', categories = [], onChange, onCreate, compact = false }) {
  return (
    <div className={`adreem-expense-category-field ${compact ? 'is-compact' : ''}`}>
      <div className="adreem-expense-category-head">
        <span>نوع المصروف</span>
        {onCreate ? <button type="button" onClick={onCreate}><Plus aria-hidden="true" size={14} /> جديد</button> : null}
      </div>
      <div className="adreem-expense-category-chips" role="radiogroup" aria-label="نوع المصروف">
        <button type="button" className="is-none" aria-pressed={!value} onClick={() => onChange?.('')}>بدون تصنيف</button>
        {categories.map((category) => {
          const tone = expenseCategoryTone(category.ownerName)
          return (
            <button type="button" key={category.id} className={`adreem-category-tone-${tone}`} aria-pressed={value === category.id} onClick={() => onChange?.(category.id)}>
              <i aria-hidden="true" />
              <span className="adreem-account-name">{protectedAccountPrimaryName(category)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ExpenseReportList({ rows = [], onOpen }) {
  return (
    <div className="ml3-list adreem-expense-report-list">
      {rows.length === 0 ? <p className="ml3-empty">لا توجد مصروفات.</p> : null}
      <AnimatePresence initial={false}>
        {rows.map((row) => {
          const categoryTone = expenseCategoryTone(row.name)
          const content = (
            <>
              <i className="ml3-account-row-icon"><ReceiptText aria-hidden="true" size={16} /></i>
              <span className="ml3-account-copy">
                <strong className={`adreem-expense-category-tag adreem-account-name ${row.categoryId ? `adreem-category-tone-${categoryTone}` : 'is-none'}`}><i aria-hidden="true" />{row.categoryId ? preserveUiData(row.name) : 'بدون تصنيف'}</strong>
                <small className="ml3-account-context">{row.count ? `${formatCount(row.count)} حركة` : 'لا حركات'}</small>
              </span>
            </>
          )
          return (
            <Motion.article key={row.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION} className={`ml3-account-row ml3-account-row--expense ${row.count ? 'is-positive' : 'is-zero'}`}>
              {row.account ? (
                <button type="button" className="ml3-account-main" onClick={() => onOpen?.(row.account.id)}>{content}</button>
              ) : (
                <div className="ml3-account-main">{content}</div>
              )}
              <div className="ml3-account-values is-expense">
                {row.dinar ? <strong>{money(row.dinar, CURRENCIES.DINAR)}</strong> : null}
                {row.usd ? <strong>{money(row.usd, CURRENCIES.USD)}</strong> : null}
                {row.try ? <strong>{money(row.try, CURRENCIES.TRY)}</strong> : null}
                {row.eur ? <strong>{money(row.eur, CURRENCIES.EUR)}</strong> : null}
                {!row.dinar && !row.usd && !row.try && !row.eur ? <span>صفر</span> : null}
              </div>
            </Motion.article>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
