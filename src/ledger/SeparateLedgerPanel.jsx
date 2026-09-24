/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { ArrowDownToLine, ArrowUpFromLine, Check, NotebookPen, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion as Motion } from 'motion/react'
import { SearchField } from './SearchField'
import { CURRENCIES } from './ledgerCore'
import { SEPARATE_RECORD_DIRECTIONS, normalizeSeparateRecordDirection, normalizeSeparateRecordName, separateRecordDirectionOptions } from './separateRecords'
import { preserveUiData } from './uiTranslation'
import { CurrencyAmountGrid } from './BalancePanels'
import { money } from './ledgerFormat'
import { CURRENCY_OPTIONS, UI_MOTION_TRANSITION } from './ledgerUiConfig'
import { movementDateTime } from './movementPresentation'
import { NumericEntry } from './NumericEntry'

function separateRecordDirectionLabel(direction) {
  return separateRecordDirectionOptions.find((option) => option.value === normalizeSeparateRecordDirection(direction))?.label || 'معلومة'
}

export function SeparateLedgerPanel({ records, names, totals, query, draft, editorOpen, editingId, isSaving, hasMore, isLoadingMore, showSearch = true, onQueryChange, onDraftChange, onOpenEditor, onCloseEditor, onSave, onEdit, onTogglePinned, onVoid, onLoadMore }) {
  const normalizedDraftName = normalizeSeparateRecordName(draft.relatedName).toLocaleLowerCase('ar')
  const dinarTotals = totals[CURRENCIES.DINAR] || { receivable: 0, payable: 0 }
  const usdTotals = totals[CURRENCIES.USD] || { receivable: 0, payable: 0 }
  const tryTotals = totals[CURRENCIES.TRY] || { receivable: 0, payable: 0 }
  const eurTotals = totals[CURRENCIES.EUR] || { receivable: 0, payable: 0 }
  const receivableTotals = { dinar: dinarTotals.receivable, usd: usdTotals.receivable, try: tryTotals.receivable, eur: eurTotals.receivable }
  const payableTotals = { dinar: dinarTotals.payable, usd: usdTotals.payable, try: tryTotals.payable, eur: eurTotals.payable }
  const suggestedNames = names
    .filter((name) => !normalizedDraftName || name.toLocaleLowerCase('ar').includes(normalizedDraftName))
    .slice(0, 6)
  return (
    <section className="adreem-separate-ledger">
      <div className="adreem-separate-summary" aria-label="ملخص السجل المنفصل">
        <span className="is-positive"><ArrowDownToLine aria-hidden="true" size={16} /><small>لي</small><CurrencyAmountGrid className="adreem-separate-currencies" value={receivableTotals} /></span>
        <span className="is-negative"><ArrowUpFromLine aria-hidden="true" size={16} /><small>عليّ</small><CurrencyAmountGrid className="adreem-separate-currencies" value={payableTotals} /></span>
      </div>

      <div className={`adreem-separate-toolbar${showSearch ? '' : ' is-action-only'}`}>
        {showSearch ? <SearchField value={query} onChange={onQueryChange} placeholder="اسم أو ملاحظة" ariaLabel="بحث في السجل المنفصل" /> : null}
        <button type="button" className="adreem-separate-add" onClick={editorOpen ? onCloseEditor : onOpenEditor}>
          {editorOpen ? <X aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
          {editorOpen ? 'إغلاق' : 'حساب جديد'}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {editorOpen ? (
          <Motion.form className="adreem-separate-editor" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={UI_MOTION_TRANSITION} onSubmit={onSave}>
            <div className="adreem-separate-name">
              <label>
                <span>الاسم</span>
                <input value={draft.relatedName} onChange={(event) => onDraftChange('relatedName', event.target.value)} placeholder="اختر أو اكتب اسمًا" autoComplete="off" />
              </label>
              {suggestedNames.length ? (
                <div className="adreem-separate-name-options" aria-label="أسماء موجودة">
                  {suggestedNames.map((name) => (
                    <button type="button" key={name} aria-pressed={name === normalizeSeparateRecordName(draft.relatedName)} onClick={() => onDraftChange('relatedName', name)}>
                      {preserveUiData(name)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="adreem-separate-direction" aria-label="اتجاه السجل">
              {separateRecordDirectionOptions.map((option) => (
                <button type="button" key={option.value} className={`is-${option.value} ${draft.recordDirection === option.value ? 'is-active' : ''}`} aria-pressed={draft.recordDirection === option.value} onClick={() => onDraftChange('recordDirection', option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <NumericEntry compact hideLabel label="المبلغ" value={draft.amount} onChange={(value) => onDraftChange('amount', value)} />
            <label className="adreem-separate-currency">
              <span>العملة</span>
              <select value={draft.currency} onChange={(event) => onDraftChange('currency', event.target.value)}>
                {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="adreem-separate-note">
              <span>ملاحظة</span>
              <input value={draft.note} onChange={(event) => onDraftChange('note', event.target.value)} placeholder="مختصرة وواضحة" />
            </label>
            <button className="adreem-separate-save" type="submit" disabled={isSaving || !normalizeSeparateRecordName(draft.relatedName) || !Number(draft.amount) || !draft.note.trim()}>
              <Check aria-hidden="true" size={16} /> {isSaving ? 'جاري الحفظ' : editingId ? 'حفظ التعديل' : 'حفظ'}
            </button>
          </Motion.form>
        ) : null}
      </AnimatePresence>

      <div className="adreem-separate-list">
        {!records.length ? <p className="ml3-empty">لا توجد سجلات منفصلة.</p> : null}
        <AnimatePresence initial={false}>
          {records.map((movement) => {
            const direction = normalizeSeparateRecordDirection(movement.recordDirection)
            const isPinned = Boolean(movement.separateRecordPinned)
            return (
              <Motion.article key={movement.id} className={`is-${direction}${isPinned ? ' is-featured' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION}>
                <i>{direction === SEPARATE_RECORD_DIRECTIONS.RECEIVABLE ? <ArrowDownToLine aria-hidden="true" size={16} /> : direction === SEPARATE_RECORD_DIRECTIONS.PAYABLE ? <ArrowUpFromLine aria-hidden="true" size={16} /> : <NotebookPen aria-hidden="true" size={16} />}</i>
                <span className="adreem-separate-record-copy">
                  <span className="adreem-separate-record-heading">
                    <strong className="adreem-account-name">{preserveUiData(movement.relatedName || 'بدون اسم')}</strong>
                    {isPinned ? <b className="adreem-separate-featured-tag"><Star aria-hidden="true" size={11} fill="currentColor" /> مميز</b> : null}
                  </span>
                  <small>{preserveUiData(movement.note)}</small>
                </span>
                <span className="adreem-separate-record-value">
                  <b>{separateRecordDirectionLabel(direction)} · {money(movement.amount, movement.currency)}</b>
                  <small>{movementDateTime(movement.createdAt || movement.updatedAt)}</small>
                </span>
                <span className="adreem-separate-record-actions">
                  <button type="button" className={`adreem-separate-pin${isPinned ? ' is-active' : ''}`} aria-label={isPinned ? 'إزالة التمييز' : 'تمييز وتثبيت بالأعلى'} aria-pressed={isPinned} title={isPinned ? 'إزالة التمييز' : 'تمييز وتثبيت بالأعلى'} disabled={isSaving} onClick={() => onTogglePinned(movement.id)}><Star aria-hidden="true" size={15} fill={isPinned ? 'currentColor' : 'none'} /></button>
                  <button type="button" aria-label="تعديل" title="تعديل" onClick={() => onEdit(movement)}><Pencil aria-hidden="true" size={15} /></button>
                  <button type="button" aria-label="إلغاء" title="إلغاء" onClick={() => onVoid(movement.id)}><Trash2 aria-hidden="true" size={15} /></button>
                </span>
              </Motion.article>
            )
          })}
        </AnimatePresence>
        {hasMore ? <button type="button" className="ml3-history-more" disabled={isLoadingMore} onClick={onLoadMore}>{isLoadingMore ? 'جاري التحميل' : 'أقدم'}</button> : null}
      </div>
    </section>
  )
}
