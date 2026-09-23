import { describe, expect, it, vi } from 'vitest'
import { isAutoPricedHolding } from '../../src/ledger/investmentMarketPolicy.js'
import { createMarketPriceService, marketPriceItemsForHoldings, normalizeMarketPriceRequest, normalizeMarketSearchRequest } from './marketPrices.js'

const NOW = 1_800_000_000_000
const licensedEnv = { TWELVE_DATA_API_KEY: 'private-key', ADREEM_TWELVE_STOCK_DISPLAY_LICENSED: 'true' }
const stock = { id: 'apple', symbol: 'AAPL:NASDAQ', quoteCurrency: 'USD', assetType: 'stock' }
const turkish = { id: 'turkish', symbol: 'THYAO:BIST', quoteCurrency: 'TRY', assetType: 'stock' }
const burkutEnv = { ADREEM_BURKUT_API_KEY: 'private-burkut-key' }
const burkutStock = { id: 'turkish', symbol: 'THYAO:BURKUT', quoteCurrency: 'TRY', assetType: 'stock' }
const burkutFund = { id: 'fund', symbol: 'TI2:BURKUT', quoteCurrency: 'TRY', assetType: 'fund' }

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

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
  it('rejects duplicate holdings, invalid symbols and unsupported currencies', () => {
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'AAPL' }, { id: 'a', symbol: 'MSFT' }] })).toThrow(/مكرر/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: '<bad>' }] })).toThrow(/غير صالح/)
    expect(() => normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'AAPL', quoteCurrency: 'GBP' }] })).toThrow(/غير مدعومة/)
    expect(normalizeMarketPriceRequest({ items: [{ id: 'a', symbol: 'BTC/USD:Coinbase Pro' }] })[0].symbol).toBe('BTC/USD:COINBASE PRO')
  })

  it('takes symbols, types and manual mode only from the authenticated ledger', () => {
    const state = { investmentHoldings: [
      { id: 'stock', symbol: 'AAPL', exchange: 'NASDAQ', providerSymbol: 'AAPL:XNAS', quoteCurrency: 'USD', assetType: 'stock', status: 'active' },
      { id: 'manual', symbol: 'THYAO', providerSymbol: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock', marketDataMode: 'manual', status: 'active' },
    ] }
    expect(marketPriceItemsForHoldings({ ids: ['stock'], assetType: 'crypto', symbol: 'ATTACKER' }, state)).toEqual([
      { id: 'stock', symbol: 'AAPL:NASDAQ', quoteCurrency: 'USD', assetType: 'stock' },
    ])
    expect(marketPriceItemsForHoldings({ ids: ['manual'], marketDataMode: 'provider' }, state)[0].marketDataMode).toBe('manual')
    expect(() => marketPriceItemsForHoldings({ ids: ['outside-ledger'] }, state)).toThrow(/غير موجود/)
  })

  it('keeps direct metal symbols without an exchange suffix', () => {
    const state = { investmentHoldings: [{ id: 'gold', symbol: 'XAU/USD', exchange: 'COMMODITY', providerSymbol: 'XAU/USD:COMMODITY', assetType: 'metal', quoteCurrency: 'USD', status: 'active' }] }
    expect(marketPriceItemsForHoldings({ ids: ['gold'] }, state)).toEqual([{ id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' }])
  })

  it('validates searches and uses a small local reference catalog without external calls', async () => {
    expect(() => normalizeMarketSearchRequest({ query: '!' })).toThrow(/حرفين/)
    expect(normalizeMarketSearchRequest({ query: 'F', quoteCurrency: 'USD', assetType: 'stock' }).query).toBe('F')
    expect(() => normalizeMarketSearchRequest({ query: 'Apple', quoteCurrency: 'GBP' })).toThrow(/غير مدعومة/)
    const fetchImpl = vi.fn()
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    expect((await service.search({ query: 'بيتكوين', assetType: 'crypto', quoteCurrency: 'USD' })).results)
      .toEqual([expect.objectContaining({ symbol: 'BTC/USD', assetType: 'crypto' })])
    expect((await service.search({ query: 'gold', assetType: 'metal', quoteCurrency: 'USD' })).results)
      .toEqual([expect.objectContaining({ symbol: 'XAU/USD', assetType: 'metal' })])
    expect(await service.search({ query: 'THYAO', assetType: 'stock', quoteCurrency: 'TRY' }))
      .toMatchObject({ results: [], mode: 'manual' })
    expect(await service.search({ query: 'BTC', assetType: 'crypto', quoteCurrency: 'TRY' }))
      .toMatchObject({ results: [], mode: 'manual' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses licensed stock search only after key and display-right gate are enabled', async () => {
    const fetchImpl = vi.fn(async () => response({ data: [
      { symbol: 'THYAO', instrument_name: 'Turkish Airlines', exchange: 'BIST', instrument_type: 'Common Stock', currency: 'TRY' },
      { symbol: 'THYAO', instrument_name: 'Turkish Airlines ADR', exchange: 'OTC', instrument_type: 'ADR', currency: 'USD' },
      { symbol: 'ISMDL', instrument_name: 'BIST Fund', exchange: 'BIST', instrument_type: 'ETF', currency: 'TRY' },
    ] }))
    const service = createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW })
    const first = await service.search({ query: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock' })
    const cached = await service.search({ query: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock' })
    const fund = await service.search({ query: 'ISMDL', quoteCurrency: 'TRY', assetType: 'fund' })
    expect(first.results).toEqual([expect.objectContaining({ providerSymbol: 'THYAO:BIST', assetType: 'stock' })])
    expect(cached.cached).toBe(true)
    expect(fund.results).toEqual([expect.objectContaining({ providerSymbol: 'ISMDL:BIST', assetType: 'fund' })])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('apikey private-key')
  })

  it('searches Turkish stocks and funds from Bürküt without exposing the key', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      const path = new URL(url).pathname
      expect(options.headers['X-API-Key']).toBe('private-burkut-key')
      return response({ data: path.endsWith('/stocks')
        ? [{ symbol: 'THYAO', name: 'Turkish Airlines', instrumentType: 'STOCK', price: 300 }]
        : [{ symbol: 'TI2', code: 'TI2', name: 'BIST 30 Fund', instrumentType: 'FUND', price: 0.1253 }] })
    })
    const service = createMarketPriceService(burkutEnv, { fetchImpl, now: () => NOW })
    expect(await service.search({ query: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock' }))
      .toMatchObject({ mode: 'provider', results: [expect.objectContaining({ providerSymbol: 'THYAO:BURKUT', quoteCurrency: 'TRY' })] })
    expect(await service.search({ query: 'TI2', quoteCurrency: 'TRY', assetType: 'fund' }))
      .toMatchObject({ mode: 'provider', results: [expect.objectContaining({ providerSymbol: 'TI2:BURKUT', assetType: 'fund' })] })
    expect(isAutoPricedHolding({ ...burkutStock, providerSymbol: burkutStock.symbol, marketDataMode: 'provider' })).toBe(true)
    expect(isAutoPricedHolding({ ...turkish, providerSymbol: turkish.symbol, marketDataMode: 'provider' })).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('prices Turkish investments from a shared catalog and keeps the verified ECB conversion', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const path = new URL(url).pathname
      if (path.endsWith('/stocks')) return response({ data: [{ symbol: 'THYAO', instrumentType: 'STOCK', price: 300, stale: false, freshness: 'FRESH', updatedAt: '2027-01-15T07:00:00Z' }] })
      if (path.endsWith('/funds')) return response({ data: [{ symbol: 'TI2', code: 'TI2', instrumentType: 'FUND', price: 0.1253, stale: false, freshness: 'FRESH', updatedAt: '2027-01-15T07:00:00Z' }] })
      return response(ecbPayload())
    })
    const service = createMarketPriceService(burkutEnv, { fetchImpl, now: () => NOW })
    const first = await service.refresh({ items: [burkutStock, burkutFund] })
    expect(first.prices).toEqual([
      expect.objectContaining({ ok: true, nativePriceMicros: 300_000_000, priceUsdMicros: 9_000_000, source: 'burkut+ecb-fx' }),
      expect.objectContaining({ ok: true, nativePriceMicros: 125_300, priceUsdMicros: 3_759, source: 'burkut+ecb-fx' }),
    ])
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/public/v1/stocks', '/service/data/EXR/D.USD+TRY.EUR.SP00.A', '/api/public/v1/funds',
    ])
    expect((await service.refresh({ items: [burkutStock] })).prices[0]).toMatchObject({ cached: true })
  })

  it('shares concurrent catalog reads and limits forced refreshes to protect the monthly quota', async () => {
    let currentTime = NOW
    const fetchImpl = vi.fn(async (url) => new URL(url).pathname.endsWith('/stocks')
      ? response({ data: [{ symbol: 'THYAO', name: 'Turkish Airlines', instrumentType: 'STOCK', price: 300,
        stale: false, freshness: 'FRESH', updatedAt: '2027-01-15T07:00:00Z' }] })
      : response(ecbPayload()))
    const service = createMarketPriceService(burkutEnv, { fetchImpl, now: () => currentTime })
    await Promise.all([
      service.search({ query: 'THYAO', quoteCurrency: 'TRY', assetType: 'stock' }),
      service.search({ query: 'Turkish', quoteCurrency: 'TRY', assetType: 'stock' }),
    ])
    const stockCalls = () => fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/stocks')).length
    expect(stockCalls()).toBe(1)
    expect((await service.refresh({ items: [burkutStock], force: true })).prices[0].ok).toBe(true)
    expect(stockCalls()).toBe(1)
    currentTime += 61_000
    expect((await service.refresh({ items: [burkutStock], force: true })).prices[0].ok).toBe(true)
    expect(stockCalls()).toBe(2)
  })

  it('rejects mismatched, stale, untimed and malformed Turkish provider prices', async () => {
    const valid = { symbol: 'THYAO', instrumentType: 'STOCK', price: 300, stale: false, freshness: 'FRESH', updatedAt: '2027-01-15T07:00:00Z' }
    for (const invalid of [
      { ...valid, symbol: 'ASELS' }, { ...valid, instrumentType: 'FUND' }, { ...valid, price: -1 },
      { ...valid, stale: true }, { ...valid, freshness: 'STALE' }, { ...valid, updatedAt: '' },
      { ...valid, updatedAt: '2026-12-01T10:00:00Z' },
    ]) {
      const fetchImpl = vi.fn(async () => response({ data: [invalid] }))
      const result = await createMarketPriceService(burkutEnv, { fetchImpl, now: () => NOW }).refresh({ items: [burkutStock] })
      expect(result.prices[0].ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps old prices on provider failure and never sends Bürküt symbols to Twelve Data', async () => {
    for (const status of [401, 429, 502]) {
      const fetchImpl = vi.fn(async () => response({}, status))
      const service = createMarketPriceService({ ...burkutEnv, ...licensedEnv }, { fetchImpl, now: () => NOW })
      const result = await service.refresh({ items: [burkutStock] })
      expect(result.prices[0].ok).toBe(false)
      expect(fetchImpl.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['api.burkutportfoy.com'])
    }
    const fetchImpl = vi.fn()
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    expect((await service.refresh({ items: [burkutStock] })).prices[0]).toMatchObject({ ok: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never tries a demo stock request, even if a display flag exists without a key', async () => {
    const fetchImpl = vi.fn()
    const service = createMarketPriceService({ ADREEM_TWELVE_STOCK_DISPLAY_LICENSED: 'true' }, { fetchImpl, now: () => NOW })
    expect((await service.refresh({ items: [stock] })).prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/يدوي/) })
    expect((await service.search({ query: 'Apple Inc.', quoteCurrency: 'USD', assetType: 'stock' })).mode).toBe('daily-close')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('finds an exact US ticker and refreshes only its verified daily close', async () => {
    const payload = { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', price: { lastClose: 190.25, lastCloseDate: '2027-01-14' } }
    const fetchImpl = vi.fn(async () => response(payload))
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    const search = await service.search({ query: 'AAPL', quoteCurrency: 'USD', assetType: 'stock' })
    expect(search).toMatchObject({ mode: 'daily-close', results: [expect.objectContaining({ providerSymbol: 'AAPL:TGM', name: 'Apple Inc.' })] })
    const holding = { id: 'apple', symbol: 'AAPL', providerSymbol: 'AAPL:TGM', exchange: '', quoteCurrency: 'USD', assetType: 'stock', status: 'active', marketDataMode: 'provider' }
    expect(marketPriceItemsForHoldings({ ids: ['apple'] }, { investmentHoldings: [holding] })[0].symbol).toBe('AAPL:TGM')
    const first = await service.refresh({ items: [{ id: 'apple', symbol: 'AAPL:TGM', quoteCurrency: 'USD', assetType: 'stock' }] })
    const cached = await service.refresh({ items: [{ id: 'apple', symbol: 'AAPL:TGM', quoteCurrency: 'USD', assetType: 'stock' }] })
    expect(first.prices[0]).toMatchObject({ ok: true, priceUsdMicros: 190_250_000, nativePriceMicros: 190_250_000, quotedAt: '2027-01-14T00:00:00.000Z', source: 'tgmcharts-eod', marketOpen: false })
    expect(cached.prices[0]).toMatchObject({ ok: true, cached: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).pathname === '/api/v1/summary/AAPL')).toBe(true)
  })

  it('refreshes legacy US holdings without changing their stored exchange symbols', async () => {
    const holding = { id: 'ford', symbol: 'F', providerSymbol: 'F:NYSE', exchange: 'NYSE', quoteCurrency: 'USD', assetType: 'stock', status: 'active' }
    const payload = { symbol: 'F', name: 'Ford Motor Company', currency: 'USD', price: { lastClose: 12.5, lastCloseDate: '2027-01-14' } }
    const fetchImpl = vi.fn(async () => response(payload))
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    const state = { investmentHoldings: [holding] }
    expect(isAutoPricedHolding(holding)).toBe(true)
    const items = marketPriceItemsForHoldings({ ids: [holding.id] }, state)
    expect(items).toEqual([{ id: 'ford', symbol: 'F:TGM', quoteCurrency: 'USD', assetType: 'stock' }])
    expect((await service.refresh({ items })).prices[0]).toMatchObject({ ok: true, priceUsdMicros: 12_500_000, source: 'tgmcharts-eod' })
    expect(holding.providerSymbol).toBe('F:NYSE')
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).pathname === '/api/v1/summary/F')).toBe(true)
    expect(await service.search({ query: 'F', quoteCurrency: 'USD', assetType: 'stock' }))
      .toMatchObject({ results: [expect.objectContaining({ providerSymbol: 'F:TGM' })] })
  })

  it('does not redirect non-US, mismatched or manual holdings to the US close source', async () => {
    const fixtures = [
      { symbol: 'F', providerSymbol: 'F:BIST', exchange: 'BIST', quoteCurrency: 'TRY', assetType: 'stock' },
      { symbol: 'F', providerSymbol: 'F:NYSE', exchange: 'NYSE', quoteCurrency: 'EUR', assetType: 'stock' },
      { symbol: 'FCX', providerSymbol: 'F:NYSE', exchange: 'NYSE', quoteCurrency: 'USD', assetType: 'stock' },
      { symbol: 'F', providerSymbol: 'F:NYSE', exchange: 'NASDAQ', quoteCurrency: 'USD', assetType: 'stock' },
      { symbol: 'F', providerSymbol: 'F:NYSE', exchange: 'NYSE', quoteCurrency: 'USD', assetType: 'stock', marketDataMode: 'manual' },
    ]
    const fetchImpl = vi.fn()
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    for (const [index, holding] of fixtures.entries()) {
      const state = { investmentHoldings: [{ ...holding, id: String(index), status: 'active' }] }
      const [item] = marketPriceItemsForHoldings({ ids: [String(index)] }, state)
      expect(item.symbol).not.toBe('F:TGM')
      expect((await service.refresh({ items: [item] })).prices[0].ok).toBe(false)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects mismatched, stale, missing or wrong-currency US closing prices', async () => {
    const valid = { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', price: { lastClose: 190.25, lastCloseDate: '2027-01-14' } }
    const invalid = [
      { ...valid, symbol: 'MSFT' },
      { ...valid, currency: 'EUR' },
      { ...valid, price: { ...valid.price, lastClose: -1 } },
      { ...valid, price: { ...valid.price, lastCloseDate: '2026-12-01' } },
      { ...valid, price: { ...valid.price, lastCloseDate: '' } },
    ]
    for (const payload of invalid) {
      const service = createMarketPriceService({}, { fetchImpl: async () => response(payload), now: () => NOW })
      expect((await service.refresh({ items: [{ id: 'apple', symbol: 'AAPL:TGM', quoteCurrency: 'USD', assetType: 'stock' }] })).prices[0].ok).toBe(false)
      expect((await service.search({ query: 'AAPL', quoteCurrency: 'USD', assetType: 'stock' })).results).toEqual([])
    }
  })

  it('does not price manual US holdings or mistake a fund for a stock', async () => {
    const payload = { symbol: 'SPY', name: 'SPDR S&P 500 ETF', currency: 'USD', price: { lastClose: 700, lastCloseDate: '2027-01-14' } }
    const fetchImpl = vi.fn(async () => response(payload))
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    expect((await service.search({ query: 'SPY', quoteCurrency: 'USD', assetType: 'stock' })).results).toEqual([])
    expect((await service.search({ query: 'SPY', quoteCurrency: 'USD', assetType: 'fund' })).results)
      .toEqual([expect.objectContaining({ providerSymbol: 'SPY:TGM', assetType: 'fund' })])
    expect((await service.refresh({ items: [{ id: 'manual', symbol: 'SPY:TGM', quoteCurrency: 'USD', assetType: 'fund', marketDataMode: 'manual' }] })).prices[0].ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps US price failures isolated when the free source has no symbol or is rate-limited', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404))
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    expect((await service.search({ query: 'ZZZZ', quoteCurrency: 'USD', assetType: 'stock' })).results).toEqual([])
    expect((await service.refresh({ items: [{ id: 'missing', symbol: 'ZZZZ:TGM', quoteCurrency: 'USD', assetType: 'stock' }] })).prices[0].ok).toBe(false)
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).hostname === 'tgmcharts.com')).toBe(true)
    const limited = createMarketPriceService({}, { fetchImpl: vi.fn(async () => response({}, 429)), now: () => NOW })
    expect((await limited.refresh({ items: [{ id: 'apple', symbol: 'AAPL:TGM', quoteCurrency: 'USD', assetType: 'stock' }] })).prices[0].ok).toBe(false)
  })

  it('refreshes US stock quotes with confirmed timestamps only when licensed', async () => {
    const fetchImpl = vi.fn(async () => response({ close: '190.25', timestamp: NOW / 1000, is_market_open: true }))
    const service = createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW })
    const first = await service.refresh({ items: [stock] })
    const cached = await service.refresh({ items: [stock] })
    expect(first.prices[0]).toMatchObject({ ok: true, nativePriceMicros: 190_250_000, priceUsdMicros: 190_250_000, source: 'twelve-data', marketOpen: true })
    expect(cached.prices[0].cached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not accept an untimed, stale or malformed US quote', async () => {
    const fixtures = [{ close: '190' }, { close: '190', timestamp: (NOW - 3 * 60 * 60 * 1000) / 1000, is_market_open: true }, { close: '-1', timestamp: NOW / 1000 }]
    for (const payload of fixtures) {
      const service = createMarketPriceService(licensedEnv, { fetchImpl: async () => response(payload), now: () => NOW })
      expect((await service.refresh({ items: [stock] })).prices[0].ok).toBe(false)
    }
  })

  it('does not fan out authentication or rate-limit failures into more provider requests', async () => {
    for (const code of [401, 403, 429]) {
      const fetchImpl = vi.fn(async () => response({ status: 'error', code }, code))
      const service = createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW })
      const result = await service.refresh({ items: [stock, { ...stock, id: 'microsoft', symbol: 'MSFT:NASDAQ' }] })
      expect(result.prices.every((item) => !item.ok)).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('uses Turkish daily close with same-source symbol and currency checks plus daily ECB FX', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (new URL(url).pathname === '/eod') return response({ symbol: 'THYAO', exchange: 'BIST', currency: 'TRY', datetime: '2027-01-15', close: '300' })
      return response(ecbPayload())
    })
    const service = createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW })
    const first = await service.refresh({ items: [turkish] })
    const cached = await service.refresh({ items: [turkish] })
    expect(first.prices[0]).toMatchObject({ ok: true, nativePriceMicros: 300_000_000, priceUsdMicros: 9_000_000, marketOpen: false, source: 'twelve-data-eod+ecb-fx' })
    expect(cached.prices[0]).toMatchObject({ cached: true, source: 'twelve-data-eod+ecb-fx' })
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/eod', '/service/data/EXR/D.USD+TRY.EUR.SP00.A'])
  })

  it('rejects wrong Turkish ticker, exchange, currency, date and missing FX without fallback', async () => {
    const invalid = [
      { symbol: 'ASELS', exchange: 'BIST', currency: 'TRY', datetime: '2027-01-15', close: '300' },
      { symbol: 'THYAO', exchange: 'NYSE', currency: 'TRY', datetime: '2027-01-15', close: '300' },
      { symbol: 'THYAO', exchange: 'BIST', currency: 'USD', datetime: '2027-01-15', close: '300' },
      { symbol: 'THYAO', exchange: 'BIST', currency: 'TRY', datetime: '2026-12-01', close: '300' },
    ]
    for (const payload of invalid) {
      const fetchImpl = vi.fn(async () => response(payload))
      const result = await createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW }).refresh({ items: [turkish] })
      expect(result.prices[0].ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
    const noFx = createMarketPriceService(licensedEnv, {
      now: () => NOW,
      fetchImpl: async (url) => response(new URL(url).pathname === '/eod'
        ? { symbol: 'THYAO', exchange: 'BIST', currency: 'TRY', datetime: '2027-01-15', close: '300' }
        : ecbPayload('2027-01-15', '2027-01-14')),
    })
    expect((await noFx.refresh({ items: [turkish] })).prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/تحويل العملة/) })
  })

  it('uses an ECB daily USD reference for EUR stocks when native FX is missing', async () => {
    const item = { id: 'euro', symbol: 'SAP:XETR', quoteCurrency: 'EUR', assetType: 'stock' }
    const fetchImpl = vi.fn(async (url) => {
      const path = new URL(url).pathname
      if (path.startsWith('/service/data/')) return response(ecbPayload())
      if (path === '/quote') return response({ 'SAP:XETR': { close: '100', timestamp: NOW / 1000, is_market_open: false }, 'EUR/USD': { status: 'error' } })
      throw new Error('unexpected source')
    })
    const result = await createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW }).refresh({ items: [item] })
    expect(result.prices[0]).toMatchObject({ ok: true, nativePriceMicros: 100_000_000, priceUsdMicros: 120_000_000, source: 'twelve-data+ecb-fx' })
  })

  it('uses only a validated free reference price for supported USD crypto and metals', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const symbol = new URL(url).pathname.split('/').at(-1)
      return response({ symbol, currency: 'USD', price: symbol === 'BTC' ? 80_000 : 2_700, updatedAt: '2027-01-15T08:00:00Z' })
    })
    const service = createMarketPriceService({}, { fetchImpl, now: () => NOW })
    const result = await service.refresh({ items: [
      { id: 'bitcoin', symbol: 'BTC/USD:COINBASE', quoteCurrency: 'USD', assetType: 'crypto' },
      { id: 'gold', symbol: 'XAU/USD', quoteCurrency: 'USD', assetType: 'metal' },
    ] })
    expect(result.prices).toEqual([
      expect.objectContaining({ ok: true, source: 'gold-api-reference', priceUsdMicros: 80_000_000_000 }),
      expect.objectContaining({ ok: true, source: 'gold-api', priceUsdMicros: 2_700_000_000 }),
    ])
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname).sort()).toEqual(['/price/BTC', '/price/XAU'])
  })

  it('keeps old prices on a bad or stale reference response without trying another source', async () => {
    for (const payload of [
      { symbol: 'ETH', currency: 'USD', price: 80_000, updatedAt: '2027-01-15T08:00:00Z' },
      { symbol: 'BTC', currency: 'TRY', price: 80_000, updatedAt: '2027-01-15T08:00:00Z' },
      { symbol: 'BTC', currency: 'USD', price: 80_000, updatedAt: '2027-01-14T08:00:00Z' },
    ]) {
      const fetchImpl = vi.fn(async () => response(payload))
      const result = await createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW }).refresh({ items: [{ id: 'bitcoin', symbol: 'BTC/USD', quoteCurrency: 'USD', assetType: 'crypto' }] })
      expect(result.prices[0].ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('never auto-prices manual or unsupported crypto, even if a matching price is cached', async () => {
    const fetchImpl = vi.fn(async () => response({ symbol: 'BTC', currency: 'USD', price: 80_000, updatedAt: '2027-01-15T08:00:00Z' }))
    const service = createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW })
    expect((await service.refresh({ items: [{ id: 'auto', symbol: 'BTC/USD', quoteCurrency: 'USD', assetType: 'crypto' }] })).prices[0].ok).toBe(true)
    const result = await service.refresh({ items: [
      { id: 'manual', symbol: 'BTC/USD', quoteCurrency: 'USD', assetType: 'crypto', marketDataMode: 'manual' },
      { id: 'unsupported', symbol: 'DOGE/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' },
      { id: 'usdt', symbol: 'USDT/USD', quoteCurrency: 'USD', assetType: 'crypto' },
    ] })
    expect(result.prices.every((item) => !item.ok && /يدوي/.test(item.error))).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('prices verified FET and AVAX contracts only when two liquid pools agree', async () => {
    const fetContract = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85'
    const avaxContract = '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'
    const pair = (chainId, address, symbol, priceUsd, liquidityUsd, pairAddress) => ({
      chainId, pairAddress, baseToken: { address, symbol }, priceUsd: String(priceUsd),
      liquidity: { usd: liquidityUsd }, volume: { h24: 100_000 },
      txns: { h1: { buys: 1, sells: 1 } },
    })
    const fetchImpl = vi.fn(async (url) => {
      const avax = new URL(url).pathname.includes('/avalanche/')
      const chain = avax ? 'avalanche' : 'ethereum'
      const contract = avax ? avaxContract : fetContract
      const symbol = avax ? 'WAVAX' : 'FET'
      const price = avax ? 10.75 : 0.2065
      return response([pair(chain, contract, symbol, price, 1_000_000, '0xprimary'), pair(chain, contract, symbol, price * 1.005, 200_000, '0xsecondary')])
    })
    const state = { investmentHoldings: [
      { id: 'fet', symbol: 'FET/USD', providerSymbol: 'FET/USD:BINANCE', exchange: 'BINANCE', quoteCurrency: 'USD', assetType: 'crypto', status: 'active' },
      { id: 'avax', symbol: 'AVAX/USD', providerSymbol: 'AVAX/USD:BINANCE', exchange: 'BINANCE', quoteCurrency: 'USD', assetType: 'crypto', status: 'active' },
    ] }
    const items = marketPriceItemsForHoldings({ ids: ['fet', 'avax'] }, state)
    expect(items.map((item) => item.symbol)).toEqual(['FET/USD:BINANCE', 'AVAX/USD:BINANCE'])
    const prices = (await createMarketPriceService({}, { fetchImpl, now: () => NOW }).refresh({ items })).prices
    expect(prices).toEqual([
      expect.objectContaining({ ok: true, priceUsdMicros: 206_500, source: 'dexscreener-reference' }),
      expect.objectContaining({ ok: true, priceUsdMicros: 10_750_000, source: 'dexscreener-reference' }),
    ])
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      `/token-pairs/v1/ethereum/${fetContract}`,
      `/token-pairs/v1/avalanche/${avaxContract}`,
    ])
    expect((await createMarketPriceService({}, { fetchImpl, now: () => NOW }).search({ query: 'AVAX', assetType: 'crypto' })).results)
      .toEqual([expect.objectContaining({ symbol: 'AVAX/USD' })])
  })

  it('keeps prior crypto prices when pools disagree, are illiquid, or have no recent trades', async () => {
    const valid = { chainId: 'ethereum', pairAddress: '0xprimary', baseToken: { address: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85', symbol: 'FET' },
      priceUsd: '0.2', liquidity: { usd: 1_000_000 }, volume: { h24: 100_000 }, txns: { h1: { buys: 1, sells: 0 } } }
    const fixtures = [
      [valid],
      [valid, { ...valid, pairAddress: '0xsecondary', priceUsd: '0.25', liquidity: { usd: 200_000 } }],
      [{ ...valid, txns: { h1: { buys: 0, sells: 0 } } }, { ...valid, pairAddress: '0xsecondary', liquidity: { usd: 200_000 } }],
      [valid, { ...valid, pairAddress: '0xsecondary', baseToken: { ...valid.baseToken, address: '0xFAKE' }, liquidity: { usd: 200_000 } }],
      [valid, { ...valid, liquidity: { usd: 200_000 } }],
    ]
    for (const payload of fixtures) {
      const result = await createMarketPriceService({}, { fetchImpl: async () => response(payload), now: () => NOW })
        .refresh({ items: [{ id: 'fet', symbol: 'FET/USD:BINANCE', quoteCurrency: 'USD', assetType: 'crypto' }] })
      expect(result.prices[0]).toMatchObject({ ok: false, error: expect.stringMatching(/بقي السعر السابق محفوظ/) })
    }
  })

  it('preserves failures separately from valid quotes in mixed batches', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (new URL(url).pathname === '/price/BTC') return response({ symbol: 'BTC', currency: 'USD', price: 80_000, updatedAt: '2027-01-15T08:00:00Z' })
      return response({ close: '190', timestamp: NOW / 1000, is_market_open: true })
    })
    const result = await createMarketPriceService(licensedEnv, { fetchImpl, now: () => NOW }).refresh({ items: [
      stock,
      { id: 'bitcoin', symbol: 'BTC/USD', quoteCurrency: 'USD', assetType: 'crypto' },
      { id: 'manual', symbol: 'SAP', quoteCurrency: 'EUR', assetType: 'stock', marketDataMode: 'manual' },
    ] })
    expect(result.prices.map((item) => item.ok)).toEqual([true, true, false])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
