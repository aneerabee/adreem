import { counterpartyGroupKey } from './accountConfig'
import { createAuditEvent } from './ledgerOperations'
import { prepareExpenseCategoryAccount, setCounterpartySettlementPin } from './balanceViews'
import { claimSubmission, releaseSubmission } from './ledgerAppState'
import { accountGroupTabs, sectionOrder } from './ledgerUiConfig'
import { scrollLedgerToTop } from './ledgerDom'
import { isPhoneViewport, revealAfterRender } from './mobileViewport'

export function useBalanceNavigation({
  accounts,
  activeAccountGroup,
  activeSection,
  commitFlowChange,
  expenseCategoryCreationLockRef,
  expenseCategoryCreator,
  isNetOpen,
  isSavingExpenseCategory,
  ledgerStorageMode,
  netAccountQuery,
  netExcludedAccountIds,
  setAccountQuery,
  setAccounts,
  setActiveAccountGroup,
  setActiveSection,
  setBalanceFocus,
  setCounterpartyBalanceFilter,
  setExpenseCategoryCreator,
  setFeedback,
  setFocusedCounterpartyId,
  setHistoryAccountId,
  setHistoryDimensionId,
  setHistoryExpenseCategoryId,
  setHistoryPage,
  setHistoryQuery,
  setHistoryRemoteMovements,
  setHistoryStatus,
  setHistoryType,
  setIsLoadingHistory,
  setIsNetOpen,
  setIsSavingExpenseCategory,
  setLedgerExtras,
  setMovementDraft,
  setNetAccountQuery,
  setNetExcludedAccountIds,
  setSelectedAccountId,
  switchSection,
  uiDirection,
}) {
  function resetTemporaryNet() {
    setNetExcludedAccountIds((current) => current.length ? [] : current)
    setNetAccountQuery((current) => current ? '' : current)
  }

  function closeNetPanel() {
    resetTemporaryNet()
    setIsNetOpen((current) => current ? false : current)
  }

  function toggleNetPanel() {
    if (isNetOpen) {
      closeNetPanel()
      return
    }
    resetTemporaryNet()
    setIsNetOpen(true)
  }

  function toggleTemporaryNetAccount(accountId) {
    setNetExcludedAccountIds((current) => (
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId]
    ))
  }

  function toggleCounterpartySettlement(group) {
    const groupId = String(group?.id || '').trim()
    if (!groupId) return
    const accountIds = accounts
      .filter((account) => counterpartyGroupKey(account) === groupId)
      .map((account) => account.id)
    if (!accountIds.length) return
    const nextPinned = !group.settlementPinned
    const updatedAt = new Date().toISOString()
    setAccounts((current) => setCounterpartySettlementPin(current, groupId, nextPinned, updatedAt))
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent(nextPinned ? 'counterparty.settlement_pinned' : 'counterparty.settlement_unpinned', {
          counterpartyId: groupId,
          accountIds,
        }),
      ],
    }))
    setFeedback(nextPinned ? 'تم تثبيت الشخص للتسوية.' : 'تم إلغاء تثبيت التسوية.')
  }

  function openDimensionHistory(dimensionId) {
    setHistoryQuery('')
    setHistoryType('')
    setHistoryStatus('')
    setHistoryAccountId('')
    setHistoryExpenseCategoryId('')
    setHistoryDimensionId(dimensionId)
    setHistoryRemoteMovements(null)
    setHistoryPage(null)
    if (ledgerStorageMode === 'relational') setIsLoadingHistory(true)
    setSelectedAccountId('')
    switchSection('history')
  }

  function revealAccountGroups() {
    revealAfterRender(() => document.querySelector('.ml3-account-switcher'), { alignTop: true, whenBelow: 0.34 })
  }

  function selectAccountGroup(groupKey) {
    setActiveAccountGroup(groupKey)
    setBalanceFocus('')
    setCounterpartyBalanceFilter('all')
    setFocusedCounterpartyId('')
    revealAccountGroups()
  }

  function handleAccountGroupKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = Math.max(0, accountGroupTabs.findIndex((group) => group.key === activeAccountGroup))
    const forwardKey = uiDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backwardKey = uiDirection === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? accountGroupTabs.length - 1
        : event.key === forwardKey || event.key === 'ArrowDown'
          ? (currentIndex + 1) % accountGroupTabs.length
          : event.key === backwardKey || event.key === 'ArrowUp'
            ? (currentIndex - 1 + accountGroupTabs.length) % accountGroupTabs.length
            : currentIndex
    const nextGroup = accountGroupTabs[nextIndex]
    selectAccountGroup(nextGroup.key)
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-account-group="${nextGroup.key}"]`)?.focus({ preventScroll: true })
    })
  }

  function openBalanceFocus(focus) {
    const accountGroup = ['cash', 'bank'].includes(focus) ? 'money' : 'people'
    const applyFocus = () => {
      if (isNetOpen || netExcludedAccountIds.length || netAccountQuery) closeNetPanel()
      setActiveSection('accounts')
      setActiveAccountGroup(accountGroup)
      setBalanceFocus(focus)
      setCounterpartyBalanceFilter(['receivable', 'payable'].includes(focus) ? focus : 'all')
      setAccountQuery('')
      setFocusedCounterpartyId('')
    }
    if (activeSection !== 'accounts') {
      const currentIndex = sectionOrder.indexOf(activeSection)
      const targetIndex = sectionOrder.indexOf('accounts')
      commitFlowChange(() => {
        applyFocus()
      }, targetIndex >= currentIndex ? 'forward' : 'back', 'section')
      return
    }
    applyFocus()
    if (isPhoneViewport()) revealAccountGroups()
    else scrollLedgerToTop('auto')
  }

  function openExpenseCategoryCreator(context = 'balances') {
    setExpenseCategoryCreator({ context, name: '', error: '' })
  }

  function closeExpenseCategoryCreator() {
    if (isSavingExpenseCategory) return
    setExpenseCategoryCreator(null)
  }

  function updateExpenseCategoryName(name) {
    setExpenseCategoryCreator((current) => current ? { ...current, name, error: '' } : current)
  }

  function saveExpenseCategory(event) {
    event.preventDefault()
    const name = String(expenseCategoryCreator?.name || '').trim()
    if (!name) {
      setExpenseCategoryCreator((current) => current ? { ...current, error: 'اكتب اسم التصنيف.' } : current)
      return
    }
    const submissionKey = JSON.stringify(['expense-category', name])
    if (!claimSubmission(expenseCategoryCreationLockRef, submissionKey)) return
    const { account, validation } = prepareExpenseCategoryAccount(name, accounts)
    if (!validation.ok) {
      releaseSubmission(expenseCategoryCreationLockRef, submissionKey)
      setExpenseCategoryCreator((current) => current ? { ...current, error: validation.errors.map((error) => error.message).join(' ') } : current)
      return
    }

    setIsSavingExpenseCategory(true)
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('expense_category.created', { accountId: account.id }),
      ],
    }))
    if (expenseCategoryCreator?.context === 'movement') {
      setMovementDraft((current) => ({ ...current, expenseCategoryId: account.id }))
    }
    setExpenseCategoryCreator(null)
    setIsSavingExpenseCategory(false)
    setFeedback('تم إنشاء تصنيف المصروف.')
  }

  return {
    resetTemporaryNet,
    closeNetPanel,
    toggleNetPanel,
    toggleTemporaryNetAccount,
    toggleCounterpartySettlement,
    openDimensionHistory,
    selectAccountGroup,
    handleAccountGroupKeyDown,
    openBalanceFocus,
    openExpenseCategoryCreator,
    closeExpenseCategoryCreator,
    updateExpenseCategoryName,
    saveExpenseCategory,
  }
}
