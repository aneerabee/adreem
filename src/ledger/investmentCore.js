import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'

export const INVESTMENT_QUANTITY_SCALE = 100_000_000
export const INVESTMENT_PRICE_SCALE = 1_000_000
export const MAX_INVESTMENT_USD_MICROS = Number.MAX_SAFE_INTEGER
export const MAX_INVESTMENT_USD = Math.floor(MAX_INVESTMENT_USD_MICROS / INVESTMENT_PRICE_SCALE)
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

export function parseInvestmentDecimal(value) {
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

export function investmentTradeValueMicros(trade = {}) {
  const quantityUnits = safePositiveInteger(trade.quantityUnits)
  const priceUsdMicros = safePositiveInteger(trade.priceUsdMicros)
  if (!quantityUnits || !priceUsdMicros) return 0
  return safeScaledProduct(quantityUnits, priceUsdMicros, INVESTMENT_QUANTITY_SCALE)
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
    assetType,
    exchange: cleanText(draft.exchange, 40).toUpperCase(),
    quoteCurrency: normalizedQuoteCurrency,
    lastPriceUsdMicros,
    lastPriceNativeMicros: safePositiveInteger(draft.lastPriceNativeMicros)
      || (normalizedQuoteCurrency === CURRENCIES.USD ? lastPriceUsdMicros : 0),
    lastPriceAt: draft.lastPriceAt || (openingPriceUsdMicros ? createdAt : null),
    lastPriceSource: cleanText(draft.lastPriceSource, 40) || (openingPriceUsdMicros ? 'opening' : 'manual'),
    status: INVESTMENT_RECORD_STATUSES.ACTIVE,
    createdAt,
    updatedAt: createdAt,
  }
}

export function createInvestmentTrade(draft = {}, createdAt = new Date().toISOString()) {
  const type = Object.values(INVESTMENT_TRADE_TYPES).includes(draft.type)
    ? draft.type
    : INVESTMENT_TRADE_TYPES.BUY
  return {
    id: cleanText(draft.id, 160) || `investment-trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    platformId: cleanText(draft.platformId, 160),
    holdingId: cleanText(draft.holdingId, 160),
    type,
    quantityUnits: safePositiveInteger(draft.quantityUnits),
    priceUsdMicros: safePositiveInteger(draft.priceUsdMicros),
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
    lastPriceNativeMicros: holding.quoteCurrency === CURRENCIES.USD ? priceUsdMicros : 0,
    lastPriceAt: updatedAt,
    lastPriceSource: 'trade',
    updatedAt: updatedAt || holding.updatedAt,
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

function summarizeHolding(holding, trades = []) {
  let quantityUnits = 0
  let costBasisUsdMicros = 0
  let realizedProfitUsdMicros = 0
  const orderedTrades = trades
    .filter((trade) => trade?.holdingId === holding.id && trade.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
    .sort((left, right) => createdTime(left) - createdTime(right) || String(left.id).localeCompare(String(right.id)))

  for (const trade of orderedTrades) {
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

export function summarizeInvestmentPortfolio({ platforms = [], holdings = [], trades = [], movements = [] } = {}) {
  const activePlatforms = platforms.filter((platform) => platform?.status !== INVESTMENT_RECORD_STATUSES.INACTIVE)
  const activeHoldings = holdings.filter((holding) => holding?.status !== INVESTMENT_RECORD_STATUSES.INACTIVE)
  const platformRows = activePlatforms.map((platform) => {
    const platformTrades = trades.filter((trade) => trade?.platformId === platform.id && trade.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
    const cashFromLedgerUsdMicros = movements
      .filter((movement) => movement?.investmentPlatformId === platform.id)
      .reduce((sum, movement) => sum + investmentMovementCashMicros(movement), 0)
    const tradeCashUsdMicros = platformTrades.reduce((sum, trade) => {
      const value = investmentTradeValueMicros(trade)
      const fee = Math.max(0, safeInteger(trade.feeUsdMicros))
      if (trade.type === INVESTMENT_TRADE_TYPES.BUY) return sum - value - fee
      if (trade.type === INVESTMENT_TRADE_TYPES.SELL) return sum + value - fee
      return sum
    }, 0)
    const allHoldingRows = activeHoldings
      .filter((holding) => holding.platformId === platform.id)
      .map((holding) => summarizeHolding(holding, platformTrades))
    const holdingRows = allHoldingRows.filter((row) => (
      row.quantityUnits > 0
      || !platformTrades.some((trade) => trade.holdingId === row.holding.id)
    ))
    return {
      platform,
      freeCashUsdMicros: cashFromLedgerUsdMicros + tradeCashUsdMicros,
      holdings: holdingRows,
      marketValueUsdMicros: holdingRows.reduce((sum, row) => sum + row.marketValueUsdMicros, 0),
      costBasisUsdMicros: holdingRows.reduce((sum, row) => sum + row.costBasisUsdMicros, 0),
      realizedProfitUsdMicros: allHoldingRows.reduce((sum, row) => sum + row.realizedProfitUsdMicros, 0),
    }
  })

  const freeCashUsdMicros = platformRows.reduce((sum, row) => sum + row.freeCashUsdMicros, 0)
  const marketValueUsdMicros = platformRows.reduce((sum, row) => sum + row.marketValueUsdMicros, 0)
  const costBasisUsdMicros = platformRows.reduce((sum, row) => sum + row.costBasisUsdMicros, 0)
  const realizedProfitUsdMicros = platformRows.reduce((sum, row) => sum + row.realizedProfitUsdMicros, 0)
  const unrealizedProfitUsdMicros = marketValueUsdMicros - costBasisUsdMicros
  return {
    platforms: platformRows,
    freeCashUsdMicros,
    marketValueUsdMicros,
    totalValueUsdMicros: freeCashUsdMicros + marketValueUsdMicros,
    costBasisUsdMicros,
    unrealizedProfitUsdMicros,
    realizedProfitUsdMicros,
    totalProfitUsdMicros: unrealizedProfitUsdMicros + realizedProfitUsdMicros,
  }
}

export function validateInvestmentState({ platforms = [], holdings = [], trades = [], movements = [] } = {}) {
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
      || (holding?.lastPriceAt && !isValidDateValue(holding.lastPriceAt))
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
    if (!Object.values(INVESTMENT_TRADE_TYPES).includes(trade.type) || !safePositiveInteger(trade.quantityUnits) || !safePositiveInteger(trade.priceUsdMicros) || !investmentTradeValueMicros(trade) || ![INVESTMENT_RECORD_STATUSES.ACTIVE, INVESTMENT_RECORD_STATUSES.VOIDED].includes(trade.status) || safeInteger(trade.feeUsdMicros, -1) < 0) {
      errors.push({ field: 'investmentTrades', id: trade.id, message: 'كمية أو سعر عملية الاستثمار غير صالح.' })
    }
    if (!isValidDateValue(trade.occurredAt || trade.createdAt)) {
      errors.push({ field: 'investmentTrades', id: trade.id, message: 'تاريخ عملية الاستثمار غير صالح.' })
    }
  }
  for (const holding of holdings) {
    let availableUnits = 0n
    let grossCostUsdMicros = 0n
    const holdingTrades = trades
      .filter((trade) => trade?.holdingId === holding.id && trade.status !== INVESTMENT_RECORD_STATUSES.VOIDED)
      .sort((left, right) => createdTime(left) - createdTime(right) || String(left.id).localeCompare(String(right.id)))
    if (holding.status === INVESTMENT_RECORD_STATUSES.INACTIVE && holdingTrades.length) {
      errors.push({ field: 'investmentHoldings', id: holding.id, message: 'لا يمكن إيقاف استثمار له عمليات محفوظة.' })
    }
    for (const trade of holdingTrades) {
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
          availableUnits -= quantity
        }
      }
    }
  }
  for (const platform of platforms) {
    if (platform.status === INVESTMENT_RECORD_STATUSES.INACTIVE && (
      holdings.some((holding) => holding.platformId === platform.id)
      || trades.some((trade) => trade.platformId === platform.id)
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
  const summary = summarizeInvestmentPortfolio({ platforms, holdings, trades, movements })
  for (const value of [summary.freeCashUsdMicros, summary.marketValueUsdMicros, summary.totalValueUsdMicros, summary.costBasisUsdMicros, summary.realizedProfitUsdMicros, summary.unrealizedProfitUsdMicros, summary.totalProfitUsdMicros]) {
    if (!Number.isSafeInteger(value)) {
      errors.push({ field: 'investmentTrades', message: 'إجمالي المحفظة تجاوز حد الدقة المسموح.' })
      break
    }
  }
  return { ok: errors.length === 0, errors, summary }
}
