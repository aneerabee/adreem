import { MOVEMENT_TYPES } from './ledgerCore.js'
import { INVESTMENT_ASSET_TYPES, MIN_VISIBLE_INVESTMENT_USD_MICROS, INVESTMENT_TRADE_TYPES, INVESTMENT_TRANSFER_ASSETS, investmentTradeValueMicros, microsToUsd } from './investmentCore.js'
import { getActiveUiLanguage } from './uiTranslation.js'
import { isAutoPricedHolding } from './investmentMarketPolicy.js'

export const ASSET_OPTIONS = [
  { value: INVESTMENT_ASSET_TYPES.STOCK, label: 'سهم مباشر' },
  { value: INVESTMENT_ASSET_TYPES.CRYPTO, label: 'عملة رقمية' },
  { value: INVESTMENT_ASSET_TYPES.METAL, label: 'معدن' },
  { value: INVESTMENT_ASSET_TYPES.FUND, label: 'صندوق' },
  { value: INVESTMENT_ASSET_TYPES.OTHER, label: 'أخرى' },
]

export const MARKET_OPTIONS = [
  { value: 'USD', label: 'أمريكا', currencyLabel: 'الدولار الأمريكي' },
  { value: 'TRY', label: 'تركيا', currencyLabel: 'الليرة التركية' },
]

export function assetUsesCurrencyMarket(assetType) {
  return assetType === INVESTMENT_ASSET_TYPES.CRYPTO || assetType === INVESTMENT_ASSET_TYPES.METAL
}

export function symbolPlaceholderFor(assetType) {
  if (assetType === INVESTMENT_ASSET_TYPES.CRYPTO) return 'DOT'
  if (assetType === INVESTMENT_ASSET_TYPES.METAL) return 'XAU'
  return 'THYAO'
}

export const blankPlatform = { name: '', kind: 'platform', location: '' }
export const blankHolding = { platformId: '', name: '', symbol: '', providerSymbol: '', marketDataMode: 'manual', assetType: INVESTMENT_ASSET_TYPES.STOCK, exchange: '', quoteCurrency: 'USD', initialQuantity: '', initialPriceUsd: '', initialPriceNative: '' }
export const blankTrade = { holdingId: '', type: INVESTMENT_TRADE_TYPES.BUY, quantity: '', priceUsd: '', priceNative: '', feeUsd: '', feeNative: '', note: '' }
export const blankTradeEdit = { quantity: '', priceUsd: '', priceNative: '', feeUsd: '', feeNative: '', feeNativeInitial: '', note: '' }
export const blankTransfer = { asset: INVESTMENT_TRANSFER_ASSETS.USD, fromPlatformId: '', toPlatformId: '', sourceHoldingId: '', amount: '', note: '' }
export const blankTryFx = { status: 'idle', rate: '', quotedAt: '', loadedAt: '', source: '', error: '' }
export const PRICE_SOURCE_LABELS = {
  coinbase: { ar: 'Coinbase', en: 'Coinbase' },
  'gold-api': { ar: 'Gold API', en: 'Gold API' },
  'gold-api-reference': { ar: 'سعر مرجعي', en: 'Reference price' },
  'dexscreener-reference': { ar: 'سعر مرجعي · DEX Screener', en: 'Reference price · DEX Screener' },
  'binance-usdt+coinbase-usdt-usd': { ar: 'Binance · تحويل Coinbase', en: 'Binance · Coinbase FX' },
  'binance-usdt+twelve-data-usdt-usd': { ar: 'Binance · تحويل Twelve Data', en: 'Binance · Twelve Data FX' },
  'twelve-data': { ar: 'Twelve Data', en: 'Twelve Data' },
  'twelve-data-eod+ecb-fx': { ar: 'إغلاق يومي · صرف أوروبي', en: 'Daily close · ECB FX' },
  'twelve-data+ecb-fx': { ar: 'Twelve Data · صرف أوروبي يومي', en: 'Twelve Data · ECB daily FX' },
  'tgmcharts-eod': { ar: 'TGMCharts · إغلاق يومي', en: 'TGMCharts · Daily close' },
  'burkut+ecb-fx': { ar: 'Bürküt · صرف أوروبي', en: 'Bürküt · ECB FX' },
  coingecko: { ar: 'CoinGecko', en: 'CoinGecko' },
  'kucoin-usdt+coingecko-usdt-usd': { ar: 'KuCoin · تحويل USDT', en: 'KuCoin · USDT FX' },
}

export function decimal(value, digits = 6, minimumDigits = 0) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return '0'
  return number.toLocaleString('en-US', { minimumFractionDigits: minimumDigits, maximumFractionDigits: digits })
}

function unitPrice(value) {
  const number = Number(value || 0)
  return decimal(number, Math.abs(number) >= 1 ? 2 : 6, 2)
}

export function profitToneClass(value) {
  return Number(value) > 0 ? 'is-positive' : Number(value) < 0 ? 'is-negative' : 'is-neutral'
}

export function usdMicros(value, sign = false) {
  const number = microsToUsd(value)
  return `${sign && number > 0 ? '+' : ''}${decimal(number, 2, 2)} USD`
}

export function tryMoneyMicros(value, sign = false) {
  const number = microsToUsd(value)
  return `${sign && number > 0 ? '+' : ''}${decimal(number, 2, 2)} TRY`
}

export function usdUnitMicros(value) {
  return `${unitPrice(microsToUsd(value))} USD`
}

export function tryUnitMicros(value) {
  return `${unitPrice(microsToUsd(value))} TRY`
}

export function assetTypeForMarketResult(result = {}) {
  const type = String(result.instrumentType || '').toLocaleLowerCase('en')
  if (type.includes('crypto')) return INVESTMENT_ASSET_TYPES.CRYPTO
  if (type.includes('metal') || type.includes('commodity')) return INVESTMENT_ASSET_TYPES.METAL
  if (type.includes('fund') || type.includes('etf')) return INVESTMENT_ASSET_TYPES.FUND
  if (type.includes('stock') || type.includes('equity') || type.includes('share')) return INVESTMENT_ASSET_TYPES.STOCK
  return INVESTMENT_ASSET_TYPES.OTHER
}

export function holdingTypeLabel(value) {
  return ASSET_OPTIONS.find((option) => option.value === value)?.label || 'أخرى'
}

export function profitPercent(profitUsdMicros, costBasisUsdMicros) {
  if (!costBasisUsdMicros) return ''
  return `${profitUsdMicros > 0 ? '+' : ''}${decimal((profitUsdMicros / costBasisUsdMicros) * 100, 2)}%`
}

export function holdingIsSmall(row = {}) {
  if (!Number(row.quantityUnits || 0)) return true
  return Number(row.holding?.lastPriceUsdMicros || 0) > 0
    && Number(row.marketValueUsdMicros || 0) < MIN_VISIBLE_INVESTMENT_USD_MICROS
}

export function platformLogoUrl(brand) {
  return brand.logo ? `${import.meta.env.BASE_URL}${brand.logo}` : ''
}

export function activityActionLabel(row) {
  if (row.action === INVESTMENT_TRADE_TYPES.OPENING) return 'رصيد افتتاحي'
  if (row.action === INVESTMENT_TRADE_TYPES.BUY) return 'شراء'
  if (row.action === INVESTMENT_TRADE_TYPES.SELL) return 'بيع'
  if (row.action === MOVEMENT_TYPES.INVESTMENT_DEPOSIT) return 'إيداع'
  if (row.action === MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL) return 'سحب'
  if (row.action === 'transfer_out') return 'نقل صادر'
  if (row.action === 'transfer_in') return 'نقل وارد'
  return 'عملية'
}

export function activityDate(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return 'بدون تاريخ'
  return date.toLocaleString(getActiveUiLanguage() === 'en' ? 'en-GB' : 'ar-LY', { dateStyle: 'medium', timeStyle: 'short' })
}

export function activityDay(value) {
  const date = new Date(value || 0)
  if (!Number.isFinite(date.getTime())) return 'بدون تاريخ'
  return date.toLocaleDateString(getActiveUiLanguage() === 'en' ? 'en-GB' : 'ar-LY', { dateStyle: 'medium', timeZone: 'UTC' })
}

export function accountLabel(account) {
  if (!account) return ''
  return [account.ownerName, account.subAccountName].filter(Boolean).join(' · ')
}

export function tradeReviewImpact(trade = {}) {
  if (!trade) return { label: 'أثر النقد', valueUsdMicros: 0 }
  const valueUsdMicros = investmentTradeValueMicros(trade)
  const feeUsdMicros = Math.max(0, Number(trade.feeUsdMicros || 0))
  if (trade.type === INVESTMENT_TRADE_TYPES.OPENING) {
    return { label: 'التكلفة', valueUsdMicros: valueUsdMicros + feeUsdMicros }
  }
  if (trade.type === INVESTMENT_TRADE_TYPES.BUY) {
    return { label: 'أثر النقد', valueUsdMicros: -(valueUsdMicros + feeUsdMicros) }
  }
  return { label: 'أثر النقد', valueUsdMicros: valueUsdMicros - feeUsdMicros }
}

export function holdingPriceIsStale(holding) {
  if (Number(holding.lastPriceUsdMicros || 0) <= 0) return false
  const automated = isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true')
  const sourceUnavailable = Boolean(holding.lastPriceSource && !['manual', 'trade', 'opening'].includes(holding.lastPriceSource) && !automated)
  if (sourceUnavailable) return true
  if (!automated) return false
  const quotedAge = Date.now() - Date.parse(String(holding.lastPriceQuotedAt || ''))
  const dailyClose = ['tgmcharts-eod', 'twelve-data-eod+ecb-fx', 'burkut+ecb-fx'].includes(holding.lastPriceSource)
  const maxQuoteAge = holding.assetType === 'crypto' ? 15 * 60 * 1000 : dailyClose || holding.lastPriceMarketOpen === false ? 7 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
  return !Number.isFinite(quotedAge) || quotedAge > maxQuoteAge
}

export function holdingPriceLabel(holding) {
  const nativeMicros = Number(holding.lastPriceNativeMicros || 0)
  return holding.quoteCurrency === 'TRY' && nativeMicros > 0 ? tryUnitMicros(nativeMicros) : usdUnitMicros(holding.lastPriceUsdMicros)
}
