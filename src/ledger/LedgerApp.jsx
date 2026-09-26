/** @jsxImportSource ./i18nRuntime */
/** @jsxRuntime automatic */
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowRightLeft, WalletCards } from 'lucide-react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import './styles/index.css'
import AdreemChrome from './AdreemChrome'
import InvestmentsPanel from './InvestmentsPanel'
import { ACCOUNT_STATUSES, VALUE_KINDS, getActivePostingAccounts, knownExternalAccounts } from './accountCatalog'
import { accountPrimaryName, emptyAccountDraft } from './accountConfig'
import { accountsWithLedgerActivity, groupAccountsForDisplay } from './accountDisplayGroups'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, previewMovement, summarizeBalances } from './ledgerCore'
import { getLedgerPersistenceMode, loadAdreemInvestmentTryUsdRate, searchAdreemInvestmentAssets, updateAdreemUserProfile } from './ledgerPersistence'
import { buildNetPosition, isAccountIncludedInNet } from './ledgerScope'
import { readLedgerNavigation } from './ledgerNavigation'
import { MOVEMENT_ENTRY_STEPS, movementConfigFor, movementLabels, movementNeedsSource, movementSupportsDimension } from './movementConfig'
import { sameLogicalAccount } from './movementAccounts'
import { filterSeparateRecords, isMainLedgerMovement, separateRecordNames, separateRecordTotals } from './separateRecords'
import { buildDimensionReports, defaultRecurringFirstRunOn, dimensionsFromAccounts, dueRecurringRules, findUnresolvedReconciliationDifferences, normalizeRecurringDateKey } from './ledgerOperations'
import { normalizeUiLanguage, uiLanguageDirection } from './uiLanguage'
import { preserveUiData, readRememberedUiLanguage, rememberUiLanguage, setActiveUiLanguage, translateUiText } from './uiTranslation'
import { INVESTMENT_RECORD_STATUSES, summarizeInvestmentPortfolio } from './investmentCore'
import { isAutoPricedHolding } from './investmentMarketPolicy'
import { compareBalanceBuckets, protectedAccountContext, protectedAccountLabel, protectedUserProfile } from './accountPresentation'
import { AccountProfile } from './AccountProfile'
import { LedgerOpeningScreen } from './LedgerOpeningScreen'
import { buildBalanceOverview } from './balanceViews'
import { activeRecurringRuleForMovement, emptyMovementDraft, emptySeparateRecordDraft, filterMovementHistory, ledgerExtrasFromState, loadInitialLedgerState, logoutFromCloudSession, mergeMovementHistoryPages, openAdminUsersPage, previewMovementEdit, storageTextForStatus } from './ledgerAppState'
import { ExpenseCategoryDialog, MovementActionDialog, MovementEditDialog } from './LedgerDialogs'
import { useMobileViewport } from './mobileViewport'
import { formatCount, money, parseLocalizedDecimal, parseMoneyAmount } from './ledgerFormat'
import { ACCOUNT_WIZARD_STEPS, sectionOrder, sectionTitles, UI_MOTION_TRANSITION } from './ledgerUiConfig'
import { externalAccountKey, isToday, movementDayKey, movementDayLabel, movementEditChanges, movementStepCopy, movementVisibleSteps } from './movementPresentation'
import { MovementMiniRow } from './MovementRows'
import { AlertBoard } from './ReviewCards'
import { useInvestmentActions } from './useInvestmentActions'
import { useSeparateRecordActions } from './useSeparateRecordActions'
import { useLedgerPaging } from './useLedgerPaging'
import { useAccountActions } from './useAccountActions'
import { useReviewActions } from './useReviewActions'
import { useMovementActions } from './useMovementActions'
import { BalancesSection } from './BalancesSection'
import { ReviewSection } from './ReviewSection'
import { HistorySection } from './HistorySection'
import { MovementEntryForm } from './MovementEntryForm'
import { AccountWizardForm } from './AccountWizardForm'
import { useLedgerHydration } from './useLedgerHydration'
import { useRemoteLedgerPages } from './useRemoteLedgerPages'
import { usePortfolioPriceRefresh } from './usePortfolioPriceRefresh'
import { useLedgerOverlayEffects } from './useLedgerOverlayEffects'
import { useLedgerAutosave } from './useLedgerAutosave'
import { useLedgerPageEffects } from './useLedgerPageEffects'
import { useBalanceNavigation } from './useBalanceNavigation'
import { useEntryFlow } from './useEntryFlow'
import { accountWizardModel } from './accountWizardModel'
import { movementReceipts } from './movementReceipts'
import { isExpenseCategoryAccount, isExpenseMovement } from './movementDisplay'

const LEDGER_FONT_WAIT_MS = 4_000

export default function LedgerApp() {
  const [initialState] = useState(loadInitialLedgerState)
  const [initialNavigation] = useState(() => readLedgerNavigation(typeof window === 'undefined' ? '' : window.location.search))
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [movements, setMovements] = useState(initialState.movements)
  const [ledgerExtras, setLedgerExtras] = useState(() => ledgerExtrasFromState(initialState))
  const [activeSection, setActiveSection] = useState(initialNavigation.section)
  const [activeEntryMode, setActiveEntryMode] = useState(initialNavigation.entryMode)
  const [activeAccountGroup, setActiveAccountGroup] = useState(initialNavigation.accountGroup)
  const [balanceFocus, setBalanceFocus] = useState(initialNavigation.balanceFocus)
  const [activeAccountPresetGroup, setActiveAccountPresetGroup] = useState('')
  const [movementDraft, setMovementDraft] = useState(() => emptyMovementDraft())
  const [movementAttachmentFile, setMovementAttachmentFile] = useState(null)
  const [movementStep, setMovementStep] = useState(MOVEMENT_ENTRY_STEPS.TYPE)
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [isHydrated, setIsHydrated] = useState(false)
  const [ledgerFontsReady, setLedgerFontsReady] = useState(() => typeof document === 'undefined' || !document.fonts?.load)
  const [canPersist, setCanPersist] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [storageMode, setStorageMode] = useState(getLedgerPersistenceMode)
  const [ledgerStorageMode, setLedgerStorageMode] = useState('legacy')
  const [canManageUsers, setCanManageUsers] = useState(false)
  const [userProfile, setUserProfile] = useState(null)
  const [uiLanguage, setUiLanguage] = useState(readRememberedUiLanguage)
  const [languageStatus, setLanguageStatus] = useState('idle')
  const [languageMessage, setLanguageMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState('loading')
  const [, setSyncProblem] = useState(false)
  const [pendingUndo, setPendingUndo] = useState(null)
  const [activeReviewKey, setActiveReviewKey] = useState('')
  const [editingMovementId, setEditingMovementId] = useState('')
  const [editingMovementBaseline, setEditingMovementBaseline] = useState(null)
  const [movementEditStage, setMovementEditStage] = useState('fields')
  const [pendingMovementAction, setPendingMovementAction] = useState(null)
  const [isSavingMovement, setIsSavingMovement] = useState(false)
  const [isAddingAccountAttachment, setIsAddingAccountAttachment] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyType, setHistoryType] = useState('')
  const [historyStatus, setHistoryStatus] = useState('')
  const [historyAccountId, setHistoryAccountId] = useState('')
  const [historyDimensionId, setHistoryDimensionId] = useState('')
  const [historyExpenseCategoryId, setHistoryExpenseCategoryId] = useState('')
  const [movementPage, setMovementPage] = useState({ hasMore: false, nextCursor: null, loaded: initialState.movements.length })
  const [ledgerRevision, setLedgerRevision] = useState(null)
  const [historyRemoteMovements, setHistoryRemoteMovements] = useState(null)
  const [historyPage, setHistoryPage] = useState(null)
  const [expenseRemoteMovements, setExpenseRemoteMovements] = useState(null)
  const [expensePage, setExpensePage] = useState(null)
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('')
  const [reviewPage, setReviewPage] = useState(null)
  const [serverReports, setServerReports] = useState(null)
  const [expenseCategoryCreator, setExpenseCategoryCreator] = useState(null)
  const [isSavingExpenseCategory, setIsSavingExpenseCategory] = useState(false)
  const [isLoadingOlderMovements, setIsLoadingOlderMovements] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isLoadingExpenses, setIsLoadingExpenses] = useState(false)
  const [isLoadingOlderExpenses, setIsLoadingOlderExpenses] = useState(false)
  const [isLoadingReview, setIsLoadingReview] = useState(false)
  const [todayRemoteSummary, setTodayRemoteSummary] = useState(null)
  const [accountProfilePage, setAccountProfilePage] = useState(null)
  const [isLoadingAccountProfile, setIsLoadingAccountProfile] = useState(false)
  const [accountQuery, setAccountQuery] = useState('')
  const [separateQuery, setSeparateQuery] = useState('')
  const [separateDraft, setSeparateDraft] = useState(emptySeparateRecordDraft)
  const [isSeparateEditorOpen, setIsSeparateEditorOpen] = useState(false)
  const [editingSeparateRecordId, setEditingSeparateRecordId] = useState('')
  const [separatePage, setSeparatePage] = useState(null)
  const [isSavingSeparateRecord, setIsSavingSeparateRecord] = useState(false)
  const [isLoadingSeparateRecords, setIsLoadingSeparateRecords] = useState(false)
  const [counterpartyBalanceFilter, setCounterpartyBalanceFilter] = useState(
    ['receivable', 'payable'].includes(initialNavigation.balanceFocus) ? initialNavigation.balanceFocus : 'all',
  )
  const [focusedCounterpartyId, setFocusedCounterpartyId] = useState('')
  const [isNetOpen, setIsNetOpen] = useState(false)
  const [netExcludedAccountIds, setNetExcludedAccountIds] = useState([])
  const [netAccountQuery, setNetAccountQuery] = useState('')
  const [netRate, setNetRate] = useState('')
  const [netTargetCurrency, setNetTargetCurrency] = useState(CURRENCIES.DINAR)
  const [netTryRate, setNetTryRate] = useState('')
  const [netEurRate, setNetEurRate] = useState('')
  const [isRefreshingInvestmentPrices, setIsRefreshingInvestmentPrices] = useState(false)
  const [investmentPriceErrors, setInvestmentPriceErrors] = useState({})
  const [accountWizardStep, setAccountWizardStep] = useState(ACCOUNT_WIZARD_STEPS.GROUP)
  const [activeAccountPresetKey, setActiveAccountPresetKey] = useState('')
  const [activeAccountDetail, setActiveAccountDetail] = useState('')
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.load) return undefined
    let active = true
    const fonts = document.fonts
    const finish = () => { if (active) setLedgerFontsReady(true) }
    const timeoutId = globalThis.setTimeout(finish, LEDGER_FONT_WAIT_MS)
    Promise.allSettled([
      fonts.load('400 16px "IBM Plex Sans Arabic"', 'الأرصدة'),
      fonts.load('500 16px "IBM Plex Sans Arabic"', 'الأرصدة'),
      fonts.load('600 16px "IBM Plex Sans Arabic"', 'الأرصدة'),
      fonts.load('700 16px "IBM Plex Sans Arabic"', 'الأرصدة'),
      fonts.load('400 16px "Manrope Variable"', 'Ledger'),
    ]).then(() => {
      globalThis.clearTimeout(timeoutId)
      finish()
    })
    return () => {
      active = false
      globalThis.clearTimeout(timeoutId)
    }
  }, [])
  const saveCoordinatorRef = useRef(null)
  const hasHydratedSnapshotRef = useRef(false)
  const pendingUploadedAttachmentPathsRef = useRef(new Set())
  const orphanCleanupInProgressRef = useRef(false)
  const movementSaveLockRef = useRef(false)
  const accountAttachmentLockRef = useRef(false)
  const accountCreationLockRef = useRef('')
  const expenseCategoryCreationLockRef = useRef('')
  const separateRecordSaveLockRef = useRef(false)
  const activeEntryModeRef = useRef(activeEntryMode)
  const motionTimerRef = useRef(null)
  const viewTransitionRef = useRef(null)
  const motionSequenceRef = useRef(0)
  const entryFlowLocationRef = useRef(`${activeEntryMode}:${movementStep}:${accountWizardStep}`)
  const historyRequestSequenceRef = useRef(0)
  const expenseRequestSequenceRef = useRef(0)
  const accountProfileRequestSequenceRef = useRef(0)
  const reviewRequestSequenceRef = useRef(0)
  const separateRequestSequenceRef = useRef(0)
  const reviewLoadInProgressRef = useRef(false)
  const automaticInvestmentPriceAttemptRef = useRef(0)
  const investmentPriceRefreshRef = useRef({ isRefreshing: false, refresh: null })
  const normalizedUiLanguage = normalizeUiLanguage(uiLanguage)
  const uiDirection = uiLanguageDirection(normalizedUiLanguage)
  setActiveUiLanguage(normalizedUiLanguage)

  useMobileViewport()
  useLedgerPageEffects({
    accountWizardStep,
    activeAccountGroup,
    activeEntryMode,
    activeSection,
    balanceFocus,
    entryFlowLocationRef,
    isNetOpen,
    movementStep,
    netAccountQuery,
    netExcludedAccountIds,
    normalizedUiLanguage,
    setNetAccountQuery,
    setNetExcludedAccountIds,
    uiDirection,
  })

  const activeAccounts = useMemo(() => getActivePostingAccounts(accounts), [accounts])
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const activeDimensions = useMemo(() => dimensionsFromAccounts(accounts, ledgerExtras.dimensions), [accounts, ledgerExtras.dimensions])
  const dimensionById = useMemo(() => new Map(activeDimensions.map((dimension) => [dimension.id, dimension])), [activeDimensions])
  const activeExpenseCategories = useMemo(() => accounts.filter((account) => account.status === ACCOUNT_STATUSES.ACTIVE && account.valueKind === VALUE_KINDS.EXPENSE), [accounts])
  const balances = useMemo(() => summarizeBalances(accounts, movements), [accounts, movements])
  const balanceByAccountId = useMemo(() => new Map(balances.map((bucket) => [bucket.account.id, bucket])), [balances])
  const historyAccountGroups = useMemo(() => groupAccountsForDisplay(accountsWithLedgerActivity(activeAccounts, balanceByAccountId, movements, historyAccountId)), [activeAccounts, balanceByAccountId, historyAccountId, movements])
  const {
    selectedAccountPreset,
    selectedAccountPresetGroup,
    selectedAccountPresetCopy,
    selectedAccountDetails,
    accountDraftNameValue,
    hasAccountDraftName,
    accountIsCounterpartyBundle,
    accountNeedsCurrencyChoice,
    accountNeedsOpeningBalance,
    accountOpeningSummary,
    accountWizardStages,
    accountWizardStageKeys,
    currentAccountWizardStep,
    currentAccountWizardIndex,
    accountWizardPreviousStep,
    accountWizardNextStep,
    canAdvanceAccountWizard,
    accountWizardPrompt,
    accountWizardHint,
  } = accountWizardModel({
    accountDraft,
    accountWizardStep,
    activeAccountDetail,
    activeAccountPresetGroup,
    activeAccountPresetKey,
  })
  const balancesByKind = useMemo(() => {
    const groups = {
      people: [],
      money: [],
      cards: [],
      assets: [],
      expenses: [],
      separate: [],
      review: [],
    }
    for (const bucket of balances) {
      const kind = bucket.account.valueKind
      if (bucket.account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || kind === VALUE_KINDS.REVIEW) groups.review.push(bucket)
      else if (kind === VALUE_KINDS.RECEIVABLE) groups.people.push(bucket)
      else if (kind === VALUE_KINDS.CASH || kind === VALUE_KINDS.BANK) groups.money.push(bucket)
      else if (kind === VALUE_KINDS.CREDIT_CARD) groups.cards.push(bucket)
      else if (kind === VALUE_KINDS.ASSET || kind === VALUE_KINDS.PROJECT) groups.assets.push(bucket)
      else if (kind === VALUE_KINDS.EXPENSE) groups.expenses.push(bucket)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(compareBalanceBuckets)
    }
    return groups
  }, [balances])
  const separateRecords = useMemo(() => filterSeparateRecords(movements, separateQuery), [movements, separateQuery])
  const separateNames = useMemo(() => separateRecordNames(accounts, movements), [accounts, movements])
  const separateTotals = useMemo(() => separateRecordTotals(movements), [movements])

  const reviewMovements = movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const activeReviewPage = reviewPage?.revision === ledgerRevision ? reviewPage : null
  const unresolvedExternalAccounts = knownExternalAccounts.filter((externalAccount) => {
    const ignored = ledgerExtras.ignoredExternalAccounts || []
    if (ignored.includes(externalAccountKey(externalAccount))) return false
    return !accounts.some((account) => account.ownerName === externalAccount.ownerName && account.subAccountName === externalAccount.subAccountName && account.status !== ACCOUNT_STATUSES.INACTIVE)
  })
  const reviewItems = useMemo(() => {
    const accountItems = (balancesByKind.review || []).map((bucket) => ({
      key: `account:${bucket.account.id}`,
      type: 'account',
      label: accountPrimaryName(bucket.account),
      detail: protectedAccountContext(bucket.account),
      tone: 'danger',
      bucket,
    }))
    const externalItems = unresolvedExternalAccounts.map((account) => ({
      key: `external:${account.id}`,
      type: 'external',
      label: accountPrimaryName(account),
      detail: protectedAccountContext(account),
      tone: 'info',
      account,
    }))
    const movementItems = reviewMovements.map((movement) => ({
      key: `movement:${movement.id}`,
      type: 'movement',
      label: movementLabels[movement.type] || 'حركة',
      detail: movement.amount ? money(movement.amount, movement.currency) : 'بلا مبلغ',
      tone: 'warning',
      movement,
    }))
    return [...accountItems, ...movementItems, ...externalItems]
  }, [balancesByKind.review, reviewMovements, unresolvedExternalAccounts])
  const activeReviewItem = reviewItems.find((item) => item.key === activeReviewKey) || reviewItems[0] || null
  const reviewMovementTotal = ledgerStorageMode === 'relational' ? activeReviewPage?.total ?? reviewMovements.length : reviewMovements.length
  const postedUserMovements = movements
    .filter(isMainLedgerMovement)
    .slice()
    .reverse()
  const currentExpenseMovements = postedUserMovements.filter(isExpenseMovement)
  const expenseMovements = ledgerStorageMode === 'relational' && Array.isArray(expenseRemoteMovements)
    ? mergeMovementHistoryPages(expenseRemoteMovements, currentExpenseMovements)
    : currentExpenseMovements
  const locallyFilteredHistoryMovements = useMemo(() => filterMovementHistory({
    movements: postedUserMovements,
    query: historyQuery,
    type: historyType,
    status: historyStatus,
    accountId: historyAccountId,
    dimensionId: historyDimensionId,
    expenseCategoryId: historyExpenseCategoryId,
    accountById,
    dimensionById,
  }), [accountById, dimensionById, historyAccountId, historyDimensionId, historyExpenseCategoryId, historyQuery, historyStatus, historyType, postedUserMovements])
  const filteredHistoryMovements = ledgerStorageMode === 'relational' && Array.isArray(historyRemoteMovements)
    ? historyRemoteMovements.filter(isMainLedgerMovement)
    : locallyFilteredHistoryMovements
  const activeHistoryPage = ledgerStorageMode === 'relational' ? historyPage : movementPage
  const historyGroups = useMemo(() => {
    const groupsByKey = new Map()
    for (const movement of filteredHistoryMovements) {
      const value = movement.createdAt || movement.updatedAt
      const key = movementDayKey(value)
      const current = groupsByKey.get(key)
      if (current) current.movements.push(movement)
      else
        groupsByKey.set(key, {
          key,
          label: movementDayLabel(value),
          movements: [movement],
        })
    }
    return Array.from(groupsByKey.values())
  }, [filteredHistoryMovements])
  const todayMovements = postedUserMovements.filter((movement) => isToday(movement.createdAt || movement.updatedAt))
  const currentTodayRemoteSummary = todayRemoteSummary?.revision === ledgerRevision ? todayRemoteSummary : null
  const todayMovementCount = currentTodayRemoteSummary?.total ?? todayMovements.length
  const todayPreviewMovements = currentTodayRemoteSummary?.movements.filter(isMainLedgerMovement) || todayMovements.slice(0, 3)
  const activeAccountProfilePage = accountProfilePage?.accountId === selectedAccountId ? accountProfilePage : null
  const totals = useMemo(() => {
    return balances.reduce(
      (acc, bucket) => {
        const kind = bucket.account.valueKind
        const included = isAccountIncludedInNet(bucket.account)
        if (included && kind === VALUE_KINDS.CASH) acc.cash += bucket.dinar
        if (included && kind === VALUE_KINDS.BANK) acc.bank += bucket.dinar
        if (included && kind === VALUE_KINDS.RECEIVABLE && bucket.dinar > 0) acc.peopleOweMe += bucket.dinar
        if (included && kind === VALUE_KINDS.RECEIVABLE && bucket.dinar < 0) acc.iOwePeople += Math.abs(bucket.dinar)
        if (included && kind === VALUE_KINDS.ASSET) acc.assets += bucket.dinar
        if (kind === VALUE_KINDS.EXPENSE) acc.expenses += bucket.dinar
        if (included) acc.usd += bucket.usd
        return acc
      },
      {
        cash: 0,
        bank: 0,
        peopleOweMe: 0,
        iOwePeople: 0,
        assets: 0,
        expenses: 0,
        usd: 0,
      },
    )
  }, [balances])
  const balanceOverview = useMemo(() => buildBalanceOverview(balances), [balances])
  const investmentSummary = useMemo(() => summarizeInvestmentPortfolio({
    platforms: ledgerExtras.investmentPlatforms || [],
    holdings: ledgerExtras.investmentHoldings || [],
    trades: ledgerExtras.investmentTrades || [],
    transfers: ledgerExtras.investmentTransfers || [],
    movements,
  }), [ledgerExtras.investmentHoldings, ledgerExtras.investmentPlatforms, ledgerExtras.investmentTrades, ledgerExtras.investmentTransfers, movements])
  const investmentPriceRefreshSignature = useMemo(() => (ledgerExtras.investmentHoldings || [])
    .filter((holding) => isAutoPricedHolding(holding, import.meta.env.VITE_ADREEM_STOCK_DISPLAY_LICENSED === 'true'))
    .map((holding) => `${holding.id}:${holding.lastPriceAt || ''}`)
    .sort()
    .join('|'), [ledgerExtras.investmentHoldings])
  const investmentAvailableCashUsdMicros = useMemo(() => new Map(
    investmentSummary.platforms.map((row) => [row.platform.id, row.freeCashUsdMicros]),
  ), [investmentSummary])
  const activeInvestmentPlatforms = useMemo(() => (ledgerExtras.investmentPlatforms || []).filter((platform) => platform.status !== INVESTMENT_RECORD_STATUSES.INACTIVE), [ledgerExtras.investmentPlatforms])
  const investmentPlatformById = useMemo(() => new Map((ledgerExtras.investmentPlatforms || []).map((platform) => [platform.id, platform])), [ledgerExtras.investmentPlatforms])
  const fullNetPosition = useMemo(() => buildNetPosition(balances), [balances])
  const netPosition = useMemo(() => buildNetPosition(balances, netExcludedAccountIds, { portfolioUsdMicros: investmentSummary.totalValueUsdMicros }), [balances, investmentSummary.totalValueUsdMicros, netExcludedAccountIds])

  const movementConfig = movementConfigFor(movementDraft.type)
  const movementSourceRequired = movementNeedsSource(movementDraft.type)
  const movementUsesDimension = movementSupportsDimension(movementDraft.type)
  const normalizedDraft = {
    ...movementDraft,
    amount: parseMoneyAmount(movementDraft.amount, movementConfig.currency || movementDraft.currency),
    currency: movementConfig.currency || movementDraft.currency,
    sourceAccountId: movementSourceRequired ? movementDraft.sourceAccountId : null,
    destinationAccountId: movementConfig.needsDestination ? movementDraft.destinationAccountId : null,
    investmentPlatformId: movementConfig.needsInvestmentPlatform ? movementDraft.investmentPlatformId : null,
    rate: movementDraft.rate === '' ? undefined : parseLocalizedDecimal(movementDraft.rate),
    dimensionId: movementUsesDimension ? movementDraft.dimensionId || '' : '',
    expenseCategoryId: movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? movementDraft.expenseCategoryId || '' : '',
  }
  const editingMovement = editingMovementId
    ? movements.find((movement) => movement.id === editingMovementId)
      || historyRemoteMovements?.find((movement) => movement.id === editingMovementId)
      || editingMovementBaseline
    : null
  const preview = editingMovement
    ? previewMovementEdit(normalizedDraft, editingMovement, accounts, movements, { investmentPlatforms: ledgerExtras.investmentPlatforms, investmentAvailableCashUsdMicros })
    : previewMovement(normalizedDraft, accounts, movements, { investmentPlatforms: ledgerExtras.investmentPlatforms, investmentAvailableCashUsdMicros })
  const movementEditLabels = useMemo(() => ({
    accounts: new Map(accounts.map((account) => [account.id, protectedAccountLabel(account)])),
    dimensions: new Map(activeDimensions.map((dimension) => [dimension.id, preserveUiData(dimension.name)])),
    expenseCategories: new Map(activeExpenseCategories.map((category) => [category.id, preserveUiData(category.ownerName)])),
    platforms: new Map(activeInvestmentPlatforms.map((platform) => [platform.id, preserveUiData(platform.name)])),
  }), [accounts, activeDimensions, activeExpenseCategories, activeInvestmentPlatforms])
  const editingMovementCandidate = editingMovement ? {
    ...editingMovement,
    ...normalizedDraft,
    note: movementDraft.note.trim(),
  } : null
  const editingMovementChanges = editingMovement
    ? movementEditChanges(editingMovement, editingMovementCandidate, movementEditLabels)
    : []
  const movementEditDialogOpen = Boolean(
    editingMovement && editingMovement.status === MOVEMENT_STATUSES.POSTED && activeSection !== 'entry',
  )
  const hasMovementAmount = Number.isFinite(normalizedDraft.amount) && normalizedDraft.amount > 0
  const hasMovementRate = !movementConfig.needsRate || (Number.isFinite(normalizedDraft.rate) && normalizedDraft.rate > 0)
  const hasChosenMovementType = Boolean(editingMovementId || movementDraft.amount || movementDraft.sourceAccountId || movementDraft.destinationAccountId || movementDraft.note)
  const canChooseMovementAccounts = hasMovementAmount && hasMovementRate
  const selectedSourceAccount = accountById.get(movementDraft.sourceAccountId)
  const selectedDestinationAccount = accountById.get(movementDraft.destinationAccountId)
  const localDimensionReports = useMemo(() => buildDimensionReports({ ...ledgerExtras, accounts, movements }), [accounts, movements, ledgerExtras])
  const dimensionReports = serverReports?.dimensions || localDimensionReports
  const dueRules = useMemo(() => dueRecurringRules(ledgerExtras.recurringRules), [ledgerExtras.recurringRules])
  const editingRecurringRule = useMemo(
    () => activeRecurringRuleForMovement(ledgerExtras.recurringRules, editingMovementId),
    [editingMovementId, ledgerExtras.recurringRules],
  )
  const earliestRecurringFirstRunOn = defaultRecurringFirstRunOn(new Date(), 1)
  const normalizedRecurringFirstRunOn = normalizeRecurringDateKey(movementDraft.recurringFirstRunOn)
  const recurringScheduleIsValid = !movementDraft.recurringEnabled || Boolean(
    normalizedRecurringFirstRunOn && normalizedRecurringFirstRunOn >= earliestRecurringFirstRunOn,
  )
  const reconciliationDiffCount = useMemo(() => findUnresolvedReconciliationDifferences(ledgerExtras.reconciliations, movements).length, [ledgerExtras.reconciliations, movements])
  const hasMovementAccounts = (!movementSourceRequired || Boolean(movementDraft.sourceAccountId)) && (!movementConfig.needsDestination || Boolean(movementDraft.destinationAccountId)) && (!movementConfig.needsInvestmentPlatform || Boolean(movementDraft.investmentPlatformId)) && (!movementConfig.needsDestination || !selectedSourceAccount || !sameLogicalAccount(selectedSourceAccount, selectedDestinationAccount))
  const canReviewMovement = canChooseMovementAccounts && hasMovementAccounts && movementStep === MOVEMENT_ENTRY_STEPS.REVIEW
  const selectedBucket = balances.find((bucket) => bucket.account.id === selectedAccountId) || null
  const selectedAccountIsExpenseCategory = isExpenseCategoryAccount(selectedBucket?.account)
  const draftSourceAccount = selectedSourceAccount
  const draftDestinationAccount = selectedDestinationAccount

  useLedgerHydration({
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
  })

  useRemoteLedgerPages({
    accountProfileRequestSequenceRef,
    activeAccountGroup,
    activeSection,
    expenseCategoryFilter,
    expenseRequestSequenceRef,
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
    selectedAccountIsExpenseCategory,
    separateRequestSequenceRef,
    setAccountProfilePage,
    setExpensePage,
    setExpenseRemoteMovements,
    setFeedback,
    setHistoryPage,
    setHistoryRemoteMovements,
    setIsLoadingAccountProfile,
    setIsLoadingExpenses,
    setIsLoadingOlderExpenses,
    setIsLoadingHistory,
    setIsLoadingOlderMovements,
    setIsLoadingReview,
    setIsLoadingSeparateRecords,
    setLedgerExtras,
    setMovements,
    setReviewPage,
    setSeparatePage,
    setTodayRemoteSummary,
  })

  async function changeUiLanguage(language) {
    const nextLanguage = normalizeUiLanguage(language)
    if (nextLanguage === normalizedUiLanguage || languageStatus === 'saving') return
    setLanguageStatus('saving')
    setLanguageMessage('')
    try {
      const profile = await updateAdreemUserProfile({ language: nextLanguage })
      if (!profile?.language) throw new Error('profile-language-not-confirmed')
      const confirmedLanguage = rememberUiLanguage(profile.language)
      setUserProfile(profile)
      setUiLanguage(confirmedLanguage)
      setLanguageStatus('saved')
    } catch {
      setLanguageStatus('error')
      setLanguageMessage('تعذر حفظ اللغة. حاول مرة أخرى.')
    }
  }

  useLedgerAutosave({
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
  })

  const {
    loadOlderExpenses,
    loadOlderMovements,
    loadOlderReviewMovements,
    loadOlderAccountProfileMovements,
    loadCompleteAccountStatement,
  } = useLedgerPaging({
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
  })

  const {
    loadOlderSeparateRecords,
    updateSeparateDraft,
    closeSeparateEditor,
    editSeparateRecord,
    saveSeparateRecord,
    toggleSeparateRecordPinned,
    archiveSeparateRecord,
  } = useSeparateRecordActions({
    accounts,
    editingSeparateRecordId,
    isLoadingSeparateRecords,
    movements,
    separateDraft,
    separatePage,
    separateRecordSaveLockRef,
    separateRequestSequenceRef,
    setEditingSeparateRecordId,
    setFeedback,
    setIsLoadingSeparateRecords,
    setIsSavingSeparateRecord,
    setIsSeparateEditorOpen,
    setLedgerExtras,
    setMovements,
    setPendingUndo,
    setSeparateDraft,
    setSeparatePage,
  })

  async function requestCloudLogout() {
    const terminalSaveFailure = saveStatus === 'failed' || saveStatus === 'local-only'
    if ((!terminalSaveFailure && saveCoordinatorRef.current?.hasPending()) || pendingUploadedAttachmentPathsRef.current.size) {
      setFeedback('انتظر اكتمال حفظ التغييرات والمرفقات قبل تسجيل الخروج.')
      return
    }
    if (terminalSaveFailure) {
      if (!window.confirm(translateUiText('التغيير الأخير لم يُحفظ. تسجيل الخروج سيتجاهله. هل تريد المتابعة؟'))) return
      saveCoordinatorRef.current?.discardFailed()
    }
    await logoutFromCloudSession()
  }

  useLedgerOverlayEffects({
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
  })

  function commitFlowChange(update, direction = 'forward', scope = 'flow') {
    if (typeof document === 'undefined') {
      update()
      return
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      update()
      return
    }
    const root = document.documentElement
    const motionSequence = motionSequenceRef.current + 1
    motionSequenceRef.current = motionSequence
    const motionClasses = [
      'adreem-flow-forward',
      'adreem-flow-back',
      'adreem-mode-forward',
      'adreem-mode-back',
      'adreem-section-forward',
      'adreem-section-back',
      'adreem-motion-fallback',
    ]
    const directionClass = `adreem-${scope}-${direction === 'back' ? 'back' : 'forward'}`
    const clearMotion = () => {
      if (motionSequenceRef.current !== motionSequence) return
      root.classList.remove(...motionClasses)
      motionTimerRef.current = null
      viewTransitionRef.current = null
    }

    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current)
    viewTransitionRef.current?.skipTransition?.()
    viewTransitionRef.current = null
    root.classList.remove(...motionClasses)
    root.classList.add(directionClass)

    if (scope === 'section' || scope === 'mode' || typeof document.startViewTransition !== 'function') {
      root.classList.add('adreem-motion-fallback')
      flushSync(update)
      motionTimerRef.current = window.setTimeout(clearMotion, 240)
      return
    }
    try {
      const transition = document.startViewTransition(() => {
        flushSync(update)
      })
      viewTransitionRef.current = transition
      transition.finished.catch(() => {}).finally(clearMotion)
    } catch {
      clearMotion()
      update()
    }
  }

  const {
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
  } = useBalanceNavigation({
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
  })

  function switchSection(section) {
    if (section === activeSection) return
    const currentIndex = sectionOrder.indexOf(activeSection)
    const targetIndex = sectionOrder.indexOf(section)
    commitFlowChange(
      () => {
        if (section !== 'accounts') closeNetPanel()
        setActiveSection(section)
      },
      targetIndex >= currentIndex ? 'forward' : 'back',
      'section',
    )
  }

  const visibleMovementSteps = movementVisibleSteps(movementConfig, movementSourceRequired)
  const currentMovementStepIndex = Math.max(0, visibleMovementSteps.indexOf(movementStep))
  const {
    updateMovementDraft,
    chooseMovementType,
    advanceMovementStep,
    retreatMovementStep,
    goToAccountWizardStep,
    advanceAccountWizard,
    retreatAccountWizard,
    switchEntryMode,
    handleEntryModeKeyDown,
    editMovementStep,
    movementSourceSplit,
    movementAccountsFor,
    movementReferenceAccountsFor,
    preferredMovementAccountIds,
    chooseAccountPreset,
    chooseAccountPresetGroup,
  } = useEntryFlow({
    accounts,
    accountWizardNextStep,
    accountWizardPreviousStep,
    accountWizardStageKeys,
    activeEntryModeRef,
    balanceByAccountId,
    canAdvanceAccountWizard,
    commitFlowChange,
    currentAccountWizardStep,
    currentMovementStepIndex,
    draftDestinationAccount,
    draftSourceAccount,
    editingMovement,
    editingMovementId,
    hasAccountDraftName,
    movementConfig,
    movementDraft,
    movementSourceRequired,
    movementStep,
    selectedAccountPreset,
    setAccountDraft,
    setAccountWizardStep,
    setActiveAccountDetail,
    setActiveAccountPresetGroup,
    setActiveAccountPresetKey,
    setActiveEntryMode,
    setMovementDraft,
    setMovementEditStage,
    setMovementStep,
    visibleMovementSteps,
  })

  const currentMovementStepCopy = movementStepCopy(movementStep, movementConfig)

  const {
    saveMovement,
    requestMovementCancellation,
    confirmMovementAction,
    undoPendingMovement,
    closeMovementEditor,
    editReviewMovement,
    resolveReviewMovement,
    runRecurring,
    disableRecurring,
    changeRecurringDate,
  } = useMovementActions({
    accounts,
    activeEntryModeRef,
    editingMovementBaseline,
    editingMovementId,
    editingRecurringRule,
    historyRemoteMovements,
    investmentAvailableCashUsdMicros,
    isSavingMovement,
    ledgerExtras,
    movementAttachmentFile,
    movementDraft,
    movements,
    movementSaveLockRef,
    normalizedDraft,
    pendingMovementAction,
    pendingUndo,
    pendingUploadedAttachmentPathsRef,
    setActiveEntryMode,
    setEditingMovementBaseline,
    setEditingMovementId,
    setFeedback,
    setHistoryRemoteMovements,
    setIsSavingMovement,
    setLedgerExtras,
    setMovementAttachmentFile,
    setMovementDraft,
    setMovementEditStage,
    setMovements,
    setMovementStep,
    setPendingMovementAction,
    setPendingUndo,
    setSelectedAccountId,
    switchSection,
  })

  const {
    addAccount,
    updateAccountClassification,
    addAccountAttachment,
    deleteAttachment,
    disableAccount,
    deleteAccountPermanently,
  } = useAccountActions({
    accountAttachmentLockRef,
    accountCreationLockRef,
    accountDraft,
    accountDraftNameValue,
    accountIsCounterpartyBundle,
    accounts,
    balanceByAccountId,
    initialState,
    isDeletingAccount,
    ledgerExtras,
    ledgerRevision,
    ledgerStorageMode,
    movements,
    pendingUploadedAttachmentPathsRef,
    saveCoordinatorRef,
    setAccountDraft,
    setAccountProfilePage,
    setAccountQuery,
    setAccounts,
    setAccountWizardStep,
    setActiveAccountDetail,
    setActiveAccountPresetGroup,
    setActiveAccountPresetKey,
    setFeedback,
    setFocusedCounterpartyId,
    setHistoryAccountId,
    setHistoryPage,
    setHistoryRemoteMovements,
    setIsAddingAccountAttachment,
    setIsDeletingAccount,
    setLedgerExtras,
    setLedgerRevision,
    setMovementPage,
    setMovements,
    setReviewPage,
    setSaveStatus,
    setSelectedAccountId,
    setServerReports,
    setSyncProblem,
    setTodayRemoteSummary,
  })

  const {
    resolveReviewAccount,
    mergeReviewAccount,
    addExternalAccount,
    ignoreExternalAccount,
  } = useReviewActions({
    accountCreationLockRef,
    accounts,
    ledgerExtras,
    movements,
    setAccounts,
    setFeedback,
    setLedgerExtras,
    setMovements,
  })

  const {
    addInvestmentPlatform,
    transferBetweenInvestmentPlatforms,
    addInvestmentHolding,
    addInvestmentTrade,
    editInvestmentTrade,
    closeSmallInvestment,
    openInvestmentFunding,
    updateInvestmentManualPrice,
    refreshInvestmentPrices,
  } = useInvestmentActions({
    activeEntryModeRef,
    investmentPriceRefreshRef,
    investmentSummary,
    isRefreshingInvestmentPrices,
    ledgerExtras,
    movements,
    setActiveEntryMode,
    setEditingMovementBaseline,
    setEditingMovementId,
    setFeedback,
    setInvestmentPriceErrors,
    setIsRefreshingInvestmentPrices,
    setLedgerExtras,
    setMovementDraft,
    setMovementStep,
    switchSection,
  })

  usePortfolioPriceRefresh({
    automaticInvestmentPriceAttemptRef,
    investmentPriceRefreshRef,
    investmentPriceRefreshSignature,
    isRefreshingInvestmentPrices,
    ledgerExtras,
    refreshInvestmentPrices,
  })

  function renderSection() {
    if (activeSection === 'entry') {
      return null
    }
    if (activeSection === 'accounts') return <BalancesSection
        accountById={accountById}
        accountQuery={accountQuery}
        activeAccountGroup={activeAccountGroup}
        activeDimensions={activeDimensions}
        activeExpenseCategories={activeExpenseCategories}
        archiveSeparateRecord={archiveSeparateRecord}
        balanceFocus={balanceFocus}
        balanceOverview={balanceOverview}
        balancesByKind={balancesByKind}
        changeRecurringDate={changeRecurringDate}
        closeNetPanel={closeNetPanel}
        closeSeparateEditor={closeSeparateEditor}
        counterpartyBalanceFilter={counterpartyBalanceFilter}
        dimensionReports={dimensionReports}
        disableRecurring={disableRecurring}
        dueRules={dueRules}
        deleteAttachment={deleteAttachment}
        editingSeparateRecordId={editingSeparateRecordId}
        editReviewMovement={editReviewMovement}
        editSeparateRecord={editSeparateRecord}
        expenseCategoryFilter={expenseCategoryFilter}
        expenseHasMore={ledgerStorageMode === 'relational' ? Boolean(expensePage?.hasMore) : Boolean(movementPage?.hasMore)}
        expenseMovements={expenseMovements}
        focusedCounterpartyId={focusedCounterpartyId}
        fullNetPosition={fullNetPosition}
        handleAccountGroupKeyDown={handleAccountGroupKeyDown}
        investmentSummary={investmentSummary}
        investmentPlatformById={investmentPlatformById}
        isLoadingExpenses={isLoadingExpenses}
        isLoadingOlderExpenses={ledgerStorageMode === 'relational' ? isLoadingOlderExpenses : isLoadingOlderMovements}
        isLoadingSeparateRecords={isLoadingSeparateRecords}
        isNetOpen={isNetOpen}
        isSavingSeparateRecord={isSavingSeparateRecord}
        isSeparateEditorOpen={isSeparateEditorOpen}
        ledgerExtras={ledgerExtras}
        loadOlderExpenses={ledgerStorageMode === 'relational' ? loadOlderExpenses : loadOlderMovements}
        loadOlderSeparateRecords={loadOlderSeparateRecords}
        netAccountQuery={netAccountQuery}
        netEurRate={netEurRate}
        netExcludedAccountIds={netExcludedAccountIds}
        netPosition={netPosition}
        netRate={netRate}
        netTargetCurrency={netTargetCurrency}
        netTryRate={netTryRate}
        openBalanceFocus={openBalanceFocus}
        openDimensionHistory={openDimensionHistory}
        openExpenseCategoryCreator={openExpenseCategoryCreator}
        requestMovementCancellation={requestMovementCancellation}
        resetTemporaryNet={resetTemporaryNet}
        runRecurring={runRecurring}
        saveSeparateRecord={saveSeparateRecord}
        selectAccountGroup={selectAccountGroup}
        separateDraft={separateDraft}
        separateNames={separateNames}
        separatePage={separatePage}
        separateQuery={separateQuery}
        separateRecords={separateRecords}
        separateTotals={separateTotals}
        setAccountQuery={setAccountQuery}
        setBalanceFocus={setBalanceFocus}
        setCounterpartyBalanceFilter={setCounterpartyBalanceFilter}
        setExpenseCategoryFilter={setExpenseCategoryFilter}
        setFocusedCounterpartyId={setFocusedCounterpartyId}
        setIsSeparateEditorOpen={setIsSeparateEditorOpen}
        setNetAccountQuery={setNetAccountQuery}
        setNetEurRate={setNetEurRate}
        setNetRate={setNetRate}
        setNetTargetCurrency={setNetTargetCurrency}
        setNetTryRate={setNetTryRate}
        setSelectedAccountId={setSelectedAccountId}
        setSeparateQuery={setSeparateQuery}
        toggleCounterpartySettlement={toggleCounterpartySettlement}
        toggleNetPanel={toggleNetPanel}
        toggleSeparateRecordPinned={toggleSeparateRecordPinned}
        toggleTemporaryNetAccount={toggleTemporaryNetAccount}
        updateSeparateDraft={updateSeparateDraft}
      />
    if (activeSection === 'investments') return (
      <InvestmentsPanel
        summary={investmentSummary}
        platforms={ledgerExtras.investmentPlatforms || []}
        holdings={ledgerExtras.investmentHoldings || []}
        trades={ledgerExtras.investmentTrades || []}
        transfers={ledgerExtras.investmentTransfers || []}
        movements={movements}
        accounts={accounts}
        isRefreshing={isRefreshingInvestmentPrices}
        priceErrors={investmentPriceErrors}
        onAddPlatform={addInvestmentPlatform}
        onAddHolding={addInvestmentHolding}
        onAddTrade={addInvestmentTrade}
        onTransfer={transferBetweenInvestmentPlatforms}
        onEditTrade={editInvestmentTrade}
        onEditMovement={editReviewMovement}
        onManualPrice={updateInvestmentManualPrice}
        onCloseSmallHolding={closeSmallInvestment}
        onOpenFunding={openInvestmentFunding}
        onRefreshPrices={() => refreshInvestmentPrices(true)}
        onSearchAssets={searchAdreemInvestmentAssets}
        onLoadTryUsdRate={loadAdreemInvestmentTryUsdRate}
      />
    )
    if (activeSection === 'review') return <ReviewSection
        accounts={accounts}
        activeAccounts={activeAccounts}
        activeInvestmentPlatforms={activeInvestmentPlatforms}
        activeReviewItem={activeReviewItem}
        activeReviewPage={activeReviewPage}
        addExternalAccount={addExternalAccount}
        balanceByAccountId={balanceByAccountId}
        disableAccount={disableAccount}
        editReviewMovement={editReviewMovement}
        ignoreExternalAccount={ignoreExternalAccount}
        isLoadingReview={isLoadingReview}
        ledgerStorageMode={ledgerStorageMode}
        loadOlderReviewMovements={loadOlderReviewMovements}
        mergeReviewAccount={mergeReviewAccount}
        movementPage={movementPage}
        requestMovementCancellation={requestMovementCancellation}
        resolveReviewAccount={resolveReviewAccount}
        resolveReviewMovement={resolveReviewMovement}
        reviewItems={reviewItems}
        reviewMovementTotal={reviewMovementTotal}
        setActiveReviewKey={setActiveReviewKey}
      />
    if (activeSection === 'history') return <HistorySection
        accountById={accountById}
        activeDimensions={activeDimensions}
        activeExpenseCategories={activeExpenseCategories}
        activeHistoryPage={activeHistoryPage}
        deleteAttachment={deleteAttachment}
        editReviewMovement={editReviewMovement}
        filteredHistoryMovements={filteredHistoryMovements}
        historyAccountGroups={historyAccountGroups}
        historyAccountId={historyAccountId}
        historyDimensionId={historyDimensionId}
        historyExpenseCategoryId={historyExpenseCategoryId}
        historyGroups={historyGroups}
        historyQuery={historyQuery}
        historyStatus={historyStatus}
        historyType={historyType}
        investmentPlatformById={investmentPlatformById}
        isLoadingHistory={isLoadingHistory}
        isLoadingOlderMovements={isLoadingOlderMovements}
        ledgerExtras={ledgerExtras}
        loadOlderMovements={loadOlderMovements}
        requestMovementCancellation={requestMovementCancellation}
        setHistoryAccountId={setHistoryAccountId}
        setHistoryDimensionId={setHistoryDimensionId}
        setHistoryExpenseCategoryId={setHistoryExpenseCategoryId}
        setHistoryQuery={setHistoryQuery}
        setHistoryStatus={setHistoryStatus}
        setHistoryType={setHistoryType}
      />
    return null
  }

  const storageText = storageTextForStatus(saveStatus, storageMode)
  const canLogout = storageMode === 'api'
  const canOpenAdmin = storageMode === 'api' && canManageUsers
  const activeSectionTitle = sectionTitles[activeSection] || 'ADREEM'
  const {
    completedMovementReceipt,
  } = movementReceipts({
    currentMovementStepIndex,
    draftDestinationAccount,
    draftSourceAccount,
    investmentPlatformById,
    movementConfig,
    movementDraft,
    movementSourceRequired,
    visibleMovementSteps,
  })
  const completedAccountStages = accountWizardStages.slice(0, currentAccountWizardIndex).map((step) => ({
    key: step.key,
    step: step.key,
    label: step.title,
    value: step.key === ACCOUNT_WIZARD_STEPS.NAME ? preserveUiData(step.summary) : step.summary,
  }))

  if (!isHydrated || loadFailed || !ledgerFontsReady) {
    return (
      <LedgerOpeningScreen activeSection={activeSection} sectionTitle={activeSectionTitle} direction={uiDirection} language={normalizedUiLanguage} failed={isHydrated && loadFailed} onRetry={() => window.location.reload()} onSignIn={logoutFromCloudSession} />
    )
  }

  return (
    <MotionConfig reducedMotion="user" transition={UI_MOTION_TRANSITION}>
      <AdreemChrome activeSection={activeSection} activeSectionTitle={activeSectionTitle} saveStatus={saveStatus} storageText={storageText} todayCount={todayMovementCount} reviewCount={reviewItems.length} canOpenAdmin={canOpenAdmin} canLogout={canLogout} profile={protectedUserProfile(userProfile)} language={normalizedUiLanguage} languageStatus={languageStatus} languageMessage={languageMessage} onLanguageChange={changeUiLanguage} onRetrySave={() => {
      if (!orphanCleanupInProgressRef.current) saveCoordinatorRef.current?.retryNow()
    }} onReloadConfirmed={() => {
      if (typeof window === 'undefined') return
      if (window.confirm('سيتم فتح آخر نسخة حفظتها السحابة. هل تريد المتابعة؟')) window.location.reload()
    }} onOpenAdmin={openAdminUsersPage} onLogout={requestCloudLogout} onSectionChange={switchSection}>
      {activeSection !== 'entry' && activeSection !== 'accounts' && activeSection !== 'investments' ? <AlertBoard reviewAccounts={balancesByKind.review} reviewMovements={reviewMovements} externalMissing={unresolvedExternalAccounts} balances={balances} movements={postedUserMovements} totals={totals} dueRecurringCount={dueRules.length} reconciliationDiffCount={reconciliationDiffCount} /> : null}

      <section key={activeSection} className={`ml3-layout ml3-layout--${activeSection} ${activeSection === 'entry' ? 'is-entry' : 'is-content-only'}`}>
        {activeSection === 'entry' ? (
          <aside className={`adreem-entry adreem-desk-entry adreem-entry--${activeEntryMode}`}>
            <div className={`ml3-entry-mode is-${activeEntryMode}`} role="tablist" aria-label="نوع الإضافة" onKeyDown={handleEntryModeKeyDown}>
              <button id="adreem-entry-movement-tab" data-entry-mode="movement" type="button" role="tab" aria-selected={activeEntryMode === 'movement'} aria-controls="adreem-entry-movement-panel" tabIndex={activeEntryMode === 'movement' ? 0 : -1} className={activeEntryMode === 'movement' ? 'is-active' : ''} onClick={() => switchEntryMode('movement')}>
                <ArrowRightLeft aria-hidden="true" size={17} />
                <span>حركة</span>
              </button>
              <button id="adreem-entry-account-tab" data-entry-mode="account" type="button" role="tab" aria-selected={activeEntryMode === 'account'} aria-controls="adreem-entry-account-panel" tabIndex={activeEntryMode === 'account' ? 0 : -1} className={activeEntryMode === 'account' ? 'is-active' : ''} onClick={() => switchEntryMode('account')}>
                <WalletCards aria-hidden="true" size={17} />
                <span>حساب</span>
              </button>
            </div>
            {feedback || pendingUndo || editingMovementId ? (
              <div className="adreem-notice-stack">
                {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
                {pendingUndo ? (
                  <div className="ml3-undo-banner">
                    <span>{pendingUndo.label}</span>
                    <button type="button" onClick={undoPendingMovement}>تراجع</button>
                  </div>
                ) : null}
                {editingMovementId ? (
                  <div className="ml3-edit-banner">
                    <span>تعديل حركة محفوظة</span>
                    <button
                      type="button"
                      onClick={() => closeMovementEditor()}
                    >
                      ترك
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {<MovementEntryForm
        activeDimensions={activeDimensions}
        activeEntryMode={activeEntryMode}
        activeExpenseCategories={activeExpenseCategories}
        activeInvestmentPlatforms={activeInvestmentPlatforms}
        advanceMovementStep={advanceMovementStep}
        balanceByAccountId={balanceByAccountId}
        canReviewMovement={canReviewMovement}
        chooseMovementType={chooseMovementType}
        completedMovementReceipt={completedMovementReceipt}
        currentMovementStepCopy={currentMovementStepCopy}
        currentMovementStepIndex={currentMovementStepIndex}
        draftDestinationAccount={draftDestinationAccount}
        draftSourceAccount={draftSourceAccount}
        earliestRecurringFirstRunOn={earliestRecurringFirstRunOn}
        editingRecurringRule={editingRecurringRule}
        editMovementStep={editMovementStep}
        hasChosenMovementType={hasChosenMovementType}
        hasMovementAmount={hasMovementAmount}
        hasMovementRate={hasMovementRate}
        investmentAvailableCashUsdMicros={investmentAvailableCashUsdMicros}
        isSavingMovement={isSavingMovement}
        movementAccountsFor={movementAccountsFor}
        movementAttachmentFile={movementAttachmentFile}
        movementConfig={movementConfig}
        movementDraft={movementDraft}
        movementReferenceAccountsFor={movementReferenceAccountsFor}
        movementSourceRequired={movementSourceRequired}
        movementSourceSplit={movementSourceSplit}
        movementStep={movementStep}
        movementUsesDimension={movementUsesDimension}
        openExpenseCategoryCreator={openExpenseCategoryCreator}
        preferredMovementAccountIds={preferredMovementAccountIds}
        preview={preview}
        recurringScheduleIsValid={recurringScheduleIsValid}
        retreatMovementStep={retreatMovementStep}
        saveMovement={saveMovement}
        setMovementAttachmentFile={setMovementAttachmentFile}
        switchSection={switchSection}
        updateMovementDraft={updateMovementDraft}
        visibleMovementSteps={visibleMovementSteps}
      />}

            <section className="ml3-today-panel">
                <div className="ml3-today-head">
                  <h2>آخر حركات اليوم</h2>
                  <button type="button" onClick={() => switchSection('history')}>
                    الكل <span>{formatCount(todayMovementCount)}</span>
                  </button>
                </div>
                <div className="ml3-today-list">
                  {todayMovementCount === 0 ? <p className="ml3-empty">لا توجد حركات اليوم.</p> : null}
                  {todayPreviewMovements.map((movement) => (
                    <MovementMiniRow key={movement.id} movement={movement} accountById={accountById} investmentPlatformById={investmentPlatformById} attachments={ledgerExtras.attachments || []} dimensions={activeDimensions} onEdit={editReviewMovement} onCancel={requestMovementCancellation} onDeleteAttachment={deleteAttachment} />
                  ))}
                </div>
            </section>
            {<AccountWizardForm
        accountDraft={accountDraft}
        accountDraftNameValue={accountDraftNameValue}
        accountIsCounterpartyBundle={accountIsCounterpartyBundle}
        accountNeedsCurrencyChoice={accountNeedsCurrencyChoice}
        accountNeedsOpeningBalance={accountNeedsOpeningBalance}
        accountOpeningSummary={accountOpeningSummary}
        accountWizardHint={accountWizardHint}
        accountWizardPrompt={accountWizardPrompt}
        accountWizardStages={accountWizardStages}
        activeAccountDetail={activeAccountDetail}
        activeAccountPresetGroup={activeAccountPresetGroup}
        activeAccountPresetKey={activeAccountPresetKey}
        activeEntryMode={activeEntryMode}
        addAccount={addAccount}
        advanceAccountWizard={advanceAccountWizard}
        canAdvanceAccountWizard={canAdvanceAccountWizard}
        chooseAccountPreset={chooseAccountPreset}
        chooseAccountPresetGroup={chooseAccountPresetGroup}
        completedAccountStages={completedAccountStages}
        currentAccountWizardIndex={currentAccountWizardIndex}
        currentAccountWizardStep={currentAccountWizardStep}
        goToAccountWizardStep={goToAccountWizardStep}
        hasAccountDraftName={hasAccountDraftName}
        retreatAccountWizard={retreatAccountWizard}
        selectedAccountDetails={selectedAccountDetails}
        selectedAccountPreset={selectedAccountPreset}
        selectedAccountPresetCopy={selectedAccountPresetCopy}
        selectedAccountPresetGroup={selectedAccountPresetGroup}
        setAccountDraft={setAccountDraft}
        setActiveAccountDetail={setActiveAccountDetail}
      />}
          </aside>
        ) : null}

        {activeSection !== 'entry' ? (
          <section className="ml3-content" key={`content-${activeSection}`}>
            {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
            {pendingUndo ? (
              <div className="ml3-undo-banner">
                <span>{pendingUndo.label}</span>
                <button type="button" onClick={undoPendingMovement}>
                  تراجع
                </button>
              </div>
            ) : null}
            {renderSection()}
          </section>
        ) : null}
      </section>
      <AccountProfile key={selectedAccountId} bucket={selectedBucket} movements={movements} accounts={accounts} attachments={ledgerExtras.attachments || []} reconciliations={ledgerExtras.reconciliations || []} recurringRules={ledgerExtras.recurringRules || []} dimensions={ledgerExtras.dimensions || []} dimensionReport={dimensionReports.find((report) => report.dimension.linkedAccountId === selectedAccountId) || null} auditEvents={ledgerExtras.auditEvents || []} movementPage={activeAccountProfilePage} isLoadingMovements={isLoadingAccountProfile} isAddingAttachment={isAddingAccountAttachment} isDeletingAccount={isDeletingAccount} onClose={() => setSelectedAccountId('')} onEditMovement={editReviewMovement} onUpdateAccount={updateAccountClassification} onDeleteAccount={deleteAccountPermanently} onAddAttachment={addAccountAttachment} onDeleteAttachment={deleteAttachment} onLoadMoreMovements={loadOlderAccountProfileMovements} onLoadStatement={loadCompleteAccountStatement} onViewDimensionHistory={openDimensionHistory} />
      <AnimatePresence>
        {expenseCategoryCreator ? (
          <ExpenseCategoryDialog
            name={expenseCategoryCreator.name}
            error={expenseCategoryCreator.error}
            isSaving={isSavingExpenseCategory}
            onNameChange={updateExpenseCategoryName}
            onClose={closeExpenseCategoryCreator}
            onSave={saveExpenseCategory}
          />
        ) : null}
        {movementEditDialogOpen ? (
          <MovementEditDialog
            movement={editingMovement}
            draft={movementDraft}
            config={movementConfig}
            preview={preview}
            changes={editingMovementChanges}
            stage={movementEditStage}
            balanceByAccountId={balanceByAccountId}
            sourceAccounts={movementAccountsFor('source')}
            destinationAccounts={movementAccountsFor('destination')}
            sourceReferenceAccounts={movementReferenceAccountsFor('source')}
            destinationReferenceAccounts={movementReferenceAccountsFor('destination')}
            preferredSourceIds={preferredMovementAccountIds('source')}
            preferredDestinationIds={preferredMovementAccountIds('destination')}
            dimensions={activeDimensions}
            expenseCategories={activeExpenseCategories}
            investmentPlatforms={activeInvestmentPlatforms}
            isSaving={isSavingMovement}
            canSave={Boolean(editingMovementChanges.length && preview.validation.ok)}
            onDraftChange={updateMovementDraft}
            onReview={() => editingMovementChanges.length && setMovementEditStage('review')}
            onBack={() => setMovementEditStage('fields')}
            onClose={() => closeMovementEditor()}
            onSave={saveMovement}
          />
        ) : null}
        {pendingMovementAction ? (
          <MovementActionDialog
            action={pendingMovementAction}
            accountById={accountById}
            investmentPlatformById={investmentPlatformById}
            isSaving={isSavingMovement}
            onClose={() => !isSavingMovement && setPendingMovementAction(null)}
            onConfirm={confirmMovementAction}
          />
        ) : null}
      </AnimatePresence>
      </AdreemChrome>
    </MotionConfig>
  )
}
