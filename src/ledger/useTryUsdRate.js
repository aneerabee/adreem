import { useEffect, useState } from 'react'
import { investmentFxRateIsFresh, microsToUsd, usdToMicros } from './investmentCore.js'
import { blankTryFx } from './investmentFormat'

// rateKey is empty while no lira rate is needed; a new key loads a fresh rate.
export function useTryUsdRate(rateKey, onLoadTryUsdRate) {
  const [tryFx, setTryFx] = useState(blankTryFx)
  const [tryFxReloadKey, setTryFxReloadKey] = useState(0)

  useEffect(() => {
    if (!rateKey) return undefined
    let active = true
    setTryFx({ ...blankTryFx, status: 'loading' })
    async function loadRate() {
      try {
        if (typeof onLoadTryUsdRate !== 'function') throw new Error('سعر الصرف غير متاح. اكتب السعر الفعلي.')
        const result = await onLoadTryUsdRate()
        if (!active) return
        if (!Number.isSafeInteger(result?.tryPerUsdMicros) || result.tryPerUsdMicros <= 0 || !result.quotedAt) {
          throw new Error('سعر الصرف غير صالح. اكتب السعر الفعلي.')
        }
        setTryFx((current) => current.source === 'manual' ? current : {
          status: tryFxReloadKey ? 'updated' : 'ready', rate: String(microsToUsd(result.tryPerUsdMicros)),
          quotedAt: result.quotedAt, loadedAt: new Date().toISOString(), source: result.source, error: '',
        })
      } catch (error) {
        if (active) setTryFx((current) => current.source === 'manual' ? current : {
          ...blankTryFx, status: 'error', error: error?.message || 'تعذر جلب سعر الصرف. اكتب السعر الفعلي.',
        })
      }
    }
    void loadRate()
    return () => { active = false }
  }, [rateKey, onLoadTryUsdRate, tryFxReloadKey])

  function changeTryFxRate(rate) {
    setTryFx({ status: 'ready', rate, quotedAt: new Date().toISOString(), loadedAt: '', source: 'manual', error: '' })
  }

  function tryFxIsReadyForSave() {
    if (investmentFxRateIsFresh(tryFx)) return true
    setTryFx((current) => ({ ...current, status: 'loading' }))
    setTryFxReloadKey((current) => current + 1)
    return false
  }

  function resetTryFxReload() {
    setTryFxReloadKey(0)
  }

  return { tryFx, changeTryFxRate, tryFxIsReadyForSave, resetTryFxReload }
}

export function tryFxIsUsable(tryFx) {
  return usdToMicros(tryFx?.rate) > 0 && Boolean(tryFx?.quotedAt) && !['loading', 'error'].includes(tryFx?.status)
}
