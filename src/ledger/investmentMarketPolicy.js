const FREE_METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD'])
const FREE_CRYPTO = new Set(['BTC', 'ETH'])
const DEX_CRYPTO = new Set(['FET', 'AVAX'])
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX'])

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

export function isAutoPricedHolding(holding = {}, licensedStocksEnabled = false) {
  if (holding.status === 'inactive' || holding.marketDataMode === 'manual') return false
  if (freeReferenceSymbol(holding)) return true
  if (dexReferenceSymbol(holding)) return true
  if (isTgmEodHolding(holding)) return true
  return licensedStocksEnabled && Boolean(holding.providerSymbol || holding.symbol)
    && ['stock', 'fund'].includes(holding.assetType)
    && ['USD', 'TRY', 'EUR'].includes(holding.quoteCurrency)
}
