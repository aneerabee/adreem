import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, canCommitMovementEdit, markOptimisticMovementChange, postMovement, validateMovementBalanceTransition, voidMovement } from './ledgerCore'
import { deleteAdreemUploadedAttachment, uploadAdreemAttachmentFile } from './ledgerPersistence'
import { MOVEMENT_ENTRY_STEPS, movementConfigFor, movementLabels, movementNeedsSource, movementSupportsDimension } from './movementConfig'
import { RECURRING_FREQUENCIES, createAttachment, createAuditEvent, createRecurringRuleFromMovement, disableRecurringRule, executeRecurringRuleInState, normalizeRecurringDateKey, syncRecurringRulesFromMovement, syncRecurringRulesFromSourceMovement, updateRecurringRule } from './ledgerOperations'
import { validateInvestmentState } from './investmentCore'
import { emptyMovementDraft, ledgerExtrasFromState } from './ledgerAppState'
import { formatCount, money, parseLocalizedDecimal, parseMoneyAmount } from './ledgerFormat'
import { CANCEL_WINDOW_HOURS } from './ledgerUiConfig'
import { canCancelMovement, canEditMovement, movementChangedWhileOpen, movementEditChanges, recurringDateLabel } from './movementPresentation'

export function useMovementActions({
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
}) {
  function findMovementById(movementId) {
    return movements.find((movement) => movement.id === movementId)
      || historyRemoteMovements?.find((movement) => movement.id === movementId)
      || null
  }

  function validateInvestmentMovementCandidate(candidateMovements, ...changedMovements) {
    const touchesInvestments = changedMovements.some((movement) => [MOVEMENT_TYPES.INVESTMENT_DEPOSIT, MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL].includes(movement?.type))
    if (!touchesInvestments) return { ok: true, errors: [] }
    return validateInvestmentState({
      platforms: ledgerExtras.investmentPlatforms || [],
      holdings: ledgerExtras.investmentHoldings || [],
      trades: ledgerExtras.investmentTrades || [],
      transfers: ledgerExtras.investmentTransfers || [],
      movements: candidateMovements,
    })
  }

  async function saveMovement(event) {
    event.preventDefault()
    if (movementSaveLockRef.current) return
    movementSaveLockRef.current = true
    setIsSavingMovement(true)
    try {
      const originalMovement = editingMovementId ? findMovementById(editingMovementId) : null
      if (editingMovementId && !originalMovement) {
        setFeedback('الحركة لم تعد موجودة. أوقفنا التعديل دون تغيير أي رصيد.')
        return
      }
      if (originalMovement && movementChangedWhileOpen(editingMovementBaseline, originalMovement)) {
        setFeedback('تغيّرت الحركة من مكان آخر. أوقفنا التعديل حتى لا تضيع البيانات الجديدة.')
        return
      }
      const validationMovements = originalMovement ? movements.filter((movementItem) => movementItem.id !== originalMovement.id) : movements
      const movement = postMovement(
        {
          ...originalMovement,
          ...normalizedDraft,
          id: originalMovement?.id,
          createdAt: originalMovement?.createdAt,
          note: movementDraft.note.trim(),
          dimensionId: movementSupportsDimension(movementDraft.type) ? movementDraft.dimensionId || '' : '',
          expenseCategoryId: movementDraft.type === MOVEMENT_TYPES.EXPENSE || movementDraft.type === MOVEMENT_TYPES.TRUCK_EXPENSE ? movementDraft.expenseCategoryId || '' : '',
        },
        accounts,
        validationMovements,
        { originalMovement, investmentPlatforms: ledgerExtras.investmentPlatforms, investmentAvailableCashUsdMicros },
      )
      if (!canCommitMovementEdit(originalMovement, movement)) {
        setFeedback(`لم يتم حفظ التعديل. أصلح الحركة أولًا حتى لا يتغير الرصيد: ${movement.validation.errors.map((error) => error.message).join(' ')}`)
        return
      }
      const candidateMovements = originalMovement
        ? movements.map((item) => (item.id === originalMovement.id ? movement : item))
        : [...movements, movement]
      const investmentValidation = validateInvestmentMovementCandidate(candidateMovements, originalMovement, movement)
      if (!investmentValidation.ok) {
        setFeedback(investmentValidation.errors[0]?.message || 'هذه الحركة تجعل نقد الاستثمار غير صالح.')
        return
      }
      if (originalMovement) markOptimisticMovementChange(movement, originalMovement)
      let uploadedAttachment = null
      let attachmentError = ''
      if (movementAttachmentFile) {
        try {
          uploadedAttachment = await uploadAdreemAttachmentFile(movementAttachmentFile)
        } catch (error) {
          attachmentError = error?.message || 'تعذر رفع المرفق.'
        }
      }
      setMovements((current) => {
        if (!originalMovement) return [...current, movement]
        return current.some((item) => item.id === originalMovement.id)
          ? current.map((item) => (item.id === originalMovement.id ? movement : item))
          : [...current, movement]
      })
      if (originalMovement) {
        setHistoryRemoteMovements((current) => Array.isArray(current)
          ? current.map((item) => (item.id === originalMovement.id ? movement : item))
          : current)
      }
      const baseFeedback = movement.status === MOVEMENT_STATUSES.POSTED
        ? movement.type === MOVEMENT_TYPES.RECORD_ONLY
          ? originalMovement ? 'تم تعديل التسجيل دون تغيير الأرصدة.' : 'تم حفظ التسجيل دون تغيير الأرصدة.'
          : originalMovement ? 'تم تعديل الحركة وتحديث الأرصدة.' : 'تم الحفظ وتحديث الأرصدة.'
        : 'الحركة ناقصة وتحتاج مراجعة.'
      setFeedback(attachmentError ? `${baseFeedback} لم يتم رفع المرفق: ${attachmentError}` : baseFeedback)
      const attachment = createAttachment({
        movementId: movement.id,
        label: movementDraft.attachmentLabel || uploadedAttachment?.label,
        url: uploadedAttachment?.storagePath ? '' : uploadedAttachment?.url || movementDraft.attachmentUrl,
        mimeType: uploadedAttachment?.mimeType || '',
        sizeBytes: uploadedAttachment?.sizeBytes || 0,
        storagePath: uploadedAttachment?.storagePath || '',
        source: uploadedAttachment ? 'web-upload' : 'web',
      })
      if (!attachment && uploadedAttachment?.storagePath) {
        try {
          await deleteAdreemUploadedAttachment(uploadedAttachment.storagePath)
        } catch (error) {
          console.warn('[adreem-ledger] orphan attachment cleanup failed:', error?.message || error)
        }
      }
      if (attachment?.storagePath) pendingUploadedAttachmentPathsRef.current.add(attachment.storagePath)
      const recurringRule =
        movementDraft.recurringEnabled && !editingRecurringRule && movement.status === MOVEMENT_STATUSES.POSTED
          ? createRecurringRuleFromMovement(movement, {
              frequency: movementDraft.recurringFrequency,
              name: movementDraft.note.trim(),
              firstRunOn: movementDraft.recurringFirstRunOn,
            })
          : null
      setLedgerExtras((current) => {
        const syncedRecurringRules = originalMovement ? syncRecurringRulesFromSourceMovement(current.recurringRules, movement) : current.recurringRules
        return {
          ...current,
          attachments: attachment ? [...(current.attachments || []), attachment] : current.attachments,
          recurringRules: recurringRule ? [...(syncedRecurringRules || []), recurringRule] : syncedRecurringRules,
          auditEvents: [
            ...(current.auditEvents || []),
            createAuditEvent(originalMovement ? 'movement.updated' : 'movement.created', {
              movementId: movement.id,
              status: movement.status,
              ...(originalMovement ? { changedFields: movementEditChanges(originalMovement, movement).map((change) => change.field) } : {}),
            }),
          ],
        }
      })
      setPendingUndo({
        kind: originalMovement ? 'edit' : 'create',
        movementId: movement.id,
        previousMovement: originalMovement || null,
        label: `${movementLabels[movement.type] || 'حركة'} · ${money(movement.amount, movement.currency)}`,
      })
      if (movement.status === MOVEMENT_STATUSES.POSTED || originalMovement) {
        setEditingMovementId('')
        setEditingMovementBaseline(null)
        setMovementEditStage('fields')
        setMovementDraft(emptyMovementDraft(movementDraft.type))
        setMovementAttachmentFile(null)
        setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
      }
    } finally {
      movementSaveLockRef.current = false
      setIsSavingMovement(false)
    }
  }

  function requestMovementCancellation(movementId) {
    const target = findMovementById(movementId)
    if (!target || target.status === MOVEMENT_STATUSES.VOIDED) return
    if (target?.status === MOVEMENT_STATUSES.POSTED && !canCancelMovement(target)) {
      setFeedback(`الإلغاء المباشر متاح فقط خلال آخر ${formatCount(CANCEL_WINDOW_HOURS)} ساعة. للحركات القديمة استخدم حركة تصحيح.`)
      return
    }
    setPendingMovementAction({ kind: 'void', movement: target })
  }

  function replaceMovementEverywhere(target, replacement) {
    setMovements((current) => current.some((movement) => movement.id === target.id)
      ? current.map((movement) => (movement.id === target.id ? replacement : movement))
      : [...current, replacement])
    setHistoryRemoteMovements((current) => Array.isArray(current)
      ? current.map((movement) => (movement.id === target.id ? replacement : movement))
      : current)
  }

  function confirmMovementAction() {
    if (!pendingMovementAction?.movement || movementSaveLockRef.current) return
    const action = pendingMovementAction
    const target = findMovementById(action.movement.id)
    if (movementChangedWhileOpen(action.movement, target)) {
      setPendingMovementAction(null)
      setFeedback('تغيّرت الحركة بعد فتح التأكيد. لم ننفذ أي شيء؛ افتحها من جديد.')
      return
    }

    movementSaveLockRef.current = true
    setIsSavingMovement(true)
    const now = new Date().toISOString()
    try {
      if (action.kind === 'restore' && action.previousMovement) {
        const restoredMovement = postMovement({
          ...target,
          ...action.previousMovement,
          id: target.id,
          createdAt: target.createdAt,
          status: target.status,
          voidReason: undefined,
          voidedAt: undefined,
        }, accounts, movements.filter((movement) => movement.id !== target.id), {
          originalMovement: target,
          investmentPlatforms: ledgerExtras.investmentPlatforms,
          investmentAvailableCashUsdMicros,
        })
        if (!canCommitMovementEdit(target, restoredMovement) || !restoredMovement.validation.ok) {
          setFeedback(restoredMovement.validation.errors[0]?.message || 'تعذر الرجوع لأن الأرصدة الحالية لا تسمح بالنسخة السابقة.')
          return
        }
        const restoredMovements = movements.map((movement) => (movement.id === target.id ? restoredMovement : movement))
        const investmentValidation = validateInvestmentMovementCandidate(restoredMovements, target, restoredMovement)
        if (!investmentValidation.ok) {
          setFeedback(investmentValidation.errors[0]?.message || 'تعذر الرجوع لأن نقد الاستثمار لا يسمح بذلك.')
          return
        }
        markOptimisticMovementChange(restoredMovement, target)
        replaceMovementEverywhere(target, restoredMovement)
        setLedgerExtras((current) => ({
          ...current,
          recurringRules: syncRecurringRulesFromSourceMovement(current.recurringRules, restoredMovement, now),
          auditEvents: [
            ...(current.auditEvents || []),
            createAuditEvent('movement.updated', {
              movementId: target.id,
              status: restoredMovement.status,
              restoredPreviousEdit: true,
              changedFields: movementEditChanges(target, restoredMovement).map((change) => change.field),
            }),
          ],
        }))
        setPendingUndo(null)
        setPendingMovementAction(null)
        setFeedback('تم التراجع عن التعديل وإعادة احتساب الأرصدة.')
        return
      }

      const voidedMovement = target.status === MOVEMENT_STATUSES.NEEDS_REVIEW
        ? {
            ...target,
            status: MOVEMENT_STATUSES.VOIDED,
            voidReason: 'إلغاء حركة ناقصة',
            voidedAt: now,
            updatedAt: now,
          }
        : voidMovement(target, 'إلغاء من سجل الحركات', now).movement
      if (!voidedMovement) return
      const balanceValidation = validateMovementBalanceTransition(target, voidedMovement, accounts, movements)
      if (!balanceValidation.ok) {
        setFeedback(balanceValidation.errors[0]?.message || 'لا يمكن أن يصبح حساب فلوسك أو الأصل بالسالب. الرصيد المتاح أقل من قيمة الحركة.')
        return
      }
      const voidedMovements = movements.map((movement) => (movement.id === target.id ? voidedMovement : movement))
      const investmentValidation = validateInvestmentMovementCandidate(voidedMovements, target, voidedMovement)
      if (!investmentValidation.ok) {
        setFeedback(investmentValidation.errors[0]?.message || 'لا يمكن الإلغاء لأن نقد الاستثمار سيصبح سالبًا.')
        return
      }
      markOptimisticMovementChange(voidedMovement, target)
      replaceMovementEverywhere(target, voidedMovement)
      setLedgerExtras((current) => ({
        ...current,
        recurringRules: syncRecurringRulesFromSourceMovement(current.recurringRules, voidedMovement, now),
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('movement.updated', {
            movementId: target.id,
            previousStatus: target.status,
            status: voidedMovement.status,
            voidReason: voidedMovement.voidReason,
          }),
        ],
      }))
      setPendingUndo((current) => (current?.movementId === target.id ? null : current))
      setPendingMovementAction(null)
      setFeedback('تم إلغاء الحركة وبقيت في السجل.')
    } finally {
      movementSaveLockRef.current = false
      setIsSavingMovement(false)
    }
  }

  function undoPendingMovement() {
    if (!pendingUndo?.movementId) return
    const currentMovement = findMovementById(pendingUndo.movementId)
    if (!currentMovement) {
      setPendingUndo(null)
      setFeedback('الحركة لم تعد موجودة.')
      return
    }
    if (pendingUndo.kind === 'edit' && pendingUndo.previousMovement) {
      setPendingMovementAction({
        kind: 'restore',
        movement: currentMovement,
        previousMovement: pendingUndo.previousMovement,
      })
      return
    }
    requestMovementCancellation(pendingUndo.movementId)
  }

  function closeMovementEditor(message = 'تم ترك التعديل بدون تغيير الحركة.') {
    if (isSavingMovement) return
    setEditingMovementId('')
    setEditingMovementBaseline(null)
    setMovementEditStage('fields')
    setMovementDraft(emptyMovementDraft(movementDraft.type))
    setMovementAttachmentFile(null)
    setMovementStep(MOVEMENT_ENTRY_STEPS.TYPE)
    if (message) setFeedback(message)
  }

  function editReviewMovement(movement) {
    if (movement.status === MOVEMENT_STATUSES.POSTED && !canEditMovement(movement)) {
      setFeedback(`تعديل الحركات القديمة غير مباشر. استخدم حركة تصحيح بدل تعديل حركة أقدم من ${formatCount(CANCEL_WINDOW_HOURS)} ساعة.`)
      return
    }
    if (movement.status === MOVEMENT_STATUSES.VOIDED || movement.id?.startsWith('opening-')) {
      setFeedback('لا يمكن تعديل هذه الحركة.')
      return
    }
    setEditingMovementId(movement.id)
    setEditingMovementBaseline(movement)
    setMovementEditStage('fields')
    setSelectedAccountId('')
    if (movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW) {
      switchSection('entry')
      activeEntryModeRef.current = 'movement'
      setActiveEntryMode('movement')
      setMovementStep(MOVEMENT_ENTRY_STEPS.AMOUNT)
    }
    setMovementDraft({
      type: movement.type || MOVEMENT_TYPES.TRANSFER,
      amount: movement.amount ? String(movement.amount) : '',
      currency: movement.currency || CURRENCIES.DINAR,
      sourceAccountId: movement.sourceAccountId || '',
      destinationAccountId: movement.destinationAccountId || '',
      investmentPlatformId: movement.investmentPlatformId || '',
      rate: movement.rate ? String(movement.rate) : '',
      note: movement.note || '',
      dimensionId: movementSupportsDimension(movement.type) ? movement.dimensionId || '' : '',
      expenseCategoryId: movement.expenseCategoryId || '',
      attachmentLabel: '',
      attachmentUrl: '',
      recurringEnabled: false,
      recurringFrequency: RECURRING_FREQUENCIES.MONTHLY,
      recurringFirstRunOn: '',
    })
    setFeedback(movement.status === MOVEMENT_STATUSES.POSTED ? '' : 'الحركة مفتوحة للإصلاح. لن تتغير الأرصدة إلا بعد الحفظ.')
  }

  function resolveReviewMovement(event, movement, reviewDraft) {
    event.preventDefault()
    const config = movementConfigFor(reviewDraft.type)
    const candidate = postMovement(
      {
        ...movement,
        type: reviewDraft.type,
        amount: parseMoneyAmount(reviewDraft.amount, config.currency || reviewDraft.currency),
        currency: config.currency || reviewDraft.currency,
        sourceAccountId: movementNeedsSource(reviewDraft.type) ? reviewDraft.sourceAccountId || null : null,
        destinationAccountId: config.needsDestination ? reviewDraft.destinationAccountId || null : null,
        investmentPlatformId: config.needsInvestmentPlatform ? reviewDraft.investmentPlatformId || null : null,
        rate: reviewDraft.rate === '' ? undefined : parseLocalizedDecimal(reviewDraft.rate),
        note: String(reviewDraft.note || '').trim(),
        dimensionId: movementSupportsDimension(reviewDraft.type) ? movement.dimensionId || '' : '',
        expenseCategoryId: reviewDraft.expenseCategoryId || movement.expenseCategoryId || '',
      },
      accounts,
      movements.filter((item) => item.id !== movement.id),
      { originalMovement: movement, investmentPlatforms: ledgerExtras.investmentPlatforms, investmentAvailableCashUsdMicros },
    )
    const candidateMovements = movements.map((item) => (item.id === movement.id ? candidate : item))
    const investmentValidation = validateInvestmentMovementCandidate(candidateMovements, movement, candidate)
    if (!investmentValidation.ok) {
      setFeedback(investmentValidation.errors[0]?.message || 'تعذر إصلاح الحركة لأن نقد الاستثمار لا يسمح بذلك.')
      return
    }
    markOptimisticMovementChange(candidate, movement)
    setMovements((current) => current.map((item) => (item.id === movement.id ? candidate : item)))
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: syncRecurringRulesFromSourceMovement(syncRecurringRulesFromMovement(current.recurringRules, candidate), candidate),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('movement.updated', {
          movementId: movement.id,
          previousStatus: movement.status,
          status: candidate.status,
          reviewResolution: true,
        }),
      ],
    }))
    setFeedback(candidate.status === MOVEMENT_STATUSES.POSTED ? 'تم إصلاح الحركة.' : 'ما زالت ناقصة.')
  }

  function runRecurring(ruleId) {
    const result = executeRecurringRuleInState({ ...ledgerExtras, accounts, movements }, ruleId)
    if (result.state !== undefined) {
      setMovements(result.state.movements || movements)
      setLedgerExtras(ledgerExtrasFromState(result.state))
    }
    setFeedback(result.message)
  }

  function disableRecurring(ruleId) {
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) => (item.id === ruleId ? disableRecurringRule(item) : item)),
      auditEvents: [...(current.auditEvents || []), createAuditEvent('recurring.disabled', { ruleId })],
    }))
    setFeedback('تم إيقاف الحركة المتكررة.')
  }

  function changeRecurringDate(ruleId, value) {
    const nextRunOn = normalizeRecurringDateKey(value)
    if (!nextRunOn) {
      setFeedback('اختر تاريخًا صحيحًا للحركة الشهرية.')
      return
    }
    setLedgerExtras((current) => ({
      ...current,
      recurringRules: (current.recurringRules || []).map((item) => (item.id === ruleId ? updateRecurringRule(item, { nextRunOn }) : item)),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('recurring.updated', {
          ruleId,
          nextRunOn,
        }),
      ],
    }))
    setFeedback(`تم ضبط الموعد القادم: ${recurringDateLabel(nextRunOn)}.`)
  }

  return {
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
  }
}
