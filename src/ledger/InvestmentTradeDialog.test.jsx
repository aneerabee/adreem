import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { InvestmentTradeDialog } from './InvestmentTradeDialog.jsx'
import { TradeReview } from './InvestmentTradeParts.jsx'
import { INVESTMENT_TRADE_TYPES, createInvestmentHolding, createInvestmentPlatform, quantityToUnits, usdToMicros } from './investmentCore.js'
import { tradeImpact } from './investmentTradeFlow.js'

const previousReact = globalThis.React
beforeAll(() => { globalThis.React = React })
afterAll(() => { globalThis.React = previousReact })

const kucoin = createInvestmentPlatform({ id: 'p-kucoin', name: 'KuCoin', kind: 'platform' })
const midas = createInvestmentPlatform({ id: 'p-midas', name: 'Midas', kind: 'broker' })
const one = createInvestmentHolding({ id: 'h-one', platformId: kucoin.id, name: 'Harmony', symbol: 'ONE/USD', assetType: 'crypto', quoteCurrency: 'USD', lastPriceUsdMicros: usdToMicros(0.0016) })
const dot = createInvestmentHolding({ id: 'h-dot', platformId: kucoin.id, name: 'Polkadot', symbol: 'DOT/USD', assetType: 'crypto', quoteCurrency: 'USD', lastPriceUsdMicros: usdToMicros(3.9) })
const aapl = createInvestmentHolding({ id: 'h-aapl', platformId: midas.id, name: 'Apple', symbol: 'AAPL', assetType: 'stock', quoteCurrency: 'USD' })
const turkish = createInvestmentHolding({ id: 'h-try', platformId: midas.id, name: 'Turkish stock', symbol: 'THYAO', assetType: 'stock', quoteCurrency: 'TRY', lastPriceNativeMicros: usdToMicros(100) })
const platformRow = {
  platform: kucoin,
  freeCashUsdMicros: usdToMicros(250),
  holdings: [{ holding: one, quantityUnits: quantityToUnits(90000) }, { holding: dot, quantityUnits: 0 }],
  closedHoldings: [],
}

function render(props = {}) {
  return renderToStaticMarkup(<InvestmentTradeDialog platformRow={platformRow} holdings={[one, dot, aapl]} markIndex={false} onAddTrade={vi.fn()} onAddAsset={vi.fn()} onClose={vi.fn()} {...props} />)
}

describe('platform trade dialog', () => {
  it('lists only this platform investments and offers a new asset while buying', () => {
    const html = render()
    expect(html).toContain('شراء أو بيع')
    expect(html).toContain('KuCoin')
    expect(html).toContain('ONE/USD')
    expect(html).toContain('DOT/USD')
    expect(html).not.toContain('AAPL')
    expect(html).toContain('أصل جديد في هذه المنصة')
    expect(html).toContain('مراجعة الشراء')
    expect(html).not.toContain('الكمية</span><input')
  })

  it('lists only held investments while selling and hides the new asset path', () => {
    const html = render({ initialType: INVESTMENT_TRADE_TYPES.SELL })
    expect(html).toContain('ONE/USD')
    expect(html).not.toContain('DOT/USD')
    expect(html).not.toContain('أصل جديد في هذه المنصة')
    expect(html).toContain('مراجعة البيع')
  })

  it('opens directly on the amounts when the investment is already chosen', () => {
    const html = render({ initialHoldingId: one.id, initialType: INVESTMENT_TRADE_TYPES.SELL })
    expect(html).toContain('adreem-investment-trade-asset')
    expect(html).toContain('تغيير')
    expect(html).toContain('كل الكمية')
    expect(html).toContain('آخر سعر')
    expect(html).toContain('الكمية المتاحة للبيع')
  })

  it('never preselects an investment that belongs to another platform', () => {
    const html = render({ initialHoldingId: aapl.id })
    expect(html).not.toContain('AAPL')
    expect(html).toContain('role="radiogroup"')
  })

  it('shows native settlement selected for Turkish holdings and no currency choice for USD holdings', () => {
    const turkishRow = { platform: midas, freeCashUsdMicros: usdToMicros(20), freeCashTryMicros: usdToMicros(500), holdings: [{ holding: turkish, quantityUnits: quantityToUnits(2) }], closedHoldings: [] }
    const html = render({ platformRow: turkishRow, holdings: [turkish, aapl], initialHoldingId: turkish.id })
    expect(html).toContain('aria-label="العملة"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>الليرة التركية <bdi dir="ltr">TRY/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>الدولار <bdi dir="ltr">USD/)
    expect(html).toContain('المتاح 500')
    expect(html).toContain('TRY')
    const usdSettlement = render({ platformRow: turkishRow, holdings: [turkish, aapl], initialHoldingId: turkish.id, initialSettlementCurrency: 'USD' })
    expect(usdSettlement).toMatch(/aria-pressed="true"[^>]*>الدولار <bdi dir="ltr">USD/)
    expect(usdSettlement).toContain('المتاح 20')
    expect(render({ platformRow: turkishRow, holdings: [turkish, aapl], initialHoldingId: aapl.id })).not.toContain('aria-label="العملة"')
  })

  it('reviews cash impact in the chosen settlement currency before confirmation', () => {
    const trade = { type: INVESTMENT_TRADE_TYPES.BUY, quantityUnits: quantityToUnits(2), priceNativeMicros: usdToMicros(100), priceUsdMicros: usdToMicros(2.5), feeNativeMicros: usdToMicros(5), feeUsdMicros: usdToMicros(0.125), freeCashTryMicros: usdToMicros(500), freeCashUsdMicros: usdToMicros(20) }
    const props = { type: INVESTMENT_TRADE_TYPES.BUY, option: { holding: turkish, quantityUnits: 0 }, markIndex: false, quantityUnits: trade.quantityUnits, priceText: '100 TRY', priceUsdText: '2.5 USD', fxText: '1 USD = 40 TRY', valueNativeText: '200 TRY', feeNativeText: '5 TRY', note: '' }
    const tryHtml = renderToStaticMarkup(<TradeReview {...props} settlementCurrency="TRY" impact={tradeImpact({ ...trade, settlementCurrency: 'TRY' })} />)
    const usdHtml = renderToStaticMarkup(<TradeReview {...props} settlementCurrency="USD" impact={tradeImpact({ ...trade, settlementCurrency: 'USD' })} />)
    expect(tryHtml).toContain('العملة</dt><dd><bdi dir="ltr">TRY')
    expect(tryHtml).toContain('نقد المنصة TRY')
    expect(tryHtml).toContain('295')
    expect(usdHtml).toContain('العملة</dt><dd><bdi dir="ltr">USD')
    expect(usdHtml).toContain('نقد المنصة USD')
    expect(usdHtml).not.toContain('نقد المنصة TRY')
  })

  it('labels a fee-heavy sale as a cash deduction in the review', () => {
    const impact = tradeImpact({ type: INVESTMENT_TRADE_TYPES.SELL, settlementCurrency: 'TRY', quantityUnits: quantityToUnits(1), heldUnits: quantityToUnits(1), priceNativeMicros: usdToMicros(100), feeNativeMicros: usdToMicros(150), freeCashTryMicros: usdToMicros(200) })
    const html = renderToStaticMarkup(<TradeReview type={INVESTMENT_TRADE_TYPES.SELL} option={{ holding: turkish, quantityUnits: quantityToUnits(1) }} markIndex={false} quantityUnits={quantityToUnits(1)} priceText="100 TRY" settlementCurrency="TRY" impact={impact} note="" />)
    expect(html).toContain('يخصم من نقد المنصة')
    expect(html).not.toContain('يضاف إلى نقد المنصة')
  })
})
