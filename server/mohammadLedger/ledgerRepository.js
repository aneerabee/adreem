import { createClient } from '@supabase/supabase-js'
import {
  ADREEM_STATE_ROW_ID,
  MOHAMMAD_LEGACY_STATE_ROW_ID,
  MOHAMMAD_STATE_ROW_ID,
  MOHAMMAD_STATE_TABLE,
  adreemStateRowId,
  createLedgerIdentity,
  createEmptyAdreemState,
  normalizeLedgerState,
  selectPersistedLedgerRows,
} from '../../src/mohammadLedger/ledgerState.js'

const MAX_SAVE_ATTEMPTS = 4

export class ConcurrentLedgerUpdateError extends Error {
  constructor(message = 'Ledger state changed during save.') {
    super(message)
    this.name = 'ConcurrentLedgerUpdateError'
  }
}

export function createLedgerRepository(env = process.env, options = {}) {
  const ledgerConfig = resolveLedgerConfig(env, options)
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env for ADREEM server. Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    ledgerConfig,
    load: () => loadLedgerState(client, ledgerConfig),
    update: (updater) => updateLedgerState(client, updater, ledgerConfig),
  }
}

export function resolveLedgerConfig(env = process.env, options = {}) {
  const identity = createLedgerIdentity({
    tenantId: options.tenantId || env.ADREEM_TENANT_ID || env.VITE_ADREEM_TENANT_ID,
    ledgerId: options.ledgerId || env.ADREEM_LEDGER_ID || env.VITE_ADREEM_LEDGER_ID,
  })
  const rowId = options.rowId || adreemStateRowId(identity)
  const legacyRowIds = rowId === ADREEM_STATE_ROW_ID ? [MOHAMMAD_LEGACY_STATE_ROW_ID] : []
  return {
    identity,
    rowId,
    readableRowIds: [rowId, ...legacyRowIds],
    legacyRowId: legacyRowIds[0] || null,
  }
}

export function parseTelegramLedgerMap(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((map, item) => {
      const [userId, ledgerId] = item.split(/[=:]/).map((part) => part?.trim())
      if (userId && ledgerId) map.set(userId, createLedgerIdentity({ ledgerId }).ledgerId)
      return map
    }, new Map())
}

export function resolveTelegramLedgerId(userId, env = process.env) {
  const explicitMap = parseTelegramLedgerMap(env.ADREEM_TELEGRAM_LEDGER_IDS || env.MOHAMMAD_TELEGRAM_LEDGER_IDS)
  return explicitMap.get(String(userId)) || createLedgerIdentity({
    ledgerId: env.ADREEM_LEDGER_ID || env.VITE_ADREEM_LEDGER_ID,
  }).ledgerId
}

async function loadLedgerState(client, ledgerConfig) {
  const fallback = createEmptyAdreemState(undefined, ledgerConfig.identity)
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .select('id, payload, updated_at')
    .in('id', ledgerConfig.readableRowIds)

  if (error) throw error
  return selectPersistedLedgerRows(data, fallback, {
    primaryRowId: ledgerConfig.rowId,
    legacyRowId: ledgerConfig.legacyRowId || '__no_legacy_row__',
  })
}

async function insertLedgerState(client, state, ledgerConfig) {
  const updatedAt = new Date().toISOString()
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .insert({
      id: ledgerConfig.rowId,
      payload: state,
      updated_at: updatedAt,
    })
    .select('updated_at')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') throw new ConcurrentLedgerUpdateError()
    throw error
  }
  return data?.updated_at || updatedAt
}

async function replaceLedgerState(client, state, expectedUpdatedAt, ledgerConfig) {
  const updatedAt = new Date().toISOString()
  let query = client
    .from(MOHAMMAD_STATE_TABLE)
    .update({
      payload: state,
      updated_at: updatedAt,
    })
    .eq('id', ledgerConfig.rowId)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error) throw error
  if (!data?.updated_at) throw new ConcurrentLedgerUpdateError()
  return data.updated_at
}

export function prepareLedgerStateForSave(resultState, currentState, savedAt = new Date().toISOString(), identity = null) {
  return normalizeLedgerState(
    {
      ...resultState,
      ...(identity || {}),
      savedAt,
    },
    currentState,
  )
}

async function updateLedgerState(client, updater, ledgerConfig) {
  let lastConflict = null

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    const current = await loadLedgerState(client, ledgerConfig)
    const result = await updater(current.state)
    if (!result?.state) return { ...result, state: current.state, updatedAt: current.updatedAt }

    const nextState = prepareLedgerStateForSave(result.state, current.state, new Date().toISOString(), ledgerConfig.identity)

    try {
      const updatedAt = current.updatedAt
        ? await replaceLedgerState(client, nextState, current.updatedAt, ledgerConfig)
        : await insertLedgerState(client, nextState, ledgerConfig)
      return { ...result, state: nextState, updatedAt, attempts: attempt }
    } catch (error) {
      if (!(error instanceof ConcurrentLedgerUpdateError)) throw error
      lastConflict = error
    }
  }

  throw lastConflict || new ConcurrentLedgerUpdateError()
}
