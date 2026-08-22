import {
  ACCOUNT_TYPES,
  VALUE_KINDS,
  inferAccountCurrencyKind,
  adreemAccountCatalog,
  normalizeAccountCurrencyKind,
} from './accountCatalog.js'
import { createOpeningMovements } from './ledgerCore.js'
import { accountSummaryScope } from './ledgerScope.js'

export const ADREEM_APP_ID = 'adreem'
export const ADREEM_LEDGER_VERSION = 2
export const ADREEM_DEFAULT_TENANT_ID = 'adreem'
export const ADREEM_DEFAULT_LEDGER_ID = 'main'
export const ADREEM_STATE_ROW_ID = adreemStateRowId()
export const LEGACY_STATE_ROW_ID = 'default'

export const LEDGER_STATE_VERSION = ADREEM_LEDGER_VERSION
export const STATE_ROW_ID = ADREEM_STATE_ROW_ID
export const LEDGER_STATE_TABLE = 'ml_state'

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function normalizeLedgerPart(value, fallback) {
  const text = String(value || fallback || '').trim().toLowerCase()
  const normalized = text.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function normalizeEventList(value) {
  return normalizeList(value).map((event, index) => ({
    ...event,
    id: event.id || `audit-${event.createdAt || 'unknown'}-${index}`,
  }))
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : []
}

function normalizeLedgerIdentity(state = {}, fallbackState = {}) {
  return createLedgerIdentity({
    appId: state.appId || fallbackState.appId,
    tenantId: state.tenantId || fallbackState.tenantId,
    ledgerId: state.ledgerId || fallbackState.ledgerId,
  })
}

export function createLedgerIdentity(identity = {}) {
  return {
    appId: normalizeLedgerPart(identity.appId, ADREEM_APP_ID),
    tenantId: normalizeLedgerPart(identity.tenantId, ADREEM_DEFAULT_TENANT_ID),
    ledgerId: normalizeLedgerPart(identity.ledgerId, ADREEM_DEFAULT_LEDGER_ID),
  }
}

export function adreemStateRowId(identity = {}) {
  const normalized = createLedgerIdentity(identity)
  return `${normalized.appId}:${normalized.tenantId}:${normalized.ledgerId}`
}

export function normalizeLedgerAccounts(accounts = []) {
  return accounts.map((account) => {
    const normalizedAccount = {
      ...account,
      valueKind: account.type === ACCOUNT_TYPES.PROJECT ? VALUE_KINDS.PROJECT : account.valueKind,
      currencyKind: normalizeAccountCurrencyKind(account.currencyKind, inferAccountCurrencyKind(account)),
    }
    const summaryScope = accountSummaryScope(normalizedAccount)
    if (summaryScope) normalizedAccount.summaryScope = summaryScope
    else delete normalizedAccount.summaryScope
    if (
      account.ownerName &&
      account.ownerName !== 'أنا' &&
      account.type === ACCOUNT_TYPES.BANK &&
      account.valueKind === VALUE_KINDS.BANK
    ) {
      return {
        ...normalizedAccount,
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        notes: account.notes || 'رصيد مصرفي بيني وبين شخص أو جهة.',
      }
    }
    return normalizedAccount
  })
}

export function createFallbackLedgerState(createdAt = new Date().toISOString(), identity = {}) {
  const accounts = normalizeLedgerAccounts(adreemAccountCatalog)
  const ledgerIdentity = createLedgerIdentity(identity)
  return {
    ...ledgerIdentity,
    accounts,
    movements: createOpeningMovements(accounts, createdAt),
    dimensions: [],
    attachments: [],
    recurringRules: [],
    reconciliations: [],
    ignoredExternalAccounts: [],
    auditEvents: [],
    version: LEDGER_STATE_VERSION,
    savedAt: createdAt,
    migratedFrom: null,
  }
}

export function createEmptyAdreemState(createdAt = new Date().toISOString(), identity = {}) {
  const ledgerIdentity = createLedgerIdentity(identity)
  return {
    ...ledgerIdentity,
    accounts: [],
    movements: [],
    dimensions: [],
    attachments: [],
    recurringRules: [],
    reconciliations: [],
    ignoredExternalAccounts: [],
    auditEvents: [],
    version: LEDGER_STATE_VERSION,
    savedAt: createdAt,
    resetAt: null,
    migratedFrom: null,
  }
}

export function normalizeLedgerState(state, fallbackState = createEmptyAdreemState()) {
  const safeState = state && typeof state === 'object' ? state : {}
  const accounts = Array.isArray(safeState.accounts) ? safeState.accounts : fallbackState.accounts
  const movements = Array.isArray(safeState.movements) ? safeState.movements : fallbackState.movements
  const identity = normalizeLedgerIdentity(safeState, fallbackState)
  const previousVersion = Number(safeState.version || 1)
  return {
    ...identity,
    accounts: normalizeLedgerAccounts(accounts),
    movements,
    dimensions: normalizeList(safeState.dimensions || fallbackState.dimensions),
    attachments: normalizeList(safeState.attachments || fallbackState.attachments),
    recurringRules: normalizeList(safeState.recurringRules || fallbackState.recurringRules),
    reconciliations: normalizeList(safeState.reconciliations || fallbackState.reconciliations),
    ignoredExternalAccounts: normalizeStringList(safeState.ignoredExternalAccounts || fallbackState.ignoredExternalAccounts),
    auditEvents: normalizeEventList(safeState.auditEvents || fallbackState.auditEvents),
    version: LEDGER_STATE_VERSION,
    savedAt: safeState.savedAt || new Date().toISOString(),
    resetAt: safeState.resetAt || null,
    migratedFrom: safeState.migratedFrom || (previousVersion < ADREEM_LEDGER_VERSION ? 'adreem-ledger-v1' : null),
  }
}

export function stateTimestamp(state) {
  const time = new Date(state?.savedAt || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function recordTimestamp(record) {
  return [
    record?.updatedAt,
    record?.reviewedAt,
    record?.disabledAt,
    record?.voidedAt,
    record?.createdAt,
  ].reduce((latest, value) => {
    const time = new Date(value || 0).getTime()
    return Number.isFinite(time) ? Math.max(latest, time) : latest
  }, 0)
}

export function mergeRecordsById(left = [], right = []) {
  // ADREEM uses append-only status changes for safety: void/inactive/disabled records
  // are kept and merged, while physical deletion is reserved for full-ledger reset.
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

export function mergeLedgerStates(localState, remoteState, fallbackState = createEmptyAdreemState()) {
  const local = normalizeLedgerState(localState, fallbackState)
  const remote = normalizeLedgerState(remoteState, fallbackState)
  const localReset = stateTimestamp({ savedAt: local.resetAt })
  const remoteReset = stateTimestamp({ savedAt: remote.resetAt })

  if (remoteReset > localReset) return remote
  if (localReset > remoteReset) return local

  const savedAt = stateTimestamp(remote) >= stateTimestamp(local) ? remote.savedAt : local.savedAt
  const identity = stateTimestamp(remote) >= stateTimestamp(local)
    ? normalizeLedgerIdentity(remote, local)
    : normalizeLedgerIdentity(local, remote)
  return {
    ...identity,
    version: LEDGER_STATE_VERSION,
    savedAt,
    resetAt: remote.resetAt || local.resetAt || null,
    migratedFrom: remote.migratedFrom || local.migratedFrom || null,
    accounts: mergeRecordsById(local.accounts, remote.accounts),
    movements: mergeRecordsById(local.movements, remote.movements),
    dimensions: mergeRecordsById(local.dimensions, remote.dimensions),
    attachments: mergeRecordsById(local.attachments, remote.attachments),
    recurringRules: mergeRecordsById(local.recurringRules, remote.recurringRules),
    reconciliations: mergeRecordsById(local.reconciliations, remote.reconciliations),
    ignoredExternalAccounts: Array.from(new Set([
      ...(local.ignoredExternalAccounts || []),
      ...(remote.ignoredExternalAccounts || []),
    ])),
    auditEvents: mergeRecordsById(local.auditEvents, remote.auditEvents),
  }
}

export function selectPersistedLedgerRows(rows = [], fallbackState = createEmptyAdreemState(), options = {}) {
  const fallback = normalizeLedgerState(fallbackState, fallbackState)
  const primaryRowId = options.primaryRowId || STATE_ROW_ID
  const legacyRowId = options.legacyRowId || LEGACY_STATE_ROW_ID
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.payload)
    .map((row) => ({
      id: row.id,
      updatedAt: row.updated_at || row.updatedAt || null,
      state: normalizeLedgerState(row.payload, fallback),
    }))
  const primary = normalizedRows.find((row) => row.id === primaryRowId)
  const legacy = normalizedRows.find((row) => row.id === legacyRowId)

  if (primary && legacy) {
    return {
      state: primary.state,
      updatedAt: primary.updatedAt,
      rowId: primary.id,
      source: 'primary',
    }
  }
  if (primary) {
    return {
      state: primary.state,
      updatedAt: primary.updatedAt,
      rowId: primary.id,
      source: 'primary',
    }
  }
  if (legacy) {
    return {
      state: legacy.state,
      updatedAt: null,
      rowId: null,
      legacyUpdatedAt: legacy.updatedAt,
      source: 'legacy',
    }
  }
  return {
    state: fallback,
    updatedAt: null,
    rowId: null,
    source: 'fallback',
  }
}

export function sameRecordVersions(left = [], right = []) {
  if (left.length !== right.length) return false
  const version = (item) => [
    recordTimestamp(item),
    item.status || '',
    item.mergedIntoAccountId || '',
  ].join(':')
  const leftKeys = left.map((item) => `${item.id}:${version(item)}`).sort()
  const rightKeys = right.map((item) => `${item.id}:${version(item)}`).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}

function canonicalSerializableValue(value, insideArray = false) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return insideArray ? null : undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => canonicalSerializableValue(item, true))
  if (typeof value?.toJSON === 'function') return canonicalSerializableValue(value.toJSON(), insideArray)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalSerializableValue(value[key], false)])
        .filter(([, item]) => item !== undefined),
    )
  }
  return insideArray ? null : undefined
}

export function sameSerializableContent(left, right) {
  if (left === right) return true
  return JSON.stringify(canonicalSerializableValue(left)) === JSON.stringify(canonicalSerializableValue(right))
}
