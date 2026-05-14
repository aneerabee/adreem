import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { seedCustomers, seedTransfers, statusMeta } from './sampleData'
import { computeDailyClosing, createDailyClosingRecord, getTodayKey } from './lib/dailyClosing'
import {
  FILTER_ALL,
  buildCustomerFromDraft,
  buildTransfersFromBatchDraft,
  createEmptyCustomerDraft,
  createEmptyTransferBatchDraft,
  filterTransfers,
  migrateState,
  parseAppStateBackup,
  serializeAppState,
  settleTransfers,
  sortTransfers,
  summarizeCustomers,
  summarizeTransfers,
  transitionTransfer,
} from './lib/transferLogic'
import {
  buildOpeningBalanceEntry,
  buildLegacySettlementEntry,
  createLegacySettlementAdjustmentEntry,
  createOpeningBalanceAdjustmentEntry,
  createOpeningSettlementEntry,
  createProfitClaimEntry,
  summarizeLedgerByCustomer,
  summarizeOfficeLedger,
} from './lib/ledger'
import { getPersistenceMode, loadPersistedState, savePersistedState } from './lib/persistence'
import { saveSnapshot as saveRollingSnapshot } from './lib/snapshots'
import {
  parseViewerCustomerId,
  isViewerCustomerValid,
  filterStateForViewer,
} from './lib/viewerMode'
import { buildSettlementHistory, summarizeSettlementHistory } from './lib/settlementHistory'
import { buildAttentionAlerts } from './lib/attentionBoard'
import {
  canCancelTransfer,
  canPermanentlyDeleteTransfer,
  cancelTransferSafely,
  getTransferDeletionSafety,
  summarizeDeletionImpact,
} from './lib/deletionSafety'
import AttentionBoard from './components/AttentionBoard'
import TabNav from './components/TabNav'
import TransfersTab from './components/TransfersTab'
import CustomersTab from './components/CustomersTab'
import SettlementsTab from './components/SettlementsTab'
import DailyClosingTab from './components/DailyClosingTab'
import IssuesTab from './components/IssuesTab'
import TrashTab from './components/TrashTab'
import PeopleTab from './components/PeopleTab'
import PublicTurkishReceivers from './components/PublicTurkishReceivers'
import StatsHero from './components/StatsHero'
import MohammadLedgerApp from './mohammadLedger/MohammadLedgerApp'
import {
  buildPeopleList,
  buildReceiverColorMap,
  deletePersonOverride,
  findDuplicateReferences,
  upsertPersonOverride,
} from './lib/people'

function downloadFile({ fileName, content, contentType }) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildCsv(rows, customersById) {
  const header = [
    'reference', 'customer', 'sender', 'receiver', 'status', 'settled',
    'system_amount', 'customer_amount', 'margin', 'note',
  ]
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const body = rows.map((t) =>
    [
      t.reference,
      customersById.get(t.customerId)?.name || t.receiverName,
      t.senderName,
      t.receiverName || '',
      statusMeta[t.status]?.label || t.status,
      t.settled ? 'نعم' : 'لا',
      t.systemAmount ?? '',
      t.customerAmount ?? '',
      t.margin ?? '',
      t.note || '',
    ].map(esc).join(','),
  )
  return `\uFEFF${[header.join(','), ...body].join('\n')}`
}

const FALLBACK_STATE = migrateState({
  customers: seedCustomers,
  transfers: seedTransfers,
  ledgerEntries: [],
  claimHistory: [],
  dailyClosings: [],
})

const VALID_TABS = new Set(['transfers', 'customers', 'people', 'settlements', 'closing', 'issues', 'trash'])
// In viewer mode, only these tabs are accessible
const VIEWER_VISIBLE_TABS = ['transfers', 'settlements', 'people']

function getTabFromHash() {
  const hash = window.location.hash.replace('#', '')
  return VALID_TABS.has(hash) ? hash : 'transfers'
}

function detectViewerCustomerId() {
  if (typeof window === 'undefined') return null
  return parseViewerCustomerId(window.location.search)
}

function detectPublicListMode() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const value = params.get('list')
  return value === 'turkish-receivers' ? 'turkish-receivers' : null
}

function detectMohammadLedgerMode() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return import.meta.env.VITE_DEFAULT_APP === 'mohammad-ledger' || params.get('app') === 'mohammad-ledger'
}

function App() {
  if (detectMohammadLedgerMode()) {
    return <MohammadLedgerApp />
  }

  // Viewer mode is detected ONCE at mount and never changes during the
  // session. It guarantees this entire tab is treated as read-only and
  // scoped to one customer.
  const [viewerCustomerId] = useState(detectViewerCustomerId)
  const isViewerMode = viewerCustomerId != null
  const [publicListMode] = useState(detectPublicListMode)
  const isPublicList = publicListMode != null

  const importRef = useRef(null)
  const [activeTab, setActiveTab] = useState(() => {
    const initial = getTabFromHash()
    if (viewerCustomerId != null && !VIEWER_VISIBLE_TABS.includes(initial)) {
      return 'transfers'
    }
    return initial
  })
  const [batchTransferDraft, setBatchTransferDraft] = useState(createEmptyTransferBatchDraft)
  const [customerDraft, setCustomerDraft] = useState(createEmptyCustomerDraft)
  const [feedback, setFeedback] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL)
  const [viewMode, setViewMode] = useState('active')
  const [customerFilter, setCustomerFilter] = useState(FILTER_ALL)
  const [sortMode, setSortMode] = useState('smart')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storageMode, setStorageMode] = useState(getPersistenceMode())
  const [isHydrated, setIsHydrated] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // Viewer tabs start in read-only mode and cannot escape it
  const [isReadOnly, setIsReadOnly] = useState(isViewerMode)
  const [saveStatus, setSaveStatus] = useState('idle') // idle|saving|retrying|saved|failed
  const [localStorageFailed, setLocalStorageFailed] = useState(false)
  const [viewerInvalid, setViewerInvalid] = useState(false)
  // Pending undo: when a destructive reset happens, we keep a snapshot of
  // the previous transfer state for 2 minutes so the user can restore it.
  // Shape: { transferId, snapshot, customerName, reference, expiresAt }
  const [pendingUndo, setPendingUndo] = useState(null)
  // Tick used to refresh the undo countdown UI once per second
  const [undoTick, setUndoTick] = useState(0)
  const pendingSaveRef = useRef(0)
  const broadcastChannelRef = useRef(null)
  const [state, setState] = useState(FALLBACK_STATE)

  // In viewer mode, replace the entire state with a customer-scoped slice
  // BEFORE anything downstream sees it. Senders/receivers stay full per
  // user spec (viewer must see real global counts).
  const visibleState = useMemo(() => {
    if (!isViewerMode) return state
    return { ...state, ...filterStateForViewer(state, viewerCustomerId) }
  }, [state, isViewerMode, viewerCustomerId])

  const {
    customers: rawCustomers,
    transfers: rawTransfers,
    ledgerEntries,
    claimHistory,
    dailyClosings,
    senders = [],
    receivers = [],
    transfersForPeopleCounts,
  } = visibleState

  // Active (non-deleted) views — deleted items remain in state for audit/backup
  const customers = useMemo(() => rawCustomers.filter((c) => !c.deletedAt), [rawCustomers])
  const transfers = useMemo(() => rawTransfers.filter((t) => !t.deletedAt), [rawTransfers])
  // PeopleTab uses the FULL transfers list so counts reflect office-wide
  // reality, not just the viewer's slice (per user spec).
  const transfersForPeople = useMemo(() => {
    if (!isViewerMode) return transfers
    return (transfersForPeopleCounts || []).filter((t) => !t.deletedAt)
  }, [isViewerMode, transfers, transfersForPeopleCounts])

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const result = await loadPersistedState(FALLBACK_STATE, migrateState)
      if (cancelled) return
      setStorageMode(result.mode)
      if (result.loadError) {
        setLoadFailed(true)
        setFeedback('تعذر تحميل البيانات — لن يتم الحفظ حتى تُحل المشكلة.')
        return
      }
      // In viewer mode, validate the customer exists before showing data
      if (isViewerMode) {
        if (!isViewerCustomerValid(viewerCustomerId, result.state.customers)) {
          setViewerInvalid(true)
          return
        }
      }
      setState(result.state)
      setIsHydrated(true)
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [isViewerMode, viewerCustomerId])

  const changeTab = useCallback((tab) => {
    setActiveTab(tab)
    window.location.hash = tab
  }, [])

  useEffect(() => {
    function onHashChange() {
      setActiveTab(getTabFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!isHydrated || isReadOnly) return

    pendingSaveRef.current += 1
    let cancelled = false

    async function saveWithRetry() {
      const delays = [0, 1500, 5000] // immediate, then 1.5s, then 5s
      let lastError = null
      for (const delay of delays) {
        if (cancelled) return
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        if (cancelled) return
        try {
          const result = await savePersistedState(state)
          if (!cancelled) {
            setSaveStatus('saved')
            setLocalStorageFailed(!result?.localOk)
          }
          return
        } catch (err) {
          lastError = err
          if (!cancelled) setSaveStatus('retrying')
        }
      }
      if (!cancelled) {
        setSaveStatus('failed')
        console.error('[save] all retries failed:', lastError)
      }
    }

    setSaveStatus('saving')
    saveWithRetry().finally(() => {
      pendingSaveRef.current = Math.max(0, pendingSaveRef.current - 1)
    })

    return () => { cancelled = true }
  }, [isHydrated, isReadOnly, state])

  // Multi-tab protection: newer tab takes over, older becomes read-only
  // but older tab can always reclaim via "take control" button.
  // Viewer tabs are NOT involved in this race — they don't broadcast and
  // don't react to broadcasts.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    if (isViewerMode) return
    const channel = new BroadcastChannel('western-office-presence')
    broadcastChannelRef.current = channel
    const myId = Math.random().toString(36).slice(2)
    channel.postMessage({ type: 'takeover', id: myId })
    channel.onmessage = (e) => {
      if (e.data?.type === 'takeover' && e.data.id !== myId) {
        setIsReadOnly(true)
      }
    }
    return () => {
      channel.close()
      broadcastChannelRef.current = null
    }
  }, [isViewerMode])

  const reclaimControl = useCallback(() => {
    if (isViewerMode) return // viewer tabs can NEVER escape read-only
    const channel = broadcastChannelRef.current
    if (!channel) return
    const myId = Math.random().toString(36).slice(2)
    channel.postMessage({ type: 'takeover', id: myId })
    setIsReadOnly(false)
    setFeedback('استعدت السيطرة. التبويبات الأخرى أصبحت للقراءة فقط.')
  }, [isViewerMode])

  // Warn before closing tab if a save is in flight
  useEffect(() => {
    function onBeforeUnload(e) {
      if (pendingSaveRef.current > 0) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Automatic daily closing: whenever the date has passed, save a closing for
  // yesterday (or any missing prior day) — no user action required.
  useEffect(() => {
    if (!isHydrated || isReadOnly) return

    function autoSaveYesterdayClosing() {
      const today = getTodayKey()
      const yesterdayDate = new Date()
      yesterdayDate.setDate(yesterdayDate.getDate() - 1)
      const yesterday = [
        yesterdayDate.getFullYear(),
        String(yesterdayDate.getMonth() + 1).padStart(2, '0'),
        String(yesterdayDate.getDate()).padStart(2, '0'),
      ].join('-')

      setState((s) => {
        // Already have a closing for yesterday? Skip.
        if (s.dailyClosings.some((r) => r.date === yesterday)) return s
        // Don't auto-close today — only past days
        if (yesterday >= today) return s

        const activeCustomers = s.customers.filter((c) => !c.deletedAt)
        const activeTransfers = s.transfers.filter((t) => !t.deletedAt)
        const customerSnapshot = summarizeCustomers(activeCustomers, activeTransfers, s.ledgerEntries)
        const nonClaimLedger = s.ledgerEntries.filter((e) => e.type !== 'profit_claim')
        const officeSnapshot = summarizeOfficeLedger(
          activeCustomers,
          activeTransfers,
          [...nonClaimLedger, ...s.claimHistory],
        )
        const closing = computeDailyClosing(
          activeTransfers,
          customerSnapshot,
          officeSnapshot,
          s.claimHistory,
          yesterday,
        )
        const record = { ...createDailyClosingRecord(closing), autoSaved: true }
        const nextDailyClosings = [...s.dailyClosings, record]
          .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        return { ...s, dailyClosings: nextDailyClosings }
      })
    }

    // Run once immediately on mount/hydration
    autoSaveYesterdayClosing()
    // Then check every 5 minutes — catches midnight rollover while app is open
    const interval = setInterval(autoSaveYesterdayClosing, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isHydrated, isReadOnly])

  // Automatic daily backup download (silent, only first load of new day)
  // CRITICAL: never runs in read-only/viewer mode — would otherwise leak
  // the full office state as a downloaded file to the viewer's machine.
  useEffect(() => {
    if (!isHydrated) return
    if (isReadOnly) return
    const BACKUP_KEY = 'western-office-last-daily-backup'
    const DAY_MS = 24 * 60 * 60 * 1000
    try {
      const last = Number(window.localStorage.getItem(BACKUP_KEY) || 0)
      if (Date.now() - last >= DAY_MS) {
        const stamp = new Date().toISOString().slice(0, 10)
        downloadFile({
          fileName: `western-office-auto-backup-${stamp}.json`,
          content: serializeAppState(state),
          contentType: 'application/json;charset=utf-8;',
        })
        window.localStorage.setItem(BACKUP_KEY, String(Date.now()))
      }
    } catch {
      // localStorage unavailable — skip silently
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated])

  // Rolling snapshots — keep up to 5 historical copies of state in
  // localStorage, throttled to once per hour. A safety net in case the
  // current save becomes corrupted or inadvertently empties a collection.
  useEffect(() => {
    if (!isHydrated || isReadOnly) return
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      saveRollingSnapshot(window.localStorage, state)
    } catch (err) {
      console.warn('[snapshots] failed:', err?.message || err)
    }
  }, [isHydrated, isReadOnly, state])

  // Viewer/public mode live updates — poll Supabase every 15 seconds AND
  // whenever the tab regains focus, so external viewers see admin edits
  // without manually refreshing. Read-only by design — no writes happen here.
  useEffect(() => {
    if (!isViewerMode && !isPublicList) return
    if (!isHydrated) return
    if (typeof window === 'undefined') return

    let cancelled = false

    async function refetch() {
      try {
        const result = await loadPersistedState(FALLBACK_STATE, migrateState)
        if (cancelled) return
        if (result.loadError) return // silent failure — try again next poll
        if (isViewerMode && !isViewerCustomerValid(viewerCustomerId, result.state.customers)) {
          setViewerInvalid(true)
          return
        }
        setState(result.state)
      } catch {
        // Network hiccup — silent. Next interval will retry.
      }
    }

    const interval = setInterval(refetch, 15000)

    function onVisibilityChange() {
      if (!document.hidden) refetch()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isViewerMode, isPublicList, isHydrated, viewerCustomerId])

  const customersById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  )
  // Includes deleted customers — used in TrashTab so deleted transfers still show names
  const allCustomersById = useMemo(
    () => new Map(rawCustomers.map((c) => [c.id, c])),
    [rawCustomers],
  )

  const filteredTransfers = useMemo(() => {
    const filtered = filterTransfers(
      transfers,
      { searchTerm, statusFilter, viewMode, customerFilter, dateFrom, dateTo },
      customersById,
    )
    return sortTransfers(filtered, sortMode, customersById)
  }, [customerFilter, customersById, dateFrom, dateTo, searchTerm, viewMode, sortMode, statusFilter, transfers])

  const transferSummary = useMemo(
    () => summarizeTransfers(transfers, ledgerEntries, customers),
    [transfers, ledgerEntries, customers],
  )
  const customerSummary = useMemo(
    () => summarizeCustomers(customers, transfers, ledgerEntries),
    [customers, ledgerEntries, transfers],
  )
  const officeSummary = useMemo(
    () => {
      const nonClaimLedger = ledgerEntries.filter((e) => e.type !== 'profit_claim')
      return summarizeOfficeLedger(customers, transfers, [...nonClaimLedger, ...claimHistory])
    },
    [claimHistory, customers, ledgerEntries, transfers],
  )

  // Attention board alerts — proactive list of things that need action
  // today. Hidden in viewer mode (this is an admin-only signal).
  const attentionAlerts = useMemo(() => {
    if (isViewerMode) return []
    return buildAttentionAlerts({
      transfers,
      customers,
      ledgerEntries,
      officeSummary,
    })
  }, [isViewerMode, transfers, customers, ledgerEntries, officeSummary])

  function handleAttentionAction(action) {
    if (!action) return
    if (action.type === 'claim-profit') {
      handleClaimProfit()
      return
    }
    if (action.type === 'filter-transfers') {
      changeTab('transfers')
      if (action.search) setSearchTerm(action.search)
      return
    }
  }

  // Viewer-mode financial summary: total amount the customer has already
  // received from settled history. Combined with officeCustomerLiability
  // (what we still owe him), this gives the viewer his complete financial
  // picture without exposing any office-internal numbers.
  const viewerSettledTotal = useMemo(() => {
    if (!isViewerMode) return null
    const history = buildSettlementHistory(transfers, ledgerEntries, customers)
    const summary = summarizeSettlementHistory(history)
    return summary.totalCustomer
  }, [isViewerMode, transfers, ledgerEntries, customers])

  const issueCount = transferSummary.issueCount

  // Any mutation handler must call this first. Returns true if the mutation
  // should be skipped because another tab has taken control of the app.
  function blockIfReadOnly() {
    if (isReadOnly) {
      setFeedback('🔒 هذا التبويب للقراءة فقط — اضغط "استعادة السيطرة" أعلى الصفحة للتعديل.')
      return true
    }
    if (loadFailed) {
      setFeedback('⚠️ فشل تحميل البيانات — لا يمكن التعديل حتى تُحلّ المشكلة.')
      return true
    }
    return false
  }

  function patchTransfer(id, updater) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === id ? updater(t) : t)),
    }))
  }

  function deleteTransfer(id) {
    if (blockIfReadOnly()) return false
    const transfer = transfers.find((t) => t.id === id)
    if (!transfer) return false
    const safety = getTransferDeletionSafety(transfer, ledgerEntries)
    if (!safety.ok) {
      setFeedback(`لا يمكن إلغاء هذه الحوالة: ${safety.reasons.join(' ')}`)
      return false
    }
    const now = new Date().toISOString()
    const impact = summarizeDeletionImpact(transfers, [id])
    if (impact.financialChanged) {
      setFeedback('تم إيقاف الإلغاء لأن الفحص وجد أثرا ماليا غير متوقع.')
      return false
    }
    const defaultReason = transfer.status === 'issue' ? 'إلغاء حوالة مشكلة' : 'إلغاء حوالة غير مكتملة'
    const reason = window.prompt('سبب الإلغاء؟ سيبقى محفوظا مع الحوالة في المحذوفات.', defaultReason)
    if (reason === null) return false
    const lines = [
      'إلغاء آمن للحوالة',
      '',
      `الرقم: ${transfer.reference || 'بدون رقم'}`,
      `الحالة: ${statusMeta[transfer.status]?.label || transfer.status}`,
      `الحوالات النشطة: ${impact.activeBefore} → ${impact.activeAfter}`,
      '',
      'الأرصدة والربح والتسويات لن تتغير.',
      'يمكن استعادتها من المحذوفات.',
      '',
      'تأكيد الإلغاء؟',
    ]
    if (!window.confirm(lines.join('\n'))) return false
    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === id ? cancelTransferSafely(t, reason, now) : t)),
    }))
    setFeedback('تم إلغاء الحوالة بأمان — يمكن استعادتها من المحذوفات.')
    return true
  }

  function restoreTransfer(id) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, deletedAt: null } : t)),
    }))
    setFeedback('تمت استعادة الحوالة.')
  }

  function permanentlyDeleteTransfer(id) {
    if (blockIfReadOnly()) return false
    const transfer = rawTransfers.find((t) => t.id === id)
    if (!transfer) return false
    const safety = getTransferDeletionSafety(transfer, ledgerEntries, { requireDeleted: true })
    if (!safety.ok) {
      setFeedback(`لا يمكن الحذف النهائي: ${safety.reasons.join(' ')}`)
      return false
    }
    const phrase = window.prompt(
      [
        'حذف نهائي للحوالة من قاعدة البيانات.',
        `الرقم: ${transfer.reference || 'بدون رقم'}`,
        'لن تتغير الأرصدة لأنها ملغاة مسبقا، لكن لن تظهر في المحذوفات بعد ذلك.',
        '',
        'للتأكيد اكتب: حذف نهائي',
      ].join('\n'),
    )
    if (phrase !== 'حذف نهائي') {
      setFeedback('لم يتم الحذف النهائي — عبارة التأكيد غير مطابقة.')
      return false
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadFile({
      fileName: `western-office-before-permanent-delete-${stamp}.json`,
      content: serializeAppState(state),
      contentType: 'application/json;charset=utf-8;',
    })
    setState((s) => ({
      ...s,
      transfers: s.transfers.filter((t) => t.id !== id),
    }))
    setFeedback('تم الحذف النهائي بعد إنشاء نسخة أمان تلقائية.')
    return true
  }

  function restoreCustomer(id) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      customers: s.customers.map((c) => (c.id === id ? { ...c, deletedAt: null } : c)),
    }))
    setFeedback('تمت استعادة الزبون.')
  }

  // ── Reset-to-new with undo ────────────────────────────────────────────
  // Auto-clear pending undo after 2 minutes
  useEffect(() => {
    if (!pendingUndo) return
    const remaining = pendingUndo.expiresAt - Date.now()
    if (remaining <= 0) {
      setPendingUndo(null)
      return
    }
    const timer = setTimeout(() => setPendingUndo(null), remaining)
    return () => clearTimeout(timer)
  }, [pendingUndo])

  // Tick countdown once per second so the banner shows seconds remaining
  useEffect(() => {
    if (!pendingUndo) return
    const interval = setInterval(() => setUndoTick((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [pendingUndo])

  /**
   * Reset a single transfer back to the "received" (new) status, wiping
   * its amounts and dates. Called from any tab via the onResetTransfer
   * callback. Shows a rich confirmation dialog and registers a 2-minute
   * undo snapshot.
   */
  function resetTransferToNew(item) {
    if (blockIfReadOnly()) return
    if (!item || !item.id) return

    const customer = rawCustomers.find((c) => c.id === item.customerId)
    const customerName = customer?.name || 'غير معروف'

    const lines = [
      '⚠ تنبيه — إعادة حوالة واحدة فقط إلى حالة "جديدة"',
      '',
      `رقم الحوالة: ${item.reference || '(بدون رقم)'}`,
      `الزبون: ${customerName}`,
    ]
    if (item.senderName) lines.push(`المرسل: ${item.senderName}`)
    if (item.receiverName) lines.push(`المستلم: ${item.receiverName}`)
    lines.push('')
    lines.push('سيتم حذف هذه البيانات من هذه الحوالة فقط:')
    if (item.transferAmount != null) lines.push(`• مبلغ الحوالة: ${item.transferAmount}`)
    if (item.systemAmount != null) lines.push(`• مبلغ الموظف: ${item.systemAmount}`)
    if (item.customerAmount != null) lines.push(`• مبلغ الزبون: ${item.customerAmount}`)
    if (item.margin != null) lines.push(`• الربح: ${item.margin}`)
    if (item.pickedUpAt) lines.push('• تاريخ السحب')
    if (item.settledAt) lines.push('• تاريخ التسوية وعلامة "تمت التسوية"')
    if (item.issueAt) lines.push('• تاريخ المشكلة ونوعها')
    if (item.sentAt) lines.push('• تاريخ الإرسال للموظف')
    lines.push('')
    lines.push('✅ باقي حوالاتك لن تتأثر إطلاقاً.')
    lines.push('⏱ سيظهر زر "تراجع" لمدة دقيقتين بعد التنفيذ.')
    lines.push('')
    lines.push('هل تريد المتابعة؟')

    if (!window.confirm(lines.join('\n'))) return

    // Capture full snapshot before mutation
    const snapshot = { ...item }

    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === item.id ? transitionTransfer(t, 'received') : t)),
    }))

    setPendingUndo({
      transferId: item.id,
      snapshot,
      customerName,
      reference: item.reference || '(بدون رقم)',
      expiresAt: Date.now() + 120 * 1000,
    })
    setFeedback(`تم إعادة الحوالة ${item.reference || ''}. زر التراجع متاح لمدة دقيقتين أعلى الصفحة.`)
  }

  /**
   * Restore the most recent reset transfer to its prior state.
   */
  function performUndo() {
    if (!pendingUndo) return
    const { transferId, snapshot, reference } = pendingUndo
    setState((s) => ({
      ...s,
      transfers: s.transfers.map((t) => (t.id === transferId ? snapshot : t)),
    }))
    setPendingUndo(null)
    setFeedback(`تم استرجاع الحوالة ${reference} إلى حالتها السابقة.`)
  }

  const deletedTransfers = useMemo(
    () => rawTransfers.filter((t) => t.deletedAt).sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()),
    [rawTransfers],
  )
  const deletedCustomers = useMemo(
    () => rawCustomers.filter((c) => c.deletedAt).sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()),
    [rawCustomers],
  )
  const cancellableTransfers = useMemo(
    () => transfers
      .filter((t) => canCancelTransfer(t, ledgerEntries))
      .sort((a, b) => {
        const statusRank = { issue: 0, received: 1, review_hold: 2, with_employee: 3 }
        const ar = statusRank[a.status] ?? 9
        const br = statusRank[b.status] ?? 9
        if (ar !== br) return ar - br
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
      }),
    [transfers, ledgerEntries],
  )
  const cancellableImpact = useMemo(
    () => summarizeDeletionImpact(transfers, cancellableTransfers.map((t) => t.id)),
    [transfers, cancellableTransfers],
  )
  const canPermanentDeleteTransferById = useCallback(
    (id) => canPermanentlyDeleteTransfer(rawTransfers.find((t) => t.id === id), ledgerEntries),
    [rawTransfers, ledgerEntries],
  )

  // Live receiver color map — used by tables to color receiver cells dynamically
  const receiverColorMap = useMemo(
    () => buildReceiverColorMap(transfers, receivers),
    [transfers, receivers],
  )
  // Live set of duplicate reference numbers — used to highlight rows in red
  const duplicateReferences = useMemo(
    () => findDuplicateReferences(transfers),
    [transfers],
  )

  function handleUpsertSender(patch) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      senders: upsertPersonOverride(s.senders || [], patch),
    }))
  }

  function handleUpsertReceiver(patch) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      receivers: upsertPersonOverride(s.receivers || [], patch),
    }))
  }

  function handleDeleteSender(personId) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      senders: deletePersonOverride(s.senders || [], personId),
    }))
    setFeedback('تم حذف المرسل.')
  }

  function handleDeleteReceiver(personId) {
    if (blockIfReadOnly()) return
    setState((s) => ({
      ...s,
      receivers: deletePersonOverride(s.receivers || [], personId),
    }))
    setFeedback('تم حذف المستلم.')
  }

  function handleSettle(transferIds) {
    if (blockIfReadOnly()) return
    if (!window.confirm(`تأكيد تسوية ${transferIds.length} حوالة؟`)) return
    setState((s) => {
      const transferOnlyIds = transferIds
        .filter((id) => !String(id).startsWith('opening:'))
        .map((id) => Number(id))
      const openingCustomerIds = transferIds
        .filter((id) => String(id).startsWith('opening:'))
        .map((id) => Number(String(id).split(':')[1]))

      const activeCustomers = s.customers.filter((c) => !c.deletedAt)
      const activeTransfers = s.transfers.filter((t) => !t.deletedAt)
      const ledgerSummary = summarizeLedgerByCustomer(activeCustomers, activeTransfers, s.ledgerEntries)
      const openingEntries = openingCustomerIds
        .map((customerId) => {
          const ledger = ledgerSummary.get(customerId)
          if (!ledger || ledger.openingOutstandingAmount <= 0) return null
          return createOpeningSettlementEntry(
            customerId,
            ledger.openingOutstandingAmount,
            ledger.openingOutstandingTransferCount,
          )
        })
        .filter(Boolean)

      return {
        ...s,
        transfers: settleTransfers(s.transfers, transferOnlyIds),
        ledgerEntries: openingEntries.length > 0 ? [...s.ledgerEntries, ...openingEntries] : s.ledgerEntries,
      }
    })
    setFeedback(`تمت تسوية ${transferIds.length} عنصر.`)
  }

  function handleClaimProfit() {
    if (blockIfReadOnly()) return
    // Read current claimable amount from the latest state (not stale closure)
    const nonClaimLedger = state.ledgerEntries.filter((entry) => entry.type !== 'profit_claim')
    const currentSummary = summarizeOfficeLedger(
      customers,
      transfers,
      [...nonClaimLedger, ...state.claimHistory],
    )
    const claimedAmount = currentSummary.accountantClaimableProfit

    if (claimedAmount <= 0) {
      setFeedback('لا يوجد ربح متاح للمطالبة الآن.')
      return
    }

    // Confirm BEFORE touching state — pure updater below
    if (!window.confirm(`تأكيد مطالبة ربح بقيمة ${claimedAmount.toFixed(2)}؟`)) return

    const entry = createProfitClaimEntry(claimedAmount)
    setState((s) => ({
      ...s,
      claimHistory: [entry, ...s.claimHistory],
    }))
    setFeedback(`تم تسجيل مطالبة ربح بقيمة ${claimedAmount.toFixed(2)}.`)
  }

  function handleSaveDailyClosing(date) {
    if (blockIfReadOnly()) return
    setState((s) => {
      const activeCustomers = s.customers.filter((c) => !c.deletedAt)
      const activeTransfers = s.transfers.filter((t) => !t.deletedAt)
      const customerSummarySnapshot = summarizeCustomers(activeCustomers, activeTransfers, s.ledgerEntries)
      const nonClaimLedger = s.ledgerEntries.filter((entry) => entry.type !== 'profit_claim')
      const officeSummarySnapshot = summarizeOfficeLedger(
        activeCustomers,
        activeTransfers,
        [...nonClaimLedger, ...s.claimHistory],
      )
      const closing = computeDailyClosing(
        activeTransfers,
        customerSummarySnapshot,
        officeSummarySnapshot,
        s.claimHistory,
        date,
      )
      const record = createDailyClosingRecord(closing)
      // Keep ALL closings — never overwrite previous version for same date
      const nextDailyClosings = [...s.dailyClosings, record]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())

      return {
        ...s,
        dailyClosings: nextDailyClosings,
      }
    })

    setFeedback(`تم حفظ سجل الإقفال ليوم ${date}.`)
  }

  function handleAddCustomer(e) {
    e.preventDefault()
    if (blockIfReadOnly()) return
    // Check name against ALL customers (including soft-deleted) to prevent
    // collision when a deleted customer is later restored from trash.
    const result = buildCustomerFromDraft(customerDraft, rawCustomers)
    if (!result.ok) { setFeedback(result.error); return }
    const openingEntry = buildOpeningBalanceEntry(result.value)
    const legacyEntry = buildLegacySettlementEntry(result.value)
    const newEntries = [openingEntry, legacyEntry].filter(Boolean)
    setState((s) => ({
      ...s,
      customers: [...s.customers, result.value],
      ledgerEntries: newEntries.length > 0 ? [...s.ledgerEntries, ...newEntries] : s.ledgerEntries,
    }))
    setCustomerDraft(createEmptyCustomerDraft())
    setFeedback('تمت إضافة الزبون.')
  }

  function handleUpdateCustomer(customerId, patch) {
    if (blockIfReadOnly()) return
    const trimmedName = typeof patch.name === 'string' ? patch.name.trim().replace(/\s+/g, ' ') : null
    if (trimmedName !== null && !trimmedName) {
      setFeedback('اسم الزبون لا يمكن أن يكون فارغاً.')
      return
    }

    // Prevent zeroing a non-zero opening balance — protects historical data.
    // If the operator truly wants to clear it, they must use settlements instead.
    const existingCustomer = customers.find((c) => c.id === customerId)
    if (existingCustomer) {
      const newOpening = patch.openingBalance !== undefined ? (Number(patch.openingBalance) || 0) : existingCustomer.openingBalance
      const newCount = patch.openingTransferCount !== undefined
        ? Math.max(0, Math.trunc(Number(patch.openingTransferCount) || 0))
        : (existingCustomer.openingTransferCount || 0)
      if ((existingCustomer.openingBalance || 0) > 0 && newOpening === 0) {
        setFeedback('لتصفير الرصيد الافتتاحي استخدم قسم التسويات — لا يمكن تصفيره من نموذج التعديل.')
        return
      }
      if ((existingCustomer.openingTransferCount || 0) > 0 && newCount === 0) {
        setFeedback('لتصفير عدد الحوالات الافتتاحية استخدم قسم التسويات.')
        return
      }
    }

    let error = null
    setState((s) => {
      if (trimmedName && s.customers.some(
        (c) => c.id !== customerId && c.name.toLowerCase() === trimmedName.toLowerCase(),
      )) {
        error = 'اسم الزبون موجود مسبقاً.'
        return s
      }

      const existing = s.customers.find((c) => c.id === customerId)
      if (!existing) { error = 'الزبون غير موجود.'; return s }

      const now = new Date().toISOString()
      const updatedCustomers = s.customers.map((c) => {
        if (c.id !== customerId) return c
        return {
          ...c,
          name: trimmedName ?? c.name,
          openingBalance: patch.openingBalance !== undefined
            ? Number(patch.openingBalance) || 0
            : c.openingBalance,
          settledTotal: patch.settledTotal !== undefined
            ? Number(patch.settledTotal) || 0
            : c.settledTotal,
          openingTransferCount: patch.openingTransferCount !== undefined
            ? Math.max(0, Math.trunc(Number(patch.openingTransferCount) || 0))
            : (c.openingTransferCount || 0),
          phone: patch.phone !== undefined
            ? String(patch.phone || '').trim()
            : (c.phone || ''),
          updatedAt: now,
        }
      })

      const updatedCustomer = updatedCustomers.find((c) => c.id === customerId)

      const newOpening = buildOpeningBalanceEntry(updatedCustomer)
      const newLegacy = buildLegacySettlementEntry(updatedCustomer)
      const openingDelta = (updatedCustomer.openingBalance || 0) - (existing.openingBalance || 0)
      const openingCountDelta =
        (updatedCustomer.openingTransferCount || 0) - (existing.openingTransferCount || 0)
      const legacyDelta = (updatedCustomer.settledTotal || 0) - (existing.settledTotal || 0)

      const nextLedger = [...s.ledgerEntries]

      const existingTypes = new Set(
        s.ledgerEntries
          .filter((entry) => entry.customerId === customerId)
          .map((entry) => entry.type),
      )
      const toAppend = []
      if (newOpening && !existingTypes.has('opening_balance')) toAppend.push(newOpening)
      if (newLegacy && !existingTypes.has('legacy_settlement')) toAppend.push(newLegacy)
      const openingAdjustment = createOpeningBalanceAdjustmentEntry(
        customerId,
        openingDelta,
        openingCountDelta,
      )
      const legacyAdjustment = createLegacySettlementAdjustmentEntry(customerId, legacyDelta)
      if (openingAdjustment) toAppend.push(openingAdjustment)
      if (legacyAdjustment) toAppend.push(legacyAdjustment)

      return {
        ...s,
        customers: updatedCustomers,
        ledgerEntries: toAppend.length > 0 ? [...nextLedger, ...toAppend] : nextLedger,
      }
    })

    if (error) { setFeedback(error); return }
    setFeedback('تم تعديل الزبون.')
  }

  function handleDeleteCustomer(customerId) {
    if (blockIfReadOnly()) return
    const customer = customers.find((c) => c.id === customerId)
    if (!customer) return

    // Block deletion if customer has any active transfers
    const hasTransfers = transfers.some((t) => t.customerId === customerId)
    if (hasTransfers) {
      setFeedback(`لا يمكن حذف "${customer.name}" — لديه حوالات مرتبطة.`)
      return
    }

    const ledgerSummary = summarizeLedgerByCustomer(customers, transfers, ledgerEntries)
    const customerLedger = ledgerSummary.get(customerId)
    if (customerLedger && Math.abs(customerLedger.currentBalance) > 0.0001) {
      setFeedback(`لا يمكن حذف "${customer.name}" — ما زال له رصيد قائم في الحسابات.`)
      return
    }

    if (!window.confirm(`إخفاء الزبون "${customer.name}"؟ (سيبقى محفوظاً في النسخ الاحتياطية مع كل دفاتره)`)) return

    const now = new Date().toISOString()
    setState((s) => ({
      ...s,
      customers: s.customers.map((c) => (c.id === customerId ? { ...c, deletedAt: now } : c)),
      // Ledger entries are preserved untouched — nothing is lost
    }))
    setFeedback(`تم إخفاء الزبون "${customer.name}" — يمكن استعادته من قسم المحذوفات.`)
  }


  function handleAddTransferBatch(e) {
    e.preventDefault()
    if (blockIfReadOnly()) return
    const result = buildTransfersFromBatchDraft(batchTransferDraft, transfers, customers)
    if (!result.ok) { setFeedback(result.error); return }

    setState((s) => ({ ...s, transfers: [...[...result.value].reverse(), ...s.transfers] }))
    setBatchTransferDraft((current) => ({ ...createEmptyTransferBatchDraft(), customerId: current.customerId }))
    const dupPart = result.duplicatesCount > 0
      ? ` · ⚠ ${result.duplicatesCount} منها مكرّرة ومميّزة بالأحمر`
      : ''
    setFeedback(`تمت إضافة ${result.value.length} حوالة للزبون${dupPart}.`)
  }

  function resetFilters() {
    setSearchTerm('')
    setStatusFilter(FILTER_ALL)
    setViewMode('active')
    setCustomerFilter(FILTER_ALL)
    setSortMode('smart')
    setDateFrom('')
    setDateTo('')
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-${today}.csv`,
      content: buildCsv(filteredTransfers, customersById),
      contentType: 'text/csv;charset=utf-8;',
    })
  }

  function exportBackup() {
    const today = new Date().toISOString().slice(0, 10)
    downloadFile({
      fileName: `western-office-backup-${today}.json`,
      content: serializeAppState(state),
      contentType: 'application/json;charset=utf-8;',
    })
  }

  async function handleImportBackup(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (isReadOnly) {
      setFeedback('🔒 هذا التبويب للقراءة فقط — اضغط "استعادة السيطرة" قبل الاسترجاع.')
      e.target.value = ''
      return
    }
    if (!window.confirm('استرجاع النسخة الاحتياطية سيستبدل كل البيانات الحالية. هل أنت متأكد؟')) {
      e.target.value = ''
      return
    }
    try {
      // Auto-backup current state BEFORE replacing — never lose what's there
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadFile({
        fileName: `western-office-auto-before-import-${stamp}.json`,
        content: serializeAppState(state),
        contentType: 'application/json;charset=utf-8;',
      })
      const text = await file.text()
      setState(parseAppStateBackup(text))
      // Restore enables hydration and clears any prior load failure
      setLoadFailed(false)
      setIsHydrated(true)
      setFeedback('تم استرجاع النسخة الاحتياطية.')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'تعذر قراءة النسخة الاحتياطية.')
    } finally {
      e.target.value = ''
    }
  }

  // In viewer mode, look up the customer name to display in the banner
  const viewerCustomer = useMemo(() => {
    if (!isViewerMode) return null
    return customers.find((c) => Number(c.id) === Number(viewerCustomerId)) || null
  }, [customers, isViewerMode, viewerCustomerId])

  // Seconds remaining on the undo banner — recomputed every second via undoTick
  const undoSecondsRemaining = useMemo(() => {
    if (!pendingUndo) return 0
    return Math.max(0, Math.ceil((pendingUndo.expiresAt - Date.now()) / 1000))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUndo, undoTick])

  // Invalid viewer URL (customer not found / deleted) — show error page only
  if (viewerInvalid) {
    return (
      <div className={`app-shell${isViewerMode ? ' viewer-mode' : ''}`} dir="rtl">
        <div className="error-banner" style={{ marginTop: 40, fontSize: '1.05rem', padding: 24 }}>
          🚫 هذا الرابط غير صالح — الزبون غير موجود أو تم حذفه. تواصل مع المكتب للحصول على رابط جديد.
        </div>
      </div>
    )
  }

  // Public list mode: render minimal Turkish receivers list, no app shell
  if (isPublicList && publicListMode === 'turkish-receivers') {
    return (
      <PublicTurkishReceivers
        transfers={transfers}
        receivers={receivers}
      />
    )
  }

  return (
    <div className={`app-shell${isViewerMode ? ' viewer-mode' : ''}`} dir="rtl">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Western Office</h1>
          {isViewerMode ? (
            <span className="storage-badge" style={{ background: '#1e40af', color: '#fff' }}>
              👁 مشاهدة فقط
            </span>
          ) : (
            <>
              <span className="storage-badge">
                {storageMode === 'supabase' ? 'سحابي' : 'محلي'}
              </span>
              <span className="storage-badge" title="حالة الحفظ">
                {saveStatus === 'saving' ? '⏳ جاري الحفظ'
                  : saveStatus === 'retrying' ? '🔄 إعادة المحاولة'
                  : saveStatus === 'failed' ? '⚠️ فشل'
                  : saveStatus === 'saved' ? '✓ محفوظ'
                  : '—'}
              </span>
            </>
          )}
        </div>
        <TabNav
          active={activeTab}
          onChange={changeTab}
          issueCount={issueCount}
          trashCount={deletedTransfers.length + deletedCustomers.length}
          visibleTabs={isViewerMode ? VIEWER_VISIBLE_TABS : undefined}
        />
        <div className="topbar-actions">
          {isViewerMode ? null : (
            <>
              <button className="ghost-button" onClick={exportCsv} title="CSV">CSV</button>
              <button className="ghost-button" onClick={exportBackup} title="نسخة احتياطية">نسخة</button>
              <button className="ghost-button" onClick={() => importRef.current?.click()} title="استرجاع">استرجاع</button>
              <input
                ref={importRef}
                className="hidden-input"
                type="file"
                accept="application/json"
                onChange={handleImportBackup}
              />
            </>
          )}
        </div>
      </header>

      {isViewerMode ? (
        <div
          className="error-banner"
          style={{ background: '#1e3a8a', color: '#fff', textAlign: 'center', fontWeight: 'bold' }}
        >
          👁 وضع المشاهدة فقط — مرحباً {viewerCustomer?.name || ''} · لا يمكنك إضافة أو تعديل أي شيء
        </div>
      ) : null}

      {loadFailed ? (
        <div className="error-banner">تعذر تحميل البيانات — التغييرات لن تُحفظ. أعد تحميل الصفحة.</div>
      ) : null}

      {isReadOnly && !isViewerMode ? (
        <div className="error-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>مفتوح في تبويب آخر — هذا التبويب للقراءة فقط.</span>
          <button className="action-btn action-btn--blue" onClick={reclaimControl}>استعادة السيطرة</button>
        </div>
      ) : null}

      {saveStatus === 'failed' ? (
        <div className="error-banner">فشل الحفظ بعد عدة محاولات — البيانات محفوظة محلياً. تحقّق من الاتصال.</div>
      ) : null}

      {localStorageFailed ? (
        <div className="error-banner">⚠️ فشل الحفظ في الذاكرة المحلية — خزّن نسخة احتياطية الآن من زر "نسخة" أعلاه قبل إغلاق الصفحة.</div>
      ) : null}

      {feedback ? (
        <div className="feedback-banner" onClick={() => setFeedback('')}>{feedback}</div>
      ) : null}

      {!isViewerMode && isHydrated && officeSummary.accountantClaimableProfit > 0 ? (
        <div
          className="claim-profit-banner"
          style={{
            background: 'linear-gradient(90deg, #16a34a, #15803d)',
            color: '#fff',
            borderRadius: 8,
            padding: '12px 16px',
            margin: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            boxShadow: '0 2px 8px rgba(22, 163, 74, 0.25)',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>💰</span>
          <span style={{ flex: '1 1 auto', minWidth: 0, fontWeight: 'bold' }}>
            لديك ربح قابل للسحب: <span style={{ fontSize: '1.15rem' }}>{officeSummary.accountantClaimableProfit.toFixed(2)}</span>
          </span>
          <button
            type="button"
            onClick={handleClaimProfit}
            style={{
              background: '#fff',
              color: '#15803d',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            ✋ سحب الربح الآن
          </button>
        </div>
      ) : null}

      {pendingUndo ? (
        <div
          className="undo-banner"
          style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            padding: '10px 14px',
            margin: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: '0.92rem',
          }}
        >
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>
            ↩️ تم إعادة الحوالة <strong>{pendingUndo.reference}</strong>
            {pendingUndo.customerName ? ` (${pendingUndo.customerName})` : ''} إلى "جديدة".
          </span>
          <span style={{ color: '#92400e', fontVariantNumeric: 'tabular-nums' }}>
            ⏱ {undoSecondsRemaining} ثانية
          </span>
          <button
            type="button"
            onClick={performUndo}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            ↶ تراجع
          </button>
          <button
            type="button"
            onClick={() => setPendingUndo(null)}
            style={{
              background: 'transparent',
              border: '1px solid #92400e',
              color: '#92400e',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            إخفاء
          </button>
        </div>
      ) : null}

      {!isViewerMode ? (
        <AttentionBoard alerts={attentionAlerts} onAction={handleAttentionAction} />
      ) : null}

      <StatsHero
        transferSummary={transferSummary}
        officeSummary={officeSummary}
        issueCount={issueCount}
        viewerMode={isViewerMode}
        viewerSettledTotal={viewerSettledTotal}
      />

      {activeTab === 'transfers' ? (
        <TransfersTab
          filteredTransfers={filteredTransfers}
          allTransfers={transfers}
          customers={customers}
          customersById={customersById}
          batchTransferDraft={batchTransferDraft}
          setBatchTransferDraft={setBatchTransferDraft}
          onAddTransferBatch={handleAddTransferBatch}
          onPatchTransfer={patchTransfer}
          onDeleteTransfer={deleteTransfer}
          onResetTransfer={resetTransferToNew}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
          customerFilter={customerFilter}
          setCustomerFilter={setCustomerFilter}
          sortMode={sortMode}
          setSortMode={setSortMode}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          onResetFilters={resetFilters}
          transferSummary={transferSummary}
          onFeedback={setFeedback}
          receiverColorMap={receiverColorMap}
          duplicateReferences={duplicateReferences}
          senders={senders}
          receivers={receivers}
          readOnly={isReadOnly}
          hideProfit={isViewerMode}
        />
      ) : null}

      {activeTab === 'customers' && !isViewerMode ? (
        <CustomersTab
          customers={customers}
          customerSummary={customerSummary}
          customerDraft={customerDraft}
          setCustomerDraft={setCustomerDraft}
          onAddCustomer={handleAddCustomer}
          onUpdateCustomer={handleUpdateCustomer}
          onDeleteCustomer={handleDeleteCustomer}
          transfers={transfers}
          onPatchTransfer={patchTransfer}
          onResetTransfer={resetTransferToNew}
          onFeedback={setFeedback}
          ledgerEntries={ledgerEntries}
          receiverColorMap={receiverColorMap}
          duplicateReferences={duplicateReferences}
        />
      ) : null}

      {activeTab === 'settlements' ? (
        <SettlementsTab
          customers={customers}
          allCustomers={rawCustomers}
          transfers={transfers}
          ledgerEntries={ledgerEntries}
          onSettle={handleSettle}
          receiverColorMap={receiverColorMap}
          duplicateReferences={duplicateReferences}
          readOnly={isReadOnly}
          hideProfit={isViewerMode}
        />
      ) : null}

      {activeTab === 'closing' && !isViewerMode ? (
        <DailyClosingTab
          transfers={transfers}
          customerSummary={customerSummary}
          officeSummary={officeSummary}
          claimHistory={claimHistory}
          dailyClosings={dailyClosings}
          customersById={customersById}
          onClaimProfit={handleClaimProfit}
          onSaveClosing={handleSaveDailyClosing}
          receiverColorMap={receiverColorMap}
          duplicateReferences={duplicateReferences}
        />
      ) : null}

      {activeTab === 'issues' && !isViewerMode ? (
        <IssuesTab
          transfers={transfers}
          customersById={customersById}
          onPatchTransfer={patchTransfer}
          onResetTransfer={resetTransferToNew}
          onFeedback={setFeedback}
          receiverColorMap={receiverColorMap}
          duplicateReferences={duplicateReferences}
        />
      ) : null}

      {activeTab === 'trash' && !isViewerMode ? (
        <TrashTab
          deletedTransfers={deletedTransfers}
          deletedCustomers={deletedCustomers}
          cancellableTransfers={cancellableTransfers}
          cancellableImpact={cancellableImpact}
          customersById={allCustomersById}
          onCancelTransfer={deleteTransfer}
          onRestoreTransfer={restoreTransfer}
          onPermanentDeleteTransfer={permanentlyDeleteTransfer}
          onRestoreCustomer={restoreCustomer}
          canPermanentDeleteTransfer={canPermanentDeleteTransferById}
          receiverColorMap={receiverColorMap}
        />
      ) : null}

      {activeTab === 'people' ? (
        <PeopleTab
          transfers={transfersForPeople}
          senders={senders}
          receivers={receivers}
          onUpsertSender={handleUpsertSender}
          onUpsertReceiver={handleUpsertReceiver}
          onDeleteSender={handleDeleteSender}
          onDeleteReceiver={handleDeleteReceiver}
          readOnly={isReadOnly}
        />
      ) : null}
    </div>
  )
}

export default App
