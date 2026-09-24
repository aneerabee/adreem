import { describe, expect, it } from 'vitest'
import { assetBaseSymbol, assetMonogram, resolveAssetMark } from './assetMarks.js'

const INDEX = Object.freeze({
  version: 1,
  crypto: { harmony: '#00CDC2', bitcoin: '#F7931A', 'avalanche-2': '#E84142', polkadot: '#E6007A' },
  cryptoSymbols: { ONE: 'harmony', DOT: 'polkadot' },
  stocks: { 'US:F': ['ford', '#00274E'] },
})

describe('asset marks', () => {
  it('reads the base symbol from pairs and provider symbols', () => {
    expect(assetBaseSymbol({ symbol: 'one/usd' })).toBe('ONE')
    expect(assetBaseSymbol({ providerSymbol: 'SASA:BIST' })).toBe('SASA')
    expect(assetBaseSymbol({})).toBe('')
  })

  it('keeps short symbols whole and shortens long ones to two letters', () => {
    expect(assetMonogram('IO')).toBe('IO')
    expect(assetMonogram('NIL')).toBe('NIL')
    expect(assetMonogram('KONTR')).toBe('KO')
    expect(assetMonogram('')).toBe('•')
  })

  it('uses the exact market identity of a priced coin', () => {
    const mark = resolveAssetMark({ assetType: 'crypto', symbol: 'ONE/USD', providerSymbol: 'ONE/USD:CG-HARMONY', quoteCurrency: 'USD' }, INDEX, '/adreem/')
    expect(mark).toEqual({ kind: 'image', src: '/adreem/asset-marks/c/harmony.svg', color: '#00CDC2', text: 'ONE' })
  })

  it('never borrows another coin mark when the priced identity has none', () => {
    const mark = resolveAssetMark({ assetType: 'crypto', symbol: 'DOT/USD', providerSymbol: 'DOT/USD:CG-SOME-OTHER-DOT', quoteCurrency: 'USD' }, INDEX)
    expect(mark.kind).toBe('monogram')
    expect(mark.text).toBe('DOT')
  })

  it('maps reference coins and manual coins by symbol', () => {
    expect(resolveAssetMark({ assetType: 'crypto', symbol: 'AVAX/USD', quoteCurrency: 'USD' }, INDEX).src).toBe('/asset-marks/c/avalanche-2.svg')
    expect(resolveAssetMark({ assetType: 'crypto', symbol: 'BTC/USD', quoteCurrency: 'USD' }, INDEX).color).toBe('#F7931A')
    expect(resolveAssetMark({ assetType: 'crypto', symbol: 'DOT', marketDataMode: 'manual', quoteCurrency: 'USD' }, INDEX).src).toBe('/asset-marks/c/polkadot.svg')
  })

  it('gives metals their element letters without the index', () => {
    expect(resolveAssetMark({ assetType: 'metal', symbol: 'XAU/USD' }, null)).toEqual({ kind: 'monogram', text: 'Au', color: '#B8902D' })
  })

  it('matches company logos only on their own market', () => {
    expect(resolveAssetMark({ assetType: 'stock', symbol: 'F', quoteCurrency: 'USD' }, INDEX)).toMatchObject({ kind: 'image', src: '/asset-marks/s/ford.svg', color: '#00274E' })
    expect(resolveAssetMark({ assetType: 'stock', symbol: 'F', quoteCurrency: 'TRY' }, INDEX).kind).toBe('monogram')
  })

  it('gives unknown assets a stable letter mark from a fixed palette', () => {
    const first = resolveAssetMark({ assetType: 'stock', symbol: 'SASA', quoteCurrency: 'TRY' }, INDEX)
    const again = resolveAssetMark({ assetType: 'stock', symbol: 'SASA', quoteCurrency: 'TRY' }, false)
    expect(first).toEqual(again)
    expect(first).toMatchObject({ kind: 'monogram', text: 'SA' })
    expect(first.color).toMatch(/^#[0-9A-F]{6}$/)
  })
})
