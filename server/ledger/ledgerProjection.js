import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import {
  CURRENCIES,
  MAX_EXCHANGE_RATE,
  MAX_MONEY_AMOUNT,
  MOVEMENT_STATUSES,
  buildPostingEntries,
} from '../../src/ledger/ledgerCore.js'
import { normalizeLedgerState } from '../../src/ledger/ledgerState.js'

const RECORD_COLLECTIONS = [
  'accounts',
  'movements',
  'dimensions',
  'attachments',
  'recurringRules',
  'reconciliations',
  'auditEvents',
]

const ACCOUNT_PAIRS = new Set([
  'person:receivable',
  'cash:cash',
  'bank:bank',
  'expense:expense',
  'asset:asset',
  'project:project',
  'summary:summary',
  'review:review',
])

const DATABASE_DERIVED_RECORD_FIELDS = {
  accounts: new Set(['balanceDinar', 'balanceUsd', 'postedCount', 'structureLocked', 'balanceSource']),
  movements: new Set(['databaseSequence']),
}

function chunks(records = [], size = 250) {
  const safeSize = Math.max(1, Math.min(1_000, Math.trunc(Number(size) || 250)))
  const result = []
  for (let index = 0; index < records.length; index += safeSize) {
    result.push(records.slice(index, index + safeSize))
  }
  return result
}

function duplicateIds(records = []) {
  const seen = new Set()
  const duplicates = new Set()
  for (const record of records) {
    if (!record?.id) continue
    if (seen.has(record.id)) duplicates.add(record.id)
    seen.add(record.id)
  }
  return Array.from(duplicates)
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => [key, canonicalValue(value[key])]))
}

function comparableRecord(collection, record = {}) {
  const ignoredFields = DATABASE_DERIVED_RECORD_FIELDS[collection] || new Set()
  return canonicalValue(Object.fromEntries(Object.entries(record)
    .filter(([key]) => !ignoredFields.has(key))))
}

function canonicalList(values = []) {
  return values
    .map(canonicalValue)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function canonicalResetAt(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value)
}

function privateAttachmentPath(storagePath, ledgerId, requireLedgerPrefix) {
  const path = String(storagePath || '').trim()
  const prefix = `${String(ledgerId || '').trim()}/`
  if (!path || path.startsWith('/') || path.includes('\\')) return false
  if (requireLedgerPrefix && (!prefix || !path.startsWith(prefix))) return false
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return false
  return !path.split('/').some((part) => part === '..' || !part)
}

function postingTotals(state = {}) {
  const totals = new Map((state.accounts || []).map((account) => [account.id, {
    dinar: 0,
    usd: 0,
    postedCount: 0,
  }]))
  for (const movement of state.movements || []) {
    if (movement.status !== MOVEMENT_STATUSES.POSTED) continue
    for (const entry of buildPostingEntries(movement)) {
      const bucket = totals.get(entry.accountId)
      if (!bucket) continue
      if (entry.currency === CURRENCIES.DINAR) bucket.dinar += Math.round(Number(entry.delta || 0))
      if (entry.currency === CURRENCIES.USD) bucket.usd += Math.round(Number(entry.delta || 0))
      bucket.postedCount += 1
    }
  }
  return totals
}

export function projectMovementEntries(sourceState = {}) {
  const movements = Array.isArray(sourceState) ? sourceState : sourceState.movements || []
  return movements.filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED)
    .flatMap((movement) => buildPostingEntries(movement).map((entry, entryIndex) => ({
      movementId: movement.id,
      entryIndex,
      accountId: entry.accountId,
      currency: entry.currency,
      delta: Math.round(Number(entry.delta || 0)),
    })))
}

function movementEntryKey(entry = {}) {
  return `${String(entry.movementId || '')}:${Number(entry.entryIndex)}`
}

function compareMovementEntries(expectedEntries, actualEntries) {
  const errors = []
  const expectedByKey = new Map(expectedEntries.map((entry) => [movementEntryKey(entry), canonicalValue(entry)]))
  const actualByKey = new Map(actualEntries.map((entry) => [movementEntryKey(entry), canonicalValue({
    movementId: entry.movementId,
    entryIndex: Number(entry.entryIndex),
    accountId: entry.accountId,
    currency: entry.currency,
    delta: Math.round(Number(entry.delta || 0)),
  })]))
  for (const [key, expected] of expectedByKey) {
    const actual = actualByKey.get(key)
    if (!actual) {
      errors.push({ code: 'missing-target-movement-entry', key, expected })
    } else if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      errors.push({ code: 'target-movement-entry-mismatch', key, expected, actual })
    }
  }
  for (const [key, actual] of actualByKey) {
    if (!expectedByKey.has(key)) errors.push({ code: 'unexpected-target-movement-entry', key, actual })
  }
  return errors
}

function normalizedRecurringRules(rules = []) {
  return rules.map((rule) => ({
    ...rule,
    status: rule.status === 'inactive' || rule.disabledAt ? 'inactive' : 'active',
  }))
}

function normalizedDimensions(dimensions = []) {
  return dimensions.map((dimension) => ({
    ...dimension,
    status: dimension.status === 'inactive' ? 'inactive' : 'active',
  }))
}

function projectedDimensions(accounts = [], dimensions = []) {
  const byId = new Map(normalizedDimensions(dimensions).map((dimension) => [dimension.id, dimension]))
  for (const account of accounts) {
    if (![VALUE_KINDS.ASSET, VALUE_KINDS.PROJECT].includes(account?.valueKind)) continue
    const id = account.dimensionId || `dimension-account-${account.id}`
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name: account.ownerName || account.subAccountName || account.legacyName || account.id,
      type: account.valueKind === VALUE_KINDS.PROJECT ? 'project' : 'asset',
      linkedAccountId: account.id,
      status: account.status === ACCOUNT_STATUSES.INACTIVE ? 'inactive' : 'active',
      createdAt: account.createdAt || new Date(0).toISOString(),
      generatedDuringMigration: true,
    })
  }
  return Array.from(byId.values())
}

export function prepareLedgerProjection(sourceState = {}) {
  const state = normalizeLedgerState(sourceState, sourceState)
  const accounts = state.accounts.map((account) => ({
    ...account,
    status: account.status || ACCOUNT_STATUSES.ACTIVE,
  }))
  return {
    ...state,
    accounts,
    dimensions: projectedDimensions(accounts, state.dimensions),
    recurringRules: normalizedRecurringRules(state.recurringRules),
  }
}

export function validateLedgerProjection(sourceState = {}, options = {}) {
  const state = prepareLedgerProjection(sourceState)
  const errors = []
  const accountById = new Map(state.accounts.map((account) => [account.id, account]))
  const accountIds = new Set(accountById.keys())
  const movementIds = new Set(state.movements.map((movement) => movement.id))
  const dimensionIds = new Set(state.dimensions.map((dimension) => dimension.id))

  for (const collection of RECORD_COLLECTIONS) {
    for (const id of duplicateIds(state[collection])) {
      errors.push({ code: 'duplicate-id', collection, id })
    }
    const missingId = state[collection].findIndex((record) => !String(record?.id || '').trim())
    if (missingId >= 0) errors.push({ code: 'missing-id', collection, index: missingId })
  }

  for (const account of state.accounts) {
    if (!ACCOUNT_PAIRS.has(`${account.type}:${account.valueKind}`)) {
      errors.push({ code: 'invalid-account-structure', accountId: account.id })
    }
    if (![CURRENCIES.DINAR, CURRENCIES.USD, 'multi'].includes(account.currencyKind)) {
      errors.push({ code: 'invalid-account-currency', accountId: account.id })
    }
    if (![ACCOUNT_STATUSES.ACTIVE, ACCOUNT_STATUSES.INACTIVE, ACCOUNT_STATUSES.NEEDS_REVIEW].includes(account.status)) {
      errors.push({ code: 'invalid-account-status', accountId: account.id })
    }
  }

  for (const movement of state.movements) {
    const amount = Number(movement.amount)
    if (
      movement.amount !== undefined &&
      movement.amount !== null &&
      (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_MONEY_AMOUNT)
    ) {
      errors.push({ code: 'invalid-movement-amount', movementId: movement.id })
    }
    if (movement.rate !== undefined && movement.rate !== null) {
      const rate = Number(movement.rate)
      if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate) > MAX_EXCHANGE_RATE) {
        errors.push({ code: 'invalid-movement-rate', movementId: movement.id })
      }
    }
    if (movement.currency && ![CURRENCIES.DINAR, CURRENCIES.USD].includes(movement.currency)) {
      errors.push({ code: 'invalid-movement-currency', movementId: movement.id })
    }
    if (movement.dimensionId && !dimensionIds.has(movement.dimensionId)) {
      errors.push({ code: 'missing-dimension', movementId: movement.id, dimensionId: movement.dimensionId })
    }
    if (movement.expenseCategoryId) {
      const category = accountById.get(movement.expenseCategoryId)
      if (!category || category.valueKind !== VALUE_KINDS.EXPENSE) {
        errors.push({ code: 'invalid-expense-category', movementId: movement.id, accountId: movement.expenseCategoryId })
      }
    }
    if (movement.status !== MOVEMENT_STATUSES.POSTED) continue
    const entries = buildPostingEntries(movement)
    if (entries.some((entry) => !Number.isSafeInteger(entry.delta) || Math.abs(entry.delta) > MAX_MONEY_AMOUNT)) {
      errors.push({ code: 'invalid-movement-entry-amount', movementId: movement.id })
      continue
    }
    if (!entries.length && movement.type !== 'record_only') errors.push({ code: 'posted-movement-without-entries', movementId: movement.id })
    if (movement.type === 'record_only') {
      if (!String(movement.note || '').trim()) errors.push({ code: 'record-only-note-required', movementId: movement.id })
      if (movement.sourceAccountId || movement.destinationAccountId) errors.push({ code: 'record-only-account-reference', movementId: movement.id })
    }
    for (const entry of entries) {
      if (!accountById.has(entry.accountId)) {
        errors.push({ code: 'missing-posting-account', movementId: movement.id, accountId: entry.accountId })
      }
    }
  }

  for (const attachment of state.attachments) {
    const storagePath = String(attachment.storagePath || '').trim()
    if (!storagePath) {
      errors.push({ code: 'attachment-missing-private-storage-path', attachmentId: attachment.id })
    } else if (!privateAttachmentPath(storagePath, state.ledgerId, Boolean(options.requireLedgerAttachmentPrefix))) {
      errors.push({ code: 'attachment-invalid-private-storage-path', attachmentId: attachment.id, storagePath })
    }
    if (!attachment.accountId && !attachment.movementId) {
      errors.push({ code: 'orphan-attachment', attachmentId: attachment.id })
    }
    if (attachment.accountId && !accountIds.has(attachment.accountId)) {
      errors.push({ code: 'attachment-account-missing', attachmentId: attachment.id, accountId: attachment.accountId })
    }
    if (attachment.movementId && !movementIds.has(attachment.movementId)) {
      errors.push({ code: 'attachment-movement-missing', attachmentId: attachment.id, movementId: attachment.movementId })
    }
  }

  const totals = postingTotals(state)
  for (const account of state.accounts) {
    const total = totals.get(account.id) || { dinar: 0, usd: 0 }
    if ([VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.ASSET].includes(account.valueKind) &&
      (total.dinar < 0 || total.usd < 0)) {
      errors.push({ code: 'negative-owned-balance', accountId: account.id, dinar: total.dinar, usd: total.usd })
    }
  }

  return { ok: errors.length === 0, errors, state, totals }
}

export function createLedgerMigrationBatches(sourceState = {}, options = {}) {
  const validation = validateLedgerProjection(sourceState)
  if (!validation.ok) {
    const error = new Error(`ADREEM migration source failed validation: ${validation.errors[0]?.code || 'unknown'}`)
    error.validation = validation
    throw error
  }
  const state = validation.state
  const batchSize = options.batchSize || 250
  const batches = []
  for (const collection of ['accounts', 'dimensions', 'movements', 'attachments', 'recurringRules', 'reconciliations', 'auditEvents']) {
    for (const records of chunks(state[collection], batchSize)) {
      batches.push({ collection, delta: { [collection]: records } })
    }
  }
  if ((state.ignoredExternalAccounts || []).length || state.resetAt) {
    batches.push({
      collection: 'ledger',
      delta: {
        ignoredExternalAccounts: state.ignoredExternalAccounts || [],
        ...(state.resetAt ? { resetAt: state.resetAt } : {}),
      },
    })
  }
  return { state, batches }
}

export function compareProjectedBatch(batch = {}, targetState = {}) {
  const collection = String(batch.collection || '')
  const errors = []
  if (collection === 'ledger') {
    if (Object.hasOwn(batch.delta || {}, 'ignoredExternalAccounts')) {
      const expected = canonicalList(batch.delta.ignoredExternalAccounts || [])
      const actual = canonicalList(targetState.ignoredExternalAccounts || [])
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        errors.push({ code: 'ignored-external-accounts-mismatch', expected, actual })
      }
    }
    if (Object.hasOwn(batch.delta || {}, 'resetAt')) {
      const expected = canonicalResetAt(batch.delta.resetAt)
      const actual = canonicalResetAt(targetState.resetAt)
      if (expected !== actual) errors.push({ code: 'reset-at-mismatch', expected, actual })
    }
    return { ok: errors.length === 0, errors }
  }

  const expectedRecords = Array.isArray(batch.delta?.[collection]) ? batch.delta[collection] : []
  const actualRecords = Array.isArray(targetState?.[collection]) ? targetState[collection] : []
  const actualById = new Map(actualRecords.map((record) => [record.id, record]))
  for (const expectedRecord of expectedRecords) {
    const actualRecord = actualById.get(expectedRecord.id)
    if (!actualRecord) {
      errors.push({ code: 'missing-target-record', collection, id: expectedRecord.id })
      continue
    }
    const expected = comparableRecord(collection, expectedRecord)
    const actual = comparableRecord(collection, actualRecord)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      errors.push({ code: 'target-record-payload-mismatch', collection, id: expectedRecord.id, expected, actual })
    }
  }
  if (collection === 'movements') {
    const movementIds = new Set(expectedRecords.map((movement) => movement.id))
    const expectedEntries = projectMovementEntries(expectedRecords)
    const actualEntries = (targetState.movementEntries || []).filter((entry) => movementIds.has(entry.movementId))
    errors.push(...compareMovementEntries(expectedEntries, actualEntries))
  }
  return { ok: errors.length === 0, errors }
}

export function compareProjectedLedger(sourceState = {}, targetState = {}) {
  const source = validateLedgerProjection(sourceState)
  const errors = [...source.errors]

  for (const collection of RECORD_COLLECTIONS) {
    const expectedRecords = [...source.state[collection]].sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const actualRecords = [...(Array.isArray(targetState?.[collection]) ? targetState[collection] : [])]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const expectedIds = new Set(expectedRecords.map((record) => record.id))
    const actualIds = new Set(actualRecords.map((record) => record.id))
    for (const id of expectedIds) if (!actualIds.has(id)) errors.push({ code: 'missing-target-record', collection, id })
    for (const id of actualIds) if (!expectedIds.has(id)) errors.push({ code: 'unexpected-target-record', collection, id })
    const actualById = new Map(actualRecords.map((record) => [record.id, record]))
    for (const expectedRecord of expectedRecords) {
      const actualRecord = actualById.get(expectedRecord.id)
      if (!actualRecord) continue
      const expected = comparableRecord(collection, expectedRecord)
      const actual = comparableRecord(collection, actualRecord)
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        errors.push({ code: 'target-record-payload-mismatch', collection, id: expectedRecord.id, expected, actual })
      }
    }
  }

  const targetById = new Map((Array.isArray(targetState?.accounts) ? targetState.accounts : [])
    .map((account) => [account.id, account]))
  for (const [accountId, expected] of source.totals.entries()) {
    const actual = targetById.get(accountId)
    if (!actual) continue
    const actualDinar = Math.round(Number(actual.balanceDinar || 0))
    const actualUsd = Math.round(Number(actual.balanceUsd || 0))
    const actualPostedCount = Math.round(Number(actual.postedCount || 0))
    if (actualDinar !== expected.dinar || actualUsd !== expected.usd || actualPostedCount !== expected.postedCount) {
      errors.push({
        code: 'balance-mismatch',
        accountId,
        expected,
        actual: { dinar: actualDinar, usd: actualUsd, postedCount: actualPostedCount },
      })
    }
  }

  const expectedIgnoredExternalAccounts = canonicalList(source.state.ignoredExternalAccounts || [])
  const actualIgnoredExternalAccounts = canonicalList(
    Array.isArray(targetState?.ignoredExternalAccounts) ? targetState.ignoredExternalAccounts : [],
  )
  if (JSON.stringify(expectedIgnoredExternalAccounts) !== JSON.stringify(actualIgnoredExternalAccounts)) {
    errors.push({
      code: 'ignored-external-accounts-mismatch',
      expected: expectedIgnoredExternalAccounts,
      actual: actualIgnoredExternalAccounts,
    })
  }

  const expectedResetAt = canonicalResetAt(source.state.resetAt)
  const actualResetAt = canonicalResetAt(targetState?.resetAt)
  if (expectedResetAt !== actualResetAt) {
    errors.push({ code: 'reset-at-mismatch', expected: expectedResetAt, actual: actualResetAt })
  }

  errors.push(...compareMovementEntries(
    projectMovementEntries(source.state),
    Array.isArray(targetState?.movementEntries) ? targetState.movementEntries : [],
  ))

  return { ok: errors.length === 0, errors }
}
