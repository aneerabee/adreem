import { describe, expect, it, vi } from 'vitest'
import { createLatestSaveCoordinator } from './cloudSaveCoordinator'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('latest cloud save coordinator', () => {
  it('serializes saves and coalesces rapid changes to the latest state', async () => {
    const first = deferred()
    const second = deferred()
    const save = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const saved = []
    const coordinator = createLatestSaveCoordinator({
      save,
      onSaved: (_result, item) => saved.push(item.value.version),
    })

    coordinator.submit({ version: 1 })
    coordinator.submit({ version: 2 })
    coordinator.submit({ version: 3 })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toEqual({ version: 1 })

    first.resolve({ ok: true })
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toEqual({ version: 3 })

    second.resolve({ ok: true })
    await settle()
    expect(saved).toEqual([1, 3])
    expect(coordinator.hasPending()).toBe(false)
  })

  it('keeps the latest unsaved state and retries automatically after failure', async () => {
    const scheduled = []
    const statuses = []
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true })
    const coordinator = createLatestSaveCoordinator({
      save,
      retryDelays: [10],
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
      cancelSchedule: vi.fn(),
      onStatus: (status) => statuses.push(status),
    })

    coordinator.submit({ version: 1 })
    coordinator.submit({ version: 2 })
    await settle()

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].delay).toBe(10)
    expect(coordinator.hasPending()).toBe(true)

    scheduled[0].callback()
    await settle()

    expect(save.mock.calls.map(([state]) => state.version)).toEqual([1, 2])
    expect(statuses).toContain('retrying')
    expect(statuses.at(-1)).toBe('saved')
    expect(coordinator.hasPending()).toBe(false)
  })

  it('cancels pending retries when stopped', async () => {
    const cancelSchedule = vi.fn()
    const coordinator = createLatestSaveCoordinator({
      save: vi.fn().mockRejectedValue(new Error('offline')),
      schedule: vi.fn(() => 91),
      cancelSchedule,
    })

    coordinator.submit({ version: 1 })
    await settle()
    coordinator.stop()

    expect(cancelSchedule).toHaveBeenCalledWith(91)
    expect(coordinator.hasPending()).toBe(false)
  })
})
