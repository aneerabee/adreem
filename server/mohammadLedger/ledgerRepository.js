import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
const DEFAULT_BACKUP_LIMIT = 60
const DEFAULT_REGISTRY_FILE = './adreem-telegram-users.json'

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
    update: (updater) => updateLedgerState(client, updater, ledgerConfig, env),
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

function ledgerBackupDirectory(env = process.env) {
  if (env.ADREEM_BACKUP_DIR) return env.ADREEM_BACKUP_DIR
  if (env.ADREEM_LEDGER_BACKUP_DIR) return env.ADREEM_LEDGER_BACKUP_DIR
  const registryPath = env.ADREEM_TELEGRAM_USERS_FILE || env.ADREEM_TELEGRAM_REGISTRY_PATH || DEFAULT_REGISTRY_FILE
  return join(dirname(registryPath), 'ledger-backups')
}

function backupFileName(ledgerConfig, phase, savedAt = new Date().toISOString()) {
  const safeLedgerId = String(ledgerConfig.identity.ledgerId || ledgerConfig.rowId || 'ledger')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80)
  const stamp = savedAt.replace(/[:.]/g, '-')
  return `${safeLedgerId}-${stamp}-${phase}.json`
}

function pruneLedgerBackups(directory, ledgerConfig, limit = DEFAULT_BACKUP_LIMIT) {
  const safeLedgerId = String(ledgerConfig.identity.ledgerId || ledgerConfig.rowId || 'ledger')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80)
  const files = readdirSync(directory)
    .filter((file) => file.startsWith(`${safeLedgerId}-`) && file.endsWith('.json'))
    .sort()
  const excess = files.length - limit
  if (excess <= 0) return
  files.slice(0, excess).forEach((file) => rmSync(join(directory, file), { force: true }))
}

export function writeLedgerBackup(env, ledgerConfig, phase, state) {
  if (env.ADREEM_BACKUP_DISABLED === 'true') return
  if (process.env.NODE_ENV === 'test' && !env.ADREEM_BACKUP_DIR && !env.ADREEM_LEDGER_BACKUP_DIR) return
  try {
    const directory = ledgerBackupDirectory(env)
    mkdirSync(directory, { recursive: true })
    const savedAt = new Date().toISOString()
    const payload = {
      appId: ledgerConfig.identity.appId,
      tenantId: ledgerConfig.identity.tenantId,
      ledgerId: ledgerConfig.identity.ledgerId,
      rowId: ledgerConfig.rowId,
      phase,
      savedAt,
      state,
    }
    writeFileSync(join(directory, backupFileName(ledgerConfig, phase, savedAt)), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    pruneLedgerBackups(directory, ledgerConfig, Number(env.ADREEM_BACKUP_LIMIT || DEFAULT_BACKUP_LIMIT))
  } catch (error) {
    console.error('[adreem-ledger-backup]', error?.message || error)
  }
}

async function updateLedgerState(client, updater, ledgerConfig, env = process.env) {
  let lastConflict = null

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    const current = await loadLedgerState(client, ledgerConfig)
    const result = await updater(current.state)
    if (!result?.state) return { ...result, state: current.state, updatedAt: current.updatedAt }

    const nextState = prepareLedgerStateForSave(result.state, current.state, new Date().toISOString(), ledgerConfig.identity)

    try {
      if (current.updatedAt) writeLedgerBackup(env, ledgerConfig, 'before', current.state)
      const updatedAt = current.updatedAt
        ? await replaceLedgerState(client, nextState, current.updatedAt, ledgerConfig)
        : await insertLedgerState(client, nextState, ledgerConfig)
      writeLedgerBackup(env, ledgerConfig, 'after', nextState)
      return { ...result, state: nextState, updatedAt, attempts: attempt }
    } catch (error) {
      if (!(error instanceof ConcurrentLedgerUpdateError)) throw error
      lastConflict = error
    }
  }

  throw lastConflict || new ConcurrentLedgerUpdateError()
}
