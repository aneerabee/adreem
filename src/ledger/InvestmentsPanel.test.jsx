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
    expect(html).toContain('سعر الشراء')
    expect(html).toContain('القيمة عند الشراء')
    expect(html).toContain('سعر السوق')
    expect(html).toContain('القيمة الآن')
    expect(html).toContain('المكسب / الخسارة')
    expect(html).toContain('500 USD')
    expect(html).toContain('600 USD')
    expect(html).toContain('+100 USD')
    expect(html).toContain('is-positive')
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
  })

  it('shows funding context and removal only for confirmed investments below 5 USD', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'IBKR' })
    const tiny = createInvestmentHolding({ id: 'tiny', platformId: platform.id, name: 'Tiny', symbol: 'TNY', lastPriceUsdMicros: usdToMicros(2) })
    const large = createInvestmentHolding({ id: 'large', platformId: platform.id, name: 'Large', symbol: 'LRG', lastPriceUsdMicros: usdToMicros(10) })
    const summary = {
      platforms: [{
        platform,
        freeCashUsdMicros: usdToMicros(20),
        holdings: [
          { holding: tiny, quantityUnits: 100_000_000, averageCostUsdMicros: usdToMicros(2), marketValueUsdMicros: usdToMicros(2), unrealizedProfitUsdMicros: 0 },
          { holding: large, quantityUnits: 100_000_000, averageCostUsdMicros: usdToMicros(10), marketValueUsdMicros: usdToMicros(10), unrealizedProfitUsdMicros: 0 },
        ],
      }],
      totalValueUsdMicros: usdToMicros(32),
      costBasisUsdMicros: usdToMicros(12),
      unrealizedProfitUsdMicros: 0,
      freeCashUsdMicros: usdToMicros(20),
    }

    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[tiny, large]} {...callbacks()} />)

    expect(html).toContain('تمويل')
    expect((html.match(/إزالة/g) || [])).toHaveLength(1)
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
    expect(html).toContain('Available cash')
  })

  it('does not expose the provider symbol as a manual field', () => {
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [], totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      {...callbacks()}
    />)

    expect(html).not.toContain('رمز مزود السعر')
  })
})
