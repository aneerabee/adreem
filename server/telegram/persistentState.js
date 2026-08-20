import { randomUUID } from 'node:crypto'

const DEFAULT_NAMESPACE = 'telegram'
const DEFAULT_STREAM_ID = 'default'
const DEFAULT_UPDATE_LEASE_MS = 30 * 1000
const DEFAULT_UPDATE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_EFFECT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_UPDATE_ATTEMPTS = 3
const RECORD_VERSION = 1
const SESSION_RECORD = 'session'
const OFFSET_RECORD = 'offset'
const UPDATE_RECORD = 'processed-update'
const EFFECT_RECORD = 'update-effect'
const UPDATE_STATUS_COMPLETED = 'completed'
const UPDATE_STATUS_PROCESSING = 'processing'
const UPDATE_STATUS_QUARANTINED = 'quarantined'
const UPDATE_STATUS_RETRYING = 'retrying'
const EFFECT_STATUS_COMPLETED = 'completed'
const EFFECT_STATUS_FAILED = 'failed'
const EFFECT_STATUS_PROCESSING = 'processing'
const CLAIM_ATTEMPTS = 2
const REQUIRED_REPOSITORY_METHODS = ['get', 'set', 'delete', 'setIfAbsent']
const ATOMIC_CLAIM_METHODS = ['claim', 'renewClaim', 'completeClaim', 'failClaim', 'releaseClaim']
const ATOMIC_EFFECT_METHODS = ['claimEffect', 'completeEffect']
const claimOperationTails = new WeakMap()

export class TelegramStateRepositoryError extends Error {
  constructor(operation, key, cause) {
    const reason = cause instanceof Error ? cause.message : String(cause || 'unknown error')
    super(`Telegram state repository failed during ${operation} for "${key}": ${reason}`)
    this.name = 'TelegramStateRepositoryError'
    this.operation = operation
    this.key = key
    this.cause = cause
  }
}

export class InvalidTelegramStateError extends Error {
  constructor(key, expectedKind) {
    super(`Stored Telegram state for "${key}" is not a valid ${expectedKind} record.`)
    this.name = 'InvalidTelegramStateError'
    this.key = key
    this.expectedKind = expectedKind
  }
}

export class TelegramUpdateInProgressError extends Error {
  constructor(updateId, leaseExpiresAt) {
    super(`Telegram update ${updateId} is already being processed until ${leaseExpiresAt}.`)
    this.name = 'TelegramUpdateInProgressError'
    this.code = 'TELEGRAM_UPDATE_IN_PROGRESS'
    this.updateId = updateId
    this.leaseExpiresAt = leaseExpiresAt
  }
}

export class TelegramUpdateClaimLostError extends Error {
  constructor(updateId) {
    super(`The processing claim for Telegram update ${updateId} is no longer owned by this worker.`)
    this.name = 'TelegramUpdateClaimLostError'
    this.code = 'TELEGRAM_UPDATE_CLAIM_LOST'
    this.updateId = updateId
  }
}

export class TelegramUpdateReleaseError extends Error {
  constructor(updateId, cause, releaseError) {
    super(`Telegram update ${updateId} failed and its processing claim could not be released.`)
    this.name = 'TelegramUpdateReleaseError'
    this.code = 'TELEGRAM_UPDATE_RELEASE_FAILED'
    this.updateId = updateId
    this.cause = cause
    this.releaseError = releaseError
  }
}

export class TelegramUpdateEffectUncertainError extends Error {
  constructor(updateId, effectId, cause = null) {
    super(`Telegram update ${updateId} effect "${effectId}" has an uncertain external outcome.`)
    this.name = 'TelegramUpdateEffectUncertainError'
    this.code = 'TELEGRAM_UPDATE_EFFECT_UNCERTAIN'
    this.updateId = updateId
    this.effectId = effectId
    if (cause) this.cause = cause
  }
}

export class TelegramUpdateEffectFailedError extends Error {
  constructor(updateId, effectId, failure = {}) {
    super(String(failure.message || `Telegram update ${updateId} effect "${effectId}" failed.`))
    this.name = 'TelegramUpdateEffectFailedError'
    this.code = 'TELEGRAM_UPDATE_EFFECT_FAILED'
    this.updateId = updateId
    this.effectId = effectId
    this.failure = failure
    this.retryable = failure.retryable === true
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertRepository(repository) {
  if (!isRecord(repository)) throw new TypeError('A Telegram state repository is required.')
  for (const method of REQUIRED_REPOSITORY_METHODS) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Telegram state repository must implement async ${method}().`)
    }
  }
}

function hasAtomicClaimOperations(repository) {
  return ATOMIC_CLAIM_METHODS.every((method) => typeof repository[method] === 'function')
}

function hasAtomicEffectOperations(repository) {
  return ATOMIC_EFFECT_METHODS.every((method) => typeof repository[method] === 'function')
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`)
  return value.trim()
}

function assertIdentityPart(value, label) {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new TypeError(`${label} must be a non-empty string or a safe integer.`)
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`)
  return value
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`)
  return value
}

function cloneSerializable(value, label) {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError(`${label} cannot be undefined.`)
    return JSON.parse(serialized)
  } catch (cause) {
    if (cause instanceof TypeError && cause.message === `${label} cannot be undefined.`) throw cause
    const error = new TypeError(`${label} must be JSON-serializable.`)
    error.cause = cause
    throw error
  }
}

function encodedKeyPart(value, label) {
  const part = assertIdentityPart(value, label)
  return encodeURIComponent(JSON.stringify([typeof part, part]))
}

function createRecord(kind, value) {
  return {
    version: RECORD_VERSION,
    kind,
    value: cloneSerializable(value, `${kind} value`),
  }
}

function readRecordValue(record, key, expectedKind) {
  if (
    !isRecord(record) ||
    record.version !== RECORD_VERSION ||
    record.kind !== expectedKind ||
    !Object.prototype.hasOwnProperty.call(record, 'value')
  ) {
    throw new InvalidTelegramStateError(key, expectedKind)
  }
  return cloneSerializable(record.value, `${expectedKind} value`)
}

function readUpdateValue(value, key, updateId) {
  if (!isRecord(value) || value.updateId !== updateId) throw new InvalidTelegramStateError(key, UPDATE_RECORD)
  const status = value.status || UPDATE_STATUS_COMPLETED
  if ([UPDATE_STATUS_COMPLETED, UPDATE_STATUS_QUARANTINED].includes(status)) {
    return { ...value, status, attempts: Number(value.attempts || 0) }
  }
  if (status === UPDATE_STATUS_RETRYING) {
    if (!Number.isSafeInteger(value.attempts) || value.attempts <= 0) {
      throw new InvalidTelegramStateError(key, UPDATE_RECORD)
    }
    return { ...value, status }
  }
  const leaseTimestamp = Date.parse(value.leaseExpiresAt)
  if (
    status !== UPDATE_STATUS_PROCESSING ||
    typeof value.claimId !== 'string' ||
    !value.claimId ||
    !Number.isFinite(leaseTimestamp)
  ) {
    throw new InvalidTelegramStateError(key, UPDATE_RECORD)
  }
  const attempts = Number(value.attempts || 1)
  if (!Number.isSafeInteger(attempts) || attempts <= 0) throw new InvalidTelegramStateError(key, UPDATE_RECORD)
  return { ...value, status, attempts, leaseExpiresAt: new Date(leaseTimestamp).toISOString() }
}

function readEffectValue(value, key, updateId, effectId) {
  if (
    !isRecord(value) ||
    value.updateId !== updateId ||
    value.effectId !== effectId ||
    ![EFFECT_STATUS_PROCESSING, EFFECT_STATUS_COMPLETED, EFFECT_STATUS_FAILED].includes(value.status)
  ) {
    throw new InvalidTelegramStateError(key, EFFECT_RECORD)
  }
  if (value.status === EFFECT_STATUS_PROCESSING && (!value.claimId || typeof value.claimId !== 'string')) {
    throw new InvalidTelegramStateError(key, EFFECT_RECORD)
  }
  return cloneSerializable(value, 'update effect value')
}

async function serializeClaimOperation(repository, operation) {
  const previous = claimOperationTails.get(repository) || Promise.resolve()
  const task = previous.then(operation)
  const tail = task.catch(() => undefined)
  claimOperationTails.set(repository, tail)
  void tail.finally(() => {
    if (claimOperationTails.get(repository) === tail) claimOperationTails.delete(repository)
  })
  return task
}

export function createPersistentTelegramState({
  repository,
  namespace = DEFAULT_NAMESPACE,
  updateLeaseMs = DEFAULT_UPDATE_LEASE_MS,
  updateRetentionMs = DEFAULT_UPDATE_RETENTION_MS,
  effectRetentionMs = DEFAULT_EFFECT_RETENTION_MS,
  maxUpdateAttempts = DEFAULT_MAX_UPDATE_ATTEMPTS,
  now = Date.now,
  claimIdFactory = randomUUID,
} = {}) {
  assertRepository(repository)
  const keyPrefix = encodeURIComponent(assertNonEmptyString(namespace, 'Telegram state namespace'))
  const leaseMs = assertPositiveInteger(updateLeaseMs, 'Telegram update lease')
  const updateRetention = assertPositiveInteger(updateRetentionMs, 'Telegram update retention')
  const effectRetention = assertPositiveInteger(effectRetentionMs, 'Telegram effect retention')
  const maximumAttempts = assertPositiveInteger(maxUpdateAttempts, 'Telegram maximum update attempts')
  if (typeof now !== 'function') throw new TypeError('Telegram state clock must be a function.')
  if (typeof claimIdFactory !== 'function') throw new TypeError('Telegram claim ID factory must be a function.')

  function sessionKey(chatId, userId) {
    return `${keyPrefix}/sessions/${encodedKeyPart(chatId, 'chatId')}/${encodedKeyPart(userId, 'userId')}`
  }

  function offsetKey(streamId) {
    return `${keyPrefix}/offsets/${encodedKeyPart(streamId, 'streamId')}`
  }

  function updateKey(updateId, streamId) {
    return `${keyPrefix}/processed-updates/${encodedKeyPart(streamId, 'streamId')}/${assertNonNegativeInteger(updateId, 'updateId')}`
  }

  function effectKey(updateId, effectId, streamId) {
    return `${keyPrefix}/update-effects/${encodedKeyPart(streamId, 'streamId')}/${assertNonNegativeInteger(updateId, 'updateId')}/${encodedKeyPart(effectId, 'effectId')}`
  }

  async function callRepository(method, key, ...args) {
    try {
      return await repository[method](key, ...args)
    } catch (cause) {
      throw new TelegramStateRepositoryError(method, key, cause)
    }
  }

  async function readRecord(key, expectedKind) {
    const record = await callRepository('get', key)
    if (record === null || record === undefined) return null
    return readRecordValue(record, key, expectedKind)
  }

  function currentTimestamp() {
    const timestamp = Number(now())
    if (!Number.isFinite(timestamp)) throw new TypeError('Telegram state clock must return a valid timestamp.')
    return timestamp
  }

  async function setIfAbsent(key, record) {
    const inserted = await callRepository('setIfAbsent', key, record)
    if (typeof inserted !== 'boolean') {
      throw new TelegramStateRepositoryError(
        'setIfAbsent',
        key,
        new TypeError('Repository setIfAbsent() must resolve to a boolean.'),
      )
    }
    return inserted
  }

  function invalidRepositoryResult(operation, key, message) {
    return new TelegramStateRepositoryError(operation, key, new TypeError(message))
  }

  async function readUpdate(updateId, streamId) {
    const key = updateKey(updateId, streamId)
    const value = await readRecord(key, UPDATE_RECORD)
    return { key, value: value === null ? null : readUpdateValue(value, key, updateId) }
  }

  async function readEffect(updateId, effectId, streamId) {
    const key = effectKey(updateId, effectId, streamId)
    const value = await readRecord(key, EFFECT_RECORD)
    return { key, value: value === null ? null : readEffectValue(value, key, updateId, effectId) }
  }

  async function claimUpdate(updateId, streamId = DEFAULT_STREAM_ID, metadata = {}) {
    if (!isRecord(metadata)) throw new TypeError('Telegram update metadata must be an object.')
    const claimId = assertNonEmptyString(claimIdFactory(), 'Telegram update claim ID')
    const key = updateKey(updateId, streamId)
    const timestamp = currentTimestamp()
    const leaseExpiresAt = new Date(timestamp + leaseMs).toISOString()
    const marker = createRecord(UPDATE_RECORD, {
      updateId,
      status: UPDATE_STATUS_PROCESSING,
      claimId,
      leaseExpiresAt,
      attempts: 1,
      maxAttempts: maximumAttempts,
      metadata,
    })

    if (hasAtomicClaimOperations(repository)) {
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
        const result = await callRepository('claim', key, marker, leaseMs, updateRetention)
        if (!isRecord(result) || typeof result.claimed !== 'boolean') {
          throw invalidRepositoryResult('claim', key, 'Repository claim() must return a claim result.')
        }
        if (!result.payload) continue
        const value = readUpdateValue(readRecordValue(result.payload, key, UPDATE_RECORD), key, updateId)
        if (result.claimed) {
          if (value.status !== UPDATE_STATUS_PROCESSING || value.claimId !== claimId) {
            throw invalidRepositoryResult('claim', key, 'Repository claim() returned a different claim token.')
          }
          return {
            status: 'claimed',
            claimId,
            leaseExpiresAt: value.leaseExpiresAt,
            attempts: value.attempts,
          }
        }
        if (value.status === UPDATE_STATUS_COMPLETED) return { status: 'completed' }
        if (value.status === UPDATE_STATUS_QUARANTINED) {
          return { status: 'quarantined', attempts: value.attempts, failure: value.lastFailure || null }
        }
        return {
          status: 'in-progress',
          claimId: value.claimId,
          leaseExpiresAt: value.leaseExpiresAt,
        }
      }
      throw invalidRepositoryResult('claim', key, 'Repository claim() did not retain a claim record.')
    }

    return serializeClaimOperation(repository, async () => {
      for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
        if (await setIfAbsent(key, marker)) {
          return { status: 'claimed', claimId, leaseExpiresAt, attempts: 1 }
        }
        const existing = await readUpdate(updateId, streamId)
        if (existing.value === null) continue
        if (existing.value.status === UPDATE_STATUS_COMPLETED) return { status: 'completed' }
        if (existing.value.status === UPDATE_STATUS_QUARANTINED) {
          return {
            status: 'quarantined',
            attempts: existing.value.attempts,
            failure: existing.value.lastFailure || null,
          }
        }
        const leaseExpired = existing.value.status === UPDATE_STATUS_PROCESSING &&
          Date.parse(existing.value.leaseExpiresAt) <= timestamp
        if (existing.value.status === UPDATE_STATUS_RETRYING || leaseExpired) {
          if (existing.value.attempts >= maximumAttempts) {
            const retainedValue = Object.fromEntries(
              Object.entries(existing.value).filter(([field]) => !['claimId', 'leaseExpiresAt'].includes(field)),
            )
            const quarantined = createRecord(UPDATE_RECORD, {
              ...retainedValue,
              status: UPDATE_STATUS_QUARANTINED,
              quarantinedAt: new Date(timestamp).toISOString(),
              lastFailure: existing.value.lastFailure || {
                name: 'Error',
                message: `Telegram update ${updateId} exhausted its retry limit after an expired claim.`,
                code: 'TELEGRAM_UPDATE_ATTEMPTS_EXHAUSTED',
                retryable: false,
              },
            })
            await callRepository('set', key, quarantined)
            return {
              status: 'quarantined',
              attempts: existing.value.attempts,
              failure: quarantined.value.lastFailure,
            }
          }
          const nextMarker = createRecord(UPDATE_RECORD, {
            ...marker.value,
            attempts: existing.value.attempts + 1,
            lastFailure: existing.value.lastFailure,
          })
          await callRepository('set', key, nextMarker)
          return {
            status: 'claimed',
            claimId,
            leaseExpiresAt,
            attempts: nextMarker.value.attempts,
          }
        }
        return {
          status: 'in-progress',
          claimId: existing.value.claimId,
          leaseExpiresAt: existing.value.leaseExpiresAt,
        }
      }

      throw new TelegramStateRepositoryError(
        'setIfAbsent',
        key,
        new Error('Repository did not retain either competing Telegram update claim.'),
      )
    })
  }

  async function renewUpdateClaim(updateId, claimId, streamId = DEFAULT_STREAM_ID, metadata = {}) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    if (!isRecord(metadata)) throw new TypeError('Telegram update metadata must be an object.')
    if (hasAtomicClaimOperations(repository)) {
      const existing = await readUpdate(updateId, streamId)
      if (
        existing.value?.status !== UPDATE_STATUS_PROCESSING ||
        existing.value.claimId !== normalizedClaimId
      ) {
        throw new TelegramUpdateClaimLostError(updateId)
      }
      const marker = createRecord(UPDATE_RECORD, {
        ...existing.value,
        claimId: normalizedClaimId,
        metadata: {
          ...(existing.value.metadata || {}),
          ...cloneSerializable(metadata, 'update metadata'),
        },
      })
      const result = await callRepository('renewClaim', existing.key, normalizedClaimId, marker, leaseMs)
      if (!isRecord(result) || typeof result.updated !== 'boolean') {
        throw invalidRepositoryResult('renewClaim', existing.key, 'Repository renewClaim() must return a renewal result.')
      }
      if (!result.updated) throw new TelegramUpdateClaimLostError(updateId)
      const value = readUpdateValue(readRecordValue(result.payload, existing.key, UPDATE_RECORD), existing.key, updateId)
      if (value.status !== UPDATE_STATUS_PROCESSING || value.claimId !== normalizedClaimId) {
        throw invalidRepositoryResult('renewClaim', existing.key, 'Repository renewClaim() returned a different claim token.')
      }
      return { status: 'renewed', claimId: normalizedClaimId, leaseExpiresAt: value.leaseExpiresAt }
    }

    return serializeClaimOperation(repository, async () => {
      const existing = await readUpdate(updateId, streamId)
      if (
        existing.value?.status !== UPDATE_STATUS_PROCESSING ||
        existing.value.claimId !== normalizedClaimId ||
        Date.parse(existing.value.leaseExpiresAt) <= currentTimestamp()
      ) {
        throw new TelegramUpdateClaimLostError(updateId)
      }
      const leaseExpiresAt = new Date(currentTimestamp() + leaseMs).toISOString()
      await callRepository('set', existing.key, createRecord(UPDATE_RECORD, {
        ...existing.value,
        claimId: normalizedClaimId,
        leaseExpiresAt,
        metadata: {
          ...(existing.value.metadata || {}),
          ...cloneSerializable(metadata, 'update metadata'),
        },
      }))
      return { status: 'renewed', claimId: normalizedClaimId, leaseExpiresAt }
    })
  }

  async function completeUpdate(updateId, claimId, streamId = DEFAULT_STREAM_ID, metadata = {}) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    if (!isRecord(metadata)) throw new TypeError('Telegram update metadata must be an object.')
    if (hasAtomicClaimOperations(repository)) {
      const existing = await readUpdate(updateId, streamId)
      if (existing.value?.status === UPDATE_STATUS_COMPLETED) return false
      if (existing.value?.claimId !== normalizedClaimId) throw new TelegramUpdateClaimLostError(updateId)
      const marker = createRecord(UPDATE_RECORD, {
        updateId,
        status: UPDATE_STATUS_COMPLETED,
        processedAt: new Date(currentTimestamp()).toISOString(),
        metadata: { ...(existing.value.metadata || {}), ...cloneSerializable(metadata, 'update metadata') },
      })
      const completed = await callRepository('completeClaim', existing.key, normalizedClaimId, marker)
      if (typeof completed !== 'boolean') {
        throw invalidRepositoryResult('completeClaim', existing.key, 'Repository completeClaim() must return a boolean.')
      }
      if (completed) return true
      const latest = await readUpdate(updateId, streamId)
      if (latest.value?.status === UPDATE_STATUS_COMPLETED) return false
      throw new TelegramUpdateClaimLostError(updateId)
    }

    return serializeClaimOperation(repository, async () => {
      const existing = await readUpdate(updateId, streamId)
      if (existing.value?.status === UPDATE_STATUS_COMPLETED) return false
      const timestamp = currentTimestamp()
      if (
        existing.value?.claimId !== normalizedClaimId ||
        Date.parse(existing.value.leaseExpiresAt) <= timestamp
      ) {
        throw new TelegramUpdateClaimLostError(updateId)
      }
      await callRepository('set', existing.key, createRecord(UPDATE_RECORD, {
        updateId,
        status: UPDATE_STATUS_COMPLETED,
        processedAt: new Date(timestamp).toISOString(),
        metadata: { ...(existing.value.metadata || {}), ...cloneSerializable(metadata, 'update metadata') },
      }))
      return true
    })
  }

  function serializedFailure(error) {
    return {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || 'Telegram update failed.'),
      code: String(error?.code || ''),
      retryable: error?.retryable !== false,
    }
  }

  function failureRequiresQuarantine(error, attempts) {
    return error?.code === 'TELEGRAM_UPDATE_EFFECT_UNCERTAIN' ||
      error?.retryable === false ||
      attempts >= maximumAttempts
  }

  async function finalizeFailedUpdate(updateId, claimId, attempts, failure, streamId, metadata) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    const key = updateKey(updateId, streamId)
    const timestamp = currentTimestamp()
    const quarantined = failureRequiresQuarantine(failure, attempts)
    const status = quarantined ? UPDATE_STATUS_QUARANTINED : UPDATE_STATUS_RETRYING
    const failureValue = serializedFailure(failure)
    const marker = createRecord(UPDATE_RECORD, {
      updateId,
      status,
      attempts,
      maxAttempts: maximumAttempts,
      ...(quarantined
        ? { quarantinedAt: new Date(timestamp).toISOString() }
        : { retryScheduledAt: new Date(timestamp).toISOString() }),
      lastFailure: failureValue,
      metadata: cloneSerializable(metadata, 'update metadata'),
    })

    if (hasAtomicClaimOperations(repository)) {
      const finalized = await callRepository(
        'failClaim',
        key,
        normalizedClaimId,
        marker,
        updateRetention,
      )
      if (typeof finalized !== 'boolean') {
        throw invalidRepositoryResult('failClaim', key, 'Repository failClaim() must return a boolean.')
      }
      if (!finalized) throw new TelegramUpdateClaimLostError(updateId)
    } else {
      await serializeClaimOperation(repository, async () => {
        const existing = await readUpdate(updateId, streamId)
        if (
          existing.value?.status !== UPDATE_STATUS_PROCESSING ||
          existing.value.claimId !== normalizedClaimId ||
          Date.parse(existing.value.leaseExpiresAt) <= timestamp
        ) {
          throw new TelegramUpdateClaimLostError(updateId)
        }
        await callRepository('set', key, marker)
      })
    }

    return { status, attempts, failure: failureValue }
  }

  async function releaseUpdateClaim(updateId, claimId, streamId = DEFAULT_STREAM_ID) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    if (hasAtomicClaimOperations(repository)) {
      const key = updateKey(updateId, streamId)
      const released = await callRepository('releaseClaim', key, normalizedClaimId)
      if (typeof released !== 'boolean') {
        throw invalidRepositoryResult('releaseClaim', key, 'Repository releaseClaim() must return a boolean.')
      }
      return released
    }

    return serializeClaimOperation(repository, async () => {
      const existing = await readUpdate(updateId, streamId)
      if (
        existing.value === null ||
        existing.value.status === UPDATE_STATUS_COMPLETED ||
        existing.value.claimId !== normalizedClaimId
      ) {
        return false
      }
      await callRepository('delete', existing.key)
      return true
    })
  }

  function effectResult(value) {
    if (!value.hasResult) return undefined
    return cloneSerializable(value.result, 'update effect result')
  }

  function effectFailure(error) {
    return {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || 'External effect failed.'),
      code: String(error?.code || ''),
      status: Number.isInteger(error?.status) ? error.status : null,
      retryable: error?.retryable === true,
    }
  }

  function hasCertainEffectFailure(error) {
    return error?.effectOutcome === 'failed' ||
      error?.retryable === false ||
      (error?.retryable === true && Number.isInteger(error?.status))
  }

  async function claimUpdateEffect(updateId, claimId, effectId, streamId, metadata) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    const normalizedEffectId = assertNonEmptyString(effectId, 'Telegram update effect ID')
    if (!isRecord(metadata)) throw new TypeError('Telegram update effect metadata must be an object.')
    const updateStateKey = updateKey(updateId, streamId)
    const key = effectKey(updateId, normalizedEffectId, streamId)
    const marker = createRecord(EFFECT_RECORD, {
      updateId,
      effectId: normalizedEffectId,
      status: EFFECT_STATUS_PROCESSING,
      claimId: normalizedClaimId,
      startedAt: new Date(currentTimestamp()).toISOString(),
      metadata,
    })

    if (hasAtomicEffectOperations(repository)) {
      const result = await callRepository(
        'claimEffect',
        key,
        updateStateKey,
        normalizedClaimId,
        marker,
        effectRetention,
      )
      if (!isRecord(result) || typeof result.claimed !== 'boolean') {
        throw invalidRepositoryResult('claimEffect', key, 'Repository claimEffect() must return an effect claim result.')
      }
      if (!result.payload) throw new TelegramUpdateClaimLostError(updateId)
      const value = readEffectValue(readRecordValue(result.payload, key, EFFECT_RECORD), key, updateId, normalizedEffectId)
      return { claimed: result.claimed, key, value }
    }

    return serializeClaimOperation(repository, async () => {
      const update = await readUpdate(updateId, streamId)
      if (
        update.value?.status !== UPDATE_STATUS_PROCESSING ||
        update.value.claimId !== normalizedClaimId ||
        Date.parse(update.value.leaseExpiresAt) <= currentTimestamp()
      ) {
        throw new TelegramUpdateClaimLostError(updateId)
      }
      if (await setIfAbsent(key, marker)) return { claimed: true, key, value: marker.value }
      const existing = await readEffect(updateId, normalizedEffectId, streamId)
      if (!existing.value) throw invalidRepositoryResult('claimEffect', key, 'Repository lost the retained effect record.')
      if (existing.value.status === EFFECT_STATUS_FAILED && existing.value.failure?.retryable === true) {
        await callRepository('set', key, marker)
        return { claimed: true, key, value: marker.value }
      }
      return { claimed: false, key, value: existing.value }
    })
  }

  async function finalizeUpdateEffect(updateId, claimId, effectId, streamId, value) {
    const normalizedClaimId = assertNonEmptyString(claimId, 'Telegram update claim ID')
    const normalizedEffectId = assertNonEmptyString(effectId, 'Telegram update effect ID')
    const updateStateKey = updateKey(updateId, streamId)
    const key = effectKey(updateId, normalizedEffectId, streamId)
    const marker = createRecord(EFFECT_RECORD, value)

    if (hasAtomicEffectOperations(repository)) {
      const completed = await callRepository(
        'completeEffect',
        key,
        updateStateKey,
        normalizedClaimId,
        marker,
        effectRetention,
      )
      if (typeof completed !== 'boolean') {
        throw invalidRepositoryResult('completeEffect', key, 'Repository completeEffect() must return a boolean.')
      }
      if (!completed) throw new TelegramUpdateClaimLostError(updateId)
      return
    }

    await serializeClaimOperation(repository, async () => {
      const update = await readUpdate(updateId, streamId)
      const effect = await readEffect(updateId, normalizedEffectId, streamId)
      if (
        update.value?.status !== UPDATE_STATUS_PROCESSING ||
        update.value.claimId !== normalizedClaimId ||
        Date.parse(update.value.leaseExpiresAt) <= currentTimestamp() ||
        effect.value?.status !== EFFECT_STATUS_PROCESSING ||
        effect.value.claimId !== normalizedClaimId
      ) {
        throw new TelegramUpdateClaimLostError(updateId)
      }
      await callRepository('set', key, marker)
    })
  }

  async function runUpdateEffect(updateId, claimId, effectId, handler, streamId, metadata = {}) {
    if (typeof handler !== 'function') throw new TypeError('Telegram update effect handler must be a function.')
    const claimed = await claimUpdateEffect(updateId, claimId, effectId, streamId, metadata)
    if (!claimed.claimed) {
      if (claimed.value.status === EFFECT_STATUS_COMPLETED) return effectResult(claimed.value)
      if (claimed.value.status === EFFECT_STATUS_FAILED) {
        throw new TelegramUpdateEffectFailedError(updateId, effectId, claimed.value.failure)
      }
      throw new TelegramUpdateEffectUncertainError(updateId, effectId)
    }

    let result
    try {
      result = await handler()
    } catch (error) {
      if (!hasCertainEffectFailure(error)) {
        throw new TelegramUpdateEffectUncertainError(updateId, effectId, error)
      }
      await finalizeUpdateEffect(updateId, claimId, effectId, streamId, {
        ...claimed.value,
        status: EFFECT_STATUS_FAILED,
        failedAt: new Date(currentTimestamp()).toISOString(),
        failure: effectFailure(error),
      })
      throw error
    }

    const hasResult = result !== undefined
    const storedResult = hasResult ? cloneSerializable(result, 'update effect result') : null
    try {
      await finalizeUpdateEffect(updateId, claimId, effectId, streamId, {
        ...claimed.value,
        status: EFFECT_STATUS_COMPLETED,
        completedAt: new Date(currentTimestamp()).toISOString(),
        hasResult,
        result: storedResult,
      })
    } catch (error) {
      throw new TelegramUpdateEffectUncertainError(updateId, effectId, error)
    }
    return hasResult ? cloneSerializable(storedResult, 'update effect result') : undefined
  }

  function startUpdateClaimRenewal(updateId, claimId, streamId, metadata) {
    const intervalMs = Math.max(1, Math.floor(leaseMs / 3))
    let stopped = false
    let timer = null
    let inFlight = Promise.resolve()
    let renewalError = null

    const schedule = () => {
      timer = setTimeout(() => {
        inFlight = renewUpdateClaim(updateId, claimId, streamId, metadata)
          .catch((error) => {
            renewalError = error
          })
          .finally(() => {
            if (!stopped && !renewalError) schedule()
          })
      }, intervalMs)
      timer.unref?.()
    }
    schedule()

    return async () => {
      stopped = true
      if (timer) clearTimeout(timer)
      await inFlight
      if (renewalError) throw renewalError
    }
  }

  async function runUpdate(updateId, handler, streamId = DEFAULT_STREAM_ID, metadata = {}) {
    if (typeof handler !== 'function') throw new TypeError('Telegram update handler must be a function.')
    const claim = await claimUpdate(updateId, streamId, metadata)
    if (claim.status === 'completed') return { status: 'completed', processed: false }
    if (claim.status === 'quarantined') {
      return {
        status: 'quarantined',
        processed: false,
        attempts: claim.attempts,
        failure: claim.failure,
      }
    }
    if (claim.status === 'in-progress') {
      throw new TelegramUpdateInProgressError(updateId, claim.leaseExpiresAt)
    }

    const stopRenewal = startUpdateClaimRenewal(updateId, claim.claimId, streamId, metadata)
    let value
    let failure = null
    try {
      value = await handler({
        updateId,
        claimId: claim.claimId,
        streamId,
        runEffect(effectId, effectHandler, effectMetadata = {}) {
          return runUpdateEffect(updateId, claim.claimId, effectId, effectHandler, streamId, effectMetadata)
        },
      })
    } catch (error) {
      failure = error
    }

    try {
      await stopRenewal()
    } catch (error) {
      failure ||= error
    }

    if (failure) {
      try {
        const final = await finalizeFailedUpdate(
          updateId,
          claim.claimId,
          claim.attempts,
          failure,
          streamId,
          metadata,
        )
        if (final.status === UPDATE_STATUS_QUARANTINED) {
          return {
            status: 'quarantined',
            processed: true,
            attempts: final.attempts,
            failure: final.failure,
          }
        }
      } catch (releaseError) {
        throw new TelegramUpdateReleaseError(updateId, failure, releaseError)
      }
      throw failure
    }

    await completeUpdate(updateId, claim.claimId, streamId, metadata)
    return { status: 'completed', processed: true, value }
  }

  return {
    async getSession(chatId, userId) {
      return readRecord(sessionKey(chatId, userId), SESSION_RECORD)
    },

    async setSession(chatId, userId, session) {
      if (!isRecord(session)) throw new TypeError('Telegram session must be an object.')
      const key = sessionKey(chatId, userId)
      const record = createRecord(SESSION_RECORD, session)
      await callRepository('set', key, record)
      return cloneSerializable(record.value, 'session value')
    },

    async clearSession(chatId, userId) {
      await callRepository('delete', sessionKey(chatId, userId))
    },

    async getOffset(streamId = DEFAULT_STREAM_ID) {
      const value = await readRecord(offsetKey(streamId), OFFSET_RECORD)
      if (value === null) return null
      return assertNonNegativeInteger(value, 'Stored Telegram offset')
    },

    async setOffset(offset, streamId = DEFAULT_STREAM_ID) {
      const value = assertNonNegativeInteger(offset, 'Telegram offset')
      await callRepository('set', offsetKey(streamId), createRecord(OFFSET_RECORD, value))
      return value
    },

    async hasProcessedUpdate(updateId, streamId = DEFAULT_STREAM_ID) {
      const update = await readUpdate(updateId, streamId)
      return update.value?.status === UPDATE_STATUS_COMPLETED
    },

    async markUpdateProcessed(updateId, streamId = DEFAULT_STREAM_ID, metadata = {}) {
      const key = updateKey(updateId, streamId)
      if (!isRecord(metadata)) throw new TypeError('Telegram update metadata must be an object.')
      const marker = createRecord(UPDATE_RECORD, {
        updateId,
        status: UPDATE_STATUS_COMPLETED,
        processedAt: new Date(currentTimestamp()).toISOString(),
        metadata,
      })
      return setIfAbsent(key, marker)
    },

    async clearProcessedUpdate(updateId, streamId = DEFAULT_STREAM_ID) {
      await callRepository('delete', updateKey(updateId, streamId))
    },

    claimUpdate,
    renewUpdateClaim,
    completeUpdate,
    releaseUpdateClaim,
    runUpdate,
  }
}
