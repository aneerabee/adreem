export const LEDGER_DELTA_COLLECTIONS = [
  'accounts',
  'movements',
  'dimensions',
  'attachments',
  'recurringRules',
  'reconciliations',
  'auditEvents',
]

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  )
}

function recordsEqual(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

function normalizedStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
    .sort()
}

function changedRecords(nextRecords = [], baseRecords = []) {
  const baseById = new Map((Array.isArray(baseRecords) ? baseRecords : [])
    .filter((record) => record?.id)
    .map((record) => [record.id, record]))
  return (Array.isArray(nextRecords) ? nextRecords : [])
    .filter((record) => record?.id && !recordsEqual(record, baseById.get(record.id)))
}

export function createLedgerDelta(nextState = {}, baseState = {}) {
  const delta = {}
  for (const collection of LEDGER_DELTA_COLLECTIONS) {
    const records = changedRecords(nextState[collection], baseState[collection])
    if (records.length) delta[collection] = records
  }

  const nextIgnored = normalizedStrings(nextState.ignoredExternalAccounts)
  const baseIgnored = normalizedStrings(baseState.ignoredExternalAccounts)
  if (!recordsEqual(nextIgnored, baseIgnored)) delta.ignoredExternalAccounts = nextIgnored

  if (String(nextState.resetAt || '') !== String(baseState.resetAt || '')) {
    delta.resetAt = nextState.resetAt || null
  }
  return delta
}

export function isLedgerDeltaEmpty(delta = {}) {
  return Object.keys(delta).length === 0
}

function mergeCollection(current = [], changed = []) {
  const byId = new Map((Array.isArray(current) ? current : [])
    .filter((record) => record?.id)
    .map((record) => [record.id, record]))
  for (const record of Array.isArray(changed) ? changed : []) {
    if (record?.id) byId.set(record.id, record)
  }
  return Array.from(byId.values())
}

export function applyLedgerDelta(currentState = {}, delta = {}) {
  const next = { ...currentState }
  for (const collection of LEDGER_DELTA_COLLECTIONS) {
    if (Array.isArray(delta[collection])) {
      next[collection] = mergeCollection(currentState[collection], delta[collection])
    }
  }
  if (Array.isArray(delta.ignoredExternalAccounts)) {
    next.ignoredExternalAccounts = normalizedStrings(delta.ignoredExternalAccounts)
  }
  if (Object.prototype.hasOwnProperty.call(delta, 'resetAt')) {
    next.resetAt = delta.resetAt || null
  }
  return next
}
