import { MOVEMENT_TYPES } from './ledgerCore.js'
import { investmentTradeValueMicros, usdToMicros } from './investmentCore.js'

const FUNDING_TYPES = new Set([
  MOVEMENT_TYPES.INVESTMENT_DEPOSIT,
  MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL,
])

function activityTime(record = {}) {
  const value = new Date(record.occurredAt || record.createdAt || record.updatedAt || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

export function buildInvestmentPlatformActivity({ platformId = '', trades = [], movements = [], holdings = [], accounts = [] } = {}) {
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]))
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const tradeRows = trades
    .filter((trade) => trade?.platformId === platformId)
    .map((trade) => ({
      id: trade.id,
      kind: 'trade',
      action: trade.type,
      status: trade.status,
      occurredAt: trade.occurredAt || trade.createdAt || trade.updatedAt || '',
      note: trade.note || '',
      amountUsdMicros: investmentTradeValueMicros(trade),
      trade,
      holding: holdingById.get(trade.holdingId) || null,
      sourceAccount: null,
      destinationAccount: null,
    }))
  const movementRows = movements
    .filter((movement) => movement?.investmentPlatformId === platformId && FUNDING_TYPES.has(movement?.type))
    .map((movement) => ({
      id: movement.id,
      kind: 'movement',
      action: movement.type,
      status: movement.status,
      occurredAt: movement.occurredAt || movement.createdAt || movement.updatedAt || '',
      note: movement.note || '',
      amountUsdMicros: usdToMicros(Math.abs(Number(movement.amount || 0))),
      movement,
      holding: null,
      sourceAccount: accountById.get(movement.sourceAccountId) || null,
      destinationAccount: accountById.get(movement.destinationAccountId) || null,
    }))

  return [...tradeRows, ...movementRows]
    .sort((left, right) => activityTime(right) - activityTime(left) || String(right.id).localeCompare(String(left.id)))
}
