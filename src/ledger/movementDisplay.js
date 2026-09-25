import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { accountCurrencyKind } from './accountCompatibility'
import { accountChoiceKindLabel } from './accountConfig'
import { conciseAccountChoiceContext, protectedAccountLabel, protectedAccountPrimaryName } from './accountPresentation'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore'
import { normalizeAccountSearchText } from './movementAccounts'

const EXPENSE_MOVEMENT_TYPES = new Set([MOVEMENT_TYPES.EXPENSE, MOVEMENT_TYPES.TRUCK_EXPENSE])
const CURRENCY_ORDER = Object.values(CURRENCIES)

export function isExpenseMovement(movement) {
  return EXPENSE_MOVEMENT_TYPES.has(movement?.type)
}

export function isExpenseCategoryAccount(account) {
  return account?.valueKind === VALUE_KINDS.EXPENSE
}

export function postedCategoryExpenses(movements = [], categoryId = '') {
  if (!categoryId) return []
  return movements.filter((movement) => (
    movement?.status === MOVEMENT_STATUSES.POSTED
    && isExpenseMovement(movement)
    && movement.expenseCategoryId === categoryId
  ))
}

// Expenses point at their category by a separate link, not as the source or destination account.
export function accountMovementFilter(accountId, isExpenseCategory = false) {
  return isExpenseCategory ? { expenseCategoryId: accountId } : { accountId }
}

export function expenseTotalsByCurrency(movements = []) {
  const totals = new Map()
  for (const movement of movements) {
    const amount = Math.abs(Number(movement?.amount) || 0)
    if (!amount || !CURRENCY_ORDER.includes(movement.currency)) continue
    totals.set(movement.currency, (totals.get(movement.currency) || 0) + amount)
  }
  return CURRENCY_ORDER.filter((currency) => totals.get(currency)).map((currency) => ({ currency, amount: totals.get(currency) }))
}

function isMultiCurrency(account) {
  return accountCurrencyKind(account) === ACCOUNT_CURRENCY_KINDS.MULTI
}

function nameCarriesKind(account) {
  return normalizeAccountSearchText(protectedAccountPrimaryName(account)).includes(normalizeAccountSearchText(accountChoiceKindLabel(account)))
}

// A movement already states its currency, so a multi-currency account's full currency list is noise there.
export function movementAccountLabel(account) {
  if (!account) return ''
  if (!isMultiCurrency(account)) return protectedAccountLabel(account)
  const name = protectedAccountPrimaryName(account)
  return nameCarriesKind(account) ? name : `${name} · ${accountChoiceKindLabel(account)}`
}

export function movementAccountContext(account) {
  if (!account) return ''
  if (!isMultiCurrency(account)) return conciseAccountChoiceContext(account)
  return nameCarriesKind(account) ? '' : accountChoiceKindLabel(account)
}
