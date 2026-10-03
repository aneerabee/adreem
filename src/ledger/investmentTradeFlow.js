import { INVESTMENT_PRICE_SCALE, INVESTMENT_QUANTITY_SCALE, INVESTMENT_TRADE_TYPES, investmentTradeValueMicros, microsToUsd } from './investmentCore.js'

export const TRADE_STAGES = Object.freeze({ FIELDS: 'fields', REVIEW: 'review' })

function scaledToDecimalText(value, scale) {
  const integer = Number(value)
  if (!Number.isSafeInteger(integer) || integer <= 0) return ''
  const digits = String(scale).length - 1
  const whole = Math.trunc(integer / scale)
  const fraction = String(integer % scale).padStart(digits, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function unitsToQuantityText(units) {
  return scaledToDecimalText(units, INVESTMENT_QUANTITY_SCALE)
}

export function microsToPriceText(micros) {
  return scaledToDecimalText(micros, INVESTMENT_PRICE_SCALE)
}

export function platformTradeOptions({ platformId = '', holdings = [], platformRow = null, type = INVESTMENT_TRADE_TYPES.BUY } = {}) {
  if (!platformId) return []
  const summaryRows = [...(platformRow?.closedHoldings || []), ...(platformRow?.holdings || [])]
  const quantityById = new Map(summaryRows.map((row) => [row.holding?.id, Number(row.quantityUnits || 0)]))
  const displayOrder = new Map((platformRow?.holdings || []).map((row, index) => [row.holding?.id, index]))
  return holdings
    .filter((holding) => holding?.id && holding.status !== 'inactive' && holding.platformId === platformId)
    .map((holding) => ({ holding, quantityUnits: quantityById.get(holding.id) || 0 }))
    .filter((option) => type !== INVESTMENT_TRADE_TYPES.SELL || option.quantityUnits > 0)
    .sort((left, right) => {
      const leftOrder = displayOrder.has(left.holding.id) ? displayOrder.get(left.holding.id) : Number.MAX_SAFE_INTEGER
      const rightOrder = displayOrder.has(right.holding.id) ? displayOrder.get(right.holding.id) : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || String(left.holding.symbol).localeCompare(String(right.holding.symbol), 'en')
    })
}

export function pricedTradeDraft(draft, { holdingId, isTurkish, settlementCurrency, priceUsdMicros, feeUsdMicros, tryRateMicros, tryFx } = {}) {
  const scopedDraft = { ...draft, holdingId, settlementCurrency }
  if (!isTurkish) return scopedDraft
  return {
    ...scopedDraft,
    priceUsd: String(microsToUsd(priceUsdMicros)),
    feeUsd: String(microsToUsd(feeUsdMicros)),
    fxTryPerUsdMicros: tryRateMicros,
    fxQuotedAt: tryFx.quotedAt,
    fxSource: tryFx.source,
  }
}

export function tradeImpact({ type, settlementCurrency = 'USD', quantityUnits = 0, priceUsdMicros = 0, priceNativeMicros = 0, feeUsdMicros = 0, feeNativeMicros = 0, freeCashUsdMicros = 0, freeCashTryMicros = 0, heldUnits = 0 } = {}) {
  const isBuy = type === INVESTMENT_TRADE_TYPES.BUY
  const settlesInTry = settlementCurrency === 'TRY'
  const valueUsdMicros = investmentTradeValueMicros({ quantityUnits, priceUsdMicros })
  const valueNativeMicros = investmentTradeValueMicros({ quantityUnits, priceUsdMicros: priceNativeMicros })
  const feeUsd = Math.max(0, Number(feeUsdMicros) || 0)
  const feeNative = Math.max(0, Number(feeNativeMicros) || 0)
  const cashUsd = Number(freeCashUsdMicros) || 0
  const cashTry = Number(freeCashTryMicros) || 0
  const held = Number(heldUnits) || 0
  const cashChangeUsdMicros = settlesInTry ? 0 : isBuy ? -(valueUsdMicros + feeUsd) : valueUsdMicros - feeUsd
  const cashChangeTryMicros = settlesInTry ? isBuy ? -(valueNativeMicros + feeNative) : valueNativeMicros - feeNative : 0
  const unitsAfter = isBuy ? held + quantityUnits : held - quantityUnits
  return {
    valueUsdMicros,
    valueNativeMicros,
    feeUsdMicros: feeUsd,
    feeNativeMicros: feeNative,
    cashChangeUsdMicros,
    cashBeforeUsdMicros: cashUsd,
    cashAfterUsdMicros: cashUsd + cashChangeUsdMicros,
    cashChangeTryMicros,
    cashBeforeTryMicros: cashTry,
    cashAfterTryMicros: cashTry + cashChangeTryMicros,
    unitsBefore: held,
    unitsAfter,
    hasEnoughCash: settlesInTry ? cashTry + cashChangeTryMicros >= 0 : cashUsd + cashChangeUsdMicros >= 0,
    hasEnoughUnits: unitsAfter >= 0,
  }
}
