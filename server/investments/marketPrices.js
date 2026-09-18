const DEFAULT_TWELVE_DATA_URL = 'https://api.twelvedata.com'
const DEFAULT_CACHE_MS = 5 * 60 * 1000
const MAX_PRICE_ITEMS = 40

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
  return /^[A-Z]{3,5}$/.test(currency) ? currency : 'USD'
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
    const quoteCurrency = cleanCurrency(item?.quoteCurrency)
    if (!id || ids.has(id)) throw new MarketPriceError('معرف الاستثمار ناقص أو مكرر.', 400, 'invalid-price-item')
    if (!symbol || !/^[A-Z0-9./:_-]+$/.test(symbol)) throw new MarketPriceError('رمز السعر غير صالح.', 400, 'invalid-price-symbol')
    ids.add(id)
    return { id, symbol, quoteCurrency }
  })
}

export function createMarketPriceService(env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || (() => Date.now())
  const cacheMs = Math.max(10_000, Number(options.cacheMs || env.ADREEM_MARKET_PRICE_CACHE_MS || DEFAULT_CACHE_MS))
  const cache = new Map()

  async function fetchPrices(items) {
    const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim()
    if (!apiKey) throw new MarketPriceError('تحديث السعر المباشر غير مفعّل. يمكنك إدخال السعر يدويًا.', 503, 'market-price-not-configured')
    if (typeof fetchImpl !== 'function') throw new MarketPriceError('خدمة الأسعار غير متاحة.', 503, 'market-price-unavailable')

    const currencies = Array.from(new Set(items.map((item) => item.quoteCurrency).filter((currency) => currency !== 'USD')))
    const symbols = Array.from(new Set([...items.map((item) => item.symbol), ...currencies.map((currency) => `${currency}/USD`)]))
    const endpoint = new URL('/price', String(env.TWELVE_DATA_API_URL || DEFAULT_TWELVE_DATA_URL).replace(/\/+$/, ''))
    endpoint.searchParams.set('symbol', symbols.join(','))
    endpoint.searchParams.set('apikey', apiKey)
    let response
    try {
      response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
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
      cache.set(`${item.symbol}:${item.quoteCurrency}`, { expiresAt: now() + cacheMs, result })
      return result
    })
  }

  return {
    async refresh(body = {}) {
      const items = normalizeMarketPriceRequest(body)
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
  }
}
