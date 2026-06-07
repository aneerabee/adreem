import { createClient } from '@supabase/supabase-js'
import {
  ADREEM_STATE_ROW_ID,
  MOHAMMAD_LEGACY_STATE_ROW_ID,
  MOHAMMAD_STATE_TABLE,
  adreemStateRowId,
  createLedgerIdentity,
  mergeLedgerStates,
  normalizeLedgerState,
  selectPersistedLedgerRows,
  stateTimestamp,
} from './ledgerState.js'

export const MOHAMMAD_STORAGE_KEY = 'mohammad-ledger-v1'
export const ADREEM_STORAGE_KEY = 'adreem-ledger-v1'
export const ADREEM_API_TOKEN_STORAGE_KEY = 'adreem-ledger-api-token-v1'
export const ADREEM_API_TOKEN_SESSION_KEY = 'adreem-ledger-api-token-session-v1'

const BACKUP_STORAGE_KEY = 'adreem-ledger-backups-v1'
const LEGACY_BACKUP_STORAGE_KEY = 'mohammad-ledger-backups-v1'
export const ADREEM_MIGRATION_MARKER_KEY = 'adreem-ledger-migration-v1'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const ENABLE_DIRECT_SUPABASE = import.meta.env.VITE_ENABLE_SUPABASE_DIRECT === 'true'
const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')
const BACKUP_LIMIT = 12
const BROWSER_LEDGER_IDENTITY = createLedgerIdentity({
  tenantId: import.meta.env.VITE_ADREEM_TENANT_ID,
  ledgerId: import.meta.env.VITE_ADREEM_LEDGER_ID,
})
const BROWSER_STATE_ROW_ID = adreemStateRowId(BROWSER_LEDGER_IDENTITY)
const BROWSER_READABLE_ROW_IDS = BROWSER_STATE_ROW_ID === ADREEM_STATE_ROW_ID
  ? [BROWSER_STATE_ROW_ID, MOHAMMAD_LEGACY_STATE_ROW_ID]
  : [BROWSER_STATE_ROW_ID]
const DIRECT_BROWSER_STORAGE_KEYS = adreemStorageKeysForRowId(BROWSER_STATE_ROW_ID)

let cachedClient = null

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function hasBrowserSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function readApiTokenFromLocation() {
  if (typeof window === 'undefined') return ''
  const hash = String(window.location?.hash || '').replace(/^#/, '')
  const params = new URLSearchParams(hash)
  const token = params.get('ledger_token') || params.get('adreem_token') || ''
  if (token && window.history?.replaceState) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
  return token
}

function clearCloudLocalLedgerData() {
  if (!hasBrowserStorage()) return
  const prefixes = [
    ADREEM_STORAGE_KEY,
    BACKUP_STORAGE_KEY,
    ADREEM_MIGRATION_MARKER_KEY,
    MOHAMMAD_STORAGE_KEY,
    LEGACY_BACKUP_STORAGE_KEY,
  ]
  const keys = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key && prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
      keys.push(key)
    }
  }
  keys.forEach((key) => window.localStorage.removeItem(key))
  window.localStorage.removeItem(ADREEM_API_TOKEN_STORAGE_KEY)
}

function getAdreemApiConfig() {
  if (!ADREEM_API_URL || typeof window === 'undefined') return null
  clearCloudLocalLedgerData()
  const tokenFromLocation = readApiTokenFromLocation()
  if (tokenFromLocation) {
    if (hasBrowserSessionStorage()) {
      window.sessionStorage.setItem(ADREEM_API_TOKEN_SESSION_KEY, tokenFromLocation)
    }
  }
  const token = tokenFromLocation || (hasBrowserSessionStorage()
    ? window.sessionStorage.getItem(ADREEM_API_TOKEN_SESSION_KEY)
    : '') || ''
  return token ? { url: ADREEM_API_URL, token } : null
}

export function adreemStorageKeysForRowId(rowId = ADREEM_STATE_ROW_ID) {
  const suffix = rowId === ADREEM_STATE_ROW_ID ? '' : `:${rowId}`
  return {
    state: `${ADREEM_STORAGE_KEY}${suffix}`,
    backup: `${BACKUP_STORAGE_KEY}${suffix}`,
    migrationMarker: `${ADREEM_MIGRATION_MARKER_KEY}${suffix}`,
    canReadLegacy: rowId === ADREEM_STATE_ROW_ID,
  }
}

function tokenFingerprint(token = '') {
  const text = String(token || '')
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function adreemStorageKeysForApiToken(token = '') {
  const fingerprint = tokenFingerprint(token)
  return adreemStorageKeysForRowId(`api:${fingerprint || 'empty'}`)
}

function browserStorageKeys() {
  if (ADREEM_API_URL) {
    const api = getAdreemApiConfig()
    if (api?.token) return adreemStorageKeysForApiToken(api.token)
  }
  return DIRECT_BROWSER_STORAGE_KEYS
}

function getSupabaseClient() {
  if (!ENABLE_DIRECT_SUPABASE) return null
  if (import.meta.env.PROD) return null
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cachedClient
}

export function getMohammadPersistenceMode() {
  if (ADREEM_API_URL) return getAdreemApiConfig() ? 'api' : 'api-missing-token'
  return getSupabaseClient() ? 'supabase' : 'local'
}

function chooseFreshestState(localState, remoteState, fallbackState) {
  if (localState && remoteState) {
    return {
      state: mergeLedgerStates(localState, remoteState, fallbackState),
      source: stateTimestamp(remoteState) >= stateTimestamp(localState) ? 'merged-supabase' : 'merged-local',
    }
  }
  if (remoteState) return { state: remoteState, source: 'supabase' }
  if (localState) return { state: localState, source: 'local' }
  return { state: fallbackState, source: 'fallback' }
}

function readLocalStateByKey(key, fallbackState) {
  if (!hasBrowserStorage()) return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  try {
    return normalizeLedgerState(JSON.parse(raw), fallbackState)
  } catch (err) {
    console.warn(`[mohammad-persistence] local ${key} load failed:`, err?.message || err)
    return null
  }
}

function writeMigrationMarker() {
  if (!hasBrowserStorage()) return
  const storageKeys = browserStorageKeys()
  window.localStorage.setItem(storageKeys.migrationMarker, JSON.stringify({
    from: MOHAMMAD_STORAGE_KEY,
    to: storageKeys.state,
    migratedAt: new Date().toISOString(),
  }))
}

function tryWriteLocalBackup(state) {
  try {
    writeLocalBackup(state)
  } catch (err) {
    console.warn('[mohammad-persistence] local backup failed:', err?.message || err)
  }
}

export function loadLocalMohammadState(fallbackState) {
  if (!hasBrowserStorage()) return normalizeLedgerState(fallbackState, fallbackState)
  const storageKeys = browserStorageKeys()
  const fallback = normalizeLedgerState({ ...fallbackState, ...BROWSER_LEDGER_IDENTITY }, fallbackState)
  const adreemState = readLocalStateByKey(storageKeys.state, fallback)
  const legacyState = storageKeys.canReadLegacy ? readLocalStateByKey(MOHAMMAD_STORAGE_KEY, fallback) : null

  if (adreemState && legacyState) {
    tryWriteLocalBackup(adreemState)
    tryWriteLocalBackup(legacyState)
    const mergedState = mergeLedgerStates(adreemState, legacyState, fallback)
    writeLocalMohammadState(mergedState)
    writeMigrationMarker()
    return mergedState
  }

  if (adreemState) return adreemState
  if (legacyState) {
    tryWriteLocalBackup(legacyState)
    writeLocalMohammadState(legacyState)
    writeMigrationMarker()
    return legacyState
  }

  return fallback
}

function writeLocalMohammadState(state) {
  if (!hasBrowserStorage()) return
  window.localStorage.setItem(browserStorageKeys().state, JSON.stringify(state))
}

function writeLocalBackup(state) {
  if (!hasBrowserStorage()) return
  const storageKeys = browserStorageKeys()
  const rawBackups = window.localStorage.getItem(storageKeys.backup) ||
    (storageKeys.canReadLegacy ? window.localStorage.getItem(LEGACY_BACKUP_STORAGE_KEY) : null)
  let backups = []
  try {
    backups = rawBackups ? JSON.parse(rawBackups) : []
  } catch {
    backups = []
  }
  const nextBackups = [
    {
      savedAt: state.savedAt,
      accountCount: state.accounts.length,
      movementCount: state.movements.length,
      state,
    },
    ...(Array.isArray(backups) ? backups : []),
  ].slice(0, BACKUP_LIMIT)
  window.localStorage.setItem(storageKeys.backup, JSON.stringify(nextBackups))
}

export function listLocalAdreemBackups() {
  if (!hasBrowserStorage()) return []
  try {
    const storageKeys = browserStorageKeys()
    const raw = window.localStorage.getItem(storageKeys.backup) ||
      (storageKeys.canReadLegacy ? window.localStorage.getItem(LEGACY_BACKUP_STORAGE_KEY) : null)
    const backups = raw ? JSON.parse(raw) : []
    return Array.isArray(backups) ? backups.filter((backup) => backup?.state) : []
  } catch {
    return []
  }
}

export function restoreLatestLocalAdreemBackup(fallbackState) {
  const latest = listLocalAdreemBackups()[0]
  if (!latest?.state) return null
  const restored = normalizeLedgerState(
    {
      ...latest.state,
      savedAt: new Date().toISOString(),
    },
    fallbackState || latest.state,
  )
  writeLocalMohammadState(restored)
  return restored
}

async function loadRemoteMohammadState(fallbackState) {
  const client = getSupabaseClient()
  if (!client) return null
  const fallback = normalizeLedgerState({ ...fallbackState, ...BROWSER_LEDGER_IDENTITY }, fallbackState)
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .select('id, payload, updated_at')
    .in('id', BROWSER_READABLE_ROW_IDS)

  if (error) throw error
  const selected = selectPersistedLedgerRows(data, fallback, {
    primaryRowId: BROWSER_STATE_ROW_ID,
    legacyRowId: BROWSER_STATE_ROW_ID === ADREEM_STATE_ROW_ID ? MOHAMMAD_LEGACY_STATE_ROW_ID : '__no_legacy_row__',
  })
  return selected.source === 'fallback' ? null : selected.state
}

async function saveRemoteMohammadState(state) {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from(MOHAMMAD_STATE_TABLE).upsert(
    {
      id: BROWSER_STATE_ROW_ID,
      payload: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

async function loadApiMohammadState(fallbackState) {
  const api = getAdreemApiConfig()
  if (!api) return null
  const response = await fetch(`${api.url}/api/ledger`, {
    headers: {
      authorization: `Bearer ${api.token}`,
    },
  })
  if (!response.ok) throw new Error(`ADREEM API load failed: ${response.status}`)
  const data = await response.json()
  return data?.state ? normalizeLedgerState(data.state, fallbackState) : null
}

async function saveApiMohammadState(state) {
  const api = getAdreemApiConfig()
  if (!api) return null
  const response = await fetch(`${api.url}/api/ledger`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${api.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ state }),
  })
  if (!response.ok) throw new Error(`ADREEM API save failed: ${response.status}`)
  const data = await response.json()
  return data?.state ? normalizeLedgerState(data.state, state) : state
}

export async function loadMohammadPersistedState(fallbackState) {
  const fallback = normalizeLedgerState(fallbackState, fallbackState)
  const mode = getMohammadPersistenceMode()

  if (mode !== 'supabase') {
    if (mode === 'api') {
      try {
        const apiState = await loadApiMohammadState(fallback)
        if (apiState) {
          return { mode, state: apiState, source: 'api' }
        }
        return { mode, state: fallback, source: 'empty-api' }
      } catch (err) {
        console.warn('[mohammad-persistence] api load failed:', err?.message || err)
        return { mode, state: fallback, source: 'api-error', loadError: true, error: err }
      }
    }
    if (mode === 'api-missing-token') {
      return {
        mode,
        state: fallback,
        source: 'api-missing-token',
        loadError: true,
        error: new Error('Missing ADREEM login session.'),
      }
    }
    const localState = loadLocalMohammadState(fallback)
    return { mode, state: localState, source: 'local' }
  }

  const localState = loadLocalMohammadState(fallback)
  try {
    const remoteState = await loadRemoteMohammadState(fallback)
    const selected = chooseFreshestState(localState, remoteState, fallback)
    writeLocalMohammadState(selected.state)
    return { mode, ...selected }
  } catch (err) {
    console.warn('[mohammad-persistence] remote load failed:', err?.message || err)
    return { mode, state: localState, source: 'local-after-remote-error', loadError: true, error: err }
  }
}

export async function saveMohammadPersistedState(state) {
  const mode = getMohammadPersistenceMode()
  if (mode === 'api') {
    const normalizedState = normalizeLedgerState(
      { ...state, savedAt: new Date().toISOString() },
      state,
    )
    try {
      const savedState = await saveApiMohammadState(normalizedState)
      return { mode: 'api', localOk: false, supabaseOk: true, state: savedState || normalizedState }
    } catch (err) {
      console.warn('[mohammad-persistence] api save failed:', err?.message || err)
      return { mode: 'api', localOk: false, supabaseOk: false, state: normalizedState, error: err }
    }
  }

  if (mode === 'api-missing-token') {
    const normalizedState = normalizeLedgerState(
      { ...state, savedAt: new Date().toISOString() },
      state,
    )
    return {
      mode,
      localOk: false,
      supabaseOk: false,
      state: normalizedState,
      error: new Error('Missing ADREEM login session.'),
    }
  }

  const baseState = loadLocalMohammadState(state)
  let normalizedState = normalizeLedgerState(
    { ...baseState, ...state, savedAt: new Date().toISOString() },
    baseState,
  )

  writeLocalMohammadState(normalizedState)
  tryWriteLocalBackup(normalizedState)

  if (mode !== 'supabase') {
    return { mode: 'local', localOk: true, supabaseOk: false, state: normalizedState }
  }

  const remoteState = await loadRemoteMohammadState(normalizedState)
  if (remoteState) {
    normalizedState = {
      ...mergeLedgerStates(normalizedState, remoteState, normalizedState),
      savedAt: new Date().toISOString(),
    }
    writeLocalMohammadState(normalizedState)
  }
  await saveRemoteMohammadState(normalizedState)
  return { mode: 'supabase', localOk: true, supabaseOk: true, state: normalizedState }
}
