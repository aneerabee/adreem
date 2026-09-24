import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { isAutoPricedHolding } from './investmentMarketPolicy.js'

export const INVESTMENT_QUANTITY_SCALE = 100_000_000
export const INVESTMENT_PRICE_SCALE = 1_000_000
export const MIN_VISIBLE_INVESTMENT_USD_MICROS = INVESTMENT_PRICE_SCALE
export const SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS = 5 * INVESTMENT_PRICE_SCALE
export const MAX_INVESTMENT_USD_MICROS = Number.MAX_SAFE_INTEGER
export const MAX_INVESTMENT_USD = Math.floor(MAX_INVESTMENT_USD_MICROS / INVESTMENT_PRICE_SCALE)
export const INVESTMENT_PRICE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
export const INVESTMENT_PRICE_REFRESH_START_DELAY_MS = 1_200
export const INVESTMENT_RECORD_STATUSES = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  VOIDED: 'voided',
})
export const INVESTMENT_TRADE_TYPES = Object.freeze({
  OPENING: 'opening',
  BUY: 'buy',
  SELL: 'sell',
})
export const INVESTMENT_TRANSFER_ASSETS = Object.freeze({ USD: 'USD', USDT: 'USDT' })
export const INVESTMENT_ASSET_TYPES = Object.freeze({
  STOCK: 'stock',
  CRYPTO: 'crypto',
  METAL: 'metal',
  FUND: 'fund',
  OTHER: 'other',
})
const INVESTMENT_PLATFORM_KINDS = new Set(['platform', 'bank', 'wallet', 'broker'])
const INVESTMENT_QUOTE_CURRENCIES = new Set([CURRENCIES.USD, CURRENCIES.TRY, CURRENCIES.EUR])
const INVESTMENT_PROVIDER_SYMBOL_PATTERN = /^[A-Z0-9./_-]+(?::[A-Z0-9._ -]+)?$/

function cleanText(value, maximum = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maximum)
}

function safeInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}

function safePositiveInteger(value) {
  const number = safeInteger(value)
  return number > 0 ? number : 0
}

function safeScaledProduct(left, right, divisor) {
  const leftInteger = safePositiveInteger(left)
  const rightInteger = safePositiveInteger(right)
  if (!leftInteger || !rightInteger) return 0
  const divisorInteger = BigInt(divisor)
  const result = ((BigInt(leftInteger) * BigInt(rightInteger)) + (divisorInteger / 2n)) / divisorInteger
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : 0
}

function localizedDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
}

function normalizeInvestmentDecimalText(value) {
  let text = localizedDigits(value)
    .trim()
    .replace(/[\s'\u066c]/g, '')
    .replace(/\u066b/g, '.')
  if (text.includes(',') && text.includes('.')) {
    const decimalSeparator = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.'
    const groupingSeparator = decimalSeparator === ',' ? /\./g : /,/g
    text = text.replace(groupingSeparator, '').replace(decimalSeparator, '.')
  } else {
    text = text.replace(',', '.')
  }
  return text
}

export function investmentDecimalInputIsValid(value, { allowZero = true } = {}) {
  const text = normalizeInvestmentDecimalText(value)
  if (!/^\+?\d*(?:\.\d*)?$/.test(text) || !/\d/.test(text)) return false
  const number = Number(text)
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0)
}

export function parseInvestmentDecimal(value) {
  const text = normalizeInvestmentDecimalText(value)
  if (!/^\+?\d*(?:\.\d*)?$/.test(text)) return 0
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function createdTime(record) {
  const value = new Date(record?.occurredAt || record?.createdAt || record?.updatedAt || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

function isValidDateValue(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime())
}

export function quantityToUnits(value) {
  const number = parseInvestmentDecimal(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  const units = Math.round(number * INVESTMENT_QUANTITY_SCALE)
  return Number.isSafeInteger(units) ? units : 0
}

export function unitsToQuantity(value) {
  return safeInteger(value) / INVESTMENT_QUANTITY_SCALE
}

export function usdToMicros(value) {
  const number = parseInvestmentDecimal(value)
  if (!Number.isFinite(number) || number < 0) return 0
  const micros = Math.round(number * INVESTMENT_PRICE_SCALE)
  return Number.isSafeInteger(micros) ? micros : 0
}

export function microsToUsd(value) {
  return safeInteger(value) / INVESTMENT_PRICE_SCALE
}

export function convertTryPriceToUsdMicros(priceTryMicros, tryPerUsdMicros) {
  const nativePrice = safePositiveInteger(priceTryMicros)
  const rate = safePositiveInteger(tryPerUsdMicros)
  if (!nativePrice || !rate) return 0
  const result = (BigInt(nativePrice) * BigInt(INVESTMENT_PRICE_SCALE) + BigInt(rate) / 2n) / BigInt(rate)
  return result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : 0
}

export const INVESTMENT_FX_FORM_MAX_AGE_MS = 5 * 60 * 1000

export function investmentFxRateIsFresh(fx = {}, now = Date.now()) {
  if (fx.source === 'manual') return true
  const loadedAt = Date.parse(fx.loadedAt || '')
  return Number.isFinite(loadedAt) && loadedAt <= now && now - loadedAt < INVESTMENT_FX_FORM_MAX_AGE_MS
}

export function investmentHoldingIsLiquidity(holding = {}) {
  const symbol = cleanText(holding.symbol || holding.providerSymbol, 80).toUpperCase()
  return symbol.split(':')[0].split('/')[0] === 'USDT'
}

export function createInvestmentTransfer(draft = {}, createdAt = new Date().toISOString()) {
  const asset = draft.asset === INVESTMENT_TRANSFER_ASSETS.USDT ? INVESTMENT_TRANSFER_ASSETS.USDT : INVESTMENT_TRANSFER_ASSETS.USD
  return {
    id: cleanText(draft.id, 160) || `investment-transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    asset,
    fromPlatformId: cleanText(draft.fromPlatformId, 160),
    toPlatformId: cleanText(draft.toPlatformId, 160),
    ...(asset === INVESTMENT_TRANSFER_ASSETS.USD
      ? { amountUsdMicros: safePositiveInteger(draft.amountUsdMicros) }
      : {
          sourceHoldingId: cleanText(draft.sourceHoldingId, 160),
          destinationHoldingId: cleanText(draft.destinationHoldingId, 160),
          quantityUnits: safePositiveInteger(draft.quantityUnits),
          costBasisUsdMicros: safeInteger(draft.costBasisUsdMicros, -1),
        }),
    note: cleanText(draft.note, 300),
    status: INVESTMENT_RECORD_STATUSES.ACTIVE,
    occurredAt: createdAt,
    createdAt,
  }
}

export function investmentPriceChange(holding = {}) {
  const current = safePositiveInteger(holding.lastPriceUsdMicros)
  const previous = safePositiveInteger(holding.previousPriceUsdMicros)
  if (!current || !previous || current === previous) return { direction: 'neutral', percent: 0 }
  return { direction: current > previous ? 'up' : 'down', percent: ((current - previous) / previous) * 100 }
}

export function investmentPriceDirection(holding = {}) {
  return investmentPriceChange(holding).direction
}

export function applyInvestmentMarketPrice(holding = {}, price = {}) {
  const changed = Number(holding.lastPriceUsdMicros || 0) !== price.priceUsdMicros
    || Number(holding.lastPriceNativeMicros || 0) !== price.nativePriceMicros
  return {
    ...holding,
    previousPriceUsdMicros: changed ? Number(holding.lastPriceUsdMicros || 0) : holding.previousPriceUsdMicros,
    previousPriceNativeMicros: changed ? Number(holding.lastPriceNativeMicros || 0) : holding.previousPriceNativeMicros,
    previousPriceAt: changed ? holding.lastPriceAt || null : holding.previousPriceAt,
    lastPriceUsdMicros: price.priceUsdMicros,
    lastPriceNativeMicros: price.nativePriceMicros,
    lastPriceAt: price.refreshedAt,
    lastPriceQuotedAt: price.quotedAt || null,
    lastPriceFxQuotedAt: price.fxQuotedAt || null,
    lastPriceMarketOpen: typeof price.marketOpen === 'boolean' ? price.marketOpen : null,
    lastPriceSource: price.source,
    updatedAt: price.refreshedAt,
  }
}

export function investmentPriceRefreshDelay(holdings = [], now = Date.now(), licensedStocksEnabled = false) {
  const refreshable = holdings.filter((holding) => isAutoPricedHolding(holding, licensedStocksEnabled))
  if (!refreshable.length) return null
  const timestamps = refreshable.map((holding) => new Date(holding.lastPriceAt || 0).getTime())
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp) || timestamp <= 0)) return INVESTMENT_PRICE_REFRESH_START_DELAY_MS
  const dueAt = Math.min(...timestamps) + INVESTMENT_PRICE_REFRESH_INTERVAL_MS
  return Math.max(INVESTMENT_PRICE_REFRESH_START_DELAY_MS, Math.min(INVESTMENT_PRICE_REFRESH_INTERVAL_MS, dueAt - now))
}

export function investmentTradeValueMicros(trade = {}) {
  const quantityUnits = safePositiveInteger(trade.quantityUnits)
  const priceUsdMicros = safePositiveInteger(trade.priceUsdMicros)
  if (!quantityUnits || !priceUsdMicros) return 0
  return safeScaledProduct(quantityUnits, priceUsdMicros, INVESTMENT_QUANTITY_SCALE)
}

export function investmentTransferCostBasisUsdMicros(holdingRow = {}, quantityUnits = 0) {
  const available = safePositiveInteger(holdingRow.quantityUnits)
  const cost = safeInteger(holdingRow.costBasisUsdMicros, -1)
  const quantity = safePositiveInteger(quantityUnits)
  if (!available || !quantity || quantity > available || cost < 0) return -1
  return safeScaledProduct(cost, quantity, available)
}

export function createInvestmentPlatform(draft = {}, createdAt = new Date().toISOString()) {
  const id = cleanText(draft.id, 160) || `investment-platform-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const kind = INVESTMENT_PLATFORM_KINDS.has(draft.kind) ? draft.kind : 'platform'
  return {
    id,
    name: cleanText(draft.name, 80),
    kind,
    location: cleanText(draft.location, 80),
    status: INVESTMENT_RECORD_STATUSES.ACTIVE,
    createdAt,
    updatedAt: createdAt,
  }
}

export function createInvestmentHolding(draft = {}, createdAt = new Date().toISOString()) {
  const id = cleanText(draft.id, 160) || `investment-holding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const assetType = Object.values(INVESTMENT_ASSET_TYPES).includes(draft.assetType)
    ? draft.assetType
    : INVESTMENT_ASSET_TYPES.OTHER
  const quoteCurrency = cleanText(draft.quoteCurrency, 12).toUpperCase()
  const normalizedQuoteCurrency = INVESTMENT_QUOTE_CURRENCIES.has(quoteCurrency) ? quoteCurrency : CURRENCIES.USD
  const openingPriceUsdMicros = usdToMicros(draft.initialPriceUsd)
  const lastPriceUsdMicros = safePositiveInteger(draft.lastPriceUsdMicros) || openingPriceUsdMicros
  return {
    id,
    platformId: cleanText(draft.platformId, 160),
    name: cleanText(draft.name, 80),
    symbol: cleanText(draft.symbol, 32).toUpperCase(),
    providerSymbol: cleanText(draft.providerSymbol || draft.symbol, 80).toUpperCase(),
    marketDataMode: draft.marketDataMode === 'manual' ? 'manual' : 'provider',
    assetType,
    exchange: cleanText(draft.exchange, 40).toUpperCase(),
    quoteCurrency: normalizedQuoteCurrency,
    lastPriceUsdMicros,
    lastPriceNativeMicros: safePositiveInteger(draft.lastPriceNativeMicros)
      || (normalizedQuoteCurrency === CURRENCIES.USD ? lastPriceUsdMicros : 0),
    lastPriceAt: draft.lastPriceAt || (openingPriceUsdMicros ? createdAt : null),
    lastPriceQuotedAt: draft.lastPriceQuotedAt || null,
    lastPriceFxQuotedAt: draft.lastPriceFxQuotedAt || null,
    lastPriceMarketOpen: typeof draft.lastPriceMarketOpen === 'boolean' ? draft.lastPriceMarketOpen : null,
    lastPriceSource: cleanText(draft.lastPriceSource, 40) || (openingPriceUsdMicros ? 'opening' : 'manual'),
    previousPriceUsdMicros: safePositiveInteger(draft.previousPriceUsdMicros),
    previousPriceNativeMicros: safePositiveInteger(draft.previousPriceNativeMicros),
    previousPriceAt: draft.previousPriceAt || null,
    status: INVESTMENT_RECORD_STATUSES.ACTIVE,
    createdAt,
    updatedAt: createdAt,
  }
}

export function createInvestmentTrade(draft = {}, createdAt = new Date().toISOString()) {
  const type = Object.values(INVESTMENT_TRADE_TYPES).includes(draft.type)
    ? draft.type
    : INVESTMENT_TRADE_TYPES.BUY
  const hasNativePrice = Object.hasOwn(draft, 'priceNativeMicros')
  return {
    id: cleanText(draft.id, 160) || `investment-trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platformId: cleanText(draft.platformId, 160),
    holdingId: cleanText(draft.holdingId, 160),
    type,
    quantityUnits: safePositiveInteger(draft.quantityUnits),
    priceUsdMicros: safePositiveInteger(draft.priceUsdMicros),
    ...(hasNativePrice ? {
      priceNativeMicros: safePositiveInteger(draft.priceNativeMicros),
      fxTryPerUsdMicros: safePositiveInteger(draft.fxTryPerUsdMicros),
      fxQuotedAt: draft.fxQuotedAt || null,
      fxSource: ['twelve-data', 'ecb-reference', 'manual'].includes(draft.fxSource) ? draft.fxSource : '',
    } : {}),
    feeUsdMicros: safeInteger(draft.feeUsdMicros),
    occurredAt: draft.occurredAt || createdAt,
    note: cleanText(draft.note, 300),
    status: draft.status === INVESTMENT_RECORD_STATUSES.VOIDED
      ? INVESTMENT_RECORD_STATUSES.VOIDED
      : INVESTMENT_RECORD_STATUSES.ACTIVE,
    createdAt,
    updatedAt: createdAt,
  }
}

export function buildInvestmentTradeEdit(trade = {}, draft = {}, updatedAt = new Date().toISOString()) {
  if (!trade?.id || trade.status === INVESTMENT_RECORD_STATUSES.VOIDED) {
    return { ok: false, message: 'عملية الاستثمار غير متاحة للتعديل.' }
  }
  if (
    !investmentDecimalInputIsValid(draft.quantity, { allowZero: false })
    || !investmentDecimalInputIsValid(trade.priceNativeMicros ? draft.priceNative : draft.priceUsd, { allowZero: false })
  ) {
    return { ok: false, message: 'الكمية والسعر يجب أن يكونا أكبر من صفر.' }
  }
  if (!investmentDecimalInputIsValid(draft.feeUsd || 0)) {
    return { ok: false, message: 'الرسوم يجب أن تكون رقمًا صحيحًا أو صفرًا.' }
  }
  const quantityUnits = quantityToUnits(draft.quantity)
  const priceNativeMicros = trade.priceNativeMicros ? usdToMicros(draft.priceNative) : 0
  const priceUsdMicros = priceNativeMicros
    ? convertTryPriceToUsdMicros(priceNativeMicros, trade.fxTryPerUsdMicros)
    : usdToMicros(draft.priceUsd)
  const feeUsdMicros = usdToMicros(draft.feeUsd || 0)
  if (trade.type === INVESTMENT_TRADE_TYPES.OPENING && feeUsdMicros !== 0) {
    return { ok: false, message: 'الرصيد الافتتاحي لا يقبل رسومًا.' }
  }
  if (!quantityUnits || !priceUsdMicros) {
    return { ok: false, message: 'الكمية والسعر يجب أن يكونا أكبر من صفر.' }
  }
  if (priceNativeMicros !== Number(trade.priceNativeMicros || 0) && priceUsdMicros === Number(trade.priceUsdMicros || 0)) {
    return { ok: false, message: 'فرق سعر الليرة أصغر من دقة USD. أدخل سعرًا أدق.' }
  }
  const nextTrade = {
    ...trade,
    quantityUnits,
    priceUsdMicros,
    ...(priceNativeMicros ? { priceNativeMicros } : {}),
    feeUsdMicros,
    note: cleanText(draft.note, 300),
    updatedAt,
  }
  if (!investmentTradeValueMicros(nextTrade) || !isValidDateValue(updatedAt)) {
    return { ok: false, message: 'قيمة عملية الاستثمار غير صالحة.' }
  }
  return { ok: true, trade: nextTrade }
}

export function investmentOpeningTradeIsLocked(trade = {}, trades = [], transfers = []) {
  if (!trade || trade.type !== INVESTMENT_TRADE_TYPES.OPENING || !trade.id || !trade.holdingId) return false
  const tradeTime = createdTime(trade)
  return transfers.some((transfer) => transfer?.sourceHoldingId === trade.holdingId
    && transfer.status !== INVESTMENT_RECORD_STATUSES.VOIDED) || trades.some((candidate) => (
    candidate?.id !== trade.id
    && candidate?.holdingId === trade.holdingId
    && candidate?.status !== INVESTMENT_RECORD_STATUSES.VOIDED
    && (
      createdTime(candidate) > tradeTime
      || (createdTime(candidate) === tradeTime && String(candidate.id).localeCompare(String(trade.id)) > 0)
    )
  ))
}

export function investmentTradeMatchesBaseline(currentTrade = {}, baselineTrade = {}) {
  if (!currentTrade?.id || currentTrade.id !== baselineTrade?.id) return false
  return ['platformId', 'holdingId', 'type', 'occurredAt', 'createdAt', 'updatedAt', 'quantityUnits', 'priceUsdMicros', 'priceNativeMicros', 'fxTryPerUsdMicros', 'fxQuotedAt', 'fxSource', 'feeUsdMicros', 'note', 'status']
    .every((field) => String(currentTrade[field] ?? '') === String(baselineTrade[field] ?? ''))
}

export function buildSmallInvestmentClosure(row = {}, createdAt = new Date().toISOString()) {
  const holding = row?.holding
  const quantityUnits = safePositiveInteger(row?.quantityUnits)
  if (!holding?.id || !holding?.platformId) {
    return { ok: false, message: 'الاستثمار غير موجود.' }
  }
  if (!quantityUnits) return { ok: true, kind: 'deactivate', holding }

  const priceUsdMicros = safePositiveInteger(holding.lastPriceUsdMicros)
  const marketValueUsdMicros = safeScaledProduct(quantityUnits, priceUsdMicros, INVESTMENT_QUANTITY_SCALE)
  if (!priceUsdMicros || !marketValueUsdMicros) {
    return { ok: false, message: 'حدّث السعر قبل إزالة الاستثمار.' }
  }
  if (marketValueUsdMicros >= SMALL_INVESTMENT_CLOSE_LIMIT_USD_MICROS) {
    return { ok: false, message: 'الإزالة متاحة فقط لقيمة أقل من 5 USD.' }
  }
  return {
    ok: true,
    kind: 'sell',
    holding,
    marketValueUsdMicros,
    trade: createInvestmentTrade({
      platformId: holding.platformId,
      holdingId: holding.id,
      type: INVESTMENT_TRADE_TYPES.SELL,
      quantityUnits,
      priceUsdMicros,
      feeUsdMicros: 0,
      note: 'إغلاق استثمار صغير',
    }, createdAt),
  }
}

export function applyInvestmentTradePriceFallback(holding = {}, trade = {}) {
  const priceUsdMicros = safePositiveInteger(trade.priceUsdMicros)
  if (
    safePositiveInteger(holding.lastPriceUsdMicros)
    || trade.type === INVESTMENT_TRADE_TYPES.SELL
    || !priceUsdMicros
  ) return holding
  const updatedAt = trade.occurredAt || trade.createdAt || holding.updatedAt || holding.createdAt || null
  return {
    ...holding,
    lastPriceUsdMicros: priceUsdMicros,
    lastPriceNativeMicros: holding.quoteCurrency === CURRENCIES.USD ? priceUsdMicros : safePositiveInteger(trade.priceNativeMicros),
    lastPriceAt: updatedAt,
    lastPriceQuotedAt: updatedAt,
    lastPriceFxQuotedAt: null,
    lastPriceMarketOpen: null,
    lastPriceSource: 'trade',
    lastPriceTradeId: trade.id || '',
    updatedAt: updatedAt || holding.updatedAt,
  }
}

export function applyInvestmentTradeEditPriceFallback(holding = {}, previousTrade = {}, nextTrade = {}) {
  const sourceTracksTrade = holding.lastPriceSource === 'trade' || holding.lastPriceSource === 'opening'
  const previousPrice = safePositiveInteger(previousTrade.priceUsdMicros)
  const nextPrice = safePositiveInteger(nextTrade.priceUsdMicros)
  const previousAt = previousTrade.occurredAt || previousTrade.createdAt || null
  const holdingPriceTime = new Date(holding.lastPriceAt || 0).getTime()
  const previousTradeTime = new Date(previousAt || 0).getTime()
  const linkedById = Boolean(holding.lastPriceTradeId && holding.lastPriceTradeId === previousTrade.id)
  const linkedByTime = Number.isFinite(holdingPriceTime)
    && Number.isFinite(previousTradeTime)
    && Math.abs(holdingPriceTime - previousTradeTime) <= 1_000
  if (
    !sourceTracksTrade
    || !previousPrice
    || !nextPrice
    || safePositiveInteger(holding.lastPriceUsdMicros) !== previousPrice
    || (!linkedById && !linkedByTime)
  ) return holding
  return {
    ...holding,
    previousPriceUsdMicros: safePositiveInteger(holding.lastPriceUsdMicros),
    previousPriceNativeMicros: safePositiveInteger(holding.lastPriceNativeMicros),
    previousPriceAt: holding.lastPriceAt || null,
    lastPriceUsdMicros: nextPrice,
    lastPriceNativeMicros: holding.quoteCurrency === CURRENCIES.USD ? nextPrice : safePositiveInteger(nextTrade.priceNativeMicros),
    lastPriceTradeId: nextTrade.id || previousTrade.id || holding.lastPriceTradeId || '',
    updatedAt: nextTrade.updatedAt || holding.updatedAt,
  }
}

export function investmentMovementCashMicros(movement = {}) {
  if (movement.status !== MOVEMENT_STATUSES.POSTED || movement.currency !== CURRENCIES.USD) return 0
  const amount = safePositiveInteger(Math.abs(movement.amount))
  const amountMicros = amount ? safeScaledProduct(amount, INVESTMENT_PRICE_SCALE, 1) : 0
  if (!amountMicros) return 0
  if (movement.type === MOVEMENT_TYPES.INVESTMENT_DEPOSIT) return Math.abs(amountMicros)
  if (movement.type === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL) return -Math.abs(amountMicros)
  return 0
}

function holdingEvents(holdingId, trades = [], transfers = []) {
  return [
    ...trades.filter((trade) => trade?.holdingId === holdingId && trade.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
      .map((record) => ({ kind: 'trade', record })),
    ...transfers.filter((transfer) => transfer?.asset === INVESTMENT_TRANSFER_ASSETS.USDT
      && transfer.status !== INVESTMENT_RECORD_STATUSES.VOIDED
      && (transfer.sourceHoldingId === holdingId || transfer.destinationHoldingId === holdingId))
      .map((record) => ({ kind: 'transfer', record })),
  ].sort((left, right) => createdTime(left.record) - createdTime(right.record)
    || String(left.record.id).localeCompare(String(right.record.id)))
}

function summarizeHolding(holding, trades = [], transfers = []) {
  let quantityUnits = 0
  let costBasisUsdMicros = 0
  let realizedProfitUsdMicros = 0
  for (const event of holdingEvents(holding.id, trades, transfers)) {
    if (event.kind === 'transfer') {
      const transfer = event.record
      const quantity = safePositiveInteger(transfer.quantityUnits)
      const cost = Math.max(0, safeInteger(transfer.costBasisUsdMicros))
      if (transfer.sourceHoldingId === holding.id) {
        quantityUnits -= quantity
        costBasisUsdMicros -= cost
      } else {
        quantityUnits += quantity
        costBasisUsdMicros += cost
      }
      continue
    }
    const trade = event.record
    const quantity = safePositiveInteger(trade.quantityUnits)
    const value = investmentTradeValueMicros(trade)
    const fee = Math.max(0, safeInteger(trade.feeUsdMicros))
    if (!quantity || !value) continue
    if (trade.type === INVESTMENT_TRADE_TYPES.OPENING || trade.type === INVESTMENT_TRADE_TYPES.BUY) {
      quantityUnits += quantity
      costBasisUsdMicros += value + fee
      continue
    }
    if (trade.type === INVESTMENT_TRADE_TYPES.SELL && quantity <= quantityUnits) {
      const removedCost = quantityUnits > 0
        ? safeScaledProduct(costBasisUsdMicros, quantity, quantityUnits)
        : 0
      quantityUnits -= quantity
      costBasisUsdMicros -= removedCost
      realizedProfitUsdMicros += value - fee - removedCost
    }
  }

  const marketValueUsdMicros = safeScaledProduct(
    quantityUnits,
    safePositiveInteger(holding.lastPriceUsdMicros),
    INVESTMENT_QUANTITY_SCALE,
  )
  const unrealizedProfitUsdMicros = marketValueUsdMicros - costBasisUsdMicros
  return {
    holding,
    quantityUnits,
    costBasisUsdMicros,
    averageCostUsdMicros: quantityUnits > 0
      ? safeScaledProduct(costBasisUsdMicros, INVESTMENT_QUANTITY_SCALE, quantityUnits)
      : 0,
    marketValueUsdMicros,
    unrealizedProfitUsdMicros,
    realizedProfitUsdMicros,
    totalProfitUsdMicros: unrealizedProfitUsdMicros + realizedProfitUsdMicros,
  }
}

export function summarizeInvestmentPortfolio({ platforms = [], holdings = [], trades = [], transfers = [], movements = [] } = {}) {
  const activePlatforms = platforms.filter((platform) => platform?.status !== INVESTMENT_RECORD_STATUSES.INACTIVE)
  const activeHoldings = holdings.filter((holding) => holding?.status !== INVESTMENT_RECORD_STATUSES.INACTIVE)
  const platformRows = activePlatforms.map((platform) => {
    const platformTrades = trades.filter((trade) => trade?.platformId === platform.id && trade.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
    const cashFromLedgerUsdMicros = movements
      .filter((movement) => movement?.investmentPlatformId === platform.id)
      .reduce((sum, movement) => sum + investmentMovementCashMicros(movement), 0)
    const cashFromTransfersUsdMicros = transfers
      .filter((transfer) => transfer?.asset === INVESTMENT_TRANSFER_ASSETS.USD && transfer.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
      .reduce((sum, transfer) => sum + (transfer.toPlatformId === platform.id ? transfer.amountUsdMicros : 0)
        - (transfer.fromPlatformId === platform.id ? transfer.amountUsdMicros : 0), 0)
    const tradeCashUsdMicros = platformTrades.reduce((sum, trade) => {
      const value = investmentTradeValueMicros(trade)
      const fee = Math.max(0, safeInteger(trade.feeUsdMicros))
      if (trade.type === INVESTMENT_TRADE_TYPES.BUY) return sum - value - fee
      if (trade.type === INVESTMENT_TRADE_TYPES.SELL) return sum + value - fee
      return sum
    }, 0)
    const allHoldingRows = activeHoldings
      .filter((holding) => holding.platformId === platform.id)
      .map((holding) => summarizeHolding(holding, platformTrades, transfers))
    const holdingRows = allHoldingRows.filter((row) => (
      row.quantityUnits > 0
      || !platformTrades.some((trade) => trade.holdingId === row.holding.id)
    ))
    const stablecoinUsdMicros = holdingRows
      .filter((row) => investmentHoldingIsLiquidity(row.holding))
      .reduce((sum, row) => sum + row.marketValueUsdMicros, 0)
    const investedMarketValueUsdMicros = holdingRows
      .filter((row) => !investmentHoldingIsLiquidity(row.holding))
      .reduce((sum, row) => sum + row.marketValueUsdMicros, 0)
    const freeCashUsdMicros = cashFromLedgerUsdMicros + cashFromTransfersUsdMicros + tradeCashUsdMicros
    const marketValueUsdMicros = stablecoinUsdMicros + investedMarketValueUsdMicros
    const investmentRows = allHoldingRows.filter((row) => !investmentHoldingIsLiquidity(row.holding))
    const openProfitUsdMicros = investmentRows.reduce((sum, row) => sum + row.unrealizedProfitUsdMicros, 0)
    const realizedInvestmentProfitUsdMicros = investmentRows.reduce((sum, row) => sum + row.realizedProfitUsdMicros, 0)
    return {
      platform,
      freeCashUsdMicros,
      stablecoinUsdMicros,
      liquidBalanceUsdMicros: freeCashUsdMicros + stablecoinUsdMicros,
      holdings: holdingRows,
      marketValueUsdMicros,
      investedMarketValueUsdMicros,
      totalValueUsdMicros: freeCashUsdMicros + marketValueUsdMicros,
      costBasisUsdMicros: holdingRows.reduce((sum, row) => sum + row.costBasisUsdMicros, 0),
      realizedProfitUsdMicros: allHoldingRows.reduce((sum, row) => sum + row.realizedProfitUsdMicros, 0),
      investmentProfitUsdMicros: openProfitUsdMicros + realizedInvestmentProfitUsdMicros,
      openProfitUsdMicros,
      realizedInvestmentProfitUsdMicros,
      closedHoldings: investmentRows.filter((row) => row.quantityUnits === 0 && row.realizedProfitUsdMicros !== 0),
    }
  })

  const freeCashUsdMicros = platformRows.reduce((sum, row) => sum + row.freeCashUsdMicros, 0)
  const stablecoinUsdMicros = platformRows.reduce((sum, row) => sum + row.stablecoinUsdMicros, 0)
  const liquidBalanceUsdMicros = freeCashUsdMicros + stablecoinUsdMicros
  const marketValueUsdMicros = platformRows.reduce((sum, row) => sum + row.marketValueUsdMicros, 0)
  const investedMarketValueUsdMicros = platformRows.reduce((sum, row) => sum + row.investedMarketValueUsdMicros, 0)
  const costBasisUsdMicros = platformRows.reduce((sum, row) => sum + row.costBasisUsdMicros, 0)
  const realizedProfitUsdMicros = platformRows.reduce((sum, row) => sum + row.realizedProfitUsdMicros, 0)
  const investmentProfitUsdMicros = platformRows.reduce((sum, row) => sum + row.investmentProfitUsdMicros, 0)
  const openProfitUsdMicros = platformRows.reduce((sum, row) => sum + row.openProfitUsdMicros, 0)
  const realizedInvestmentProfitUsdMicros = platformRows.reduce((sum, row) => sum + row.realizedInvestmentProfitUsdMicros, 0)
  const unrealizedProfitUsdMicros = marketValueUsdMicros - costBasisUsdMicros
  return {
    platforms: platformRows,
    freeCashUsdMicros,
    stablecoinUsdMicros,
    liquidBalanceUsdMicros,
    marketValueUsdMicros,
    investedMarketValueUsdMicros,
    totalValueUsdMicros: freeCashUsdMicros + marketValueUsdMicros,
    costBasisUsdMicros,
    unrealizedProfitUsdMicros,
    realizedProfitUsdMicros,
    investmentProfitUsdMicros,
    openProfitUsdMicros,
    realizedInvestmentProfitUsdMicros,
    totalProfitUsdMicros: unrealizedProfitUsdMicros + realizedProfitUsdMicros,
  }
}

export function validateInvestmentState({ platforms = [], holdings = [], trades = [], transfers = [], movements = [] } = {}) {
  const errors = []
  const platformById = new Map()
  const holdingById = new Map()
  for (const platform of platforms) {
    if (!platform?.id || platformById.has(platform.id)) errors.push({ field: 'investmentPlatforms', message: 'منصة الاستثمار ناقصة أو مكررة.' })
    else platformById.set(platform.id, platform)
    if (!cleanText(platform?.name)) errors.push({ field: 'investmentPlatforms', id: platform?.id, message: 'اسم منصة الاستثمار مطلوب.' })
    if (!INVESTMENT_PLATFORM_KINDS.has(platform?.kind) || ![INVESTMENT_RECORD_STATUSES.ACTIVE, INVESTMENT_RECORD_STATUSES.INACTIVE].includes(platform?.status)) {
      errors.push({ field: 'investmentPlatforms', id: platform?.id, message: 'نوع أو حالة منصة الاستثمار غير صالحة.' })
    }
  }
  const activeSymbols = new Set()
  for (const holding of holdings) {
    if (!holding?.id || holdingById.has(holding.id)) errors.push({ field: 'investmentHoldings', message: 'الاستثمار ناقص أو مكرر.' })
    else holdingById.set(holding.id, holding)
    if (!platformById.has(holding?.platformId)) errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'منصة الاستثمار غير موجودة.' })
    const providerSymbol = cleanText(holding?.providerSymbol, 80).toUpperCase()
    if (!cleanText(holding?.name) || !cleanText(holding?.symbol)) errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'اسم الاستثمار ورمزه مطلوبان.' })
    if (!providerSymbol || !INVESTMENT_PROVIDER_SYMBOL_PATTERN.test(providerSymbol)) {
      errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'رمز مصدر السعر غير صالح.' })
    }
    if (!Object.values(INVESTMENT_ASSET_TYPES).includes(holding?.assetType) || !INVESTMENT_QUOTE_CURRENCIES.has(holding?.quoteCurrency)) {
      errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'نوع الاستثمار أو عملة السوق غير صالحة.' })
    }
    if (![INVESTMENT_RECORD_STATUSES.ACTIVE, INVESTMENT_RECORD_STATUSES.INACTIVE].includes(holding?.status)) {
      errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'حالة الاستثمار غير صالحة.' })
    }
    if (
      !Number.isSafeInteger(Number(holding?.lastPriceUsdMicros || 0))
      || Number(holding?.lastPriceUsdMicros || 0) < 0
      || !Number.isSafeInteger(Number(holding?.lastPriceNativeMicros || 0))
      || Number(holding?.lastPriceNativeMicros || 0) < 0
      || !Number.isSafeInteger(Number(holding?.previousPriceUsdMicros || 0))
      || Number(holding?.previousPriceUsdMicros || 0) < 0
      || !Number.isSafeInteger(Number(holding?.previousPriceNativeMicros || 0))
      || Number(holding?.previousPriceNativeMicros || 0) < 0
      || (holding?.lastPriceAt && !isValidDateValue(holding.lastPriceAt))
      || (holding?.lastPriceQuotedAt && !isValidDateValue(holding.lastPriceQuotedAt))
      || (holding?.lastPriceFxQuotedAt && !isValidDateValue(holding.lastPriceFxQuotedAt))
      || (holding?.previousPriceAt && !isValidDateValue(holding.previousPriceAt))
    ) {
      errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'السعر المحفوظ للاستثمار غير صالح.' })
    }
    if (holding?.status !== INVESTMENT_RECORD_STATUSES.INACTIVE) {
      if (platformById.get(holding?.platformId)?.status === INVESTMENT_RECORD_STATUSES.INACTIVE) {
        errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'لا يمكن إبقاء استثمار نشط داخل منصة متوقفة.' })
      }
      const symbolKey = `${holding?.platformId || ''}:${cleanText(holding?.symbol, 32).toUpperCase()}`
      if (activeSymbols.has(symbolKey)) errors.push({ field: 'investmentHoldings', id: holding?.id, message: 'رمز الاستثمار مكرر في المنصة نفسها.' })
      activeSymbols.add(symbolKey)
    }
  }
  for (const trade of trades) {
    if (!trade?.id || !holdingById.has(trade?.holdingId) || !platformById.has(trade?.platformId)) {
      errors.push({ field: 'investmentTrades', id: trade?.id, message: 'عملية الاستثمار غير مرتبطة باستثمار ومنصة صحيحين.' })
      continue
    }
    if (holdingById.get(trade.holdingId)?.platformId !== trade.platformId) errors.push({ field: 'investmentTrades', id: trade.id, message: 'الاستثمار لا يتبع المنصة المختارة.' })
    if (!Object.values(INVESTMENT_TRADE_TYPES).includes(trade.type) || !safePositiveInteger(trade.quantityUnits) || !safePositiveInteger(trade.priceUsdMicros) || !investmentTradeValueMicros(trade) || ![INVESTMENT_RECORD_STATUSES.ACTIVE, INVESTMENT_RECORD_STATUSES.VOIDED].includes(trade.status) || safeInteger(trade.feeUsdMicros, -1) < 0 || (trade.type === INVESTMENT_TRADE_TYPES.OPENING && safeInteger(trade.feeUsdMicros) !== 0)) {
      errors.push({ field: 'investmentTrades', id: trade.id, message: 'كمية أو سعر عملية الاستثمار غير صالح.' })
    }
    if (trade.priceNativeMicros !== undefined || trade.fxTryPerUsdMicros !== undefined) {
      if (holdingById.get(trade.holdingId)?.quoteCurrency !== CURRENCIES.TRY
        || !safePositiveInteger(trade.priceNativeMicros)
        || !safePositiveInteger(trade.fxTryPerUsdMicros)
        || !isValidDateValue(trade.fxQuotedAt)
        || !['twelve-data', 'ecb-reference', 'manual'].includes(trade.fxSource)
        || convertTryPriceToUsdMicros(trade.priceNativeMicros, trade.fxTryPerUsdMicros) !== trade.priceUsdMicros) {
        errors.push({ field: 'investmentTrades', id: trade.id, message: 'سعر الليرة أو تحويله إلى USD غير متطابق.' })
      }
    }
    if (!isValidDateValue(trade.occurredAt || trade.createdAt)) {
      errors.push({ field: 'investmentTrades', id: trade.id, message: 'تاريخ عملية الاستثمار غير صالح.' })
    }
  }
  const transferIds = new Set()
  for (const transfer of transfers) {
    if (!transfer?.id || transferIds.has(transfer.id)) {
      errors.push({ field: 'investmentTransfers', id: transfer?.id, message: 'النقل ناقص أو مكرر.' })
    }
    transferIds.add(transfer?.id)
    const source = platformById.get(transfer?.fromPlatformId)
    const destination = platformById.get(transfer?.toPlatformId)
    if (!source || !destination || source.id === destination.id
      || source.status !== INVESTMENT_RECORD_STATUSES.ACTIVE
      || destination.status !== INVESTMENT_RECORD_STATUSES.ACTIVE) {
      errors.push({ field: 'investmentTransfers', id: transfer?.id, message: 'اختر منصتين مختلفتين ونشطتين.' })
    }
    if (!Object.values(INVESTMENT_TRANSFER_ASSETS).includes(transfer?.asset)
      || ![INVESTMENT_RECORD_STATUSES.ACTIVE, INVESTMENT_RECORD_STATUSES.VOIDED].includes(transfer?.status)
      || !isValidDateValue(transfer?.occurredAt)
      || !isValidDateValue(transfer?.createdAt)
      || String(transfer?.note || '').length > 300) {
      errors.push({ field: 'investmentTransfers', id: transfer?.id, message: 'بيانات النقل غير صالحة.' })
    }
    if (transfer?.asset === INVESTMENT_TRANSFER_ASSETS.USD) {
      if (!safePositiveInteger(transfer.amountUsdMicros) || transfer.sourceHoldingId || transfer.destinationHoldingId
        || transfer.quantityUnits || transfer.costBasisUsdMicros) {
        errors.push({ field: 'investmentTransfers', id: transfer.id, message: 'قيمة نقل الدولار غير صالحة.' })
      }
    } else if (transfer?.asset === INVESTMENT_TRANSFER_ASSETS.USDT) {
      const sourceHolding = holdingById.get(transfer.sourceHoldingId)
      const destinationHolding = holdingById.get(transfer.destinationHoldingId)
      if (!sourceHolding || !destinationHolding || sourceHolding.id === destinationHolding.id
        || sourceHolding.platformId !== transfer.fromPlatformId
        || destinationHolding.platformId !== transfer.toPlatformId
        || sourceHolding.status !== INVESTMENT_RECORD_STATUSES.ACTIVE
        || destinationHolding.status !== INVESTMENT_RECORD_STATUSES.ACTIVE
        || sourceHolding.quoteCurrency !== CURRENCIES.USD
        || destinationHolding.quoteCurrency !== CURRENCIES.USD
        || !investmentHoldingIsLiquidity(sourceHolding)
        || !investmentHoldingIsLiquidity(destinationHolding)
        || !safePositiveInteger(transfer.quantityUnits)
        || !Number.isSafeInteger(transfer.costBasisUsdMicros)
        || transfer.costBasisUsdMicros < 0
        || transfer.amountUsdMicros) {
        errors.push({ field: 'investmentTransfers', id: transfer.id, message: 'كمية أو محفظة USDT غير صالحة.' })
      }
    }
  }
  for (const holding of holdings) {
    let availableUnits = 0n
    let grossCostUsdMicros = 0n
    const events = holdingEvents(holding.id, trades, transfers)
    if (holding.status === INVESTMENT_RECORD_STATUSES.INACTIVE && events.length) {
      errors.push({ field: 'investmentHoldings', id: holding.id, message: 'لا يمكن إيقاف استثمار له عمليات محفوظة.' })
    }
    for (const event of events) {
      if (event.kind === 'transfer') {
        const transfer = event.record
        const quantity = BigInt(safePositiveInteger(transfer.quantityUnits))
        const cost = BigInt(Math.max(0, safeInteger(transfer.costBasisUsdMicros)))
        if (transfer.sourceHoldingId === holding.id) {
          if (quantity > availableUnits) {
            errors.push({ field: 'investmentTransfers', id: transfer.id, message: 'رصيد USDT في المنصة الأولى غير كافٍ.' })
            continue
          }
          const expectedCost = BigInt(safeScaledProduct(Number(grossCostUsdMicros), Number(quantity), Number(availableUnits)))
          if (cost !== expectedCost) {
            errors.push({ field: 'investmentTransfers', id: transfer.id, message: 'تكلفة USDT المنقولة لا تطابق الرصيد الأصلي.' })
          }
          availableUnits -= quantity
          grossCostUsdMicros -= cost
        } else {
          availableUnits += quantity
          grossCostUsdMicros += cost
        }
        if (availableUnits > BigInt(Number.MAX_SAFE_INTEGER) || grossCostUsdMicros < 0n
          || grossCostUsdMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
          errors.push({ field: 'investmentTransfers', id: transfer.id, message: 'النقل تجاوز حد الدقة المسموح.' })
        }
        continue
      }
      const trade = event.record
      const quantityUnits = safePositiveInteger(trade.quantityUnits)
      const quantity = BigInt(quantityUnits)
      if (trade.type === INVESTMENT_TRADE_TYPES.OPENING || trade.type === INVESTMENT_TRADE_TYPES.BUY) {
        availableUnits += quantity
        grossCostUsdMicros += BigInt(investmentTradeValueMicros(trade)) + BigInt(Math.max(0, safeInteger(trade.feeUsdMicros)))
        if (availableUnits > BigInt(Number.MAX_SAFE_INTEGER) || grossCostUsdMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
          errors.push({ field: 'investmentTrades', id: trade.id, message: 'إجمالي الاستثمار تجاوز حد الدقة المسموح.' })
        }
      }
      if (trade.type === INVESTMENT_TRADE_TYPES.SELL) {
        if (quantity > availableUnits) {
          errors.push({ field: 'investmentTrades', id: trade.id, message: 'لا يمكن بيع كمية أكبر من الكمية الموجودة.' })
        } else {
          grossCostUsdMicros -= BigInt(safeScaledProduct(Number(grossCostUsdMicros), Number(quantity), Number(availableUnits)))
          availableUnits -= quantity
        }
      }
    }
  }
  for (const platform of platforms) {
    if (platform.status === INVESTMENT_RECORD_STATUSES.INACTIVE && (
      holdings.some((holding) => holding.platformId === platform.id)
      || trades.some((trade) => trade.platformId === platform.id)
      || transfers.some((transfer) => transfer.fromPlatformId === platform.id || transfer.toPlatformId === platform.id)
      || movements.some((movement) => movement.investmentPlatformId === platform.id)
    )) {
      errors.push({ field: 'investmentPlatforms', id: platform.id, message: 'لا يمكن إيقاف منصة مرتبطة ببيانات محفوظة.' })
    }
    let freeCashUsdMicros = 0n
    for (const movement of movements) {
      if (movement?.investmentPlatformId === platform.id) freeCashUsdMicros += BigInt(investmentMovementCashMicros(movement))
    }
    for (const trade of trades) {
      if (trade?.platformId !== platform.id || trade.status === INVESTMENT_RECORD_STATUSES.VOIDED) continue
      const value = BigInt(investmentTradeValueMicros(trade))
      const fee = BigInt(Math.max(0, safeInteger(trade.feeUsdMicros)))
      if (trade.type === INVESTMENT_TRADE_TYPES.BUY) freeCashUsdMicros -= value + fee
      if (trade.type === INVESTMENT_TRADE_TYPES.SELL) freeCashUsdMicros += value - fee
    }
    for (const transfer of transfers) {
      if (transfer.asset !== INVESTMENT_TRANSFER_ASSETS.USD || transfer.status === INVESTMENT_RECORD_STATUSES.VOIDED) continue
      if (transfer.fromPlatformId === platform.id) freeCashUsdMicros -= BigInt(safePositiveInteger(transfer.amountUsdMicros))
      if (transfer.toPlatformId === platform.id) freeCashUsdMicros += BigInt(safePositiveInteger(transfer.amountUsdMicros))
    }
    if (freeCashUsdMicros < 0n) errors.push({ field: 'investmentTrades', id: platform.id, message: 'النقد الحر في منصة الاستثمار لا يمكن أن يصبح سالبًا.' })
    if (freeCashUsdMicros > BigInt(Number.MAX_SAFE_INTEGER) || freeCashUsdMicros < BigInt(Number.MIN_SAFE_INTEGER)) {
      errors.push({ field: 'investmentTrades', id: platform.id, message: 'إجمالي نقد الاستثمار تجاوز حد الدقة المسموح.' })
    }
  }
  for (const movement of movements) {
    if (![MOVEMENT_TYPES.INVESTMENT_DEPOSIT, MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL].includes(movement?.type)) continue
    if (!platformById.has(movement.investmentPlatformId)) errors.push({ field: 'investmentPlatformId', id: movement.id, message: 'منصة حركة الاستثمار غير موجودة.' })
    if (movement?.status === MOVEMENT_STATUSES.POSTED && !investmentMovementCashMicros(movement)) {
      errors.push({ field: 'amount', id: movement.id, message: `قيمة حركة الاستثمار يجب ألا تتجاوز ${MAX_INVESTMENT_USD.toLocaleString('en-US')} USD.` })
    }
  }
  const summary = summarizeInvestmentPortfolio({ platforms, holdings, trades, transfers, movements })
  for (const value of [summary.freeCashUsdMicros, summary.stablecoinUsdMicros, summary.liquidBalanceUsdMicros, summary.marketValueUsdMicros, summary.investedMarketValueUsdMicros, summary.totalValueUsdMicros, summary.costBasisUsdMicros, summary.realizedProfitUsdMicros, summary.unrealizedProfitUsdMicros, summary.investmentProfitUsdMicros, summary.totalProfitUsdMicros]) {
    if (!Number.isSafeInteger(value)) {
      errors.push({ field: 'investmentTrades', message: 'إجمالي المحفظة تجاوز حد الدقة المسموح.' })
      break
    }
  }
  return { ok: errors.length === 0, errors, summary }
}
