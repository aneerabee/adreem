/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useId, useRef } from 'react'
import { AlertCircle, ChartCandlestick, Check, Minus, PencilLine, TrendingDown, TrendingUp, X } from 'lucide-react'
import { motion as Motion, useReducedMotion } from 'motion/react'
import { investmentPriceChange } from './investmentCore.js'
import { isAutoPricedHolding } from './investmentMarketPolicy.js'
import { activityDate, activityDay, decimal, holdingPriceIsStale, holdingPriceLabel, usdUnitMicros } from './investmentFormat'

export function TryExchangeRate({ fx, onChange }) {
  const source = fx.source === 'twelve-data' ? 'سعر السوق'
    : fx.source === 'ecb-reference' ? 'سعر مرجعي يومي' : fx.source === 'manual' ? 'سعر أدخلته' : ''
  return (
    <div className="adreem-investment-fx">
      <label><span><bdi>1 USD = ? TRY</bdi></span><input dir="ltr" inputMode="decimal" value={fx.rate} onChange={(event) => onChange(event.target.value)} placeholder={fx.status === 'loading' ? 'جاري الجلب' : 'سعر الصرف'} /></label>
      <small role="status" className={fx.status === 'error' ? 'is-error' : ''}>
        {fx.status === 'loading' ? 'نجلب سعر الصرف' : fx.status === 'error' ? fx.error : fx.status === 'updated' ? 'تحدث سعر الصرف. راجع القيمة ثم احفظ.' : source ? `${source} · ${fx.quotedAt ? activityDate(fx.quotedAt) : 'الآن'}` : 'اكتب السعر الفعلي إذا لم يتوفر سعر تلقائي'}
      </small>
    </div>
  )
}

export function InvestmentMarketPrice({ holding, error, onOpen }) {
  const priceMicros = Number(holding.lastPriceUsdMicros || 0)
  const showsLira = holding.quoteCurrency === 'TRY' && Number(holding.lastPriceNativeMicros || 0) > 0
  const priceTimestamp = String(holding.lastPriceQuotedAt || '')
  const dailyClose = holding.lastPriceSource === 'tgmcharts-eod'
  const providerUpdate = holding.lastPriceSource === 'burkut+ecb-fx'
  const sourceUnavailable = Boolean(holding.lastPriceSource && !['manual', 'trade', 'opening'].includes(holding.lastPriceSource)
    && !isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true'))
  const stale = Boolean(error || holdingPriceIsStale(holding))
  const priceStatus = error ? 'لم يتحدث'
    : stale ? (dailyClose || holding.lastPriceSource === 'twelve-data-eod+ecb-fx' ? 'إغلاق سابق' : 'سعر سابق')
      : dailyClose ? 'إغلاق يومي' : providerUpdate ? 'سعر المزود' : holding.lastPriceMarketOpen === false ? 'إغلاق السوق' : 'آخر سعر'
  const { direction, percent } = stale ? { direction: 'neutral', percent: 0 } : investmentPriceChange(holding)
  const DirectionIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  const prefersReducedMotion = useReducedMotion()

  return (
    <button
      type="button"
      className={`adreem-investment-price is-market-price ${priceMicros ? 'has-price' : 'is-unpriced'} is-${direction} ${stale ? 'is-stale' : ''}`.trim()}
      onClick={() => onOpen(holding)}
      aria-label={priceMicros ? `${stale ? 'السعر السابق' : dailyClose ? 'سعر الإغلاق' : providerUpdate ? 'سعر المزود' : 'السعر الحالي'} ${holdingPriceLabel(holding)}${showsLira ? ` (${usdUnitMicros(priceMicros)})` : ''}${direction !== 'neutral' ? ` · ${direction === 'up' ? '+' : '-'}${decimal(Math.abs(percent), 2)}%` : ''}` : 'إدخال السعر الحالي'}
      title={error || (sourceUnavailable ? 'مصدر التحديث غير متاح لهذا الرمز؛ السعر المعروض سابق.' : holding.lastPriceQuotedAt ? `${dailyClose ? 'تاريخ الإغلاق' : providerUpdate ? 'وقت تحديث المزود' : holding.lastPriceSource === 'dexscreener-reference' ? 'وقت التحقق' : 'وقت السعر'}: ${['twelve-data-eod+ecb-fx', 'tgmcharts-eod'].includes(holding.lastPriceSource) ? activityDay(holding.lastPriceQuotedAt) : activityDate(holding.lastPriceQuotedAt)}` : 'إدخال سعر يدوي')}
    >
      <small>
        <span>{priceStatus} {stale ? <AlertCircle aria-hidden="true" className="is-price-error" size={11} /> : <PencilLine aria-hidden="true" size={11} />}</span>
        {direction !== 'neutral' ? <em><DirectionIcon aria-hidden="true" size={11} />{Math.abs(percent).toLocaleString('en-US', { maximumFractionDigits: 2 })}%</em> : null}
      </small>
      <strong aria-live="polite" dir="ltr">
        <Motion.span
          key={`${priceTimestamp}-${priceMicros}`}
          initial={prefersReducedMotion ? false : { opacity: 0.42, y: 3, scale: 0.985 }}
          animate={prefersReducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: [0.45, 1, 0.72, 1], y: 0, scale: [0.985, 1.018, 1] }}
          transition={{ duration: 0.54, ease: [0.22, 1, 0.36, 1] }}
        >
          {priceMicros ? holdingPriceLabel(holding) : 'أدخل السعر'}
        </Motion.span>
      </strong>
      {showsLira ? <small className="adreem-investment-price-usd" dir="ltr">≈ {usdUnitMicros(priceMicros)}</small> : null}
    </button>
  )
}

export function InvestmentDialog({ title, subtitle, onClose, onSecondary = onClose, children, onSubmit, canSubmit = true, submitLabel = 'حفظ', secondaryLabel = 'رجوع', hideSubmit = false, className = '', icon: DialogIcon = ChartCandlestick, tone = 'neutral' }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  const prefersReducedMotion = useReducedMotion()
  const IconComponent = DialogIcon

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const root = document.documentElement
    const focusBeforeOpen = document.activeElement
    const focusTimer = window.requestAnimationFrame(() => {
      if (dialogRef.current?.contains(document.activeElement)) return
      const preferredControl = dialogRef.current?.querySelector('[autofocus]')
      const firstControl = preferredControl || dialogRef.current?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
      ;(firstControl || dialogRef.current)?.focus({ preventScroll: true })
    })
    function handleDialogKeys(event) {
      if (event.key === 'Escape') {
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])
      if (!controls.length) {
        event.preventDefault()
        dialogRef.current?.focus({ preventScroll: true })
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    root.classList.add('adreem-overlay-open')
    document.addEventListener('keydown', handleDialogKeys)
    return () => {
      window.cancelAnimationFrame(focusTimer)
      root.classList.remove('adreem-overlay-open')
      document.removeEventListener('keydown', handleDialogKeys)
      focusBeforeOpen?.focus?.({ preventScroll: true })
    }
  }, [])

  return (
    <Motion.div className="adreem-investment-dialog-layer" role="presentation" initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={prefersReducedMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Motion.form ref={dialogRef} tabIndex={-1} className={`adreem-investment-dialog is-tone-${tone} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={onSubmit} initial={prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={prefersReducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.99 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
        <header>
          <span><IconComponent aria-hidden="true" size={19} /></span>
          <div><h2 id={titleId}>{title}</h2>{subtitle ? <small>{subtitle}</small> : null}</div>
          <button type="button" onClick={onClose} aria-label="إغلاق" title="إغلاق"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="adreem-investment-dialog-body">{children}</div>
        <footer className={hideSubmit ? 'is-single' : ''}>
          <button type="button" className="is-secondary" onClick={onSecondary}>{hideSubmit ? 'إغلاق' : secondaryLabel}</button>
          {!hideSubmit ? <button type="submit" className="is-primary" disabled={!canSubmit}><Check aria-hidden="true" size={16} />{submitLabel}</button> : null}
        </footer>
      </Motion.form>
    </Motion.div>
  )
}
