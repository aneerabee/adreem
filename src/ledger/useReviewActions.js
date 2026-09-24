import { ACCOUNT_STATUSES } from './accountCatalog'
import { accountEditChanges, accountEditSnapshot } from './accountEditing'
import { MOVEMENT_STATUSES, createAccount, markOptimisticMovementChange, validateAccount, validateMovement } from './ledgerCore'
import { createAuditEvent } from './ledgerOperations'
import { preserveUiData } from './uiTranslation'
import { accountClassificationMovementErrors, accountReviewSelection, claimSubmission, mergeAccountReferenceErrors, mergeAccountsConfirmation, mergeLedgerAccountState, releaseSubmission } from './ledgerAppState'
import { externalAccountKey } from './movementPresentation'

export function useReviewActions({
  accountCreationLockRef,
  accounts,
  ledgerExtras,
  movements,
  setAccounts,
  setFeedback,
  setLedgerExtras,
  setMovements,
}) {
  function resolveReviewAccount(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const currentAccount = accounts.find((account) => account.id === accountId)
    const selection = accountReviewSelection(formData.get('classification'), formData.get('currencyKind'))
    const reviewedAt = new Date().toISOString()
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      ...selection,
      notes: String(formData.get('notes') || '').trim(),
    }

    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            status: ACCOUNT_STATUSES.ACTIVE,
            reviewedAt,
            updatedAt: reviewedAt,
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(
      candidate,
      accounts.filter((account) => account.id !== accountId),
    )
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    const movementErrors = accountClassificationMovementErrors(accountId, candidateAccounts, movements)
    if (movementErrors.length) {
      setFeedback(`نوع الحساب لا يناسب الحركات السابقة: ${movementErrors.map((error) => error.message).join(' ')}`)
      return
    }
    setAccounts(candidateAccounts)
    const reviewChanges = accountEditChanges(currentAccount, candidate)
    if (reviewChanges.length) {
      setLedgerExtras((current) => ({
        ...current,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('account.updated', {
            accountId,
            accountIds: [accountId],
            before: accountEditSnapshot(currentAccount),
            after: accountEditSnapshot(candidate),
            source: 'review',
          }),
        ],
      }))
    }
    setFeedback('تم حل الحساب واعتماده.')
  }

  function mergeReviewAccount(sourceAccountId, targetAccountId) {
    if (!targetAccountId || sourceAccountId === targetAccountId) return false
    const sourceAccount = accounts.find((account) => account.id === sourceAccountId)
    const targetAccount = accounts.find((account) => account.id === targetAccountId)
    if (!sourceAccount || !targetAccount) return false
    const mergedAt = new Date().toISOString()
    const candidate = mergeLedgerAccountState({
      accounts,
      movements,
      attachments: ledgerExtras.attachments || [],
      dimensions: ledgerExtras.dimensions || [],
      recurringRules: ledgerExtras.recurringRules || [],
      reconciliations: ledgerExtras.reconciliations || [],
    }, sourceAccountId, targetAccountId, mergedAt)
    const invalidMovement = candidate.movements.find((movement, index) => {
      if (movement === movements[index]) return false
      if (movement.status !== MOVEMENT_STATUSES.POSTED) return false
      return !validateMovement(
        movement,
        candidate.accounts,
        candidate.movements.filter((item) => item.id !== movement.id),
      ).ok
    })
    const referenceErrors = mergeAccountReferenceErrors({ candidate, sourceAccount, targetAccount })
    if (invalidMovement || referenceErrors.length) {
      setFeedback('لم يتم الدمج. الحساب المختار لا يناسب عملة أو نوع بعض الحركات المرتبطة.')
      return false
    }
    if (typeof window !== 'undefined' && !window.confirm(mergeAccountsConfirmation(sourceAccount, targetAccount))) return false
    candidate.movements.forEach((movement, index) => {
      if (movement !== movements[index]) markOptimisticMovementChange(movement, movements[index])
    })
    setMovements(candidate.movements)
    setAccounts(candidate.accounts)
    setLedgerExtras((current) => {
      const mergedExtras = mergeLedgerAccountState({
        attachments: current.attachments || [],
        dimensions: current.dimensions || [],
        recurringRules: current.recurringRules || [],
        reconciliations: current.reconciliations || [],
      }, sourceAccountId, targetAccountId, mergedAt)
      return {
        ...current,
        attachments: mergedExtras.attachments,
        dimensions: mergedExtras.dimensions,
        recurringRules: mergedExtras.recurringRules,
        reconciliations: mergedExtras.reconciliations,
        auditEvents: [
          ...(current.auditEvents || []),
          createAuditEvent('account.merged', {
            sourceAccountId,
            targetAccountId,
          }),
        ],
      }
    })
    setFeedback('تم دمج الحساب.')
    return true
  }

  function addExternalAccount(event, externalAccount) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const selection = accountReviewSelection(formData.get('classification'), formData.get('currencyKind'))
    const submissionKey = JSON.stringify(['external-account', externalAccountKey(externalAccount), selection, formData.get('ownerName'), formData.get('subAccountName')])
    if (!claimSubmission(accountCreationLockRef, submissionKey)) return
    const account = createAccount({
      ownerName: String(formData.get('ownerName') || externalAccount.ownerName).trim(),
      subAccountName: String(formData.get('subAccountName') || externalAccount.subAccountName).trim(),
      ...selection,
      notes: externalAccount.notes,
    })
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      releaseSubmission(accountCreationLockRef, submissionKey)
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), externalAccountKey(externalAccount)])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.created', {
          accountId: account.id,
          externalAccountId: externalAccount.id,
        }),
      ],
    }))
    setFeedback(`تم إنشاء حساب ${preserveUiData(externalAccount.ownerName)}.`)
  }

  function ignoreExternalAccount(externalAccount) {
    const key = externalAccountKey(externalAccount)
    setLedgerExtras((current) => ({
      ...current,
      ignoredExternalAccounts: Array.from(new Set([...(current.ignoredExternalAccounts || []), key])),
      auditEvents: [
        ...(current.auditEvents || []),
        createAuditEvent('external_account.ignored', {
          externalAccountId: key,
        }),
      ],
    }))
    setFeedback('تم إخفاء الاسم من المراجعة.')
  }

  return {
    resolveReviewAccount,
    mergeReviewAccount,
    addExternalAccount,
    ignoreExternalAccount,
  }
}
