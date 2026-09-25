import { MOVEMENT_STATUSES } from './ledgerCore'
import { loadAdreemMovementPage, loadMoreAdreemMovements } from './ledgerPersistence'
import { sameRecordVersions } from './ledgerState'
import { MAIN_LEDGER_MOVEMENT_TYPES } from './separateRecords'
import { mergeMovementHistoryPages, mergeMovementPageAttachments, mergeReviewMovementPage } from './ledgerAppState'
import { MOVEMENT_REQUEST_KEYS, REVIEW_MOVEMENT_PAGE_SIZE } from './ledgerUiConfig'
import { accountMovementFilter } from './movementDisplay'
import { loadEveryMovementPage } from './movementPageLoader'
import { expenseCategoryRequestFilter, EXPENSE_MOVEMENT_TYPES } from './expenseActivity'

export function useLedgerPaging({
  accountProfileRequestSequenceRef,
  activeAccountProfilePage,
  activeReviewPage,
  expenseCategoryFilter,
  expensePage,
  expenseRemoteMovements,
  expenseRequestSequenceRef,
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
  isLoadingOlderExpenses,
  isLoadingOlderMovements,
  ledgerRevision,
  ledgerStorageMode,
  movementPage,
  movements,
  reviewLoadInProgressRef,
  reviewRequestSequenceRef,
  selectedAccountId,
  selectedAccountIsExpenseCategory,
  setAccountProfilePage,
  setExpensePage,
  setExpenseRemoteMovements,
  setFeedback,
  setHistoryPage,
  setHistoryRemoteMovements,
  setIsLoadingAccountProfile,
  setIsLoadingOlderExpenses,
  setIsLoadingOlderMovements,
  setIsLoadingReview,
  setLedgerExtras,
  setMovementPage,
  setMovements,
  setReviewPage,
}) {
  async function loadOlderExpenses() {
    if (isLoadingOlderExpenses || !expensePage?.hasMore || expensePage.categoryId !== expenseCategoryFilter) return
    const requestSequence = expenseRequestSequenceRef.current
    setIsLoadingOlderExpenses(true)
    try {
      const result = await loadAdreemMovementPage({
        before: expensePage.nextCursor,
        limit: expensePage.limit || 100,
        types: EXPENSE_MOVEMENT_TYPES,
        ...expenseCategoryRequestFilter(expenseCategoryFilter),
        requestKey: MOVEMENT_REQUEST_KEYS.expenses,
      })
      if (result.stale || expenseRequestSequenceRef.current !== requestSequence) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      const mergedExpenses = mergeMovementHistoryPages(expenseRemoteMovements, result.movements)
      setExpenseRemoteMovements(mergedExpenses)
      setExpensePage({
        ...(result.page || {}),
        categoryId: expenseCategoryFilter,
        total: expensePage.total ?? result.page?.total ?? mergedExpenses.length,
        loaded: mergedExpenses.length,
      })
      setMovements((current) => {
        const merged = mergeMovementHistoryPages(current, result.movements).reverse()
        return sameRecordVersions(current, merged) ? current : merged
      })
    } catch (error) {
      if (expenseRequestSequenceRef.current === requestSequence) {
        console.warn('[adreem-ledger] older expenses load failed:', error?.message || error)
        setFeedback('تعذر جلب المصروفات الأقدم.')
      }
    } finally {
      if (expenseRequestSequenceRef.current === requestSequence) setIsLoadingOlderExpenses(false)
    }
  }

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
        ...accountMovementFilter(selectedAccountId, selectedAccountIsExpenseCategory),
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

  async function loadCompleteAccountStatement(accountIds = [], { byExpenseCategory = false } = {}) {
    if (ledgerStorageMode !== 'relational') return movements
    const byId = new Map(movements.map((movement) => [movement.id, movement]))
    for (const accountId of Array.from(new Set(accountIds.filter(Boolean)))) {
      const result = await loadEveryMovementPage(
        { ...accountMovementFilter(accountId, byExpenseCategory), includeOpening: true },
        `statement:${accountId}`,
      )
      if (result.stale) throw new Error('stale-statement')
      for (const movement of result.movements) byId.set(movement.id, movement)
    }
    return Array.from(byId.values())
  }

  return {
    loadOlderExpenses,
    loadOlderMovements,
    loadOlderReviewMovements,
    loadOlderAccountProfileMovements,
    loadCompleteAccountStatement,
  }
}
