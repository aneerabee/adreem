import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import {
  INVESTMENT_ASSET_TYPES,
  INVESTMENT_TRADE_TYPES,
  applyInvestmentTradeEditPriceFallback,
  applyInvestmentTradePriceFallback,
  buildSmallInvestmentClosure,
  buildInvestmentTradeEdit,
  createInvestmentHolding,
  createInvestmentPlatform,
  createInvestmentTrade,
  investmentOpeningTradeIsLocked,
  investmentPriceChange,
  investmentPriceDirection,
  investmentPriceRefreshDelay,
  investmentTradeMatchesBaseline,
  microsToUsd,
  parseInvestmentDecimal,
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

  it('accepts localized decimal input without losing investment precision', () => {
    expect(parseInvestmentDecimal('١٢٫٣٤٥٦٧٨')).toBe(12.345678)
    expect(parseInvestmentDecimal('1,5')).toBe(1.5)
    expect(quantityToUnits('٠٫١٢٣٤٥٦٧٨')).toBe(12_345_678)
    expect(usdToMicros('١٢٫٣٤٥٦٧٨')).toBe(12_345_678)
  })

  it('rejects investment values that exceed exact safe integer storage', () => {
    const { platform, holding, deposit } = fixture()
    const oversized = createInvestmentTrade({
      id: 'trade-oversized', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(100_000), priceUsdMicros: usdToMicros(100_000),
    })
    const result = validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [oversized], movements: [deposit] })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ id: oversized.id }))
  })

  it('rejects a cumulative portfolio total that exceeds exact safe storage', () => {
    const { platform, holding } = fixture()
    const first = createInvestmentTrade({
      id: 'opening-1', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(6_000_000_000),
    })
    const second = createInvestmentTrade({
      id: 'opening-2', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(6_000_000_000),
    })

    const result = validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [first, second], movements: [] })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ message: expect.stringContaining('حد الدقة') }))
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

  it('treats USDT as available liquidity without counting it twice', () => {
    const { platform, holding, deposit } = fixture()
    const usdt = createInvestmentHolding({
      id: 'holding-usdt',
      platformId: platform.id,
      name: 'Tether',
      symbol: 'USDT/USD',
      providerSymbol: 'USDT/USD:BINANCE',
      assetType: INVESTMENT_ASSET_TYPES.CRYPTO,
      lastPriceUsdMicros: usdToMicros(1),
    })
    const stockBuy = createInvestmentTrade({
      id: 'trade-stock', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(5), priceUsdMicros: usdToMicros(100),
    })
    const usdtBuy = createInvestmentTrade({
      id: 'trade-usdt', platformId: platform.id, holdingId: usdt.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(250), priceUsdMicros: usdToMicros(1),
    })

    const summary = summarizeInvestmentPortfolio({
      platforms: [platform],
      holdings: [holding, usdt],
      trades: [stockBuy, usdtBuy],
      movements: [deposit],
    })

    expect(microsToUsd(summary.freeCashUsdMicros)).toBe(250)
    expect(microsToUsd(summary.stablecoinUsdMicros)).toBe(250)
    expect(microsToUsd(summary.liquidBalanceUsdMicros)).toBe(500)
    expect(microsToUsd(summary.investedMarketValueUsdMicros)).toBe(600)
    expect(microsToUsd(summary.investmentProfitUsdMicros)).toBe(100)
    expect(microsToUsd(summary.totalValueUsdMicros)).toBe(1_100)
    expect(microsToUsd(summary.platforms[0].totalValueUsdMicros)).toBe(1_100)
    expect(microsToUsd(summary.platforms[0].liquidBalanceUsdMicros)).toBe(500)
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

  it('refuses cancelling or reducing funding after that cash was spent', () => {
    const { platform, holding, deposit } = fixture()
    const buy = createInvestmentTrade({
      id: 'trade-funded', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(8), priceUsdMicros: usdToMicros(100),
    })
    const cancelledFunding = { ...deposit, status: MOVEMENT_STATUSES.VOIDED }
    const reducedFunding = { ...deposit, amount: 700 }

    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [buy], movements: [cancelledFunding] })).toMatchObject({ ok: false })
    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [buy], movements: [reducedFunding] })).toMatchObject({ ok: false })
    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [buy], movements: [deposit] })).toMatchObject({ ok: true })
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

  it('uses the opening USD cost as the first visible market value', () => {
    const holding = createInvestmentHolding({
      platformId: 'platform-1',
      name: 'Turkish Airlines',
      symbol: 'THYAO',
      providerSymbol: 'THYAO:BIST',
      quoteCurrency: CURRENCIES.TRY,
      initialPriceUsd: '9.25',
    }, '2026-01-01T00:00:00.000Z')

    expect(holding.lastPriceUsdMicros).toBe(9_250_000)
    expect(holding.lastPriceNativeMicros).toBe(0)
    expect(holding.lastPriceSource).toBe('opening')
    expect(holding.lastPriceAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('uses the first buy price until a confirmed market price exists', () => {
    const { holding } = fixture()
    const emptyHolding = { ...holding, lastPriceUsdMicros: 0, lastPriceNativeMicros: 0, lastPriceAt: null }
    const buy = createInvestmentTrade({
      platformId: holding.platformId,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(2),
      priceUsdMicros: usdToMicros(105),
    }, '2026-01-02T00:00:00.000Z')

    expect(applyInvestmentTradePriceFallback(emptyHolding, buy)).toEqual(expect.objectContaining({
      lastPriceUsdMicros: usdToMicros(105),
      lastPriceNativeMicros: usdToMicros(105),
      lastPriceAt: '2026-01-02T00:00:00.000Z',
      lastPriceSource: 'trade',
    }))
    expect(applyInvestmentTradePriceFallback(holding, buy)).toBe(holding)
  })

  it('updates only a market-price fallback that still belongs to the edited trade', () => {
    const { holding } = fixture()
    const original = createInvestmentTrade({
      id: 'fallback-trade', platformId: holding.platformId, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(100),
    }, '2026-01-02T00:00:00.000Z')
    const edited = { ...original, priceUsdMicros: usdToMicros(125), updatedAt: '2026-01-03T00:00:00.000Z' }
    const fallbackHolding = applyInvestmentTradePriceFallback({ ...holding, lastPriceUsdMicros: 0, lastPriceAt: null }, original)

    expect(applyInvestmentTradeEditPriceFallback(fallbackHolding, original, edited)).toEqual(expect.objectContaining({
      previousPriceUsdMicros: usdToMicros(100),
      previousPriceAt: original.occurredAt,
      lastPriceUsdMicros: usdToMicros(125),
      lastPriceNativeMicros: usdToMicros(125),
      lastPriceSource: 'trade',
      lastPriceAt: original.occurredAt,
      updatedAt: edited.updatedAt,
    }))
    expect(applyInvestmentTradeEditPriceFallback({ ...fallbackHolding, lastPriceSource: 'market' }, original, edited)).toEqual(expect.objectContaining({
      lastPriceUsdMicros: usdToMicros(100),
      lastPriceSource: 'market',
    }))
    expect(applyInvestmentTradeEditPriceFallback({ ...fallbackHolding, lastPriceUsdMicros: usdToMicros(110) }, original, edited)).toEqual(expect.objectContaining({
      lastPriceUsdMicros: usdToMicros(110),
    }))
  })

  it('keeps a new empty holding visible until its first trade', () => {
    const { platform, holding } = fixture()
    const summary = summarizeInvestmentPortfolio({ platforms: [platform], holdings: [holding], trades: [], movements: [] })

    expect(summary.platforms[0].holdings).toHaveLength(1)
    expect(summary.platforms[0].holdings[0]).toEqual(expect.objectContaining({
      holding: expect.objectContaining({ id: holding.id }),
      quantityUnits: 0,
      marketValueUsdMicros: 0,
    }))
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

  it('closes a confirmed sub-5 USD position with a full sale and preserves its history', () => {
    const { platform, holding, deposit } = fixture()
    const smallHolding = { ...holding, lastPriceUsdMicros: usdToMicros(2) }
    const buy = createInvestmentTrade({
      id: 'trade-small-buy', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(2),
    }, '2026-01-03T00:00:00.000Z')
    const row = {
      holding: smallHolding,
      quantityUnits: quantityToUnits(2),
      marketValueUsdMicros: usdToMicros(4),
    }

    const result = buildSmallInvestmentClosure(row, '2026-01-04T00:00:00.000Z')

    expect(result.ok).toBe(true)
    expect(result.kind).toBe('sell')
    expect(result.trade).toEqual(expect.objectContaining({
      type: INVESTMENT_TRADE_TYPES.SELL,
      holdingId: holding.id,
      quantityUnits: quantityToUnits(2),
      priceUsdMicros: usdToMicros(2),
      note: 'إغلاق استثمار صغير',
    }))

    const trades = [buy, result.trade]
    const validation = validateInvestmentState({ platforms: [platform], holdings: [smallHolding], trades, movements: [deposit] })
    const summary = summarizeInvestmentPortfolio({ platforms: [platform], holdings: [smallHolding], trades, movements: [deposit] })
    expect(validation.ok).toBe(true)
    expect(summary.platforms[0].holdings).toHaveLength(0)
    expect(microsToUsd(summary.freeCashUsdMicros)).toBe(1_000)
    expect(trades).toHaveLength(2)
  })

  it('allows hiding an unused empty investment but refuses unknown or 5 USD positions', () => {
    const { holding } = fixture()
    expect(buildSmallInvestmentClosure({ holding, quantityUnits: 0, marketValueUsdMicros: 0 })).toMatchObject({ ok: true, kind: 'deactivate' })
    expect(buildSmallInvestmentClosure({ holding: { ...holding, lastPriceUsdMicros: 0 }, quantityUnits: 1, marketValueUsdMicros: 0 })).toMatchObject({ ok: false })
    expect(buildSmallInvestmentClosure({ holding, quantityUnits: quantityToUnits(1), marketValueUsdMicros: usdToMicros(5) })).toMatchObject({ ok: false })
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

  it('rejects invalid provider symbols and retiring linked investment records', () => {
    const { platform, holding, deposit } = fixture()
    const opening = createInvestmentTrade({
      id: 'trade-opening', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.OPENING, quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(100),
    })
    const invalidProvider = validateInvestmentState({
      platforms: [platform],
      holdings: [{ ...holding, providerSymbol: '<bad>' }],
      trades: [],
      movements: [],
    })
    const inactiveHolding = validateInvestmentState({
      platforms: [platform],
      holdings: [{ ...holding, status: 'inactive' }],
      trades: [opening],
      movements: [],
    })
    const inactivePlatform = validateInvestmentState({
      platforms: [{ ...platform, status: 'inactive' }],
      holdings: [holding],
      trades: [],
      movements: [deposit],
    })

    expect(invalidProvider.errors).toContainEqual(expect.objectContaining({ id: holding.id, message: expect.stringContaining('مصدر السعر') }))
    expect(inactiveHolding.errors).toContainEqual(expect.objectContaining({ id: holding.id, message: expect.stringContaining('له عمليات') }))
    expect(inactivePlatform.errors).toContainEqual(expect.objectContaining({ id: platform.id, message: expect.stringContaining('مرتبطة') }))
  })

  it('rejects malformed saved prices and trade dates', () => {
    const { platform, holding, deposit } = fixture()
    const malformedHolding = { ...holding, lastPriceUsdMicros: -1, lastPriceAt: 'not-a-date' }
    const malformedTrade = createInvestmentTrade({
      id: 'trade-invalid-date', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(100),
      occurredAt: 'not-a-date',
    })
    const result = validateInvestmentState({ platforms: [platform], holdings: [malformedHolding], trades: [malformedTrade], movements: [deposit] })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ id: holding.id, message: expect.stringContaining('السعر المحفوظ') }))
    expect(result.errors).toContainEqual(expect.objectContaining({ id: malformedTrade.id, message: expect.stringContaining('تاريخ') }))
  })

  it('builds an immutable investment trade edit without changing its identity', () => {
    const { platform, holding } = fixture()
    const original = createInvestmentTrade({
      id: 'trade-edit', platformId: platform.id, holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(10), feeUsdMicros: usdToMicros(1), note: 'old',
    }, '2026-01-02T00:00:00.000Z')

    const result = buildInvestmentTradeEdit(original, {
      quantity: '3.5', priceUsd: '12.25', feeUsd: '0.5', note: 'updated',
    }, '2026-01-04T00:00:00.000Z')

    expect(result.ok).toBe(true)
    expect(result.trade).toEqual(expect.objectContaining({
      id: original.id,
      platformId: original.platformId,
      holdingId: original.holdingId,
      type: original.type,
      quantityUnits: quantityToUnits(3.5),
      priceUsdMicros: usdToMicros(12.25),
      feeUsdMicros: usdToMicros(0.5),
      note: 'updated',
      occurredAt: original.occurredAt,
      createdAt: original.createdAt,
      updatedAt: '2026-01-04T00:00:00.000Z',
    }))
    expect(original).toEqual(expect.objectContaining({
      quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(10), note: 'old',
    }))
  })

  it('rejects invalid trade edit numbers before changing stored data', () => {
    const { platform, holding } = fixture()
    const original = createInvestmentTrade({
      platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(10),
    })

    expect(buildInvestmentTradeEdit(original, { quantity: '0', priceUsd: '10', feeUsd: '0', note: '' })).toMatchObject({ ok: false })
    expect(buildInvestmentTradeEdit(original, { quantity: '1', priceUsd: 'bad', feeUsd: '0', note: '' })).toMatchObject({ ok: false })
    expect(buildInvestmentTradeEdit(original, { quantity: '1', priceUsd: '10', feeUsd: 'bad', note: '' })).toMatchObject({ ok: false, message: expect.stringContaining('الرسوم') })
  })

  it('keeps opening trades fee-free in edits and validation', () => {
    const { platform, holding } = fixture()
    const opening = createInvestmentTrade({
      platformId: platform.id,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(1),
      priceUsdMicros: usdToMicros(10),
    })
    const invalidOpening = { ...opening, feeUsdMicros: usdToMicros(1) }

    expect(buildInvestmentTradeEdit(opening, { quantity: '1', priceUsd: '10', feeUsd: '1', note: '' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('الافتتاحي'),
    })
    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [invalidOpening], movements: [] })).toMatchObject({ ok: false })
  })

  it('locks financial opening values after a later active trade', () => {
    const { platform, holding } = fixture()
    const opening = createInvestmentTrade({
      id: 'opening', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(10),
    }, '2026-01-01T00:00:00.000Z')
    const laterBuy = createInvestmentTrade({
      id: 'later', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(12),
    }, '2026-01-02T00:00:00.000Z')

    expect(investmentOpeningTradeIsLocked(opening, [opening, laterBuy])).toBe(true)
    expect(investmentOpeningTradeIsLocked(opening, [opening, { ...laterBuy, status: 'voided' }])).toBe(false)
    expect(investmentOpeningTradeIsLocked(laterBuy, [opening, laterBuy])).toBe(false)
  })

  it('updates a trade-linked fallback price across a small timestamp difference', () => {
    const { platform } = fixture()
    const holding = createInvestmentHolding({
      id: 'holding-opening-price',
      platformId: platform.id,
      name: 'Opening asset',
      symbol: 'OPEN',
      initialPriceUsd: 10,
    }, '2026-01-01T00:00:00.000Z')
    const opening = createInvestmentTrade({
      id: 'opening-price',
      platformId: platform.id,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.OPENING,
      quantityUnits: quantityToUnits(1),
      priceUsdMicros: usdToMicros(10),
    }, '2026-01-01T00:00:00.250Z')
    const edited = { ...opening, priceUsdMicros: usdToMicros(12), updatedAt: '2026-01-02T00:00:00.000Z' }

    expect(applyInvestmentTradeEditPriceFallback(holding, opening, edited)).toEqual(expect.objectContaining({
      lastPriceUsdMicros: usdToMicros(12),
      lastPriceTradeId: opening.id,
    }))
  })

  it('rejects edited trades that oversell or make platform cash negative', () => {
    const { platform, holding, deposit } = fixture()
    const buy = createInvestmentTrade({
      id: 'buy', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(5), priceUsdMicros: usdToMicros(100),
    }, '2026-01-02T00:00:00.000Z')
    const sell = createInvestmentTrade({
      id: 'sell', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.SELL,
      quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(120),
    }, '2026-01-03T00:00:00.000Z')
    const oversold = buildInvestmentTradeEdit(sell, { quantity: '6', priceUsd: '120', feeUsd: '0', note: '' }).trade
    const overfunded = buildInvestmentTradeEdit(buy, { quantity: '11', priceUsd: '100', feeUsd: '0', note: '' }).trade

    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [buy, oversold], movements: [deposit] })).toMatchObject({ ok: false })
    expect(validateInvestmentState({ platforms: [platform], holdings: [holding], trades: [overfunded], movements: [deposit] })).toMatchObject({ ok: false })
  })

  it('detects a trade that changed after the edit screen opened', () => {
    const { platform, holding } = fixture()
    const baseline = createInvestmentTrade({
      id: 'trade-baseline', platformId: platform.id, holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(1), priceUsdMicros: usdToMicros(10), note: 'original',
    })

    expect(investmentTradeMatchesBaseline(baseline, { ...baseline })).toBe(true)
    expect(investmentTradeMatchesBaseline({ ...baseline, note: 'changed elsewhere' }, baseline)).toBe(false)
    expect(investmentTradeMatchesBaseline({ ...baseline, updatedAt: '2026-01-05T00:00:00.000Z' }, baseline)).toBe(false)
    expect(investmentTradeMatchesBaseline({ ...baseline, type: INVESTMENT_TRADE_TYPES.SELL }, baseline)).toBe(false)
    expect(investmentTradeMatchesBaseline({ ...baseline, holdingId: 'another-holding' }, baseline)).toBe(false)
  })

  it('derives the visible market direction only from two confirmed prices', () => {
    expect(investmentPriceDirection({ lastPriceUsdMicros: usdToMicros(110), previousPriceUsdMicros: usdToMicros(100) })).toBe('up')
    expect(investmentPriceDirection({ lastPriceUsdMicros: usdToMicros(90), previousPriceUsdMicros: usdToMicros(100) })).toBe('down')
    expect(investmentPriceDirection({ lastPriceUsdMicros: usdToMicros(100), previousPriceUsdMicros: usdToMicros(100) })).toBe('neutral')
    expect(investmentPriceDirection({ lastPriceUsdMicros: usdToMicros(100) })).toBe('neutral')
    expect(investmentPriceChange({
      lastPriceNativeMicros: usdToMicros(120), previousPriceNativeMicros: usdToMicros(100),
      lastPriceUsdMicros: usdToMicros(3), previousPriceUsdMicros: usdToMicros(4),
    })).toEqual({ direction: 'up', percent: 20 })
  })

  it('schedules the complete portfolio refresh from the oldest confirmed price', () => {
    const now = new Date('2026-01-01T12:00:00.000Z').getTime()
    const active = { id: 'active', status: 'active', providerSymbol: 'AAPL', lastPriceAt: '2026-01-01T11:00:00.000Z' }
    const older = { id: 'older', status: 'active', providerSymbol: 'BTC/USD', lastPriceAt: '2026-01-01T09:30:00.000Z' }
    const inactive = { id: 'inactive', status: 'inactive', providerSymbol: 'MSFT', lastPriceAt: null }

    expect(investmentPriceRefreshDelay([active, older, inactive], now)).toBe(1_200)
    expect(investmentPriceRefreshDelay([active], now)).toBe(60 * 60 * 1000)
    expect(investmentPriceRefreshDelay([{ ...active, lastPriceAt: null }], now)).toBe(1_200)
    expect(investmentPriceRefreshDelay([inactive], now)).toBeNull()
  })
})
