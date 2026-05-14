import { createClient } from '@supabase/supabase-js'
import {
  MOHAMMAD_STATE_ROW_ID,
  MOHAMMAD_STATE_TABLE,
  createMohammadFallbackState,
  normalizeLedgerState,
} from '../../src/mohammadLedger/ledgerState.js'

const MAX_SAVE_ATTEMPTS = 4

export class ConcurrentLedgerUpdateError extends Error {
  constructor(message = 'Ledger state changed during save.') {
    super(message)
    this.name = 'ConcurrentLedgerUpdateError'
  }
}

export function createLedgerRepository(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env for Mohammad ledger bot. URL: SUPABASE_URL or VITE_SUPABASE_URL. Key: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or VITE_SUPABASE_ANON_KEY.')
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    load: () => loadLedgerState(client),
    update: (updater) => updateLedgerState(client, updater),
  }
}

async function loadLedgerState(client) {
  const fallback = createMohammadFallbackState()
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .select('payload, updated_at')
    .eq('id', MOHAMMAD_STATE_ROW_ID)
    .maybeSingle()

  if (error) throw error
  return {
    state: normalizeLedgerState(data?.payload, fallback),
    updatedAt: data?.updated_at || null,
  }
}

async function insertLedgerState(client, state) {
  const updatedAt = new Date().toISOString()
  const { data, error } = await client
    .from(MOHAMMAD_STATE_TABLE)
    .insert({
      id: MOHAMMAD_STATE_ROW_ID,
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

async function replaceLedgerState(client, state, expectedUpdatedAt) {
  const updatedAt = new Date().toISOString()
  let query = client
    .from(MOHAMMAD_STATE_TABLE)
    .update({
      payload: state,
      updated_at: updatedAt,
    })
    .eq('id', MOHAMMAD_STATE_ROW_ID)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error) throw error
  if (!data?.updated_at) throw new ConcurrentLedgerUpdateError()
  return data.updated_at
}

async function updateLedgerState(client, updater) {
  let lastConflict = null

  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    const current = await loadLedgerState(client)
    const result = await updater(current.state)
    if (!result?.state) return { ...result, state: current.state, updatedAt: current.updatedAt }

    const nextState = normalizeLedgerState(
      {
        ...result.state,
        version: 1,
        savedAt: new Date().toISOString(),
      },
      current.state,
    )

    try {
      const updatedAt = current.updatedAt
        ? await replaceLedgerState(client, nextState, current.updatedAt)
        : await insertLedgerState(client, nextState)
      return { ...result, state: nextState, updatedAt, attempts: attempt }
    } catch (error) {
      if (!(error instanceof ConcurrentLedgerUpdateError)) throw error
      lastConflict = error
    }
  }

  throw lastConflict || new ConcurrentLedgerUpdateError()
}
