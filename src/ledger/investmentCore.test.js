import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_TRADE_TYPES,
  createInvestmentHolding,
  createInvestmentPlatform,
  createInvestmentTrade,
  microsToUsd,
  quantityToUnits,
  summarizeInvestmentPortfolio,
  usdToMicros,
  validateInvestmentState,
} from './investmentCore.js'

function fixture() {
  const platform = createInvestmentPlatform({ id: 'platform-1', name: 'IBKR', location: 'Turkey' }, '2026-01-01T00:00:00.000Z')
  const holding = createInvestmentHolding({
    id: 'holding-1',
    platformId: platform.id,
    name: 'Apple',
    symbol: 'AAPL',
    assetType: INVESTMENT_ASSET_TYPES.STOCK,
    lastPriceUsdMicros: usdToMicros(120),
  }, '2026-01-01T00:00:00.000Z')
  const deposit = {
    id: 'movement-1',
    type: MOVEMENT_TYPES.INVESTMENT_DEPOSIT,
    status: MOVEMENT_STATUSES.POSTED,
    currency: CURRENCIES.USD,
    amount: 1_000,
    investmentPlatformId: platform.id,
  }
  return { platform, holding, deposit }
}

describe('investment portfolio core', () => {
  it('keeps USD precision and quantity precision as safe integers', () => {
    expect(quantityToUnits(0.12345678)).toBe(12_345_678)
    expect(usdToMicros(12.345678)).toBe(12_345_678)
    expect(microsToUsd(12_345_678)).toBe(12.345678)
  })

  it('separates platform cash from market value and calculates profit', () => {
    const { platform, holding, deposit } = fixture()
    const buy = createInvestmentTrade({
      id: 'trade-1',
      platformId: platform.id,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(5),
      priceUsdMicros: usdToMicros(100),
    }, '2026-01-02T00:00:00.000Z')
    const summary = summarizeInvestmentPortfolio({ platforms: [platform], holdings: [holding], trades: [buy], movements: [deposit] })
    expect(microsToUsd(summary.freeCashUsdMicros)).toBe(500)
    expect(microsToUsd(summary.marketValueUsdMicros)).toBe(600)
    expect(microsToUsd(summary.unrealizedProfitUsdMicros)).toBe(100)
    expect(microsToUsd(summary.totalValueUsdMicros)).toBe(1_100)
  })

  it('rejects a portfolio with negative platform cash', () => {
    const { platform, holding, deposit } = fixture()
    const buy = createInvestmentTrade({
      id: 'trade-1',
      platformId: platform.id,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(20),
      priceUsdMicros: usdToMicros(100),
    })
    const result = validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [buy], movements: [deposit] })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.message.includes('النقد الحر'))).toBe(true)
  })

  it('keeps an opening position outside platform cash', () => {
    const { platform, holding } = fixture()
    const opening = createInvestmentTrade({
      id: 'trade-opening',
      platformId: platform.id,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(2),
      priceUsdMicros: usdToMicros(90),
    })
    const summary = summarizeInvestmentPortfolio({ platforms: [platform], holdings: [holding], trades: [opening] })
    expect(summary.freeCashUsdMicros).toBe(0)
    expect(microsToUsd(summary.costBasisUsdMicros)).toBe(180)
  })

  it('keeps realized profit in the portfolio after the full position is sold', () => {
    const { platform, holding, deposit } = fixture()
    const buy = createInvestmentTrade({
      id: 'trade-buy', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(5), priceUsdMicros: usdToMicros(100),
    }, '2026-01-02T00:00:00.000Z')
    const sell = createInvestmentTrade({
      id: 'trade-sell', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.SELL, quantityUnits: quantityToUnits(5), priceUsdMicros: usdToMicros(120),
    }, '2026-01-03T00:00:00.000Z')

    const summary = summarizeInvestmentPortfolio({ platforms: [platform], holdings: [holding], trades: [buy, sell], movements: [deposit] })
    expect(summary.platforms[0].holdings).toHaveLength(0)
    expect(microsToUsd(summary.realizedProfitUsdMicros)).toBe(100)
    expect(microsToUsd(summary.totalProfitUsdMicros)).toBe(100)
    expect(microsToUsd(summary.totalValueUsdMicros)).toBe(1_100)
  })

  it('rejects overselling even when later purchases would cover the total', () => {
    const { platform, holding, deposit } = fixture()
    const sell = createInvestmentTrade({
      id: 'trade-sell', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.SELL, quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(120),
    }, '2026-01-02T00:00:00.000Z')
    const laterBuy = createInvestmentTrade({
      id: 'trade-buy', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(3), priceUsdMicros: usdToMicros(100),
    }, '2026-01-03T00:00:00.000Z')

    const result = validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [sell, laterBuy], movements: [deposit] })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ id: sell.id }))
  })

  it('rejects duplicate active symbols and malformed investment records', () => {
    const { platform, holding } = fixture()
    const duplicate = createInvestmentHolding({ ...holding, id: 'holding-2' })
    const invalidTrade = { id: 'trade-invalid', platformId: platform.id, holdingId: holding.id, type: 'buy', status: 'unknown', quantityUnits: 1, priceUsdMicros: 1, feeUsdMicros: -1 }
    const result = validateInvestmentState({ platforms: [platform], holdings: [holding, duplicate], trades: [invalidTrade], movements: [] })

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.message.includes('مكرر'))).toBe(true)
    expect(result.errors).toContainEqual(expect.objectContaining({ id: invalidTrade.id }))
  })
})
