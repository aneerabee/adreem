import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import InvestmentsPanel from './InvestmentsPanel.jsx'
import { createInvestmentHolding, createInvestmentPlatform, usdToMicros } from './investmentCore.js'
import { setActiveUiLanguage } from './uiTranslation.js'

const previousReact = globalThis.React

beforeAll(() => {
  globalThis.React = React
})

afterAll(() => {
  globalThis.React = previousReact
  setActiveUiLanguage('ar')
})

function callbacks() {
  return {
    onAddPlatform: vi.fn(),
    onAddHolding: vi.fn(),
    onAddTrade: vi.fn(),
    onManualPrice: vi.fn(),
    onCloseSmallHolding: vi.fn(),
    onOpenFunding: vi.fn(),
    onRefreshPrices: vi.fn(),
    onSearchAssets: vi.fn(),
  }
}

describe('investments panel', () => {
  it('shows a compact empty state without inventing investment data', () => {
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      {...callbacks()}
    />)

    expect(html).toContain('adreem-investments')
    expect(html).toContain('ابدأ بمنصة واحدة')
    expect(html).toContain('USD')
  })

  it('keeps platform, holding, value, and profit visually distinct', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'IBKR', location: 'Turkey' })
    const holding = createInvestmentHolding({ id: 'holding-1', platformId: platform.id, name: 'Apple', symbol: 'AAPL', lastPriceUsdMicros: usdToMicros(120) })
    const summary = {
      platforms: [{
        platform,
        freeCashUsdMicros: usdToMicros(500),
        holdings: [{ holding, quantityUnits: 500_000_000, averageCostUsdMicros: usdToMicros(100), costBasisUsdMicros: usdToMicros(500), marketValueUsdMicros: usdToMicros(600), unrealizedProfitUsdMicros: usdToMicros(100) }],
      }],
      totalValueUsdMicros: usdToMicros(1_100),
      costBasisUsdMicros: usdToMicros(500),
      unrealizedProfitUsdMicros: usdToMicros(100),
      freeCashUsdMicros: usdToMicros(500),
    }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)

    expect(html).toContain('IBKR')
    expect(html).toContain('AAPL')
    expect(html).toContain('الكمية')
    expect(html).toContain('وقت الشراء')
    expect(html).toContain('السوق الآن')
    expect(html).toContain('المكسب / الخسارة')
    expect(html).toContain('adreem-investment-metrics-strip')
    expect(html).toContain('adreem-investment-phase is-entry')
    expect(html).toContain('adreem-investment-phase is-live')
    expect(html).toContain('adreem-investment-market-dot')
    expect(html).toContain('500 USD')
    expect(html).toContain('600 USD')
    expect(html).toContain('+100 USD')
    expect(html).toContain('is-profit-positive')
  })

  it('uses the official visual identity for a known platform alias', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'Exidus', location: 'iPhone' })
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [{ platform, freeCashUsdMicros: 0, holdings: [] }], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      platforms={[platform]}
      {...callbacks()}
    />)

    expect(html).toContain('is-brand-exodus')
    expect(html).toContain('platforms/exodus.svg')
    expect(html).toContain('Exodus')
    expect(html).toContain('السجل')
  })

  it('visually separates Midas Kripto from regular Midas', () => {
    const crypto = createInvestmentPlatform({ id: 'platform-crypto', name: 'Midas kripto' })
    const regular = createInvestmentPlatform({ id: 'platform-regular', name: 'Midas' })
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [{ platform: crypto, freeCashUsdMicros: 0, holdings: [] }, { platform: regular, freeCashUsdMicros: 0, holdings: [] }], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      platforms={[crypto, regular]}
      {...callbacks()}
    />)

    expect(html).toContain('is-brand-midas-kripto')
    expect(html).toContain('is-brand-midas')
    expect(html).toContain('--platform-accent:#4c5cf0')
    expect(html).toContain('--platform-accent:#111111')
  })

  it('hides sub-1 USD positions by default without deleting them from the platform', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'IBKR' })
    const tiny = createInvestmentHolding({ id: 'tiny', platformId: platform.id, name: 'Dust', symbol: 'DST', lastPriceUsdMicros: usdToMicros(0.5) })
    const large = createInvestmentHolding({ id: 'large', platformId: platform.id, name: 'Large', symbol: 'LRG', lastPriceUsdMicros: usdToMicros(10) })
    const summary = {
      platforms: [{
        platform,
        freeCashUsdMicros: usdToMicros(20),
        holdings: [
          { holding: tiny, quantityUnits: 100_000_000, averageCostUsdMicros: usdToMicros(0.5), marketValueUsdMicros: usdToMicros(0.5), unrealizedProfitUsdMicros: 0 },
          { holding: large, quantityUnits: 100_000_000, averageCostUsdMicros: usdToMicros(10), marketValueUsdMicros: usdToMicros(10), unrealizedProfitUsdMicros: 0 },
        ],
      }],
      totalValueUsdMicros: usdToMicros(30.5),
      costBasisUsdMicros: usdToMicros(10.5),
      unrealizedProfitUsdMicros: 0,
      freeCashUsdMicros: usdToMicros(20),
    }

    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[tiny, large]} {...callbacks()} />)

    expect(html).toContain('تمويل')
    expect(html).toContain('أرصدة صغيرة')
    expect(html).toContain('Large')
    expect(html).not.toContain('Dust')
  })

  it('keeps an unpriced non-empty position visible so its price can be completed', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'IBKR' })
    const holding = createInvestmentHolding({ id: 'unpriced', platformId: platform.id, name: 'Needs price', symbol: 'WAIT', lastPriceUsdMicros: 0 })
    const summary = {
      platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, averageCostUsdMicros: usdToMicros(3), costBasisUsdMicros: usdToMicros(3), marketValueUsdMicros: 0, unrealizedProfitUsdMicros: -usdToMicros(3) }] }],
      totalValueUsdMicros: 0,
      costBasisUsdMicros: usdToMicros(3),
      unrealizedProfitUsdMicros: -usdToMicros(3),
      freeCashUsdMicros: 0,
    }

    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)

    expect(html).toContain('Needs price')
    expect(html).toContain('أدخل السعر')
  })

  it('translates system copy while preserving investment names', () => {
    setActiveUiLanguage('en')
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'منصتي' })
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [{ platform, freeCashUsdMicros: 0, holdings: [] }], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      platforms={[platform]}
      {...callbacks()}
    />)

    expect(html).toContain('My portfolio')
    expect(html).toContain('منصتي')
    expect(html).toContain('Platform balance')
    expect(html).toContain('Liquidity')
  })

  it('does not expose the provider symbol as a manual field', () => {
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      {...callbacks()}
    />)

    expect(html).not.toContain('رمز مزود السعر')
  })
})
