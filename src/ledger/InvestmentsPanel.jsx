/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowUpFromLine, ChartCandlestick, Check, ChevronDown, CircleDollarSign, Clock3, Eye, EyeOff, History, Landmark, LockKeyhole, Minus, PackageCheck, PencilLine, Plus, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp, Trash2, WalletCards, X } from 'lucide-react'
import { AnimatePresence, motion as Motion, useReducedMotion } from 'motion/react'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  INVESTMENT_ASSET_TYPES,
  MIN_VISIBLE_INVESTMENT_USD_MICROS,
  SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS,
  INVESTMENT_TRADE_TYPES,
  investmentDecimalInputIsValid,
  investmentOpeningTradeIsLocked,
  investmentPriceChange,
  investmentTradeValueMicros,
  microsToUsd,
  parseInvestmentDecimal,
  quantityToUnits,
  unitsToQuantity,
  usdToMicros,
} from './investmentCore.js'
import { buildInvestmentPlatformActivity } from './investmentActivity.js'
import { investmentPlatformBrandStyle, resolveInvestmentPlatformBrand } from './investmentPlatformBrands.js'
import { getActiveUiLanguage, preserveUiData } from './uiTranslation.js'
import { isAutoPricedHolding } from './investmentMarketPolicy.js'

const ASSET_OPTIONS = [
  { value: INVESTMENT_ASSET_TYPES.STOCK, label: 'سهم مباشر' },
  { value: INVESTMENT_ASSET_TYPES.CRYPTO, label: 'عملة رقمية' },
  { value: INVESTMENT_ASSET_TYPES.METAL, label: 'معدن' },
  { value: INVESTMENT_ASSET_TYPES.FUND, label: 'صندوق' },
  { value: INVESTMENT_ASSET_TYPES.OTHER, label: 'أخرى' },
]

const MARKET_OPTIONS = [
  { value: 'USD', label: 'أمريكا' },
  { value: 'TRY', label: 'تركيا' },
]

const blankPlatform = { name: '', kind: 'platform', location: '' }
const blankHolding = { platformId: '', name: '', symbol: '', providerSymbol: '', marketDataMode: 'manual', assetType: INVESTMENT_ASSET_TYPES.STOCK, exchange: '', quoteCurrency: 'USD', initialQuantity: '', initialPriceUsd: '' }
const blankTrade = { holdingId: '', type: INVESTMENT_TRADE_TYPES.BUY, quantity: '', priceUsd: '', feeUsd: '', note: '' }
const blankTradeEdit = { quantity: '', priceUsd: '', feeUsd: '', note: '' }
const PRICE_SOURCE_LABELS = {
  coinbase: { ar: 'Coinbase', en: 'Coinbase' },
  'gold-api': { ar: 'Gold API', en: 'Gold API' },
  'gold-api-reference': { ar: 'سعر مرجعي', en: 'Reference price' },
  'dexscreener-reference': { ar: 'سعر مرجعي · DEX Screener', en: 'Reference price · DEX Screener' },
  'binance-usdt+coinbase-usdt-usd': { ar: 'Binance · تحويل Coinbase', en: 'Binance · Coinbase FX' },
  'binance-usdt+twelve-data-usdt-usd': { ar: 'Binance · تحويل Twelve Data', en: 'Binance · Twelve Data FX' },
  'twelve-data': { ar: 'Twelve Data', en: 'Twelve Data' },
  'twelve-data-eod+ecb-fx': { ar: 'إغلاق يومي · صرف أوروبي', en: 'Daily close · ECB FX' },
  'twelve-data+ecb-fx': { ar: 'Twelve Data · صرف أوروبي يومي', en: 'Twelve Data · ECB daily FX' },
  'tgmcharts-eod': { ar: 'TGMCharts · إغلاق يومي', en: 'TGMCharts · Daily close' },
  'burkut+ecb-fx': { ar: 'Bürküt · صرف أوروبي', en: 'Bürküt · ECB FX' },
}

function decimal(value, digits = 6) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return number.toLocaleString('en-US', { maximumFractionDigits: digits })
}

function usdMicros(value, sign = false) {
  const number = microsToUsd(value)
  return `${sign && number > 0 ? '+' : ''}${decimal(number, 2)} USD`
}

function usdUnitMicros(value) {
  return `${decimal(microsToUsd(value), 6)} USD`
}

function assetTypeForMarketResult(result = {}) {
  const type = String(result.instrumentType || '').toLocaleLowerCase('en')
  if (type.includes('crypto')) return INVESTMENT_ASSET_TYPES.CRYPTO
  if (type.includes('metal') || type.includes('commodity')) return INVESTMENT_ASSET_TYPES.METAL
  if (type.includes('fund') || type.includes('etf')) return INVESTMENT_ASSET_TYPES.FUND
  if (type.includes('stock') || type.includes('equity') || type.includes('share')) return INVESTMENT_ASSET_TYPES.STOCK
  return INVESTMENT_ASSET_TYPES.OTHER
}

function holdingTypeLabel(value) {
  return ASSET_OPTIONS.find((option) => option.value === value)?.label || 'أخرى'
}

function profitPercent(profitUsdMicros, costBasisUsdMicros) {
  if (!costBasisUsdMicros) return ''
  return `${profitUsdMicros > 0 ? '+' : ''}${decimal((profitUsdMicros / costBasisUsdMicros) * 100, 2)}%`
}

function holdingIsSmall(row = {}) {
  if (!Number(row.quantityUnits || 0)) return true
  return Number(row.holding?.lastPriceUsdMicros || 0) > 0
    && Number(row.marketValueUsdMicros || 0) < MIN_VISIBLE_INVESTMENT_USD_MICROS
}

function platformLogoUrl(brand) {
  return brand.logo ? `${import.meta.env.BASE_URL}${brand.logo}` : ''
}

function activityActionLabel(row) {
  if (row.action === INVESTMENT_TRADE_TYPES.OPENING) return 'رصيد افتتاحي'
  if (row.action === INVESTMENT_TRADE_TYPES.BUY) return 'شراء'
  if (row.action === INVESTMENT_TRADE_TYPES.SELL) return 'بيع'
  if (row.action === MOVEMENT_TYPES.INVESTMENT_DEPOSIT) return 'إيداع'
  if (row.action === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL) return 'سحب'
  return 'عملية'
}

function activityDate(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return 'بدون تاريخ'
  return date.toLocaleString(getActiveUiLanguage() === 'en' ? 'en-GB' : 'ar-LY', { dateStyle: 'medium', timeStyle: 'short' })
}

function activityDay(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return 'بدون تاريخ'
  return date.toLocaleDateString(getActiveUiLanguage() === 'en' ? 'en-GB' : 'ar-LY', { dateStyle: 'medium', timeZone: 'UTC' })
}

function accountLabel(account) {
  if (!account) return ''
  return [account.ownerName, account.subAccountName].filter(Boolean).join(' · ')
}

function tradeReviewImpact(trade = {}) {
  if (!trade) return { label: 'أثر النقد', valueUsdMicros: 0 }
  const valueUsdMicros = investmentTradeValueMicros(trade)
  const feeUsdMicros = Math.max(0, Number(trade.feeUsdMicros || 0))
  if (trade.type === INVESTMENT_TRADE_TYPES.OPENING) {
    return { label: 'التكلفة', valueUsdMicros: valueUsdMicros + feeUsdMicros }
  }
  if (trade.type === INVESTMENT_TRADE_TYPES.BUY) {
    return { label: 'أثر النقد', valueUsdMicros: -(valueUsdMicros + feeUsdMicros) }
  }
  return { label: 'أثر النقد', valueUsdMicros: valueUsdMicros - feeUsdMicros }
}

function holdingPriceIsStale(holding) {
  if (Number(holding.lastPriceUsdMicros || 0) <= 0) return false
  const automated = isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true')
  const sourceUnavailable = Boolean(holding.lastPriceSource && !['manual', 'trade', 'opening'].includes(holding.lastPriceSource) && !automated)
  if (sourceUnavailable) return true
  if (!automated) return false
  const quotedAge = Date.now() - Date.parse(String(holding.lastPriceQuotedAt || ''))
  const dailyClose = ['tgmcharts-eod', 'twelve-data-eod+ecb-fx', 'burkut+ecb-fx'].includes(holding.lastPriceSource)
  const maxQuoteAge = holding.assetType === 'crypto' ? 15 * 60 * 1000 : dailyClose || holding.lastPriceMarketOpen === false ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
  return !Number.isFinite(quotedAge) || quotedAge > maxQuoteAge
}

function InvestmentMarketPrice({ holding, error, onOpen }) {
  const nativePriceMicros = Number(holding.lastPriceNativeMicros || 0)
  const priceMicros = nativePriceMicros || Number(holding.lastPriceUsdMicros || 0)
  const priceCurrency = nativePriceMicros ? holding.quoteCurrency : 'USD'
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
      aria-label={priceMicros ? `${stale ? 'السعر السابق' : dailyClose ? 'سعر الإغلاق' : providerUpdate ? 'سعر المزود' : 'السعر الحالي'} ${decimal(microsToUsd(priceMicros), 6)} ${priceCurrency}` : 'إدخال السعر الحالي'}
      title={error || (sourceUnavailable ? 'مصدر التحديث غير متاح لهذا الرمز؛ السعر المعروض سابق.' : holding.lastPriceQuotedAt ? `${dailyClose ? 'تاريخ الإغلاق' : providerUpdate ? 'وقت تحديث المزود' : holding.lastPriceSource === 'dexscreener-reference' ? 'وقت التحقق' : 'وقت السعر'}: ${['twelve-data-eod+ecb-fx', 'tgmcharts-eod'].includes(holding.lastPriceSource) ? activityDay(holding.lastPriceQuotedAt) : activityDate(holding.lastPriceQuotedAt)}` : 'إدخال سعر يدوي')}
    >
      <small>
        <span>{priceStatus} {stale ? <AlertCircle aria-hidden="true" className="is-price-error" size={11} /> : <PencilLine aria-hidden="true" size={11} />}</span>
        {direction !== 'neutral' ? <em><DirectionIcon aria-hidden="true" size={11} />{Math.abs(percent).toLocaleString('en-US', { maximumFractionDigits: 2 })}%</em> : null}
      </small>
      <strong aria-live="polite">
        <Motion.span
          key={`${priceTimestamp}-${priceMicros}`}
          initial={prefersReducedMotion ? false : { opacity: 0.42, y: 3, scale: 0.985 }}
          animate={prefersReducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: [0.45, 1, 0.72, 1], y: 0, scale: [0.985, 1.018, 1] }}
          transition={{ duration: 0.54, ease: [0.22, 1, 0.36, 1] }}
        >
          {priceMicros ? `${decimal(microsToUsd(priceMicros), 6)} ${priceCurrency}` : 'أدخل السعر'}
        </Motion.span>
      </strong>
    </button>
  )
}

function InvestmentDialog({ title, subtitle, onClose, onSecondary = onClose, children, onSubmit, canSubmit = true, submitLabel = 'حفظ', secondaryLabel = 'رجوع', hideSubmit = false, className = '', icon: DialogIcon = ChartCandlestick, tone = 'neutral' }) {
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

export default function InvestmentsPanel({
  summary,
  platforms = [],
  holdings = [],
  trades = [],
  movements = [],
  accounts = [],
  isRefreshing = false,
  priceErrors = {},
  onAddPlatform,
  onAddHolding,
  onAddTrade,
  onEditTrade,
  onEditMovement,
  onManualPrice,
  onCloseSmallHolding,
  onOpenFunding,
  onRefreshPrices,
  onSearchAssets,
}) {
  const [dialog, setDialog] = useState('')
  const [platformDraft, setPlatformDraft] = useState(blankPlatform)
  const [holdingDraft, setHoldingDraft] = useState(blankHolding)
  const [tradeDraft, setTradeDraft] = useState(blankTrade)
  const [manualHoldingId, setManualHoldingId] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [closingRow, setClosingRow] = useState(null)
  const [historyPlatformId, setHistoryPlatformId] = useState('')
  const [editingTradeBaseline, setEditingTradeBaseline] = useState(null)
  const [tradeEditDraft, setTradeEditDraft] = useState(blankTradeEdit)
  const [tradeEditStage, setTradeEditStage] = useState('fields')
  const [query, setQuery] = useState('')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetResults, setAssetResults] = useState([])
  const [assetSearchStatus, setAssetSearchStatus] = useState('idle')
  const [assetSearchError, setAssetSearchError] = useState('')
  const [expandedSmallPlatforms, setExpandedSmallPlatforms] = useState({})
  const [expandedHoldingIds, setExpandedHoldingIds] = useState({})
  const prefersReducedMotion = useReducedMotion()
  const submissionRef = useRef(false)
  const assetSearchSequenceRef = useRef(0)
  const activePlatforms = useMemo(() => platforms.filter((platform) => platform.status !== 'inactive'), [platforms])
  const activeHoldings = useMemo(() => holdings.filter((holding) => holding.status !== 'inactive'), [holdings])
  const autoPricedHoldings = useMemo(() => activeHoldings.filter((holding) => isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true')), [activeHoldings])
  const holdingById = useMemo(() => new Map(activeHoldings.map((holding) => [holding.id, holding])), [activeHoldings])
  const platformById = useMemo(() => new Map(activePlatforms.map((platform) => [platform.id, platform])), [activePlatforms])
  const normalizedQuery = query.trim().toLocaleLowerCase('ar')
  const visiblePlatforms = useMemo(() => summary.platforms.map((platformRow) => ({
    ...platformRow,
    holdings: platformRow.holdings.filter((row) => !normalizedQuery || `${row.holding.name} ${row.holding.symbol} ${row.holding.exchange}`.toLocaleLowerCase('ar').includes(normalizedQuery)),
  })).filter((row) => !normalizedQuery || row.holdings.length || `${row.platform.name} ${row.platform.location}`.toLocaleLowerCase('ar').includes(normalizedQuery)), [normalizedQuery, summary.platforms])
  const latestPriceAt = useMemo(() => autoPricedHoldings.reduce((latest, holding) => {
    const timestamp = new Date(holding.lastPriceAt || 0).getTime()
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest
  }, 0), [autoPricedHoldings])
  const historyPlatform = activePlatforms.find((platform) => platform.id === historyPlatformId) || null
  const historyPlatformSummary = summary.platforms.find((row) => row.platform.id === historyPlatformId) || null
  const historyRows = useMemo(() => buildInvestmentPlatformActivity({
    platformId: historyPlatformId,
    trades,
    movements,
    holdings,
    accounts,
  }), [accounts, historyPlatformId, holdings, movements, trades])
  const assetSearchPlaceholder = holdingDraft.assetType === INVESTMENT_ASSET_TYPES.CRYPTO
    ? 'BTC أو اسم العملة'
    : holdingDraft.assetType === INVESTMENT_ASSET_TYPES.METAL
      ? 'XAU أو اسم المعدن'
      : holdingDraft.quoteCurrency === 'TRY'
        ? holdingDraft.assetType === INVESTMENT_ASSET_TYPES.FUND ? 'ISMDL أو اسم الصندوق' : 'THYAO أو اسم الشركة'
        : holdingDraft.quoteCurrency === 'USD' && import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED !== 'true' && ['stock', 'fund'].includes(holdingDraft.assetType)
          ? 'رمز السهم مثل AAPL'
        : 'الاسم أو الرمز'
  const emptyMarketSearchMessage = 'لا توجد نتيجة. اكتب الاسم والرمز يدويًا.'

  useEffect(() => {
    const sequence = ++assetSearchSequenceRef.current
    if (dialog !== 'holding' || holdingDraft.providerSymbol || assetQuery.trim().length < 2 || typeof onSearchAssets !== 'function') {
      return undefined
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await onSearchAssets(assetQuery.trim(), holdingDraft.quoteCurrency, holdingDraft.assetType)
        if (assetSearchSequenceRef.current !== sequence) return
        setAssetResults(Array.isArray(result?.results) ? result.results : [])
        setAssetSearchStatus('ready')
      } catch (error) {
        if (assetSearchSequenceRef.current !== sequence) return
        setAssetResults([])
        setAssetSearchError(error?.message || 'تعذر البحث في السوق الآن.')
        setAssetSearchStatus('error')
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [assetQuery, dialog, holdingDraft.assetType, holdingDraft.providerSymbol, holdingDraft.quoteCurrency, onSearchAssets])

  function openPlatform() {
    submissionRef.current = false
    setPlatformDraft(blankPlatform)
    setDialog('platform')
  }

  function openHolding() {
    submissionRef.current = false
    setHoldingDraft({ ...blankHolding, platformId: activePlatforms[0]?.id || '' })
    setAssetQuery('')
    setAssetResults([])
    setAssetSearchStatus('idle')
    setAssetSearchError('')
    setDialog('holding')
  }

  function resetAssetDiscovery() {
    setAssetQuery('')
    setAssetResults([])
    setAssetSearchStatus('idle')
    setAssetSearchError('')
  }

  function changeHoldingAssetType(assetType) {
    setHoldingDraft((current) => ({
      ...blankHolding,
      platformId: current.platformId,
      quoteCurrency: current.quoteCurrency,
      assetType,
    }))
    resetAssetDiscovery()
  }

  function changeHoldingMarket(quoteCurrency) {
    setHoldingDraft((current) => ({
      ...blankHolding,
      platformId: current.platformId,
      assetType: current.assetType,
      quoteCurrency,
    }))
    resetAssetDiscovery()
  }

  function toggleSmallPlatform(platformId) {
    setExpandedSmallPlatforms((current) => ({
      ...current,
      [platformId]: !current[platformId],
    }))
  }

  function selectMarketAsset(result) {
    setHoldingDraft((current) => ({
      ...current,
      name: result.name,
      symbol: result.symbol,
      providerSymbol: result.providerSymbol,
      marketDataMode: 'provider',
      exchange: result.exchange || result.micCode || '',
      quoteCurrency: result.quoteCurrency,
      assetType: result.assetType || assetTypeForMarketResult(result) || current.assetType,
    }))
    setAssetQuery(`${result.name} · ${result.symbol}`)
    setAssetResults([])
    setAssetSearchStatus('selected')
  }

  function clearSelectedMarketAsset() {
    setHoldingDraft((current) => ({ ...current, name: '', symbol: '', providerSymbol: '', marketDataMode: 'manual', exchange: '' }))
    resetAssetDiscovery()
  }

  function openTrade(type, holdingId = '') {
    submissionRef.current = false
    setTradeDraft({ ...blankTrade, type, holdingId: holdingId || activeHoldings[0]?.id || '' })
    setDialog('trade')
  }

  function openSmallClosure(row) {
    submissionRef.current = false
    setClosingRow(row)
    setDialog('close')
  }

  function openPlatformHistory(platformId) {
    submissionRef.current = false
    setHistoryPlatformId(platformId)
    setEditingTradeBaseline(null)
    setTradeEditStage('fields')
    setDialog('history')
  }

  function openTradeEdit(trade) {
    setEditingTradeBaseline({ ...trade })
    setTradeEditDraft({
      quantity: String(unitsToQuantity(trade.quantityUnits)),
      priceUsd: String(microsToUsd(trade.priceUsdMicros)),
      feeUsd: String(microsToUsd(trade.feeUsdMicros || 0)),
      note: trade.note || '',
    })
    setTradeEditStage('fields')
    setDialog('trade-edit')
  }

  function returnToHistory() {
    setEditingTradeBaseline(null)
    setTradeEditDraft(blankTradeEdit)
    setTradeEditStage('fields')
    setDialog('history')
  }

  function submitPlatform(event) {
    event.preventDefault()
    if (!platformDraft.name.trim() || submissionRef.current) return
    submissionRef.current = true
    if (onAddPlatform(platformDraft) === false) {
      submissionRef.current = false
      return
    }
    setPlatformDraft(blankPlatform)
    setDialog('')
  }

  function submitHolding(event) {
    event.preventDefault()
    if (!holdingDraft.platformId || !holdingDraft.name.trim() || !/^[A-Z0-9./_-]{1,32}$/.test(holdingDraft.symbol.trim().toUpperCase()) || submissionRef.current) return
    const draft = holdingDraft.marketDataMode === 'manual'
      ? { ...holdingDraft, providerSymbol: holdingDraft.symbol.trim().toUpperCase() }
      : holdingDraft
    submissionRef.current = true
    if (onAddHolding(draft) === false) {
      submissionRef.current = false
      return
    }
    setHoldingDraft(blankHolding)
    setDialog('')
  }

  function submitTrade(event) {
    event.preventDefault()
    if (!canSubmitTrade || submissionRef.current) return
    submissionRef.current = true
    if (onAddTrade(tradeDraft) === false) {
      submissionRef.current = false
      return
    }
    setTradeDraft(blankTrade)
    setDialog('')
  }

  function openManualPrice(holding) {
    submissionRef.current = false
    setManualHoldingId(holding.id)
    setManualPrice(holding.lastPriceUsdMicros ? String(microsToUsd(holding.lastPriceUsdMicros)) : '')
    setDialog('price')
  }

  function submitManualPrice(event) {
    event.preventDefault()
    if (!manualHoldingId || parseInvestmentDecimal(manualPrice) <= 0 || submissionRef.current) return
    submissionRef.current = true
    if (onManualPrice(manualHoldingId, manualPrice) === false) {
      submissionRef.current = false
      return
    }
    setDialog('')
  }

  function submitSmallClosure(event) {
    event.preventDefault()
    if (!closingRow?.holding?.id || submissionRef.current) return
    submissionRef.current = true
    if (onCloseSmallHolding(closingRow.holding.id) === false) {
      submissionRef.current = false
      return
    }
    setClosingRow(null)
    setDialog('')
  }

  function submitTradeEdit(event) {
    event.preventDefault()
    if (!editingTradeBaseline || !tradeEditHasChanges || !tradeEditHasValidInput || submissionRef.current) return
    if (tradeEditStage === 'fields') {
      setTradeEditStage('review')
      return
    }
    submissionRef.current = true
    if (onEditTrade?.(editingTradeBaseline, tradeEditDraft) === false) {
      submissionRef.current = false
      return
    }
    submissionRef.current = false
    returnToHistory()
  }

  function editFundingMovement(movement) {
    setDialog('')
    onEditMovement?.(movement)
  }

  const selectedTradeHolding = holdingById.get(tradeDraft.holdingId)
  const selectedTradePlatform = summary.platforms.find((row) => row.platform.id === selectedTradeHolding?.platformId)
  const selectedTradeRow = selectedTradePlatform?.holdings.find((row) => row.holding.id === selectedTradeHolding?.id)
  const manualHolding = holdingById.get(manualHoldingId)
  const manualPlatform = platformById.get(manualHolding?.platformId)
  const tradeValueUsdMicros = investmentTradeValueMicros({
    quantityUnits: quantityToUnits(tradeDraft.quantity),
    priceUsdMicros: usdToMicros(tradeDraft.priceUsd),
  })
  const tradeFeeUsdMicros = usdToMicros(tradeDraft.feeUsd || 0)
  const tradeDebitUsdMicros = tradeValueUsdMicros + tradeFeeUsdMicros
  const tradeFeeInputValid = investmentDecimalInputIsValid(tradeDraft.feeUsd || 0)
  const tradeHasValidInput = Boolean(
    tradeDraft.holdingId
    && investmentDecimalInputIsValid(tradeDraft.quantity, { allowZero: false })
    && investmentDecimalInputIsValid(tradeDraft.priceUsd, { allowZero: false })
    && tradeFeeInputValid
    && tradeValueUsdMicros > 0
  )
  const tradeHasEnoughCash = tradeDraft.type !== INVESTMENT_TRADE_TYPES.BUY || tradeDebitUsdMicros <= Number(selectedTradePlatform?.freeCashUsdMicros || 0)
  const tradeHasEnoughUnits = tradeDraft.type !== INVESTMENT_TRADE_TYPES.SELL || quantityToUnits(tradeDraft.quantity) <= Number(selectedTradeRow?.quantityUnits || 0)
  const canSubmitTrade = tradeHasValidInput && tradeHasEnoughCash && tradeHasEnoughUnits
  const openingTradeLocked = investmentOpeningTradeIsLocked(editingTradeBaseline, trades)
  const editedQuantityUnits = quantityToUnits(tradeEditDraft.quantity)
  const editedPriceUsdMicros = usdToMicros(tradeEditDraft.priceUsd)
  const editedFeeUsdMicros = usdToMicros(tradeEditDraft.feeUsd || 0)
  const tradeEditFeeInputValid = investmentDecimalInputIsValid(tradeEditDraft.feeUsd || 0)
  const tradeEditHasValidInput = Boolean(
    editingTradeBaseline
    && investmentDecimalInputIsValid(tradeEditDraft.quantity, { allowZero: false })
    && investmentDecimalInputIsValid(tradeEditDraft.priceUsd, { allowZero: false })
    && tradeEditFeeInputValid
    && editedQuantityUnits > 0
    && editedPriceUsdMicros > 0
  )
  const tradeEditHasFinancialChanges = Boolean(editingTradeBaseline && (
    editedQuantityUnits !== editingTradeBaseline.quantityUnits
    || editedPriceUsdMicros !== editingTradeBaseline.priceUsdMicros
    || editedFeeUsdMicros !== Number(editingTradeBaseline.feeUsdMicros || 0)
  ))
  const tradeEditHasChanges = Boolean(editingTradeBaseline && (
    tradeEditHasFinancialChanges || tradeEditDraft.note.trim() !== String(editingTradeBaseline.note || '').trim()
  ))
  const tradeEditNoteChanged = Boolean(editingTradeBaseline && (
    tradeEditDraft.note.trim() !== String(editingTradeBaseline.note || '').trim()
  ))
  const editedTradePreview = editingTradeBaseline ? {
    ...editingTradeBaseline,
    quantityUnits: editedQuantityUnits,
    priceUsdMicros: editedPriceUsdMicros,
    feeUsdMicros: editedFeeUsdMicros,
  } : null
  const tradeEditBeforeImpact = tradeReviewImpact(editingTradeBaseline)
  const tradeEditAfterImpact = tradeReviewImpact(editedTradePreview)

  const portfolioLiquidityUsdMicros = Number.isSafeInteger(summary.liquidBalanceUsdMicros)
    ? summary.liquidBalanceUsdMicros
    : summary.freeCashUsdMicros || 0
  const portfolioInvestmentsUsdMicros = Number.isSafeInteger(summary.investedMarketValueUsdMicros)
    ? summary.investedMarketValueUsdMicros
    : summary.marketValueUsdMicros || 0
  const portfolioProfitUsdMicros = Number.isSafeInteger(summary.investmentProfitUsdMicros)
    ? summary.investmentProfitUsdMicros
    : Number.isSafeInteger(summary.totalProfitUsdMicros)
      ? summary.totalProfitUsdMicros
      : summary.unrealizedProfitUsdMicros || 0
  const profitTone = portfolioProfitUsdMicros > 0 ? 'is-positive' : portfolioProfitUsdMicros < 0 ? 'is-negative' : 'is-neutral'
  const firstPriceError = activeHoldings.map((holding) => priceErrors[holding.id]).find(Boolean)
  return (
    <section className="adreem-investments" aria-label="محفظتي">
      <div className="adreem-investment-hero">
        <div className="adreem-investment-title">
          <span><ChartCandlestick aria-hidden="true" size={22} /></span>
          <div><small>USD</small><h2>محفظتي</h2></div>
        </div>
        <div className="adreem-investment-actions">
          <button type="button" className="is-refresh" disabled={isRefreshing || !autoPricedHoldings.length} onClick={onRefreshPrices}>
            <RefreshCw aria-hidden="true" size={16} className={isRefreshing ? 'is-spinning' : ''} />
            {isRefreshing ? 'جاري تحديث الكل' : 'تحديث الكل'}
          </button>
          <button type="button" onClick={openPlatform}><Landmark aria-hidden="true" size={16} /> منصة</button>
          <button type="button" disabled={!activePlatforms.length} onClick={openHolding}><Plus aria-hidden="true" size={16} /> استثمار</button>
        </div>
      </div>

      <div className="adreem-investment-summary">
        <article className="is-total"><small>إجمالي المحفظة</small><strong>{usdMicros(summary.totalValueUsdMicros)}</strong></article>
        <article><small>الاستثمارات</small><strong>{usdMicros(portfolioInvestmentsUsdMicros)}</strong></article>
        <article><small>السيولة</small><strong>{usdMicros(portfolioLiquidityUsdMicros)}</strong></article>
        <article className={profitTone}><small>الربح والخسارة</small><strong>{usdMicros(portfolioProfitUsdMicros, true)}</strong></article>
      </div>

      <div className="adreem-investment-toolbar">
        <label><Search aria-hidden="true" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم أو رمز" /></label>
        <small className={firstPriceError ? 'is-price-error' : undefined} role={firstPriceError ? 'status' : undefined}>
          {firstPriceError ? <><AlertCircle aria-hidden="true" size={13} />{firstPriceError}</> : autoPricedHoldings.length ? latestPriceAt ? `فحص كل ساعتين أثناء الاستخدام · آخر تحقق ${new Date(latestPriceAt).toLocaleString(getActiveUiLanguage() === 'en' ? 'en-GB' : 'ar-LY', { dateStyle: 'short', timeStyle: 'short' })}` : 'فحص كل ساعتين أثناء الاستخدام · ويمكن إدخال السعر يدويًا' : 'الأسعار اليدوية محفوظة حتى تغييرها'}
        </small>
      </div>

      {!activePlatforms.length ? (
        <div className="adreem-investment-empty">
          <WalletCards aria-hidden="true" size={28} />
          <strong>ابدأ بمنصة واحدة</strong>
          <p>مصرف، محفظة، أو منصة تداول.</p>
          <button type="button" onClick={openPlatform}><Plus aria-hidden="true" size={16} /> إضافة منصة</button>
        </div>
      ) : (
        <div className="adreem-investment-platforms">
          {visiblePlatforms.map((platformRow, platformIndex) => {
            const brand = resolveInvestmentPlatformBrand(platformRow.platform.name)
            const logoUrl = platformLogoUrl(brand)
            const smallRows = platformRow.holdings.filter(holdingIsSmall)
            const regularRows = platformRow.holdings.filter((row) => !holdingIsSmall(row))
            const showSmallRows = Boolean(normalizedQuery || expandedSmallPlatforms[platformRow.platform.id])
            const displayedRows = showSmallRows ? [...regularRows, ...smallRows] : regularRows
            const platformTotalUsdMicros = Number.isSafeInteger(platformRow.totalValueUsdMicros)
              ? platformRow.totalValueUsdMicros
              : Number(platformRow.freeCashUsdMicros || 0) + Number(platformRow.marketValueUsdMicros || 0)
            const platformLiquidityUsdMicros = Number.isSafeInteger(platformRow.liquidBalanceUsdMicros)
              ? platformRow.liquidBalanceUsdMicros
              : platformRow.freeCashUsdMicros || 0
            return (
              <Motion.article
                className={`adreem-investment-platform is-brand-${brand.key}`}
                key={platformRow.platform.id}
                style={investmentPlatformBrandStyle(brand)}
                layout={prefersReducedMotion ? false : 'position'}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: Math.min(platformIndex * 0.035, 0.18), ease: [0.22, 1, 0.36, 1] }}
              >
                <header>
                  <div className="adreem-investment-platform-identity">
                    <i className="adreem-investment-platform-logo">
                      {logoUrl ? <img src={logoUrl} alt="" /> : <Landmark aria-hidden="true" size={18} />}
                    </i>
                    <span>
                      <strong>{preserveUiData(brand.displayName || platformRow.platform.name)}</strong>
                      <small>{platformRow.platform.location ? preserveUiData(platformRow.platform.location) : 'بدون موقع'}</small>
                    </span>
                  </div>
                  <div className="adreem-investment-platform-cash">
                    <div className="adreem-investment-platform-balances">
                      <b><small>رصيد المنصة</small><strong>{usdMicros(platformTotalUsdMicros)}</strong></b>
                      <b><small>السيولة</small><strong>{usdMicros(platformLiquidityUsdMicros)}</strong></b>
                    </div>
                    <div className="adreem-investment-platform-actions">
                      <button type="button" className="is-history" aria-label="السجل" title="السجل" onClick={() => openPlatformHistory(platformRow.platform.id)}><History aria-hidden="true" size={14} /><span>السجل</span></button>
                      <button type="button" aria-label="تمويل" title="تمويل" onClick={() => onOpenFunding?.(platformRow.platform.id)}><ArrowDownToLine aria-hidden="true" size={14} /><span>تمويل</span></button>
                    </div>
                  </div>
                </header>
                <div className="adreem-investment-holdings">
                  {displayedRows.length ? displayedRows.map((row) => {
                    const holdingProfitUsdMicros = row.unrealizedProfitUsdMicros || 0
                    const holdingProfitTone = holdingProfitUsdMicros > 0 ? 'positive' : holdingProfitUsdMicros < 0 ? 'negative' : 'neutral'
                    const priceIsStale = Boolean(priceErrors[row.holding.id] || holdingPriceIsStale(row.holding))
                    const detailsOpen = Boolean(expandedHoldingIds[row.holding.id])
                    const HoldingTrendIcon = holdingProfitUsdMicros > 0 ? TrendingUp : holdingProfitUsdMicros < 0 ? TrendingDown : Minus
                    return (
                      <Motion.section
                        className={`adreem-investment-holding is-profit-${holdingProfitTone} ${holdingIsSmall(row) ? 'is-small' : ''}`.trim()}
                        key={row.holding.id}
                        layout={prefersReducedMotion ? false : 'position'}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="adreem-investment-holding-identity">
                          <div className="adreem-investment-symbol"><b dir="ltr">{preserveUiData(row.holding.symbol)}</b><small>{holdingTypeLabel(row.holding.assetType)}</small></div>
                          <div className="adreem-investment-name"><strong dir="auto">{preserveUiData(row.holding.name)}</strong><small dir="auto">{preserveUiData(row.holding.exchange || brand.displayName || platformRow.platform.name)}{row.holding.lastPriceSource === 'tgmcharts-eod' ? <> · <a href="https://tgmcharts.com/" target="_blank" rel="noopener noreferrer">TGMCharts</a></> : null}</small></div>
                        </div>
                        <div className="adreem-investment-metrics-strip" aria-label="تفاصيل الاستثمار">
                          <div className="is-quantity"><small>الكمية</small><strong>{decimal(unitsToQuantity(row.quantityUnits), 8)} <em>وحدة</em></strong></div>
                          <InvestmentMarketPrice holding={row.holding} error={priceErrors[row.holding.id]} onOpen={openManualPrice} />
                          <div className="is-current-value"><small>{priceIsStale ? 'قيمة بسعر سابق' : 'القيمة الآن'}</small><strong>{usdMicros(row.marketValueUsdMicros)}</strong></div>
                          <div className={`adreem-investment-result is-${holdingProfitTone}`}>
                            <span><HoldingTrendIcon aria-hidden="true" size={14} /><small>{priceIsStale ? 'نتيجة تقديرية' : 'النتيجة'}</small></span>
                            <div className="adreem-investment-result-value">
                              <strong>{usdMicros(holdingProfitUsdMicros, true)}</strong>
                              {row.costBasisUsdMicros ? <em>{profitPercent(holdingProfitUsdMicros, row.costBasisUsdMicros)}</em> : null}
                            </div>
                          </div>
                        </div>
                        <div className="adreem-investment-row-actions">
                          <button type="button" className="is-record" title="تسجيل شراء أو بيع" onClick={() => openTrade(INVESTMENT_TRADE_TYPES.BUY, row.holding.id)}><ArrowLeftRight aria-hidden="true" size={14} /><span>تسجيل عملية</span></button>
                          <button type="button" className="is-details" aria-expanded={detailsOpen} title={detailsOpen ? 'إخفاء التفاصيل' : 'تفاصيل الشراء'} onClick={() => setExpandedHoldingIds((current) => ({ ...current, [row.holding.id]: !current[row.holding.id] }))}><ChevronDown aria-hidden="true" size={14} /><span>تفاصيل</span></button>
                        </div>
                        {detailsOpen ? <div className="adreem-investment-holding-details">
                          <span><small>متوسط الشراء</small><strong>{usdUnitMicros(row.averageCostUsdMicros)}</strong></span>
                          <span><small>تكلفة المتبقي</small><strong>{usdMicros(row.costBasisUsdMicros)}</strong></span>
                          {row.holding.quoteCurrency !== 'USD' && row.holding.lastPriceUsdMicros ? <span><small>السعر بالدولار</small><strong>{usdUnitMicros(row.holding.lastPriceUsdMicros)}</strong></span> : null}
                          <span><small>{['twelve-data-eod+ecb-fx', 'tgmcharts-eod'].includes(row.holding.lastPriceSource) ? 'تاريخ الإغلاق' : row.holding.lastPriceSource === 'dexscreener-reference' ? 'وقت التحقق' : row.holding.lastPriceQuotedAt ? 'وقت السعر' : ['manual', 'trade', 'opening'].includes(row.holding.lastPriceSource) ? 'وقت الإدخال' : 'آخر تحقق'}</small><strong>{row.holding.lastPriceQuotedAt || row.holding.lastPriceAt ? ['twelve-data-eod+ecb-fx', 'tgmcharts-eod'].includes(row.holding.lastPriceSource) ? activityDay(row.holding.lastPriceQuotedAt) : activityDate(row.holding.lastPriceQuotedAt || row.holding.lastPriceAt) : 'بدون سعر'}</strong></span>
                          {row.holding.lastPriceFxQuotedAt ? <span><small>{['twelve-data+ecb-fx', 'twelve-data-eod+ecb-fx'].includes(row.holding.lastPriceSource) ? 'تاريخ الصرف' : 'وقت الصرف'}</small><strong>{['twelve-data+ecb-fx', 'twelve-data-eod+ecb-fx'].includes(row.holding.lastPriceSource) ? activityDay(row.holding.lastPriceFxQuotedAt) : activityDate(row.holding.lastPriceFxQuotedAt)}</strong></span> : null}
                          {PRICE_SOURCE_LABELS[row.holding.lastPriceSource] ? <span><small>مصدر السعر</small><strong>{row.holding.lastPriceSource === 'tgmcharts-eod' ? <a href="https://tgmcharts.com/" target="_blank" rel="noopener noreferrer">{PRICE_SOURCE_LABELS[row.holding.lastPriceSource][getActiveUiLanguage() === 'en' ? 'en' : 'ar']}</a> : PRICE_SOURCE_LABELS[row.holding.lastPriceSource][getActiveUiLanguage() === 'en' ? 'en' : 'ar']}</strong></span> : null}
                          {priceErrors[row.holding.id] ? <p className="is-error"><AlertCircle aria-hidden="true" size={13} />{priceErrors[row.holding.id]}</p> : null}
                          {(row.quantityUnits === 0 || (row.holding.lastPriceUsdMicros > 0 && row.marketValueUsdMicros < SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS)) ? <button type="button" className="is-remove" onClick={() => openSmallClosure(row)}><Trash2 aria-hidden="true" size={14} /> إزالة</button> : null}
                        </div> : null}
                      </Motion.section>
                    )
                  }) : !smallRows.length ? <p className="adreem-investment-platform-empty">لا توجد استثمارات هنا.</p> : null}
                  {smallRows.length && !normalizedQuery ? (
                    <button type="button" className="adreem-investment-small-toggle" aria-expanded={showSmallRows} onClick={() => toggleSmallPlatform(platformRow.platform.id)}>
                      {showSmallRows ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
                      <span>{showSmallRows ? 'إخفاء الأرصدة الصغيرة' : 'أرصدة صغيرة'}</span>
                      <b>{smallRows.length}</b>
                      <small>أقل من 1 USD</small>
                    </button>
                  ) : null}
                </div>
              </Motion.article>
            )
          })}
        </div>
      )}

      <AnimatePresence mode="wait">
        {dialog === 'platform' ? (
          <InvestmentDialog title="منصة جديدة" subtitle="مكان وجود الاستثمار" icon={Landmark} tone="platform" onClose={() => setDialog('')} onSubmit={submitPlatform} canSubmit={Boolean(platformDraft.name.trim())}>
            <label><span>الاسم</span><input autoFocus value={platformDraft.name} onChange={(event) => setPlatformDraft((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: IBKR أو Binance" /></label>
            <label><span>النوع</span><select value={platformDraft.kind} onChange={(event) => setPlatformDraft((current) => ({ ...current, kind: event.target.value }))}><option value="platform">منصة تداول</option><option value="bank">مصرف</option><option value="wallet">محفظة</option><option value="broker">وسيط</option></select></label>
            <label><span>الموقع</span><input value={platformDraft.location} onChange={(event) => setPlatformDraft((current) => ({ ...current, location: event.target.value }))} placeholder="تركيا، ليبيا، أو أونلاين" /></label>
          </InvestmentDialog>
        ) : null}
        {dialog === 'holding' ? (
          <InvestmentDialog title="استثمار جديد" subtitle="ابحث أو اكتب الأصل يدويًا" icon={ChartCandlestick} tone="market" className="is-holding" onClose={() => setDialog('')} onSubmit={submitHolding} canSubmit={Boolean(holdingDraft.platformId && holdingDraft.name.trim() && /^[A-Z0-9./_-]{1,32}$/.test(holdingDraft.symbol.trim().toUpperCase()) && (holdingDraft.marketDataMode === 'manual' || holdingDraft.providerSymbol.trim()))}>
            <label><span>المنصة</span><select value={holdingDraft.platformId} onChange={(event) => setHoldingDraft((current) => ({ ...current, platformId: event.target.value }))}>{activePlatforms.map((platform) => <option key={platform.id} value={platform.id}>{preserveUiData(platform.name)}</option>)}</select></label>
            <div className="is-paired">
              <label><span>النوع</span><select value={holdingDraft.assetType} onChange={(event) => changeHoldingAssetType(event.target.value)}>{ASSET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div className="adreem-investment-market-choice">
                <span>سوق التداول</span>
                <div role="radiogroup" aria-label="سوق التداول">
                  {MARKET_OPTIONS.map((market) => <button type="button" role="radio" aria-checked={holdingDraft.quoteCurrency === market.value} className={holdingDraft.quoteCurrency === market.value ? 'is-active' : ''} key={market.value} onClick={() => changeHoldingMarket(market.value)}><strong>{market.label}</strong><small>{market.value}</small></button>)}
                </div>
              </div>
            </div>
            <label className="adreem-investment-market-search"><span>بحث اختياري</span><div><Search aria-hidden="true" size={16} /><input autoFocus value={assetQuery} onChange={(event) => { const value = event.target.value; setAssetQuery(value); setAssetResults([]); setAssetSearchStatus(value.trim().length >= 2 ? 'loading' : 'idle'); setAssetSearchError(''); if (holdingDraft.marketDataMode === 'provider') setHoldingDraft((current) => ({ ...current, name: '', symbol: '', providerSymbol: '', marketDataMode: 'manual', exchange: '' })) }} placeholder={assetSearchPlaceholder} /></div></label>
            {assetSearchStatus === 'loading' ? <p className="adreem-investment-search-note">جاري البحث...</p> : null}
            {assetSearchError ? <p className="adreem-investment-search-note is-error">{assetSearchError}</p> : null}
            {assetSearchStatus === 'ready' && !assetResults.length ? <p className="adreem-investment-search-note">{emptyMarketSearchMessage}</p> : null}
            {assetResults.length ? <div className="adreem-investment-search-results" role="listbox" aria-label="نتائج السوق">{assetResults.map((result) => <button type="button" role="option" aria-selected="false" key={result.id} onClick={() => selectMarketAsset(result)}><span><strong>{preserveUiData(result.name)}</strong><small>{preserveUiData([holdingTypeLabel(result.assetType), result.exchange].filter(Boolean).join(' · '))}</small></span><b>{preserveUiData(result.symbol)}<small>{result.quoteCurrency}</small></b></button>)}</div> : null}
            {assetResults.some((result) => result.providerSymbol?.endsWith(':TGM')) ? <p className="adreem-investment-search-note">إغلاق يومي من <a href="https://tgmcharts.com/" target="_blank" rel="noopener noreferrer">TGMCharts</a>.</p> : null}
            {holdingDraft.marketDataMode === 'provider' && holdingDraft.providerSymbol ? <div className="adreem-investment-selected-asset"><Check aria-hidden="true" size={16} /><span><strong>{preserveUiData(holdingDraft.name)}</strong><small>{preserveUiData(`${holdingDraft.symbol} · ${holdingDraft.exchange || holdingDraft.quoteCurrency}`)}</small></span><div><b>{holdingTypeLabel(holdingDraft.assetType)}</b><button type="button" onClick={clearSelectedMarketAsset}><PencilLine aria-hidden="true" size={12} /> تغيير</button></div></div> : <div className="is-paired"><label><span>الاسم</span><input value={holdingDraft.name} maxLength={80} onChange={(event) => setHoldingDraft((current) => ({ ...current, name: event.target.value, marketDataMode: 'manual' }))} placeholder="اسم الاستثمار" /></label><label><span>الرمز</span><input dir="ltr" value={holdingDraft.symbol} maxLength={32} onChange={(event) => setHoldingDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase(), marketDataMode: 'manual' }))} placeholder="THYAO" /></label></div>}
            {holdingDraft.marketDataMode === 'manual' ? <p className="adreem-investment-search-note">{holdingDraft.quoteCurrency === 'USD' && import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED !== 'true' && ['stock', 'fund'].includes(holdingDraft.assetType) ? 'ابحث برمز السهم لسعر إغلاق يومي، أو أدخل السعر يدويًا.' : 'السعر يدوي حتى يتوفر مصدر معتمد.'}</p> : null}
            <div className="is-paired is-investment-numbers"><label><span>كمية سابقة</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialQuantity} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialQuantity: event.target.value }))} placeholder="0" /></label><label><span>متوسطها USD</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialPriceUsd} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialPriceUsd: event.target.value }))} placeholder="0" /></label></div>
          </InvestmentDialog>
        ) : null}
        {dialog === 'trade' ? (
          <InvestmentDialog title="تسجيل عملية" subtitle={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'الشراء يخصم من نقد المنصة' : 'البيع يضيف إلى نقد المنصة'} icon={ArrowLeftRight} tone={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'buy' : 'sell'} onClose={() => setDialog('')} onSubmit={submitTrade} canSubmit={canSubmitTrade} submitLabel={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'حفظ الشراء' : 'حفظ البيع'}>
            <div className="adreem-investment-trade-toggle"><button type="button" aria-pressed={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY} className={`is-buy ${tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'is-active' : ''}`.trim()} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.BUY }))}><ArrowDownToLine aria-hidden="true" size={15} />شراء</button><button type="button" aria-pressed={tradeDraft.type === INVESTMENT_TRADE_TYPES.SELL} className={`is-sell ${tradeDraft.type === INVESTMENT_TRADE_TYPES.SELL ? 'is-active' : ''}`.trim()} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.SELL }))}><ArrowUpFromLine aria-hidden="true" size={15} />بيع</button></div>
            <label><span>الاستثمار</span><select value={tradeDraft.holdingId} onChange={(event) => setTradeDraft((current) => ({ ...current, holdingId: event.target.value }))}>{activeHoldings.map((holding) => <option key={holding.id} value={holding.id}>{preserveUiData(`${holding.symbol} · ${holding.name} · ${platformById.get(holding.platformId)?.name || ''}`)}</option>)}</select></label>
            <div className="is-paired is-investment-numbers"><label><span>الكمية</span><input dir="ltr" inputMode="decimal" value={tradeDraft.quantity} onChange={(event) => setTradeDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" /></label><label><span>سعر الوحدة USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.priceUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, priceUsd: event.target.value }))} placeholder="0" /></label></div>
            <label><span>الرسوم USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.feeUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, feeUsd: event.target.value }))} placeholder="0" /></label>
            {!tradeFeeInputValid ? <p className="adreem-investment-edit-warning">الرسوم يجب أن تكون رقمًا صحيحًا أو صفرًا.</p> : null}
            <label><span>ملاحظة</span><input value={tradeDraft.note} onChange={(event) => setTradeDraft((current) => ({ ...current, note: event.target.value }))} placeholder="اختياري" /></label>
            {selectedTradeHolding ? <div className={`adreem-investment-trade-context ${!tradeHasEnoughCash || !tradeHasEnoughUnits ? 'is-error' : ''}`}><CircleDollarSign aria-hidden="true" size={15} /><span><strong>{preserveUiData(selectedTradePlatform?.platform.name || selectedTradeHolding.symbol)}</strong><small>{tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? `المتاح ${usdMicros(selectedTradePlatform?.freeCashUsdMicros || 0)} · المطلوب ${usdMicros(tradeDebitUsdMicros)}` : `الموجود ${decimal(unitsToQuantity(selectedTradeRow?.quantityUnits || 0), 8)} وحدة`}</small></span>{!tradeHasEnoughCash && typeof onOpenFunding === 'function' ? <button type="button" onClick={() => { setDialog(''); onOpenFunding(selectedTradeHolding.platformId) }}>حوّل USD أولًا</button> : null}</div> : null}
          </InvestmentDialog>
        ) : null}
        {dialog === 'price' ? (
          <InvestmentDialog title="سعر يدوي" subtitle={isAutoPricedHolding(manualHolding || {}, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true') ? 'يبقى حتى التحديث القادم' : 'يبقى حتى تغييره'} icon={PencilLine} tone="market" onClose={() => setDialog('')} onSubmit={submitManualPrice} canSubmit={parseInvestmentDecimal(manualPrice) > 0} submitLabel="حفظ السعر">
            {manualHolding ? <div className="adreem-investment-dialog-context"><span><strong>{preserveUiData(`${manualHolding.symbol} · ${manualHolding.name}`)}</strong><small>{preserveUiData(manualPlatform?.name || '')}</small></span><b>{manualHolding.lastPriceUsdMicros ? usdUnitMicros(manualHolding.lastPriceUsdMicros) : 'بدون سعر'}</b></div> : null}
            <label><span>السعر الحالي USD</span><input autoFocus dir="ltr" inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="0" /></label>
          </InvestmentDialog>
        ) : null}
        {dialog === 'close' && closingRow ? (
          <InvestmentDialog title="إزالة استثمار صغير" subtitle="يحفظ السجل ولا يمحو المال" icon={Trash2} tone="danger" onClose={() => { setClosingRow(null); setDialog('') }} onSubmit={submitSmallClosure} submitLabel="تأكيد الإزالة">
            <div className="adreem-investment-close-summary">
              <strong>{preserveUiData(`${closingRow.holding.symbol} · ${closingRow.holding.name}`)}</strong>
              <b>{usdMicros(closingRow.marketValueUsdMicros)}</b>
              <p>{closingRow.quantityUnits > 0 ? 'ستباع الكمية كاملة بالسعر الحالي، وتنتقل قيمتها إلى نقد المنصة.' : 'الاستثمار فارغ وسيختفي من القائمة.'}</p>
            </div>
          </InvestmentDialog>
        ) : null}
        {dialog === 'history' && historyPlatform ? (() => {
          const brand = resolveInvestmentPlatformBrand(historyPlatform.name)
          const logoUrl = platformLogoUrl(brand)
          return (
            <InvestmentDialog title="سجل المحفظة" subtitle={brand.displayName || historyPlatform.name} icon={History} tone="history" onClose={() => setDialog('')} hideSubmit className="is-history">
              <div className={`adreem-investment-history-head is-brand-${brand.key}`} style={investmentPlatformBrandStyle(brand)}>
                <i className="adreem-investment-history-logo">{logoUrl ? <img src={logoUrl} alt="" /> : <Landmark aria-hidden="true" size={20} />}</i>
                <span><strong>{preserveUiData(brand.displayName || historyPlatform.name)}</strong><small>{decimal(historyRows.length, 0)} {historyRows.length === 1 ? 'عملية محفوظة' : 'عمليات محفوظة'}</small></span>
                <b>{usdMicros(historyPlatformSummary?.totalValueUsdMicros ?? ((historyPlatformSummary?.freeCashUsdMicros || 0) + (historyPlatformSummary?.marketValueUsdMicros || 0)))}<small>رصيد المنصة</small></b>
              </div>
              {historyRows.length ? (
                <div className="adreem-investment-history-list">
                  {historyRows.map((row) => {
                    const isTrade = row.kind === 'trade'
                    const isVoided = row.status === MOVEMENT_STATUSES.VOIDED || row.status === 'voided'
                    const routeLabel = row.action === MOVEMENT_TYPES.INVESTMENT_DEPOSIT
                      ? accountLabel(row.sourceAccount)
                      : row.action === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL
                        ? accountLabel(row.destinationAccount)
                        : ''
                    return (
                      <article className={`adreem-investment-history-row is-${row.action} ${isVoided ? 'is-voided' : ''}`} key={`${row.kind}-${row.id}`}>
                        <i>{row.action === INVESTMENT_TRADE_TYPES.BUY || row.action === MOVEMENT_TYPES.INVESTMENT_DEPOSIT ? <ArrowDownToLine aria-hidden="true" size={17} /> : row.action === INVESTMENT_TRADE_TYPES.SELL || row.action === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL ? <ArrowUpFromLine aria-hidden="true" size={17} /> : <PackageCheck aria-hidden="true" size={17} />}</i>
                        <div className="adreem-investment-history-main">
                          <header><strong>{activityActionLabel(row)}</strong>{isVoided ? <em>ملغاة</em> : null}<time><Clock3 aria-hidden="true" size={12} />{activityDate(row.occurredAt)}</time></header>
                          <span>{isTrade ? preserveUiData(`${row.holding?.symbol || ''} · ${row.holding?.name || ''}`) : routeLabel ? preserveUiData(routeLabel) : 'تمويل المحفظة'}</span>
                          {row.note ? <small>{preserveUiData(row.note)}</small> : null}
                        </div>
                        <div className="adreem-investment-history-values">
                          {isTrade ? <small>{decimal(unitsToQuantity(row.trade.quantityUnits), 8)} × {usdUnitMicros(row.trade.priceUsdMicros)}</small> : null}
                          <strong>{usdMicros(row.amountUsdMicros)}</strong>
                          {isTrade && row.trade.feeUsdMicros > 0 ? <em><span>رسوم</span> {usdMicros(row.trade.feeUsdMicros)}</em> : null}
                        </div>
                        {!isVoided ? <button type="button" className="adreem-investment-history-edit" aria-label="تعديل العملية" title="تعديل العملية" onClick={() => isTrade ? openTradeEdit(row.trade) : editFundingMovement(row.movement)}><PencilLine aria-hidden="true" size={14} /><span>تعديل</span></button> : null}
                      </article>
                    )
                  })}
                </div>
              ) : <div className="adreem-investment-history-empty"><History aria-hidden="true" size={24} /><strong>لا توجد عمليات بعد</strong></div>}
            </InvestmentDialog>
          )
        })() : null}
        {dialog === 'trade-edit' && editingTradeBaseline ? (
          <InvestmentDialog
            title={tradeEditStage === 'review' ? 'راجع التعديل' : 'تعديل عملية استثمار'}
            subtitle="النوع والتاريخ والمنصة ثابتة"
            onClose={returnToHistory}
            onSecondary={tradeEditStage === 'review' ? () => setTradeEditStage('fields') : returnToHistory}
            secondaryLabel={tradeEditStage === 'review' ? 'تعديل البيانات' : 'رجوع للسجل'}
            onSubmit={submitTradeEdit}
            canSubmit={tradeEditHasValidInput && tradeEditHasChanges && (!openingTradeLocked || !tradeEditHasFinancialChanges)}
            submitLabel={tradeEditStage === 'review' ? 'تأكيد وحفظ' : 'مراجعة التغيير'}
            icon={PencilLine}
            tone="edit"
            className="is-trade-edit"
          >
            <div className="adreem-investment-edit-locks"><LockKeyhole aria-hidden="true" size={16} /><span><strong>{activityActionLabel({ action: editingTradeBaseline.type })}</strong><small>{activityDate(editingTradeBaseline.occurredAt || editingTradeBaseline.createdAt)}</small></span></div>
            {tradeEditStage === 'fields' ? (
              <>
                <div className="is-paired is-investment-numbers"><label><span>الكمية</span><input dir="ltr" inputMode="decimal" disabled={openingTradeLocked} value={tradeEditDraft.quantity} onChange={(event) => setTradeEditDraft((current) => ({ ...current, quantity: event.target.value }))} /></label><label><span>سعر الوحدة USD</span><input dir="ltr" inputMode="decimal" disabled={openingTradeLocked} value={tradeEditDraft.priceUsd} onChange={(event) => setTradeEditDraft((current) => ({ ...current, priceUsd: event.target.value }))} /></label></div>
                <label><span>الرسوم USD</span><input dir="ltr" inputMode="decimal" disabled={openingTradeLocked || editingTradeBaseline.type === INVESTMENT_TRADE_TYPES.OPENING} value={tradeEditDraft.feeUsd} onChange={(event) => setTradeEditDraft((current) => ({ ...current, feeUsd: event.target.value }))} /></label>
                {!tradeEditFeeInputValid ? <p className="adreem-investment-edit-warning">الرسوم يجب أن تكون رقمًا صحيحًا أو صفرًا.</p> : null}
                <label><span>ملاحظة</span><input value={tradeEditDraft.note} onChange={(event) => setTradeEditDraft((current) => ({ ...current, note: event.target.value }))} placeholder="اختياري" /></label>
                {openingTradeLocked ? <p className="adreem-investment-edit-warning"><ShieldCheck aria-hidden="true" size={16} />القيم الافتتاحية ثابتة بعد وجود عمليات لاحقة. يمكنك تعديل الملاحظة فقط.</p> : null}
              </>
            ) : (
              <div className="adreem-investment-edit-review">
                <div><small>قبل</small><strong>{decimal(unitsToQuantity(editingTradeBaseline.quantityUnits), 8)} وحدة</strong><b>{usdUnitMicros(editingTradeBaseline.priceUsdMicros)}</b><em>{usdMicros(investmentTradeValueMicros(editingTradeBaseline))}</em><span className="is-review-detail"><small>الرسوم</small><b>{usdMicros(editingTradeBaseline.feeUsdMicros || 0)}</b></span><span className="is-review-detail"><small>{tradeEditBeforeImpact.label}</small><b>{usdMicros(tradeEditBeforeImpact.valueUsdMicros, true)}</b></span></div>
                <ArrowLeft aria-hidden="true" size={18} />
                <div><small>بعد</small><strong>{decimal(unitsToQuantity(editedQuantityUnits), 8)} وحدة</strong><b>{usdUnitMicros(editedPriceUsdMicros)}</b><em>{usdMicros(investmentTradeValueMicros(editedTradePreview))}</em><span className="is-review-detail"><small>الرسوم</small><b>{usdMicros(editedFeeUsdMicros)}</b></span><span className="is-review-detail"><small>{tradeEditAfterImpact.label}</small><b>{usdMicros(tradeEditAfterImpact.valueUsdMicros, true)}</b></span></div>
                {tradeEditNoteChanged ? (
                  <section className="adreem-investment-edit-note-review">
                    <small>الملاحظة</small>
                    <span>{editingTradeBaseline.note ? preserveUiData(editingTradeBaseline.note) : 'بدون ملاحظة'}</span>
                    <ArrowLeft aria-hidden="true" size={15} />
                    <strong>{tradeEditDraft.note.trim() ? preserveUiData(tradeEditDraft.note.trim()) : 'بدون ملاحظة'}</strong>
                  </section>
                ) : null}
                <p><ShieldCheck aria-hidden="true" size={16} />لن يُحفظ التعديل إذا كسر الكمية أو جعل نقد المنصة سالبًا.</p>
              </div>
            )}
          </InvestmentDialog>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
