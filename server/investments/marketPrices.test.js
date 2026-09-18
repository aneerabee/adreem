import { describe, expect, it, vi } from 'vitest'
import { createMarketPriceService, normalizeMarketPriceRequest } from './marketPrices.js'

describe('investment market prices', () => {
  it('rejects duplicate holdings and invalid symbols', () => {
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'AAPL' }, { id: 'a', symbol: 'MSFT' }] })).toThrow(/مكرر/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: '<bad>' }] })).toThrow(/غير صالح/)
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
  })

  it('fails closed when no private provider key is configured', async () => {
    const service = createMarketPriceService({}, { fetchImpl: vi.fn() })
    await expect(service.refresh({ items: [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'USD' }] })).rejects.toMatchObject({ code: 'market-price-not-configured', statusCode: 503 })
  })
})
