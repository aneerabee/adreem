/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useRef } from 'react'
import { Check, ChevronLeft, CircleAlert, Pencil, ReceiptText, RotateCcw, Trash2, X } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, buildPostingEntries } from './ledgerCore'
import { movementAccountCurrencyForRole, movementLabels, movementNeedsSource, movementSupportsDimension } from './movementConfig'
import { preserveUiData } from './uiTranslation'
import { protectedAccountLabel, protectedAccountPrimaryName } from './accountPresentation'
import { AccountSearchSelect } from './AccountSearchSelect'
import { expenseCategoryTone } from './balanceViews'
import { ExpenseCategoryPicker } from './ExpenseViews'
import { money, signedMoney } from './ledgerFormat'
import { LedgerOverlayPortal } from './LedgerIcons'
import { UI_MOTION_TRANSITION } from './ledgerUiConfig'
import { movementDateTime } from './movementPresentation'
import { NumericEntry } from './NumericEntry'
import { resetScroll } from './mobileViewport'

function useLedgerDialogFocus(panelRef, initialFocusRef, onClose, disabled = false) {
  const onCloseRef = useRef(onClose)
  const disabledRef = useRef(disabled)

  useEffect(() => {
    onCloseRef.current = onClose
    disabledRef.current = disabled
  }, [disabled, onClose])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const opener = document.activeElement
    const panel = panelRef.current
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    initialFocusRef.current?.focus()

    function handleKeydown(event) {
      if (event.key === 'Escape' && !disabledRef.current) {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll(selector)).filter((element) => element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [initialFocusRef, panelRef])
}

export function ExpenseCategoryDialog({ name = '', error = '', isSaving = false, onNameChange, onClose, onSave }) {
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  useLedgerDialogFocus(panelRef, inputRef, onClose, isSaving)
  const normalizedName = String(name || '').trim()
  const tone = expenseCategoryTone(normalizedName)
  return (
    <LedgerOverlayPortal>
      <Motion.div className="adreem-movement-dialog-layer" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION}>
        <Motion.form ref={panelRef} className="adreem-expense-category-dialog" role="dialog" aria-modal="true" aria-labelledby="adreem-expense-category-title" tabIndex={-1} onSubmit={onSave} initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={UI_MOTION_TRANSITION}>
        <header>
          <i><ReceiptText aria-hidden="true" size={19} /></i>
          <h2 id="adreem-expense-category-title">تصنيف مصروف جديد</h2>
          <button type="button" aria-label="إغلاق" title="إغلاق" onClick={onClose} disabled={isSaving}><X aria-hidden="true" size={17} /></button>
        </header>
        <div className={`adreem-expense-category-dialog-body ${normalizedName ? 'is-previewing' : ''}`}>
          <label>
            <span>اسم التصنيف</span>
            <input ref={inputRef} value={name} maxLength={80} onChange={(event) => onNameChange?.(event.target.value)} placeholder="مثال: وقود أو إيجار" autoComplete="off" />
          </label>
          {normalizedName ? (
            <div className={`adreem-expense-category-preview adreem-category-tone-${tone}`} aria-label="معاينة التصنيف" aria-live="polite">
              <strong><i aria-hidden="true" />{preserveUiData(normalizedName)}</strong>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={isSaving}>رجوع</button>
          <button type="submit" className="is-save" disabled={isSaving || !normalizedName}><Check aria-hidden="true" size={16} /> {isSaving ? 'جاري الحفظ' : 'حفظ التصنيف'}</button>
        </footer>
        </Motion.form>
      </Motion.div>
    </LedgerOverlayPortal>
  )
}

export function MovementActionDialog({ action, accountById, investmentPlatformById = new Map(), isSaving = false, onClose, onConfirm }) {
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  useLedgerDialogFocus(panelRef, closeButtonRef, onClose, isSaving)
  if (!action?.movement) return null

  const movement = action.movement
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const investmentPlatform = investmentPlatformById.get(movement.investmentPlatformId)
  const routeSource = source || (movement.type === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL ? investmentPlatform : null)
  const routeDestination = destination || (movement.type === MOVEMENT_TYPES.INVESTMENT_DEPOSIT ? investmentPlatform : null)
  const isRestore = action.kind === 'restore'
  const postingEntries = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []

  return (
    <LedgerOverlayPortal>
      <Motion.div className="adreem-movement-dialog-layer" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION}>
        <Motion.section ref={panelRef} className={`adreem-movement-action-dialog ${isRestore ? 'is-restore' : 'is-void'}`} role="alertdialog" aria-modal="true" aria-labelledby="adreem-movement-action-title" tabIndex={-1} initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={UI_MOTION_TRANSITION}>
        <header>
          <i>{isRestore ? <RotateCcw aria-hidden="true" size={20} /> : <Trash2 aria-hidden="true" size={20} />}</i>
          <div>
            {isRestore ? <span>استعادة النسخة السابقة</span> : null}
            <h2 id="adreem-movement-action-title">{isRestore ? 'التراجع عن التعديل؟' : 'تأكيد إلغاء الحركة'}</h2>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="إغلاق" title="إغلاق" onClick={onClose} disabled={isSaving}><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="adreem-movement-action-summary">
          <span><strong>{movementLabels[movement.type] || 'حركة'}</strong><small>{movementDateTime(movement.createdAt || movement.updatedAt)}</small></span>
          <b>{money(movement.amount, movement.currency)}</b>
          {(routeSource || routeDestination) ? <p className="adreem-account-name">{routeSource ? source ? protectedAccountLabel(source) : preserveUiData(investmentPlatform.name) : 'بدون مصدر'} {routeSource && routeDestination ? '←' : ''} {routeDestination ? destination ? protectedAccountLabel(destination) : preserveUiData(investmentPlatform.name) : ''}</p> : null}
          {movement.note ? <small>{preserveUiData(movement.note)}</small> : null}
        </div>

        <div className="adreem-movement-action-impact">
          <strong>{isRestore ? 'سيعود المبلغ والأطراف والملاحظة إلى ما قبل آخر تعديل.' : movement.status === MOVEMENT_STATUSES.POSTED ? 'سيُعكس أثر الحركة على الأرصدة، ولن تُحذف من السجل.' : 'الحركة الناقصة لم تغيّر الأرصدة، وستبقى ظاهرة كملغاة.'}</strong>
          {!isRestore && postingEntries.length ? (
            <div>
              {postingEntries.map((entry) => {
                const account = accountById.get(entry.accountId)
                return <span key={`${entry.accountId}-${entry.currency}`}><b className="adreem-account-name">{account ? protectedAccountPrimaryName(account) : preserveUiData(entry.accountId)}</b><em>{signedMoney(-entry.delta, entry.currency)}</em></span>
              })}
            </div>
          ) : null}
        </div>

        <footer>
          <button type="button" className="is-secondary" onClick={onClose} disabled={isSaving}>رجوع</button>
          <button type="button" className={isRestore ? 'is-restore' : 'is-danger'} onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'جاري الحفظ' : isRestore ? 'تأكيد التراجع' : 'نعم، إلغاء الحركة'}
          </button>
        </footer>
        </Motion.section>
      </Motion.div>
    </LedgerOverlayPortal>
  )
}

export function MovementEditDialog({ movement, draft, config, preview, changes = [], stage = 'fields', balanceByAccountId, sourceAccounts = [], destinationAccounts = [], sourceReferenceAccounts = [], destinationReferenceAccounts = [], preferredSourceIds = [], preferredDestinationIds = [], dimensions = [], expenseCategories = [], investmentPlatforms = [], isSaving = false, canSave = false, onDraftChange, onReview, onBack, onClose, onSave }) {
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  useLedgerDialogFocus(panelRef, closeButtonRef, onClose, isSaving)
  useEffect(() => {
    resetScroll(panelRef.current)
  }, [stage])
  if (!movement) return null

  const sourceCurrency = movementAccountCurrencyForRole(draft.type, 'source', draft.currency)
  const destinationCurrency = movementAccountCurrencyForRole(draft.type, 'destination', draft.currency)
  return (
    <LedgerOverlayPortal>
      <Motion.div className="adreem-movement-dialog-layer" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={UI_MOTION_TRANSITION}>
        <Motion.form ref={panelRef} className={`adreem-movement-edit-dialog is-${stage}`} role="dialog" aria-modal="true" aria-labelledby="adreem-movement-edit-title" tabIndex={-1} onSubmit={(event) => stage === 'review' ? onSave(event) : (event.preventDefault(), onReview())} initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={UI_MOTION_TRANSITION}>
        <header>
          <i><Pencil aria-hidden="true" size={20} /></i>
          <div>
            <span>{stage === 'review' ? 'راجع قبل الحفظ' : 'تعديل حركة محفوظة'}</span>
            <h2 id="adreem-movement-edit-title">{movementLabels[movement.type] || 'الحركة'}</h2>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="إغلاق" title="إغلاق" onClick={onClose} disabled={isSaving}><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="adreem-movement-edit-locks" aria-label="بيانات ثابتة">
          <span><small>العملة</small><strong>{movement.currency || CURRENCIES.DINAR}</strong></span>
          <span><small>وقت التسجيل</small><strong>{movementDateTime(movement.createdAt || movement.updatedAt)}</strong></span>
        </div>

        {stage === 'fields' ? (
          <div className="adreem-movement-edit-fields">
            <div className="adreem-movement-edit-amount">
              <NumericEntry compact label={config.amountLabel || 'المبلغ'} value={draft.amount} onChange={(value) => onDraftChange('amount', value)} />
              {config.needsRate ? <NumericEntry compact label={config.rateLabel || 'سعر الصرف'} value={draft.rate} onChange={(value) => onDraftChange('rate', value)} placeholder="7.5" allowDecimal /> : null}
            </div>
            {config.needsInvestmentPlatform ? (
              <label className="adreem-movement-edit-platform">
                <span>المنصة</span>
                <select value={draft.investmentPlatformId || ''} onChange={(event) => onDraftChange('investmentPlatformId', event.target.value)}>
                  <option value="">اختر المنصة</option>
                  {investmentPlatforms.map((platform) => <option key={platform.id} value={platform.id}>{preserveUiData(platform.name)}</option>)}
                </select>
              </label>
            ) : null}
            {movementNeedsSource(draft.type) ? (
              <div className="adreem-movement-edit-party">
                <AccountSearchSelect label={config.sourceLabel || 'من'} value={draft.sourceAccountId || ''} accounts={sourceAccounts} referenceAccounts={sourceReferenceAccounts} onChange={(value) => onDraftChange('sourceAccountId', value || '')} preferredAccountIds={preferredSourceIds} balanceByAccountId={balanceByAccountId} balanceCurrency={sourceCurrency} />
              </div>
            ) : null}
            {config.needsDestination ? (
              <div className="adreem-movement-edit-party">
                <AccountSearchSelect label={config.destinationLabel || 'إلى'} value={draft.destinationAccountId || ''} accounts={destinationAccounts} referenceAccounts={destinationReferenceAccounts} onChange={(value) => onDraftChange('destinationAccountId', value || '')} preferredAccountIds={preferredDestinationIds} balanceByAccountId={balanceByAccountId} balanceCurrency={destinationCurrency} />
              </div>
            ) : null}
            <label className="adreem-movement-edit-note">
              <span>{config.noteLabel || 'ملاحظة'}</span>
              <textarea value={draft.note} onChange={(event) => onDraftChange('note', event.target.value)} placeholder={config.notePlaceholder || 'اختياري'} />
            </label>
            <div className="adreem-movement-edit-links">
              {movementSupportsDimension(draft.type) ? (
                <label>
                  <span>مشروع / أصل</span>
                  <select value={draft.dimensionId} onChange={(event) => onDraftChange('dimensionId', event.target.value)}>
                    <option value="">بدون ربط</option>
                    {dimensions.map((dimension) => <option key={dimension.id} value={dimension.id}>{preserveUiData(dimension.name)}</option>)}
                  </select>
                </label>
              ) : null}
              {draft.type === MOVEMENT_TYPES.EXPENSE || draft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? (
                <ExpenseCategoryPicker compact value={draft.expenseCategoryId} categories={expenseCategories} onChange={(categoryId) => onDraftChange('expenseCategoryId', categoryId)} />
              ) : null}
            </div>
            <div className="adreem-movement-edit-hint"><CircleAlert aria-hidden="true" size={16} /><span>الأثر يظهر قبل الحفظ.</span></div>
          </div>
        ) : (
          <div className="adreem-movement-edit-review">
            <div className="adreem-movement-edit-changes">
              {changes.map((change) => (
                <div key={change.field}>
                  <strong>{change.label}</strong>
                  <span><small>كان</small><b>{preserveUiData(change.before)}</b></span>
                  <ChevronLeft aria-hidden="true" size={15} />
                  <span><small>سيصبح</small><b>{preserveUiData(change.after)}</b></span>
                </div>
              ))}
            </div>
            <div className={`ml3-preview adreem-movement-edit-preview ${preview.validation.ok ? 'is-ok' : 'is-review'}`}>
              {preview.validation.errors.map((error) => <span key={`${error.field}-${error.message}`}>{error.message}</span>)}
              {preview.effects.map((effect) => (
                <div className="ml3-effect" key={`${effect.accountId}-${effect.currency}`}>
                  <span className="adreem-account-name">{protectedAccountLabel(effect.account)}</span>
                  <b>{money(effect.before, effect.currency)}</b>
                  <i>{signedMoney(effect.delta, effect.currency)}</i>
                  <strong>{money(effect.after, effect.currency)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer>
          <button type="button" className="is-secondary" onClick={stage === 'review' ? onBack : onClose} disabled={isSaving}>{stage === 'review' ? 'تعديل البيانات' : 'ترك التعديل'}</button>
          {stage === 'fields' ? (
            <button type="button" className="is-review" onClick={onReview} disabled={!changes.length}>مراجعة التغيير <ChevronLeft aria-hidden="true" size={16} /></button>
          ) : (
            <button type="submit" className="is-save" disabled={isSaving || !canSave}><Check aria-hidden="true" size={16} /> {isSaving ? 'جاري الحفظ' : 'تأكيد وحفظ'}</button>
          )}
        </footer>
        </Motion.form>
      </Motion.div>
    </LedgerOverlayPortal>
  )
}
