import { describe, expect, it } from 'vitest'
import { coinGeckoIdForHolding, coinGeckoProviderSymbol, isAutoPricedHolding } from './investmentMarketPolicy.js'

const polkadot = { symbol: 'DOT/USD', providerSymbol: 'DOT/USD:CG-POLKADOT', assetType: 'crypto', quoteCurrency: 'USD', marketDataMode: 'provider' }

describe('investment market policy for CoinGecko coins', () => {
  it('builds one stored identity per coin and rejects malformed coins', () => {
    expect(coinGeckoProviderSymbol('dot', 'polkadot')).toBe('DOT/USD:CG-POLKADOT')
    expect(coinGeckoProviderSymbol('POL', 'polygon-ecosystem-token')).toBe('POL/USD:CG-POLYGON-ECOSYSTEM-TOKEN')
    expect(coinGeckoProviderSymbol('DOT', 'Polkadot')).toBe('')
    expect(coinGeckoProviderSymbol('DOT', 'bad id')).toBe('')
    expect(coinGeckoProviderSymbol('D.O.T', 'polkadot')).toBe('')
    expect(coinGeckoProviderSymbol('DOT', 'a'.repeat(56))).toBe('')
  })

  it('prices a stored coin only when its symbol, currency and mode agree', () => {
    expect(coinGeckoIdForHolding(polkadot)).toBe('polkadot')
    expect(coinGeckoIdForHolding({ symbol: 'DOT/USD:CG-POLKADOT', assetType: 'crypto', quoteCurrency: 'USD' })).toBe('polkadot')
    expect(isAutoPricedHolding(polkadot)).toBe(true)
    expect(coinGeckoIdForHolding({ ...polkadot, marketDataMode: 'manual' })).toBe('')
    expect(isAutoPricedHolding({ ...polkadot, marketDataMode: 'manual' })).toBe(false)
    expect(coinGeckoIdForHolding({ ...polkadot, quoteCurrency: 'TRY' })).toBe('')
    expect(coinGeckoIdForHolding({ ...polkadot, assetType: 'stock' })).toBe('')
    expect(coinGeckoIdForHolding({ ...polkadot, symbol: 'SOL/USD' })).toBe('')
  })

  it('keeps coins with a verified reference source on that source', () => {
    expect(coinGeckoIdForHolding({ ...polkadot, symbol: 'BTC/USD', providerSymbol: 'BTC/USD:CG-BITCOIN' })).toBe('')
    expect(coinGeckoIdForHolding({ ...polkadot, symbol: 'AVAX/USD', providerSymbol: 'AVAX/USD:CG-AVALANCHE-2' })).toBe('')
    expect(isAutoPricedHolding({ symbol: 'AVAX/USD', providerSymbol: 'AVAX/USD:BINANCE', assetType: 'crypto', quoteCurrency: 'USD' })).toBe(true)
  })
})
