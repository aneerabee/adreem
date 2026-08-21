const DEFAULT_RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000]

export function createLatestSaveCoordinator({
  save,
  onStatus = () => {},
  onSaved = () => {},
  onError = () => {},
  shouldRetry = (error) => error?.retryable !== false,
  retryDelays = DEFAULT_RETRY_DELAYS,
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancelSchedule = (timer) => window.clearTimeout(timer),
}) {
  let sequence = 0
  let pending = null
  let running = false
  let stopped = false
  let retryIndex = 0
  let retryTimer = null
  let failed = null

  function clearRetryTimer() {
    if (retryTimer === null) return
    cancelSchedule(retryTimer)
    retryTimer = null
  }

  async function run(retryItem = null) {
    if (stopped || running || failed || (!retryItem && !pending)) return
    const item = retryItem || pending
    if (!retryItem) pending = null
    running = true
    onStatus('saving')

    try {
      const result = await save(item.value)
      running = false
      retryIndex = 0
      onSaved(result, item)
      if (pending) {
        void run()
      } else {
        onStatus('saved')
      }
    } catch (error) {
      running = false
      if (!shouldRetry(error)) {
        failed = item
        onError(error, item, null)
        onStatus('failed')
        return
      }
      if (!pending || pending.id < item.id) pending = item
      const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)] || 30_000
      const retryDelay = Math.max(delay, Number(error?.retryAfterMs || 0))
      retryIndex += 1
      onError(error, item, retryDelay)
      onStatus('retrying')
      retryTimer = schedule(() => {
        retryTimer = null
        void run()
      }, retryDelay)
    }
  }

  return {
    submit(value) {
      if (stopped || failed) return 0
      const item = { id: sequence + 1, value }
      sequence = item.id
      pending = item
      if (retryTimer !== null) {
        clearRetryTimer()
        retryIndex = 0
      }
      void run()
      return item.id
    },
    retryNow() {
      if (stopped) return
      clearRetryTimer()
      if (failed) {
        const item = failed
        failed = null
        void run(item)
        return
      }
      void run()
    },
    discardFailed() {
      if (stopped || running || !failed) return false
      failed = null
      pending = null
      retryIndex = 0
      clearRetryTimer()
      return true
    },
    hasPending() {
      return !stopped && (running || Boolean(pending) || Boolean(failed) || retryTimer !== null)
    },
    stop() {
      stopped = true
      pending = null
      failed = null
      clearRetryTimer()
    },
  }
}
