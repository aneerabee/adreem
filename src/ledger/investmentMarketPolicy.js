const FREE_METALS = new Set(['XAU', 'XAG', 'XPT', 'XPD'])
const FREE_CRYPTO = new Set(['BTC', 'ETH'])

export function freeReferenceSymbol(holding = {}) {
  if (String(holding.quoteCurrency || '').toUpperCase() !== 'USD') return ''
  const symbol = String(holding.symbol || holding.providerSymbol || '').toUpperCase().split(':')[0]
  const [base, quote] = symbol.split('/')
  if (quote !== 'USD') return ''
  if (holding.assetType === 'metal' && FREE_METALS.has(base)) return base
  if (holding.assetType === 'crypto' && FREE_CRYPTO.has(base)) return base
  return ''
}

export function isAutoPricedHolding(holding = {}, licensedStocksEnabled = false) {
  if (holding.status === 'inactive' || holding.marketDataMode === 'manual') return false
  if (freeReferenceSymbol(holding)) return true
  return licensedStocksEnabled && Boolean(holding.providerSymbol || holding.symbol)
    && ['stock', 'fund'].includes(holding.assetType)
    && ['USD', 'TRY', 'EUR'].includes(holding.quoteCurrency)
}
