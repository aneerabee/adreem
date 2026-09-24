import { useEffect } from 'react'
import { completeAccountCurrencies } from './accountCurrencyUpgrade'
import { getLedgerPersistenceMode, loadPersistedLedgerState } from './ledgerPersistence'
import { normalizeLedgerState, normalizeLedgerAccounts } from './ledgerState'
import { rememberUiLanguage } from './uiTranslation'
import { ledgerExtrasFromState } from './ledgerAppState'

export function useLedgerHydration({
  canPersist,
  initialState,
  isHydrated,
  setAccounts,
  setCanManageUsers,
  setCanPersist,
  setFeedback,
  setIsHydrated,
  setLedgerExtras,
  setLedgerRevision,
  setLedgerStorageMode,
  setLoadFailed,
  setMovementPage,
  setMovements,
  setSaveStatus,
  setServerReports,
  setStorageMode,
  setSyncProblem,
  setUiLanguage,
  setUserProfile,
}) {
  useEffect(() => {
    let cancelled = false

    async function hydrateLedger() {
      const result = await loadPersistedLedgerState(initialState)
      if (cancelled) return
      if (result.error?.status === 401 && getLedgerPersistenceMode() !== 'api' && typeof window !== 'undefined') {
        window.location.reload()
        return
      }
      const normalizedState = normalizeLedgerState(result.state, initialState)
      setStorageMode(result.mode)
      setLedgerStorageMode(result.storageMode || 'legacy')
      setLedgerRevision(Number.isSafeInteger(Number(result.revision)) ? Number(result.revision) : null)
      setCanManageUsers(Boolean(result.access?.canManageUsers))
      setUserProfile(result.profile || null)
      if (result.profile?.language) {
        const nextLanguage = rememberUiLanguage(result.profile.language)
        setUiLanguage(nextLanguage)
      }
      setLedgerExtras(ledgerExtrasFromState(normalizedState))
      setAccounts(normalizeLedgerAccounts(normalizedState.accounts))
      setMovements(normalizedState.movements)
      setMovementPage({
        ...(result.movementPage || {}),
        hasMore: Boolean(result.movementPage?.hasMore),
        nextCursor: result.movementPage?.nextCursor || null,
        loaded: normalizedState.movements.length,
      })
      setServerReports(result.reports || null)
      setSaveStatus(result.loadError ? 'local-only' : 'saved')
      setLoadFailed(Boolean(result.loadError))
      setSyncProblem(Boolean(result.loadError))
      setCanPersist(!result.loadError && result.mode !== 'api-missing-token')
      setIsHydrated(true)
      if (result.loadError) {
        setFeedback(result.mode === 'api-missing-token' ? 'رابط الدفتر ناقص. افتح الرابط الخاص أو صفحة الإدارة.' : 'السحابة غير جاهزة الآن. لم يتم استخدام أي نسخة محلية.')
      }
    }

    hydrateLedger()
    return () => {
      cancelled = true
    }
  }, [initialState, setAccounts, setCanManageUsers, setCanPersist, setFeedback, setIsHydrated, setLedgerExtras, setLedgerRevision, setLedgerStorageMode, setLoadFailed, setMovementPage, setMovements, setSaveStatus, setServerReports, setStorageMode, setSyncProblem, setUiLanguage, setUserProfile])

  useEffect(() => {
    if (!isHydrated || !canPersist) return undefined
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setAccounts((current) => completeAccountCurrencies(current))
    })
    return () => { cancelled = true }
  }, [isHydrated, canPersist, setAccounts])
}
