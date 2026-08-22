import { createClient } from '@supabase/supabase-js'
import { createRelationalLedgerRepository } from '../ledger/relationalLedgerRepository.js'
import { supabaseAuthEnabled } from '../ledger/supabaseAuth.js'

function requiredConfig(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase Telegram access requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }
  return { url, serviceKey }
}

function accessError(error, fallback) {
  const next = new Error(error?.message || fallback)
  next.code = error?.code || ''
  return next
}

function telegramUserId(value) {
  const normalized = String(value || '').trim()
  return /^[1-9]\d*$/.test(normalized) ? normalized : ''
}

export function createSupabaseTelegramLedgerAccess(env = process.env, options = {}) {
  if (!supabaseAuthEnabled(env)) return null
  const config = requiredConfig(env)
  const client = options.client || (options.createClientImpl || createClient)(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const createRepository = options.createRepository || createRelationalLedgerRepository
  const repositories = new Map()

  async function resolve(userId) {
    const id = telegramUserId(userId)
    if (!id) return null
    const { data: profile, error: profileError } = await client
      .from('adreem_profiles')
      .select('id, display_name, telegram_user_id, language, is_system_owner, is_active')
      .eq('telegram_user_id', id)
      .maybeSingle()
    if (profileError) throw accessError(profileError, 'Failed to resolve the Telegram user.')
    if (!profile?.id || profile.is_active !== true) return null

    const { data: ledger, error: ledgerError } = await client
      .from('adreem_ledgers')
      .select('id, owner_id, legacy_ledger_id')
      .eq('owner_id', profile.id)
      .maybeSingle()
    if (ledgerError) throw accessError(ledgerError, 'Failed to resolve the Telegram ledger.')
    if (!ledger?.id || ledger.owner_id !== profile.id) return null

    return {
      ownerId: profile.id,
      ledgerId: ledger.id,
      legacyLedgerId: ledger.legacy_ledger_id || '',
      displayName: profile.display_name || '',
      language: profile.language === 'en' ? 'en' : 'ar',
      isOwner: Boolean(profile.is_system_owner),
      source: 'supabase-auth',
      telegramUserId: id,
    }
  }

  function repositoryFor(identity) {
    if (!identity?.ownerId || !identity?.ledgerId) return null
    const key = `${identity.ownerId}:${identity.ledgerId}`
    if (!repositories.has(key)) {
      repositories.set(key, createRepository(client, {
        env,
        ledgerId: identity.ledgerId,
        ownerId: identity.ownerId,
      }))
    }
    return repositories.get(key)
  }

  return {
    client,
    mode: 'supabase',
    repositoryFor,
    resolve,
  }
}
