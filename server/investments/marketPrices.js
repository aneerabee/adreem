const DEFAULT_TWELVE_DATA_URL = 'https://api.twelvedata.com'
const DEFAULT_CACHE_MS = 5 * 60 * 1000
const MAX_PRICE_ITEMS = 40
const MAX_CACHE_ENTRIES = 500
const MAX_SEARCH_RESULTS = 15
const SUPPORTED_MARKET_CURRENCIES = new Set(['USD', 'TRY', 'EUR'])

export class MarketPriceError extends Error {
  constructor(message, statusCode = 502, code = 'market-price-failed') {
    super(message)
    this.name = 'MarketPriceError'
    this.statusCode = statusCode
    this.code = code
  }
}
function cleanSymbol(value) {
  return String(value || '').trim().toUpperCase().slice(0, 80)
}

function cleanCurrency(value) {
  const currency = cleanSymbol(value)
  return SUPPORTED_MARKET_CURRENCIES.has(currency) ? currency : ''
}

function cleanSearchText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80)
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

function priceFromPayload(payload, symbol, singleSymbol) {
  const candidate = singleSymbol ? payload : payload?.[symbol]
  const price = Number(candidate?.price)
  if (candidate?.status === 'error' || !Number.isFinite(price) || price <= 0) return null
  return price
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
    if (!symbol || !/^[A-Z0-9./:_-]+$/.test(symbol)) throw new MarketPriceError('رمز السعر غير صالح.', 400, 'invalid-price-symbol')
    if (!quoteCurrency) throw new MarketPriceError('عملة السوق غير مدعومة.', 400, 'invalid-market-currency')
    ids.add(id)
    return { id, symbol, quoteCurrency }
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
    if (!holding?.providerSymbol) throw new MarketPriceError('أحد الاستثمارات غير موجود أو لا يملك مصدر سعر.', 400, 'unknown-price-item')
    return { id, providerSymbol: holding.providerSymbol, quoteCurrency: holding.quoteCurrency }
  })
  return normalizeMarketPriceRequest({ items })
}

export function normalizeMarketSearchRequest(body = {}) {
  const query = cleanSearchText(body.query)
  const quoteCurrency = cleanCurrency(body.quoteCurrency || 'USD')
  if (query.length < 2) throw new MarketPriceError('اكتب حرفين على الأقل للبحث.', 400, 'market-search-too-short')
  if (!quoteCurrency) throw new MarketPriceError('عملة السوق غير مدعومة.', 400, 'invalid-market-currency')
  return { query, quoteCurrency }
}

export function createMarketPriceService(env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || (() => Date.now())
  const cacheMs = Math.max(10_000, Number(options.cacheMs || env.ADREEM_MARKET_PRICE_CACHE_MS || DEFAULT_CACHE_MS))
  const cache = new Map()
  const searchCache = new Map()

  function providerHeaders(apiKey) {
    return { accept: 'application/json', authorization: `apikey ${apiKey}` }
  }

  async function fetchPrices(items) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
    if (!apiKey) throw new MarketPriceError('تحديث السعر المباشر غير مفعّل. يمكنك إدخال السعر يدويًا.', 503, 'market-price-not-configured')
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('خدمة الأسعار غير متاحة.', 503, 'market-price-unavailable')

    const currencies = Array.from(new Set(items.map((item) => item.quoteCurrency).filter((currency) => currency !== 'USD')))
    const symbols = Array.from(new Set([...items.map((item) => item.symbol), ...currencies.map((currency) => `${currency}/USD`)]))
    const endpoint = new URL('/price', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', symbols.join(','))
    let response
    try {
      response = await fetchImpl(endpoint, { headers: providerHeaders(apiKey), signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new MarketPriceError('تعذر الوصول إلى مزود الأسعار. بقي السعر السابق محفوظًا.', 502, 'market-price-network')
    }
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.status === 'error') {
      throw new MarketPriceError('مزود الأسعار لم يرجع نتيجة مؤكدة. بقي السعر السابق محفوظًا.', response.status || 502, 'market-price-provider')
    }
    const singleSymbol = symbols.length === 1
    const refreshedAt = new Date(now()).toISOString()
    return items.map((item) => {
      const nativePrice = priceFromPayload(payload, item.symbol, singleSymbol)
      const fxPrice = item.quoteCurrency === 'USD'
        ? 1
        : priceFromPayload(payload, `${item.quoteCurrency}/USD`, false)
      if (!nativePrice || !fxPrice) {
        return { id: item.id, symbol: item.symbol, ok: false, error: 'السعر غير متاح لهذا الرمز.' }
      }
      const nativeMicros = usdMicros(nativePrice)
      const priceUsdMicros = usdMicros(nativePrice * fxPrice)
      if (!nativeMicros || !priceUsdMicros) return { id: item.id, symbol: item.symbol, ok: false, error: 'السعر المستلم غير صالح.' }
      const result = {
        id: item.id,
        symbol: item.symbol,
        quoteCurrency: item.quoteCurrency,
        nativePriceMicros: nativeMicros,
        priceUsdMicros,
        refreshedAt,
        source: 'twelve-data',
        cached: false,
        ok: true,
      }
      cacheSet(cache, `${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    })
  }

  async function searchProvider(request) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || 'demo').trim()
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('بحث السوق غير متاح.', 503, 'market-search-unavailable')
    const endpoint = new URL('/symbol_search', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', request.query)
    endpoint.searchParams.set('outputsize', String(MAX_SEARCH_RESULTS * 3))
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
    const seen = new Set()
    return (Array.isArray(payload?.data) ? payload.data : []).flatMap((item) => {
      const symbol = cleanSymbol(item?.symbol)
      const exchange = cleanSymbol(item?.exchange)
      const micCode = cleanSymbol(item?.mic_code)
      const currency = cleanCurrency(item?.currency)
      const name = cleanSearchText(item?.instrument_name)
      const instrumentType = cleanSearchText(item?.instrument_type)
      if (!symbol || !name || currency !== request.quoteCurrency) return []
      const marketCode = micCode || exchange
      const providerSymbol = symbol.includes('/') || symbol.includes(':') || !marketCode ? symbol : `${symbol}:${marketCode}`
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
        country: cleanSearchText(item?.country),
        quoteCurrency: currency,
      }]
    }).slice(0, MAX_SEARCH_RESULTS)
  }

  return {
    async refresh(body = {}) {
      const items = normalizeMarketPriceRequest(body)
      pruneExpired(cache, now())
      const fresh = []
      const results = new Map()
      for (const item of items) {
        const cached = cache.get(`${item.symbol}:${item.quoteCurrency}`)
        if (cached && cached.expiresAt > now()) results.set(item.id, { ...cached.result, id: item.id, cached: true })
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
      const key = `${request.quoteCurrency}:${request.query.toLocaleLowerCase('en')}`
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
