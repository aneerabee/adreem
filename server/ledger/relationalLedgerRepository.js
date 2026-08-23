import { createHash } from 'node:crypto'
import { createLedgerDelta, isLedgerDeltaEmpty } from '../../src/ledger/ledgerDelta.js'
import { createLedgerIdentity, normalizeLedgerState } from '../../src/ledger/ledgerState.js'
import { ALLOWED_ATTACHMENT_MIME_TYPES, ATTACHMENT_MAX_SIZE_BYTES } from '../../src/ledger/ledgerOperations.js'
import { attachmentContentMatchesMime } from './attachmentValidation.js'
import { ConcurrentLedgerUpdateError } from './ledgerRepository.js'

const DEFAULT_MOVEMENT_PAGE_SIZE = 100
const MAX_MOVEMENT_PAGE_SIZE = 250
const DEFAULT_AUDIT_EVENT_LIMIT = 250
const MAX_ACTIVE_RECURRING_RULES = 250
const TABLE_PAGE_SIZE = 1_000
const IN_FILTER_MAX_ITEMS = 50
const IN_FILTER_MAX_ENCODED_LENGTH = 1_500
const MAX_BOOTSTRAP_REVIEW_MOVEMENTS = 1
const MAX_SNAPSHOT_ATTEMPTS = 3

function cleanAttachmentFileName(value = '') {
  return String(value || 'attachment')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'attachment'
}

function attachmentBucket(env = process.env) {
  const bucket = String(env.ADREEM_ATTACHMENTS_BUCKET || '').trim()
  if (!bucket) throw new Error('Attachments bucket is not configured.')
  return bucket
}

function repositoryError(error, fallback) {
  const message = error?.message || fallback
  const nextError = new Error(message)
  nextError.code = error?.code || ''
  nextError.details = error?.details || ''
  return nextError
}

async function requiredResult(request, fallback) {
  const { data, error, count } = await request
  if (error) throw repositoryError(error, fallback)
  return { data, count }
}

async function fetchAll(client, table, columns, ledgerId) {
  const rows = []
  for (let from = 0; ; from += TABLE_PAGE_SIZE) {
    const { data } = await requiredResult(
      client
        .from(table)
        .select(columns)
        .eq('ledger_id', ledgerId)
        .range(from, from + TABLE_PAGE_SIZE - 1),
      `Failed to load ${table}.`,
    )
    rows.push(...(data || []))
    if (!data || data.length < TABLE_PAGE_SIZE) return rows
  }
}

function filterValueChunks(values = []) {
  const chunks = []
  let current = []
  let encodedLength = 0
  const uniqueValues = Array.from(new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean)))

  for (const value of uniqueValues) {
    const valueLength = encodeURIComponent(value).length + 1
    if (current.length && (
      current.length >= IN_FILTER_MAX_ITEMS
      || encodedLength + valueLength > IN_FILTER_MAX_ENCODED_LENGTH
    )) {
      chunks.push(current)
      current = []
      encodedLength = 0
    }
    current.push(value)
    encodedLength += valueLength
  }
  if (current.length) chunks.push(current)
  return chunks
}

function mergeRowsByRecordId(...collections) {
  const byId = new Map()
  for (const rows of collections) {
    for (const row of rows || []) {
      if (row?.record_id) byId.set(row.record_id, row)
    }
  }
  return Array.from(byId.values())
}

async function loadAttachmentRows(client, ledgerId, configureRequest = (request) => request) {
  const rows = []
  for (let from = 0; ; from += TABLE_PAGE_SIZE) {
    let request = client
      .from('adreem_attachments')
      .select('record_id, payload')
      .eq('ledger_id', ledgerId)
    request = configureRequest(request)
    const { data } = await requiredResult(
      request
        .order('record_id', { ascending: true })
        .range(from, from + TABLE_PAGE_SIZE - 1),
      'Failed to load adreem_attachments.',
    )
    rows.push(...(data || []))
    if (!data || data.length < TABLE_PAGE_SIZE) return rows
  }
}

function loadAllAttachments(client, ledgerId) {
  return loadAttachmentRows(client, ledgerId)
}

async function loadAccountAttachments(client, ledgerId) {
  const { data } = await requiredResult(
    client.rpc('adreem_latest_account_attachments', {
      p_ledger_id: ledgerId,
      p_limit_per_account: 5,
    }),
    'Failed to load recent account attachments.',
  )
  return data || []
}

async function loadLatestReconciliations(client, ledgerId) {
  const { data } = await requiredResult(
    client.rpc('adreem_latest_reconciliations', { p_ledger_id: ledgerId }),
    'Failed to load latest reconciliations.',
  )
  return data || []
}

async function loadActiveRecurringRules(client, ledgerId) {
  const { data } = await requiredResult(
    client
      .from('adreem_recurring_rules')
      .select('record_id, payload')
      .eq('ledger_id', ledgerId)
      .eq('status', 'active')
      .order('next_run_at', { ascending: true })
      .range(0, MAX_ACTIVE_RECURRING_RULES),
    'Failed to load active recurring rules.',
  )
  const rows = data || []
  if (rows.length > MAX_ACTIVE_RECURRING_RULES) {
    throw new Error('ADREEM supports up to 250 active recurring rules per ledger.')
  }
  return rows
}

async function loadMovementAttachments(client, ledgerId, movementIds = []) {
  const rows = []
  for (const movementIdChunk of filterValueChunks(movementIds)) {
    rows.push(...await loadAttachmentRows(
      client,
      ledgerId,
      (request) => request.in('movement_id', movementIdChunk),
    ))
  }
  return mergeRowsByRecordId(rows)
}

async function loadAllAuditEvents(client, ledgerId) {
  const rows = []
  for (let from = 0; ; from += TABLE_PAGE_SIZE) {
    const { data } = await requiredResult(
      client
        .from('adreem_audit_events')
        .select('record_id, payload')
        .eq('ledger_id', ledgerId)
        .order('created_at', { ascending: true })
        .order('record_id', { ascending: true })
        .range(from, from + TABLE_PAGE_SIZE - 1),
      'Failed to load adreem_audit_events.',
    )
    rows.push(...(data || []))
    if (!data || data.length < TABLE_PAGE_SIZE) return rows
  }
}

async function loadRecentAuditEvents(client, ledgerId) {
  const { data } = await requiredResult(
    client
      .from('adreem_audit_events')
      .select('record_id, payload')
      .eq('ledger_id', ledgerId)
      .order('created_at', { ascending: false })
      .range(0, DEFAULT_AUDIT_EVENT_LIMIT - 1),
    'Failed to load adreem_audit_events.',
  )
  return (data || []).slice(0, DEFAULT_AUDIT_EVENT_LIMIT)
}

function accountFromRow(row = {}) {
  return {
    ...(row.payload || {}),
    id: row.record_id,
    balanceDinar: safeDatabaseInteger(row.balance_dinar, 'account balance'),
    balanceUsd: safeDatabaseInteger(row.balance_usd, 'account balance'),
    balanceTry: safeDatabaseInteger(row.balance_try, 'account balance'),
    postedCount: safeDatabaseInteger(row.posted_count, 'posted movement count'),
    structureLocked: Boolean(row.structure_locked),
    balanceSource: 'database',
  }
}

function safeDatabaseInteger(value, label) {
  const number = Number(value || 0)
  if (!Number.isSafeInteger(number)) {
    throw new Error(`ADREEM database returned an unsafe ${label}.`)
  }
  return number
}

function payloadFromRow(row = {}) {
  return {
    ...(row.payload || {}),
    id: row.record_id,
    ...(row.sequence === undefined ? {} : { databaseSequence: safeDatabaseInteger(row.sequence, 'movement sequence') }),
  }
}

function movementPageSize(value) {
  const parsed = Number(value || DEFAULT_MOVEMENT_PAGE_SIZE)
  if (!Number.isFinite(parsed)) return DEFAULT_MOVEMENT_PAGE_SIZE
  return Math.min(MAX_MOVEMENT_PAGE_SIZE, Math.max(1, Math.trunc(parsed)))
}

function movementOffset(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function movementCursor(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function movementSearchQuery(value) {
  const query = String(value || '').trim()
  if (query.length > 120) {
    const error = new Error('Movement search is too long.')
    error.status = 400
    throw error
  }
  return query
}

export function postgrestFilterValue(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 200) {
    const error = new Error('Invalid account filter.')
    error.status = 400
    throw error
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function loadMovementPage(client, ledgerId, options = {}) {
  const limit = movementPageSize(options.movementLimit)
  const offset = movementOffset(options.movementOffset)
  const beforeSequence = movementCursor(options.beforeSequence)
  const includeTotal = !beforeSequence && offset === 0 && options.includeTotal !== false
  let request = client
    .from('adreem_movements')
    .select('record_id, payload, sequence', includeTotal ? { count: 'exact' } : {})
    .eq('ledger_id', ledgerId)
    .order('sequence', { ascending: false })

  if (beforeSequence) request = request.lt('sequence', beforeSequence)

  if (options.accountId) {
    const accountId = postgrestFilterValue(options.accountId)
    request = request.or(`source_account_id.eq.${accountId},destination_account_id.eq.${accountId}`)
  }
  if (options.status) request = request.eq('status', options.status)
  if (options.movementType) request = request.eq('movement_type', options.movementType)
  if (Array.isArray(options.movementTypes) && options.movementTypes.length) {
    request = request.in('movement_type', options.movementTypes.map(String))
  }
  if (options.dimensionId) request = request.eq('dimension_id', String(options.dimensionId))
  if (options.expenseCategoryUncategorized) request = request.is('expense_category_id', null)
  else if (options.expenseCategoryId) request = request.eq('expense_category_id', String(options.expenseCategoryId))
  if (options.excludeOpening) request = request.neq('movement_type', 'opening_balance')
  if (options.occurredFrom) request = request.gte('occurred_at', String(options.occurredFrom))
  if (options.occurredBefore) request = request.lt('occurred_at', String(options.occurredBefore))
  request = request.range(beforeSequence ? 0 : offset, (beforeSequence ? 0 : offset) + limit)

  const { data, count } = await requiredResult(request, 'Failed to load movements.')
  const rows = (data || []).slice(0, limit)
  const movements = rows.map(payloadFromRow)
  return {
    movements,
    page: {
      offset,
      limit,
      total: count === null || count === undefined ? null : Number(count),
      hasMore: (data || []).length > limit,
      nextCursor: rows.length ? Number(rows[rows.length - 1].sequence) : null,
    },
  }
}

async function loadMovementSearchPage(client, ledger, ownerId, options = {}) {
  const limit = movementPageSize(options.movementLimit)
  const beforeSequence = movementCursor(options.beforeSequence)
  const includeTotal = !beforeSequence && options.includeTotal !== false
  const query = movementSearchQuery(options.query)
  const { data } = await requiredResult(
    client.rpc('adreem_search_ledger_movements', {
      p_ledger_id: ledger.id,
      p_owner_id: ownerId || null,
      p_before_sequence: beforeSequence,
      p_limit: limit,
      p_query: query || null,
      p_account_id: options.accountId ? String(options.accountId) : null,
      p_status: options.status ? String(options.status) : null,
      p_movement_type: options.movementType ? String(options.movementType) : null,
      p_dimension_id: options.dimensionId ? String(options.dimensionId) : null,
      p_expense_category_id: options.expenseCategoryId ? String(options.expenseCategoryId) : null,
      p_exclude_opening: options.excludeOpening !== false,
      p_occurred_from: options.occurredFrom ? String(options.occurredFrom) : null,
      p_occurred_before: options.occurredBefore ? String(options.occurredBefore) : null,
      p_include_total: includeTotal,
    }),
    'Failed to search movements.',
  )
  const rows = Array.isArray(data) ? data : []
  const scannedRows = rows.slice(0, limit)
  const allowedTypes = Array.isArray(options.movementTypes) && options.movementTypes.length
    ? new Set(options.movementTypes.map(String))
    : null
  const visibleRows = allowedTypes
    ? scannedRows.filter((row) => allowedTypes.has(String(row.payload?.type || '')))
    : scannedRows
  return {
    movements: visibleRows.map(payloadFromRow),
    page: {
      offset: 0,
      limit,
      total: allowedTypes || rows[0]?.total_count === null || rows[0]?.total_count === undefined ? null : Number(rows[0].total_count),
      hasMore: rows.length > limit,
      nextCursor: scannedRows.length ? Number(scannedRows[scannedRows.length - 1].sequence) : null,
    },
  }
}

async function loadAllMovements(client, ledgerId) {
  const rows = []
  for (let from = 0; ; from += TABLE_PAGE_SIZE) {
    const { data } = await requiredResult(
      client
        .from('adreem_movements')
        .select('record_id, payload, sequence')
        .eq('ledger_id', ledgerId)
        .order('sequence', { ascending: false })
        .range(from, from + TABLE_PAGE_SIZE - 1),
      'Failed to load movements.',
    )
    rows.push(...(data || []))
    if (!data || data.length < TABLE_PAGE_SIZE) break
  }
  return {
    movements: rows.map(payloadFromRow),
    page: { offset: 0, limit: rows.length, total: rows.length, hasMore: false },
  }
}

async function loadMovementRecords(client, ledgerId, movementIds = []) {
  const ids = (Array.isArray(movementIds) ? movementIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
  if (!ids.length) return { movements: [], page: { offset: 0, limit: 0, total: 0, hasMore: false } }
  const rows = []
  for (const idChunk of filterValueChunks(ids)) {
    const { data } = await requiredResult(
      client
        .from('adreem_movements')
        .select('record_id, payload, sequence')
        .eq('ledger_id', ledgerId)
        .in('record_id', idChunk),
      'Failed to load selected movements.',
    )
    rows.push(...(data || []))
  }
  const movements = mergeRowsByRecordId(rows).map(payloadFromRow)
  return { movements, page: { offset: 0, limit: new Set(ids).size, total: movements.length, hasMore: false } }
}

async function loadReviewMovements(client, ledgerId) {
  const { data, count } = await requiredResult(
    client
      .from('adreem_movements')
      .select('record_id, payload, sequence', { count: 'exact' })
      .eq('ledger_id', ledgerId)
      .eq('status', 'needs_review')
      .order('sequence', { ascending: false })
      .range(0, MAX_BOOTSTRAP_REVIEW_MOVEMENTS),
    'Failed to load review movements.',
  )
  const rows = data || []
  return {
    movements: rows.slice(0, MAX_BOOTSTRAP_REVIEW_MOVEMENTS).map(payloadFromRow),
    total: Number(count ?? rows.length),
    truncated: Number(count ?? rows.length) > MAX_BOOTSTRAP_REVIEW_MOVEMENTS,
  }
}

function mergeRelationalMovements(...collections) {
  const byId = new Map()
  for (const movements of collections) {
    for (const movement of movements || []) {
      if (movement?.id) byId.set(movement.id, movement)
    }
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftSequence = Number(left.databaseSequence || 0)
    const rightSequence = Number(right.databaseSequence || 0)
    return leftSequence - rightSequence
  })
}

function normalizeRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

export function normalizeRelationalReports(value = {}) {
  const dimensions = Array.isArray(value?.dimensions) ? value.dimensions : []
  const expenseCategories = Array.isArray(value?.expenseCategories) ? value.expenseCategories : []
  return {
    dimensions: dimensions.map((report) => ({
      ...report,
      movementCount: safeDatabaseInteger(report?.movementCount, 'report movement count'),
      income: safeDatabaseInteger(report?.income, 'report amount'),
      expense: safeDatabaseInteger(report?.expense, 'report amount'),
      net: safeDatabaseInteger(report?.net, 'report amount'),
      incomeUsd: safeDatabaseInteger(report?.incomeUsd, 'report amount'),
      expenseUsd: safeDatabaseInteger(report?.expenseUsd, 'report amount'),
      netUsd: safeDatabaseInteger(report?.netUsd, 'report amount'),
      incomeTry: safeDatabaseInteger(report?.incomeTry, 'report amount'),
      expenseTry: safeDatabaseInteger(report?.expenseTry, 'report amount'),
      netTry: safeDatabaseInteger(report?.netTry, 'report amount'),
    })),
    expenseCategories: expenseCategories.map((report) => ({
      ...report,
      dinar: safeDatabaseInteger(report?.dinar, 'report amount'),
      usd: safeDatabaseInteger(report?.usd, 'report amount'),
      try: safeDatabaseInteger(report?.try, 'report amount'),
      count: safeDatabaseInteger(report?.count, 'report movement count'),
    })),
  }
}

export function createRelationalLedgerRepository(client, options = {}) {
  if (!client) throw new Error('Relational ledger repository requires a Supabase client.')
  const requestedLedgerId = String(options.ledgerId || '').trim()
  const requestedOwnerId = String(options.ownerId || '').trim()
  const env = options.env || process.env

  async function ledgerRow() {
    let request = client
      .from('adreem_ledgers')
      .select('id, owner_id, legacy_ledger_id, name, version, revision, reset_at, updated_at')
      .limit(1)
    if (requestedLedgerId) request = request.eq('id', requestedLedgerId)
    if (requestedOwnerId) request = request.eq('owner_id', requestedOwnerId)
    const { data } = await requiredResult(request.maybeSingle(), 'Failed to load the ledger identity.')
    if (!data) throw new Error('No ADREEM ledger is assigned to this user.')
    return data
  }

  async function loadSnapshot(loadOptions = {}) {
    const ledger = await ledgerRow()
    const includeAllAuditEvents = Boolean(loadOptions.includeAllAuditEvents || loadOptions.includeAllMovements)
    const movementRequest = loadOptions.includeAllMovements
      ? loadAllMovements(client, ledger.id)
      : Array.isArray(loadOptions.movementIds)
        ? loadMovementRecords(client, ledger.id, loadOptions.movementIds)
        : loadMovementPage(client, ledger.id, loadOptions)
    const reviewRequest = loadOptions.includeAllMovements || Array.isArray(loadOptions.movementIds)
      ? Promise.resolve({ movements: [], total: 0, truncated: false })
      : loadReviewMovements(client, ledger.id)
    const accountAttachmentRequest = loadOptions.includeAllMovements
      ? null
      : loadAccountAttachments(client, ledger.id)
    const attachmentRequest = loadOptions.includeAllMovements
      ? loadAllAttachments(client, ledger.id)
      : Promise.all([accountAttachmentRequest, movementRequest, reviewRequest])
          .then(async ([accountAttachments, loadedMovements, reviewMovements]) => {
            const movementIds = mergeRelationalMovements(loadedMovements.movements, reviewMovements.movements)
              .map((movement) => movement.id)
            const movementAttachments = await loadMovementAttachments(client, ledger.id, movementIds)
            return mergeRowsByRecordId(accountAttachments, movementAttachments)
          })
    const [movementResult, reviewResult, accounts, dimensions, attachments, recurringRules, reconciliations, auditEvents, ignoredRows] = await Promise.all([
      movementRequest,
      reviewRequest,
      fetchAll(client, 'adreem_accounts', 'record_id, payload, balance_dinar, balance_usd, balance_try, posted_count, structure_locked', ledger.id),
      fetchAll(client, 'adreem_dimensions', 'record_id, payload', ledger.id),
      attachmentRequest,
      loadOptions.includeAllMovements
        ? fetchAll(client, 'adreem_recurring_rules', 'record_id, payload', ledger.id)
        : loadActiveRecurringRules(client, ledger.id),
      loadOptions.includeAllMovements
        ? fetchAll(client, 'adreem_reconciliations', 'record_id, payload', ledger.id)
        : loadLatestReconciliations(client, ledger.id),
      includeAllAuditEvents
        ? loadAllAuditEvents(client, ledger.id)
        : loadRecentAuditEvents(client, ledger.id),
      fetchAll(client, 'adreem_ignored_external_accounts', 'account_id', ledger.id),
    ])
    const confirmedLedger = await ledgerRow()
    if (normalizeRevision(ledger.revision) !== normalizeRevision(confirmedLedger.revision)) return null
    const identity = createLedgerIdentity({
      tenantId: confirmedLedger.owner_id,
      ledgerId: confirmedLedger.legacy_ledger_id || confirmedLedger.id,
    })
    const state = normalizeLedgerState({
      ...identity,
      accounts: accounts.map(accountFromRow),
      movements: mergeRelationalMovements(movementResult.movements, reviewResult.movements),
      dimensions: dimensions.map(payloadFromRow),
      attachments: attachments.map(payloadFromRow),
      recurringRules: recurringRules.map(payloadFromRow),
      reconciliations: reconciliations.map(payloadFromRow),
      auditEvents: auditEvents.map(payloadFromRow),
      ignoredExternalAccounts: ignoredRows.map((row) => row.account_id),
      version: Number(confirmedLedger.version || 3),
      resetAt: confirmedLedger.reset_at || null,
      savedAt: confirmedLedger.updated_at,
    })
    return {
      state,
      source: 'relational',
      storageMode: 'relational',
      ledgerId: confirmedLedger.id,
      ownerId: confirmedLedger.owner_id,
      revision: normalizeRevision(confirmedLedger.revision),
      updatedAt: confirmedLedger.updated_at,
      movementPage: {
        ...movementResult.page,
        reviewTotal: reviewResult.total,
        reviewTruncated: reviewResult.truncated,
      },
    }
  }

  async function load(loadOptions = {}) {
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const snapshot = await loadSnapshot(loadOptions)
      if (snapshot) return snapshot
    }
    throw new ConcurrentLedgerUpdateError('Ledger changed repeatedly while it was loading. Retry the request.')
  }

  async function applyDelta(delta, expectedRevision) {
    if (isLedgerDeltaEmpty(delta)) return load()
    const ledger = await ledgerRow()
    const revision = normalizeRevision(expectedRevision)
    if (revision === null) throw new ConcurrentLedgerUpdateError('Reload the ledger before saving.')
    const { data, error } = await client.rpc('adreem_apply_ledger_delta', {
      p_ledger_id: ledger.id,
      p_expected_revision: revision,
      p_delta: delta,
      p_owner_id: requestedOwnerId || null,
    })
    if (error) {
      if (error.code === '40001' || String(error.message || '').includes('ADREEM_REVISION_CONFLICT')) {
        throw new ConcurrentLedgerUpdateError('Ledger was updated by another session. Reload before saving.')
      }
      throw repositoryError(error, 'Failed to save the ledger change.')
    }
    return {
      revision: normalizeRevision(data?.[0]?.revision),
      updatedAt: data?.[0]?.updated_at || null,
    }
  }

  async function deleteUnusedAccount(accountId, expectedRevision) {
    const id = String(accountId || '').trim()
    if (!id) throw new Error('Account id is required for deletion.')
    const ledger = await ledgerRow()
    const revision = normalizeRevision(expectedRevision)
    if (revision === null) throw new ConcurrentLedgerUpdateError('Reload the ledger before deleting an account.')
    const { data, error } = await client.rpc('adreem_delete_unused_account', {
      p_ledger_id: ledger.id,
      p_account_id: id,
      p_expected_revision: revision,
      p_owner_id: requestedOwnerId || null,
    })
    if (error) {
      const message = String(error.message || '')
      if (error.code === '40001' || message.includes('ADREEM_REVISION_CONFLICT')) {
        throw new ConcurrentLedgerUpdateError('Ledger was updated by another session. Reload before deleting the account.')
      }
      const nextError = repositoryError(error, 'Failed to delete the unused account.')
      if (message.includes('ADREEM_ACCOUNT_NOT_FOUND')) nextError.code = 'account-not-found'
      if (message.includes('ADREEM_ACCOUNT_DELETE_PROTECTED')) nextError.code = 'account-protected'
      if (message.includes('ADREEM_ACCOUNT_DELETE_IN_USE') || message.includes('ADREEM_ACCOUNT_DELETE_LINKED')) nextError.code = 'account-in-use'
      throw nextError
    }
    const row = data?.[0] || {}
    return {
      revision: normalizeRevision(row.revision),
      updatedAt: row.updated_at || null,
      deletedAccountIds: Array.isArray(row.deleted_account_ids) ? row.deleted_account_ids : [id],
    }
  }

  async function update(updater, updateOptions = {}) {
    const current = await load({
      includeAllMovements: Boolean(updateOptions.includeAllMovements),
      includeAllAuditEvents: Boolean(updateOptions.includeAllAuditEvents),
      ...(Array.isArray(updateOptions.movementIds) ? { movementIds: updateOptions.movementIds } : {}),
    })
    if (updateOptions.expectedRevision !== undefined && normalizeRevision(updateOptions.expectedRevision) !== current.revision) {
      throw new ConcurrentLedgerUpdateError('Ledger was updated by another session. Reload before saving.')
    }
    const result = await updater(current.state)
    if (!result?.state) return { ...result, ...current }
    const delta = createLedgerDelta(result.state, current.state)
    if (isLedgerDeltaEmpty(delta)) return { ...result, ...current, state: current.state }
    await applyDelta(delta, current.revision)
    const refreshed = await load({
      includeAllMovements: Boolean(updateOptions.includeAllMovements),
      includeAllAuditEvents: Boolean(updateOptions.includeAllAuditEvents),
      ...(Array.isArray(updateOptions.movementIds) ? { movementIds: updateOptions.movementIds } : {}),
    })
    return { ...result, ...refreshed, attempts: 1 }
  }

  async function uploadAttachmentFile(file = {}) {
    const ledger = await ledgerRow()
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || '')
    const mimeType = String(file.mimeType || '').trim().toLowerCase()
    if (!buffer.length) throw new Error('Attachment file is empty.')
    if (buffer.length > ATTACHMENT_MAX_SIZE_BYTES) throw new Error('Attachment is larger than 10MB.')
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) throw new Error('Attachment type is not allowed.')
    if (!attachmentContentMatchesMime(buffer, mimeType)) throw new Error('Attachment content does not match its file type.')
    const fileName = cleanAttachmentFileName(file.fileName)
    const date = new Date().toISOString().slice(0, 10)
    const hash = createHash('sha256')
      .update(`${ledger.owner_id}:${ledger.id}:${fileName}:${Date.now()}:${buffer.length}`)
      .digest('hex')
      .slice(0, 16)
    const storagePath = `${ledger.owner_id}/${ledger.id}/${date}/${hash}-${fileName}`
    const { error } = await client.storage.from(attachmentBucket(env)).upload(storagePath, buffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false,
    })
    if (error) throw repositoryError(error, 'Attachment upload failed.')
    return { label: fileName, storagePath, mimeType, sizeBytes: buffer.length }
  }

  async function deleteAttachmentFile(storagePath = '') {
    const ledger = await ledgerRow()
    const prefix = `${ledger.owner_id}/${ledger.id}/`
    const cleanPath = String(storagePath || '').trim()
    if (!cleanPath.startsWith(prefix) || cleanPath.includes('..')) {
      throw new Error('Attachment path is outside this ledger.')
    }
    const { error } = await client.storage.from(attachmentBucket(env)).remove([cleanPath])
    if (error) throw repositoryError(error, 'Attachment deletion failed.')
    return { ok: true }
  }

  async function loadReports() {
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const ledger = await ledgerRow()
      const { data, error } = await client.rpc('adreem_ledger_report_summary', {
        p_ledger_id: ledger.id,
        p_owner_id: requestedOwnerId || null,
      })
      if (error) throw repositoryError(error, 'Failed to load ledger reports.')
      const confirmedLedger = await ledgerRow()
      const revision = normalizeRevision(confirmedLedger.revision)
      if (normalizeRevision(ledger.revision) !== revision) continue
      return { ...normalizeRelationalReports(data), revision }
    }
    throw new ConcurrentLedgerUpdateError('Ledger changed repeatedly while reports were loading. Retry the request.')
  }

  return {
    storageMode: 'relational',
    load,
    loadMovements: async (pageOptions = {}) => {
      for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const ledger = await ledgerRow()
        const result = pageOptions.query
          ? await loadMovementSearchPage(client, ledger, requestedOwnerId || ledger.owner_id, pageOptions)
          : await loadMovementPage(client, ledger.id, pageOptions)
        const attachments = await loadMovementAttachments(
          client,
          ledger.id,
          result.movements.map((movement) => movement.id),
        )
        const confirmedLedger = await ledgerRow()
        const revision = normalizeRevision(confirmedLedger.revision)
        if (normalizeRevision(ledger.revision) === revision) {
          return { ...result, attachments: attachments.map(payloadFromRow), revision }
        }
      }
      throw new ConcurrentLedgerUpdateError('Ledger changed repeatedly while movements were loading. Retry the request.')
    },
    applyDelta,
    deleteUnusedAccount,
    update,
    uploadAttachmentFile,
    deleteAttachmentFile,
    loadReports,
  }
}
