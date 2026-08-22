import { mergeLedgerStates, normalizeLedgerState } from './ledgerState.js'
import { applyLedgerDelta, createLedgerDelta, isLedgerDeltaEmpty } from './ledgerDelta.js'

export const LEGACY_STORAGE_KEY = String.fromCharCode(109, 111, 104, 97, 109, 109, 97, 100, 45, 108, 101, 100, 103, 101, 114, 45, 118, 49)
export const ADREEM_STORAGE_KEY = 'adreem-ledger-v1'
export const LEGACY_BACKUP_STORAGE_KEY = String.fromCharCode(109, 111, 104, 97, 109, 109, 97, 100, 45, 108, 101, 100, 103, 101, 114, 45, 98, 97, 99, 107, 117, 112, 115, 45, 118, 49)
export const ADREEM_BACKUP_STORAGE_KEY = 'adreem-ledger-backups-v1'
export const ADREEM_API_TOKEN_STORAGE_KEY = 'adreem-ledger-api-token-v1'
export const ADREEM_API_TOKEN_SESSION_KEY = 'adreem-ledger-api-token-session-v1'
export const ADREEM_API_TOKEN_PERSIST_KEY = 'adreem-ledger-api-login-token-v1'
export const ADREEM_API_REFRESH_TOKEN_PERSIST_KEY = 'adreem-ledger-api-refresh-token-v1'
export const ADREEM_API_COOKIE_SESSION_MARKER = 'cookie-v3'
export const ADREEM_MIGRATION_MARKER_KEY = 'adreem-ledger-migration-v1'

const ADREEM_API_URL = String(import.meta.env.VITE_ADREEM_API_URL || '').replace(/\/+$/, '')
const API_TIMEOUT_MS = 15_000
const SESSION_ROTATION_RETRY_DELAYS_MS = [75, 150, 300]
let cloudUpdatedAt
let cloudState
let cloudRevision
let cloudStorageMode = 'legacy'
let cloudMovementPage = null
let cloudReports = null
let refreshSessionPromise = null
let authSessionGeneration = 0
let cloudStateGeneration = 0
let cloudSaveGeneration = 0
let movementRequestEpoch = 0
const movementRequestGenerations = new Map()
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
  LEGACY_STORAGE_KEY,
  ADREEM_STORAGE_KEY,
  LEGACY_BACKUP_STORAGE_KEY,
  ADREEM_BACKUP_STORAGE_KEY,
  ADREEM_MIGRATION_MARKER_KEY,
  ADREEM_API_TOKEN_STORAGE_KEY,
]

function invalidateMovementPageRequests() {
  movementRequestEpoch += 1
  movementRequestGenerations.clear()
}

function beginMovementPageRequest(requestKey) {
  const key = String(requestKey || 'default')
  const generation = (movementRequestGenerations.get(key) || 0) + 1
  movementRequestGenerations.set(key, generation)
  return { epoch: movementRequestEpoch, generation, key }
}

function isCurrentMovementPageRequest(request) {
  return request.epoch === movementRequestEpoch
    && movementRequestGenerations.get(request.key) === request.generation
}

function browserStorageItem(storageName, key) {
  if (typeof window === 'undefined') return ''
  try {
    return window[storageName]?.getItem(key) || ''
  } catch {
    return ''
  }
}

function setBrowserStorageItem(storageName, key, value) {
  if (typeof window === 'undefined') return
  try {
    if (value) window[storageName]?.setItem(key, String(value))
    else window[storageName]?.removeItem(key)
  } catch {
    // A private browser session can block storage; the active tab still handles errors explicitly.
  }
}

export function rememberAdreemCloudSession({ authMode = '', token = '', refreshToken = '' } = {}, { preserveGeneration = false } = {}) {
  if (!preserveGeneration) authSessionGeneration += 1
  if (authMode === ADREEM_API_COOKIE_SESSION_MARKER) {
    setBrowserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY, '')
    setBrowserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY, ADREEM_API_COOKIE_SESSION_MARKER)
    setBrowserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY, '')
    return
  }
  if (token) {
    setBrowserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY, token)
    setBrowserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY, token)
  }
  if (refreshToken) setBrowserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY, refreshToken)
}

export function clearAdreemCloudSession() {
  authSessionGeneration += 1
  setBrowserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY, '')
  setBrowserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY, '')
  setBrowserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY, '')
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
  const sessionValue = browserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY)
  const persistentValue = browserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY)
  if (sessionValue === ADREEM_API_COOKIE_SESSION_MARKER || persistentValue === ADREEM_API_COOKIE_SESSION_MARKER) {
    setBrowserStorageItem('sessionStorage', ADREEM_API_TOKEN_SESSION_KEY, '')
    setBrowserStorageItem('localStorage', ADREEM_API_TOKEN_PERSIST_KEY, ADREEM_API_COOKIE_SESSION_MARKER)
    setBrowserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY, '')
    return { url: ADREEM_API_URL, mode: 'cookie', token: '' }
  }
  const token = sessionValue || persistentValue
  return token ? { url: ADREEM_API_URL, mode: 'legacy', token } : null
}

export function getLedgerPersistenceMode() {
  if (!ADREEM_API_URL) return 'configuration-error'
  return apiConfig() ? 'api' : 'api-missing-token'
}

async function fetchApiJson(path, options = {}, api = {}) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const headers = { ...(options.headers || {}) }
    if (api.mode === 'cookie') {
      delete headers.authorization
      delete headers.Authorization
    } else if (api.token) {
      headers.authorization = `Bearer ${api.token}`
    }
    const response = await fetch(`${ADREEM_API_URL}${path}`, {
      ...options,
      ...(api.mode === 'cookie' ? { credentials: 'include' } : {}),
      signal: controller.signal,
      headers,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `ADREEM cloud request failed: ${response.status}`)
      error.status = response.status
      error.data = data
      error.code = data.code
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

async function refreshAdreemCloudSession() {
  if (refreshSessionPromise) return refreshSessionPromise
  const api = apiConfig()
  if (!api) {
    const error = new Error('Missing ADREEM refresh session.')
    error.status = 401
    error.retryable = false
    throw error
  }
  const generation = authSessionGeneration
  const pendingRefresh = (async () => {
    try {
      const refreshToken = browserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY)
      const refreshOptions = api.mode === 'cookie'
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          }
      let data
      for (let attempt = 0; ; attempt += 1) {
        try {
          data = await fetchApiJson('/api/auth/refresh', refreshOptions, api)
          break
        } catch (error) {
          const delay = SESSION_ROTATION_RETRY_DELAYS_MS[attempt]
          if (api.mode !== 'cookie' || error?.code !== 'adreem-session-rotated' || delay === undefined) throw error
          await new Promise((resolve) => globalThis.setTimeout(resolve, delay))
        }
      }
      if (api.mode === 'cookie') {
        if (data?.authMode !== ADREEM_API_COOKIE_SESSION_MARKER) throw new Error('ADREEM cookie session refresh was incomplete.')
      } else if (!data?.token || !data?.refreshToken) {
        throw new Error('ADREEM session refresh was incomplete.')
      }
      if (generation !== authSessionGeneration) {
        const error = new Error('ADREEM session changed while refresh was in progress.')
        error.status = 401
        error.retryable = false
        error.code = 'adreem-session-fenced'
        throw error
      }
      rememberAdreemCloudSession(data, { preserveGeneration: true })
      return apiConfig()
    } catch (error) {
      if (error?.status === 401 && generation === authSessionGeneration) clearAdreemCloudSession()
      throw error
    } finally {
      if (refreshSessionPromise === pendingRefresh) refreshSessionPromise = null
    }
  })()
  refreshSessionPromise = pendingRefresh
  return pendingRefresh
}

export async function adreemApiJson(path, options = {}, allowRefresh = true) {
  const api = apiConfig()
  if (!api) throw new Error('Missing ADREEM login session.')
  const generation = authSessionGeneration
  try {
    const result = await fetchApiJson(path, options, api)
    if (generation !== authSessionGeneration) throw fencedSessionError()
    return result
  } catch (error) {
    if (error?.status === 401 && allowRefresh && path !== '/api/auth/refresh') {
      const refreshedApi = await refreshAdreemCloudSession()
      if (generation !== authSessionGeneration) throw fencedSessionError()
      const result = await fetchApiJson(path, options, refreshedApi)
      if (generation !== authSessionGeneration) throw fencedSessionError()
      return result
    }
    throw error
  }
}

const apiJson = adreemApiJson

function recordsById(records = []) {
  return new Map(records.filter((record) => record?.id).map((record) => [record.id, record]))
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonicalValue(value[key])
    return result
  }, {})
}

function sameRecord(left, right) {
  if (!left || !right) return left === right
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))
}

const DATABASE_DERIVED_FIELDS = {
  accounts: new Set(['balanceDinar', 'balanceUsd', 'postedCount', 'structureLocked', 'balanceSource']),
  movements: new Set(['databaseSequence']),
}

function comparableRecord(collection, record) {
  if (!record || typeof record !== 'object') return record
  const ignored = DATABASE_DERIVED_FIELDS[collection]
  if (!ignored) return record
  return Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)))
}

function sameLedgerRecord(collection, left, right) {
  return sameRecord(comparableRecord(collection, left), comparableRecord(collection, right))
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
      const localChanged = !sameLedgerRecord(collection, localRecord, baseRecord)
      const remoteChanged = !sameLedgerRecord(collection, remoteRecord, baseRecord)
      if (localChanged && remoteChanged && !sameLedgerRecord(collection, localRecord, remoteRecord)) {
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

function relationalDeltaWasApplied(delta, remoteState) {
  if (!delta || !remoteState) return false
  let checked = 0
  for (const collection of LEDGER_RECORD_COLLECTIONS) {
    const remote = recordsById(remoteState[collection])
    for (const record of Array.isArray(delta[collection]) ? delta[collection] : []) {
      checked += 1
      if (!sameLedgerRecord(collection, record, remote.get(record.id))) return false
    }
  }
  if (Object.prototype.hasOwnProperty.call(delta, 'ignoredExternalAccounts')) {
    checked += 1
    const left = Array.from(delta.ignoredExternalAccounts || []).sort()
    const right = Array.from(remoteState.ignoredExternalAccounts || []).sort()
    if (JSON.stringify(left) !== JSON.stringify(right)) return false
  }
  if (Object.prototype.hasOwnProperty.call(delta, 'resetAt')) {
    checked += 1
    if (String(delta.resetAt || '') !== String(remoteState.resetAt || '')) return false
  }
  return checked > 0
}

const CONFLICT_MOVEMENT_BATCH_SIZE = 40

function conflictSnapshotPaths(delta = {}) {
  const movementIds = Array.from(new Set((Array.isArray(delta.movements) ? delta.movements : [])
    .map((movement) => String(movement?.id || '').trim())
    .filter(Boolean)))
  if (!movementIds.length) return ['/api/ledger']
  const paths = []
  for (let offset = 0; offset < movementIds.length; offset += CONFLICT_MOVEMENT_BATCH_SIZE) {
    const params = new URLSearchParams()
    movementIds.slice(offset, offset + CONFLICT_MOVEMENT_BATCH_SIZE).forEach((id) => params.append('movementId', id))
    paths.push(`/api/ledger?${params}`)
  }
  return paths
}

function mergeMovementPages(...collections) {
  const byId = new Map()
  for (const movements of collections) {
    for (const movement of Array.isArray(movements) ? movements : []) {
      if (movement?.id) byId.set(movement.id, movement)
    }
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftSequence = Number(left?.databaseSequence)
    const rightSequence = Number(right?.databaseSequence)
    if (Number.isSafeInteger(leftSequence) && Number.isSafeInteger(rightSequence)) return leftSequence - rightSequence
    return String(left?.createdAt || left?.updatedAt || '').localeCompare(String(right?.createdAt || right?.updatedAt || ''))
  })
}

function attachmentTimestamp(attachment = {}) {
  const timestamp = Date.parse(attachment.updatedAt || attachment.createdAt || '')
  return Number.isFinite(timestamp) ? timestamp : null
}

export function mergeAdreemAttachmentPages(...collections) {
  const byId = new Map()
  for (const attachments of collections) {
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
      if (!attachment?.id) continue
      const existing = byId.get(attachment.id)
      const existingTimestamp = attachmentTimestamp(existing)
      const nextTimestamp = attachmentTimestamp(attachment)
      if (
        !existing
        || (nextTimestamp !== null && (existingTimestamp === null || nextTimestamp >= existingTimestamp))
        || (nextTimestamp === null && existingTimestamp === null)
      ) {
        byId.set(attachment.id, attachment)
      }
    }
  }
  return Array.from(byId.values())
}

async function loadConflictSnapshot(delta) {
  const snapshots = await Promise.all(conflictSnapshotPaths(delta).map((path) => apiJson(path)))
  const revisions = new Set(snapshots.map((snapshot) => Number(snapshot?.revision)).filter(Number.isSafeInteger))
  if (revisions.size > 1) {
    const error = new Error('تغيّر الدفتر أثناء استعادة التعارض. ستتم المحاولة من جديد.')
    error.retryable = true
    throw error
  }
  const [first, ...rest] = snapshots
  if (!first || !rest.length) return first
  return {
    ...first,
    state: {
      ...first.state,
      movements: mergeMovementPages(...snapshots.map((snapshot) => snapshot?.state?.movements)),
      attachments: mergeAdreemAttachmentPages(...snapshots.map((snapshot) => snapshot?.state?.attachments)),
    },
  }
}

function rememberCloudState(data, fallbackState) {
  const normalized = data?.state ? normalizeLedgerState(data.state, fallbackState) : fallbackState
  const storageMode = String(data?.storageMode || cloudStorageMode || 'legacy')
  const state = storageMode === 'relational' && normalized
    ? {
        ...normalized,
        movements: mergeMovementPages(fallbackState?.movements, normalized.movements),
        attachments: mergeAdreemAttachmentPages(fallbackState?.attachments, normalized.attachments),
      }
    : normalized
  cloudUpdatedAt = data?.updatedAt ?? cloudUpdatedAt ?? null
  cloudRevision = Number.isSafeInteger(Number(data?.revision)) ? Number(data.revision) : cloudRevision
  cloudStorageMode = storageMode
  cloudMovementPage = data?.movementPage || cloudMovementPage
  if (data?.reports && typeof data.reports === 'object') {
    cloudReports = {
      dimensions: Array.isArray(data.reports.dimensions) ? data.reports.dimensions : [],
      expenseCategories: Array.isArray(data.reports.expenseCategories) ? data.reports.expenseCategories : [],
    }
  }
  cloudState = state
  cloudStateGeneration += 1
  return state
}

function staleSaveResult(mode, fallbackState) {
  return {
    mode,
    localOk: false,
    supabaseOk: true,
    stale: true,
    state: fallbackState,
    storageMode: cloudStorageMode,
    revision: cloudRevision,
    movementPage: cloudMovementPage,
    reports: cloudReports,
  }
}

function saveResult(mode, data, fallbackState, saveGeneration) {
  if (saveGeneration !== cloudSaveGeneration) return staleSaveResult(mode, fallbackState)
  return {
    mode,
    localOk: false,
    supabaseOk: true,
    state: rememberCloudState(data, fallbackState),
    storageMode: cloudStorageMode,
    revision: cloudRevision,
    movementPage: cloudMovementPage,
    reports: cloudReports,
  }
}

async function putCloudState(state, baseUpdatedAt) {
  if (cloudStorageMode === 'relational') {
    const delta = createLedgerDelta(state, cloudState || {})
    if (isLedgerDeltaEmpty(delta)) {
      return {
        state: cloudState || state,
        storageMode: cloudStorageMode,
        revision: cloudRevision,
        updatedAt: cloudUpdatedAt,
        movementPage: cloudMovementPage,
        reports: cloudReports,
      }
    }
    return apiJson('/api/ledger', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delta, baseRevision: cloudRevision }),
    })
  }
  return apiJson('/api/ledger', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, baseUpdatedAt }),
  })
}

async function recoverCloudConflict(mode, state, baseState, saveGeneration) {
  const attemptedDelta = createLedgerDelta(state, baseState || {})
  const latest = await loadConflictSnapshot(attemptedDelta)
  if (!latest?.state) {
    const error = new Error('تعذر تحميل أحدث نسخة سحابية بعد التعارض.')
    error.retryable = true
    throw error
  }
  const remoteState = normalizeLedgerState(latest.state, baseState || state)
  if (saveGeneration !== cloudSaveGeneration) return staleSaveResult(mode, state)
  if (cloudStorageMode === 'relational' || latest.storageMode === 'relational') {
    const remembered = rememberCloudState(latest, baseState || remoteState)
    if (relationalDeltaWasApplied(attemptedDelta, remembered)) {
      return saveResult(mode, latest, remembered, saveGeneration)
    }
    const conflicts = concurrentRecordConflicts(state, remembered, baseState)
    if (conflicts.length > 0) throw recordConflictError(conflicts)
    for (const field of ['ignoredExternalAccounts', 'resetAt']) {
      if (!Object.prototype.hasOwnProperty.call(attemptedDelta, field)) continue
      const localValue = canonicalValue(state?.[field] ?? null)
      const remoteValue = canonicalValue(remembered?.[field] ?? null)
      const baseValue = canonicalValue(baseState?.[field] ?? null)
      const remoteChanged = JSON.stringify(remoteValue) !== JSON.stringify(baseValue)
      if (remoteChanged && JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
        throw recordConflictError([{ collection: 'ledger', id: field }])
      }
    }
    const mergedState = applyLedgerDelta(remembered, attemptedDelta)
    if (saveGeneration !== cloudSaveGeneration) return staleSaveResult(mode, state)
    const data = await putCloudState(mergedState, cloudUpdatedAt)
    return saveResult(mode, data, mergedState, saveGeneration)
  }
  const conflicts = concurrentRecordConflicts(state, remoteState, baseState)
  if (conflicts.length > 0) throw recordConflictError(conflicts)

  const mergedState = mergeLedgerStates(state, remoteState, remoteState)
  cloudState = remoteState
  cloudUpdatedAt = latest.updatedAt ?? null
  if (saveGeneration !== cloudSaveGeneration) return staleSaveResult(mode, state)
  const data = await putCloudState(mergedState, cloudUpdatedAt)
  return saveResult(mode, data, mergedState, saveGeneration)
}

export async function loadPersistedLedgerState(fallbackState) {
  const fallback = normalizeLedgerState(fallbackState, fallbackState)
  const mode = getLedgerPersistenceMode()
  if (mode !== 'api') {
    return {
      mode,
      state: fallback,
      source: mode,
      loadError: true,
      error: new Error(mode === 'configuration-error' ? 'ADREEM cloud API is not configured.' : 'Missing ADREEM login session.'),
    }
  }
  const stateGeneration = cloudStateGeneration
  invalidateMovementPageRequests()
  try {
    const data = await apiJson('/api/ledger')
    if (stateGeneration !== cloudStateGeneration) {
      return {
        mode,
        state: cloudState || fallback,
        storageMode: cloudStorageMode,
        revision: cloudRevision,
        movementPage: cloudMovementPage,
        reports: cloudReports,
        source: 'stale-api',
        stale: true,
      }
    }
    const state = rememberCloudState(data, fallback)
    return {
      mode,
      state,
      storageMode: cloudStorageMode,
      revision: cloudRevision,
      movementPage: cloudMovementPage,
      reports: cloudReports,
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

export async function deleteAdreemUnusedAccount(accountId, expectedVersion) {
  const id = String(accountId || '').trim()
  if (!id) throw new Error('اختر حسابًا صالحًا للحذف.')
  const relational = cloudStorageMode === 'relational'
  const revision = Number(expectedVersion === undefined ? cloudRevision : expectedVersion)
  const updatedAt = expectedVersion === undefined ? cloudUpdatedAt : expectedVersion
  if (
    (relational && (!Number.isSafeInteger(revision) || revision < 0))
    || (!relational && cloudUpdatedAt === undefined)
  ) {
    const error = new Error('أعد تحميل الدفتر قبل حذف الحساب.')
    error.status = 428
    error.retryable = false
    throw error
  }
  if (
    (relational && Number.isSafeInteger(cloudRevision) && revision !== cloudRevision)
    || (!relational && String(updatedAt || '') !== String(cloudUpdatedAt || ''))
  ) {
    const error = new Error('تغيّر الدفتر. أعد تحميل الصفحة قبل حذف الحساب.')
    error.status = 409
    error.retryable = false
    throw error
  }

  invalidateMovementPageRequests()
  const data = await apiJson(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(relational
      ? { baseRevision: revision }
      : { baseUpdatedAt: updatedAt || null }),
  })
  const state = rememberCloudState(data, cloudState || { accounts: [], movements: [] })
  return {
    mode: 'api',
    localOk: false,
    supabaseOk: true,
    state,
    storageMode: cloudStorageMode,
    revision: cloudRevision,
    movementPage: cloudMovementPage,
    reports: cloudReports,
    deletedAccountIds: Array.isArray(data?.deletedAccountIds) ? data.deletedAccountIds : [id],
  }
}

export async function savePersistedLedgerState(state) {
  const mode = getLedgerPersistenceMode()
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
  const saveGeneration = cloudSaveGeneration + 1
  cloudSaveGeneration = saveGeneration
  invalidateMovementPageRequests()
  const baseState = cloudState
  try {
    const data = await putCloudState(normalizedState, cloudUpdatedAt ?? null)
    return saveResult(mode, data, normalizedState, saveGeneration)
  } catch (error) {
    if (error?.status === 409) {
      try {
        return await recoverCloudConflict(mode, normalizedState, baseState, saveGeneration)
      } catch (conflictError) {
        console.warn('[adreem-persistence] cloud save failed:', conflictError?.message || conflictError)
        return { mode, localOk: false, supabaseOk: false, state: normalizedState, error: conflictError }
      }
    }
    console.warn('[adreem-persistence] cloud save failed:', error?.message || error)
    return { mode, localOk: false, supabaseOk: false, state: normalizedState, error }
  }
}

export async function loadAdreemMovementPage({
  before,
  limit = 100,
  query = '',
  accountId = '',
  status = '',
  type = '',
  types = [],
  dimensionId = '',
  expenseCategoryId = '',
  occurredFrom = '',
  occurredBefore = '',
  includeOpening = false,
  requestKey = 'default',
} = {}) {
  if (cloudStorageMode !== 'relational') {
    return { movements: [], page: { hasMore: false, nextCursor: null } }
  }
  const request = beginMovementPageRequest(requestKey)
  const revision = cloudRevision
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', String(before))
  if (query) params.set('q', String(query).trim())
  if (accountId) params.set('accountId', accountId)
  if (status) params.set('status', status)
  if (type) params.set('type', type)
  if (!type && Array.isArray(types) && types.length) params.set('types', types.join(','))
  if (dimensionId) params.set('dimensionId', dimensionId)
  if (expenseCategoryId) params.set('expenseCategoryId', expenseCategoryId)
  if (occurredFrom) params.set('occurredFrom', occurredFrom)
  if (occurredBefore) params.set('occurredBefore', occurredBefore)
  if (includeOpening) params.set('includeOpening', 'true')
  const data = await apiJson(`/api/movements?${params}`)
  const responseRevision = Number(data?.revision)
  if (
    !isCurrentMovementPageRequest(request)
    || revision !== cloudRevision
    || (Number.isSafeInteger(responseRevision) && Number.isSafeInteger(revision) && responseRevision !== revision)
  ) {
    return {
      movements: [],
      allMovements: cloudState?.movements || [],
      attachments: [],
      allAttachments: cloudState?.attachments || [],
      page: cloudMovementPage || { hasMore: false, nextCursor: null },
      stale: true,
    }
  }
  const movements = Array.isArray(data?.movements) ? data.movements : []
  const attachments = Array.isArray(data?.attachments) ? data.attachments : []
  const mergedMovements = mergeMovementPages(cloudState?.movements, movements)
  const mergedAttachments = mergeAdreemAttachmentPages(cloudState?.attachments, attachments)
  cloudState = cloudState
    ? { ...cloudState, movements: mergedMovements, attachments: mergedAttachments }
    : cloudState
  cloudStateGeneration += 1
  return {
    movements,
    allMovements: mergedMovements,
    attachments,
    allAttachments: mergedAttachments,
    page: data?.page || { hasMore: false, nextCursor: null },
    revision: responseRevision,
  }
}

export async function loadMoreAdreemMovements(options = {}) {
  const result = await loadAdreemMovementPage(options)
  if (result.stale) return result
  const mergedMovements = result.allMovements || cloudState?.movements || []
  cloudMovementPage = {
    ...(result.page || {}),
    loaded: mergedMovements.length,
  }
  return { ...result, allMovements: mergedMovements, page: cloudMovementPage }
}

export async function logoutAdreemCloudSession() {
  const api = apiConfig()
  const refreshToken = browserStorageItem('localStorage', ADREEM_API_REFRESH_TOKEN_PERSIST_KEY)
  clearAdreemCloudSession()
  try {
    if (api) {
      await fetchApiJson('/api/auth/logout', api.mode === 'cookie'
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          }, api)
    }
  } finally {
    cloudUpdatedAt = undefined
    cloudState = undefined
    cloudRevision = undefined
    cloudStorageMode = 'legacy'
    cloudMovementPage = null
    cloudReports = null
    cloudStateGeneration += 1
    cloudSaveGeneration += 1
    invalidateMovementPageRequests()
  }
}

function fencedSessionError() {
  const error = new Error('ADREEM session changed while the request was in progress.')
  error.status = 401
  error.retryable = false
  error.code = 'adreem-session-fenced'
  return error
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
    : action === 'cleanup'
      ? {
          401: 'انتهت جلسة الدخول.',
          403: 'لا يمكنك حذف هذا المرفق.',
          409: 'المرفق مرتبط ببيانات محفوظة ولا يمكن تنظيفه.',
          501: 'تخزين المرفقات غير مهيأ.',
        }
    : {
        400: 'ملف المرفق غير صالح.',
        401: 'انتهت جلسة الدخول.',
        413: 'حجم المرفق أكبر من 10 ميغابايت.',
        415: 'نوع المرفق غير مسموح.',
        429: 'طلبات كثيرة. حاول بعد قليل.',
        501: 'تخزين المرفقات غير مهيأ.',
      }
  const fallback = action === 'open'
    ? status >= 500 ? 'تعذر فتح المرفق من السحابة.' : 'تعذر فتح المرفق.'
    : action === 'cleanup'
      ? status >= 500 ? 'تعذر تنظيف المرفق من السحابة.' : 'تعذر تنظيف المرفق.'
      : status >= 500 ? 'تعذر حفظ المرفق في السحابة.' : 'تعذر رفع المرفق.'
  const message = messages[status] || fallback
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

export async function deleteAdreemUploadedAttachment(storagePath) {
  const path = String(storagePath || '')
  if (!path) return
  try {
    const params = new URLSearchParams({ path })
    await apiJson(`/api/attachments?${params}`, { method: 'DELETE' })
  } catch (error) {
    throw attachmentRequestError(error, 'cleanup')
  }
}

export async function cleanupAdreemUploadedAttachments(storagePaths = []) {
  const paths = Array.from(new Set(
    (Array.isArray(storagePaths) ? storagePaths : [])
      .map((storagePath) => String(storagePath || '').trim())
      .filter(Boolean),
  ))
  const results = await Promise.all(paths.map(async (storagePath) => {
    try {
      await deleteAdreemUploadedAttachment(storagePath)
      return { storagePath, deleted: true }
    } catch (error) {
      return { storagePath, deleted: false, error }
    }
  }))
  return {
    deletedPaths: results.filter((result) => result.deleted).map((result) => result.storagePath),
    failedPaths: results.filter((result) => !result.deleted).map((result) => result.storagePath),
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
