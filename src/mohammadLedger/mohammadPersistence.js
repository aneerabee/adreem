import { createClient } from '@supabase/supabase-js'
import {
  MOHAMMAD_STATE_ROW_ID,
  MOHAMMAD_STATE_TABLE,
  mergeLedgerStates,
  normalizeLedgerState,
  stateTimestamp,
} from './ledgerState.js'

export const MOHAMMAD_STORAGE_KEY = 'mohammad-ledger-v1'

const BACKUP_STORAGE_KEY = 'mohammad-ledger-backups-v1'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const BACKUP_LIMIT = 12

let cachedClient = null

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cachedClient
}

export function getMohammadPersistenceMode() {
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

export function loadLocalMohammadState(fallbackState) {
  if (!hasBrowserStorage()) return normalizeLedgerState(fallbackState, fallbackState)
  try {
    const raw = window.localStorage.getItem(MOHAMMAD_STORAGE_KEY)
    if (!raw) return normalizeLedgerState(fallbackState, fallbackState)
    return normalizeLedgerState(JSON.parse(raw), fallbackState)
  } catch (err) {
    console.warn('[mohammad-persistence] local load failed:', err?.message || err)
    return normalizeLedgerState(fallbackState, fallbackState)
  }
}

function writeLocalMohammadState(state) {
  if (!hasBrowserStorage()) return
  window.localStorage.setItem(MOHAMMAD_STORAGE_KEY, JSON.stringify(state))
}

function writeLocalBackup(state) {
  if (!hasBrowserStorage()) return
  const rawBackups = window.localStorage.getItem(BACKUP_STORAGE_KEY)
  const backups = rawBackups ? JSON.parse(rawBackups) : []
  const nextBackups = [
    {
      savedAt: state.savedAt,
      accountCount: state.accounts.length,
      movementCount: state.movements.length,
      state,
    },
    ...(Array.isArray(backups) ? backups : []),
  ].slice(0, BACKUP_LIMIT)
  window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(nextBackups))
}

async function loadRemoteMohammadState(fallbackState) {
  const client = getSupabaseClient()
  if (!client) return null
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .select('payload')
    .eq('id', MOHAMMAD_STATE_ROW_ID)
    .maybeSingle()

  if (error) throw error
  if (!data?.payload) return null
  return normalizeLedgerState(data.payload, fallbackState)
}

async function saveRemoteMohammadState(state) {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from(MOHAMMAD_STATE_TABLE).upsert(
    {
      id: MOHAMMAD_STATE_ROW_ID,
      payload: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

export async function loadMohammadPersistedState(fallbackState) {
  const fallback = normalizeLedgerState(fallbackState, fallbackState)
  const localState = loadLocalMohammadState(fallback)
  const mode = getMohammadPersistenceMode()

  if (mode !== 'supabase') {
    return { mode, state: localState, source: 'local' }
  }

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
  let normalizedState = normalizeLedgerState(
    { ...state, savedAt: new Date().toISOString(), version: 1 },
    state,
  )

  writeLocalMohammadState(normalizedState)
  try {
    writeLocalBackup(normalizedState)
  } catch (err) {
    console.warn('[mohammad-persistence] local backup failed:', err?.message || err)
  }

  if (getMohammadPersistenceMode() !== 'supabase') {
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
