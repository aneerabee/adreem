import { describe, expect, it, vi } from 'vitest'
import { createMarketPriceService, marketPriceItemsForHoldings, normalizeMarketPriceRequest, normalizeMarketSearchRequest } from './marketPrices.js'

function ecbPayload(date = '2027-01-15', tryDate = date) {
  const dates = tryDate === date ? [date] : [tryDate, date]
  return {
    structure: {
      dimensions: {
        series: [{ id: 'FREQ', values: [{ id: 'D' }] }, { id: 'CURRENCY', values: [{ id: 'TRY' }, { id: 'USD' }] }],
        observation: [{ id: 'TIME_PERIOD', values: dates.map((id) => ({ id })) }],
      },
    },
    dataSets: [{ series: { '0:0': { observations: { 0: [40] } }, '0:1': { observations: { [dates.length - 1]: [1.2] } } } }],
  }
}

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

  it('does not accept an asset type supplied by the browser for a trusted holding', () => {
    const state = { investmentHoldings: [{ id: 'stock', symbol: 'AAPL', exchange: 'NASDAQ', assetType: 'stock', quoteCurrency: 'USD' }] }
    expect(marketPriceItemsForHoldings({ ids: ['stock'], assetType: 'crypto' }, state)[0].assetType).toBe('stock')
  })

  it('requests direct metal symbols without a commodity exchange suffix', () => {
    const state = { investmentHoldings: [{ id: 'gold', symbol: 'XAU/USD', exchange: 'COMMODITY', providerSymbol: 'XAU/USD:COMMODITY', assetType: 'metal', quoteCurrency: 'USD', status: 'active' }] }
    expect(marketPriceItemsForHoldings({ ids: ['gold'] }, state)).toEqual([{ id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' }])
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
          'THYAO:BIST': { close: '300', last_quote_at: 1_800_000_000, is_market_open: false },
          'TRY/USD': { close: '0.03', last_quote_at: 1_800_000_000 },
        }),
      }
    })
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'secret' }, { fetchImpl, now: () => 1_800_000_000_000 })
    const first = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    const second = await service.refresh({ items: [{ id: 'holding-1', providerSymbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    expect(first.prices[0]).toMatchObject({
      ok: true, priceUsdMicros: 9_000_000, nativePriceMicros: 300_000_000,
      quotedAt: '2027-01-15T08:00:00.000Z', fxQuotedAt: '2027-01-15T08:00:00.000Z',
      marketOpen: false, cached: false,
    })
    expect(second.prices[0].cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/quote')
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

  it('keeps Turkish BIST stocks and funds selectable in the TRY market', async () => {
    const providerResults = [
      { symbol: 'THYAO', instrument_name: 'Turkish Airlines Inc.', exchange: 'BIST', mic_code: 'XIST', instrument_type: 'Common Stock', country: 'Turkey', currency: 'TRY' },
      { symbol: 'ISMDL', instrument_name: 'İş Portföy BIST 100 Endeksi Model Portföy Hisse Senedi Yoğun Borsa Yatırım Fonu', exchange: 'BIST', mic_code: 'XIST', instrument_type: 'ETF', country: 'Turkey', currency: 'TRY' },
      { symbol: 'AAPL', instrument_name: 'Apple Inc.', exchange: 'NASDAQ', mic_code: 'XNAS', instrument_type: 'Common Stock', country: 'United States', currency: 'USD' },
    ]
    const service = createMarketPriceService({}, {
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', data: providerResults }) })),
    })

    const stock = await service.search({ query: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock' })
    const fund = await service.search({ query: 'BIST 100', quoteCurrency: 'TRY', assetType: 'fund' })

    expect(stock.results).toEqual([expect.objectContaining({ providerSymbol: 'THYAO:BIST', assetType: 'stock', quoteCurrency: 'TRY' })])
    expect(fund.results).toEqual([expect.objectContaining({ providerSymbol: 'ISMDL:BIST', assetType: 'fund', quoteCurrency: 'TRY' })])
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
    expect(metal.results).toEqual([expect.objectContaining({ symbol: 'XAU/USD', providerSymbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' })])
  })

  it('uses the provider demo access for direct refresh when no private key is configured', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ close: '125.50', last_quote_at: 1_800_000_000 }) }))
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'USD' }] })

    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 125_500_000 })
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey demo')
  })

  it('requests a fresh confirmed price for a manual update instead of reusing the short cache', async () => {
    let price = 125
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ close: String(price++), last_quote_at: 1_800_000_000 }) }))
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const items = [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'USD' }]

    expect((await service.refresh({ items })).prices[0]).toMatchObject({ priceUsdMicros: 125_000_000, cached: false })
    expect((await service.refresh({ items })).prices[0]).toMatchObject({ priceUsdMicros: 125_000_000, cached: true })
    expect((await service.refresh({ items, force: true })).prices[0]).toMatchObject({ priceUsdMicros: 126_000_000, cached: false })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('isolates unsupported demo symbols without blocking confirmed prices', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbols = new URL(url).searchParams.get('symbol')
      if (symbols === 'AAPL') return { ok: true, status: 200, json: async () => ({ close: '125.50', last_quote_at: 1_800_000_000 }) }
      return { ok: false, status: 401, json: async () => ({ status: 'error', message: 'not available' }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })

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

  it('reports missing market access without replacing a stored price', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) }))
    const service = createMarketPriceService({}, { fetchImpl })
    const result = await service.refresh({ items: [{ id: 'turkish-stock', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })

    expect(result.prices[0]).toMatchObject({ id: 'turkish-stock', ok: false, error: expect.stringMatching(/مفتاح/) })
  })

  it('isolates a restricted market from working stocks and metals with a configured key', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbols = new URL(url).searchParams.get('symbol')
      if (symbols === 'AAPL:NASDAQ') return { ok: true, status: 200, json: async () => ({ close: '210', last_quote_at: 1_800_000_000 }) }
      if (symbols === 'XAU/USD') return { ok: true, status: 200, json: async () => ({ close: '2700', last_quote_at: 1_800_000_000 }) }
      return { ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) }
    })
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'configured-key' }, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [
      { id: 'stock', symbol: 'AAPL:NASDAQ', quoteCurrency: 'USD' },
      { id: 'turkey', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' },
      { id: 'metal', symbol: 'XAU/USD', quoteCurrency: 'USD' },
    ] })

    expect(result.prices).toEqual([
      expect.objectContaining({ id: 'stock', ok: true, priceUsdMicros: 210_000_000 }),
      expect.objectContaining({ id: 'turkey', ok: false, error: expect.stringMatching(/الاشتراك/) }),
      expect.objectContaining({ id: 'metal', ok: true, priceUsdMicros: 2_700_000_000 }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('converts Binance USDT prices using a separately confirmed USD quote', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.binance.vision') {
        expect(endpoint.pathname).toBe('/api/v3/trades')
        expect(endpoint.searchParams.get('symbol')).toBe('FETUSDT')
        return { ok: true, status: 200, json: async () => [{ price: '0.17480000', time: 1_800_000_000_000 }] }
      }
      if (endpoint.hostname === 'api.exchange.coinbase.com') {
        expect(endpoint.pathname).toBe('/products/USDT-USD/ticker')
        return { ok: true, status: 200, json: async () => ({ price: '0.99', time: '2027-01-15T08:00:00Z' }) }
      }
      return { ok: false, status: 401, json: async () => ({ status: 'error', message: 'not available' }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })

    const item = { id: 'fet', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' }
    const first = await service.refresh({ items: [item] })
    const second = await service.refresh({ items: [item] })

    expect(first.prices[0]).toMatchObject({
      id: 'fet',
      ok: true,
      priceUsdMicros: 173_052,
      nativePriceMicros: 173_052,
      source: 'binance-usdt+coinbase-usdt-usd',
      quotedAt: '2027-01-15T08:00:00.000Z',
      cached: false,
    })
    expect(second.prices[0]).toMatchObject({ ok: true, cached: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares the confirmed USDT conversion between simultaneous Binance holdings', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.binance.vision') return { ok: true, json: async () => [{ price: '2', time: 1_800_000_000_000 }] }
      if (endpoint.hostname === 'api.exchange.coinbase.com') return { ok: true, json: async () => ({ price: '0.99', time: '2027-01-15T08:00:00Z' }) }
      throw new Error('unexpected provider')
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [
      { id: 'first', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' },
      { id: 'second', symbol: 'BTC/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' },
    ] })
    expect(result.prices.every((item) => item.ok && item.priceUsdMicros === 1_980_000)).toBe(true)
    expect(fetchImpl.mock.calls.filter(([url]) => new URL(url).hostname === 'api.exchange.coinbase.com')).toHaveLength(1)
  })

  it('uses a verified second USDT conversion source when Coinbase is unavailable', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.binance.vision') return { ok: true, json: async () => [{ price: '2', time: 1_800_000_000_000 }] }
      if (endpoint.hostname === 'api.exchange.coinbase.com') return { ok: false, status: 503, json: async () => ({}) }
      if (endpoint.searchParams.get('symbol') === 'USDT/USD') return { ok: true, json: async () => ({ close: '0.98', last_quote_at: 1_800_000_000 }) }
      throw new Error('unexpected provider')
    })
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'configured-key' }, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'coin', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 1_960_000, source: 'binance-usdt+twelve-data-usdt-usd' })
  })

  it('uses the selected Coinbase USD market directly with its trade time', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(new URL(url).pathname).toBe('/products/BTC-USD/ticker')
      return { ok: true, json: async () => ({ price: '85000.25', time: '2027-01-15T08:00:00.123456Z' }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'btc', symbol: 'BTC/USD:COINBASE PRO', quoteCurrency: 'USD', assetType: 'crypto' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 85_000_250_000, quotedAt: '2027-01-15T08:00:00.123Z', source: 'coinbase' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses a verified direct USD metal price with the matching symbol and timestamp', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(new URL(url).pathname).toBe('/price/XAU')
      return { ok: true, json: async () => ({ symbol: 'XAU', currency: 'USD', price: 2700.5, updatedAt: '2027-01-15T08:00:00Z' }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 2_700_500_000, quotedAt: '2027-01-15T08:00:00.000Z', source: 'gold-api' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('ignores a wrong or old metal quote and keeps the previous provider as a fallback', async () => {
    const fetchImpl = vi.fn(async (url) => new URL(url).hostname === 'api.gold-api.com'
      ? { ok: true, json: async () => ({ symbol: 'XAG', currency: 'USD', price: 2700, updatedAt: '2027-01-15T08:00:00Z' }) }
      : { ok: true, json: async () => ({ close: '2699', last_quote_at: 1_800_000_000 }) })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 2_699_000_000, source: 'twelve-data' })
  })

  it('refuses a stale Coinbase price instead of presenting it as current', async () => {
    const fetchImpl = vi.fn(async (url) => new URL(url).hostname === 'api.exchange.coinbase.com'
      ? { ok: true, json: async () => ({ price: '85000', time: '2027-01-15T07:00:00Z' }) }
      : { ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'btc', symbol: 'BTC/USD:COINBASE', quoteCurrency: 'USD', assetType: 'crypto' }] })
    expect(result.prices[0].ok).toBe(false)
  })

  it('uses an ECB daily reference rate only when the provider FX quote is unavailable', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.ecb.europa.eu') return { ok: true, json: async () => ecbPayload() }
      return { ok: true, json: async () => ({ 'THYAO:BIST': { close: '300', last_quote_at: 1_800_000_000, is_market_open: false } }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'turkish', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, nativePriceMicros: 300_000_000, priceUsdMicros: 9_000_000, source: 'twelve-data+ecb-fx', fxQuotedAt: '2027-01-15T00:00:00.000Z' })
  })

  it('converts a EUR-priced holding using the same-day ECB USD reference rate', async () => {
    const fetchImpl = vi.fn(async (url) => new URL(url).hostname === 'data-api.ecb.europa.eu'
      ? { ok: true, json: async () => ecbPayload() }
      : { ok: true, json: async () => ({ 'EURO:MARKET': { close: '100', last_quote_at: 1_800_000_000 } }) })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'euro', symbol: 'EURO:MARKET', quoteCurrency: 'EUR' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, nativePriceMicros: 100_000_000, priceUsdMicros: 120_000_000, source: 'twelve-data+ecb-fx' })
  })

  it('recovers a native TRY price when a combined request fails on restricted FX', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.ecb.europa.eu') return { ok: true, json: async () => ecbPayload() }
      if (endpoint.searchParams.get('symbol') === 'THYAO:BIST') return { ok: true, json: async () => ({ close: '300', last_quote_at: 1_800_000_000 }) }
      return { ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'turkish', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    expect(result.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 9_000_000, source: 'twelve-data+ecb-fx' })
  })

  it('does not convert with a stale ECB rate', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.ecb.europa.eu') return { ok: true, json: async () => ecbPayload('2026-12-31') }
      return { ok: true, json: async () => ({ 'THYAO:BIST': { close: '300', last_quote_at: 1_800_000_000 } }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'turkish', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    expect(result.prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/تحويل العملة/) })
  })

  it('refuses to cross-convert ECB rates from different dates', async () => {
    const fetchImpl = vi.fn(async (url) => new URL(url).hostname === 'data-api.ecb.europa.eu'
      ? { ok: true, json: async () => ecbPayload('2027-01-15', '2027-01-14') }
      : { ok: true, json: async () => ({ 'THYAO:BIST': { close: '300', last_quote_at: 1_800_000_000 } }) })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'turkish', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })
    expect(result.prices[0].ok).toBe(false)
  })

  it('fetches ECB rates once when simultaneous holdings need the same conversion', async () => {
    const fetchImpl = vi.fn(async (url) => new URL(url).hostname === 'data-api.ecb.europa.eu'
      ? { ok: true, json: async () => ecbPayload() }
      : { ok: true, json: async () => ({
        'THYAO:BIST': { close: '300', last_quote_at: 1_800_000_000 },
        'ASELS:BIST': { close: '100', last_quote_at: 1_800_000_000 },
      }) })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [
      { id: 'first', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' },
      { id: 'second', symbol: 'ASELS:BIST', quoteCurrency: 'TRY' },
    ] })
    expect(result.prices.every((item) => item.ok)).toBe(true)
    expect(fetchImpl.mock.calls.filter(([url]) => new URL(url).hostname === 'data-api.ecb.europa.eu')).toHaveLength(1)
  })

  it('does not equate Binance USDT to USD when Coinbase returns an unverified rate', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const endpoint = new URL(url)
      if (endpoint.hostname === 'data-api.binance.vision') return { ok: true, json: async () => [{ price: '1.5', time: 1_800_000_000_000 }] }
      if (endpoint.hostname === 'api.exchange.coinbase.com') return { ok: true, json: async () => ({ price: '1', time: '2027-01-14T00:00:00Z' }) }
      return { ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) }
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'coin', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' }] })
    expect(result.prices[0].ok).toBe(false)
  })

  it('does not mistake a USDT quote for USD when no conversion source is configured', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ status: 'error', code: 401 }) }))
    const service = createMarketPriceService({}, { fetchImpl })
    const result = await service.refresh({ items: [{ id: 'fet', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD' }] })

    expect(result.prices[0]).toMatchObject({ ok: false })
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).hostname === 'api.twelvedata.com')).toBe(true)
  })

  it('rejects a stale FX quote rather than valuing a TRY stock in USD incorrectly', async () => {
    const now = 1_800_000_000_000
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'THYAO:BIST': { close: '300', last_quote_at: now / 1_000 },
        'TRY/USD': { close: '0.03', last_quote_at: now / 1_000 - 8 * 24 * 60 * 60 },
      }),
    }))
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'configured-key' }, { fetchImpl, now: () => now })
    const result = await service.refresh({ items: [{ id: 'holding-1', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })

    expect(result.prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/تحويل العملة قديم/) })
  })

  it('rejects a market quote without its own trade timestamp', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ close: '200', is_market_open: true }) }))
    const service = createMarketPriceService({}, { fetchImpl, now: () => 1_800_000_000_000 })
    const result = await service.refresh({ items: [{ id: 'stock', symbol: 'AAPL', quoteCurrency: 'USD' }] })

    expect(result.prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/توقيت مؤكد/) })
  })

  it('rejects an old quote while open and a long-abandoned closed-market quote', async () => {
    const now = 1_800_000_000_000
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        AAPL: { close: '200', last_quote_at: now / 1_000 - 3 * 60 * 60, is_market_open: true },
        'XAU/USD': { close: '2700', last_quote_at: now / 1_000 - 8 * 24 * 60 * 60, is_market_open: false },
      }),
    }))
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'configured-key' }, { fetchImpl, now: () => now })
    const result = await service.refresh({ items: [
      { id: 'stock', symbol: 'AAPL', quoteCurrency: 'USD' },
      { id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD' },
    ] })

    expect(result.prices).toEqual([
      expect.objectContaining({ id: 'stock', ok: false }),
      expect.objectContaining({ id: 'gold', ok: false }),
    ])
  })

  it('rejects an old FX rate while that market is open', async () => {
    const now = 1_800_000_000_000
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'THYAO:BIST': { close: '300', last_quote_at: now / 1_000, is_market_open: false },
        'TRY/USD': { close: '0.03', last_quote_at: now / 1_000 - 3 * 60 * 60, is_market_open: true },
      }),
    }))
    const service = createMarketPriceService({ TWELVE_DATA_API_KEY: 'configured-key' }, { fetchImpl, now: () => now })
    const result = await service.refresh({ items: [{ id: 'turkish-stock', symbol: 'THYAO:BIST', quoteCurrency: 'TRY' }] })

    expect(result.prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/تحويل العملة قديم/) })
  })

  it('does not treat a non-Binance or malformed crypto venue as a Binance ticker', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ status: 'error' }) }))
    const service = createMarketPriceService({}, { fetchImpl })

    const result = await service.refresh({ items: [
      { id: 'coinbase', symbol: 'FET/USD:COINBASE', quoteCurrency: 'USD' },
      { id: 'invalid-base', symbol: 'FET-BAD/USD:BINANCE', quoteCurrency: 'USD' },
    ] })

    expect(result.prices).toEqual([
      expect.objectContaining({ id: 'coinbase', ok: false }),
      expect.objectContaining({ id: 'invalid-base', ok: false }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).hostname === 'api.twelvedata.com')).toBe(true)
  })
})
