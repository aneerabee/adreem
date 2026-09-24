/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ReceiptText, Trash2, X } from 'lucide-react'
import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { accountClassificationOptions, accountDetailDisplayName, accountDetailName, accountDetailOptionsFor, accountNameValue, accountNeedsCurrency, accountPresetFor, applyAccountClassification, applyAccountName, classificationValueFor as classificationValue, parseAccountClassification as parseClassification } from './accountConfig'
import { accountDeletionEligibility, accountStructureUsage } from './accountEditing'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore'
import { movementLabels } from './movementConfig'
import { attachmentsForRecord } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { accountKindText, accountPrimaryBalance, formatDisplayMeaning, protectedAccountContext, protectedAccountLabel, protectedAccountPrimaryName } from './accountPresentation'
import { AccountStatement } from './AccountStatement'
import { accountProfileMovements, accountStatementAccountIds } from './accountStatementData'
import { AccountEditHistory } from './BalancePanels'
import { accountClassificationCurrency } from './ledgerAppState'
import { formatCount, hasMoneyValue, money, signedMoney } from './ledgerFormat'
import { AccountChoiceIcon, LedgerOverlayPortal } from './LedgerIcons'
import { CURRENCY_OPTIONS } from './ledgerUiConfig'
import { canCancelMovement, movementAccountImpact, movementDateTime, movementStatusLabel } from './movementPresentation'
import { AttachmentFileField, AttachmentLink } from './MovementRows'

function accountEditorDraft(account) {
  return {
    ...account,
    subAccountName: accountDetailName(account),
    currencyKind: account.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
  }
}

export function AccountClassificationEditorFields({ account, className = '', structureLocked = false, accountLocked = false }) {
  const editorKey = [account.id, account.updatedAt, account.ownerName, account.subAccountName, account.type, account.valueKind, account.currencyKind, structureLocked, accountLocked].join(':')
  return <AccountClassificationEditor key={editorKey} account={account} className={className} structureLocked={structureLocked} accountLocked={accountLocked} />
}

function AccountClassificationEditor({ account, className = '', structureLocked = false, accountLocked = false }) {
  const [draft, setDraft] = useState(() => accountEditorDraft(account))
  const classification = classificationValue(draft)
  const parsedClassification = parseClassification(classification)
  const preset = accountPresetFor(parsedClassification.type, parsedClassification.valueKind)
  const detailOptions = accountDetailOptionsFor(parsedClassification.type, parsedClassification.valueKind)
  const showDetail = !preset.skipDetail && detailOptions.length > 0
  const selectedCurrencyKind = accountClassificationCurrency(account, parsedClassification, draft.currencyKind)
  const showLegacyMultiCurrency = selectedCurrencyKind === ACCOUNT_CURRENCY_KINDS.MULTI
  const currencyFieldValue = showLegacyMultiCurrency ? '' : selectedCurrencyKind

  return (
    <div className={`ml3-profile-editor-grid ${className}`.trim()}>
      <input type="hidden" name="ownerName" value={draft.ownerName || ''} />
      <input type="hidden" name="subAccountName" value={draft.subAccountName || ''} />
      {structureLocked ? <input type="hidden" name="classification" value={classification} /> : null}
      {structureLocked && accountNeedsCurrency(parsedClassification) ? <input type="hidden" name="currencyKind" value={currencyFieldValue} /> : null}
      {accountLocked ? <p className="ml3-profile-lock-note">الاسم قابل للتعديل. النوع والعملة ثابتان لحماية الحركات السابقة.</p> : structureLocked ? <p className="ml3-profile-lock-note">النوع وطريقة التعامل والعملة ثابتة بعد استعمال الحساب. الاسم فقط قابل للتعديل.</p> : null}
      <label>
        هذا الحساب هو
        <select
          name={structureLocked ? undefined : 'classification'}
          value={classification}
          disabled={structureLocked}
          onChange={(event) => {
            const next = parseClassification(event.target.value)
            setDraft((current) => applyAccountClassification(current, next.type, next.valueKind))
          }}
        >
          {accountClassificationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {preset.nameLabel || 'اسم الحساب'}
        <input value={accountNameValue(draft)} onChange={(event) => setDraft((current) => applyAccountName(current, event.target.value))} placeholder={preset.namePlaceholder || 'اكتب الاسم'} />
      </label>
      {showDetail ? (
        <label>
          {preset.detailLabel || 'نوع التعامل'}
          <select value={draft.subAccountName || detailOptions[0]} disabled={structureLocked} onChange={(event) => setDraft((current) => ({ ...current, subAccountName: event.target.value }))}>
            {detailOptions.map((option) => (
              <option key={option} value={option}>{accountDetailDisplayName({ ...draft, subAccountName: option })}</option>
            ))}
          </select>
        </label>
      ) : null}
      {accountNeedsCurrency(parsedClassification) ? (
        <label>
          العملة
          <select name={structureLocked ? undefined : 'currencyKind'} value={currencyFieldValue} disabled={structureLocked} onChange={(event) => setDraft((current) => ({ ...current, currencyKind: event.target.value }))}>
            {showLegacyMultiCurrency ? <option value="">اتركها فارغة بدون تغيير</option> : null}
            {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  )
}

export function AccountProfile({ bucket, movements, accounts, attachments = [], reconciliations = [], recurringRules = [], dimensions = [], dimensionReport = null, auditEvents = [], movementPage = null, isLoadingMovements = false, isAddingAttachment = false, isDeletingAccount = false, onClose, onEditMovement, onUpdateAccount, onDeleteAccount, onAddAttachment, onDeleteAttachment, onLoadMoreMovements, onLoadStatement, onViewDimensionHistory }) {
  const [deleteConfirmationAccountId, setDeleteConfirmationAccountId] = useState('')
  const [statementOpen, setStatementOpen] = useState(false)
  const [statementMovements, setStatementMovements] = useState(null)
  const [isLoadingStatement, setIsLoadingStatement] = useState(false)
  const [statementError, setStatementError] = useState('')
  const profileAccountId = bucket?.account?.id || ''
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!profileAccountId || typeof document === 'undefined') return undefined
    const opener = document.activeElement
    const panel = panelRef.current
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])'
    closeButtonRef.current?.focus()

    function handleDialogKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll(focusableSelector))
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
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

    document.addEventListener('keydown', handleDialogKeydown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeydown)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [profileAccountId])

  if (!bucket) return null

  const { account, postedCount } = bucket
  const isTrackingAccount = account.valueKind === VALUE_KINDS.PROJECT
  const accountUsage = accountStructureUsage(account, { accounts, movements, reconciliations, recurringRules, dimensions })
  const structureLocked = accountUsage.locked
  const accountLocked = accountUsage.movement
  const accountAttachments = attachmentsForRecord(attachments, {
    accountId: account.id,
  })
  const relatedMovements = accountProfileMovements(movements, account.id)
  const accountMap = new Map(accounts.map((item) => [item.id, item]))
  const primaryBalance = accountPrimaryBalance(bucket)
  const profileBalanceTone = primaryBalance.amount > 0 ? 'is-positive' : primaryBalance.amount < 0 ? 'is-negative' : 'is-zero'
  const trackingNetAmounts = dimensionReport ? [
    { currency: CURRENCIES.DINAR, income: dimensionReport.income, expense: dimensionReport.expense, net: dimensionReport.net },
    { currency: CURRENCIES.USD, income: dimensionReport.incomeUsd, expense: dimensionReport.expenseUsd, net: dimensionReport.netUsd },
    { currency: CURRENCIES.TRY, income: dimensionReport.incomeTry, expense: dimensionReport.expenseTry, net: dimensionReport.netTry },
    { currency: CURRENCIES.EUR, income: dimensionReport.incomeEur, expense: dimensionReport.expenseEur, net: dimensionReport.netEur },
  ].filter(({ income, expense }) => income || expense) : []
  const deletion = accountDeletionEligibility(account, { accounts, movements, attachments, reconciliations, recurringRules, dimensions })
  const deleteLabel = deletion.isCounterpartyBundle ? 'حذف الشخص وحساباته' : 'حذف الحساب'
  const isDeleteConfirmationOpen = deleteConfirmationAccountId === profileAccountId

  async function openStatement() {
    setStatementOpen(true)
    if (!onLoadStatement || statementMovements) return
    setIsLoadingStatement(true)
    setStatementError('')
    try {
      const completeMovements = await onLoadStatement(accountStatementAccountIds(account, accounts))
      setStatementMovements(Array.isArray(completeMovements) ? completeMovements : movements)
    } catch {
      setStatementError('تعذر تحميل الكشف كاملًا. أعد المحاولة.')
    } finally {
      setIsLoadingStatement(false)
    }
  }

  return (
    <LedgerOverlayPortal>
      <div className={`ml3-profile-layer ${statementOpen ? 'has-statement' : ''}`} role="dialog" aria-modal="true" aria-label="ملف الحساب" onClick={onClose}>
        <aside ref={panelRef} className="ml3-profile" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="ml3-profile-head">
          <div className="ml3-profile-identity">
            <i><AccountChoiceIcon account={account} size={18} /></i>
            <div>
              <span>{protectedAccountContext(account)}</span>
              <h2 className="adreem-account-name">{protectedAccountPrimaryName(account)}</h2>
              <p>{account.valueKind === VALUE_KINDS.RECEIVABLE ? 'ما لك وما عليك معه' : account.valueKind === VALUE_KINDS.CASH || account.valueKind === VALUE_KINDS.BANK ? 'مكان من أماكن فلوسك' : 'حساب للمتابعة'}</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="إغلاق" title="إغلاق" onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </div>

        <div className="ml3-profile-body">
          <section className="ml3-profile-overview">
            {isTrackingAccount ? (
              <div className="ml3-profile-balance adreem-profile-tracking-balance">
                <strong>صافي التتبع</strong>
                <span>{trackingNetAmounts.length ? trackingNetAmounts.map(({ currency, net }) => <b key={currency}>{money(net, currency)}</b>) : 'لا توجد حركات بعد'}</span>
              </div>
            ) : (
              <div className={`ml3-profile-balance ${profileBalanceTone}`}>
                <strong>{formatDisplayMeaning(account, primaryBalance.amount, primaryBalance.currency)}</strong>
                <span>{hasMoneyValue(primaryBalance.secondaryAmount) ? money(primaryBalance.secondaryAmount, primaryBalance.secondaryCurrency) : money(0, primaryBalance.currency)}</span>
              </div>
            )}

            <div className="ml3-profile-facts">
              <div>
                <span>نوع الحساب</span>
                <strong>{accountKindText(account)}</strong>
              </div>
              <div>
                <span>الحركات</span>
                <strong>{formatCount(isTrackingAccount ? dimensionReport?.movementCount || 0 : postedCount)}</strong>
              </div>
              <div>
                <span>الحالة</span>
                <strong>{account.status === ACCOUNT_STATUSES.ACTIVE ? 'فعال' : account.status}</strong>
              </div>
            </div>
          </section>

          {isTrackingAccount ? (
            <button type="button" className="adreem-statement-open" onClick={() => onViewDimensionHistory?.(dimensionReport?.dimension?.id || account.dimensionId || `dimension-account-${account.id}`)}>
              <ReceiptText aria-hidden="true" size={17} /> حركات المشروع
            </button>
          ) : (
            <button type="button" className="adreem-statement-open" onClick={openStatement}>
              <ReceiptText aria-hidden="true" size={17} /> كشف حساب
            </button>
          )}

          {statementOpen ? (
            <AccountStatement
              account={account}
              accounts={accounts}
              movements={statementMovements || movements}
              isLoading={isLoadingStatement}
              loadError={statementError}
              onClose={() => setStatementOpen(false)}
            />
          ) : null}

          <section className="ml3-profile-tools">
            <details className="ml3-profile-disclosure">
              <summary>
                <span><strong>مرفقات</strong><small>{formatCount(accountAttachments.length)}</small></span>
                <ChevronDown aria-hidden="true" size={16} />
              </summary>
              <form className="ml3-profile-reconcile ml3-profile-reconcile--attachment ml3-profile-disclosure-body" aria-busy={isAddingAttachment} onSubmit={(event) => onAddAttachment(event, account.id)}>
                <div className="ml3-profile-editor-grid">
                  <label>
                    اسم المرفق
                    <input name="attachmentLabel" placeholder="مثال: صورة إيصال أو عقد" />
                  </label>
                  <label>
                    الرابط
                    <input name="attachmentUrl" placeholder="اختياري" />
                  </label>
                  <AttachmentFileField />
                </div>
                <button type="submit" disabled={isAddingAttachment}>
                  {isAddingAttachment ? 'جاري رفع المرفق' : 'ربط مرفق'}
                </button>
                {accountAttachments.length ? (
                  <div className="ml3-attachment-list">
                    {accountAttachments.slice(0, 5).map((attachment) => (
                      <AttachmentLink key={attachment.id} attachment={attachment} onDelete={onDeleteAttachment} />
                    ))}
                  </div>
                ) : null}
              </form>
            </details>
          </section>

          <section className="ml3-profile-account">
            <details className="ml3-profile-disclosure">
              <summary>
                <span><strong>بيانات الحساب</strong></span>
                <ChevronDown aria-hidden="true" size={16} />
              </summary>
              <form className={`ml3-profile-editor ml3-profile-disclosure-body${accountLocked ? ' is-locked' : ''}`} onSubmit={(event) => onUpdateAccount(event, account.id)}>
                <AccountClassificationEditorFields account={account} structureLocked={structureLocked} accountLocked={accountLocked} />
                <button type="submit">حفظ التعديل</button>
              </form>
            </details>

            <AccountEditHistory accountId={account.id} auditEvents={auditEvents} />

            {deletion.canDelete ? (
              <div className={`ml3-profile-danger${isDeleteConfirmationOpen ? ' is-confirming' : ''}`}>
                {isDeleteConfirmationOpen ? (
                  <>
                    <div>
                      <Trash2 aria-hidden="true" size={16} />
                      <span><strong>حذف نهائي</strong><small>لا يمكن التراجع.</small></span>
                    </div>
                    <div className="ml3-profile-danger-actions">
                      <button type="button" onClick={() => setDeleteConfirmationAccountId('')} disabled={isDeletingAccount}>تراجع</button>
                      <button type="button" className="is-danger" onClick={() => onDeleteAccount(account.id)} disabled={isDeletingAccount}>
                        {isDeletingAccount ? 'جاري الحذف' : 'تأكيد الحذف'}
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setDeleteConfirmationAccountId(profileAccountId)}>
                    <Trash2 aria-hidden="true" size={15} />
                    <span>{deleteLabel}</span>
                  </button>
                )}
              </div>
            ) : null}
          </section>

          {!isTrackingAccount ? <section className="ml3-profile-activity">
            <div className="ml3-profile-movements">
              <div className="ml3-profile-section-head">
                <h3>الحركات</h3>
                <span>{formatCount(relatedMovements.length)}</span>
              </div>
              {relatedMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات لهذا الحساب.</p> : null}
              {relatedMovements.map((movement) => {
                const impacts = movement.status === MOVEMENT_STATUSES.POSTED ? movementAccountImpact(movement, account.id) : []
                const source = accountMap.get(movement.sourceAccountId)
                const destination = accountMap.get(movement.destinationAccountId)
                const movementAttachments = attachmentsForRecord(attachments, {
                  movementId: movement.id,
                })
                return (
                  <article className="ml3-profile-movement" key={movement.id}>
                    <div>
                      <strong>{movementLabels[movement.type] || movement.type}</strong>
                      <span className={movement.type === MOVEMENT_TYPES.RECORD_ONLY ? undefined : 'adreem-account-name'}>
                        {movement.type === MOVEMENT_TYPES.RECORD_ONLY
                          ? preserveUiData(movement.note || 'تسجيل للمتابعة فقط')
                          : <>{source ? protectedAccountLabel(source) : 'بدون مصدر'} ← {destination ? protectedAccountLabel(destination) : 'بدون وجهة'}</>}
                      </span>
                      <small>{movementDateTime(movement.createdAt || movement.updatedAt)} · {movementStatusLabel(movement.status)}</small>
                      {movement.note ? <small>{preserveUiData(movement.note)}</small> : null}
                      {movementAttachments.length ? (
                        <div className="ml3-attachment-list">
                          {movementAttachments.map((item) => (
                            <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="ml3-profile-impact">
                      {impacts.map((impact) => (
                        <b key={`${movement.id}-${impact.currency}`}>{signedMoney(impact.delta, impact.currency)}</b>
                      ))}
                      {!movement.id?.startsWith('opening-') && canCancelMovement(movement) ? (
                        <button type="button" onClick={() => onEditMovement(movement)}>
                          تعديل
                        </button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
              {movementPage?.hasMore ? (
                <button type="button" className="ml3-history-more" disabled={isLoadingMovements} onClick={onLoadMoreMovements}>
                  {isLoadingMovements ? 'جاري التحميل' : 'حركات أقدم'}
                </button>
              ) : null}
            </div>
          </section> : null}
        </div>
        </aside>
      </div>
    </LedgerOverlayPortal>
  )
}
