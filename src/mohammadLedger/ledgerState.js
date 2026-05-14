import { ACCOUNT_TYPES, VALUE_KINDS, mohammadAccountCatalog } from './accountCatalog.js'
import { createOpeningMovements } from './ledgerCore.js'

export const MOHAMMAD_LEDGER_VERSION = 1
export const MOHAMMAD_STATE_ROW_ID = 'default'
export const MOHAMMAD_STATE_TABLE = 'ml_state'

export function normalizeMohammadAccounts(accounts = []) {
  return accounts.map((account) => {
    if (account.id === 'saeed-bank' && account.type === ACCOUNT_TYPES.BANK && account.valueKind === VALUE_KINDS.BANK) {
      return {
        ...account,
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        notes: account.notes || 'فرع مصرفي لشخص، وليس مكان مال خاص بي.',
      }
    }
    return account
  })
}

export function createMohammadFallbackState(createdAt = new Date().toISOString()) {
  const accounts = normalizeMohammadAccounts(mohammadAccountCatalog)
  return {
    accounts,
    movements: createOpeningMovements(accounts, createdAt),
    version: MOHAMMAD_LEDGER_VERSION,
    savedAt: createdAt,
  }
}

export function normalizeLedgerState(state, fallbackState = createMohammadFallbackState()) {
  const safeState = state && typeof state === 'object' ? state : {}
  const accounts = Array.isArray(safeState.accounts) ? safeState.accounts : fallbackState.accounts
  const movements = Array.isArray(safeState.movements) ? safeState.movements : fallbackState.movements
  return {
    accounts: normalizeMohammadAccounts(accounts),
    movements,
    version: MOHAMMAD_LEDGER_VERSION,
    savedAt: safeState.savedAt || new Date().toISOString(),
    resetAt: safeState.resetAt || null,
  }
}

export function stateTimestamp(state) {
  const time = new Date(state?.savedAt || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function recordTimestamp(record) {
  const time = new Date(record?.updatedAt || record?.reviewedAt || record?.disabledAt || record?.voidedAt || record?.createdAt || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function mergeRecordsById(left = [], right = []) {
  const byId = new Map()
  for (const record of [...left, ...right]) {
    if (!record?.id) continue
    const existing = byId.get(record.id)
    if (!existing || recordTimestamp(record) >= recordTimestamp(existing)) {
      byId.set(record.id, record)
    }
  }
  return Array.from(byId.values())
}

export function mergeLedgerStates(localState, remoteState, fallbackState = createMohammadFallbackState()) {
  const local = normalizeLedgerState(localState, fallbackState)
  const remote = normalizeLedgerState(remoteState, fallbackState)
  const localReset = stateTimestamp({ savedAt: local.resetAt })
  const remoteReset = stateTimestamp({ savedAt: remote.resetAt })

  if (remoteReset > localReset) return remote
  if (localReset > remoteReset) return local

  const savedAt = stateTimestamp(remote) >= stateTimestamp(local) ? remote.savedAt : local.savedAt
  return {
    version: MOHAMMAD_LEDGER_VERSION,
    savedAt,
    resetAt: remote.resetAt || local.resetAt || null,
    accounts: mergeRecordsById(local.accounts, remote.accounts),
    movements: mergeRecordsById(local.movements, remote.movements),
  }
}

export function sameRecordVersions(left = [], right = []) {
  if (left.length !== right.length) return false
  const version = (item) => item.updatedAt || item.reviewedAt || item.disabledAt || item.mergedIntoAccountId || item.createdAt || item.voidedAt || item.status || ''
  const leftKeys = left.map((item) => `${item.id}:${version(item)}`).sort()
  const rightKeys = right.map((item) => `${item.id}:${version(item)}`).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}
