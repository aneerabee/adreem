import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import InvestmentsPanel from './InvestmentsPanel.jsx'
import { createInvestmentHolding, createInvestmentPlatform, usdToMicros } from './investmentCore.js'
import { setActiveUiLanguage } from './uiTranslation.js'

const previousReact = globalThis.React

beforeAll(() => {
  globalThis.React = React
})

afterAll(() => {
  globalThis.React = previousReact
})

afterEach(() => {
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
    const holding = createInvestmentHolding({ id: 'holding-1', platformId: platform.id, name: 'Apple', symbol: 'AAPL', lastPriceUsdMicros: usdToMicros(120), previousPriceUsdMicros: usdToMicros(110), previousPriceAt: '2026-01-01T10:00:00.000Z' })
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
    expect(html).not.toContain('>Apple</strong>')
    expect(html).toContain('class="adreem-investment-platform-balances"')
    expect(html).toContain('رصيد المنصة')
    expect(html).toContain('السيولة')
    expect(html).toContain('الكمية')
    expect(html).toContain('آخر سعر')
    expect(html).toContain('القيمة الآن')
    expect(html).toContain('النتيجة')
    expect(html).toContain('adreem-investment-metrics-strip')
    expect(html).toContain('adreem-investment-composition')
    expect(html).toContain('aria-label="الكمية: 5 وحدة"')
    expect(html.indexOf('adreem-investment-quantity')).toBeLessThan(html.indexOf('adreem-investment-metrics-strip'))
    expect(html.indexOf('is-market-price')).toBeLessThan(html.indexOf('adreem-investment-metrics-strip'))
    expect(html).toContain('aria-label="إضافة منصة"')
    expect(html).toContain('>تسجيل</span>')
    expect(html).not.toContain('class="is-quantity"')
    expect(html).not.toContain('متوسط الشراء')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="تسجيل شراء أو بيع"')
    expect(html).not.toContain('تأكيد الشراء')
    expect(html).not.toContain('تأكيد البيع')
    expect(html).toContain('is-market-price has-price is-up')
    expect(html).toContain('500 USD')
    expect(html).toContain('600 USD')
    expect(html).toContain('+100 USD')
    expect(html).toContain('is-profit-positive')
    expect(html).toContain('الأسعار اليدوية محفوظة حتى تغييرها')
  })

  it('uses a branded logo alone and retains the name for an unbranded platform', () => {
    const branded = createInvestmentPlatform({ id: 'midas', name: 'Midas Kripto', location: 'Turkey' })
    const custom = createInvestmentPlatform({ id: 'custom', name: 'My new platform', location: 'Libya' })
    const summary = {
      platforms: [branded, custom].map((platform) => ({ platform, freeCashUsdMicros: 0, holdings: [] })),
      totalValueUsdMicros: 0,
    }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[branded, custom]} holdings={[]} {...callbacks()} />)
    const identities = [...html.matchAll(/<div class="adreem-investment-platform-identity">([\s\S]*?)<\/div>/gu)].map((match) => match[1])

    expect(identities).toHaveLength(2)
    expect(identities[0]).toContain('alt="Midas Kripto"')
    expect(identities[0]).not.toContain('<strong>')
    expect(identities[0]).not.toContain('Turkey')
    expect(identities[1]).toContain('<strong>My new platform</strong>')
    expect(identities[1]).toContain('Libya')
  })

  it('labels a closed-market quote without presenting the request time as the trade time', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'Midas' })
    const holding = createInvestmentHolding({
      id: 'holding-1', platformId: platform.id, name: 'Turkish Airlines', symbol: 'THYAO',
      quoteCurrency: 'TRY', lastPriceUsdMicros: usdToMicros(9), lastPriceNativeMicros: usdToMicros(300),
      lastPriceAt: '2026-09-23T11:00:00.000Z', lastPriceQuotedAt: '2026-09-22T15:00:00.000Z',
      lastPriceFxQuotedAt: '2026-09-23T10:59:00.000Z', lastPriceMarketOpen: false,
    })
    const summary = {
      platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, costBasisUsdMicros: usdToMicros(8), marketValueUsdMicros: usdToMicros(9), unrealizedProfitUsdMicros: usdToMicros(1) }] }],
      totalValueUsdMicros: usdToMicros(9),
    }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)

    expect(html).toContain('إغلاق السوق')
    expect(html).toContain('وقت السعر:')
    expect(html).toContain('الأسعار اليدوية محفوظة حتى تغييرها')
  })

  it('shows an end-of-day Turkish quote as a date, never as a fabricated trade time', () => {
    const platform = createInvestmentPlatform({ id: 'platform-1', name: 'Midas' })
    const holding = createInvestmentHolding({
      id: 'holding-eod', platformId: platform.id, name: 'Turkish Airlines', symbol: 'THYAO', assetType: 'stock',
      quoteCurrency: 'TRY', lastPriceUsdMicros: usdToMicros(9), lastPriceNativeMicros: usdToMicros(300),
      lastPriceSource: 'twelve-data-eod+ecb-fx', lastPriceQuotedAt: '2027-01-15T00:00:00.000Z',
      lastPriceMarketOpen: false,
    })
    const summary = { platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, costBasisUsdMicros: usdToMicros(8), marketValueUsdMicros: usdToMicros(9), unrealizedProfitUsdMicros: usdToMicros(1) }] }], totalValueUsdMicros: usdToMicros(9) }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)

    expect(html).toContain('إغلاق سابق')
    expect(html).not.toContain('03:00')
    expect(html).toContain('السعر السابق 9 USD')
    expect(html).not.toContain('300 TRY')
  })

  it('attributes a US daily close on the holding and labels it as an end-of-day price', () => {
    const platform = createInvestmentPlatform({ id: 'platform-us', name: 'IBKR' })
    const holding = createInvestmentHolding({
      id: 'holding-us', platformId: platform.id, name: 'Apple Inc.', symbol: 'AAPL', assetType: 'stock',
      providerSymbol: 'AAPL:TGM', marketDataMode: 'provider', quoteCurrency: 'USD',
      lastPriceUsdMicros: usdToMicros(190.25), lastPriceNativeMicros: usdToMicros(190.25),
      lastPriceSource: 'tgmcharts-eod', lastPriceQuotedAt: '2027-01-14T00:00:00.000Z',
      lastPriceMarketOpen: false,
    })
    const summary = { platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, costBasisUsdMicros: usdToMicros(180), marketValueUsdMicros: usdToMicros(190.25), unrealizedProfitUsdMicros: usdToMicros(10.25) }] }], totalValueUsdMicros: usdToMicros(190.25) }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)
    expect(html).not.toContain('href="https://tgmcharts.com/"')
    expect(html).toContain('إغلاق يومي')
    expect(html).not.toContain('03:00')
  })

  it('shows the USD market price and a specific refresh failure without changing the valuation', () => {
    const platform = createInvestmentPlatform({ id: 'platform-try', name: 'Midas' })
    const holding = createInvestmentHolding({
      id: 'holding-try', platformId: platform.id, name: 'Turkish Airlines', symbol: 'THYAO', quoteCurrency: 'TRY',
      lastPriceUsdMicros: usdToMicros(9), previousPriceUsdMicros: usdToMicros(10),
      lastPriceNativeMicros: usdToMicros(300), previousPriceNativeMicros: usdToMicros(250),
    })
    const summary = { platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, costBasisUsdMicros: usdToMicros(8), marketValueUsdMicros: usdToMicros(9), unrealizedProfitUsdMicros: usdToMicros(1) }] }], totalValueUsdMicros: usdToMicros(9) }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} priceErrors={{ 'holding-try': 'سعر السوق غير متاح' }} {...callbacks()} />)

    expect(html).not.toContain('300 TRY')
    expect(html).not.toContain('20%')
    expect(html).toContain('is-market-price has-price is-neutral is-stale')
    expect(html).toContain('9 USD')
    expect(html).toContain('سعر السوق غير متاح')
    expect(html).toContain('لم يتحدث')
    expect(html).toContain('السعر السابق 9 USD')
    expect(html).toContain('role="status"')
    expect(html).toContain('is-price-error')
  })

  it('marks a cached crypto quote as previous until its new reference source refreshes', () => {
    const platform = createInvestmentPlatform({ id: 'platform-crypto', name: 'Midas kripto' })
    const holding = createInvestmentHolding({
      id: 'holding-fet', platformId: platform.id, name: 'Fetch.ai', symbol: 'FET/USD',
      providerSymbol: 'FET/USD:BINANCE', assetType: 'crypto', quoteCurrency: 'USD',
      lastPriceUsdMicros: usdToMicros(1.25), lastPriceSource: 'binance-usdt+coinbase-usdt-usd',
      lastPriceQuotedAt: '2026-09-23T11:01:52.000Z',
    })
    const summary = { platforms: [{ platform, freeCashUsdMicros: 0, holdings: [{ holding, quantityUnits: 100_000_000, costBasisUsdMicros: usdToMicros(1), marketValueUsdMicros: usdToMicros(1.25), unrealizedProfitUsdMicros: usdToMicros(0.25) }] }], totalValueUsdMicros: usdToMicros(1.25) }
    const html = renderToStaticMarkup(<InvestmentsPanel summary={summary} platforms={[platform]} holdings={[holding]} {...callbacks()} />)

    expect(html).toContain('is-market-price has-price is-neutral is-stale')
    expect(html).toContain('سعر سابق')
    expect(html).not.toContain('مصدر التحديث غير متاح لهذا الرمز')
    expect(html).toContain('قيمة بسعر سابق')
    expect(html).toContain('نتيجة تقديرية')
    expect(html).toContain('1.25 USD')
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

  it('shows one translated transfer action above all platforms', () => {
    setActiveUiLanguage('en')
    const first = createInvestmentPlatform({ id: 'platform-first', name: 'First' })
    const second = createInvestmentPlatform({ id: 'platform-second', name: 'Second' })
    const html = renderToStaticMarkup(<InvestmentsPanel
      summary={{ platforms: [first, second].map((platform) => ({ platform, freeCashUsdMicros: 0, holdings: [] })), totalValueUsdMicros: 0, costBasisUsdMicros: 0, unrealizedProfitUsdMicros: 0, freeCashUsdMicros: 0 }}
      platforms={[first, second]}
      {...callbacks()}
    />)

    expect(html.match(/aria-label="Transfer between platforms"/gu)).toHaveLength(1)
    expect(html).not.toContain('>نقل</button>')
    expect(html).not.toContain('aria-label="Transfer to platform"')
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
    expect(html).toContain('LRG')
    expect(html).not.toContain('DST')
    expect(html).not.toContain('Large')
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

    expect(html).toContain('WAIT')
    expect(html).not.toContain('Needs price')
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
