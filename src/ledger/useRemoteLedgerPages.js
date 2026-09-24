import { useEffect } from 'react'
import { zonedDayRange } from './dateRange'
import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from './ledgerCore'
import { loadAdreemMovementPage } from './ledgerPersistence'
import { sameRecordVersions } from './ledgerState'
import { MAIN_LEDGER_MOVEMENT_TYPES } from './separateRecords'
import { mergeMovementHistoryPages, mergeMovementPageAttachments, mergeReviewMovementPage } from './ledgerAppState'
import { MAX_SEPARATE_RECORD_PAGES, MOVEMENT_REQUEST_KEYS, REVIEW_MOVEMENT_PAGE_SIZE, SEPARATE_RECORD_PAGE_SIZE } from './ledgerUiConfig'

export function useRemoteLedgerPages({
  accountProfileRequestSequenceRef,
  activeAccountGroup,
  activeSection,
  historyAccountId,
  historyDimensionId,
  historyExpenseCategoryId,
  historyQuery,
  historyRequestSequenceRef,
  historyStatus,
  historyType,
  isHydrated,
  ledgerRevision,
  ledgerStorageMode,
  reviewLoadInProgressRef,
  reviewRequestSequenceRef,
  selectedAccountId,
  separateRequestSequenceRef,
  setAccountProfilePage,
  setFeedback,
  setHistoryPage,
  setHistoryRemoteMovements,
  setIsLoadingAccountProfile,
  setIsLoadingHistory,
  setIsLoadingOlderMovements,
  setIsLoadingReview,
  setIsLoadingSeparateRecords,
  setLedgerExtras,
  setMovements,
  setReviewPage,
  setSeparatePage,
  setTodayRemoteSummary,
}) {
  useEffect(() => {
    if (!isHydrated || ledgerStorageMode !== 'relational' || !Number.isSafeInteger(ledgerRevision)) return undefined
    let cancelled = false
    const dayRange = zonedDayRange()
    void loadAdreemMovementPage({
      limit: 3,
      types: MAIN_LEDGER_MOVEMENT_TYPES,
      occurredFrom: dayRange.from,
      occurredBefore: dayRange.before,
      requestKey: MOVEMENT_REQUEST_KEYS.todaySummary,
    }).then((result) => {
      if (cancelled || result.stale || result.revision !== ledgerRevision) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setTodayRemoteSummary({
        revision: result.revision,
        total: result.page?.total ?? result.movements.length,
        movements: result.movements,
      })
    }).catch((error) => {
      if (!cancelled) console.warn('[adreem-ledger] today summary load failed:', error?.message || error)
    })
    return () => { cancelled = true }
  }, [isHydrated, ledgerRevision, ledgerStorageMode, setLedgerExtras, setTodayRemoteSummary])

  useEffect(() => {
    const requestSequence = reviewRequestSequenceRef.current + 1
    reviewRequestSequenceRef.current = requestSequence
    reviewLoadInProgressRef.current = false
    if (!isHydrated || activeSection !== 'review' || ledgerStorageMode !== 'relational' || !Number.isSafeInteger(ledgerRevision)) return undefined

    let cancelled = false
    reviewLoadInProgressRef.current = true
    queueMicrotask(() => {
      if (cancelled || reviewRequestSequenceRef.current !== requestSequence) return
      setIsLoadingReview(true)
      setReviewPage(null)
    })
    void loadAdreemMovementPage({
      limit: REVIEW_MOVEMENT_PAGE_SIZE,
      status: MOVEMENT_STATUSES.NEEDS_REVIEW,
      requestKey: MOVEMENT_REQUEST_KEYS.review,
    }).then((result) => {
      if (cancelled || reviewRequestSequenceRef.current !== requestSequence) return
      const merged = mergeReviewMovementPage({}, result, ledgerRevision, true)
      if (!merged) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setMovements((current) => mergeReviewMovementPage({ movements: current }, result, ledgerRevision, true)?.movements || current)
      setReviewPage(merged.page)
    }).catch((error) => {
      if (!cancelled && reviewRequestSequenceRef.current === requestSequence) {
        console.warn('[adreem-ledger] review movements load failed:', error?.message || error)
        setFeedback('تعذر تحميل الحركات الناقصة. حاول مرة أخرى.')
      }
    }).finally(() => {
      if (!cancelled && reviewRequestSequenceRef.current === requestSequence) {
        reviewLoadInProgressRef.current = false
        setIsLoadingReview(false)
      }
    })
    return () => {
      cancelled = true
      reviewLoadInProgressRef.current = false
    }
  }, [activeSection, isHydrated, ledgerRevision, ledgerStorageMode, reviewLoadInProgressRef, reviewRequestSequenceRef, setFeedback, setIsLoadingReview, setLedgerExtras, setMovements, setReviewPage])

  useEffect(() => {
    const requestSequence = accountProfileRequestSequenceRef.current + 1
    accountProfileRequestSequenceRef.current = requestSequence
    if (!selectedAccountId || ledgerStorageMode !== 'relational') return undefined
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled || accountProfileRequestSequenceRef.current !== requestSequence) return
      setIsLoadingAccountProfile(true)
      try {
        const result = await loadAdreemMovementPage({
          accountId: selectedAccountId,
          limit: 100,
          requestKey: MOVEMENT_REQUEST_KEYS.accountProfile,
        })
        if (cancelled || result.stale || accountProfileRequestSequenceRef.current !== requestSequence) return
        setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
        setAccountProfilePage({ accountId: selectedAccountId, ...(result.page || {}), loaded: result.movements.length })
        setMovements((current) => {
          const merged = mergeMovementHistoryPages(current, result.movements).reverse()
          return sameRecordVersions(current, merged) ? current : merged
        })
      } catch (error) {
        if (!cancelled && accountProfileRequestSequenceRef.current === requestSequence) {
          console.warn('[adreem-ledger] account movements load failed:', error?.message || error)
          setFeedback('تعذر جلب كل حركات الحساب. حاول مرة أخرى.')
        }
      } finally {
        if (!cancelled && accountProfileRequestSequenceRef.current === requestSequence) setIsLoadingAccountProfile(false)
      }
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [accountProfileRequestSequenceRef, ledgerStorageMode, selectedAccountId, setAccountProfilePage, setFeedback, setIsLoadingAccountProfile, setLedgerExtras, setMovements])

  useEffect(() => {
    const requestSequence = separateRequestSequenceRef.current + 1
    separateRequestSequenceRef.current = requestSequence
    if (!isHydrated || activeSection !== 'accounts' || activeAccountGroup !== 'separate' || ledgerStorageMode !== 'relational') return undefined
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled && separateRequestSequenceRef.current === requestSequence) setIsLoadingSeparateRecords(true)
    })
    void (async () => {
      let before = null
      let loaded = 0
      let firstTotal = null
      const seenCursors = new Set()
      for (let pageIndex = 0; pageIndex < MAX_SEPARATE_RECORD_PAGES; pageIndex += 1) {
        const result = await loadAdreemMovementPage({
          before,
          limit: SEPARATE_RECORD_PAGE_SIZE,
          type: MOVEMENT_TYPES.RECORD_ONLY,
          requestKey: MOVEMENT_REQUEST_KEYS.separate,
        })
        if (cancelled || result.stale || separateRequestSequenceRef.current !== requestSequence) return
        setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
        setMovements((current) => {
          const merged = mergeMovementHistoryPages(current, result.movements).reverse()
          return sameRecordVersions(current, merged) ? current : merged
        })
        loaded += result.movements.length
        if (firstTotal === null) firstTotal = result.page?.total ?? null
        setSeparatePage({ ...(result.page || {}), total: firstTotal, loaded })
        if (!result.page?.hasMore) return
        const nextCursor = Number(result.page?.nextCursor)
        if (!Number.isSafeInteger(nextCursor) || nextCursor <= 0 || seenCursors.has(nextCursor)) {
          throw new Error('Invalid separate ledger cursor.')
        }
        seenCursors.add(nextCursor)
        before = nextCursor
      }
      throw new Error('Separate ledger page limit exceeded.')
    })().catch((error) => {
      if (!cancelled && separateRequestSequenceRef.current === requestSequence) {
        console.warn('[adreem-ledger] separate records load failed:', error?.message || error)
        setFeedback('تعذر تحميل السجل المنفصل كاملًا. حاول مرة أخرى.')
      }
    }).finally(() => {
      if (!cancelled && separateRequestSequenceRef.current === requestSequence) setIsLoadingSeparateRecords(false)
    })
    return () => { cancelled = true }
  }, [activeAccountGroup, activeSection, isHydrated, ledgerStorageMode, separateRequestSequenceRef, setFeedback, setIsLoadingSeparateRecords, setLedgerExtras, setMovements, setSeparatePage])

  useEffect(() => {
    const requestSequence = historyRequestSequenceRef.current + 1
    historyRequestSequenceRef.current = requestSequence
    if (!isHydrated || activeSection !== 'history' || ledgerStorageMode !== 'relational') return undefined
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (cancelled || historyRequestSequenceRef.current !== requestSequence) return
      setIsLoadingHistory(true)
      setIsLoadingOlderMovements(false)
      try {
        const result = await loadAdreemMovementPage({
          limit: 100,
          types: MAIN_LEDGER_MOVEMENT_TYPES,
          query: historyQuery,
          type: historyType,
          status: historyStatus,
          accountId: historyAccountId,
          dimensionId: historyDimensionId,
          expenseCategoryId: historyExpenseCategoryId,
          requestKey: MOVEMENT_REQUEST_KEYS.history,
        })
        if (cancelled || result.stale || historyRequestSequenceRef.current !== requestSequence) return
        setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
        const pageMovements = mergeMovementHistoryPages(result.movements)
        setHistoryRemoteMovements(pageMovements)
        setHistoryPage({ ...(result.page || {}), loaded: pageMovements.length })
        setMovements((current) => {
          const merged = mergeMovementHistoryPages(current, pageMovements).reverse()
          return sameRecordVersions(current, merged) ? current : merged
        })
      } catch (error) {
        if (cancelled || historyRequestSequenceRef.current !== requestSequence) return
        console.warn('[adreem-ledger] history load failed:', error?.message || error)
        setFeedback('تعذر تحميل السجل. حاول مرة أخرى.')
      } finally {
        if (!cancelled && historyRequestSequenceRef.current === requestSequence) setIsLoadingHistory(false)
      }
    }, historyQuery.trim() ? 180 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeSection, historyAccountId, historyDimensionId, historyExpenseCategoryId, historyQuery, historyRequestSequenceRef, historyStatus, historyType, isHydrated, ledgerStorageMode, setFeedback, setHistoryPage, setHistoryRemoteMovements, setIsLoadingHistory, setIsLoadingOlderMovements, setLedgerExtras, setMovements])
}
