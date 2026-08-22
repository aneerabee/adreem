import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENCIES, MOVEMENT_TYPES } from '../../src/ledger/ledgerCore.js'
import { createFallbackLedgerState } from '../../src/ledger/ledgerState.js'
import { appendTelegramMovement, telegramUpdateIdempotencyKey } from '../ledger/ledgerService.js'
import { createMemoryStateRepository } from './memoryStateRepository.js'
import {
  createPersistentTelegramState,
  InvalidTelegramStateError,
  TelegramStateRepositoryError,
  TelegramUpdateClaimLostError,
  TelegramUpdateInProgressError,
  TelegramUpdateReleaseError,
} from './persistentState.js'
import { processTelegramUpdates } from './updateSafety.js'
import { TelegramClientError } from './telegramClient.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function memoryLedgerRepository(initialState = createFallbackLedgerState()) {
  let state = initialState
  return {
    get state() {
      return state
    },
    async update(updater) {
      const result = await updater(state)
      if (result?.state) state = result.state
      return { ...result, state }
    },
  }
}

function createLeaseAwareRepository() {
  const records = new Map()
  return {
    async get(key) {
      return records.has(key) ? structuredClone(records.get(key)) : null
    },
    async set(key, value) {
      records.set(key, structuredClone(value))
    },
    async delete(key) {
      return records.delete(key)
    },
    async setIfAbsent(key, value) {
      if (records.has(key)) return false
      records.set(key, structuredClone(value))
      return true
    },
    async cleanExpired(now) {
      const timestamp = Date.parse(now)
      for (const [key, record] of records.entries()) {
        const leaseExpiresAt = Date.parse(record.value?.leaseExpiresAt)
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= timestamp) records.delete(key)
      }
    },
  }
}

function createAtomicLeaseRepositories(now = Date.now) {
  const records = new Map()

  function repository() {
    return {
      async get(key) {
        const record = records.get(key)
        if (!record || (record.expiresAt !== null && record.expiresAt <= now())) return null
        return structuredClone(record.payload)
      },
      async set(key, value) {
        records.set(key, { payload: structuredClone(value), expiresAt: null })
      },
      async delete(key) {
        return records.delete(key)
      },
      async setIfAbsent(key, value) {
        if (records.has(key)) return false
        records.set(key, { payload: structuredClone(value), expiresAt: null })
        return true
      },
      async claim(key, value, leaseMs, retentionMs) {
        const timestamp = now()
        const existing = records.get(key)
        if (records.has(key)) {
          const existingStatus = existing.payload.value?.status
          if (['completed', 'quarantined'].includes(existingStatus)) {
            return { claimed: false, payload: structuredClone(existing.payload) }
          }
          if (existingStatus === 'processing' && existing.expiresAt > timestamp) {
            return { claimed: false, payload: structuredClone(existing.payload) }
          }
          const attempts = Number(existing.payload.value?.attempts || 1)
          const maxAttempts = Number(value.value?.maxAttempts || 3)
          if (attempts >= maxAttempts) {
            const existingPayload = structuredClone(existing.payload)
            const retainedValue = Object.fromEntries(
              Object.entries(existingPayload.value).filter(([field]) => !['claimId', 'leaseExpiresAt'].includes(field)),
            )
            const payload = {
              ...existingPayload,
              value: {
                ...retainedValue,
                status: 'quarantined',
                quarantinedAt: new Date(timestamp).toISOString(),
                lastFailure: retainedValue.lastFailure || {
                  name: 'Error',
                  message: 'Telegram update exhausted its retry limit after an expired claim.',
                  code: 'TELEGRAM_UPDATE_ATTEMPTS_EXHAUSTED',
                  retryable: false,
                },
              },
            }
            records.set(key, { payload, expiresAt: timestamp + retentionMs })
            return { claimed: false, payload: structuredClone(payload) }
          }
          const payload = structuredClone(value)
          const expiresAt = timestamp + leaseMs
          payload.value.attempts = attempts + 1
          payload.value.leaseExpiresAt = new Date(expiresAt).toISOString()
          records.set(key, { payload, expiresAt })
          return { claimed: true, payload: structuredClone(payload) }
        }
        const payload = structuredClone(value)
        const expiresAt = timestamp + leaseMs
        payload.value.attempts = 1
        payload.value.leaseExpiresAt = new Date(expiresAt).toISOString()
        records.set(key, { payload, expiresAt })
        return { claimed: true, payload: structuredClone(payload) }
      },
      async renewClaim(key, claimToken, value, leaseMs) {
        const timestamp = now()
        const existing = records.get(key)
        if (
          !existing ||
          existing.expiresAt <= timestamp ||
          existing.payload.value?.status !== 'processing' ||
          existing.payload.value?.claimId !== claimToken
        ) {
          return { updated: false }
        }
        const payload = structuredClone(value)
        const expiresAt = timestamp + leaseMs
        payload.value.leaseExpiresAt = new Date(expiresAt).toISOString()
        records.set(key, { payload, expiresAt })
        return { updated: true, payload: structuredClone(payload) }
      },
      async completeClaim(key, claimToken, value) {
        const timestamp = now()
        const existing = records.get(key)
        if (
          !existing ||
          existing.expiresAt <= timestamp ||
          existing.payload.value?.status !== 'processing' ||
          existing.payload.value?.claimId !== claimToken
        ) {
          return false
        }
        records.set(key, { payload: structuredClone(value), expiresAt: timestamp + 60_000 })
        return true
      },
      async failClaim(key, claimToken, value, retentionMs) {
        const timestamp = now()
        const existing = records.get(key)
        if (
          !existing ||
          existing.expiresAt <= timestamp ||
          existing.payload.value?.status !== 'processing' ||
          existing.payload.value?.claimId !== claimToken
        ) {
          return false
        }
        records.set(key, { payload: structuredClone(value), expiresAt: timestamp + retentionMs })
        return true
      },
      async releaseClaim(key, claimToken) {
        const existing = records.get(key)
        if (
          !existing ||
          existing.payload.value?.status !== 'processing' ||
          existing.payload.value?.claimId !== claimToken
        ) {
          return false
        }
        records.delete(key)
        return true
      },
      async claimEffect(key, updateKey, claimToken, value, retentionMs) {
        const timestamp = now()
        const update = records.get(updateKey)
        if (
          !update ||
          update.expiresAt <= timestamp ||
          update.payload.value?.status !== 'processing' ||
          update.payload.value?.claimId !== claimToken
        ) {
          return { claimed: false }
        }
        const existing = records.get(key)
        if (existing) {
          if (existing.payload.value?.status === 'failed' && existing.payload.value?.failure?.retryable === true) {
            const payload = structuredClone(value)
            records.set(key, { payload, expiresAt: timestamp + retentionMs })
            return { claimed: true, payload: structuredClone(payload) }
          }
          return { claimed: false, payload: structuredClone(existing.payload) }
        }
        const payload = structuredClone(value)
        records.set(key, { payload, expiresAt: timestamp + retentionMs })
        return { claimed: true, payload: structuredClone(payload) }
      },
      async completeEffect(key, updateKey, claimToken, value, retentionMs) {
        const timestamp = now()
        const update = records.get(updateKey)
        const effect = records.get(key)
        if (
          !update ||
          update.expiresAt <= timestamp ||
          update.payload.value?.status !== 'processing' ||
          update.payload.value?.claimId !== claimToken ||
          !effect ||
          effect.payload.value?.status !== 'processing' ||
          effect.payload.value?.claimId !== claimToken
        ) {
          return false
        }
        records.set(key, { payload: structuredClone(value), expiresAt: timestamp + retentionMs })
        return true
      },
    }
  }

  return [repository(), repository()]
}

describe('persistent Telegram state', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists isolated session copies with unambiguous chat and user keys', async () => {
    const repository = createMemoryStateRepository()
    const firstStore = createPersistentTelegramState({ repository })
    const secondStore = createPersistentTelegramState({ repository })
    const firstSession = { flow: 'movement', draft: { amount: 20 } }

    await firstStore.setSession('1:2', '3', firstSession)
    await firstStore.setSession('1', '2:3', { flow: 'account' })
    firstSession.draft.amount = 999

    const loaded = await secondStore.getSession('1:2', '3')
    loaded.draft.amount = 500

    expect(await firstStore.getSession('1:2', '3')).toEqual({ flow: 'movement', draft: { amount: 20 } })
    expect(await firstStore.getSession('1', '2:3')).toEqual({ flow: 'account' })

    await secondStore.clearSession('1:2', '3')
    expect(await firstStore.getSession('1:2', '3')).toBeNull()
  })

  it('persists independent offsets for multiple update streams', async () => {
    const repository = createMemoryStateRepository()
    const state = createPersistentTelegramState({ repository })

    expect(await state.getOffset()).toBeNull()
    await state.setOffset(42)
    await state.setOffset(8, 'secondary-bot')

    const reloaded = createPersistentTelegramState({ repository })
    expect(await reloaded.getOffset()).toBe(42)
    expect(await reloaded.getOffset('secondary-bot')).toBe(8)
  })

  it('atomically records idempotent update markers and allows explicit removal', async () => {
    const repository = createMemoryStateRepository()
    const state = createPersistentTelegramState({ repository })

    const results = await Promise.all([
      state.markUpdateProcessed(100, 'poller', { source: 'message' }),
      state.markUpdateProcessed(100, 'poller', { source: 'callback' }),
    ])

    expect(results.sort()).toEqual([false, true])
    expect(await state.hasProcessedUpdate(100, 'poller')).toBe(true)
    expect(await state.hasProcessedUpdate(100, 'other-poller')).toBe(false)

    await state.clearProcessedUpdate(100, 'poller')
    expect(await state.hasProcessedUpdate(100, 'poller')).toBe(false)
    expect(await state.markUpdateProcessed(100, 'poller')).toBe(true)
  })

  it('atomically gives only one worker the update lease and keeps completion idempotent', async () => {
    const state = createPersistentTelegramState({ repository: createMemoryStateRepository() })

    const claims = await Promise.all([
      state.claimUpdate(101, 'poller'),
      state.claimUpdate(101, 'poller'),
    ])
    const claimed = claims.find((claim) => claim.status === 'claimed')

    expect(claims.map((claim) => claim.status).sort()).toEqual(['claimed', 'in-progress'])
    expect(await state.hasProcessedUpdate(101, 'poller')).toBe(false)

    await state.completeUpdate(101, claimed.claimId, 'poller', { source: 'message' })

    expect(await state.hasProcessedUpdate(101, 'poller')).toBe(true)
    expect(await state.claimUpdate(101, 'poller')).toEqual({ status: 'completed' })
  })

  it('does not advance the offset while another worker holds the update lease', async () => {
    const [firstRepository, secondRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository })
    const secondState = createPersistentTelegramState({ repository: secondRepository })
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const concurrentHandler = vi.fn()
    const committed = []
    const firstRun = firstState.runUpdate(102, async () => {
      firstStarted.resolve()
      await releaseFirst.promise
    })
    await firstStarted.promise

    await expect(processTelegramUpdates(
      [{ update_id: 102 }],
      (update) => secondState.runUpdate(update.update_id, concurrentHandler),
      (offset) => committed.push(offset),
    )).rejects.toBeInstanceOf(TelegramUpdateInProgressError)

    expect(committed).toEqual([])
    expect(concurrentHandler).not.toHaveBeenCalled()

    releaseFirst.resolve()
    await firstRun
    await processTelegramUpdates(
      [{ update_id: 102 }],
      (update) => secondState.runUpdate(update.update_id, concurrentHandler),
      (offset) => committed.push(offset),
    )

    expect(committed).toEqual([103])
    expect(concurrentHandler).not.toHaveBeenCalled()
  })

  it('releases a failed update claim so the same update can be retried immediately', async () => {
    const state = createPersistentTelegramState({ repository: createMemoryStateRepository() })
    const failure = new Error('handler failed')

    await expect(state.runUpdate(103, async () => { throw failure })).rejects.toBe(failure)
    expect(await state.hasProcessedUpdate(103)).toBe(false)

    const retry = await state.runUpdate(103, async () => 'retried')
    expect(retry).toMatchObject({ status: 'completed', processed: true, value: 'retried' })
    expect(await state.hasProcessedUpdate(103)).toBe(true)
  })

  it('allows a new atomic claim after the short processing lease expires', async () => {
    const clock = { value: Date.parse('2026-08-20T10:00:00.000Z') }
    const state = createPersistentTelegramState({
      repository: createLeaseAwareRepository(),
      updateLeaseMs: 100,
      now: () => clock.value,
    })

    const first = await state.claimUpdate(104)
    clock.value += 101
    const second = await state.claimUpdate(104)

    expect(first.status).toBe('claimed')
    expect(second.status).toBe('claimed')
    expect(second.claimId).not.toBe(first.claimId)
  })

  it('renews the claim while processing longer than the original lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T10:00:00.000Z')
    const [firstRepository, secondRepository] = createAtomicLeaseRepositories(Date.now)
    const firstState = createPersistentTelegramState({ repository: firstRepository, updateLeaseMs: 90 })
    const secondState = createPersistentTelegramState({ repository: secondRepository, updateLeaseMs: 90 })
    const started = deferred()
    const handler = vi.fn(async () => {
      started.resolve()
      await new Promise((resolve) => setTimeout(resolve, 250))
      return 'finished'
    })

    const running = firstState.runUpdate(105, handler)
    await started.promise
    await vi.advanceTimersByTimeAsync(120)

    const competingClaim = await secondState.claimUpdate(105)
    expect(competingClaim.status).toBe('in-progress')

    await vi.advanceTimersByTimeAsync(150)
    await expect(running).resolves.toMatchObject({ processed: true, value: 'finished' })
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(secondState.claimUpdate(105)).resolves.toEqual({ status: 'completed' })
  })

  it('allows takeover after an unrenewed lease and fences stale completion and release', async () => {
    const clock = { value: Date.parse('2026-08-20T10:00:00.000Z') }
    const claimIds = ['old-claim', 'new-claim']
    const [firstRepository, secondRepository] = createAtomicLeaseRepositories(() => clock.value)
    const firstState = createPersistentTelegramState({
      repository: firstRepository,
      updateLeaseMs: 100,
      now: () => clock.value,
      claimIdFactory: () => claimIds.shift() || 'observer-claim',
    })
    const secondState = createPersistentTelegramState({
      repository: secondRepository,
      updateLeaseMs: 100,
      now: () => clock.value,
      claimIdFactory: () => claimIds.shift() || 'observer-claim',
    })

    const first = await firstState.claimUpdate(106)
    clock.value += 101
    const second = await secondState.claimUpdate(106)

    await expect(firstState.completeUpdate(106, first.claimId)).rejects.toBeInstanceOf(TelegramUpdateClaimLostError)
    await expect(firstState.releaseUpdateClaim(106, first.claimId)).resolves.toBe(false)
    await expect(firstState.claimUpdate(106)).resolves.toMatchObject({
      status: 'in-progress',
      claimId: second.claimId,
    })

    await secondState.completeUpdate(106, second.claimId)
    await expect(firstState.hasProcessedUpdate(106)).resolves.toBe(true)
  })

  it('does not let an expired owner complete or revive its lease before takeover', async () => {
    const clock = { value: Date.parse('2026-08-20T10:00:00.000Z') }
    const [repository] = createAtomicLeaseRepositories(() => clock.value)
    const state = createPersistentTelegramState({
      repository,
      updateLeaseMs: 100,
      now: () => clock.value,
      claimIdFactory: () => 'expired-claim',
    })
    const claim = await state.claimUpdate(107)
    clock.value += 101

    await expect(state.renewUpdateClaim(107, claim.claimId)).rejects.toBeInstanceOf(TelegramUpdateClaimLostError)
    await expect(state.completeUpdate(107, claim.claimId)).rejects.toBeInstanceOf(TelegramUpdateClaimLostError)
    await expect(state.hasProcessedUpdate(107)).resolves.toBe(false)
  })

  it('extends a lease explicitly and keeps the same fencing token', async () => {
    const clock = { value: Date.parse('2026-08-20T10:00:00.000Z') }
    const [repository] = createAtomicLeaseRepositories(() => clock.value)
    const state = createPersistentTelegramState({
      repository,
      updateLeaseMs: 100,
      now: () => clock.value,
      claimIdFactory: () => 'renewed-claim',
    })

    const claim = await state.claimUpdate(110)
    clock.value += 80
    const renewed = await state.renewUpdateClaim(110, claim.claimId)
    clock.value += 80
    const duplicate = await state.claimUpdate(110)

    expect(renewed).toMatchObject({ status: 'renewed', claimId: claim.claimId })
    expect(duplicate).toMatchObject({ status: 'in-progress', claimId: claim.claimId })
  })

  it('releases the claim when lease renewal fails so a restart can retry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T10:00:00.000Z')
    const [repository, restartedRepository] = createAtomicLeaseRepositories(Date.now)
    const originalRenewClaim = repository.renewClaim
    let failRenewal = true
    repository.renewClaim = async (...args) => {
      if (failRenewal) {
        failRenewal = false
        throw new Error('renewal unavailable')
      }
      return originalRenewClaim(...args)
    }
    const state = createPersistentTelegramState({ repository, updateLeaseMs: 90 })
    const started = deferred()
    const running = state.runUpdate(108, async () => {
      started.resolve()
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    const rejected = expect(running).rejects.toMatchObject({
      name: 'TelegramStateRepositoryError',
      operation: 'renewClaim',
    })

    await started.promise
    await vi.advanceTimersByTimeAsync(90)
    await rejected

    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    await expect(restartedState.runUpdate(108, async () => 'retried')).resolves.toMatchObject({
      processed: true,
      value: 'retried',
    })
  })

  it('persists retry attempts across restarts and quarantines at the configured limit', async () => {
    const [firstRepository, restartedRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository, maxUpdateAttempts: 3 })
    const secondState = createPersistentTelegramState({ repository: restartedRepository, maxUpdateAttempts: 3 })
    const thirdState = createPersistentTelegramState({ repository: restartedRepository, maxUpdateAttempts: 3 })
    const failure = new Error('database temporarily unavailable')

    await expect(firstState.runUpdate(114, async () => { throw failure })).rejects.toBe(failure)
    await expect(secondState.runUpdate(114, async () => { throw failure })).rejects.toBe(failure)
    await expect(thirdState.runUpdate(114, async () => { throw failure })).resolves.toMatchObject({
      status: 'quarantined',
      processed: true,
      attempts: 3,
      failure: { message: failure.message },
    })

    const duplicateHandler = vi.fn()
    await expect(firstState.runUpdate(114, duplicateHandler)).resolves.toMatchObject({
      status: 'quarantined',
      processed: false,
      attempts: 3,
    })
    expect(duplicateHandler).not.toHaveBeenCalled()
  })

  it('does not report terminal proof when releasing a failed claim cannot be persisted', async () => {
    const [repository] = createAtomicLeaseRepositories()
    const releaseFailure = new Error('claim transition unavailable')
    repository.failClaim = vi.fn(async () => { throw releaseFailure })
    const state = createPersistentTelegramState({ repository })
    const handlerFailure = new Error('handler failed')

    await expect(state.runUpdate(115, async () => { throw handlerFailure })).rejects.toMatchObject({
      name: 'TelegramUpdateReleaseError',
      cause: handlerFailure,
      releaseError: expect.objectContaining({
        name: 'TelegramStateRepositoryError',
        operation: 'failClaim',
        cause: releaseFailure,
      }),
    })
  })

  it('retries a certainly failed Telegram effect after restart using the same CAS record', async () => {
    const [firstRepository, restartedRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository })
    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const temporaryFailure = new TelegramClientError('Telegram sendMessage failed: 500', {
      method: 'sendMessage',
      status: 500,
    })
    const externalEffect = vi.fn()
      .mockRejectedValueOnce(temporaryFailure)
      .mockResolvedValueOnce({ message_id: 116 })

    await expect(firstState.runUpdate(116, (execution) => execution.runEffect('send-result', externalEffect)))
      .rejects.toBe(temporaryFailure)
    await expect(restartedState.runUpdate(116, (execution) => execution.runEffect('send-result', externalEffect)))
      .resolves.toMatchObject({ status: 'completed', processed: true })
    expect(externalEffect).toHaveBeenCalledTimes(2)
  })

  it('quarantines a permanent Telegram failure on its first attempt', async () => {
    const [repository, restartedRepository] = createAtomicLeaseRepositories()
    const state = createPersistentTelegramState({ repository })
    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const permanentFailure = new TelegramClientError('Telegram sendMessage failed: 403', {
      method: 'sendMessage',
      status: 403,
    })
    const externalEffect = vi.fn(async () => { throw permanentFailure })

    await expect(state.runUpdate(117, (execution) => execution.runEffect('send-result', externalEffect)))
      .resolves.toMatchObject({ status: 'quarantined', processed: true, attempts: 1 })
    await expect(restartedState.runUpdate(117, externalEffect))
      .resolves.toMatchObject({ status: 'quarantined', processed: false, attempts: 1 })
    expect(externalEffect).toHaveBeenCalledTimes(1)
  })

  it('keeps completed updates idempotent after a state runtime restart', async () => {
    const [firstRepository, restartedRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository })
    await firstState.runUpdate(109, async () => 'first')

    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const handler = vi.fn()
    await expect(restartedState.runUpdate(109, handler)).resolves.toEqual({
      status: 'completed',
      processed: false,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('retries after a crash without duplicating the ledger movement, attachment, or message effect', async () => {
    const [firstRepository, restartedRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository })
    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const ledger = memoryLedgerRepository()
    const uploadAttachment = vi.fn(async () => ({
      label: 'receipt.pdf',
      storagePath: 'owner/ledger/receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    }))
    const sendMessage = vi.fn(async () => ({ message_id: 91 }))
    const idempotencyKey = telegramUpdateIdempotencyKey(111, 'movement-create')
    const processAction = async (execution, crash) => {
      const uploaded = await execution.runEffect('ledger-attachment-upload', uploadAttachment, { kind: 'attachment-upload' })
      const saved = await appendTelegramMovement(ledger, {
        type: MOVEMENT_TYPES.EXPENSE,
        amount: 75,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        note: 'receipt durability',
        attachmentLabel: uploaded.label,
        attachmentStoragePath: uploaded.storagePath,
        attachmentMimeType: uploaded.mimeType,
        attachmentSizeBytes: uploaded.sizeBytes,
        attachmentIdempotencyKey: telegramUpdateIdempotencyKey(111, 'movement-create-attachment'),
      }, {
        idempotencyKey,
        telegramUserId: 1,
        telegramChatId: 1,
      })
      await execution.runEffect('telegram-sendMessage-result', sendMessage, { method: 'sendMessage' })
      if (crash) throw new Error('crash after action before complete')
      return saved
    }

    await expect(firstState.runUpdate(111, (execution) => processAction(execution, true)))
      .rejects.toThrow('crash after action before complete')
    await expect(restartedState.runUpdate(111, (execution) => processAction(execution, false)))
      .resolves.toMatchObject({ status: 'completed', processed: true })

    expect(uploadAttachment).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(ledger.state.movements.filter((movement) => movement.idempotencyKey === idempotencyKey)).toHaveLength(1)
    expect(ledger.state.attachments.filter((attachment) => attachment.idempotencyKey.endsWith('-attachment'))).toHaveLength(1)
    expect(ledger.state.auditEvents.filter((event) => event.action === 'movement.created')).toHaveLength(1)
  })

  it('fences a stale worker from completing an effect after lease takeover', async () => {
    const clock = { value: Date.parse('2026-08-20T10:00:00.000Z') }
    const [firstRepository, secondRepository] = createAtomicLeaseRepositories(() => clock.value)
    const firstState = createPersistentTelegramState({ repository: firstRepository, updateLeaseMs: 100, now: () => clock.value })
    const secondState = createPersistentTelegramState({ repository: secondRepository, updateLeaseMs: 100, now: () => clock.value })
    const effectStarted = deferred()
    const releaseEffect = deferred()
    const externalEffect = vi.fn(async () => {
      effectStarted.resolve()
      await releaseEffect.promise
      return { message_id: 92 }
    })
    const firstRun = firstState.runUpdate(112, async (execution) => {
      await execution.runEffect('slow-message', externalEffect)
    })
    await effectStarted.promise
    clock.value += 101

    await expect(secondState.runUpdate(112, (execution) => execution.runEffect('slow-message', externalEffect)))
      .resolves.toMatchObject({ status: 'quarantined', processed: true, attempts: 2 })
    releaseEffect.resolve()
    await expect(firstRun).rejects.toBeInstanceOf(TelegramUpdateReleaseError)

    expect(externalEffect).toHaveBeenCalledTimes(1)
    expect(await firstState.hasProcessedUpdate(112)).toBe(false)
  })

  it('quarantines an uncertain external effect and refuses to execute it after restart', async () => {
    const [firstRepository, restartedRepository] = createAtomicLeaseRepositories()
    const firstState = createPersistentTelegramState({ repository: firstRepository })
    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const externalEffect = vi.fn(async () => {
      throw new Error('Telegram rejected the message')
    })

    await expect(firstState.runUpdate(113, (execution) => execution.runEffect('send-result', externalEffect)))
      .resolves.toMatchObject({ status: 'quarantined', processed: true, attempts: 1 })
    await expect(restartedState.runUpdate(113, (execution) => execution.runEffect('send-result', externalEffect)))
      .resolves.toMatchObject({ status: 'quarantined', processed: false, attempts: 1 })

    expect(externalEffect).toHaveBeenCalledTimes(1)
    expect(await firstState.hasProcessedUpdate(113)).toBe(false)
  })

  it('quarantines a successful external effect when recording its result fails', async () => {
    const [repository, restartedRepository] = createAtomicLeaseRepositories()
    const completionFailure = new Error('effect completion unavailable')
    repository.completeEffect = vi.fn(async () => { throw completionFailure })
    const state = createPersistentTelegramState({ repository })
    const restartedState = createPersistentTelegramState({ repository: restartedRepository })
    const externalEffect = vi.fn(async () => ({ message_id: 118 }))

    await expect(state.runUpdate(118, (execution) => execution.runEffect('send-result', externalEffect)))
      .resolves.toMatchObject({
        status: 'quarantined',
        processed: true,
        attempts: 1,
        failure: { code: 'TELEGRAM_UPDATE_EFFECT_UNCERTAIN' },
      })
    await expect(restartedState.runUpdate(118, externalEffect))
      .resolves.toMatchObject({ status: 'quarantined', processed: false })
    expect(externalEffect).toHaveBeenCalledTimes(1)
  })

  it('isolates state namespaces sharing the same repository', async () => {
    const repository = createMemoryStateRepository()
    const first = createPersistentTelegramState({ repository, namespace: 'first' })
    const second = createPersistentTelegramState({ repository, namespace: 'second' })

    await first.setSession(1, 2, { flow: 'first' })

    expect(await first.getSession(1, 2)).toEqual({ flow: 'first' })
    expect(await second.getSession(1, 2)).toBeNull()
  })

  it('rejects incomplete repositories and invalid state values clearly', async () => {
    expect(() => createPersistentTelegramState({ repository: {} }))
      .toThrow('Telegram state repository must implement async get().')

    const state = createPersistentTelegramState({ repository: createMemoryStateRepository() })
    await expect(state.setOffset(-1)).rejects.toThrow('Telegram offset must be a non-negative safe integer.')
    await expect(state.setSession(1, 2, null)).rejects.toThrow('Telegram session must be an object.')

    const circularSession = { flow: 'movement' }
    circularSession.self = circularSession
    await expect(state.setSession(1, 2, circularSession)).rejects.toThrow('session value must be JSON-serializable.')
  })

  it('reports repository failures with the operation, key, and original cause', async () => {
    const cause = new Error('database unavailable')
    const repository = {
      async get() { throw cause },
      async set() {},
      async delete() {},
      async setIfAbsent() { return true },
    }
    const state = createPersistentTelegramState({ repository })

    await expect(state.getSession(1, 2)).rejects.toMatchObject({
      name: 'TelegramStateRepositoryError',
      operation: 'get',
      cause,
    })
    await expect(state.getSession(1, 2)).rejects.toBeInstanceOf(TelegramStateRepositoryError)
  })

  it('rejects malformed records returned by an adapter', async () => {
    const repository = {
      async get() { return { value: { flow: 'movement' } } },
      async set() {},
      async delete() {},
      async setIfAbsent() { return true },
    }
    const state = createPersistentTelegramState({ repository })

    await expect(state.getSession(1, 2)).rejects.toBeInstanceOf(InvalidTelegramStateError)
  })
})
