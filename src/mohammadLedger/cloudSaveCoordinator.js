const DEFAULT_RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000]

export function createLatestSaveCoordinator({
  save,
  onStatus = () => {},
  onSaved = () => {},
  onError = () => {},
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

  function clearRetryTimer() {
    if (retryTimer === null) return
    cancelSchedule(retryTimer)
    retryTimer = null
  }

  async function run() {
    if (stopped || running || !pending) return
    const item = pending
    pending = null
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
      if (!pending || pending.id < item.id) pending = item
      const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)] || 30_000
      retryIndex += 1
      onError(error, item, delay)
      onStatus('retrying')
      retryTimer = schedule(() => {
        retryTimer = null
        void run()
      }, delay)
    }
  }

  return {
    submit(value) {
      if (stopped) return 0
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
      void run()
    },
    hasPending() {
      return !stopped && (running || Boolean(pending) || retryTimer !== null)
    },
    stop() {
      stopped = true
      pending = null
      clearRetryTimer()
    },
  }
}
