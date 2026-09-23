import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore.js'
import { buildInvestmentPlatformActivity } from './investmentActivity.js'
import { INVESTMENT_TRADE_TYPES, createInvestmentHolding, createInvestmentTrade, createInvestmentTransfer, quantityToUnits, usdToMicros } from './investmentCore.js'

describe('investment platform activity', () => {
  it('combines trades and funding movements newest first without merging records', () => {
    const holding = createInvestmentHolding({ id: 'holding-1', platformId: 'platform-1', name: 'Apple', symbol: 'AAPL' })
    const trade = createInvestmentTrade({
      id: 'trade-1', platformId: 'platform-1', holdingId: holding.id, type: INVESTMENT_TRADE_TYPES.BUY,
      quantityUnits: quantityToUnits(2), priceUsdMicros: usdToMicros(100), note: 'Buy note',
    }, '2026-01-02T10:00:00.000Z')
    const movement = {
      id: 'movement-1', type: MOVEMENT_TYPES.INVESTMENT_DEPOSIT, status: MOVEMENT_STATUSES.POSTED,
      currency: CURRENCIES.USD, amount: 500, investmentPlatformId: 'platform-1', sourceAccountId: 'cash-usd',
      note: 'Funding note', occurredAt: '2026-01-03T10:00:00.000Z', createdAt: '2026-01-03T10:00:00.000Z',
    }

    const rows = buildInvestmentPlatformActivity({
      platformId: 'platform-1', trades: [trade], movements: [movement], holdings: [holding], accounts: [{ id: 'cash-usd', ownerName: 'My cash' }],
    })

    expect(rows.map((row) => row.id)).toEqual(['movement-1', 'trade-1'])
    expect(rows[0]).toMatchObject({ kind: 'movement', action: MOVEMENT_TYPES.INVESTMENT_DEPOSIT, amountUsdMicros: usdToMicros(500), note: 'Funding note' })
    expect(rows[0].sourceAccount).toMatchObject({ id: 'cash-usd' })
    expect(rows[1]).toMatchObject({ kind: 'trade', action: INVESTMENT_TRADE_TYPES.BUY, holding: { id: holding.id }, note: 'Buy note' })
  })

  it('keeps voided funding visible and excludes other platforms', () => {
    const rows = buildInvestmentPlatformActivity({
      platformId: 'platform-1',
      trades: [{ id: 'other-trade', platformId: 'platform-2' }],
      movements: [
        { id: 'voided', type: MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL, status: MOVEMENT_STATUSES.VOIDED, currency: CURRENCIES.USD, amount: 20, investmentPlatformId: 'platform-1', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'other', type: MOVEMENT_TYPES.INVESTMENT_DEPOSIT, status: MOVEMENT_STATUSES.POSTED, currency: CURRENCIES.USD, amount: 50, investmentPlatformId: 'platform-2', createdAt: '2026-01-02T00:00:00.000Z' },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'voided', status: MOVEMENT_STATUSES.VOIDED, amountUsdMicros: usdToMicros(20) })
  })

  it('shows one transfer on both platform histories with its direction and note', () => {
    const platforms = [{ id: 'one', name: 'Source' }, { id: 'two', name: 'Destination' }]
    const transfer = createInvestmentTransfer({ id: 'move-1', asset: 'USD', fromPlatformId: 'one', toPlatformId: 'two', amountUsdMicros: usdToMicros(25), note: 'Internal move' }, '2026-01-04T10:00:00.000Z')
    const source = buildInvestmentPlatformActivity({ platformId: 'one', transfers: [transfer], platforms })
    const destination = buildInvestmentPlatformActivity({ platformId: 'two', transfers: [transfer], platforms })
    expect(source).toMatchObject([{ id: 'move-1', kind: 'transfer', action: 'transfer_out', note: 'Internal move', otherPlatform: platforms[1] }])
    expect(destination).toMatchObject([{ id: 'move-1', kind: 'transfer', action: 'transfer_in', note: 'Internal move', otherPlatform: platforms[0] }])
  })
})
