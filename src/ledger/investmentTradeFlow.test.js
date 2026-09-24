import { describe, expect, it } from 'vitest'
import { INVESTMENT_TRADE_TYPES, quantityToUnits, usdToMicros } from './investmentCore.js'
import { microsToPriceText, platformTradeOptions, tradeImpact, unitsToQuantityText } from './investmentTradeFlow.js'

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

  it('writes exact quantities and prices back into inputs without rounding or exponents', () => {
    expect(unitsToQuantityText(1)).toBe('0.00000001')
    expect(unitsToQuantityText(quantityToUnits(90000))).toBe('90000')
    expect(unitsToQuantityText(quantityToUnits(0.12345678))).toBe('0.12345678')
    expect(microsToPriceText(usdToMicros(0.0016))).toBe('0.0016')
    expect(microsToPriceText(usdToMicros(64250))).toBe('64250')
    expect(microsToPriceText(0)).toBe('')
  })
})
