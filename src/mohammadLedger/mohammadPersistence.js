import { normalizeLedgerState } from './ledgerState.js'

export const MOHAMMAD_STORAGE_KEY = 'mohammad-ledger-v1'
export const ADREEM_STORAGE_KEY = 'adreem-ledger-v1'
export const ADREEM_API_TOKEN_STORAGE_KEY = 'adreem-ledger-api-token-v1'
export const ADREEM_API_TOKEN_SESSION_KEY = 'adreem-ledger-api-token-session-v1'
export const ADREEM_API_TOKEN_PERSIST_KEY = 'adreem-ledger-api-login-token-v1'
export const ADREEM_MIGRATION_MARKER_KEY = 'adreem-ledger-migration-v1'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')
const API_TIMEOUT_MS = 15_000
let cloudUpdatedAt
const LEGACY_LEDGER_STORAGE_PREFIXES = [
  MOHAMMAD_STORAGE_KEY,
  ADREEM_STORAGE_KEY,
  'mohammad-ledger-backups-v1',
  'adreem-ledger-backups-v1',
  ADREEM_MIGRATION_MARKER_KEY,
  ADREEM_API_TOKEN_STORAGE_KEY,
]

function browserStorageItem(storageName, key) {
  if (typeof window === 'undefined') return ''
  try {
    return window[storageName]?.getItem(key) || ''
  } catch {
    return ''
  }
}

export function clearLegacyBrowserLedgerData() {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const keys = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && LEGACY_LEDGER_STORAGE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
        keys.push(key)
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Browsers can block storage. Cloud operation remains the source of truth.
  }
}

function apiConfig() {
  if (!ADREEM_API_URL || typeof window === 'undefined') return null
  clearLegacyBrowserLedgerData()
  const token =
    browserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY) ||
    browserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY)
  return token ? { url: ADREEM_API_URL, token } : null
}

export function getMohammadPersistenceMode() {
  if (!ADREEM_API_URL) return 'configuration-error'
  return apiConfig() ? 'api' : 'api-missing-token'
}

async function apiJson(path, options = {}) {
  const api = apiConfig()
  if (!api) throw new Error('Missing ADREEM login session.')
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const response = await fetch(`${api.url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${api.token}`,
        ...(options.headers || {}),
      },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `ADREEM cloud request failed: ${response.status}`)
      error.status = response.status
      error.retryable = response.status === 429 || response.status >= 500
      const retryAfterSeconds = Number(response.headers?.get?.('retry-after') || data.retryAfterSeconds || 0)
      if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000
      throw error
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('انتهت مهلة الاتصال بالسحابة.')
      timeoutError.retryable = true
      throw timeoutError
    }
    if (error && error.retryable === undefined) error.retryable = true
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function loadMohammadPersistedState(fallbackState) {
  const fallback = normalizeLedgerState(fallbackState, fallbackState)
  const mode = getMohammadPersistenceMode()
  if (mode !== 'api') {
    return {
      mode,
      state: fallback,
      source: mode,
      loadError: true,
      error: new Error(mode === 'configuration-error' ? 'ADREEM cloud API is not configured.' : 'Missing ADREEM login session.'),
    }
  }
  try {
    const data = await apiJson('/api/ledger')
    cloudUpdatedAt = data?.updatedAt ?? null
    return {
      mode,
      state: data?.state ? normalizeLedgerState(data.state, fallback) : fallback,
      access: { canManageUsers: Boolean(data?.access?.canManageUsers) },
      profile: data?.profile && typeof data.profile === 'object' ? data.profile : null,
      source: data?.state ? 'api' : 'empty-api',
    }
  } catch (error) {
    console.warn('[adreem-persistence] cloud load failed:', error?.message || error)
    return { mode, state: fallback, source: 'api-error', loadError: true, error }
  }
}

export async function updateAdreemUserProfile({ language }) {
  const data = await apiJson('/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language }),
  })
  return data?.user || null
}

export async function saveMohammadPersistedState(state) {
  const mode = getMohammadPersistenceMode()
  const normalizedState = normalizeLedgerState({ ...state, savedAt: new Date().toISOString() }, state)
  if (mode !== 'api') {
    return {
      mode,
      localOk: false,
      supabaseOk: false,
      state: normalizedState,
      error: new Error(mode === 'configuration-error' ? 'ADREEM cloud API is not configured.' : 'Missing ADREEM login session.'),
    }
  }
  try {
    const data = await apiJson('/api/ledger', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: normalizedState, baseUpdatedAt: cloudUpdatedAt ?? null }),
    })
    cloudUpdatedAt = data?.updatedAt ?? cloudUpdatedAt ?? null
    return {
      mode,
      localOk: false,
      supabaseOk: true,
      state: data?.state ? normalizeLedgerState(data.state, normalizedState) : normalizedState,
    }
  } catch (error) {
    console.warn('[adreem-persistence] cloud save failed:', error?.message || error)
    return { mode, localOk: false, supabaseOk: false, state: normalizedState, error }
  }
}

export async function logoutAdreemCloudSession() {
  try {
    if (getMohammadPersistenceMode() === 'api') {
      await apiJson('/api/auth/logout', { method: 'POST' })
    }
  } finally {
    cloudUpdatedAt = undefined
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',').pop() : result)
    }
    reader.onerror = () => reject(reader.error || new Error('Attachment read failed.'))
    reader.readAsDataURL(file)
  })
}

export async function uploadAdreemAttachmentFile(file) {
  if (!file) return null
  const data = await apiJson('/api/attachments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size || 0,
      base64: await fileToBase64(file),
    }),
  })
  return data.attachment || null
}

export async function resolveAdreemAttachmentUrl(attachment = {}) {
  if (!attachment.storagePath) return String(attachment.url || '')
  const params = new URLSearchParams({ path: attachment.storagePath })
  const data = await apiJson(`/api/attachments?${params}`)
  if (!data.signedUrl) throw new Error('Attachment link is missing.')
  return data.signedUrl
}
