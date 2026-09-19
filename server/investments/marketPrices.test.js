import { describe, expect, it, vi } from 'vitest'
import { createMarketPriceService, marketPriceItemsForHoldings, normalizeMarketPriceRequest, normalizeMarketSearchRequest } from './marketPrices.js'

describe('investment market prices', () => {
  it('rejects duplicate holdings and invalid symbols', () => {
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'AAPL' }, { id: 'a', symbol: 'MSFT' }] })).toThrow(/مكرر/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: '<bad>' }] })).toThrow(/غير صالح/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'BAD SYMBOL' }] })).toThrow(/غير صالح/)
    expect(normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'BTC/USD:Coinbase Pro' }] })[0].symbol).toBe('BTC/USD:COINBASE PRO')
  })

  it('resolves price requests only from holdings in the authenticated ledger', () => {
    const state = { investmentHoldings: [{ id: 'holding-1', symbol: 'AAPL', exchange: 'NASDAQ', providerSymbol: 'AAPL:XNAS', quoteCurrency: 'USD', status: 'active' }] }
    expect(marketPriceItemsForHoldings({ ids: ['holding-1'] }, state)).toEqual([
      { id: 'holding-1', symbol: 'AAPL:NASDAQ', quoteCurrency: 'USD' },
    ])
    expect(() => marketPriceItemsForHoldings({ ids: ['outside-ledger'] }, state)).toThrow(/غير موجود/)
  })

  it('normalizes market searches with an explicit quote currency', () => {
    expect(normalizeMarketSearchRequest({ query: '  Turkish   Airlines ', quoteCurrency: 'TRY', assetType: 'stock' }))
      .toEqual({ query: 'Turkish Airlines', quoteCurrency: 'TRY', assetType: 'stock' })
    expect(() => normalizeMarketSearchRequest({ query: 'A' })).toThrow(/حرفين/)
    expect(() => normalizeMarketSearchRequest({ query: 'Apple', quoteCurrency: 'GBP' })).toThrow(/غير مدعومة/)
    expect(() => normalizeMarketSearchRequest({ query: 'Apple', assetType: 'bond' })).toThrow(/غير مدعوم/)
  })

  it('batches assets and FX and converts TRY quoted prices to USD', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbols = new URL(url).searchParams.get('symbol')
      expect(symbols).toContain('THYAO:BIST')
      expect(symbols).toContain('TRY/USD')
      return {
        ok: true,
        json: async () => ({
          'THYAO:BIST': { price: '300' },
          'TRY/USD': { price: '0.03' },
        }),
      }
    })
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'secret' }, { fetchImpl, now: () => 1_800_000_000_000 })
    const first = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    const second = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
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
    const first = await service.search({ query: 'Turkish Airlines', quoteCurrency: 'TRY', assetType: 'stock' })
    const second = await service.search({ query: 'Turkish Airlines', quoteCurrency: 'TRY', assetType: 'stock' })

    expect(first.results).toEqual([expect.objectContaining({ symbol: 'THYAO', providerSymbol: 'THYAO:BIST', quoteCurrency: 'TRY' })])
    expect(second.cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey demo')
  })

  it('keeps direct stocks separate from funds and prefers trusted crypto exchanges', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        data: [
          { symbol: 'BTC/USD', instrument_name: 'Bitcoin', exchange: 'Small Exchange', instrument_type: 'Digital Currency', country: 'Global', currency: 'USD' },
          { symbol: 'BTC/USD', instrument_name: 'Bitcoin', exchange: 'Kraken', instrument_type: 'Digital Currency', country: 'Global', currency: 'USD' },
          { symbol: 'BTCX/USD', instrument_name: 'Bitcoin X', exchange: 'Binance', instrument_type: 'Digital Currency', country: 'Global', currency: 'USD' },
          { symbol: 'BTC/USD', instrument_name: 'Bitcoin Fund', exchange: 'NASDAQ', instrument_type: 'ETF', country: 'United States', currency: 'USD' },
          { symbol: 'BTCX', instrument_name: 'Bitcoin Company', exchange: 'NASDAQ', instrument_type: 'Common Stock', country: 'United States', currency: 'USD' },
        ],
      }),
    }))
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })

    const crypto = await service.search({ query: 'Bitcoin', quoteCurrency: 'USD', assetType: 'crypto' })
    const stock = await service.search({ query: 'Bitcoin', quoteCurrency: 'USD', assetType: 'stock' })

    expect(crypto.results).toEqual([
      expect.objectContaining({ providerSymbol: 'BTC/USD:KRAKEN', assetType: 'crypto', exchange: 'KRAKEN' }),
    ])
    expect(stock.results).toEqual([
      expect.objectContaining({ providerSymbol: 'BTCX:NASDAQ', assetType: 'stock' }),
    ])
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('symbol')).toBe('BTC')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not fall back to an untrusted crypto exchange', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        data: [
          { symbol: 'BTC/USD', instrument_name: 'Bitcoin', exchange: 'Unknown Venue', instrument_type: 'Digital Currency', country: 'Global', currency: 'USD' },
        ],
      }),
    }))
    const service = createMarketPriceService({}, { fetchImpl })

    const result = await service.search({ query: 'Bitcoin', quoteCurrency: 'USD', assetType: 'crypto' })

    expect(result.results).toEqual([])
  })

  it('derives direct crypto and metal quote currencies from provider symbols', async () => {
    const providerResults = [
      { symbol: 'BTC/USD', instrument_name: 'Bitcoin US Dollar', exchange: 'Coinbase Pro', mic_code: 'DIGITAL_CURRENCY', instrument_type: 'Digital Currency', currency: '' },
      { symbol: 'XAU/USD', instrument_name: 'Gold US Dollar', exchange: 'COMMODITY', mic_code: 'COMMODITY', instrument_type: 'Precious Metal', currency: '' },
      { symbol: 'XAU/EUR', instrument_name: 'Gold Euro', exchange: 'COMMODITY', mic_code: 'COMMODITY', instrument_type: 'Precious Metal', currency: 'USD' },
    ]
    const service = createMarketPriceService({}, {
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', data: providerResults }) })),
    })

    const crypto = await service.search({ query: 'BTC', quoteCurrency: 'USD', assetType: 'crypto' })
    const metal = await service.search({ query: 'XAU', quoteCurrency: 'USD', assetType: 'metal' })

    expect(crypto.results).toEqual([expect.objectContaining({ symbol: 'BTC/USD', quoteCurrency: 'USD', assetType: 'crypto' })])
    expect(metal.results).toEqual([expect.objectContaining({ symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' })])
  })

  it('uses the provider demo access for direct refresh when no private key is configured', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ price: '125.50' }) }))
    const service = createMarketPriceService({}, { fetchImpl })
    const result = await service.refresh({ items: [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'USD' }] })

    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 125_500_000 })
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey demo')
  })

  it('isolates unsupported demo symbols without blocking confirmed prices', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbols = new URL(url).searchParams.get('symbol')
      if (symbols === 'AAPL') return { ok: true, status: 200, json: async () => ({ price: '125.50' }) }
      return { ok: false, status: 401, json: async () => ({ status: 'error', message: 'not available' }) }
    })
    const service = createMarketPriceService({}, { fetchImpl })

    const result = await service.refresh({ items: [
      { id: 'confirmed', symbol: 'AAPL', quoteCurrency: 'USD' },
      { id: 'missing', symbol: 'UNKNOWN', quoteCurrency: 'USD' },
    ] })

    expect(result.prices).toEqual([
      expect.objectContaining({ id: 'confirmed', ok: true, priceUsdMicros: 125_500_000 }),
      expect.objectContaining({ id: 'missing', ok: false }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
