/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useState } from 'react'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES, buildPostingEntries } from './ledgerCore'
import { resolveAdreemAttachmentUrl } from './ledgerPersistence'
import { movementLabels, movementTone } from './movementConfig'
import { attachmentsForRecord } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { protectedAccountPrimaryName } from './accountPresentation'
import { expenseCategoryTone } from './balanceViews'
import { formatRate, money, signedMoney } from './ledgerFormat'
import { MovementTypeIcon } from './LedgerIcons'
import { canEditMovement, movementNoteAddsContext, movementStatusLabel, movementTime } from './movementPresentation'
import { isExpenseMovement, movementAccountContext, movementAccountLabel } from './movementDisplay'

export function AttachmentFileField({ name = 'attachmentFile' }) {
  const [fileName, setFileName] = useState('')
  return (
    <label className="ml3-file-field">
      ملف
      <span>{fileName ? preserveUiData(fileName) : 'اختر ملفًا'}</span>
      <input name={name} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFileName(event.target.files?.[0]?.name || '')} />
    </label>
  )
}

export function AttachmentLink({ attachment, onDelete }) {
  const [status, setStatus] = useState('idle')

  async function openAttachment() {
    const popup = typeof window !== 'undefined' ? window.open('', '_blank') : null
    if (popup) popup.opener = null
    setStatus('opening')
    try {
      const url = await resolveAdreemAttachmentUrl(attachment)
      if (!url) throw new Error('Attachment link is missing.')
      if (popup) popup.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
      setStatus('idle')
    } catch {
      popup?.close()
      setStatus('error')
    }
  }

  return (
    <span className="ml3-attachment-action">
      <button type="button" onClick={openAttachment} disabled={status === 'opening'}>
        {status === 'opening' ? 'فتح...' : preserveUiData(attachment.label)}
      </button>
      {onDelete ? (
        <button type="button" className="is-danger" onClick={() => onDelete(attachment.id)}>
          حذف
        </button>
      ) : null}
      {status === 'error' ? <small>تعذر فتحه</small> : null}
    </span>
  )
}

function MovementTitle({ movement, expenseCategory }) {
  if (!isExpenseMovement(movement)) return <strong>{movementLabels[movement.type] || movement.type}</strong>
  return (
    <strong className={`ml3-expense-title ${expenseCategory ? `adreem-category-tone-${expenseCategoryTone(expenseCategory.ownerName)}` : 'is-uncategorized'}`}>
      {expenseCategory ? <span className="adreem-account-name">{protectedAccountPrimaryName(expenseCategory)}</span> : 'مصروف بدون تصنيف'}
    </strong>
  )
}

export function MovementMiniRow({ movement, accountById, investmentPlatformById = new Map(), attachments = [], dimensions = [], onEdit, onCancel, onDeleteAttachment }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const investmentPlatform = investmentPlatformById.get(movement.investmentPlatformId)
  const routeSource = source || (movement.type === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL ? investmentPlatform : null)
  const routeDestination = destination || (movement.type === MOVEMENT_TYPES.INVESTMENT_DEPOSIT ? investmentPlatform : null)
  const routeAccountIds = new Set([movement.sourceAccountId, movement.destinationAccountId].filter(Boolean))
  const effects = movement.status === MOVEMENT_STATUSES.POSTED
    ? buildPostingEntries(movement).filter((effect) => !routeAccountIds.has(effect.accountId))
    : []
  const movementAttachments = attachmentsForRecord(attachments, {
    movementId: movement.id,
  })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)
  const expenseCategory = accountById.get(movement.expenseCategoryId)
  const isExpense = isExpenseMovement(movement)
  const showNote = movementNoteAddsContext(movement, expenseCategory)

  return (
    <article className={`ml3-today-row ml3-today-row--${movementTone(movement.type)} ${isExpense ? 'is-expense' : ''} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-today-main">
        <i className="ml3-movement-icon"><MovementTypeIcon type={movement.type} /></i>
        <span className="ml3-movement-copy">
          <MovementTitle movement={movement} expenseCategory={expenseCategory} />
          {isExpense && showNote ? <span className="ml3-movement-description">{preserveUiData(movement.note)}</span> : null}
          <small>{movementTime(movement.createdAt)} · {movementStatusLabel(movement.status)}</small>
        </span>
        <b className="ml3-today-amount">{money(movement.amount, movement.currency)}</b>
      </div>
      <div className={`ml3-today-route ${routeSource && routeDestination ? 'is-paired' : 'is-single'}`}>
        {routeSource ? (
          <span className="ml3-today-endpoint is-source">
            <small className="ml3-today-endpoint-label">من</small>
            <span className="ml3-today-endpoint-copy">
              <b className="adreem-account-name">{source ? protectedAccountPrimaryName(source) : preserveUiData(investmentPlatform.name)}</b>
              {source ? (movementAccountContext(source) ? <em>{movementAccountContext(source)}</em> : null) : <em>محفظتي · USD</em>}
            </span>
          </span>
        ) : null}
        {routeSource && routeDestination ? <span className="ml3-today-arrow" aria-hidden="true"><ChevronDown size={14} /></span> : null}
        {routeDestination ? (
          <span className="ml3-today-endpoint is-destination">
            <small className="ml3-today-endpoint-label">إلى</small>
            <span className="ml3-today-endpoint-copy">
              <b className="adreem-account-name">{destination ? protectedAccountPrimaryName(destination) : preserveUiData(investmentPlatform.name)}</b>
              {destination ? (movementAccountContext(destination) ? <em>{movementAccountContext(destination)}</em> : null) : <em>محفظتي · USD</em>}
            </span>
          </span>
        ) : null}
      </div>
      {effects.length ? (
        <div className="ml3-today-effects">
          {effects.map((effect) => {
            const account = accountById.get(effect.accountId)
            return (
              <span key={`${effect.accountId}-${effect.currency}`}>
                <b className="adreem-account-name">{account ? protectedAccountPrimaryName(account) : preserveUiData(effect.accountId)}</b> {signedMoney(effect.delta, effect.currency)}
              </span>
            )
          })}
        </div>
      ) : null}
      {showNote && !isExpense ? <small>{preserveUiData(movement.note)}</small> : null}
      {dimension ? <small>ملف: {preserveUiData(dimension.name)}</small> : null}
      {movementAttachments.length ? (
        <div className="ml3-attachment-list">
          {movementAttachments.map((item) => (
            <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
          ))}
        </div>
      ) : null}
      {canEditMovement(movement) ? (
        <div className="ml3-movement-actions">
          <button type="button" className="is-edit" onClick={() => onEdit?.(movement)}><Pencil aria-hidden="true" size={14} /> تعديل</button>
          <button type="button" className="is-cancel" onClick={() => onCancel(movement.id)}><Trash2 aria-hidden="true" size={14} /> إلغاء</button>
        </div>
      ) : null}
    </article>
  )
}

export function HistoryMovementRow({ movement, accountById, investmentPlatformById = new Map(), attachments = [], dimensions = [], onEdit, onCancel, onDeleteAttachment }) {
  const source = accountById.get(movement.sourceAccountId)
  const destination = accountById.get(movement.destinationAccountId)
  const investmentPlatform = investmentPlatformById.get(movement.investmentPlatformId)
  const routeSource = source || (movement.type === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL ? investmentPlatform : null)
  const routeDestination = destination || (movement.type === MOVEMENT_TYPES.INVESTMENT_DEPOSIT ? investmentPlatform : null)
  const effects = movement.status === MOVEMENT_STATUSES.POSTED ? buildPostingEntries(movement) : []
  const conversionEffect = movement.rate
    ? effects.find((effect) => effect.currency !== movement.currency)
    : null
  const reviewErrors = movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW
    ? (movement.validation?.errors || []).slice(0, 2)
    : []
  const statusLabel = movement.status === MOVEMENT_STATUSES.POSTED ? '' : movementStatusLabel(movement.status)
  const movementAttachments = attachmentsForRecord(attachments, {
    movementId: movement.id,
  })
  const dimension = dimensions.find((item) => item.id === movement.dimensionId)
  const expenseCategory = accountById.get(movement.expenseCategoryId)
  const isExpense = isExpenseMovement(movement)
  const showNote = movementNoteAddsContext(movement, expenseCategory)

  return (
    <article className={`ml3-history-row ml3-history-row--${movementTone(movement.type)} ${isExpense ? 'is-expense' : ''} ${movement.status === MOVEMENT_STATUSES.VOIDED ? 'is-muted' : ''}`}>
      <div className="ml3-history-main">
        <i className="ml3-movement-icon"><MovementTypeIcon type={movement.type} /></i>
        <span className="ml3-movement-copy">
          <MovementTitle movement={movement} expenseCategory={expenseCategory} />
          {isExpense && showNote ? <span className="ml3-movement-description">{preserveUiData(movement.note)}</span> : null}
          <small className="ml3-history-route">
            {isExpense ? <span className="ml3-movement-kind">مصروف</span> : null}
            {isExpense && routeSource ? <span className="ml3-movement-from">من</span> : null}
            {routeSource ? <b className="adreem-account-name">{source ? movementAccountLabel(source) : preserveUiData(investmentPlatform.name)}</b> : null}
            {routeSource && routeDestination ? <span className="ml3-history-arrow" aria-hidden="true">←</span> : null}
            {routeDestination ? <b className="adreem-account-name">{destination ? movementAccountLabel(destination) : preserveUiData(investmentPlatform.name)}</b> : null}
          </small>
        </span>
      </div>
      <div className="ml3-history-side">
        <time className="ml3-history-time" dateTime={movement.createdAt || movement.updatedAt}>{movementTime(movement.createdAt || movement.updatedAt)}</time>
        <strong>{money(movement.amount, movement.currency)}</strong>
        {conversionEffect ? <small className="ml3-history-conversion">↔ {money(Math.abs(conversionEffect.delta), conversionEffect.currency)}</small> : null}
        {movement.rate ? <small className="ml3-history-rate">× {formatRate(movement.rate)}</small> : null}
        {statusLabel ? <span className={`ml3-history-status ml3-history-status--${movement.status}`}>{statusLabel}</span> : null}
        {canEditMovement(movement) && !isExpense ? (
          <span className="ml3-history-actions">
            <button type="button" className="is-edit" onClick={() => onEdit?.(movement)}><Pencil aria-hidden="true" size={14} /> تعديل</button>
            <button type="button" className="is-cancel" onClick={() => onCancel(movement.id)}><Trash2 aria-hidden="true" size={14} /> إلغاء</button>
          </span>
        ) : null}
      </div>
      {canEditMovement(movement) && isExpense ? (
        <div className="ml3-history-actions adreem-expense-actions">
          <button type="button" className="is-edit" onClick={() => onEdit?.(movement)}><Pencil aria-hidden="true" size={14} /> تعديل المصروف</button>
          <button type="button" className="is-cancel" onClick={() => onCancel(movement.id)}><Trash2 aria-hidden="true" size={14} /> إلغاء المصروف</button>
        </div>
      ) : null}
      {(showNote && !isExpense) || dimension || reviewErrors.length ? (
        <div className="ml3-history-details">
          {showNote && !isExpense ? <p className="ml3-history-note"><span aria-hidden="true">●</span>{preserveUiData(movement.note)}</p> : null}
          {dimension ? <small>ملف: {preserveUiData(dimension.name)}</small> : null}
          {reviewErrors.map((error) => <small className="is-error" key={`${movement.id}-${error.field}`}>{error.message}</small>)}
        </div>
      ) : null}
      {movementAttachments.length ? (
        <div className="ml3-attachment-list">
          {movementAttachments.map((item) => (
            <AttachmentLink key={item.id} attachment={item} onDelete={onDeleteAttachment} />
          ))}
        </div>
      ) : null}
    </article>
  )
}
