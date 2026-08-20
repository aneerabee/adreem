import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createPersistentTelegramState } from './persistentState.js'
import { createSessionStore } from './sessionStore.js'
import { createSupabaseStateRepository } from './supabaseStateRepository.js'

export function durableTelegramStateEnabled(env = process.env) {
  return String(env.ADREEM_TELEGRAM_DURABLE_STATE || '').trim().toLowerCase() === 'true'
}

export function telegramBotKey(token = '') {
  const cleanToken = String(token || '').trim()
  if (!cleanToken) throw new Error('Telegram bot token is required for durable state.')
  return `adreem-${createHash('sha256').update(cleanToken).digest('hex').slice(0, 20)}`
}

function optionalPositiveInteger(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`)
  return parsed
}

export function createDurableBotRuntime(env = process.env, token, options = {}) {
  if (!durableTelegramStateEnabled(env)) {
    return { durableState: null, sessions: createSessionStore() }
  }
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Durable Telegram state requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }
  const clientFactory = options.clientFactory || createClient
  const client = clientFactory(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const botKey = telegramBotKey(token)
  const maxUpdateAttempts = optionalPositiveInteger(
    options.maxUpdateAttempts ?? env.ADREEM_TELEGRAM_MAX_UPDATE_ATTEMPTS,
    'ADREEM_TELEGRAM_MAX_UPDATE_ATTEMPTS',
  )
  const repository = createSupabaseStateRepository(client, { botKey })
  const durableState = createPersistentTelegramState({
    repository,
    namespace: botKey,
    ...(maxUpdateAttempts ? { maxUpdateAttempts } : {}),
  })
  const sessions = createSessionStore({
    onSet: (chatId, userId, session) => durableState.setSession(chatId, userId, session),
    onClear: (chatId, userId) => durableState.clearSession(chatId, userId),
  })
  return { botKey, client, durableState, repository, sessions }
}

export async function hydrateDurableSession(runtime, chatId, userId) {
  if (!runtime?.durableState || chatId === null || userId === null) return null
  const existing = runtime.sessions.peek(chatId, userId)
  if (existing) return existing
  const stored = await runtime.durableState.getSession(chatId, userId)
  return stored ? runtime.sessions.hydrate(chatId, userId, stored) : null
}
