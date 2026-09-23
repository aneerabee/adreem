const DEFAULT_TWELVE_DATA_URL = 'https://api.twelvedata.com'
const DEFAULT_BINANCE_DATA_URL = 'https://data-api.binance.vision'
const DEFAULT_COINBASE_DATA_URL = 'https://api.exchange.coinbase.com'
const DEFAULT_GOLD_DATA_URL = 'https://api.gold-api.com'
const ECB_FX_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+TRY.EUR.SP00.A?lastNObservations=1&format=jsondata'
const DEFAULT_CACHE_MS = 5 * 60 * 1000
const MAX_QUOTE_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_OPEN_MARKET_QUOTE_AGE_MS = 2 * 60 * 60 * 1000
const MAX_FX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_USDT_QUOTE_AGE_MS = 60 * 60 * 1000
const MAX_CRYPTO_QUOTE_AGE_MS = 15 * 60 * 1000
const MAX_PRICE_ITEMS = 40
const MAX_CACHE_ENTRIES = 500
const MAX_SEARCH_RESULTS = 15
const MAX_SEARCH_CANDIDATES = 120
const SUPPORTED_MARKET_CURRENCIES = new Set(['USD', 'TRY', 'EUR'])
const SUPPORTED_ASSET_TYPES = new Set(['stock', 'crypto', 'metal', 'fund', 'other'])
const PROVIDER_SYMBOL_PATTERN = /^[A-Z0-9./_-]+(?::[A-Z0-9._ -]+)?$/
const DIRECT_STOCK_TYPES = new Set(['COMMON STOCK', 'PREFERRED STOCK'])
const FUND_TYPES = new Set(['ETF', 'MUTUAL FUND', 'BOND FUND', 'CLOSED-END FUND'])
const TRUSTED_CRYPTO_EXCHANGES = ['BINANCE', 'COINBASE', 'COINBASE PRO', 'KRAKEN', 'OKX', 'BYBIT', 'BITSTAMP', 'GEMINI']
const CRYPTO_SEARCH_ALIASES = new Map([
  ['bitcoin', 'BTC'], ['بيتكوين', 'BTC'],
  ['ethereum', 'ETH'], ['ether', 'ETH'], ['إيثيريوم', 'ETH'], ['ايثيريوم', 'ETH'],
  ['tether', 'USDT'], ['تيثر', 'USDT'],
  ['binance coin', 'BNB'], ['bnb', 'BNB'],
  ['solana', 'SOL'], ['سولانا', 'SOL'],
  ['xrp', 'XRP'], ['ripple', 'XRP'], ['ريبل', 'XRP'],
  ['usd coin', 'USDC'], ['usdc', 'USDC'],
  ['dogecoin', 'DOGE'], ['دوجكوين', 'DOGE'],
  ['cardano', 'ADA'], ['كاردانو', 'ADA'],
  ['avalanche', 'AVAX'], ['أفالانش', 'AVAX'], ['افالانش', 'AVAX'],
  ['chainlink', 'LINK'], ['تشين لينك', 'LINK'],
  ['polkadot', 'DOT'], ['بولكادوت', 'DOT'],
  ['litecoin', 'LTC'], ['لايتكوين', 'LTC'],
  ['tron', 'TRX'], ['ترون', 'TRX'],
])

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

function cryptoExchangeRank(exchange) {
  const normalized = cleanSymbol(exchange)
  const rank = TRUSTED_CRYPTO_EXCHANGES.indexOf(normalized)
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank
}

function providerSearchQuery(request) {
  if (request.assetType !== 'crypto') return request.query
  return CRYPTO_SEARCH_ALIASES.get(request.query.toLocaleLowerCase('en')) || request.query
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

function priceFailureMessage(payload, usingDemoAccess) {
  const code = Number(payload?.code || payload?.statusCode || 0)
  if (code === 429) return 'بلغ مزود الأسعار حد الطلبات. بقي السعر السابق محفوظًا.'
  if (code === 401 || code === 403) return usingDemoAccess
    ? 'سعر هذا السوق يحتاج إلى مفتاح مزود أسعار مفعل.'
    : 'مفتاح مزود الأسعار غير صالح أو الاشتراك لا يتيح هذا السوق.'
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
    return { id, symbol, quoteCurrency, ...(assetType ? { assetType } : {}) }
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
    return { id, providerSymbol, quoteCurrency: holding.quoteCurrency, assetType: holding.assetType }
  })
  return normalizeMarketPriceRequest({ items })
}

export function normalizeMarketSearchRequest(body = {}) {
  const query = cleanSearchText(body.query)
  const quoteCurrency = cleanCurrency(body.quoteCurrency || 'USD')
  const assetType = cleanAssetType(body.assetType || 'stock')
  if (query.length < 2) throw new MarketPriceError('اكتب حرفين على الأقل للبحث.', 400, 'market-search-too-short')
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
  let usdtUsdCache = null
  let usdtUsdPending = null
  let ecbFxCache = null
  let ecbFxPending = null

  function providerHeaders(apiKey) {
    return { accept: 'application/json', authorization: `apikey ${apiKey}` }
  }

  function binanceTickerSymbol(item = {}) {
    const [marketSymbol, exchange = ''] = cleanSymbol(item.symbol).split(':')
    if (item.assetType !== 'crypto' || exchange !== 'BINANCE' || item.quoteCurrency !== 'USD') return ''
    const [base, quote] = marketSymbol.split('/')
    if (!base || quote !== 'USD' || !/^[A-Z0-9]+$/.test(base)) return ''
    return `${base}USDT`
  }

  function coinbaseTickerSymbol(item = {}) {
    const [marketSymbol, exchange = ''] = cleanSymbol(item.symbol).split(':')
    if (item.assetType !== 'crypto' || !['COINBASE', 'COINBASE PRO'].includes(exchange) || item.quoteCurrency !== 'USD') return ''
    const [base, quote] = marketSymbol.split('/')
    return base && quote === 'USD' && /^[A-Z0-9]+$/.test(base) ? `${base}-USD` : ''
  }

  function metalTickerSymbol(item = {}) {
    if (item.assetType !== 'metal' || item.quoteCurrency !== 'USD') return ''
    const [base, quote] = cleanSymbol(item.symbol).split('/')
    return quote === 'USD' && ['XAU', 'XAG', 'XPT', 'XPD'].includes(base) ? base : ''
  }

  async function fetchCoinbaseQuote(productId, maxAgeMs = MAX_CRYPTO_QUOTE_AGE_MS) {
    const endpoint = new URL(`/products/${productId}/ticker`, String(env.ADREEM_COINBASE_API_URL || DEFAULT_COINBASE_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const payload = await response.json()
      const price = Number(payload?.price)
      const quotedAt = isoQuoteTime(payload?.time, now())
      if (!Number.isFinite(price) || price <= 0 || quoteIsStale({ quotedAt }, now(), maxAgeMs)) return null
      return { price, quotedAt, marketOpen: true }
    } catch {
      return null
    }
  }

  async function fetchUsdtUsdRate() {
    if (usdtUsdCache && usdtUsdCache.expiresAt > now()) return usdtUsdCache.quote
    if (usdtUsdPending) return usdtUsdPending
    usdtUsdPending = (async () => {
      const coinbaseQuote = await fetchCoinbaseQuote('USDT-USD', MAX_USDT_QUOTE_AGE_MS)
      if (coinbaseQuote) return { ...coinbaseQuote, source: 'coinbase' }
      const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
      if (!apiKey) return null
      const endpoint = new URL('/quote', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
      endpoint.searchParams.set('symbol', 'USDT/USD')
      try {
        const response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
        if (!response.ok) return null
        const quote = quoteFromPayload(await response.json(), 'USDT/USD', true, now())
        return quoteIsStale(quote, now(), MAX_USDT_QUOTE_AGE_MS) ? null : { ...quote, source: 'twelve-data' }
      } catch {
        return null
      }
    })()
    try {
      const quote = await usdtUsdPending
      if (quote) usdtUsdCache = { quote, expiresAt: now() + Math.min(cacheMs, 60_000) }
      return quote
    } finally {
      usdtUsdPending = null
    }
  }

  async function fetchBinancePrice(item) {
    const tickerSymbol = binanceTickerSymbol(item)
    if (!tickerSymbol) return null
    const endpoint = new URL('/api/v3/trades', String(env.ADREEM_BINANCE_API_URL || DEFAULT_BINANCE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', tickerSymbol)
    endpoint.searchParams.set('limit', '1')
    let payload
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      payload = await response.json()
    } catch {
      return null
    }
    const trade = Array.isArray(payload) ? payload[0] : null
    const price = Number(trade?.price)
    const quotedAt = quoteTime({ timestamp: trade?.time }, now())
    if (!Number.isFinite(price) || price <= 0 || quoteIsStale({ quotedAt }, now(), MAX_CRYPTO_QUOTE_AGE_MS)) return null
    const usdtUsd = await fetchUsdtUsdRate()
    if (!usdtUsd) return null
    const priceUsdMicros = usdMicros(price * usdtUsd.price)
    if (!priceUsdMicros) return null
    const refreshedAt = new Date(now()).toISOString()
    const result = {
      id: item.id,
      symbol: item.symbol,
      quoteCurrency: item.quoteCurrency,
      nativePriceMicros: priceUsdMicros,
      priceUsdMicros,
      refreshedAt,
      quotedAt,
      fxQuotedAt: usdtUsd.quotedAt,
      marketOpen: true,
      source: `binance-usdt+${usdtUsd.source}-usdt-usd`,
      cached: false,
      ok: true,
    }
    cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
    return result
  }

  async function fetchCoinbasePrice(item) {
    const productId = coinbaseTickerSymbol(item)
    if (!productId) return null
    const quote = await fetchCoinbaseQuote(productId)
    const priceUsdMicros = usdMicros(quote?.price)
    if (!priceUsdMicros) return null
    const result = {
      id: item.id,
      symbol: item.symbol,
      quoteCurrency: item.quoteCurrency,
      nativePriceMicros: priceUsdMicros,
      priceUsdMicros,
      refreshedAt: new Date(now()).toISOString(),
      quotedAt: quote.quotedAt,
      fxQuotedAt: null,
      marketOpen: true,
      source: 'coinbase',
      cached: false,
      ok: true,
    }
    cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
    return result
  }

  async function fetchMetalPrice(item) {
    const metal = metalTickerSymbol(item)
    if (!metal) return null
    const endpoint = new URL(`/price/${metal}`, String(env.ADREEM_GOLD_API_URL || DEFAULT_GOLD_DATA_URL).replace(/\/+$/, ''))
    try {
      const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      const payload = await response.json()
      const price = Number(payload?.price)
      const quotedAt = isoQuoteTime(payload?.updatedAt, now())
      if (payload?.symbol !== metal || payload?.currency !== 'USD' || !Number.isFinite(price) || price <= 0
        || quoteIsStale({ quotedAt }, now(), MAX_OPEN_MARKET_QUOTE_AGE_MS)) return null
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
        marketOpen: null,
        source: 'gold-api',
        cached: false,
        ok: true,
      }
      cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    } catch {
      return null
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

  function verifiedPrice(item, nativeQuote, fxQuote) {
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
      source: fxQuote.source === 'ecb-fx' ? 'twelve-data+ecb-fx' : 'twelve-data',
      cached: false,
      ok: true,
    }
    cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
    return result
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

  async function fetchTwelvePrices(items) {
    const configuredApiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
    const apiKey = configuredApiKey || 'demo'
    const usingDemoAccess = !configuredApiKey
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
      if (items.length > 1 && response.status !== 429) {
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
        if (item.quoteCurrency !== 'USD' && response.status !== 429) {
          const recovered = await fetchTwelveNativeWithEcb(item, apiKey)
          if (recovered) return [recovered]
        }
      }
      return items.map((item) => failedPrice(item, priceFailureMessage({ ...payload, code: payload?.code || response.status }, usingDemoAccess)))
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
      if (!nativeQuote) return failedPrice(item, priceFailureMessage(singleSymbol ? payload : payload?.[item.symbol], usingDemoAccess))
      if (!fxQuote) return failedPrice(item, 'سعر تحويل العملة غير متاح. بقي السعر السابق محفوظًا.')
      return verifiedPrice(item, nativeQuote, fxQuote)
    }))
  }

  async function fetchPrices(items) {
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('خدمة الأسعار غير متاحة.', 503, 'market-price-unavailable')
    const results = new Map()
    for (let offset = 0; offset < items.length; offset += 4) {
      const group = await Promise.all(items.slice(offset, offset + 4).map(async (item) => {
        if (coinbaseTickerSymbol(item)) return fetchCoinbasePrice(item)
        if (binanceTickerSymbol(item)) return fetchBinancePrice(item)
        if (metalTickerSymbol(item)) return fetchMetalPrice(item)
        return null
      }))
      group.forEach((result) => { if (result) results.set(result.id, result) })
    }
    const remaining = items.filter((item) => !results.has(item.id))
    if (remaining.length) {
      try {
        const providerResults = await fetchTwelvePrices(remaining)
        providerResults.forEach((result) => results.set(result.id, result))
      } catch (error) {
        remaining.forEach((item) => results.set(item.id, failedPrice(item, error?.message || 'السعر غير متاح لهذا الرمز.')))
      }
    }
    return items.map((item) => results.get(item.id))
  }

  async function searchProvider(request) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || 'demo').trim()
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('بحث السوق غير متاح.', 503, 'market-search-unavailable')
    const endpoint = new URL('/symbol_search', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', providerSearchQuery(request))
    endpoint.searchParams.set('outputsize', String(MAX_SEARCH_CANDIDATES))
    let response
    try {
      response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new MarketPriceError('تعذر البحث في السوق الآن.', 502, 'market-search-network')
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.status === 'error') {
      throw new MarketPriceError('لم يرجع مزود السوق نتائج مؤكدة.', response.status || 502, 'market-search-provider')
    }
    const rawResults = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((item) => resultMatchesAssetType(item, request.assetType))
    const preferredResults = request.assetType === 'crypto'
      ? rawResults.filter((item) => cryptoExchangeRank(item?.exchange) !== Number.MAX_SAFE_INTEGER)
      : rawResults
    const searchedSymbol = providerSearchQuery(request).toUpperCase()
    const exactCryptoResults = request.assetType === 'crypto'
      ? preferredResults.filter((item) => (
        cleanSymbol(item?.symbol).split('/')[0] === searchedSymbol
        && marketResultCurrency(item) === request.quoteCurrency
      ))
      : []
    const candidates = exactCryptoResults.length ? exactCryptoResults : preferredResults
    const seen = new Set()
    return candidates.flatMap((item) => {
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
    }).sort((left, right) => (
      request.assetType === 'crypto'
        ? cryptoExchangeRank(left.exchange) - cryptoExchangeRank(right.exchange)
        : 0
    )).slice(0, MAX_SEARCH_RESULTS)
  }

  return {
    async refresh(body = {}) {
      const items = normalizeMarketPriceRequest(body)
      const force = body.force === true
      pruneExpired(cache, now())
      const fresh = []
      const results = new Map()
      for (const item of items) {
        const cached = cache.get(`${item.symbol}:${item.quoteCurrency}`)
        if (!force && cached && cached.expiresAt > now()) results.set(item.id, { ...cached.result, id: item.id, cached: true })
        else fresh.push(item)
      }
      if (fresh.length) {
        const fetched = await fetchPrices(fresh)
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
      const result = {
        results: await searchProvider(request),
        searchedAt: new Date(currentTime).toISOString(),
        cached: false,
      }
      cacheSet(searchCache, key, { expiresAt: currentTime + cacheMs, result }, 200)
      return result
    },
  }
}
