/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, ChartCandlestick, Check, CircleDollarSign, Landmark, Minus, PackageCheck, PencilLine, Plus, RefreshCw, Search, TrendingDown, TrendingUp, Trash2, WalletCards, X } from 'lucide-react'
import { AnimatePresence, motion as Motion, useReducedMotion } from 'motion/react'
import {
  INVESTMENT_ASSET_TYPES,
  SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS,
  INVESTMENT_TRADE_TYPES,
  investmentTradeValueMicros,
  microsToUsd,
  parseInvestmentDecimal,
  quantityToUnits,
  unitsToQuantity,
  usdToMicros,
} from './investmentCore.js'
import { investmentPlatformBrandStyle, resolveInvestmentPlatformBrand } from './investmentPlatformBrands.js'
import { preserveUiData } from './uiTranslation.js'

const ASSET_OPTIONS = [
  { value: INVESTMENT_ASSET_TYPES.STOCK, label: 'سهم مباشر' },
  { value: INVESTMENT_ASSET_TYPES.CRYPTO, label: 'عملة رقمية' },
  { value: INVESTMENT_ASSET_TYPES.METAL, label: 'معدن' },
  { value: INVESTMENT_ASSET_TYPES.FUND, label: 'صندوق' },
  { value: INVESTMENT_ASSET_TYPES.OTHER, label: 'أخرى' },
]

const blankPlatform = { name: '', kind: 'platform', location: '' }
const blankHolding = { platformId: '', name: '', symbol: '', providerSymbol: '', assetType: INVESTMENT_ASSET_TYPES.STOCK, exchange: '', quoteCurrency: 'USD', initialQuantity: '', initialPriceUsd: '' }
const blankTrade = { holdingId: '', type: INVESTMENT_TRADE_TYPES.BUY, quantity: '', priceUsd: '', feeUsd: '', note: '' }

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

function platformLogoUrl(brand) {
  return brand.logo ? `${import.meta.env.BASE_URL}${brand.logo}` : ''
}

function InvestmentDialog({ title, subtitle, onClose, children, onSubmit, canSubmit = true, submitLabel = 'حفظ' }) {
  useEffect(() => {
    const root = document.documentElement
    const close = (event) => event.key === 'Escape' && onClose()
    root.classList.add('adreem-overlay-open')
    document.addEventListener('keydown', close)
    return () => {
      root.classList.remove('adreem-overlay-open')
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  return (
    <Motion.div className="adreem-investment-dialog-layer" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Motion.form className="adreem-investment-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit} initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }}>
        <header>
          <span><ChartCandlestick aria-hidden="true" size={19} /></span>
          <div><h2>{title}</h2>{subtitle ? <small>{subtitle}</small> : null}</div>
          <button type="button" onClick={onClose} aria-label="إغلاق" title="إغلاق"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="adreem-investment-dialog-body">{children}</div>
        <footer>
          <button type="button" className="is-secondary" onClick={onClose}>رجوع</button>
          <button type="submit" className="is-primary" disabled={!canSubmit}><Check aria-hidden="true" size={16} />{submitLabel}</button>
        </footer>
      </Motion.form>
    </Motion.div>
  )
}

export default function InvestmentsPanel({
  summary,
  platforms = [],
  holdings = [],
  isRefreshing = false,
  onAddPlatform,
  onAddHolding,
  onAddTrade,
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
  const [query, setQuery] = useState('')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetResults, setAssetResults] = useState([])
  const [assetSearchStatus, setAssetSearchStatus] = useState('idle')
  const [assetSearchError, setAssetSearchError] = useState('')
  const prefersReducedMotion = useReducedMotion()
  const submissionRef = useRef(false)
  const assetSearchSequenceRef = useRef(0)
  const activePlatforms = platforms.filter((platform) => platform.status !== 'inactive')
  const activeHoldings = holdings.filter((holding) => holding.status !== 'inactive')
  const holdingById = useMemo(() => new Map(activeHoldings.map((holding) => [holding.id, holding])), [activeHoldings])
  const normalizedQuery = query.trim().toLocaleLowerCase('ar')
  const visiblePlatforms = summary.platforms.map((platformRow) => ({
    ...platformRow,
    holdings: platformRow.holdings.filter((row) => !normalizedQuery || `${row.holding.name} ${row.holding.symbol} ${row.holding.exchange}`.toLocaleLowerCase('ar').includes(normalizedQuery)),
  })).filter((row) => !normalizedQuery || row.holdings.length || `${row.platform.name} ${row.platform.location}`.toLocaleLowerCase('ar').includes(normalizedQuery))
  const latestPriceAt = activeHoldings.map((holding) => new Date(holding.lastPriceAt || 0).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0

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

  function selectMarketAsset(result) {
    setHoldingDraft((current) => ({
      ...current,
      name: result.name,
      symbol: result.symbol,
      providerSymbol: result.providerSymbol,
      exchange: result.exchange || result.micCode || '',
      quoteCurrency: result.quoteCurrency,
      assetType: result.assetType || assetTypeForMarketResult(result) || current.assetType,
    }))
    setAssetQuery(`${result.name} · ${result.symbol}`)
    setAssetResults([])
    setAssetSearchStatus('selected')
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
    if (!holdingDraft.platformId || !holdingDraft.name.trim() || !holdingDraft.symbol.trim() || submissionRef.current) return
    submissionRef.current = true
    if (onAddHolding(holdingDraft) === false) {
      submissionRef.current = false
      return
    }
    setHoldingDraft(blankHolding)
    setDialog('')
  }

  function submitTrade(event) {
    event.preventDefault()
    if (!tradeDraft.holdingId || parseInvestmentDecimal(tradeDraft.quantity) <= 0 || parseInvestmentDecimal(tradeDraft.priceUsd) <= 0 || submissionRef.current) return
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

  const selectedTradeHolding = holdingById.get(tradeDraft.holdingId)
  const selectedTradePlatform = summary.platforms.find((row) => row.platform.id === selectedTradeHolding?.platformId)
  const selectedTradeRow = selectedTradePlatform?.holdings.find((row) => row.holding.id === selectedTradeHolding?.id)
  const tradeValueUsdMicros = investmentTradeValueMicros({
    quantityUnits: quantityToUnits(tradeDraft.quantity),
    priceUsdMicros: usdToMicros(tradeDraft.priceUsd),
  })
  const tradeFeeUsdMicros = usdToMicros(tradeDraft.feeUsd || 0)
  const tradeDebitUsdMicros = tradeValueUsdMicros + tradeFeeUsdMicros
  const tradeHasValidInput = Boolean(tradeDraft.holdingId && tradeValueUsdMicros > 0)
  const tradeHasEnoughCash = tradeDraft.type !== INVESTMENT_TRADE_TYPES.BUY || tradeDebitUsdMicros <= Number(selectedTradePlatform?.freeCashUsdMicros || 0)
  const tradeHasEnoughUnits = tradeDraft.type !== INVESTMENT_TRADE_TYPES.SELL || quantityToUnits(tradeDraft.quantity) <= Number(selectedTradeRow?.quantityUnits || 0)
  const canSubmitTrade = tradeHasValidInput && tradeHasEnoughCash && tradeHasEnoughUnits

  const portfolioProfitUsdMicros = Number.isSafeInteger(summary.totalProfitUsdMicros)
    ? summary.totalProfitUsdMicros
    : summary.unrealizedProfitUsdMicros || 0
  const profitTone = portfolioProfitUsdMicros > 0 ? 'is-positive' : portfolioProfitUsdMicros < 0 ? 'is-negative' : 'is-neutral'
  return (
    <section className="adreem-investments" aria-label="محفظتي">
      <div className="adreem-investment-hero">
        <div className="adreem-investment-title">
          <span><ChartCandlestick aria-hidden="true" size={22} /></span>
          <div><small>USD</small><h2>محفظتي</h2></div>
        </div>
        <div className="adreem-investment-actions">
          <button type="button" className="is-refresh" disabled={isRefreshing || !activeHoldings.length} onClick={onRefreshPrices}>
            <RefreshCw aria-hidden="true" size={16} className={isRefreshing ? 'is-spinning' : ''} />
            {isRefreshing ? 'جاري تحديث الكل' : 'تحديث الكل'}
          </button>
          <button type="button" onClick={openPlatform}><Landmark aria-hidden="true" size={16} /> منصة</button>
          <button type="button" disabled={!activePlatforms.length} onClick={openHolding}><Plus aria-hidden="true" size={16} /> استثمار</button>
        </div>
      </div>

      <div className="adreem-investment-summary">
        <article className="is-total"><small>قيمة المحفظة</small><strong>{usdMicros(summary.totalValueUsdMicros)}</strong></article>
        <article><small>المستثمر</small><strong>{usdMicros(summary.costBasisUsdMicros)}</strong></article>
        <article className={profitTone}><small>الربح والخسارة</small><strong>{usdMicros(portfolioProfitUsdMicros, true)}</strong></article>
        <article><small>نقد حر</small><strong>{usdMicros(summary.freeCashUsdMicros)}</strong></article>
      </div>

      <div className="adreem-investment-toolbar">
        <label><Search aria-hidden="true" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم أو رمز" /></label>
        <small>{latestPriceAt ? `آخر سعر ${new Date(latestPriceAt).toLocaleString('ar-LY', { dateStyle: 'short', timeStyle: 'short' })}` : 'الأسعار تبدأ يدويًا'}</small>
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
            return (
              <Motion.article
                className={`adreem-investment-platform is-brand-${brand.key}`}
                key={platformRow.platform.id}
                style={investmentPlatformBrandStyle(brand)}
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
                      <small>{preserveUiData(platformRow.platform.location || 'بدون موقع')}</small>
                    </span>
                  </div>
                  <div className="adreem-investment-platform-cash">
                    <b>{usdMicros(platformRow.freeCashUsdMicros)}<small>نقد حر</small></b>
                    <button type="button" onClick={() => onOpenFunding?.(platformRow.platform.id)}><ArrowDownToLine aria-hidden="true" size={14} /> تمويل</button>
                  </div>
                </header>
                <div className="adreem-investment-holdings">
                  {platformRow.holdings.length ? platformRow.holdings.map((row) => {
                    const holdingProfitUsdMicros = row.unrealizedProfitUsdMicros || 0
                    const holdingProfitTone = holdingProfitUsdMicros > 0 ? 'is-positive' : holdingProfitUsdMicros < 0 ? 'is-negative' : 'is-neutral'
                    const HoldingTrendIcon = holdingProfitUsdMicros > 0 ? TrendingUp : holdingProfitUsdMicros < 0 ? TrendingDown : Minus
                    return (
                      <Motion.section
                        className="adreem-investment-holding"
                        key={row.holding.id}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="adreem-investment-holding-identity">
                          <div className="adreem-investment-symbol"><b>{preserveUiData(row.holding.symbol)}</b><small>{holdingTypeLabel(row.holding.assetType)}</small></div>
                          <div className="adreem-investment-name"><strong>{preserveUiData(row.holding.name)}</strong><small>{preserveUiData(row.holding.exchange || brand.displayName || platformRow.platform.name)}</small></div>
                        </div>
                        <div className="adreem-investment-flow">
                          <section className="adreem-investment-phase is-purchase" aria-label="وقت الشراء">
                            <header><PackageCheck aria-hidden="true" size={15} /><span>وقت الشراء</span></header>
                            <div className="adreem-investment-metrics">
                              <div><small>الكمية</small><strong>{decimal(unitsToQuantity(row.quantityUnits), 8)}</strong><em>وحدة</em></div>
                              <div><small>سعر الشراء</small><strong>{usdUnitMicros(row.averageCostUsdMicros)}</strong></div>
                              <div className="is-emphasis"><small>القيمة عند الشراء</small><strong>{usdMicros(row.costBasisUsdMicros)}</strong></div>
                            </div>
                          </section>
                          <div className="adreem-investment-flow-bridge" aria-hidden="true"><span /><i><ArrowLeft size={16} /></i></div>
                          <section className="adreem-investment-phase is-current" aria-label="السوق الآن">
                            <header><ChartCandlestick aria-hidden="true" size={15} /><span>السوق الآن</span></header>
                            <div className="adreem-investment-metrics">
                              <button type="button" className="adreem-investment-price" onClick={() => openManualPrice(row.holding)}>
                                <small>سعر السوق <PencilLine aria-hidden="true" size={12} /></small>
                                <strong>{row.holding.lastPriceUsdMicros ? usdUnitMicros(row.holding.lastPriceUsdMicros) : 'أدخل السعر'}</strong>
                              </button>
                              <div className="is-emphasis"><small>القيمة الآن</small><strong>{usdMicros(row.marketValueUsdMicros)}</strong></div>
                            </div>
                          </section>
                          <div className={`adreem-investment-result ${holdingProfitTone}`}>
                            <span><HoldingTrendIcon aria-hidden="true" size={16} /><small>المكسب / الخسارة</small></span>
                            <strong>{usdMicros(holdingProfitUsdMicros, true)}</strong>
                            {row.costBasisUsdMicros ? <em>{profitPercent(holdingProfitUsdMicros, row.costBasisUsdMicros)}</em> : null}
                          </div>
                        </div>
                        <div className="adreem-investment-row-actions">
                          <button type="button" className="is-buy" onClick={() => openTrade(INVESTMENT_TRADE_TYPES.BUY, row.holding.id)}><ArrowDownToLine aria-hidden="true" size={14} /> شراء</button>
                          <button type="button" className="is-sell" onClick={() => openTrade(INVESTMENT_TRADE_TYPES.SELL, row.holding.id)}><ArrowUpFromLine aria-hidden="true" size={14} /> بيع</button>
                          {(row.quantityUnits === 0 || (row.holding.lastPriceUsdMicros > 0 && row.marketValueUsdMicros < SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS)) ? <button type="button" className="is-remove" onClick={() => openSmallClosure(row)}><Trash2 aria-hidden="true" size={14} /> إزالة</button> : null}
                        </div>
                      </Motion.section>
                    )
                  }) : <p className="adreem-investment-platform-empty">لا توجد استثمارات هنا.</p>}
                </div>
              </Motion.article>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {dialog === 'platform' ? (
          <InvestmentDialog title="منصة جديدة" subtitle="مكان وجود الاستثمار" onClose={() => setDialog('')} onSubmit={submitPlatform} canSubmit={Boolean(platformDraft.name.trim())}>
            <label><span>الاسم</span><input autoFocus value={platformDraft.name} onChange={(event) => setPlatformDraft((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: IBKR أو Binance" /></label>
            <label><span>النوع</span><select value={platformDraft.kind} onChange={(event) => setPlatformDraft((current) => ({ ...current, kind: event.target.value }))}><option value="platform">منصة تداول</option><option value="bank">مصرف</option><option value="wallet">محفظة</option><option value="broker">وسيط</option></select></label>
            <label><span>الموقع</span><input value={platformDraft.location} onChange={(event) => setPlatformDraft((current) => ({ ...current, location: event.target.value }))} placeholder="تركيا، ليبيا، أو أونلاين" /></label>
          </InvestmentDialog>
        ) : null}
        {dialog === 'holding' ? (
          <InvestmentDialog title="استثمار جديد" subtitle="ابحث ثم اختر الأصل الصحيح" onClose={() => setDialog('')} onSubmit={submitHolding} canSubmit={Boolean(holdingDraft.platformId && holdingDraft.name.trim() && holdingDraft.symbol.trim() && holdingDraft.providerSymbol.trim())}>
            <label><span>المنصة</span><select value={holdingDraft.platformId} onChange={(event) => setHoldingDraft((current) => ({ ...current, platformId: event.target.value }))}>{activePlatforms.map((platform) => <option key={platform.id} value={platform.id}>{preserveUiData(platform.name)}</option>)}</select></label>
            <div className="is-paired">
              <label><span>النوع</span><select value={holdingDraft.assetType} onChange={(event) => { setHoldingDraft((current) => ({ ...blankHolding, platformId: current.platformId, quoteCurrency: current.quoteCurrency, assetType: event.target.value })); setAssetQuery(''); setAssetResults([]); setAssetSearchStatus('idle'); setAssetSearchError('') }}>{ASSET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>عملة السوق</span><select value={holdingDraft.quoteCurrency} onChange={(event) => { setHoldingDraft((current) => ({ ...blankHolding, platformId: current.platformId, assetType: current.assetType, quoteCurrency: event.target.value })); setAssetQuery(''); setAssetResults([]); setAssetSearchStatus('idle'); setAssetSearchError('') }}><option value="USD">USD</option><option value="TRY">TRY</option><option value="EUR">EUR</option></select></label>
            </div>
            <label className="adreem-investment-market-search"><span>ابحث عن الاستثمار</span><div><Search aria-hidden="true" size={16} /><input autoFocus value={assetQuery} onChange={(event) => { const value = event.target.value; setAssetQuery(value); setAssetResults([]); setAssetSearchStatus(value.trim().length >= 2 ? 'loading' : 'idle'); setAssetSearchError(''); setHoldingDraft((current) => ({ ...current, name: '', symbol: '', providerSymbol: '', exchange: '' })) }} placeholder="الاسم أو الرمز" /></div></label>
            {assetSearchStatus === 'loading' ? <p className="adreem-investment-search-note">جاري البحث...</p> : null}
            {assetSearchError ? <p className="adreem-investment-search-note is-error">{assetSearchError}</p> : null}
            {assetSearchStatus === 'ready' && !assetResults.length ? <p className="adreem-investment-search-note">لا توجد نتيجة بهذه العملة.</p> : null}
            {assetResults.length ? <div className="adreem-investment-search-results" role="listbox" aria-label="نتائج السوق">{assetResults.map((result) => <button type="button" role="option" aria-selected="false" key={result.id} onClick={() => selectMarketAsset(result)}><span><strong>{preserveUiData(result.name)}</strong><small>{preserveUiData([holdingTypeLabel(result.assetType), result.exchange, result.country].filter(Boolean).join(' · '))}</small></span><b>{preserveUiData(result.symbol)}<small>{result.quoteCurrency}</small></b></button>)}</div> : null}
            {holdingDraft.providerSymbol ? <div className="adreem-investment-selected-asset"><Check aria-hidden="true" size={16} /><span><strong>{preserveUiData(holdingDraft.name)}</strong><small>{preserveUiData(`${holdingDraft.symbol} · ${holdingDraft.exchange || holdingDraft.quoteCurrency}`)}</small></span><b>{holdingTypeLabel(holdingDraft.assetType)}</b></div> : null}
            <div className="is-paired"><label><span>كمية سابقة</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialQuantity} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialQuantity: event.target.value }))} placeholder="0" /></label><label><span>متوسطها USD</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialPriceUsd} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialPriceUsd: event.target.value }))} placeholder="0" /></label></div>
          </InvestmentDialog>
        ) : null}
        {dialog === 'trade' ? (
          <InvestmentDialog title={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'شراء استثمار' : 'بيع استثمار'} subtitle={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'الشراء يخصم من نقد المنصة' : 'البيع يضيف إلى نقد المنصة'} onClose={() => setDialog('')} onSubmit={submitTrade} canSubmit={canSubmitTrade} submitLabel={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'تأكيد الشراء' : 'تأكيد البيع'}>
            <label><span>الاستثمار</span><select value={tradeDraft.holdingId} onChange={(event) => setTradeDraft((current) => ({ ...current, holdingId: event.target.value }))}>{activeHoldings.map((holding) => <option key={holding.id} value={holding.id}>{preserveUiData(`${holding.symbol} · ${holding.name}`)}</option>)}</select></label>
            <div className="adreem-investment-trade-toggle"><button type="button" className={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'is-active' : ''} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.BUY }))}>شراء</button><button type="button" className={tradeDraft.type === INVESTMENT_TRADE_TYPES.SELL ? 'is-active' : ''} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.SELL }))}>بيع</button></div>
            <div className="is-paired"><label><span>الكمية</span><input dir="ltr" inputMode="decimal" value={tradeDraft.quantity} onChange={(event) => setTradeDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" /></label><label><span>سعر الوحدة USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.priceUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, priceUsd: event.target.value }))} placeholder="0" /></label></div>
            <label><span>الرسوم USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.feeUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, feeUsd: event.target.value }))} placeholder="0" /></label>
            <label><span>ملاحظة</span><input value={tradeDraft.note} onChange={(event) => setTradeDraft((current) => ({ ...current, note: event.target.value }))} placeholder="اختياري" /></label>
            {selectedTradeHolding ? <div className={`adreem-investment-trade-context ${!tradeHasEnoughCash || !tradeHasEnoughUnits ? 'is-error' : ''}`}><CircleDollarSign aria-hidden="true" size={15} /><span><strong>{preserveUiData(selectedTradePlatform?.platform.name || selectedTradeHolding.symbol)}</strong><small>{tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? `المتاح ${usdMicros(selectedTradePlatform?.freeCashUsdMicros || 0)} · المطلوب ${usdMicros(tradeDebitUsdMicros)}` : `الموجود ${decimal(unitsToQuantity(selectedTradeRow?.quantityUnits || 0), 8)} وحدة`}</small></span>{!tradeHasEnoughCash && typeof onOpenFunding === 'function' ? <button type="button" onClick={() => { setDialog(''); onOpenFunding(selectedTradeHolding.platformId) }}>حوّل USD أولًا</button> : null}</div> : null}
          </InvestmentDialog>
        ) : null}
        {dialog === 'price' ? (
          <InvestmentDialog title="سعر يدوي" subtitle="يبقى حتى التحديث القادم" onClose={() => setDialog('')} onSubmit={submitManualPrice} canSubmit={parseInvestmentDecimal(manualPrice) > 0} submitLabel="حفظ السعر">
            <label><span>السعر الحالي USD</span><input autoFocus dir="ltr" inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="0" /></label>
          </InvestmentDialog>
        ) : null}
        {dialog === 'close' && closingRow ? (
          <InvestmentDialog title="إزالة استثمار صغير" subtitle="يحفظ السجل ولا يمحو المال" onClose={() => { setClosingRow(null); setDialog('') }} onSubmit={submitSmallClosure} submitLabel="تأكيد الإزالة">
            <div className="adreem-investment-close-summary">
              <strong>{preserveUiData(`${closingRow.holding.symbol} · ${closingRow.holding.name}`)}</strong>
              <b>{usdMicros(closingRow.marketValueUsdMicros)}</b>
              <p>{closingRow.quantityUnits > 0 ? 'ستباع الكمية كاملة بالسعر الحالي، وتنتقل قيمتها إلى نقد المنصة.' : 'الاستثمار فارغ وسيختفي من القائمة.'}</p>
            </div>
          </InvestmentDialog>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
