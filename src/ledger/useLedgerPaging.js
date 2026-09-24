import { MOVEMENT_STATUSES } from './ledgerCore'
import { loadAdreemMovementPage, loadMoreAdreemMovements } from './ledgerPersistence'
import { sameRecordVersions } from './ledgerState'
import { MAIN_LEDGER_MOVEMENT_TYPES } from './separateRecords'
import { mergeMovementHistoryPages, mergeMovementPageAttachments, mergeReviewMovementPage } from './ledgerAppState'
import { MOVEMENT_REQUEST_KEYS, REVIEW_MOVEMENT_PAGE_SIZE } from './ledgerUiConfig'

export function useLedgerPaging({
  accountProfileRequestSequenceRef,
  activeAccountProfilePage,
  activeReviewPage,
  historyAccountId,
  historyDimensionId,
  historyExpenseCategoryId,
  historyPage,
  historyQuery,
  historyRemoteMovements,
  historyRequestSequenceRef,
  historyStatus,
  historyType,
  isLoadingAccountProfile,
  isLoadingOlderMovements,
  ledgerRevision,
  ledgerStorageMode,
  movementPage,
  movements,
  reviewLoadInProgressRef,
  reviewRequestSequenceRef,
  selectedAccountId,
  setAccountProfilePage,
  setFeedback,
  setHistoryPage,
  setHistoryRemoteMovements,
  setIsLoadingAccountProfile,
  setIsLoadingOlderMovements,
  setIsLoadingReview,
  setLedgerExtras,
  setMovementPage,
  setMovements,
  setReviewPage,
}) {
  async function loadOlderMovements() {
    const activePage = ledgerStorageMode === 'relational' ? historyPage : movementPage
    if (isLoadingOlderMovements || !activePage?.hasMore) return
    const requestSequence = historyRequestSequenceRef.current
    setIsLoadingOlderMovements(true)
    try {
      if (ledgerStorageMode === 'relational') {
        const result = await loadAdreemMovementPage({
          before: activePage.nextCursor,
          limit: activePage.limit || 100,
          types: MAIN_LEDGER_MOVEMENT_TYPES,
          query: historyQuery,
          type: historyType,
          status: historyStatus,
          accountId: historyAccountId,
          dimensionId: historyDimensionId,
          expenseCategoryId: historyExpenseCategoryId,
          requestKey: MOVEMENT_REQUEST_KEYS.history,
        })
        if (result.stale || historyRequestSequenceRef.current !== requestSequence) return
        setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
        const mergedHistory = mergeMovementHistoryPages(historyRemoteMovements, result.movements)
        setHistoryRemoteMovements(mergedHistory)
        setHistoryPage({
          ...(result.page || {}),
          total: activePage.total ?? result.page?.total ?? mergedHistory.length,
          loaded: mergedHistory.length,
        })
        setMovements((current) => {
          const merged = mergeMovementHistoryPages(current, result.movements).reverse()
          return sameRecordVersions(current, merged) ? current : merged
        })
        return
      }
      const result = await loadMoreAdreemMovements({
        before: activePage.nextCursor,
        limit: activePage.limit || 100,
        requestKey: MOVEMENT_REQUEST_KEYS.ledgerFeed,
      })
      if (result.stale) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setMovements(result.allMovements || movements)
      setMovementPage(result.page || { hasMore: false, nextCursor: null })
    } catch (error) {
      console.warn('[adreem-ledger] older movements load failed:', error?.message || error)
      setFeedback('تعذر جلب الحركات الأقدم. حاول مرة أخرى.')
    } finally {
      if (historyRequestSequenceRef.current === requestSequence) setIsLoadingOlderMovements(false)
    }
  }

  async function loadOlderReviewMovements() {
    if (reviewLoadInProgressRef.current || !activeReviewPage?.hasMore) return
    const requestSequence = reviewRequestSequenceRef.current
    const expectedRevision = ledgerRevision
    const expectedCursor = activeReviewPage.nextCursor
    reviewLoadInProgressRef.current = true
    setIsLoadingReview(true)
    try {
      const result = await loadAdreemMovementPage({
        before: expectedCursor,
        limit: activeReviewPage.limit || REVIEW_MOVEMENT_PAGE_SIZE,
        status: MOVEMENT_STATUSES.NEEDS_REVIEW,
        requestKey: MOVEMENT_REQUEST_KEYS.review,
      })
      if (reviewRequestSequenceRef.current !== requestSequence) return
      const merged = mergeReviewMovementPage({ page: activeReviewPage }, result, expectedRevision)
      if (!merged) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setMovements((current) => mergeReviewMovementPage({ movements: current }, result, expectedRevision)?.movements || current)
      setReviewPage((current) => {
        if (current?.revision !== expectedRevision || current.nextCursor !== expectedCursor) return current
        return mergeReviewMovementPage({ page: current }, result, expectedRevision)?.page || current
      })
    } catch (error) {
      if (reviewRequestSequenceRef.current === requestSequence) {
        console.warn('[adreem-ledger] older review movements load failed:', error?.message || error)
        setFeedback('تعذر جلب الحركات الناقصة الأقدم.')
      }
    } finally {
      if (reviewRequestSequenceRef.current === requestSequence) {
        reviewLoadInProgressRef.current = false
        setIsLoadingReview(false)
      }
    }
  }

  async function loadOlderAccountProfileMovements() {
    if (!selectedAccountId || isLoadingAccountProfile || !activeAccountProfilePage?.hasMore) return
    const requestSequence = accountProfileRequestSequenceRef.current
    setIsLoadingAccountProfile(true)
    try {
      const result = await loadAdreemMovementPage({
        accountId: selectedAccountId,
        before: activeAccountProfilePage.nextCursor,
        limit: activeAccountProfilePage.limit || 100,
        requestKey: MOVEMENT_REQUEST_KEYS.accountProfile,
      })
      if (result.stale || accountProfileRequestSequenceRef.current !== requestSequence) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setMovements((current) => {
        const merged = mergeMovementHistoryPages(current, result.movements).reverse()
        return sameRecordVersions(current, merged) ? current : merged
      })
      setAccountProfilePage({
        accountId: selectedAccountId,
        ...(result.page || {}),
        total: activeAccountProfilePage.total ?? result.page?.total ?? null,
        loaded: Number(activeAccountProfilePage.loaded || 0) + result.movements.length,
      })
    } catch (error) {
      console.warn('[adreem-ledger] older account movements load failed:', error?.message || error)
      setFeedback('تعذر جلب الحركات الأقدم لهذا الحساب.')
    } finally {
      if (accountProfileRequestSequenceRef.current === requestSequence) setIsLoadingAccountProfile(false)
    }
  }

  async function loadCompleteAccountStatement(accountIds = []) {
    if (ledgerStorageMode !== 'relational') return movements
    const byId = new Map(movements.map((movement) => [movement.id, movement]))
    for (const accountId of Array.from(new Set(accountIds.filter(Boolean)))) {
      let before = null
      const seenCursors = new Set()
      for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
        const result = await loadAdreemMovementPage({
          accountId,
          before,
          limit: 250,
          includeOpening: true,
          requestKey: `statement:${accountId}`,
        })
        if (result.stale) throw new Error('stale-statement')
        for (const movement of result.movements || []) byId.set(movement.id, movement)
        if (!result.page?.hasMore || !result.page?.nextCursor) break
        if (seenCursors.has(result.page.nextCursor)) throw new Error('repeated-statement-cursor')
        seenCursors.add(result.page.nextCursor)
        before = result.page.nextCursor
        if (pageIndex === 999) throw new Error('statement-page-limit')
      }
    }
    return Array.from(byId.values())
  }

  return {
    loadOlderMovements,
    loadOlderReviewMovements,
    loadOlderAccountProfileMovements,
    loadCompleteAccountStatement,
  }
}
