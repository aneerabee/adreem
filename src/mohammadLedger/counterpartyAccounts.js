import {
  counterpartyAccountChannels,
  counterpartyAccountDrafts,
  counterpartyGroupKey,
  counterpartyOpeningDraftErrors,
  isCounterpartyAccount,
  isCounterpartyBundleDraft,
} from './accountConfig.js'
import { createAccount, createOpeningMovements, validateAccount, validateMovement } from './ledgerCore.js'

function accountBundleId(accounts = []) {
  const anchorId = String(accounts[0]?.id || '').trim()
  return anchorId ? `counterparty:${anchorId}` : ''
}

export function buildCounterpartyAccountBundle(draft = {}, metadata = {}) {
  if (!isCounterpartyBundleDraft(draft)) return []
  const baseAccounts = counterpartyAccountDrafts(draft).map((accountDraft) => createAccount(accountDraft))
  const counterpartyId = accountBundleId(baseAccounts)
  return baseAccounts.map((account) => ({
    ...account,
    counterpartyId,
    source: metadata.source || account.source,
    idempotencyKey: metadata.idempotencyKey || undefined,
    telegramUserId: metadata.telegramUserId,
    telegramChatId: metadata.telegramChatId,
  }))
}

export function validateCounterpartyAccountBundle(draft = {}, existingAccounts = [], metadata = {}) {
  const accounts = buildCounterpartyAccountBundle(draft, metadata)
  const errors = [...counterpartyOpeningDraftErrors(draft)]
  const accepted = [...existingAccounts]
  for (const account of accounts) {
    const validation = validateAccount(account, accepted)
    errors.push(...validation.errors)
    if (validation.ok) accepted.push(account)
  }
  return {
    accounts,
    validation: { ok: errors.length === 0, errors },
  }
}

export function buildCounterpartyOpeningMovements(accounts = [], existingMovements = [], existingAccounts = []) {
  const createdAt = accounts[0]?.createdAt || new Date().toISOString()
  const movements = createOpeningMovements(accounts, createdAt)
  const errors = []
  let validationMovements = [...existingMovements]
  for (const movement of movements) {
    const validation = validateMovement(movement, [...existingAccounts, ...accounts], validationMovements)
    errors.push(...validation.errors)
    if (validation.ok) validationMovements = [...validationMovements, movement]
  }
  return {
    movements,
    validation: { ok: errors.length === 0, errors },
  }
}

function counterpartyRowOrder(bucket = {}) {
  const channelKey = bucket.account?.counterpartyKind
  const index = counterpartyAccountChannels.findIndex((channel) => channel.key === channelKey)
  return index < 0 ? counterpartyAccountChannels.length : index
}

export function groupCounterpartyBalanceBuckets(rows = []) {
  const groups = new Map()
  for (const bucket of rows) {
    const account = bucket?.account
    if (!isCounterpartyAccount(account)) continue
    const key = counterpartyGroupKey(account)
    const current = groups.get(key) || {
      id: key,
      ownerName: account.ownerName || '',
      rows: [],
      receivable: { dinar: 0, usd: 0 },
      payable: { dinar: 0, usd: 0 },
    }
    const dinar = Number(bucket.dinar || 0)
    const usd = Number(bucket.usd || 0)
    current.rows.push(bucket)
    current.receivable.dinar += Math.max(0, dinar)
    current.receivable.usd += Math.max(0, usd)
    current.payable.dinar += Math.abs(Math.min(0, dinar))
    current.payable.usd += Math.abs(Math.min(0, usd))
    groups.set(key, current)
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => counterpartyRowOrder(left) - counterpartyRowOrder(right)),
  }))
}

function groupMagnitude(group = {}) {
  return Math.max(
    Number(group.receivable?.dinar || 0),
    Number(group.receivable?.usd || 0),
    Number(group.payable?.dinar || 0),
    Number(group.payable?.usd || 0),
  )
}

export function buildCounterpartyBalanceViews(rows = []) {
  const groups = groupCounterpartyBalanceBuckets(rows)
    .sort((left, right) => groupMagnitude(right) - groupMagnitude(left) || left.ownerName.localeCompare(right.ownerName, 'ar'))
  const hasReceivable = (group) => group.receivable.dinar > 0 || group.receivable.usd > 0
  const hasPayable = (group) => group.payable.dinar > 0 || group.payable.usd > 0
  return {
    all: groups,
    withBalance: groups.filter((group) => hasReceivable(group) || hasPayable(group)),
    receivable: groups.filter(hasReceivable),
    payable: groups.filter(hasPayable),
    zero: groups.filter((group) => !hasReceivable(group) && !hasPayable(group)),
  }
}
