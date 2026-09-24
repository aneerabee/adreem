const FREE_METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD'])
const FREE_CRYPTO = new Set(['BTC', 'ETH'])
const DEX_CRYPTO = new Set(['FET', 'AVAX'])
export const REFERENCE_CRYPTO_SYMBOLS = new Set([...FREE_CRYPTO, ...DEX_CRYPTO])
const COINGECKO_PROVIDER_SYMBOL = /^([A-Z0-9]{1,15})\/USD:CG-([A-Z0-9]+(?:-[A-Z0-9]+)*)$/
const COINGECKO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_COINGECKO_ID_LENGTH = 55
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX'])
const TURKISH_PROVIDER_SYMBOL = /^([A-Z0-9.]{2,12}):BURKUT$/

export function burkutSymbolForHolding(holding = {}) {
  if (holding.marketDataMode === 'manual' || !['stock', 'fund'].includes(holding.assetType)
    || String(holding.quoteCurrency || '').toUpperCase() !== 'TRY') return ''
  const providerSymbol = String(holding.providerSymbol || holding.symbol || '').trim().toUpperCase()
  const match = TURKISH_PROVIDER_SYMBOL.exec(providerSymbol)
  if (!match) return ''
  const symbol = String(holding.symbol || '').trim().toUpperCase()
  if (symbol && symbol !== match[1] && symbol !== match[0]) return ''
  const exchange = String(holding.exchange || '').trim().toUpperCase()
  if (exchange && !['BURKUT', 'BIST', 'TEFAS'].includes(exchange)) return ''
  return `${match[1]}:BURKUT`
}

export function tgmEodSymbolForHolding(holding = {}) {
  if (holding.marketDataMode === 'manual' || !['stock', 'fund'].includes(holding.assetType)
    || String(holding.quoteCurrency || '').toUpperCase() !== 'USD') return ''
  const providerSymbol = String(holding.providerSymbol || holding.symbol || '').trim().toUpperCase()
  const match = /^([A-Z][A-Z0-9.]{0,9}):(TGM|NYSE|NASDAQ|AMEX)$/.exec(providerSymbol)
  if (!match) return ''
  const [, ticker, source] = match
  const symbol = String(holding.symbol || '').trim().toUpperCase()
  const exchange = String(holding.exchange || '').trim().toUpperCase()
  if (symbol && symbol !== ticker && symbol !== `${ticker}:TGM`) return ''
  if (source !== 'TGM' && ((!US_EXCHANGES.has(source)) || (exchange && exchange !== source))) return ''
  return `${ticker}:TGM`
}

export function isTgmEodHolding(holding = {}) {
  return Boolean(tgmEodSymbolForHolding(holding))
}

export function freeReferenceSymbol(holding = {}) {
  if (String(holding.quoteCurrency || '').toUpperCase() !== 'USD') return ''
  const symbol = String(holding.symbol || holding.providerSymbol || '').toUpperCase().split(':')[0]
  const [base, quote] = symbol.split('/')
  if (quote !== 'USD') return ''
  if (holding.assetType === 'metal' && FREE_METALS.has(base)) return base
  if (holding.assetType === 'crypto' && FREE_CRYPTO.has(base)) return base
  return ''
}

export function dexReferenceSymbol(holding = {}) {
  if (holding.assetType !== 'crypto' || String(holding.quoteCurrency || '').toUpperCase() !== 'USD') return ''
  const symbol = String(holding.symbol || holding.providerSymbol || '').toUpperCase().split(':')[0]
  const [base, quote] = symbol.split('/')
  return quote === 'USD' && DEX_CRYPTO.has(base) ? base : ''
}

export function coinGeckoProviderSymbol(symbol = '', coinId = '') {
  const base = String(symbol || '').trim().toUpperCase()
  const id = String(coinId || '').trim()
  if (!/^[A-Z0-9]{1,15}$/.test(base) || id.length > MAX_COINGECKO_ID_LENGTH || !COINGECKO_ID.test(id)) return ''
  return `${base}/USD:CG-${id.toUpperCase()}`
}

export function coinGeckoIdForHolding(holding = {}) {
  if (holding.assetType !== 'crypto' || holding.marketDataMode === 'manual'
    || String(holding.quoteCurrency || '').toUpperCase() !== 'USD') return ''
  const providerSymbol = String(holding.providerSymbol || holding.symbol || '').trim().toUpperCase()
  const match = COINGECKO_PROVIDER_SYMBOL.exec(providerSymbol)
  if (!match || REFERENCE_CRYPTO_SYMBOLS.has(match[1]) || match[2].length > MAX_COINGECKO_ID_LENGTH) return ''
  const symbol = String(holding.symbol || '').trim().toUpperCase()
  if (symbol && symbol !== `${match[1]}/USD` && symbol !== providerSymbol) return ''
  return match[2].toLowerCase()
}

export function isAutoPricedHolding(holding = {}, licensedStocksEnabled = false) {
  if (holding.status === 'inactive' || holding.marketDataMode === 'manual') return false
  if (freeReferenceSymbol(holding)) return true
  if (dexReferenceSymbol(holding)) return true
  if (coinGeckoIdForHolding(holding)) return true
  if (isTgmEodHolding(holding)) return true
  if (burkutSymbolForHolding(holding)) return true
  return licensedStocksEnabled && Boolean(holding.providerSymbol || holding.symbol)
    && ['stock', 'fund'].includes(holding.assetType)
    && ['USD', 'TRY', 'EUR'].includes(holding.quoteCurrency)
}
