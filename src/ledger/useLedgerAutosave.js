import { useCallback, useEffect, useLayoutEffect } from 'react'
import { cleanupAdreemUploadedAttachments, getLedgerPersistenceMode, savePersistedLedgerState } from './ledgerPersistence'
import { createLatestSaveCoordinator } from './cloudSaveCoordinator'
import { normalizeLedgerState, normalizeLedgerAccounts, sameSerializableContent } from './ledgerState'
import { ledgerExtrasFromState, pendingUploadedOrphanPaths, sameLedgerExtras, saveFailureMessage } from './ledgerAppState'

export function useLedgerAutosave({
  accounts,
  canPersist,
  hasHydratedSnapshotRef,
  isHydrated,
  ledgerExtras,
  motionTimerRef,
  movements,
  orphanCleanupInProgressRef,
  pendingUploadedAttachmentPathsRef,
  saveCoordinatorRef,
  setAccounts,
  setFeedback,
  setLedgerExtras,
  setLedgerRevision,
  setLedgerStorageMode,
  setMovementPage,
  setMovements,
  setSaveStatus,
  setServerReports,
  setStorageMode,
  setSyncProblem,
  viewTransitionRef,
}) {
  // Uses only refs and state setters, so its identity stays stable across renders.
  const cleanupPermanentUploadedAttachments = useCallback(async (item, coordinator) => {
    if (orphanCleanupInProgressRef.current) return
    const storagePaths = pendingUploadedOrphanPaths(
      item?.value,
      Array.from(pendingUploadedAttachmentPathsRef.current),
    )
    if (!storagePaths.length) return
    orphanCleanupInProgressRef.current = true
    try {
      const result = await cleanupAdreemUploadedAttachments(storagePaths)
      const deletedPaths = new Set(result.deletedPaths)
      if (!deletedPaths.size) return
      for (const storagePath of deletedPaths) pendingUploadedAttachmentPathsRef.current.delete(storagePath)
      coordinator?.discardFailed()
      setLedgerExtras((current) => ({
        ...current,
        attachments: (current.attachments || []).filter((attachment) => !deletedPaths.has(attachment.storagePath)),
      }))
      setFeedback(result.failedPaths.length
        ? 'لم يتم تأكيد الحفظ. نُظفت بعض المرفقات غير المرتبطة وستُحفظ بقية التغييرات من جديد.'
        : 'لم يتم تأكيد الحفظ. نُظفت المرفقات غير المرتبطة وستُحفظ بقية التغييرات من جديد.')
    } finally {
      orphanCleanupInProgressRef.current = false
    }
  }, [orphanCleanupInProgressRef, pendingUploadedAttachmentPathsRef, setFeedback, setLedgerExtras])

  useLayoutEffect(() => {
    if (!isHydrated || !canPersist) return
    if (!saveCoordinatorRef.current) {
      let coordinator = null
      coordinator = createLatestSaveCoordinator({
        async save(snapshot) {
          const result = await savePersistedLedgerState(snapshot)
          const cloudMode = result.mode === 'supabase' || result.mode === 'api' || result.mode === 'api-missing-token'
          if (cloudMode && !result.supabaseOk) {
            const error = result.error || new Error('Cloud save was not confirmed.')
            error.persistenceResult = result
            throw error
          }
          return result
        },
        onStatus(status) {
          setSaveStatus(status)
        },
        onSaved(result, item) {
          if (result.stale) return
          const confirmedAttachmentPaths = new Set(
            (result.state?.attachments || [])
              .map((attachment) => String(attachment?.storagePath || '').trim())
              .filter(Boolean),
          )
          for (const storagePath of pendingUploadedAttachmentPathsRef.current) {
            if (confirmedAttachmentPaths.has(storagePath)) pendingUploadedAttachmentPathsRef.current.delete(storagePath)
          }
          setStorageMode(result.mode)
          setLedgerStorageMode(result.storageMode || 'legacy')
          if (Number.isSafeInteger(Number(result.revision))) setLedgerRevision(Number(result.revision))
          if (result.movementPage) {
            setMovementPage((current) => ({
              ...current,
              ...result.movementPage,
              loaded: result.state?.movements?.length || current.loaded,
            }))
          }
          if (result.reports) setServerReports(result.reports)
          setSyncProblem(false)
          if (!coordinator?.hasPending()) setFeedback('تم حفظ التغيير في السحابة.')
          if (!result.state || coordinator?.hasPending()) return
          const normalizedState = normalizeLedgerState(result.state, item.value)
          const nextExtras = ledgerExtrasFromState(normalizedState)
          const mergedAccounts = normalizeLedgerAccounts(normalizedState.accounts)
          const mergedMovements = normalizedState.movements || []
          setLedgerExtras((current) => (sameLedgerExtras(current, nextExtras) ? current : nextExtras))
          setAccounts((current) => (sameSerializableContent(current, mergedAccounts) ? current : mergedAccounts))
          setMovements((current) => (sameSerializableContent(current, mergedMovements) ? current : mergedMovements))
        },
        onError(error, item, retryDelay) {
          console.warn('[adreem-ledger] cloud save failed:', error?.message || error)
          setStorageMode(error?.persistenceResult?.mode || getLedgerPersistenceMode())
          setSyncProblem(true)
          setFeedback(saveFailureMessage(error, retryDelay))
          if (retryDelay === null) void cleanupPermanentUploadedAttachments(item, coordinator)
        },
      })
      saveCoordinatorRef.current = coordinator
    }

    if (!hasHydratedSnapshotRef.current) {
      hasHydratedSnapshotRef.current = true
      return
    }
    const submissionId = saveCoordinatorRef.current.submit({ ...ledgerExtras, accounts, movements })
    if (!submissionId) setSaveStatus('failed')
  }, [accounts, movements, ledgerExtras, isHydrated, canPersist, saveCoordinatorRef, hasHydratedSnapshotRef, setSaveStatus, setStorageMode, setLedgerStorageMode, setLedgerRevision, setServerReports, setSyncProblem, setFeedback, setLedgerExtras, setAccounts, setMovements, pendingUploadedAttachmentPathsRef, setMovementPage, cleanupPermanentUploadedAttachments])

  useEffect(() => {
    function warnBeforeClose(event) {
      if (!saveCoordinatorRef.current?.hasPending() && !pendingUploadedAttachmentPathsRef.current.size) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [pendingUploadedAttachmentPathsRef, saveCoordinatorRef])

  useEffect(
    () => () => {
      saveCoordinatorRef.current?.stop()
      saveCoordinatorRef.current = null
      if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current)
      viewTransitionRef.current?.skipTransition?.()
      viewTransitionRef.current = null
    },
    [motionTimerRef, saveCoordinatorRef, viewTransitionRef],
  )
}
