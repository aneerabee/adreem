import { VALUE_KINDS } from './accountCatalog'
import { CURRENCIES, MOVEMENT_STATUSES, buildPostingEntries } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'
import { movementAccountImpact } from './movementPresentation'
import { postedCategoryExpenses } from './movementDisplay'

export function accountProfileMovements(movements = [], accountId = '') {
  return movements
    .filter((movement) => (
      movement?.sourceAccountId === accountId
      || movement?.destinationAccountId === accountId
      || movement?.expenseCategoryId === accountId
      || (movement?.status === MOVEMENT_STATUSES.POSTED && movementAccountImpact(movement, accountId).length > 0)
    ))
    .slice()
    .reverse()
}

export function accountStatementAccountIds(account = {}, accounts = []) {
  if (!account?.id) return []
  if (account.counterpartyId) {
    return accounts.filter((item) => item.counterpartyId === account.counterpartyId).map((item) => item.id)
  }
  if (account.valueKind === VALUE_KINDS.RECEIVABLE) {
    const ownerName = normalizeAccountSearchText(account.ownerName)
    return accounts
      .filter((item) => item.valueKind === VALUE_KINDS.RECEIVABLE && normalizeAccountSearchText(item.ownerName) === ownerName)
      .map((item) => item.id)
  }
  return [account.id]
}

function chronological(movements = []) {
  return [...movements].sort((left, right) => Number(left.databaseSequence || 0) - Number(right.databaseSequence || 0)
    || new Date(left.createdAt || left.updatedAt || 0).getTime() - new Date(right.createdAt || right.updatedAt || 0).getTime()
    || String(left.id || '').localeCompare(String(right.id || '')))
}

function emptyStatementTotals() {
  return {
    running: Object.fromEntries(Object.values(CURRENCIES).map((currency) => [currency, 0])),
    totals: Object.fromEntries(Object.values(CURRENCIES).map((currency) => [currency, { incoming: 0, outgoing: 0, balance: 0 }])),
  }
}

export function buildAccountStatement(movements = [], accountIds = [], selectedCurrencies = Object.values(CURRENCIES)) {
  const ids = new Set(accountIds)
  const currencies = new Set(selectedCurrencies)
  const { running, totals } = emptyStatementTotals()
  const rows = []
  const sorted = chronological(movements.filter((movement) => movement?.status === MOVEMENT_STATUSES.POSTED))

  for (const movement of sorted) {
    const impacts = new Map()
    for (const entry of buildPostingEntries(movement)) {
      if (!ids.has(entry.accountId) || !currencies.has(entry.currency)) continue
      impacts.set(entry.currency, Number(impacts.get(entry.currency) || 0) + Number(entry.delta || 0))
    }
    for (const [currency, delta] of impacts) {
      if (!delta) continue
      running[currency] += delta
      if (delta > 0) totals[currency].incoming += delta
      else totals[currency].outgoing += Math.abs(delta)
      totals[currency].balance = running[currency]
      rows.push({ movement, currency, delta, balance: running[currency] })
    }
  }
  return { rows: rows.reverse(), totals }
}

// An expense never changes the category's own balance, so its statement lists the spending itself.
export function buildExpenseStatement(movements = [], categoryId = '', selectedCurrencies = Object.values(CURRENCIES)) {
  const currencies = new Set(selectedCurrencies)
  const { running, totals } = emptyStatementTotals()
  const rows = []
  for (const movement of chronological(postedCategoryExpenses(movements, categoryId))) {
    const amount = Math.abs(Number(movement.amount) || 0)
    if (!amount || !currencies.has(movement.currency)) continue
    running[movement.currency] -= amount
    totals[movement.currency].outgoing += amount
    totals[movement.currency].balance = running[movement.currency]
    rows.push({ movement, currency: movement.currency, delta: -amount, balance: running[movement.currency] })
  }
  return { rows: rows.reverse(), totals }
}
