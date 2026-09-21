import { describe, expect, it } from 'vitest'
import { resolveInvestmentPlatformBrand } from './investmentPlatformBrands.js'

describe('investment platform brands', () => {
  it.each([
    ['TRUST WALLET', 'trust-wallet', 'Trust Wallet'],
    ['Kucoin', 'kucoin', 'KuCoin'],
    ['garanti', 'garanti-bbva', 'Garanti BBVA'],
    ['Exidus', 'exodus', 'Exodus'],
    ['Midas kripto', 'midas-kripto', 'Midas Kripto'],
    ['Midas', 'midas', 'Midas'],
    ['Kuveyt Turk', 'kuveyt-turk', 'Kuveyt Türk'],
    ['AKbank', 'akbank', 'Akbank'],
  ])('maps %s to its visual identity', (name, key, displayName) => {
    expect(resolveInvestmentPlatformBrand(name)).toMatchObject({ key, displayName })
  })

  it('keeps an unknown platform name with the neutral identity', () => {
    expect(resolveInvestmentPlatformBrand('My broker')).toMatchObject({
      key: 'default',
      displayName: 'My broker',
      logo: '',
    })
  })

  it('keeps Midas Kripto blue and regular Midas black', () => {
    expect(resolveInvestmentPlatformBrand('Midas kripto')).toMatchObject({ key: 'midas-kripto', accent: '#4c5cf0' })
    expect(resolveInvestmentPlatformBrand('Midas')).toMatchObject({ key: 'midas', accent: '#111111' })
  })
})
