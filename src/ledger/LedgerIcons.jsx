/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
/* eslint-disable react-refresh/only-export-components -- Tested helpers live beside the components that use them. */
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Banknote, Boxes, BriefcaseBusiness, ChartCandlestick, Check, ChevronLeft, CircleAlert, CircleDollarSign, EyeOff, Landmark, NotebookPen, ReceiptText, UserRound, WalletCards } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { VALUE_KINDS } from './accountCatalog'
import { accountChoiceKind } from './accountConfig'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore'
import { getActiveUiLanguage, translateUiText } from './uiTranslation'
import { visualKind } from './accountPresentation'
import { formatCount, money } from './ledgerFormat'
import { UI_MOTION_TRANSITION } from './ledgerUiConfig'

export function LedgerOverlayPortal({ children }) {
  if (typeof document === 'undefined') return children
  const overlayRoot = document.getElementById('adreem-overlay-root')
  return overlayRoot ? createPortal(children, overlayRoot) : children
}

export function MovementTypeIcon({ type }) {
  const props = { 'aria-hidden': true, size: 19, strokeWidth: 2.15 }
  if (type === MOVEMENT_TYPES.TRANSFER) return <ArrowRightLeft {...props} />
  if (type === MOVEMENT_TYPES.EXPENSE) return <ReceiptText {...props} />
  if (type === MOVEMENT_TYPES.EXTERNAL_INCOME) return <ArrowDownToLine {...props} />
  if (type === MOVEMENT_TYPES.CASH_DEPOSIT) return <Landmark {...props} />
  if (type === MOVEMENT_TYPES.CASH_WITHDRAWAL) return <ArrowUpFromLine {...props} />
  if (type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) return <CircleDollarSign {...props} />
  if (type === MOVEMENT_TYPES.INVESTMENT_DEPOSIT || type === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL) return <ChartCandlestick {...props} />
  if (type === MOVEMENT_TYPES.RECORD_ONLY) return <NotebookPen {...props} />
  return <Banknote {...props} />
}

export function AccountPresetIcon({ presetKey }) {
  const props = { 'aria-hidden': true, size: 19 }
  if (presetKey === 'person-cash') return <UserRound {...props} />
  if (presetKey === 'own-cash') return <Banknote {...props} />
  if (presetKey === 'own-bank') return <Landmark {...props} />
  if (presetKey === 'asset') return <Boxes {...props} />
  if (presetKey === 'project') return <BriefcaseBusiness {...props} />
  if (presetKey === 'expense') return <ReceiptText {...props} />
  return <WalletCards {...props} />
}

export function AccountChoiceIcon({ account, size = 16 }) {
  const props = { 'aria-hidden': true, size, strokeWidth: 2.1 }
  const kind = accountChoiceKind(account)
  if (kind === 'person-cash') return <Banknote {...props} />
  if (kind === 'person-bank') return <Landmark {...props} />
  if (kind === 'person-usd' || kind === 'person-try' || kind === 'person-eur') return <CircleDollarSign {...props} />
  if (kind === VALUE_KINDS.CASH) return <Banknote {...props} />
  if (kind === VALUE_KINDS.BANK) return <Landmark {...props} />
  if (kind === VALUE_KINDS.ASSET) return <Boxes {...props} />
  if (kind === VALUE_KINDS.PROJECT) return <BriefcaseBusiness {...props} />
  if (kind === VALUE_KINDS.EXPENSE) return <ReceiptText {...props} />
  return <UserRound {...props} />
}

export function accountChoiceClasses(prefix, account) {
  return [...new Set([visualKind(account), accountChoiceKind(account)])]
    .map((kind) => `${prefix}--${kind}`)
    .join(' ')
}

export function AccountGroupIcon({ groupKey }) {
  const props = { 'aria-hidden': true, size: 19 }
  if (groupKey === 'people') return <UserRound {...props} />
  if (groupKey === 'money') return <WalletCards {...props} />
  if (groupKey === 'expenses') return <ReceiptText {...props} />
  if (groupKey === 'review') return <CircleAlert {...props} />
  if (groupKey === 'separate') return <EyeOff {...props} />
  return <Boxes {...props} />
}

export function MovementChoiceButton({ option, active, onChoose }) {
  return (
    <Motion.button type="button" className={`ml3-action-choice ml3-action-choice--${option.tone} ${active ? 'is-active' : ''}`} whileTap={{ scale: 0.985 }} transition={UI_MOTION_TRANSITION} onClick={() => onChoose(option.type)}>
      <MovementTypeIcon type={option.type} />
      <span>
        <strong>{option.label}</strong>
      </span>
      <ChevronLeft aria-hidden="true" size={16} />
    </Motion.button>
  )
}

export function FlowProgress({ current, total, items = [], onEdit }) {
  const isEnglish = getActiveUiLanguage() === 'en'
  const currentText = formatCount(current)
  const totalText = formatCount(total)
  const progressText = isEnglish ? `${currentText} of ${totalText}` : `${currentText} من ${totalText}`
  const progressLabel = isEnglish ? `Step ${progressText}` : `الخطوة ${progressText}`
  return (
    <div className="adreem-flow-progress" aria-label={progressLabel}>
      <progress className="adreem-flow-progress-line" max={Math.max(1, total)} value={Math.max(0, Math.min(total, current))} aria-hidden="true" />
      <div className="adreem-flow-progress-meta">
        <span>{progressText}</span>
        {items.length ? (
          <div className="adreem-flow-trail" aria-label="الاختيارات السابقة">
            {items.map((item) => (
              <Motion.button type="button" key={item.key} whileTap={{ scale: 0.97 }} transition={UI_MOTION_TRANSITION} onClick={() => onEdit?.(item.step)} title={getActiveUiLanguage() === 'en' ? `Edit ${translateUiText(item.label, 'en')}` : `تعديل ${item.label}`}>
                <Check aria-hidden="true" size={13} strokeWidth={2.7} />
                <span>{item.label}</span>
                <strong className={['source', 'destination', 'name'].includes(item.key) ? 'adreem-account-name' : undefined}>{item.value}</strong>
              </Motion.button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MetricChip({ label, value, tone = 'neutral', currency = CURRENCIES.DINAR }) {
  return (
    <article className={`ml3-metric ml3-metric--${tone}`}>
      <span>{label}</span>
      <strong>{money(value, currency)}</strong>
    </article>
  )
}
