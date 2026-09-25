/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, CircleDollarSign } from 'lucide-react'
import { INVESTMENT_TRADE_TYPES, convertTryPriceToUsdMicros, investmentDecimalInputIsValid, investmentTradeValueMicros, microsToUsd, quantityToUnits, unitsToQuantity, usdToMicros } from './investmentCore.js'
import { blankTrade, decimal, holdingPriceLabel, tryMoneyMicros, tryUnitMicros, usdMicros, usdUnitMicros } from './investmentFormat'
import { resolveInvestmentPlatformBrand } from './investmentPlatformBrands.js'
import { microsToPriceText, platformTradeOptions, TRADE_STAGES, tradeImpact, unitsToQuantityText } from './investmentTradeFlow.js'
import { InvestmentDialog, TryExchangeRate } from './InvestmentParts'
import { TradeAssetPicker, TradeReview, TradeSelectedAsset } from './InvestmentTradeParts'
import { preserveUiData } from './uiTranslation.js'
import { tryFxIsUsable, useTryUsdRate } from './useTryUsdRate.js'

export function InvestmentTradeDialog({ platformRow, holdings, markIndex, initialType = INVESTMENT_TRADE_TYPES.BUY, initialHoldingId = '', onAddTrade, onOpenFunding, onAddAsset, onLoadTryUsdRate, onClose }) {
  const platformId = platformRow.platform.id
  const optionsFor = (type) => platformTradeOptions({ platformId, holdings, platformRow, type })
  const [draft, setDraft] = useState(() => {
    const options = optionsFor(initialType)
    return { ...blankTrade, type: initialType, holdingId: initialHoldingId || (options.length === 1 ? options[0].holding.id : '') }
  })
  const [stage, setStage] = useState(TRADE_STAGES.FIELDS)
  const submissionRef = useRef(false)

  const isBuy = draft.type === INVESTMENT_TRADE_TYPES.BUY
  const options = optionsFor(draft.type)
  const selected = options.find((option) => option.holding.id === draft.holdingId) || null
  const holding = selected?.holding
  const isTurkish = holding?.quoteCurrency === 'TRY'
  const { tryFx, changeTryFxRate, tryFxIsReadyForSave } = useTryUsdRate(isTurkish ? `trade:${holding.id}` : '', onLoadTryUsdRate)
  const tryRateMicros = usdToMicros(tryFx.rate)
  const priceUsdMicros = isTurkish ? convertTryPriceToUsdMicros(usdToMicros(draft.priceNative), tryRateMicros) : usdToMicros(draft.priceUsd)
  const feeUsdMicros = isTurkish ? convertTryPriceToUsdMicros(usdToMicros(draft.feeNative || 0), tryRateMicros) : usdToMicros(draft.feeUsd || 0)
  const quantityUnits = quantityToUnits(draft.quantity)
  const valueNativeMicros = isTurkish ? investmentTradeValueMicros({ quantityUnits, priceUsdMicros: usdToMicros(draft.priceNative) }) : 0
  const feeInputValid = investmentDecimalInputIsValid((isTurkish ? draft.feeNative : draft.feeUsd) || 0)
  const preview = tradeImpact({ type: draft.type, quantityUnits, priceUsdMicros, feeUsdMicros, freeCashUsdMicros: platformRow.freeCashUsdMicros || 0, heldUnits: selected?.quantityUnits || 0 })
  const hasValidInput = Boolean(selected
    && investmentDecimalInputIsValid(draft.quantity, { allowZero: false })
    && investmentDecimalInputIsValid(isTurkish ? draft.priceNative : draft.priceUsd, { allowZero: false })
    && (!isTurkish || tryFxIsUsable(tryFx))
    && feeInputValid
    && preview.valueUsdMicros > 0)
  const canSubmit = hasValidInput && preview.hasEnoughCash && preview.hasEnoughUnits
  const inReview = stage === TRADE_STAGES.REVIEW && Boolean(selected)
  const lastPriceMicros = Number((isTurkish ? holding?.lastPriceNativeMicros : holding?.lastPriceUsdMicros) || 0)
  const brand = resolveInvestmentPlatformBrand(platformRow.platform.name)

  function changeType(type) {
    const eligibleIds = new Set(optionsFor(type).map((option) => option.holding.id))
    setStage(TRADE_STAGES.FIELDS)
    setDraft((current) => ({ ...current, type, holdingId: eligibleIds.has(current.holdingId) ? current.holdingId : '' }))
  }

  function selectHolding(holdingId) {
    setDraft((current) => ({ ...blankTrade, type: current.type, note: current.note, holdingId }))
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function submit(event) {
    event.preventDefault()
    if (!canSubmit || submissionRef.current) return
    if (isTurkish && !tryFxIsReadyForSave()) return
    if (stage === TRADE_STAGES.FIELDS) {
      setStage(TRADE_STAGES.REVIEW)
      return
    }
    submissionRef.current = true
    const scopedDraft = { ...draft, holdingId: holding.id }
    const pricedDraft = isTurkish
      ? { ...scopedDraft, priceUsd: String(microsToUsd(priceUsdMicros)), feeUsd: String(microsToUsd(feeUsdMicros)), fxTryPerUsdMicros: tryRateMicros, fxQuotedAt: tryFx.quotedAt, fxSource: tryFx.source }
      : scopedDraft
    if (onAddTrade(pricedDraft) === false) {
      submissionRef.current = false
      setStage(TRADE_STAGES.FIELDS)
      return
    }
    onClose()
  }

  return (
    <InvestmentDialog
      title={inReview ? 'راجع العملية' : 'شراء أو بيع'}
      subtitle={preserveUiData(brand.displayName || platformRow.platform.name)}
      icon={ArrowLeftRight}
      tone={isBuy ? 'buy' : 'sell'}
      className="is-trade"
      contentKey={`${draft.type}:${inReview ? 'review' : selected ? 'amounts' : 'pick'}`}
      onClose={onClose}
      onSecondary={inReview ? () => setStage(TRADE_STAGES.FIELDS) : onClose}
      secondaryLabel={inReview ? 'تعديل' : 'إلغاء'}
      onSubmit={submit}
      canSubmit={canSubmit}
      submitLabel={inReview ? (isBuy ? 'تأكيد الشراء' : 'تأكيد البيع') : (isBuy ? 'مراجعة الشراء' : 'مراجعة البيع')}
    >
      {inReview ? (
        <TradeReview
          type={draft.type}
          option={selected}
          markIndex={markIndex}
          quantityUnits={quantityUnits}
          priceText={isTurkish ? tryUnitMicros(usdToMicros(draft.priceNative)) : usdUnitMicros(priceUsdMicros)}
          priceUsdText={isTurkish ? usdUnitMicros(priceUsdMicros) : ''}
          fxText={isTurkish ? `1 USD = ${decimal(tryFx.rate, 6)} TRY` : ''}
          valueNativeText={isTurkish ? tryMoneyMicros(valueNativeMicros) : ''}
          feeNativeText={isTurkish ? tryMoneyMicros(usdToMicros(draft.feeNative || 0)) : ''}
          impact={preview}
          note={draft.note.trim()}
        />
      ) : (
        <>
          <div className="adreem-investment-trade-toggle"><button type="button" aria-pressed={isBuy} className={`is-buy ${isBuy ? 'is-active' : ''}`.trim()} onClick={() => changeType(INVESTMENT_TRADE_TYPES.BUY)}><ArrowDownToLine aria-hidden="true" size={15} />شراء</button><button type="button" aria-pressed={!isBuy} className={`is-sell ${!isBuy ? 'is-active' : ''}`.trim()} onClick={() => changeType(INVESTMENT_TRADE_TYPES.SELL)}><ArrowUpFromLine aria-hidden="true" size={15} />بيع</button></div>
          <div className="adreem-investment-trade-step">
            <span>الاستثمار</span>
            {selected
              ? <TradeSelectedAsset option={selected} markIndex={markIndex} onChange={() => selectHolding('')} />
              : <TradeAssetPicker options={options} markIndex={markIndex} onSelect={selectHolding} onAddAsset={isBuy && typeof onAddAsset === 'function' ? () => onAddAsset(platformId) : null} emptyText={isBuy ? 'لا توجد استثمارات في هذه المنصة بعد.' : 'لا توجد كمية للبيع في هذه المنصة.'} />}
          </div>
          {selected ? (
            <>
              <div className="is-paired is-investment-numbers"><label><span>الكمية</span><input dir="ltr" inputMode="decimal" value={draft.quantity} onChange={(event) => updateDraft('quantity', event.target.value)} placeholder="0" /></label><label><span>{isTurkish ? 'سعر الوحدة TRY' : 'سعر الوحدة USD'}</span><input dir="ltr" inputMode="decimal" value={isTurkish ? draft.priceNative : draft.priceUsd} onChange={(event) => updateDraft(isTurkish ? 'priceNative' : 'priceUsd', event.target.value)} placeholder="0" /></label></div>
              {(!isBuy && selected.quantityUnits > 0) || lastPriceMicros > 0 ? (
                <div className="is-paired is-investment-numbers adreem-investment-trade-quick">
                  <span>{!isBuy && selected.quantityUnits > 0 ? <button type="button" onClick={() => updateDraft('quantity', unitsToQuantityText(selected.quantityUnits))}>كل الكمية <bdi dir="ltr">{decimal(unitsToQuantity(selected.quantityUnits), 8)}</bdi></button> : null}</span>
                  <span>{lastPriceMicros > 0 ? <button type="button" onClick={() => updateDraft(isTurkish ? 'priceNative' : 'priceUsd', microsToPriceText(lastPriceMicros))}>آخر سعر <bdi dir="ltr">{holdingPriceLabel(holding)}</bdi></button> : null}</span>
                </div>
              ) : null}
              {isTurkish ? <><TryExchangeRate fx={tryFx} onChange={changeTryFxRate} /><output className="adreem-investment-fx-result">تكلفة الوحدة: <strong>{priceUsdMicros ? usdUnitMicros(priceUsdMicros) : 'أدخل سعر الصرف'}</strong>{valueNativeMicros && priceUsdMicros ? <> · الإجمالي <strong dir="ltr">{tryMoneyMicros(valueNativeMicros)}</strong> ≈ <strong dir="ltr">{usdMicros(preview.valueUsdMicros)}</strong></> : null}</output></> : null}
              <div className="is-paired"><label><span>{isTurkish ? 'الرسوم TRY' : 'الرسوم USD'}</span><input dir="ltr" inputMode="decimal" value={isTurkish ? draft.feeNative : draft.feeUsd} onChange={(event) => updateDraft(isTurkish ? 'feeNative' : 'feeUsd', event.target.value)} placeholder="0" /></label><label><span>ملاحظة</span><input value={draft.note} maxLength={300} onChange={(event) => updateDraft('note', event.target.value)} placeholder="اختياري" /></label></div>
              {!feeInputValid ? <p className="adreem-investment-edit-warning">الرسوم يجب أن تكون رقمًا صحيحًا أو صفرًا.</p> : null}
              <div className={`adreem-investment-trade-context ${!preview.hasEnoughCash || !preview.hasEnoughUnits ? 'is-error' : ''}`}><CircleDollarSign aria-hidden="true" size={15} /><span><strong>{isBuy ? 'نقد المنصة' : 'الكمية المتاحة للبيع'}</strong><small>{isBuy ? `المتاح ${usdMicros(platformRow.freeCashUsdMicros || 0)} · المطلوب ${usdMicros(preview.valueUsdMicros + preview.feeUsdMicros)}` : `الموجود ${decimal(unitsToQuantity(selected.quantityUnits), 8)} وحدة`}</small></span>{isBuy && !preview.hasEnoughCash && typeof onOpenFunding === 'function' ? <button type="button" onClick={() => { onClose(); onOpenFunding(platformId) }}>حوّل USD أولًا</button> : null}</div>
              {!isBuy && preview.hasEnoughUnits && !preview.hasEnoughCash ? <p className="adreem-investment-edit-warning">الرسوم أكبر من نقد المنصة بعد البيع.</p> : null}
            </>
          ) : null}
        </>
      )}
    </InvestmentDialog>
  )
}
