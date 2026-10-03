import { describe, expect, it } from 'vitest'
import { INVESTMENT_TRADE_TYPES, quantityToUnits, usdToMicros } from './investmentCore.js'
import { microsToPriceText, platformTradeOptions, pricedTradeDraft, tradeImpact, unitsToQuantityText } from './investmentTradeFlow.js'

const holding = (id, platformId, symbol, extra = {}) => ({ id, platformId, symbol, name: symbol, status: 'active', ...extra })
const row = (item, quantity) => ({ holding: item, quantityUnits: quantityToUnits(quantity) })

describe('platform trade flow', () => {
  const one = holding('h-one', 'p-kucoin', 'ONE/USD')
  const dot = holding('h-dot', 'p-kucoin', 'DOT/USD')
  const fresh = holding('h-new', 'p-kucoin', 'ARB/USD')
  const sold = holding('h-sold', 'p-kucoin', 'AVAX/USD')
  const elsewhere = holding('h-aapl', 'p-midas', 'AAPL')
  const retired = holding('h-old', 'p-kucoin', 'OLD', { status: 'inactive' })
  const platformRow = {
    holdings: [row(dot, 60), row(one, 90000), row(fresh, 0)],
    closedHoldings: [row(sold, 0)],
  }
  const holdings = [one, dot, fresh, sold, elsewhere, retired]

  it('offers every active investment of the platform for buying, held ones first in screen order', () => {
    const options = platformTradeOptions({ platformId: 'p-kucoin', holdings, platformRow, type: INVESTMENT_TRADE_TYPES.BUY })
    expect(options.map((option) => option.holding.id)).toEqual(['h-dot', 'h-one', 'h-new', 'h-sold'])
    expect(options[1].quantityUnits).toBe(quantityToUnits(90000))
  })

  it('offers only investments with a quantity for selling and never another platform', () => {
    const options = platformTradeOptions({ platformId: 'p-kucoin', holdings, platformRow, type: INVESTMENT_TRADE_TYPES.SELL })
    expect(options.map((option) => option.holding.id)).toEqual(['h-dot', 'h-one'])
    expect(platformTradeOptions({ platformId: '', holdings, platformRow })).toEqual([])
  })

  it('computes a purchase against the platform cash, fee included', () => {
    const impact = tradeImpact({ type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(1000), priceUsdMicros: usdToMicros(0.0016), feeUsdMicros: usdToMicros(0.1), freeCashUsdMicros: usdToMicros(10), heldUnits: quantityToUnits(90000) })
    expect(impact.valueUsdMicros).toBe(usdToMicros(1.6))
    expect(impact.cashChangeUsdMicros).toBe(-usdToMicros(1.7))
    expect(impact.cashAfterUsdMicros).toBe(usdToMicros(8.3))
    expect(impact.unitsAfter).toBe(quantityToUnits(91000))
    expect(impact.hasEnoughCash).toBe(true)
    expect(tradeImpact({ type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(10), feeUsdMicros: 1, freeCashUsdMicros: usdToMicros(10) }).hasEnoughCash).toBe(false)
  })

  it('blocks selling more than held or a fee the platform cannot cover', () => {
    const sale = { type: INVESTMENT_TRADE_TYPES.SELL, priceUsdMicros: usdToMicros(4), heldUnits: quantityToUnits(60) }
    expect(tradeImpact({ ...sale, quantityUnits: quantityToUnits(60) })).toMatchObject({ unitsAfter: 0, hasEnoughUnits: true, cashAfterUsdMicros: usdToMicros(240) })
    expect(tradeImpact({ ...sale, quantityUnits: quantityToUnits(60.00000001) }).hasEnoughUnits).toBe(false)
    expect(tradeImpact({ ...sale, quantityUnits: quantityToUnits(1), feeUsdMicros: usdToMicros(5), freeCashUsdMicros: 0 }).hasEnoughCash).toBe(false)
  })

  it('settles Turkish purchases in native cash without touching USD cash', () => {
    const impact = tradeImpact({
      type: INVESTMENT_TRADE_TYPES.BUY,
      settlementCurrency: 'TRY',
      quantityUnits: quantityToUnits(2),
      priceNativeMicros: usdToMicros(100),
      priceUsdMicros: usdToMicros(2.5),
      feeNativeMicros: usdToMicros(5),
      feeUsdMicros: usdToMicros(0.125),
      freeCashTryMicros: usdToMicros(250),
      freeCashUsdMicros: usdToMicros(10),
    })
    expect(impact).toMatchObject({
      valueNativeMicros: usdToMicros(200),
      cashChangeTryMicros: -usdToMicros(205),
      cashAfterTryMicros: usdToMicros(45),
      cashChangeUsdMicros: 0,
      cashAfterUsdMicros: usdToMicros(10),
      hasEnoughCash: true,
    })
    expect(tradeImpact({
      type: INVESTMENT_TRADE_TYPES.BUY, settlementCurrency: 'TRY', quantityUnits: quantityToUnits(2),
      priceNativeMicros: usdToMicros(100), feeNativeMicros: usdToMicros(5),
      freeCashTryMicros: usdToMicros(204), freeCashUsdMicros: usdToMicros(1000),
    }).hasEnoughCash).toBe(false)
  })

  it('settles Turkish sales in the selected currency, including the fee', () => {
    const trade = {
      type: INVESTMENT_TRADE_TYPES.SELL,
      quantityUnits: quantityToUnits(2),
      heldUnits: quantityToUnits(2),
      priceNativeMicros: usdToMicros(100),
      priceUsdMicros: usdToMicros(2.5),
      feeNativeMicros: usdToMicros(5),
      feeUsdMicros: usdToMicros(0.125),
      freeCashTryMicros: usdToMicros(1),
      freeCashUsdMicros: usdToMicros(1),
    }
    expect(tradeImpact({ ...trade, settlementCurrency: 'TRY' })).toMatchObject({ cashChangeTryMicros: usdToMicros(195), cashChangeUsdMicros: 0, hasEnoughCash: true })
    expect(tradeImpact({ ...trade, settlementCurrency: 'USD' })).toMatchObject({ cashChangeTryMicros: 0, cashChangeUsdMicros: usdToMicros(4.875), hasEnoughCash: true })
  })

  it('sends settlement currency and actual native price and fee with Turkish trades', () => {
    const draft = { type: INVESTMENT_TRADE_TYPES.BUY, priceNative: '100', feeNative: '5', quantity: '2', note: '' }
    const fx = { quotedAt: '2026-10-03T09:00:00.000Z', source: 'manual' }
    for (const settlementCurrency of ['TRY', 'USD']) {
      expect(pricedTradeDraft(draft, { holdingId: 'h-try', isTurkish: true, settlementCurrency, priceUsdMicros: usdToMicros(2.5), feeUsdMicros: usdToMicros(0.125), tryRateMicros: usdToMicros(40), tryFx: fx })).toMatchObject({
        holdingId: 'h-try', settlementCurrency, priceNative: '100', feeNative: '5', priceUsd: '2.5', feeUsd: '0.125', fxTryPerUsdMicros: usdToMicros(40), fxQuotedAt: fx.quotedAt, fxSource: 'manual',
      })
    }
    expect(pricedTradeDraft({ priceUsd: '12', feeUsd: '1' }, { holdingId: 'h-usd', isTurkish: false, settlementCurrency: 'USD' })).toMatchObject({ holdingId: 'h-usd', settlementCurrency: 'USD', priceUsd: '12', feeUsd: '1' })
  })

  it('writes exact quantities and prices back into inputs without rounding or exponents', () => {
    expect(unitsToQuantityText(1)).toBe('0.00000001')
    expect(unitsToQuantityText(quantityToUnits(90000))).toBe('90000')
    expect(unitsToQuantityText(quantityToUnits(0.12345678))).toBe('0.12345678')
    expect(microsToPriceText(usdToMicros(0.0016))).toBe('0.0016')
    expect(microsToPriceText(usdToMicros(64250))).toBe('64250')
    expect(microsToPriceText(0)).toBe('')
  })
})
