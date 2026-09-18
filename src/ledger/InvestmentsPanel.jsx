/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ChartCandlestick, Check, CircleDollarSign, Landmark, Plus, RefreshCw, Search, WalletCards, X } from 'lucide-react'
import { AnimatePresence, motion as Motion } from 'motion/react'
import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_TRADE_TYPES,
  microsToUsd,
  unitsToQuantity,
} from './investmentCore.js'
import { preserveUiData } from './uiTranslation.js'

const ASSET_OPTIONS = [
  { value: INVESTMENT_ASSET_TYPES.STOCK, label: 'سهم' },
  { value: INVESTMENT_ASSET_TYPES.CRYPTO, label: 'كريبتو' },
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

function holdingTypeLabel(value) {
  return ASSET_OPTIONS.find((option) => option.value === value)?.label || 'أخرى'
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
  onRefreshPrices,
}) {
  const [dialog, setDialog] = useState('')
  const [platformDraft, setPlatformDraft] = useState(blankPlatform)
  const [holdingDraft, setHoldingDraft] = useState(blankHolding)
  const [tradeDraft, setTradeDraft] = useState(blankTrade)
  const [manualHoldingId, setManualHoldingId] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [query, setQuery] = useState('')
  const submissionRef = useRef(false)
  const activePlatforms = platforms.filter((platform) => platform.status !== 'inactive')
  const activeHoldings = holdings.filter((holding) => holding.status !== 'inactive')
  const holdingById = useMemo(() => new Map(activeHoldings.map((holding) => [holding.id, holding])), [activeHoldings])
  const normalizedQuery = query.trim().toLocaleLowerCase('ar')
  const visiblePlatforms = summary.platforms.map((platformRow) => ({
    ...platformRow,
    holdings: platformRow.holdings.filter((row) => !normalizedQuery || `${row.holding.name} ${row.holding.symbol} ${row.holding.exchange}`.toLocaleLowerCase('ar').includes(normalizedQuery)),
  })).filter((row) => !normalizedQuery || row.holdings.length || `${row.platform.name} ${row.platform.location}`.toLocaleLowerCase('ar').includes(normalizedQuery))
  const latestPriceAt = activeHoldings.map((holding) => new Date(holding.lastPriceAt || 0).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0

  function openPlatform() {
    submissionRef.current = false
    setPlatformDraft(blankPlatform)
    setDialog('platform')
  }

  function openHolding() {
    submissionRef.current = false
    setHoldingDraft({ ...blankHolding, platformId: activePlatforms[0]?.id || '' })
    setDialog('holding')
  }

  function openTrade(type, holdingId = '') {
    submissionRef.current = false
    setTradeDraft({ ...blankTrade, type, holdingId: holdingId || activeHoldings[0]?.id || '' })
    setDialog('trade')
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
    if (!tradeDraft.holdingId || Number(tradeDraft.quantity) <= 0 || Number(tradeDraft.priceUsd) <= 0 || submissionRef.current) return
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
    if (!manualHoldingId || Number(manualPrice) <= 0 || submissionRef.current) return
    submissionRef.current = true
    if (onManualPrice(manualHoldingId, manualPrice) === false) {
      submissionRef.current = false
      return
    }
    setDialog('')
  }

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
            {isRefreshing ? 'جاري التحديث' : 'تحديث الأسعار'}
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
          {visiblePlatforms.map((platformRow) => (
            <article className="adreem-investment-platform" key={platformRow.platform.id}>
              <header>
                <div><i><Landmark aria-hidden="true" size={17} /></i><span><strong>{preserveUiData(platformRow.platform.name)}</strong><small>{preserveUiData(platformRow.platform.location || 'بدون موقع')}</small></span></div>
                <b>{usdMicros(platformRow.freeCashUsdMicros)}<small>نقد حر</small></b>
              </header>
              <div className="adreem-investment-holdings">
                {platformRow.holdings.length ? platformRow.holdings.map((row) => {
                  const holdingProfitUsdMicros = Number.isSafeInteger(row.totalProfitUsdMicros)
                    ? row.totalProfitUsdMicros
                    : row.unrealizedProfitUsdMicros || 0
                  const holdingProfitTone = holdingProfitUsdMicros > 0 ? 'is-positive' : holdingProfitUsdMicros < 0 ? 'is-negative' : 'is-neutral'
                  return (
                    <section className="adreem-investment-holding" key={row.holding.id}>
                      <div className="adreem-investment-symbol"><b>{preserveUiData(row.holding.symbol)}</b><small>{holdingTypeLabel(row.holding.assetType)}</small></div>
                      <div className="adreem-investment-name"><strong>{preserveUiData(row.holding.name)}</strong><small>{decimal(unitsToQuantity(row.quantityUnits), 8)} وحدة</small></div>
                      <div><small>متوسط الشراء</small><strong>{usdMicros(row.averageCostUsdMicros)}</strong></div>
                      <button type="button" className="adreem-investment-price" onClick={() => openManualPrice(row.holding)}><small>سعر السوق</small><strong>{row.holding.lastPriceUsdMicros ? usdMicros(row.holding.lastPriceUsdMicros) : 'أدخل السعر'}</strong></button>
                      <div><small>القيمة</small><strong>{usdMicros(row.marketValueUsdMicros)}</strong></div>
                      <div className={holdingProfitTone}><small>النتيجة</small><strong>{usdMicros(holdingProfitUsdMicros, true)}</strong></div>
                      <div className="adreem-investment-row-actions">
                        <button type="button" className="is-buy" onClick={() => openTrade(INVESTMENT_TRADE_TYPES.BUY, row.holding.id)}><ArrowDownToLine aria-hidden="true" size={14} /> شراء</button>
                        <button type="button" className="is-sell" onClick={() => openTrade(INVESTMENT_TRADE_TYPES.SELL, row.holding.id)}><ArrowUpFromLine aria-hidden="true" size={14} /> بيع</button>
                      </div>
                    </section>
                  )
                }) : <p className="adreem-investment-platform-empty">لا توجد استثمارات هنا.</p>}
              </div>
            </article>
          ))}
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
          <InvestmentDialog title="استثمار جديد" subtitle="يمكن إدخال الرصيد الموجود مرة واحدة" onClose={() => setDialog('')} onSubmit={submitHolding} canSubmit={Boolean(holdingDraft.platformId && holdingDraft.name.trim() && holdingDraft.symbol.trim())}>
            <label><span>المنصة</span><select value={holdingDraft.platformId} onChange={(event) => setHoldingDraft((current) => ({ ...current, platformId: event.target.value }))}>{activePlatforms.map((platform) => <option key={platform.id} value={platform.id}>{preserveUiData(platform.name)}</option>)}</select></label>
            <div className="is-paired"><label><span>الاسم</span><input value={holdingDraft.name} onChange={(event) => setHoldingDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Apple" /></label><label><span>الرمز</span><input dir="ltr" value={holdingDraft.symbol} onChange={(event) => setHoldingDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))} placeholder="AAPL" /></label></div>
            <div className="is-paired"><label><span>النوع</span><select value={holdingDraft.assetType} onChange={(event) => setHoldingDraft((current) => ({ ...current, assetType: event.target.value }))}>{ASSET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>عملة السوق</span><select value={holdingDraft.quoteCurrency} onChange={(event) => setHoldingDraft((current) => ({ ...current, quoteCurrency: event.target.value }))}><option value="USD">USD</option><option value="TRY">TRY</option><option value="EUR">EUR</option></select></label></div>
            <div className="is-paired"><label><span>رمز مزود السعر</span><input dir="ltr" value={holdingDraft.providerSymbol} onChange={(event) => setHoldingDraft((current) => ({ ...current, providerSymbol: event.target.value.toUpperCase() }))} placeholder="AAPL أو THYAO:XIST" /></label><label><span>السوق</span><input dir="ltr" value={holdingDraft.exchange} onChange={(event) => setHoldingDraft((current) => ({ ...current, exchange: event.target.value.toUpperCase() }))} placeholder="NASDAQ" /></label></div>
            <div className="is-paired"><label><span>كمية سابقة</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialQuantity} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialQuantity: event.target.value }))} placeholder="0" /></label><label><span>متوسطها USD</span><input dir="ltr" inputMode="decimal" value={holdingDraft.initialPriceUsd} onChange={(event) => setHoldingDraft((current) => ({ ...current, initialPriceUsd: event.target.value }))} placeholder="0" /></label></div>
          </InvestmentDialog>
        ) : null}
        {dialog === 'trade' ? (
          <InvestmentDialog title={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'شراء استثمار' : 'بيع استثمار'} subtitle="العملية داخل محفظتي" onClose={() => setDialog('')} onSubmit={submitTrade} canSubmit={Boolean(tradeDraft.holdingId && Number(tradeDraft.quantity) > 0 && Number(tradeDraft.priceUsd) > 0)} submitLabel={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'تأكيد الشراء' : 'تأكيد البيع'}>
            <label><span>الاستثمار</span><select value={tradeDraft.holdingId} onChange={(event) => setTradeDraft((current) => ({ ...current, holdingId: event.target.value }))}>{activeHoldings.map((holding) => <option key={holding.id} value={holding.id}>{preserveUiData(`${holding.symbol} · ${holding.name}`)}</option>)}</select></label>
            <div className="adreem-investment-trade-toggle"><button type="button" className={tradeDraft.type === INVESTMENT_TRADE_TYPES.BUY ? 'is-active' : ''} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.BUY }))}>شراء</button><button type="button" className={tradeDraft.type === INVESTMENT_TRADE_TYPES.SELL ? 'is-active' : ''} onClick={() => setTradeDraft((current) => ({ ...current, type: INVESTMENT_TRADE_TYPES.SELL }))}>بيع</button></div>
            <div className="is-paired"><label><span>الكمية</span><input dir="ltr" inputMode="decimal" value={tradeDraft.quantity} onChange={(event) => setTradeDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" /></label><label><span>سعر الوحدة USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.priceUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, priceUsd: event.target.value }))} placeholder="0" /></label></div>
            <label><span>الرسوم USD</span><input dir="ltr" inputMode="decimal" value={tradeDraft.feeUsd} onChange={(event) => setTradeDraft((current) => ({ ...current, feeUsd: event.target.value }))} placeholder="0" /></label>
            <label><span>ملاحظة</span><input value={tradeDraft.note} onChange={(event) => setTradeDraft((current) => ({ ...current, note: event.target.value }))} placeholder="اختياري" /></label>
            {holdingById.get(tradeDraft.holdingId) ? <p className="adreem-investment-trade-context"><CircleDollarSign aria-hidden="true" size={15} />{preserveUiData(holdingById.get(tradeDraft.holdingId).symbol)} · USD</p> : null}
          </InvestmentDialog>
        ) : null}
        {dialog === 'price' ? (
          <InvestmentDialog title="سعر يدوي" subtitle="يبقى حتى التحديث القادم" onClose={() => setDialog('')} onSubmit={submitManualPrice} canSubmit={Number(manualPrice) > 0} submitLabel="حفظ السعر">
            <label><span>السعر الحالي USD</span><input autoFocus dir="ltr" inputMode="decimal" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} placeholder="0" /></label>
          </InvestmentDialog>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
