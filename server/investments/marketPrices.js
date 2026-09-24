import { REFERENCE_CRYPTO_SYMBOLS, burkutSymbolForHolding, coinGeckoIdForHolding, coinGeckoProviderSymbol, dexReferenceSymbol, freeReferenceSymbol, isAutoPricedHolding, isTgmEodHolding, tgmEodSymbolForHolding } from '../../src/ledger/investmentMarketPolicy.js'

const DEFAULT_TWELVE_DATA_URL = 'https://api.twelvedata.com'
const DEFAULT_GOLD_DATA_URL = 'https://api.gold-api.com'
const DEFAULT_TGM_DATA_URL = 'https://tgmcharts.com'
const DEFAULT_DEX_DATA_URL = 'https://api.dexscreener.com'
const DEFAULT_BURKUT_DATA_URL = 'https://api.burkutportfoy.com/api/public/v1'
const DEFAULT_COINGECKO_URL = 'https://api.coingecko.com/api/v3'
const ECB_FX_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+TRY.EUR.SP00.A?lastNObservations=1&format=jsondata'
const DEFAULT_CACHE_MS = 5 * 60 * 1000
const MAX_QUOTE_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_OPEN_MARKET_QUOTE_AGE_MS = 2 * 60 * 60 * 1000
const MAX_FX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const TGM_EOD_CACHE_MS = 2 * 60 * 60 * 1000
const BURKUT_CATALOG_CACHE_MS = 2 * 60 * 60 * 1000
const BURKUT_FORCE_COOLDOWN_MS = 60 * 1000
const MAX_CRYPTO_QUOTE_AGE_MS = 15 * 60 * 1000
const MIN_DEX_PRIMARY_LIQUIDITY_USD = 500_000
const MIN_DEX_SECONDARY_LIQUIDITY_USD = 100_000
const MIN_DEX_DAILY_VOLUME_USD = 10_000
const MAX_DEX_PRICE_DEVIATION = 0.03
const MIN_CRYPTO_DAILY_VOLUME_USD = 10_000
const LATIN_SEARCH_PATTERN = /^[\p{Script=Latin}0-9 .'_-]+$/u
const DEX_TOKENS = {
  FET: { chain: 'ethereum', contract: '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85', symbol: 'FET' },
  AVAX: { chain: 'avalanche', contract: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', symbol: 'WAVAX' },
}
const MAX_PRICE_ITEMS = 40
const MAX_CACHE_ENTRIES = 500
const MAX_SEARCH_RESULTS = 15
const MAX_SEARCH_CANDIDATES = 120
const SUPPORTED_MARKET_CURRENCIES = new Set(['USD', 'TRY', 'EUR'])
const SUPPORTED_ASSET_TYPES = new Set(['stock', 'crypto', 'metal', 'fund', 'other'])
const PROVIDER_SYMBOL_PATTERN = /^[A-Z0-9./_-]+(?::[A-Z0-9._ -]+)?$/
const DIRECT_STOCK_TYPES = new Set(['COMMON STOCK', 'PREFERRED STOCK'])
const FUND_TYPES = new Set(['ETF', 'MUTUAL FUND', 'BOND FUND', 'CLOSED-END FUND'])
const FREE_REFERENCE_ASSETS = [
  { symbol: 'BTC/USD', name: 'Bitcoin', assetType: 'crypto', aliases: 'bitcoin بيتكوين btc' },
  { symbol: 'ETH/USD', name: 'Ethereum', assetType: 'crypto', aliases: 'ethereum ether إيثيريوم ايثيريوم eth' },
  { symbol: 'FET/USD', name: 'Artificial Superintelligence Alliance', assetType: 'crypto', aliases: 'fet fetch ai asi' },
  { symbol: 'AVAX/USD', name: 'Avalanche', assetType: 'crypto', aliases: 'avax avalanche' },
  { symbol: 'XAU/USD', name: 'Gold', assetType: 'metal', aliases: 'gold ذهب xau' },
  { symbol: 'XAG/USD', name: 'Silver', assetType: 'metal', aliases: 'silver فضة xag' },
  { symbol: 'XPT/USD', name: 'Platinum', assetType: 'metal', aliases: 'platinum بلاتين xpt' },
  { symbol: 'XPD/USD', name: 'Palladium', assetType: 'metal', aliases: 'palladium بلاديوم xpd' },
]

export class MarketPriceError extends Error {
  constructor(message, statusCode = 502, code = 'market-price-failed') {
    super(message)
    this.name = 'MarketPriceError'
    this.statusCode = statusCode
    this.code = code
  }
}
function cleanSymbol(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 80)
}

function cleanCurrency(value) {
  const currency = cleanSymbol(value)
  return SUPPORTED_MARKET_CURRENCIES.has(currency) ? currency : ''
}

function marketResultCurrency(item = {}) {
  const symbolParts = cleanSymbol(item.symbol).split('/')
  if (symbolParts.length === 2) return cleanCurrency(symbolParts[1])
  return cleanCurrency(item.currency)
}

function cleanSearchText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80)
}

function providerSymbolForHolding(holding = {}) {
  const symbol = cleanSymbol(holding.symbol)
  const exchange = cleanSymbol(holding.exchange)
  const burkutSymbol = burkutSymbolForHolding(holding)
  if (burkutSymbol) return burkutSymbol
  if (/:CG-/.test(cleanSymbol(holding.providerSymbol))) return coinGeckoIdForHolding(holding) ? cleanSymbol(holding.providerSymbol) : ''
  if (isTgmEodHolding(holding)) return tgmEodSymbolForHolding(holding)
  if (holding.assetType === 'metal' || ['COMMODITY', 'FOREX', 'FX'].includes(exchange)) return symbol || cleanSymbol(holding.providerSymbol).split(':')[0]
  if (symbol && exchange && !symbol.includes(':')) return `${symbol}:${exchange}`
  return cleanSymbol(holding.providerSymbol || symbol)
}

function cleanAssetType(value) {
  const assetType = String(value || '').trim().toLocaleLowerCase('en')
  return SUPPORTED_ASSET_TYPES.has(assetType) ? assetType : ''
}

function marketResultAssetType(item = {}) {
  const instrumentType = cleanSearchText(item.instrument_type).toUpperCase()
  const symbol = cleanSymbol(item.symbol)
  if (instrumentType === 'DIGITAL CURRENCY') return 'crypto'
  if (['PHYSICAL CURRENCY', 'PRECIOUS METAL'].includes(instrumentType) && /^(XAU|XAG|XPT|XPD)\//.test(symbol)) return 'metal'
  if (DIRECT_STOCK_TYPES.has(instrumentType)) return 'stock'
  if (FUND_TYPES.has(instrumentType)) return 'fund'
  return 'other'
}

function resultMatchesAssetType(item, assetType) {
  if (assetType === 'other') return true
  return marketResultAssetType(item) === assetType
}

function cacheSet(cache, key, value, limit = MAX_CACHE_ENTRIES) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) cache.delete(cache.keys().next().value)
}

function pruneExpired(cache, currentTime) {
  for (const [key, value] of cache) {
    if (!value || value.expiresAt <= currentTime) cache.delete(key)
  }
}

function quoteTime(candidate, currentTime) {
  for (const value of [candidate?.last_quote_at, candidate?.timestamp]) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) continue
    const millis = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric
    if (millis < Date.UTC(2000, 0, 1) || millis > currentTime + MAX_QUOTE_CLOCK_SKEW_MS) continue
    return new Date(millis).toISOString()
  }
  return null
}

function isoQuoteTime(value, currentTime) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || millis < Date.UTC(2000, 0, 1) || millis > currentTime + MAX_QUOTE_CLOCK_SKEW_MS) return null
  return new Date(millis).toISOString()
}

function ecbRatesFromPayload(payload, currentTime) {
  const dimensions = payload?.structure?.dimensions
  const currencyIndex = dimensions?.series?.findIndex((item) => item.id === 'CURRENCY') ?? -1
  const currencies = dimensions?.series?.[currencyIndex]?.values
  const periods = dimensions?.observation?.find((item) => item.id === 'TIME_PERIOD')?.values
  const series = payload?.dataSets?.[0]?.series
  if (currencyIndex < 0 || !Array.isArray(currencies) || !Array.isArray(periods) || !series) return null
  const rates = new Map()
  for (const [seriesKey, data] of Object.entries(series)) {
    const currency = currencies[Number(seriesKey.split(':')[currencyIndex])]?.id
    const [periodIndex, observation] = Object.entries(data?.observations || {})[0] || []
    const date = periods[Number(periodIndex)]?.id
    const price = Number(observation?.[0])
    const quotedAt = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? isoQuoteTime(`${date}T00:00:00Z`, currentTime) : null
    if (['USD', 'TRY'].includes(currency) && Number.isFinite(price) && price > 0 && quotedAt && !quoteIsStale({ quotedAt }, currentTime, MAX_FX_QUOTE_AGE_MS)) {
      rates.set(currency, { price, quotedAt, date })
    }
  }
  return rates
}

function quoteFromPayload(payload, symbol, singleSymbol, currentTime) {
  const candidate = singleSymbol ? payload : payload?.[symbol]
  const price = Number(candidate?.close ?? candidate?.price)
  if (candidate?.status === 'error' || !Number.isFinite(price) || price <= 0) return null
  return {
    price,
    quotedAt: quoteTime(candidate, currentTime),
    marketOpen: typeof candidate?.is_market_open === 'boolean' ? candidate.is_market_open : null,
  }
}

function quoteIsStale(quote, currentTime, maxAgeMs) {
  return !quote?.quotedAt || currentTime - new Date(quote.quotedAt).getTime() > maxAgeMs
}

function priceFailureMessage(payload) {
  const code = Number(payload?.code || payload?.statusCode || 0)
  if (code === 429) return 'بلغ مزود الأسعار حد الطلبات. بقي السعر السابق محفوظًا.'
  if (code === 401 || code === 403) return 'مفتاح مزود الأسعار غير صالح أو الاشتراك لا يتيح هذا السوق.'
  return 'السعر غير متاح لهذا الرمز. بقي السعر السابق محفوظًا.'
}

function usdMicros(value) {
  const micros = Math.round(Number(value) * 1_000_000)
  return Number.isSafeInteger(micros) && micros > 0 ? micros : 0
}

export function normalizeMarketPriceRequest(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) throw new MarketPriceError('اختر استثمارًا واحدًا على الأقل.', 400, 'empty-price-request')
  if (rawItems.length > MAX_PRICE_ITEMS) throw new MarketPriceError(`يمكن تحديث ${MAX_PRICE_ITEMS} استثمارًا في المرة الواحدة.`, 400, 'too-many-price-items')
  const ids = new Set()
  return rawItems.map((item) => {
    const id = String(item?.id || '').trim().slice(0, 160)
    const symbol = cleanSymbol(item?.providerSymbol || item?.symbol)
    const quoteCurrency = cleanCurrency(item?.quoteCurrency || 'USD')
    if (!id || ids.has(id)) throw new MarketPriceError('معرف الاستثمار ناقص أو مكرر.', 400, 'invalid-price-item')
    if (!symbol || !PROVIDER_SYMBOL_PATTERN.test(symbol)) throw new MarketPriceError('رمز السعر غير صالح.', 400, 'invalid-price-symbol')
    if (!quoteCurrency) throw new MarketPriceError('عملة السوق غير مدعومة.', 400, 'invalid-market-currency')
    ids.add(id)
    const assetType = cleanAssetType(item?.assetType)
    return { id, symbol, quoteCurrency, ...(assetType ? { assetType } : {}), ...(item?.marketDataMode === 'manual' ? { marketDataMode: 'manual' } : {}) }
  })
}

export function marketPriceItemsForHoldings(body = {}, state = {}) {
  const ids = Array.isArray(body.ids) ? body.ids.map((value) => String(value || '').trim()).filter(Boolean) : []
  if (!ids.length) throw new MarketPriceError('اختر استثمارًا واحدًا على الأقل.', 400, 'empty-price-request')
  if (ids.length > MAX_PRICE_ITEMS || new Set(ids).size !== ids.length) {
    throw new MarketPriceError('قائمة الاستثمارات غير صالحة.', 400, 'invalid-price-items')
  }
  const holdings = new Map((Array.isArray(state.investmentHoldings) ? state.investmentHoldings : [])
    .filter((holding) => holding?.id && holding.status !== 'inactive')
    .map((holding) => [String(holding.id), holding]))
  const items = ids.map((id) => {
    const holding = holdings.get(id)
    const providerSymbol = providerSymbolForHolding(holding)
    if (!holding || !providerSymbol) throw new MarketPriceError('أحد الاستثمارات غير موجود أو لا يملك مصدر سعر.', 400, 'unknown-price-item')
    return { id, providerSymbol, quoteCurrency: holding.quoteCurrency, assetType: holding.assetType, ...(holding.marketDataMode === 'manual' ? { marketDataMode: 'manual' } : {}) }
  })
  return normalizeMarketPriceRequest({ items })
}

export function normalizeMarketSearchRequest(body = {}) {
  const query = cleanSearchText(body.query)
  const quoteCurrency = cleanCurrency(body.quoteCurrency || 'USD')
  const assetType = cleanAssetType(body.assetType || 'stock')
  if (query.length < 2 && !(query.length === 1 && /^[A-Z]$/i.test(query) && quoteCurrency === 'USD' && ['stock', 'fund'].includes(assetType))) {
    throw new MarketPriceError('اكتب حرفين على الأقل للبحث.', 400, 'market-search-too-short')
  }
  if (!quoteCurrency) throw new MarketPriceError('عملة السوق غير مدعومة.', 400, 'invalid-market-currency')
  if (!assetType) throw new MarketPriceError('نوع الاستثمار غير مدعوم.', 400, 'invalid-market-asset-type')
  return { query, quoteCurrency, assetType }
}

export function createMarketPriceService(env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || (() => Date.now())
  const cacheMs = Math.max(10_000, Number(options.cacheMs || env.ADREEM_MARKET_PRICE_CACHE_MS || DEFAULT_CACHE_MS))
  const cache = new Map()
  const searchCache = new Map()
  let ecbFxCache = null
  let ecbFxPending = null
  let tryUsdRateCache = null
  const burkutCatalogs = new Map()
  const burkutPending = new Map()
  const burkutKey = String(env.ADREEM_BURKUT_API_KEY || '').trim()
  const licensedStocksEnabled = env.ADREEM_TWELVE_STOCK_DISPLAY_LICENSED === 'true'
    && Boolean(String(env.TWELVE_DATA_API_KEY || '').trim())

  function providerHeaders(apiKey) {
    return { accept: 'application/json', authorization: `apikey ${apiKey}` }
  }

  const coinGeckoKey = String(env.COINGECKO_API_KEY || '').trim()

  function coinGeckoEndpoint(path) {
    return new URL(`${String(env.ADREEM_COINGECKO_API_URL || DEFAULT_COINGECKO_URL).replace(/\/+$/, '')}${path}`)
  }

  function coinGeckoHeaders() {
    return coinGeckoKey ? { accept: 'application/json', 'x-cg-demo-api-key': coinGeckoKey } : { accept: 'application/json' }
  }

  async function fetchCoinGeckoPrices(items) {
    const coinIdByItem = new Map(items.map((item) => [item.id, coinGeckoIdForHolding(item)]))
    const endpoint = coinGeckoEndpoint('/simple/price')
    endpoint.searchParams.set('ids', [...new Set(coinIdByItem.values())].join(','))
    endpoint.searchParams.set('vs_currencies', 'usd')
    endpoint.searchParams.set('include_last_updated_at', 'true')
    endpoint.searchParams.set('include_24hr_vol', 'true')
    endpoint.searchParams.set('precision', 'full')
    let payload
    try {
      const response = await fetchImpl(endpoint, { headers: coinGeckoHeaders(), signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return items.map((item) => failedPrice(item, priceFailureMessage({ code: response.status })))
      payload = await response.json()
    } catch {
      return items.map((item) => failedPrice(item, 'مصدر أسعار العملات الرقمية غير متاح الآن. بقي السعر السابق محفوظًا.'))
    }
    return items.map((item) => {
      const quote = payload?.[coinIdByItem.get(item.id)]
      const price = Number(quote?.usd)
      const dailyVolume = Number(quote?.usd_24h_vol)
      const quotedAt = quoteTime({ timestamp: quote?.last_updated_at }, now())
      if (!Number.isFinite(price) || price <= 0) return failedPrice(item, 'السعر غير متاح لهذه العملة. بقي السعر السابق محفوظًا.')
      if (quoteIsStale({ quotedAt }, now(), MAX_CRYPTO_QUOTE_AGE_MS)) return failedPrice(item, 'سعر العملة قديم أو بلا توقيت مؤكد. بقي السعر السابق محفوظًا.')
      if (!Number.isFinite(dailyVolume) || dailyVolume < MIN_CRYPTO_DAILY_VOLUME_USD) {
        return failedPrice(item, 'تداول العملة ضعيف جدًا لتأكيد سعرها. بقي السعر السابق محفوظًا.')
      }
      const priceUsdMicros = usdMicros(price)
      if (!priceUsdMicros) return failedPrice(item, 'سعر العملة أصغر من دقة الحفظ. أدخل السعر يدويًا.')
      const result = {
        id: item.id,
        symbol: item.symbol,
        quoteCurrency: item.quoteCurrency,
        nativePriceMicros: priceUsdMicros,
        priceUsdMicros,
        refreshedAt: new Date(now()).toISOString(),
        quotedAt,
        fxQuotedAt: null,
        marketOpen: true,
        source: 'coingecko',
        cached: false,
        ok: true,
      }
      cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    })
  }

  async function searchCoinGecko(request) {
    const endpoint = coinGeckoEndpoint('/search')
    endpoint.searchParams.set('query', request.query)
    let response
    try {
      response = await fetchImpl(endpoint, { headers: coinGeckoHeaders(), signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new MarketPriceError('تعذر البحث عن العملات الرقمية الآن.', 502, 'crypto-search-network')
    }
    if (!response.ok) {
      const busy = response.status === 429
      throw new MarketPriceError(busy ? 'بحث العملات الرقمية مشغول الآن. حاول بعد دقيقة.' : 'لم يرجع مصدر العملات الرقمية نتائج مؤكدة.', busy ? 429 : 502, 'crypto-search-provider')
    }
    const payload = await response.json().catch(() => ({}))
    const seen = new Set()
    return (Array.isArray(payload?.coins) ? payload.coins : [])
      .filter((coin) => Number.isSafeInteger(coin?.market_cap_rank) && coin.market_cap_rank > 0)
      .sort((left, right) => left.market_cap_rank - right.market_cap_rank)
      .flatMap((coin) => {
        const providerSymbol = coinGeckoProviderSymbol(coin?.symbol, coin?.id)
        const name = cleanSearchText(coin?.name)
        if (!providerSymbol || !name || seen.has(providerSymbol)) return []
        const symbol = providerSymbol.split(':')[0]
        if (REFERENCE_CRYPTO_SYMBOLS.has(symbol.split('/')[0])) return []
        seen.add(providerSymbol)
        return [{
          id: providerSymbol,
          symbol,
          providerSymbol,
          name,
          exchange: '',
          micCode: '',
          instrumentType: 'Digital Currency',
          assetType: 'crypto',
          country: '',
          quoteCurrency: 'USD',
          marketCapRank: coin.market_cap_rank,
        }]
      })
      .slice(0, MAX_SEARCH_RESULTS)
  }

  async function fetchBurkutCatalog(assetType, force = false) {
    const cached = burkutCatalogs.get(assetType)
    if (cached && ((!force && cached.expiresAt > now()) || (force && now() - cached.fetchedAt < BURKUT_FORCE_COOLDOWN_MS))) return cached.items
    if (burkutPending.has(assetType)) return burkutPending.get(assetType)
    const pending = (async () => {
      const path = assetType === 'fund' ? 'funds' : 'stocks'
      const endpoint = new URL(`${String(env.ADREEM_BURKUT_API_URL || DEFAULT_BURKUT_DATA_URL).replace(/\/+$/, '')}/${path}`)
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json', 'X-API-Key': burkutKey }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) throw new MarketPriceError(priceFailureMessage({ code: response.status }), response.status, 'burkut-provider')
      const payload = await response.json()
      if (!Array.isArray(payload?.data)) throw new MarketPriceError('قائمة السوق غير صالحة. بقي السعر السابق محفوظًا.', 502, 'burkut-payload')
      burkutCatalogs.set(assetType, { items: payload.data, fetchedAt: now(), expiresAt: now() + BURKUT_CATALOG_CACHE_MS })
      return payload.data
    })()
    burkutPending.set(assetType, pending)
    try { return await pending } finally { burkutPending.delete(assetType) }
  }

  function burkutCode(item) {
    const match = /^([A-Z0-9.]{2,12}):BURKUT$/.exec(item.symbol)
    return item.quoteCurrency === 'TRY' && ['stock', 'fund'].includes(item.assetType) ? match?.[1] || '' : ''
  }

  async function fetchBurkutPrices(items, force = false) {
    const byType = new Map()
    for (const item of items) {
      if (!byType.has(item.assetType)) byType.set(item.assetType, [])
      byType.get(item.assetType).push(item)
    }
    const results = []
    for (const [assetType, group] of byType) {
      let catalog
      try { catalog = await fetchBurkutCatalog(assetType, force) } catch (error) {
        results.push(...group.map((item) => failedPrice(item, error?.message || 'تعذر الوصول إلى مزود الأسعار. بقي السعر السابق محفوظًا.')))
        continue
      }
      const rows = new Map(catalog.map((row) => [cleanSymbol(row.symbol || row.code), row]))
      for (const item of group) {
        const code = burkutCode(item)
        const row = rows.get(code)
        const price = Number(row?.price)
        const quotedAt = isoQuoteTime(row?.updatedAt, now())
        if (!code || !row || cleanSymbol(row.instrumentType) !== assetType.toUpperCase()
          || row.stale !== false || cleanSymbol(row.freshness) !== 'FRESH'
          || !Number.isFinite(price) || price <= 0 || quoteIsStale({ quotedAt }, now(), MAX_FX_QUOTE_AGE_MS)) {
          results.push(failedPrice(item, 'سعر المزود غير مؤكد لهذا الرمز. بقي السعر السابق محفوظًا.'))
          continue
        }
        const fx = await fetchEcbFxQuote('TRY')
        results.push(fx
          ? verifiedPrice(item, { price, quotedAt, marketOpen: false }, fx, 'burkut+ecb-fx')
          : failedPrice(item, 'سعر تحويل العملة غير متاح. بقي السعر السابق محفوظًا.'))
      }
    }
    return results
  }

  async function searchBurkut(request) {
    const catalog = await fetchBurkutCatalog(request.assetType)
    const query = request.query.toLocaleLowerCase('en')
    return catalog.filter((row) => {
      const code = cleanSymbol(row.symbol || row.code)
      return /^[A-Z0-9.]{2,12}$/.test(code)
        && cleanSymbol(row.instrumentType) === request.assetType.toUpperCase()
        && Boolean(cleanSearchText(row.name))
        && `${code} ${String(row.name || '')}`.toLocaleLowerCase('en').includes(query)
    }).slice(0, MAX_SEARCH_RESULTS).map((row) => {
      const symbol = cleanSymbol(row.symbol || row.code)
      return { id: `${symbol}:BURKUT:TRY`, symbol, providerSymbol: `${symbol}:BURKUT`,
        name: cleanSearchText(row.name), exchange: request.assetType === 'fund' ? 'TEFAS' : 'BIST', instrumentType: request.assetType === 'stock' ? 'Common Stock' : 'Fund',
        assetType: request.assetType, quoteCurrency: 'TRY' }
    })
  }

  async function fetchReferencePrice(item) {
    const referenceSymbol = freeReferenceSymbol(item)
    if (!referenceSymbol) return null
    const endpoint = new URL(`/price/${referenceSymbol}`, String(env.ADREEM_GOLD_API_URL || DEFAULT_GOLD_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const payload = await response.json()
      const price = Number(payload?.price)
      const quotedAt = isoQuoteTime(payload?.updatedAt, now())
      const maxAge = item.assetType === 'crypto' ? MAX_CRYPTO_QUOTE_AGE_MS : MAX_OPEN_MARKET_QUOTE_AGE_MS
      if (payload?.symbol !== referenceSymbol || payload?.currency !== 'USD' || !Number.isFinite(price) || price <= 0
        || quoteIsStale({ quotedAt }, now(), maxAge)) return null
      const priceUsdMicros = usdMicros(price)
      if (!priceUsdMicros) return null
      const result = {
        id: item.id,
        symbol: item.symbol,
        quoteCurrency: item.quoteCurrency,
        nativePriceMicros: priceUsdMicros,
        priceUsdMicros,
        refreshedAt: new Date(now()).toISOString(),
        quotedAt,
        fxQuotedAt: null,
        marketOpen: item.assetType === 'crypto' ? true : null,
        source: item.assetType === 'crypto' ? 'gold-api-reference' : 'gold-api',
        cached: false,
        ok: true,
      }
      cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    } catch {
      return null
    }
  }

  async function fetchDexReferencePrice(item) {
    const base = dexReferenceSymbol(item)
    const token = DEX_TOKENS[base]
    if (!token) return null
    const endpoint = new URL(`/token-pairs/v1/${token.chain}/${token.contract}`, String(env.ADREEM_DEX_API_URL || DEFAULT_DEX_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return failedPrice(item, 'تعذر تحديث السعر المرجعي. بقي السعر السابق محفوظًا.')
      const payload = await response.json()
      const seenPairs = new Set()
      const pairs = (Array.isArray(payload) ? payload : []).filter((pair) => {
        const address = String(pair?.pairAddress || '').toLowerCase()
        if (!address || seenPairs.has(address)) return false
        seenPairs.add(address)
        return (
        pair?.chainId === token.chain
        && String(pair.baseToken?.address || '').toLowerCase() === token.contract
        && pair.baseToken?.symbol === token.symbol
        && Number.isFinite(Number(pair.priceUsd)) && Number(pair.priceUsd) > 0
        && Number.isFinite(Number(pair.liquidity?.usd))
        )
      }).sort((left, right) => Number(right.liquidity.usd) - Number(left.liquidity.usd))
      const [primary, secondary] = pairs
      const primaryPrice = Number(primary?.priceUsd)
      const secondaryPrice = Number(secondary?.priceUsd)
      const hourlyTrades = Number(primary?.txns?.h1?.buys || 0) + Number(primary?.txns?.h1?.sells || 0)
      if (!primary || !secondary || Number(primary.liquidity.usd) < MIN_DEX_PRIMARY_LIQUIDITY_USD
        || Number(secondary.liquidity.usd) < MIN_DEX_SECONDARY_LIQUIDITY_USD
        || Number(primary.volume?.h24) < MIN_DEX_DAILY_VOLUME_USD || hourlyTrades < 1
        || Math.abs(primaryPrice - secondaryPrice) / primaryPrice > MAX_DEX_PRICE_DEVIATION) {
        return failedPrice(item, 'السعر المرجعي غير مؤكد من مجمعين نشطين. بقي السعر السابق محفوظًا.')
      }
      const priceUsdMicros = usdMicros(primaryPrice)
      if (!priceUsdMicros) return failedPrice(item, 'السعر المرجعي غير صالح. بقي السعر السابق محفوظًا.')
      const observedAt = new Date(now()).toISOString()
      const result = { id: item.id, symbol: item.symbol, quoteCurrency: item.quoteCurrency,
        nativePriceMicros: priceUsdMicros, priceUsdMicros, refreshedAt: observedAt, quotedAt: observedAt,
        fxQuotedAt: null, marketOpen: true, source: 'dexscreener-reference', cached: false, ok: true }
      cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    } catch {
      return failedPrice(item, 'تعذر الوصول إلى السعر المرجعي. بقي السعر السابق محفوظًا.')
    }
  }

  async function fetchEcbFxRates() {
    if (ecbFxCache && ecbFxCache.expiresAt > now()) return ecbFxCache.rates
    if (!ecbFxPending) {
      ecbFxPending = (async () => {
        try {
          const response = await fetchImpl(ECB_FX_URL, { headers: { accept: 'application/vnd.sdmx.data+json;version=1.0.0-wd' }, signal: AbortSignal.timeout(8_000) })
          if (!response.ok) return null
          return ecbRatesFromPayload(await response.json(), now())
        } catch {
          return null
        }
      })()
    }
    const rates = await ecbFxPending
    ecbFxPending = null
    ecbFxCache = { rates, expiresAt: now() + (rates?.size ? 60 * 60 * 1000 : 60_000) }
    return rates
  }

  async function fetchEcbFxQuote(currency) {
    const rates = await fetchEcbFxRates()
    const usd = rates?.get('USD')
    const quoted = currency === 'TRY' ? rates?.get('TRY') : usd
    if (!usd || !quoted || usd.date !== quoted.date) return null
    const price = currency === 'TRY' ? usd.price / quoted.price : usd.price
    return Number.isFinite(price) && price > 0 ? { price, quotedAt: quoted.quotedAt, marketOpen: false, source: 'ecb-fx' } : null
  }

  function failedPrice(item, error) {
    return { id: item.id, symbol: item.symbol, ok: false, error }
  }

  function verifiedPrice(item, nativeQuote, fxQuote, source = '') {
    const nativeAgeLimit = nativeQuote?.marketOpen === true ? MAX_OPEN_MARKET_QUOTE_AGE_MS : MAX_FX_QUOTE_AGE_MS
    if (quoteIsStale(nativeQuote, now(), nativeAgeLimit)) return failedPrice(item, 'سعر السوق قديم أو بلا توقيت مؤكد. بقي السعر السابق محفوظًا.')
    const fxAgeLimit = fxQuote?.marketOpen === true ? MAX_OPEN_MARKET_QUOTE_AGE_MS : MAX_FX_QUOTE_AGE_MS
    if (item.quoteCurrency !== 'USD' && quoteIsStale(fxQuote, now(), fxAgeLimit)) {
      return failedPrice(item, 'سعر تحويل العملة قديم أو بلا توقيت مؤكد. بقي السعر السابق محفوظًا.')
    }
    const nativePriceMicros = usdMicros(nativeQuote.price)
    const priceUsdMicros = usdMicros(nativeQuote.price * fxQuote.price)
    if (!nativePriceMicros || !priceUsdMicros) return failedPrice(item, 'السعر المستلم غير صالح.')
    const result = {
      id: item.id,
      symbol: item.symbol,
      quoteCurrency: item.quoteCurrency,
      nativePriceMicros,
      priceUsdMicros,
      refreshedAt: new Date(now()).toISOString(),
      quotedAt: nativeQuote.quotedAt,
      fxQuotedAt: fxQuote.quotedAt,
      marketOpen: nativeQuote.marketOpen,
      source: source || (fxQuote.source === 'ecb-fx' ? 'twelve-data+ecb-fx' : 'twelve-data'),
      cached: false,
      ok: true,
    }
    cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + (source === 'tgmcharts-eod' ? TGM_EOD_CACHE_MS : cacheMs), result })
    return result
  }

  async function fetchTgmEodPrice(item) {
    const ticker = item.symbol.slice(0, -4)
    const endpoint = new URL(`/api/v1/summary/${ticker}`, String(env.ADREEM_TGM_API_URL || DEFAULT_TGM_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return failedPrice(item, 'سعر الإغلاق غير متاح لهذا الرمز. بقي السعر السابق محفوظًا.')
      const payload = await response.json()
      const date = String(payload?.price?.lastCloseDate || '')
      const quotedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? isoQuoteTime(`${date}T00:00:00Z`, now()) : null
      const price = Number(payload?.price?.lastClose)
      if (cleanSymbol(payload?.symbol) !== ticker || cleanCurrency(payload?.currency) !== 'USD'
        || !Number.isFinite(price) || price <= 0 || quoteIsStale({ quotedAt }, now(), MAX_FX_QUOTE_AGE_MS)) {
        return failedPrice(item, 'سعر الإغلاق قديم أو لا يطابق الرمز والدولار. بقي السعر السابق محفوظًا.')
      }
      return verifiedPrice(item, { price, quotedAt, marketOpen: false }, { price: 1, quotedAt: null }, 'tgmcharts-eod')
    } catch {
      return failedPrice(item, 'تعذر الوصول إلى سعر الإغلاق. بقي السعر السابق محفوظًا.')
    }
  }

  async function searchTgmTicker(request) {
    const ticker = cleanSymbol(request.query)
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) return []
    const endpoint = new URL(`/api/v1/summary/${ticker}`, String(env.ADREEM_TGM_API_URL || DEFAULT_TGM_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (response.status === 404) return []
      if (!response.ok) throw new Error('provider unavailable')
      const payload = await response.json()
      const name = cleanSearchText(payload?.name)
      const fundName = /\b(?:ETF|FUND)\b/i.test(name)
      const typeMatches = request.assetType === 'fund' ? fundName : !fundName
      const price = Number(payload?.price?.lastClose)
      const date = String(payload?.price?.lastCloseDate || '')
      const quotedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? isoQuoteTime(`${date}T00:00:00Z`, now()) : null
      if (cleanSymbol(payload?.symbol) !== ticker || cleanCurrency(payload?.currency) !== 'USD'
        || !name || !typeMatches || !Number.isFinite(price) || price <= 0
        || quoteIsStale({ quotedAt }, now(), MAX_FX_QUOTE_AGE_MS)) return []
      return [{ id: `${ticker}:TGM:USD`, symbol: ticker, providerSymbol: `${ticker}:TGM`, name,
        exchange: '', instrumentType: request.assetType === 'fund' ? 'ETF' : 'Common Stock',
        assetType: request.assetType, quoteCurrency: 'USD' }]
    } catch {
      throw new MarketPriceError('تعذر التحقق من الرمز الأمريكي الآن.', 502, 'us-market-search-network')
    }
  }

  async function fetchTwelveNativeWithEcb(item, apiKey) {
    const endpoint = new URL('/quote', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', item.symbol)
    try {
      const response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const nativeQuote = quoteFromPayload(await response.json(), item.symbol, true, now())
      if (!nativeQuote) return null
      const fxQuote = await fetchEcbFxQuote(item.quoteCurrency)
      return fxQuote ? verifiedPrice(item, nativeQuote, fxQuote) : null
    } catch {
      return null
    }
  }

  async function fetchTwelveEodPrice(item) {
    const endpoint = new URL('/eod', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', item.symbol)
    try {
      const response = await fetchImpl(endpoint, {
        headers: providerHeaders(String(env.TWELVE_DATA_API_KEY || '').trim()),
        signal: AbortSignal.timeout(8_000),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.status === 'error') return failedPrice(item, priceFailureMessage({ ...payload, code: payload?.code || response.status }))
      const date = String(payload?.datetime || '')
      const quotedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? isoQuoteTime(`${date}T00:00:00Z`, now()) : null
      const price = Number(payload?.close)
      if (!quotedAt || !Number.isFinite(price) || price <= 0 || quoteIsStale({ quotedAt }, now(), MAX_FX_QUOTE_AGE_MS)) {
        return failedPrice(item, 'سعر الإغلاق قديم أو غير مؤكد. بقي السعر السابق محفوظًا.')
      }
      const payloadSymbol = cleanSymbol(payload?.symbol)
      const [baseSymbol, requestedExchange] = item.symbol.split(':')
      if (payload?.currency !== item.quoteCurrency || ![baseSymbol, item.symbol].includes(payloadSymbol)
        || (requestedExchange && payload?.exchange && cleanSymbol(payload.exchange) !== requestedExchange)) {
        return failedPrice(item, 'لم يتطابق رمز الإغلاق أو عملته. بقي السعر السابق محفوظًا.')
      }
      const fxQuote = await fetchEcbFxQuote(item.quoteCurrency)
      if (!fxQuote) return failedPrice(item, 'سعر تحويل العملة غير متاح. بقي السعر السابق محفوظًا.')
      return verifiedPrice(item, { price, quotedAt, marketOpen: false }, fxQuote, 'twelve-data-eod+ecb-fx')
    } catch {
      return failedPrice(item, 'تعذر الوصول إلى سعر الإغلاق. بقي السعر السابق محفوظًا.')
    }
  }

  async function fetchTwelvePrices(items) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
    const currencies = Array.from(new Set(items.map((item) => item.quoteCurrency).filter((currency) => currency !== 'USD')))
    const symbols = Array.from(new Set([...items.map((item) => item.symbol), ...currencies.map((currency) => `${currency}/USD`)]))
    const endpoint = new URL('/quote', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', symbols.join(','))
    let response
    try {
      response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new MarketPriceError('تعذر الوصول إلى مزود الأسعار. بقي السعر السابق محفوظًا.', 502, 'market-price-network')
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.status === 'error') {
      const providerCode = Number(payload?.code || response.status)
      if (items.length > 1 && ![401, 403, 429].includes(providerCode)) {
        const isolatedResults = []
        for (let offset = 0; offset < items.length; offset += 4) {
          const group = await Promise.all(items.slice(offset, offset + 4).map(async (item) => {
            try {
              return await fetchTwelvePrices([item])
            } catch (error) {
              return [failedPrice(item, error?.message || 'السعر غير متاح لهذا الرمز.')]
            }
          }))
          isolatedResults.push(...group.flat())
        }
        return isolatedResults
      }
      if (items.length === 1) {
        const item = items[0]
        if (item.quoteCurrency !== 'USD' && ![401, 403, 429].includes(providerCode)) {
          const recovered = await fetchTwelveNativeWithEcb(item, apiKey)
          if (recovered) return [recovered]
        }
      }
      return items.map((item) => failedPrice(item, priceFailureMessage({ ...payload, code: payload?.code || response.status })))
    }
    const singleSymbol = symbols.length === 1
    return Promise.all(items.map(async (item) => {
      const nativeQuote = quoteFromPayload(payload, item.symbol, singleSymbol, now())
      let fxQuote = item.quoteCurrency === 'USD'
        ? { price: 1, quotedAt: null }
        : quoteFromPayload(payload, `${item.quoteCurrency}/USD`, false, now())
      const fxAgeLimit = fxQuote?.marketOpen === true ? MAX_OPEN_MARKET_QUOTE_AGE_MS : MAX_FX_QUOTE_AGE_MS
      if (nativeQuote && item.quoteCurrency !== 'USD' && quoteIsStale(fxQuote, now(), fxAgeLimit)) {
        fxQuote = await fetchEcbFxQuote(item.quoteCurrency) || fxQuote
      }
      if (!nativeQuote) return failedPrice(item, priceFailureMessage(singleSymbol ? payload : payload?.[item.symbol]))
      if (!fxQuote) return failedPrice(item, 'سعر تحويل العملة غير متاح. بقي السعر السابق محفوظًا.')
      return verifiedPrice(item, nativeQuote, fxQuote)
    }))
  }

  async function fetchPrices(items, force = false) {
    const results = new Map()
    const referenceItems = items.filter((item) => isAutoPricedHolding(item, licensedStocksEnabled) && freeReferenceSymbol(item))
    for (let offset = 0; offset < referenceItems.length; offset += 4) {
      const group = await Promise.all(referenceItems.slice(offset, offset + 4).map(async (item) => (
        typeof fetchImpl === 'function' ? fetchReferencePrice(item) : null
      )))
      group.forEach((result, index) => {
        const item = referenceItems[offset + index]
        results.set(item.id, result || failedPrice(item, 'السعر المرجعي غير متاح الآن. بقي السعر السابق محفوظًا.'))
      })
    }
    const dexItems = items.filter((item) => !results.has(item.id) && isAutoPricedHolding(item, licensedStocksEnabled) && dexReferenceSymbol(item))
    for (let offset = 0; offset < dexItems.length; offset += 4) {
      const group = await Promise.all(dexItems.slice(offset, offset + 4).map((item) => fetchDexReferencePrice(item)))
      group.forEach((result) => results.set(result.id, result))
    }
    const coinGeckoItems = items.filter((item) => !results.has(item.id) && isAutoPricedHolding(item, licensedStocksEnabled) && coinGeckoIdForHolding(item))
    for (let offset = 0; offset < coinGeckoItems.length; offset += MAX_PRICE_ITEMS) {
      const group = typeof fetchImpl === 'function' ? await fetchCoinGeckoPrices(coinGeckoItems.slice(offset, offset + MAX_PRICE_ITEMS)) : []
      group.forEach((result) => results.set(result.id, result))
    }
    const usEodItems = items.filter((item) => !results.has(item.id) && isTgmEodHolding(item))
    for (let offset = 0; offset < usEodItems.length; offset += 4) {
      const group = await Promise.all(usEodItems.slice(offset, offset + 4).map((item) => fetchTgmEodPrice(item)))
      group.forEach((result) => results.set(result.id, result))
    }
    const burkutItems = burkutKey ? items.filter((item) => !results.has(item.id) && burkutCode(item)) : []
    if (burkutItems.length) {
      const providerResults = await fetchBurkutPrices(burkutItems, force)
      providerResults.forEach((result) => results.set(result.id, result))
    }
    const licensedItems = items.filter((item) => licensedStocksEnabled && !results.has(item.id)
      && !burkutCode(item) && isAutoPricedHolding(item, licensedStocksEnabled))
    const eodItems = licensedItems.filter((item) => item.quoteCurrency === 'TRY')
    for (let offset = 0; offset < eodItems.length; offset += 4) {
      const group = await Promise.all(eodItems.slice(offset, offset + 4).map((item) => fetchTwelveEodPrice(item)))
      group.forEach((result) => results.set(result.id, result))
    }
    const quoteItems = licensedItems.filter((item) => item.quoteCurrency !== 'TRY')
    if (quoteItems.length) {
      try {
        const providerResults = await fetchTwelvePrices(quoteItems)
        providerResults.forEach((result) => results.set(result.id, result))
      } catch (error) {
        quoteItems.forEach((item) => results.set(item.id, failedPrice(item, error?.message || 'السعر غير متاح لهذا الرمز.')))
      }
    }
    items.filter((item) => !results.has(item.id)).forEach((item) => {
      results.set(item.id, failedPrice(item, 'لا يتوفر تحديث آلي مرخص لهذا السوق. أدخل السعر يدويًا.'))
    })
    return items.map((item) => results.get(item.id))
  }

  async function searchProvider(request) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('بحث السوق غير متاح.', 503, 'market-search-unavailable')
    const endpoint = new URL('/symbol_search', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', request.query)
    endpoint.searchParams.set('outputsize', String(MAX_SEARCH_CANDIDATES))
    let response
    try {
      response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new MarketPriceError('تعذر البحث في السوق الآن.', 502, 'market-search-network')
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.status === 'error') {
      throw new MarketPriceError('لم يرجع مزود السوق نتائج مؤكدة.', response.ok ? 502 : response.status, 'market-search-provider')
    }
    const rawResults = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((item) => resultMatchesAssetType(item, request.assetType))
    const seen = new Set()
    return rawResults.flatMap((item) => {
      const symbol = cleanSymbol(item?.symbol)
      const exchange = cleanSymbol(item?.exchange)
      const micCode = cleanSymbol(item?.mic_code)
      const currency = marketResultCurrency(item)
      const name = cleanSearchText(item?.instrument_name)
      const instrumentType = cleanSearchText(item?.instrument_type)
      if (!symbol || !name || currency !== request.quoteCurrency) return []
      const marketCode = exchange
      const providerSymbol = request.assetType === 'metal' || symbol.includes(':') || !marketCode ? symbol : `${symbol}:${marketCode}`
      if (!PROVIDER_SYMBOL_PATTERN.test(providerSymbol)) return []
      const key = `${providerSymbol}:${currency}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{
        id: key,
        symbol,
        providerSymbol,
        name,
        exchange,
        micCode,
        instrumentType,
        assetType: marketResultAssetType(item),
        country: cleanSearchText(item?.country),
        quoteCurrency: currency,
      }]
    }).slice(0, MAX_SEARCH_RESULTS)
  }

  return {
    async tryUsdRate() {
      if (tryUsdRateCache?.expiresAt > now()) return tryUsdRateCache.value
      const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
      let quote = null
      if (apiKey && typeof fetchImpl === 'function') {
        try {
          const endpoint = new URL('/quote', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
          endpoint.searchParams.set('symbol', 'TRY/USD')
          const response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
          if (response.ok) {
            const payload = await response.json()
            const candidate = quoteFromPayload(payload, 'TRY/USD', true, now())
            if (cleanSymbol(payload?.symbol) === 'TRY/USD' && candidate
              && !quoteIsStale(candidate, now(), candidate.marketOpen === true ? MAX_OPEN_MARKET_QUOTE_AGE_MS : MAX_FX_QUOTE_AGE_MS)) {
              quote = { ...candidate, source: 'twelve-data' }
            }
          }
        } catch {
          // The verified daily reference is the fallback when the market quote fails.
        }
      }
      quote ||= await fetchEcbFxQuote('TRY')
      const tryPerUsdMicros = quote?.price ? usdMicros(1 / quote.price) : 0
      if (!tryPerUsdMicros || !quote?.quotedAt) {
        throw new MarketPriceError('سعر تحويل TRY إلى USD غير متاح الآن. أدخل سعر الصرف الفعلي قبل الحفظ.', 503, 'try-usd-rate-unavailable')
      }
      const value = {
        tryPerUsdMicros,
        quotedAt: quote.quotedAt,
        source: quote.source === 'ecb-fx' ? 'ecb-reference' : quote.source,
      }
      tryUsdRateCache = { value, expiresAt: now() + cacheMs }
      return value
    },
    async refresh(body = {}) {
      const items = normalizeMarketPriceRequest(body)
      const force = body.force === true
      pruneExpired(cache, now())
      const fresh = []
      const results = new Map()
      for (const item of items) {
        const cached = isAutoPricedHolding(item, licensedStocksEnabled)
          ? cache.get(`${item.symbol}:${item.quoteCurrency}`) : null
        if (!force && cached && cached.expiresAt > now()) results.set(item.id, { ...cached.result, id: item.id, cached: true })
        else fresh.push(item)
      }
      if (fresh.length) {
        const fetched = await fetchPrices(fresh, force)
        fetched.forEach((result) => results.set(result.id, result))
      }
      return {
        prices: items.map((item) => results.get(item.id)),
        refreshedAt: new Date(now()).toISOString(),
      }
    },
    async search(body = {}) {
      const request = normalizeMarketSearchRequest(body)
      const currentTime = now()
      pruneExpired(searchCache, currentTime)
      const key = `${request.assetType}:${request.quoteCurrency}:${request.query.toLocaleLowerCase('en')}`
      const cached = searchCache.get(key)
      if (cached) return { ...cached.result, cached: true }
      const localResults = request.quoteCurrency === 'USD'
        ? FREE_REFERENCE_ASSETS.filter((asset) => asset.assetType === request.assetType
          && `${asset.symbol} ${asset.name} ${asset.aliases}`.toLocaleLowerCase('en').includes(request.query.toLocaleLowerCase('en')))
          .map((asset) => ({ symbol: asset.symbol, name: asset.name, assetType: asset.assetType, id: asset.symbol, providerSymbol: asset.symbol, exchange: '', quoteCurrency: 'USD' }))
        : []
      if (request.assetType === 'crypto' && request.quoteCurrency === 'USD' && LATIN_SEARCH_PATTERN.test(request.query) && typeof fetchImpl === 'function') {
        let marketResults = []
        let marketFailed = false
        try {
          marketResults = await searchCoinGecko(request)
        } catch (error) {
          if (!localResults.length) throw error
          marketFailed = true
        }
        const result = {
          results: [...localResults, ...marketResults].slice(0, MAX_SEARCH_RESULTS),
          mode: localResults.length ? 'reference' : 'crypto-market',
          searchedAt: new Date(currentTime).toISOString(),
          cached: false,
        }
        if (!marketFailed) cacheSet(searchCache, key, { expiresAt: currentTime + cacheMs, result }, 200)
        return result
      }
      const usEodSearch = !licensedStocksEnabled && request.quoteCurrency === 'USD' && ['stock', 'fund'].includes(request.assetType)
      const burkutSearch = Boolean(burkutKey) && request.quoteCurrency === 'TRY' && ['stock', 'fund'].includes(request.assetType)
      const result = {
        results: localResults.length ? localResults : burkutSearch ? await searchBurkut(request) : usEodSearch ? await searchTgmTicker(request)
          : licensedStocksEnabled && ['stock', 'fund'].includes(request.assetType) ? await searchProvider(request) : [],
        mode: localResults.length ? 'reference' : burkutSearch ? 'provider' : usEodSearch ? 'daily-close'
          : licensedStocksEnabled && ['stock', 'fund'].includes(request.assetType) ? 'licensed' : 'manual',
        searchedAt: new Date(currentTime).toISOString(),
        cached: false,
      }
      cacheSet(searchCache, key, { expiresAt: currentTime + cacheMs, result }, 200)
      return result
    },
  }
}
