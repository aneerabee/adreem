import { useEffect } from 'react'

export function useLedgerOverlayEffects({
  activeReviewKey,
  activeSection,
  expenseCategoryCreator,
  movementEditDialogOpen,
  pendingMovementAction,
  pendingUndo,
  reviewItems,
  selectedAccountId,
  setActiveReviewKey,
  setPendingUndo,
}) {
  useEffect(() => {
    if (!pendingUndo) return undefined
    const timer = window.setTimeout(() => setPendingUndo(null), 18000)
    return () => window.clearTimeout(timer)
  }, [pendingUndo, setPendingUndo])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    const root = document.documentElement
    if (selectedAccountId || expenseCategoryCreator || movementEditDialogOpen || pendingMovementAction) {
      document.body.style.overflow = 'hidden'
      root.classList.add('adreem-overlay-open')
    }
    return () => {
      document.body.style.overflow = previousOverflow
      root.classList.remove('adreem-overlay-open')
    }
  }, [expenseCategoryCreator, movementEditDialogOpen, pendingMovementAction, selectedAccountId])

  useEffect(() => {
    if (activeSection !== 'review') return undefined
    const nextKey = reviewItems.length && reviewItems.some((item) => item.key === activeReviewKey) ? activeReviewKey : reviewItems[0]?.key || ''
    if (nextKey === activeReviewKey) return undefined
    const timer = window.setTimeout(() => setActiveReviewKey(nextKey), 0)
    return () => window.clearTimeout(timer)
  }, [activeSection, activeReviewKey, reviewItems, setActiveReviewKey])
}
