import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { InvestmentTradeDialog } from './InvestmentTradeDialog.jsx'
import { INVESTMENT_TRADE_TYPES, createInvestmentHolding, createInvestmentPlatform, quantityToUnits, usdToMicros } from './investmentCore.js'

const previousReact = globalThis.React
beforeAll(() => { globalThis.React = React })
afterAll(() => { globalThis.React = previousReact })

const kucoin = createInvestmentPlatform({ id: 'p-kucoin', name: 'KuCoin', kind: 'platform' })
const midas = createInvestmentPlatform({ id: 'p-midas', name: 'Midas', kind: 'broker' })
const one = createInvestmentHolding({ id: 'h-one', platformId: kucoin.id, name: 'Harmony', symbol: 'ONE/USD', assetType: 'crypto', quoteCurrency: 'USD', lastPriceUsdMicros: usdToMicros(0.0016) })
const dot = createInvestmentHolding({ id: 'h-dot', platformId: kucoin.id, name: 'Polkadot', symbol: 'DOT/USD', assetType: 'crypto', quoteCurrency: 'USD', lastPriceUsdMicros: usdToMicros(3.9) })
const aapl = createInvestmentHolding({ id: 'h-aapl', platformId: midas.id, name: 'Apple', symbol: 'AAPL', assetType: 'stock', quoteCurrency: 'USD' })
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
})
