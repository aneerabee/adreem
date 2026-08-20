import { mergeLedgerStates, normalizeLedgerState, recordTimestamp } from './ledgerState.js'

export const MOHAMMAD_STORAGE_KEY = 'mohammad-ledger-v1'
export const ADREEM_STORAGE_KEY = 'adreem-ledger-v1'
export const ADREEM_API_TOKEN_STORAGE_KEY = 'adreem-ledger-api-token-v1'
export const ADREEM_API_TOKEN_SESSION_KEY = 'adreem-ledger-api-token-session-v1'
export const ADREEM_API_TOKEN_PERSIST_KEY = 'adreem-ledger-api-login-token-v1'
export const ADREEM_MIGRATION_MARKER_KEY = 'adreem-ledger-migration-v1'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')
const API_TIMEOUT_MS = 15_000
let cloudUpdatedAt
let cloudState
const LEDGER_RECORD_COLLECTIONS = [
  'accounts',
  'movements',
  'dimensions',
  'attachments',
  'recurringRules',
  'reconciliations',
  'auditEvents',
]
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

function recordsById(records = []) {
  return new Map(records.filter((record) => record?.id).map((record) => [record.id, record]))
}

function sameRecord(left, right) {
  if (!left || !right) return left === right
  return left.id === right.id && recordTimestamp(left) === recordTimestamp(right)
}

function concurrentRecordConflicts(localState, remoteState, baseState) {
  const conflicts = []
  for (const collection of LEDGER_RECORD_COLLECTIONS) {
    const local = recordsById(localState[collection])
    const remote = recordsById(remoteState[collection])
    const base = recordsById(baseState?.[collection])
    const ids = new Set([...local.keys(), ...remote.keys(), ...base.keys()])
    for (const id of ids) {
      const localRecord = local.get(id)
      const remoteRecord = remote.get(id)
      const baseRecord = base.get(id)
      const localChanged = !sameRecord(localRecord, baseRecord)
      const remoteChanged = !sameRecord(remoteRecord, baseRecord)
      if (localChanged && remoteChanged && !sameRecord(localRecord, remoteRecord)) {
        conflicts.push({ collection, id })
      }
    }
  }
  return conflicts
}

function recordConflictError(conflicts) {
  const ids = conflicts.slice(0, 3).map(({ id }) => id).join(', ')
  const error = new Error(`تعذر الحفظ بسبب تعارض تعديل السجل نفسه في الويب والسحابة (${ids}). أعد تحميل الدفتر وطبّق التعديل من جديد.`)
  error.status = 409
  error.retryable = false
  error.code = 'ledger-record-conflict'
  error.conflicts = conflicts
  return error
}

function rememberCloudState(data, fallbackState) {
  const state = data?.state ? normalizeLedgerState(data.state, fallbackState) : fallbackState
  cloudUpdatedAt = data?.updatedAt ?? cloudUpdatedAt ?? null
  cloudState = state
  return state
}

function saveResult(mode, data, fallbackState) {
  return {
    mode,
    localOk: false,
    supabaseOk: true,
    state: rememberCloudState(data, fallbackState),
  }
}

async function putCloudState(state, baseUpdatedAt) {
  return apiJson('/api/ledger', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, baseUpdatedAt }),
  })
}

async function recoverCloudConflict(mode, state, baseState) {
  const latest = await apiJson('/api/ledger')
  if (!latest?.state) {
    const error = new Error('تعذر تحميل أحدث نسخة سحابية بعد التعارض.')
    error.retryable = true
    throw error
  }
  const remoteState = normalizeLedgerState(latest.state, baseState || state)
  const conflicts = concurrentRecordConflicts(state, remoteState, baseState)
  if (conflicts.length > 0) throw recordConflictError(conflicts)

  const mergedState = mergeLedgerStates(state, remoteState, remoteState)
  cloudState = remoteState
  cloudUpdatedAt = latest.updatedAt ?? null
  const data = await putCloudState(mergedState, cloudUpdatedAt)
  return saveResult(mode, data, mergedState)
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
    const state = data?.state ? normalizeLedgerState(data.state, fallback) : fallback
    cloudUpdatedAt = data?.updatedAt ?? null
    cloudState = state
    return {
      mode,
      state,
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
  const baseState = cloudState
  try {
    const data = await putCloudState(normalizedState, cloudUpdatedAt ?? null)
    return saveResult(mode, data, normalizedState)
  } catch (error) {
    if (error?.status === 409) {
      try {
        return await recoverCloudConflict(mode, normalizedState, baseState)
      } catch (conflictError) {
        console.warn('[adreem-persistence] cloud save failed:', conflictError?.message || conflictError)
        return { mode, localOk: false, supabaseOk: false, state: normalizedState, error: conflictError }
      }
    }
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
    cloudState = undefined
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',').pop() : result)
    }
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة ملف المرفق.'))
    reader.readAsDataURL(file)
  })
}

function attachmentRequestError(error, action = 'upload') {
  const status = Number(error?.status || 0)
  const messages = action === 'open'
    ? {
        401: 'انتهت جلسة الدخول.',
        403: 'لا يمكنك فتح هذا المرفق.',
        404: 'لم يعد المرفق موجودًا.',
        429: 'طلبات كثيرة. حاول بعد قليل.',
        500: 'تعذر فتح المرفق من السحابة.',
      }
    : {
        400: 'ملف المرفق غير صالح.',
        401: 'انتهت جلسة الدخول.',
        413: 'حجم المرفق أكبر من 10 ميغابايت.',
        415: 'نوع المرفق غير مسموح.',
        429: 'طلبات كثيرة. حاول بعد قليل.',
        501: 'تخزين المرفقات غير مهيأ.',
      }
  const message = messages[status] || (status >= 500
    ? action === 'open' ? 'تعذر فتح المرفق من السحابة.' : 'تعذر حفظ المرفق في السحابة.'
    : action === 'open' ? 'تعذر فتح المرفق.' : 'تعذر رفع المرفق.')
  const localizedError = new Error(message)
  localizedError.status = status || undefined
  localizedError.retryable = Boolean(error?.retryable)
  return localizedError
}

export async function uploadAdreemAttachmentFile(file) {
  if (!file) return null
  try {
    const data = await apiJson('/api/attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name || 'مرفق',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size || 0,
        base64: await fileToBase64(file),
      }),
    })
    return data.attachment || null
  } catch (error) {
    throw attachmentRequestError(error, 'upload')
  }
}

export async function resolveAdreemAttachmentUrl(attachment = {}) {
  if (!attachment.storagePath) return String(attachment.url || '')
  try {
    const params = new URLSearchParams({ path: attachment.storagePath })
    const data = await apiJson(`/api/attachments?${params}`)
    if (!data.signedUrl) throw new Error('تعذر فتح المرفق.')
    return data.signedUrl
  } catch (error) {
    throw attachmentRequestError(error, 'open')
  }
}
