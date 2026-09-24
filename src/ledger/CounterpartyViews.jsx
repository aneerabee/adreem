/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { ChevronDown, ChevronLeft, Pin, UserRound } from 'lucide-react'
import { motion as Motion } from 'motion/react'
import { accountChoiceKindLabel } from './accountConfig'
import { preserveUiData } from './uiTranslation'
import { counterpartyBucketAmount } from './balanceViews'
import { formatCount, hasMoneyValue, money } from './ledgerFormat'
import { AccountChoiceIcon } from './LedgerIcons'
import { COUNTERPARTY_BALANCE_FILTERS, UI_MOTION_TRANSITION } from './ledgerUiConfig'

function CounterpartyChannel({ bucket }) {
  const { amount, currency } = counterpartyBucketAmount(bucket)
  const rowTone = amount > 0 ? 'is-positive' : amount < 0 ? 'is-negative' : 'is-zero'
  const channelKind = bucket.account?.counterpartyKind || 'other'
  return (
    <span className={`adreem-counterparty-channel is-${channelKind} ${rowTone}`}>
      <i><AccountChoiceIcon account={bucket.account} size={14} /></i>
      <small>{accountChoiceKindLabel(bucket.account)}</small>
      <b>{amount === 0 ? 'صفر' : `${amount > 0 ? 'أقبض' : 'أدفع'} ${money(Math.abs(amount), currency)}`}</b>
    </span>
  )
}

export function CounterpartyCard({ group, isFocused = false, isDimmed = false, onFocus, onOpen, onToggleSettlement }) {
  const hasReceivable = group.receivable.dinar > 0 || group.receivable.usd > 0 || group.receivable.try > 0 || Number(group.receivable.eur || 0) > 0
  const hasPayable = group.payable.dinar > 0 || group.payable.usd > 0 || group.payable.try > 0 || Number(group.payable.eur || 0) > 0
  const settlementPinned = Boolean(group.settlementPinned)
  const tone = hasReceivable && hasPayable ? 'mixed' : hasReceivable ? 'receivable' : hasPayable ? 'payable' : 'zero'
  const previewRows = group.rows.filter((bucket) => hasMoneyValue(counterpartyBucketAmount(bucket).amount))
  return (
    <Motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={UI_MOTION_TRANSITION}
      className={['adreem-counterparty-card', `is-${tone}`, 'is-balances-view', previewRows.length ? 'has-balances' : 'is-settled', settlementPinned && 'is-settlement-pinned', isFocused && 'is-focused', isDimmed && 'is-dimmed'].filter(Boolean).join(' ')}
      data-counterparty-id={group.id}
    >
      <div className="adreem-counterparty-main">
        <button type="button" className="adreem-counterparty-focus" aria-expanded={isFocused} onClick={() => onFocus?.(group.id)}>
          <span className="adreem-counterparty-avatar"><UserRound aria-hidden="true" size={16} /></span>
          <span className="adreem-counterparty-identity">
            <strong className="adreem-account-name">{preserveUiData(group.ownerName)}</strong>
          </span>
          <ChevronDown className="adreem-counterparty-chevron" aria-hidden="true" size={16} />
        </button>
        <button
          type="button"
          className="adreem-counterparty-settlement-toggle"
          aria-label={settlementPinned ? 'إلغاء تثبيت التسوية' : 'تثبيت للتسوية'}
          aria-pressed={settlementPinned}
          title={settlementPinned ? 'إلغاء تثبيت التسوية' : 'تثبيت للتسوية'}
          onClick={() => onToggleSettlement?.(group)}
        >
          <Pin aria-hidden="true" size={15} fill={settlementPinned ? 'currentColor' : 'none'} />
        </button>
      </div>
      {isFocused ? (
        <Motion.div key="channels" className="adreem-counterparty-channels" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={UI_MOTION_TRANSITION}>
          {group.rows.map((bucket) => {
            const { amount, currency } = counterpartyBucketAmount(bucket)
            const rowTone = amount > 0 ? 'is-positive' : amount < 0 ? 'is-negative' : 'is-zero'
            return (
              <button type="button" key={bucket.account.id} className={rowTone} onClick={() => onOpen?.(bucket.account.id)}>
                <i><AccountChoiceIcon account={bucket.account} size={15} /></i>
                <span>{accountChoiceKindLabel(bucket.account)}</span>
                <b>{amount === 0 ? 'صفر' : `${amount > 0 ? 'أقبض' : 'أدفع'} ${money(Math.abs(amount), currency)}`}</b>
                <ChevronLeft aria-hidden="true" size={14} />
              </button>
            )
          })}
        </Motion.div>
      ) : previewRows.length ? (
        <Motion.div
          key="channel-preview"
          className="adreem-counterparty-channel-preview"
          aria-label="تفصيل الرصيد"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={UI_MOTION_TRANSITION}
        >
          {previewRows.map((bucket) => <CounterpartyChannel key={bucket.account.id} bucket={bucket} />)}
        </Motion.div>
      ) : null}
    </Motion.article>
  )
}

export function CounterpartyList({ title, groups = [], focusedId = '', onFocus, onOpen, onToggleSettlement, hideHeader = false }) {
  const hasFocus = groups.some((group) => group.id === focusedId)
  return (
    <section className={`adreem-counterparty-list ${hasFocus ? 'has-focus' : ''}`}>
      {!hideHeader ? (
        <div className="adreem-counterparty-list-head">
          <h3>{title}</h3>
          <span>{formatCount(groups.length)}</span>
        </div>
      ) : null}
      {groups.length === 0 ? <p className="ml3-empty">لا شيء</p> : null}
      <div className="adreem-counterparty-grid">
        {groups.map((group) => <CounterpartyCard key={group.id} group={group} isFocused={group.id === focusedId} isDimmed={hasFocus && group.id !== focusedId} onFocus={onFocus} onOpen={onOpen} onToggleSettlement={onToggleSettlement} />)}
      </div>
    </section>
  )
}

export function CounterpartyFilters({ options = COUNTERPARTY_BALANCE_FILTERS, value = 'all', onChange }) {
  return (
    <div className="adreem-counterparty-filters" aria-label="فلترة الأشخاص">
      {options.map((option) => {
        const Icon = option.icon
        const selected = value === option.key
        return (
          <button type="button" key={option.key} className={`is-${option.key}`} aria-pressed={selected} onClick={() => onChange?.(option.key)}>
            <Icon aria-hidden="true" size={14} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
