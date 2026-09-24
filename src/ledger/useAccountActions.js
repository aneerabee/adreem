import { ACCOUNT_STATUSES } from './accountCatalog'
import { accountOpeningAmounts, accountOpeningDraftErrors, counterpartyOpeningDraftErrors, emptyAccountDraft } from './accountConfig'
import { buildFinancialAccountCurrencyBundle } from './accountCurrencyUpgrade'
import { accountDeletionEligibility, accountEditChanges, accountEditSnapshot } from './accountEditing'
import { buildCounterpartyAccountBundle, buildCounterpartyOpeningMovements } from './counterpartyAccounts'
import { createAccount, createOpeningMovements, validateAccount, validateMovement } from './ledgerCore'
import { deleteAdreemUnusedAccount, deleteAdreemUploadedAttachment, uploadAdreemAttachmentFile } from './ledgerPersistence'
import { normalizeLedgerState, normalizeLedgerAccounts } from './ledgerState'
import { createAttachment, createAuditEvent, hideAttachment } from './ledgerOperations'
import { translateUiText } from './uiTranslation'
import { claimSubmission, ledgerExtrasFromState, prepareAccountClassificationUpdate, releaseSubmission } from './ledgerAppState'
import { ACCOUNT_WIZARD_STEPS } from './ledgerUiConfig'
import { nonZero } from './movementPresentation'

export function useAccountActions({
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
}) {
  function addAccount(event) {
    event.preventDefault()
    if (!accountDraftNameValue.trim()) {
      setAccountWizardStep(ACCOUNT_WIZARD_STEPS.NAME)
      setFeedback('اكتب اسمًا واضحًا للحساب قبل الحفظ.')
      return
    }
    const submissionKey = JSON.stringify(['account', accountDraft])
    if (!claimSubmission(accountCreationLockRef, submissionKey)) return
    const openingDraftErrors = accountIsCounterpartyBundle ? counterpartyOpeningDraftErrors(accountDraft) : accountOpeningDraftErrors(accountDraft)
    if (openingDraftErrors.length) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setAccountWizardStep(ACCOUNT_WIZARD_STEPS.OPENING)
      setFeedback(openingDraftErrors.map((error) => error.message).join(' '))
      return
    }
    const openingAmounts = accountOpeningAmounts(accountDraft)
    const createdAccount = accountIsCounterpartyBundle ? null : createAccount({ ...accountDraft, ...openingAmounts })
    const nextAccounts = accountIsCounterpartyBundle
      ? buildCounterpartyAccountBundle(accountDraft, { source: 'web' })
      : buildFinancialAccountCurrencyBundle(createdAccount)
    const validationErrors = []
    const acceptedAccounts = [...accounts]
    for (const account of nextAccounts) {
      const validation = validateAccount(account, acceptedAccounts)
      validationErrors.push(...validation.errors)
      if (validation.ok) acceptedAccounts.push(account)
    }
    if (validationErrors.length) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setFeedback([...new Set(validationErrors.map((error) => error.message))].join(' '))
      return
    }
    const openingResult = accountIsCounterpartyBundle
      ? buildCounterpartyOpeningMovements(nextAccounts, movements, accounts)
      : {
          movements: createOpeningMovements(nextAccounts, nextAccounts[0].createdAt),
          validation: { ok: true, errors: [] },
        }
    const openingMovements = openingResult.movements
    const openingErrors = accountIsCounterpartyBundle
      ? openingResult.validation.errors
      : openingMovements.flatMap((movement) => validateMovement(movement, [...accounts, ...nextAccounts], movements).errors)
    if (openingErrors.length) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setFeedback(openingErrors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, ...nextAccounts])
    setMovements((current) => [...current, ...openingMovements])
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [...(current.auditEvents || []), createAuditEvent('account.created', {
        accountId: nextAccounts[0].id,
        accountIds: nextAccounts.map((account) => account.id),
        counterpartyId: nextAccounts[0].counterpartyId || '',
        openingMovementIds: openingMovements.map((movement) => movement.id),
      })],
    }))
    setFeedback(accountIsCounterpartyBundle
      ? openingMovements.length ? 'تم إنشاء الشخص وحساباته مع الأرصدة السابقة.' : 'تم إنشاء الشخص وحساباته.'
      : openingMovements.length ? 'تم إنشاء الحساب وتسجيل رصيده الأول.' : 'تم إنشاء الحساب.')
    setAccountDraft(emptyAccountDraft())
    setActiveAccountPresetGroup('')
    setActiveAccountPresetKey('')
    setActiveAccountDetail('')
    setAccountWizardStep(ACCOUNT_WIZARD_STEPS.GROUP)
  }

  function updateAccountClassification(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const currentAccount = accounts.find((account) => account.id === accountId)
    const result = prepareAccountClassificationUpdate({
      accounts,
      movements,
      reconciliations: ledgerExtras.reconciliations || [],
      recurringRules: ledgerExtras.recurringRules || [],
      dimensions: ledgerExtras.dimensions || [],
      accountId,
      ownerName: formData.get('ownerName'),
      subAccountName: formData.get('subAccountName'),
      classificationValue: formData.get('classification'),
      currencyKind: formData.get('currencyKind'),
    })
    if (!result.ok) {
      const message = result.errors.map((error) => error.message).join(' ')
      setFeedback(result.reason === 'movement-history' ? `نوع الحساب لا يناسب الحركات السابقة: ${message}` : message)
      return
    }
    const changes = accountEditChanges(currentAccount, result.account)
    if (!changes.length) {
      setFeedback('لا يوجد تغيير.')
      return
    }
    setAccounts(result.accounts)
    setLedgerExtras((current) => ({
      ...current,
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('account.updated', {
          accountId,
          accountIds: result.accountIds || [accountId],
          before: accountEditSnapshot(currentAccount),
          after: accountEditSnapshot(result.account),
          source: 'web',
        }),
      ],
    }))
    setAccountQuery('')
    setFeedback('تم تعديل الحساب وحفظ السجل.')
  }

  async function addAccountAttachment(event, accountId) {
    event.preventDefault()
    if (accountAttachmentLockRef.current) return
    accountAttachmentLockRef.current = true
    setIsAddingAccountAttachment(true)
    const form = event.currentTarget
    try {
      const formData = new FormData(form)
      let uploadedAttachment = null
      const file = formData.get('attachmentFile')
      if (file && typeof file === 'object' && file.size > 0) {
        try {
          uploadedAttachment = await uploadAdreemAttachmentFile(file)
        } catch (error) {
          setFeedback(`لم يتم رفع المرفق: ${error?.message || 'خطأ غير معروف.'}`)
          return
        }
      }
      const attachment = createAttachment({
        accountId,
        label: formData.get('attachmentLabel') || uploadedAttachment?.label,
        url: uploadedAttachment?.storagePath ? '' : uploadedAttachment?.url || formData.get('attachmentUrl'),
        mimeType: uploadedAttachment?.mimeType || '',
        sizeBytes: uploadedAttachment?.sizeBytes || 0,
        storagePath: uploadedAttachment?.storagePath || '',
        source: uploadedAttachment ? 'web-upload' : 'web',
      })
      if (!attachment) {
        if (uploadedAttachment?.storagePath) {
          try {
            await deleteAdreemUploadedAttachment(uploadedAttachment.storagePath)
          } catch (error) {
            console.warn('[adreem-ledger] orphan attachment cleanup failed:', error?.message || error)
          }
        }
        setFeedback('اكتب اسم المرفق أو رابطه.')
        return
      }
      if (attachment.storagePath) pendingUploadedAttachmentPathsRef.current.add(attachment.storagePath)
      setLedgerExtras((current) => ({
        ...current,
        attachments: [...(current.attachments || []), attachment],
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('attachment.created', {
            accountId,
            attachmentId: attachment.id,
          }),
        ],
      }))
      form.reset()
      setFeedback('تم ربط المرفق بالحساب.')
    } finally {
      accountAttachmentLockRef.current = false
      setIsAddingAccountAttachment(false)
    }
  }

  function deleteAttachment(attachmentId) {
    const attachment = (ledgerExtras.attachments || []).find((item) => item.id === attachmentId)
    if (!attachment) return
    if (typeof window !== 'undefined' && !window.confirm(translateUiText('حذف هذا المرفق؟'))) return
    const hiddenAt = new Date().toISOString()
    setLedgerExtras((current) => ({
      ...current,
      attachments: (current.attachments || []).map((item) => (item.id === attachmentId ? hideAttachment(item, hiddenAt) : item)),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('attachment.hidden', {
          attachmentId,
          storagePath: attachment.storagePath || '',
        }),
      ],
    }))
    setFeedback('تم حذف المرفق من العرض وحفظ أثره بأمان.')
  }

  function disableAccount(accountId) {
    const bucket = balanceByAccountId.get(accountId)
    if (bucket && nonZero(bucket)) {
      setFeedback('لا يمكن إخفاء حساب عليه رصيد. صفّر الرصيد أو ادمجه أولًا.')
      return
    }
    const disabledAt = new Date().toISOString()
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? {
              ...account,
              status: ACCOUNT_STATUSES.INACTIVE,
              disabledAt,
              updatedAt: disabledAt,
            }
          : account,
      ),
    )
    setFeedback('تم إخفاء الحساب.')
  }

  async function deleteAccountPermanently(accountId) {
    if (isDeletingAccount) return
    const account = accounts.find((item) => item.id === accountId)
    const deletion = accountDeletionEligibility(account, {
      accounts,
      movements,
      attachments: ledgerExtras.attachments || [],
      reconciliations: ledgerExtras.reconciliations || [],
      recurringRules: ledgerExtras.recurringRules || [],
      dimensions: ledgerExtras.dimensions || [],
    })
    if (!deletion.canDelete) {
      setFeedback('لا يمكن حذف الحساب لأنه استُخدم أو ارتبط بسجل آخر.')
      return
    }
    if (
      (ledgerStorageMode === 'relational' && !Number.isSafeInteger(ledgerRevision))
      || !['legacy', 'relational'].includes(ledgerStorageMode)
    ) {
      setFeedback('أعد تحميل الدفتر قبل حذف الحساب.')
      return
    }
    if (saveCoordinatorRef.current?.hasPending() || pendingUploadedAttachmentPathsRef.current.size) {
      setFeedback('انتظر اكتمال الحفظ ثم حاول حذف الحساب.')
      return
    }

    setIsDeletingAccount(true)
    try {
      const result = await deleteAdreemUnusedAccount(
        accountId,
        ledgerStorageMode === 'relational' ? ledgerRevision : undefined,
      )
      const normalizedState = normalizeLedgerState(result.state, initialState)
      const deletedIds = new Set(result.deletedAccountIds || deletion.accountIds)
      setAccounts(normalizeLedgerAccounts(normalizedState.accounts))
      setMovements(normalizedState.movements)
      setLedgerExtras(ledgerExtrasFromState(normalizedState))
      setLedgerRevision(Number.isSafeInteger(Number(result.revision)) ? Number(result.revision) : null)
      setMovementPage({
        ...(result.movementPage || {}),
        hasMore: Boolean(result.movementPage?.hasMore),
        nextCursor: result.movementPage?.nextCursor || null,
        loaded: normalizedState.movements.length,
      })
      setServerReports(result.reports || null)
      setHistoryRemoteMovements(null)
      setHistoryPage(null)
      setReviewPage(null)
      setTodayRemoteSummary(null)
      setAccountProfilePage(null)
      setHistoryAccountId((current) => deletedIds.has(current) ? '' : current)
      setFocusedCounterpartyId((current) => current === account?.counterpartyId ? '' : current)
      setSelectedAccountId('')
      setSaveStatus('saved')
      setSyncProblem(false)
      setFeedback(deletion.isCounterpartyBundle ? 'تم حذف الشخص وحساباته نهائيًا.' : 'تم حذف الحساب نهائيًا.')
    } catch (error) {
      console.warn('[adreem-ledger] account deletion failed:', error?.message || error)
      setFeedback(error?.message || 'تعذر حذف الحساب.')
    } finally {
      setIsDeletingAccount(false)
    }
  }

  return {
    addAccount,
    updateAccountClassification,
    addAccountAttachment,
    deleteAttachment,
    disableAccount,
    deleteAccountPermanently,
  }
}
