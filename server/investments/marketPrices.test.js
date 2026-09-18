import { describe, expect, it, vi } from 'vitest'
import { createMarketPriceService, marketPriceItemsForHoldings, normalizeMarketPriceRequest, normalizeMarketSearchRequest } from './marketPrices.js'

describe('investment market prices', () => {
  it('rejects duplicate holdings and invalid symbols', () => {
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'AAPL' }, { id: 'a', symbol: 'MSFT' }] })).toThrow(/مكرر/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: '<bad>' }] })).toThrow(/غير صالح/)
  })

  it('resolves price requests only from holdings in the authenticated ledger', () => {
    const state = { investmentHoldings: [{ id: 'holding-1', providerSymbol: 'AAPL:NASDAQ', quoteCurrency: 'USD', status: 'active' }] }
    expect(marketPriceItemsForHoldings({ ids: ['holding-1'] }, state)).toEqual([
      { id: 'holding-1', symbol: 'AAPL:NASDAQ', quoteCurrency: 'USD' },
    ])
    expect(() => marketPriceItemsForHoldings({ ids: ['outside-ledger'] }, state)).toThrow(/غير موجود/)
  })

  it('normalizes market searches with an explicit quote currency', () => {
    expect(normalizeMarketSearchRequest({ query: '  Turkish   Airlines ', quoteCurrency: 'TRY' }))
      .toEqual({ query: 'Turkish Airlines', quoteCurrency: 'TRY' })
    expect(() => normalizeMarketSearchRequest({ query: 'A' })).toThrow(/حرفين/)
    expect(() => normalizeMarketSearchRequest({ query: 'Apple', quoteCurrency: 'GBP' })).toThrow(/غير مدعومة/)
  })

  it('batches assets and FX and converts TRY quoted prices to USD', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbols = new URL(url).searchParams.get('symbol')
      expect(symbols).toContain('THYAO:XIST')
      expect(symbols).toContain('TRY/USD')
      return {
        ok: true,
        json: async () => ({
          'THYAO:XIST': { price: '300' },
          'TRY/USD': { price: '0.03' },
        }),
      }
    })
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'secret' }, { fetchImpl, now: () => 1_800_000_000_000 })
    const first = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:XIST', quoteCurrency: 'TRY' }] })
    const second = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:XIST', quoteCurrency: 'TRY' }] })
    expect(first.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 9_000_000, nativePriceMicros: 300_000_000, cached: false })
    expect(second.prices[0].cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey secret')
  })

  it('searches the provider and returns only the requested market currency', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        data: [
          { symbol: 'THYAO', instrument_name: 'Turkish Airlines Inc.', exchange: 'BIST', mic_code: 'XIST', instrument_type: 'Common Stock', country: 'Turkey', currency: 'TRY' },
          { symbol: 'THYAO', instrument_name: 'Turkish Airlines ADR', exchange: 'OTC', instrument_type: 'ADR', country: 'United States', currency: 'USD' },
        ],
      }),
    }))
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const first = await service.search({ query: 'Turkish Airlines', quoteCurrency: 'TRY' })
    const second = await service.search({ query: 'Turkish Airlines', quoteCurrency: 'TRY' })

    expect(first.results).toEqual([expect.objectContaining({ symbol: 'THYAO', providerSymbol: 'THYAO:XIST', quoteCurrency: 'TRY' })])
    expect(second.cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey demo')
  })

  it('fails closed when no private provider key is configured', async () => {
    const service = createMarketPriceService({}, { fetchImpl: vi.fn() })
    await expect(service.refresh({ items: [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'USD' }] })).rejects.toMatchObject({ code: 'market-price-not-configured', statusCode: 503 })
  })
})
