import { CURRENCIES, MOVEMENT_TYPES, postMovement } from './ledgerCore'
import { loadAdreemMovementPage } from './ledgerPersistence'
import { sameRecordVersions } from './ledgerState'
import { normalizeSeparateRecordDirection, normalizeSeparateRecordName, separateRecordCancellationDraft, separateRecordPinRevisionDraft } from './separateRecords'
import { createAuditEvent } from './ledgerOperations'
import { translateUiText } from './uiTranslation'
import { emptySeparateRecordDraft, mergeMovementHistoryPages, mergeMovementPageAttachments } from './ledgerAppState'
import { money, parseMoneyAmount } from './ledgerFormat'
import { MOVEMENT_REQUEST_KEYS, SEPARATE_RECORD_PAGE_SIZE } from './ledgerUiConfig'

export function useSeparateRecordActions({
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
}) {
  async function loadOlderSeparateRecords() {
    if (isLoadingSeparateRecords || !separatePage?.hasMore) return
    const requestSequence = separateRequestSequenceRef.current
    setIsLoadingSeparateRecords(true)
    try {
      const result = await loadAdreemMovementPage({
        before: separatePage.nextCursor,
        limit: separatePage.limit || SEPARATE_RECORD_PAGE_SIZE,
        type: MOVEMENT_TYPES.RECORD_ONLY,
        requestKey: MOVEMENT_REQUEST_KEYS.separate,
      })
      if (result.stale || separateRequestSequenceRef.current !== requestSequence) return
      setLedgerExtras((current) => mergeMovementPageAttachments(current, result.attachments))
      setMovements((current) => {
        const merged = mergeMovementHistoryPages(current, result.movements).reverse()
        return sameRecordVersions(current, merged) ? current : merged
      })
      setSeparatePage((current) => ({
        ...(result.page || {}),
        total: current?.total ?? result.page?.total ?? null,
        loaded: Number(current?.loaded || 0) + result.movements.length,
      }))
    } catch (error) {
      console.warn('[adreem-ledger] older separate records load failed:', error?.message || error)
      setFeedback('تعذر جلب السجلات الأقدم.')
    } finally {
      if (separateRequestSequenceRef.current === requestSequence) setIsLoadingSeparateRecords(false)
    }
  }

  function updateSeparateDraft(key, value) {
    setSeparateDraft((current) => ({ ...current, [key]: value }))
  }

  function closeSeparateEditor() {
    setIsSeparateEditorOpen(false)
    setEditingSeparateRecordId('')
    setSeparateDraft(emptySeparateRecordDraft())
  }

  function editSeparateRecord(movement) {
    setEditingSeparateRecordId(movement.id)
    setSeparateDraft({
      relatedName: movement.relatedName || '',
      recordDirection: normalizeSeparateRecordDirection(movement.recordDirection),
      amount: String(Math.abs(Number(movement.amount || 0)) || ''),
      currency: Object.values(CURRENCIES).includes(movement.currency) ? movement.currency : CURRENCIES.DINAR,
      note: movement.note || '',
    })
    setIsSeparateEditorOpen(true)
  }

  function saveSeparateRecord(event) {
    event.preventDefault()
    if (separateRecordSaveLockRef.current) return
    const relatedName = normalizeSeparateRecordName(separateDraft.relatedName)
    const amount = parseMoneyAmount(separateDraft.amount)
    const note = separateDraft.note.trim()
    if (!relatedName || amount <= 0 || !note) {
      setFeedback('أكمل الاسم والمبلغ والملاحظة.')
      return
    }
    separateRecordSaveLockRef.current = true
    setIsSavingSeparateRecord(true)
    try {
      const originalMovement = editingSeparateRecordId
        ? movements.find((movement) => movement.id === editingSeparateRecordId && movement.type === MOVEMENT_TYPES.RECORD_ONLY)
        : null
      const movement = postMovement({
        type: MOVEMENT_TYPES.RECORD_ONLY,
        amount,
        currency: Object.values(CURRENCIES).includes(separateDraft.currency) ? separateDraft.currency : CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: null,
        separateAccountId: originalMovement?.separateAccountId || `separate-account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        relatedName,
        recordDirection: normalizeSeparateRecordDirection(separateDraft.recordDirection),
        note,
        ...(originalMovement ? { separateRecordPinned: Boolean(originalMovement.separateRecordPinned) } : {}),
        ...(originalMovement ? { supersedesSeparateRecordId: originalMovement.id } : {}),
      }, accounts, movements)
      if (!movement.validation.ok) {
        setFeedback(movement.validation.errors.map((error) => error.message).join(' ') || 'تعذر حفظ السجل.')
        return
      }
      setMovements((current) => [...current, movement])
      setLedgerExtras((current) => ({
        ...current,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('movement.created', {
            movementId: movement.id,
            status: movement.status,
            recordOnly: true,
            ...(originalMovement ? { supersedesMovementId: originalMovement.id } : {}),
          }),
        ],
      }))
      setPendingUndo({ movementId: movement.id, label: `${relatedName} · ${money(amount, movement.currency)}` })
      setFeedback(originalMovement ? 'تم تعديل السجل المنفصل.' : 'تم حفظ السجل المنفصل.')
      closeSeparateEditor()
    } finally {
      separateRecordSaveLockRef.current = false
      setIsSavingSeparateRecord(false)
    }
  }

  function toggleSeparateRecordPinned(movementId) {
    if (separateRecordSaveLockRef.current) return
    const target = movements.find((movement) => movement.id === movementId && movement.type === MOVEMENT_TYPES.RECORD_ONLY)
    if (!target) return
    const nextPinned = target.separateRecordPinned !== true
    separateRecordSaveLockRef.current = true
    setIsSavingSeparateRecord(true)
    try {
      const movement = postMovement(separateRecordPinRevisionDraft(target, nextPinned), accounts, movements)
      if (!movement.validation.ok) {
        setFeedback(movement.validation.errors.map((error) => error.message).join(' ') || 'تعذر حفظ التمييز.')
        return
      }
      setMovements((current) => [...current, movement])
      setLedgerExtras((current) => ({
        ...current,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('movement.created', {
            movementId: movement.id,
            status: movement.status,
            recordOnly: true,
            supersedesMovementId: target.id,
            separateRecordPinned: nextPinned,
          }),
        ],
      }))
      setPendingUndo({ movementId: movement.id, label: `${nextPinned ? 'تمييز' : 'إلغاء تمييز'} ${target.relatedName || 'حساب منفصل'}` })
      setFeedback(nextPinned ? 'تم تثبيت الحساب المنفصل بالأعلى.' : 'تم إلغاء تثبيت الحساب المنفصل.')
    } finally {
      separateRecordSaveLockRef.current = false
      setIsSavingSeparateRecord(false)
    }
  }

  function archiveSeparateRecord(movementId) {
    if (separateRecordSaveLockRef.current) return
    const target = movements.find((movement) => movement.id === movementId && movement.type === MOVEMENT_TYPES.RECORD_ONLY)
    if (!target) return
    if (typeof window !== 'undefined' && !window.confirm(`${translateUiText('إلغاء الحساب المنفصل')} «${target.relatedName || translateUiText('بدون اسم')}»؟`)) return
    separateRecordSaveLockRef.current = true
    setIsSavingSeparateRecord(true)
    try {
      const movement = postMovement(separateRecordCancellationDraft(target), accounts, movements)
      if (!movement.validation.ok) {
        setFeedback(movement.validation.errors.map((error) => error.message).join(' ') || 'تعذر إلغاء الحساب المنفصل.')
        return
      }
      setMovements((current) => [...current, movement])
      setLedgerExtras((current) => ({
        ...current,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('movement.created', {
            movementId: movement.id,
            status: movement.status,
            recordOnly: true,
            supersedesMovementId: target.id,
            separateRecordAction: 'void',
          }),
        ],
      }))
      setPendingUndo({ movementId: movement.id, label: `إلغاء ${target.relatedName || 'حساب منفصل'}` })
      if (editingSeparateRecordId === target.id) closeSeparateEditor()
      setFeedback('تم إلغاء الحساب المنفصل.')
    } finally {
      separateRecordSaveLockRef.current = false
      setIsSavingSeparateRecord(false)
    }
  }

  return {
    loadOlderSeparateRecords,
    updateSeparateDraft,
    closeSeparateEditor,
    editSeparateRecord,
    saveSeparateRecord,
    toggleSeparateRecordPinned,
    archiveSeparateRecord,
  }
}
