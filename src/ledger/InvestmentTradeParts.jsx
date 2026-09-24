/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { ArrowLeft, PencilLine, Plus, ShieldCheck } from 'lucide-react'
import { INVESTMENT_TRADE_TYPES, unitsToQuantity } from './investmentCore.js'
import { AssetMark } from './AssetMark'
import { assetMarkFor } from './assetMarks'
import { decimal, usdMicros } from './investmentFormat'
import { preserveUiData } from './uiTranslation.js'

function HeldQuantity({ units }) {
  return units > 0
    ? <em><bdi dir="ltr">{decimal(unitsToQuantity(units), 8)}</bdi> <small>وحدة</small></em>
    : <em className="is-empty"><small>بدون رصيد</small></em>
}

function AssetIdentity({ holding }) {
  return (
    <span className="adreem-investment-trade-asset-name">
      <b dir="ltr">{preserveUiData(holding.symbol)}</b>
      <small dir="auto">{preserveUiData(holding.name)}</small>
    </span>
  )
}

export function TradeAssetPicker({ options, markIndex, onSelect, onAddAsset, emptyText }) {
  return (
    <div className="adreem-investment-trade-assets" role="radiogroup" aria-label="الاستثمار">
      {options.map(({ holding, quantityUnits }) => {
        const mark = assetMarkFor(holding, markIndex)
        return (
          <button type="button" role="radio" aria-checked="false" key={holding.id} style={mark ? { '--asset-color': mark.color } : undefined} onClick={() => onSelect(holding.id)}>
            <AssetMark mark={mark} />
            <AssetIdentity holding={holding} />
            <HeldQuantity units={quantityUnits} />
          </button>
        )
      })}
      {!options.length ? <p className="adreem-investment-trade-empty">{emptyText}</p> : null}
      {onAddAsset ? <button type="button" className="is-new-asset" onClick={onAddAsset}><Plus aria-hidden="true" size={15} /><span>أصل جديد في هذه المنصة</span></button> : null}
    </div>
  )
}

export function TradeSelectedAsset({ option, markIndex, onChange }) {
  const mark = assetMarkFor(option.holding, markIndex)
  return (
    <div className="adreem-investment-trade-asset" style={mark ? { '--asset-color': mark.color } : undefined}>
      <AssetMark mark={mark} />
      <AssetIdentity holding={option.holding} />
      <HeldQuantity units={option.quantityUnits} />
      <button type="button" onClick={onChange}><PencilLine aria-hidden="true" size={12} /> تغيير</button>
    </div>
  )
}

function ChangeLine({ before, after }) {
  return (
    <b className="adreem-investment-trade-change">
      <bdi dir="ltr">{before}</bdi>
      <ArrowLeft aria-hidden="true" size={13} />
      <bdi dir="ltr">{after}</bdi>
    </b>
  )
}

export function TradeReview({ type, option, markIndex, quantityUnits, priceText, priceUsdText, fxText, valueNativeText = '', feeNativeText = '', impact, note }) {
  const isBuy = type === INVESTMENT_TRADE_TYPES.BUY
  const mark = assetMarkFor(option.holding, markIndex)
  return (
    <div className={`adreem-investment-trade-review ${isBuy ? 'is-buy' : 'is-sell'}`} style={mark ? { '--asset-color': mark.color } : undefined}>
      <header>
        <AssetMark mark={mark} />
        <AssetIdentity holding={option.holding} />
        <em>{isBuy ? 'شراء' : 'بيع'}</em>
      </header>
      <dl>
        <div><dt>الكمية</dt><dd><span><bdi dir="ltr">{decimal(unitsToQuantity(quantityUnits), 8)}</bdi> وحدة</span></dd></div>
        <div><dt>سعر الوحدة</dt><dd><bdi dir="ltr">{priceText}</bdi>{priceUsdText ? <small dir="ltr">≈ {priceUsdText}</small> : null}</dd></div>
        {fxText ? <div><dt>سعر الصرف</dt><dd><bdi dir="ltr">{fxText}</bdi></dd></div> : null}
        <div><dt>القيمة</dt><dd>{valueNativeText ? <><bdi dir="ltr">{valueNativeText}</bdi><small dir="ltr">≈ {usdMicros(impact.valueUsdMicros)}</small></> : <bdi dir="ltr">{usdMicros(impact.valueUsdMicros)}</bdi>}</dd></div>
        <div><dt>الرسوم</dt><dd>{feeNativeText ? <><bdi dir="ltr">{feeNativeText}</bdi><small dir="ltr">≈ {usdMicros(impact.feeUsdMicros)}</small></> : <bdi dir="ltr">{usdMicros(impact.feeUsdMicros)}</bdi>}</dd></div>
        <div className="is-total"><dt>{isBuy ? 'يخصم من نقد المنصة' : 'يضاف إلى نقد المنصة'}</dt><dd><bdi dir="ltr">{usdMicros(impact.cashChangeUsdMicros, true)}</bdi></dd></div>
      </dl>
      <div className="adreem-investment-trade-effects">
        <span><small>نقد المنصة</small><ChangeLine before={usdMicros(impact.cashBeforeUsdMicros)} after={usdMicros(impact.cashAfterUsdMicros)} /></span>
        <span><small>الكمية في المنصة</small><ChangeLine before={decimal(unitsToQuantity(impact.unitsBefore), 8)} after={decimal(unitsToQuantity(impact.unitsAfter), 8)} /></span>
      </div>
      {note ? <p className="adreem-investment-trade-note">{preserveUiData(note)}</p> : null}
      <p className="adreem-investment-trade-footnote"><ShieldCheck aria-hidden="true" size={15} />تسجيل في الدفتر فقط؛ لا ينفذ أمرًا في المنصة.</p>
    </div>
  )
}
