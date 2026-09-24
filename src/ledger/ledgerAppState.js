import { ACCOUNT_STATUSES, ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog'
import { accountNeedsCurrency, parseAccountClassification as parseClassification } from './accountConfig'
import { accountUpdateCurrency, accountUpdateMovementErrors, prepareAccountUpdate } from './accountEditing'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, buildPostingEntries, markOptimisticMovementChange, previewMovement, summarizeBalances, validateMovement } from './ledgerCore'
import { ADREEM_API_TOKEN_PERSIST_KEY, ADREEM_API_TOKEN_SESSION_KEY, logoutAdreemCloudSession, mergeAdreemAttachmentPages } from './ledgerPersistence'
import { createEmptyAdreemState, normalizeLedgerState, normalizeLedgerAccounts, sameRecordVersions, sameSerializableContent } from './ledgerState'
import { movementConfigFor, movementLabels } from './movementConfig'
import { normalizeAccountSearchText } from './movementAccounts'
import { SEPARATE_RECORD_DIRECTIONS } from './separateRecords'
import { DIMENSION_TYPES, RECURRING_FREQUENCIES } from './ledgerOperations'
import { preserveUiData, translateUiText } from './uiTranslation'
import { accountLabel } from './accountPresentation'
import { money } from './ledgerFormat'
import { currencyField } from './ledgerUiConfig'
import { movementStatusLabel } from './movementPresentation'

export function loadInitialLedgerState() {
  const fallback = createEmptyAdreemState()
  return {
    ...fallback,
    accounts: normalizeLedgerAccounts(fallback.accounts),
  }
}

export function ledgerExtrasFromState(state) {
  const normalized = normalizeLedgerState(state)
  return {
    appId: normalized.appId,
    tenantId: normalized.tenantId,
    ledgerId: normalized.ledgerId,
    version: normalized.version,
    resetAt: normalized.resetAt,
    migratedFrom: normalized.migratedFrom,
    dimensions: normalized.dimensions,
    attachments: normalized.attachments,
    recurringRules: normalized.recurringRules,
    reconciliations: normalized.reconciliations,
    investmentPlatforms: normalized.investmentPlatforms,
    investmentHoldings: normalized.investmentHoldings,
    investmentTrades: normalized.investmentTrades,
    investmentTransfers: normalized.investmentTransfers,
    ignoredExternalAccounts: normalized.ignoredExternalAccounts,
    auditEvents: normalized.auditEvents,
  }
}

export function sameLedgerExtras(left, right) {
  return sameSerializableContent(left, right)
}

export function mergeMovementPageAttachments(extras = {}, attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return extras
  const mergedAttachments = mergeAdreemAttachmentPages(extras.attachments, attachments)
  return sameRecordVersions(extras.attachments || [], mergedAttachments)
    ? extras
    : { ...extras, attachments: mergedAttachments }
}

export function emptyMovementDraft(type = MOVEMENT_TYPES.TRANSFER) {
  const config = movementConfigFor(type)
  return {
    type,
    amount: '',
    currency: config.currency || CURRENCIES.DINAR,
    sourceAccountId: '',
    destinationAccountId: '',
    investmentPlatformId: '',
    rate: '',
    note: '',
    dimensionId: '',
    expenseCategoryId: '',
    attachmentLabel: '',
    attachmentUrl: '',
    recurringEnabled: false,
    recurringFrequency: RECURRING_FREQUENCIES.MONTHLY,
    recurringFirstRunOn: '',
  }
}

export function emptySeparateRecordDraft() {
  return {
    relatedName: '',
    recordDirection: SEPARATE_RECORD_DIRECTIONS.RECEIVABLE,
    amount: '',
    currency: CURRENCIES.DINAR,
    note: '',
  }
}

export function storageTextForStatus(saveStatus, storageMode) {
  return (
    {
      loading: 'تحميل',
      saving: 'حفظ',
      retrying: 'إعادة الحفظ',
      failed: 'فشل الحفظ',
      saved: storageMode === 'supabase' || storageMode === 'api' ? 'سحابي' : 'تطوير',
      local: storageMode === 'api-missing-token' ? 'دخول ناقص' : 'تطوير',
      'local-only': storageMode === 'api-missing-token' ? 'دخول ناقص' : 'سحابة متوقفة',
    }[saveStatus] || 'تطوير'
  )
}

export function saveFailureMessage(error, retryDelay) {
  if (error?.code === 'adreem-session-expired') return 'انتهت صلاحية الدخول على هذا الجهاز. سجّل الدخول من جديد؛ آخر تغيير لم يُحفظ.'
  if (retryDelay === null) {
    return error?.status === 409 ? 'تغيّرت البيانات في جهاز آخر. أوقفنا التعديل. أعد تحميل الصفحة.' : 'الحفظ لم يتم. أوقفنا التعديل لحماية بياناتك.'
  }
  return `لم يتم تأكيد الحفظ. سيحاول النظام تلقائيًا خلال ${Math.max(1, Math.round(retryDelay / 1000))} ث.`
}

export async function logoutFromCloudSession() {
  if (typeof window === 'undefined') return
  try {
    await logoutAdreemCloudSession()
  } catch (error) {
    console.warn('[adreem-ledger] cloud logout failed:', error?.message || error)
  } finally {
    try {
      window.sessionStorage?.removeItem(ADREEM_API_TOKEN_SESSION_KEY)
    } catch {
      // If session storage is blocked, continue clearing the persistent device login below.
    }
    try {
      window.localStorage?.removeItem(ADREEM_API_TOKEN_PERSIST_KEY)
    } catch {
      // If browser storage is blocked, reloading is still enough to reset the current view.
    }
    window.location.assign(`${window.location.pathname}${window.location.search}`)
  }
}

export function openAdminUsersPage() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('admin', 'users')
  url.hash = ''
  window.location.assign(`${url.pathname}${url.search}`)
}

export function movementHistoryForPreview(movements = [], editingMovementId = '') {
  if (!editingMovementId) return movements
  return movements.filter((movement) => movement.id !== editingMovementId)
}

export function previewMovementEdit(candidateMovement, originalMovement, accounts = [], movements = [], options = {}) {
  if (!originalMovement) return previewMovement(candidateMovement, accounts, movements, options)
  const movementsWithoutOriginal = movementHistoryForPreview(movements, originalMovement.id)
  const validation = validateMovement(candidateMovement, accounts, movementsWithoutOriginal, { ...options, originalMovement })
  if (!validation.ok) return { validation, effects: [] }

  const beforeById = new Map(summarizeBalances(accounts, movements).map((bucket) => [bucket.account.id, bucket]))
  const replacement = markOptimisticMovementChange({
    ...originalMovement,
    ...candidateMovement,
    id: originalMovement.id,
    status: MOVEMENT_STATUSES.POSTED,
  }, originalMovement)
  const replacementMovements = movements.some((movement) => movement.id === originalMovement.id)
    ? movements.map((movement) => (movement.id === originalMovement.id ? replacement : movement))
    : [...movements, replacement]
  const afterById = new Map(summarizeBalances(accounts, replacementMovements).map((bucket) => [bucket.account.id, bucket]))
  const affectedAccountIds = new Set([
    ...buildPostingEntries(originalMovement).map((entry) => entry.accountId),
    ...buildPostingEntries(replacement).map((entry) => entry.accountId),
  ])

  return {
    validation,
    effects: Array.from(affectedAccountIds).flatMap((accountId) => {
      const account = accounts.find((item) => item.id === accountId)
      const currencies = new Set([
        ...buildPostingEntries(originalMovement).filter((entry) => entry.accountId === accountId).map((entry) => entry.currency),
        ...buildPostingEntries(replacement).filter((entry) => entry.accountId === accountId).map((entry) => entry.currency),
      ])
      return Array.from(currencies).flatMap((currency) => {
        const field = currencyField(currency)
        const before = Number(beforeById.get(accountId)?.[field] || 0)
        const after = Number(afterById.get(accountId)?.[field] || 0)
        if (before === after) return []
        return [{ accountId, account, currency, before, delta: after - before, after }]
      })
    }),
  }
}

export function accountReviewSelection(classificationValue, currencyKind = ACCOUNT_CURRENCY_KINDS.DINAR) {
  const classification = parseClassification(classificationValue)
  return {
    type: classification.type,
    valueKind: classification.valueKind,
    currencyKind: accountNeedsCurrency(classification) && Object.values(ACCOUNT_CURRENCY_KINDS).includes(currencyKind) ? currencyKind : ACCOUNT_CURRENCY_KINDS.DINAR,
  }
}

export const accountClassificationMovementErrors = accountUpdateMovementErrors

export function accountClassificationCurrency(account, classification, requestedCurrencyKind) {
  return accountUpdateCurrency(account, classification, requestedCurrencyKind)
}

export function prepareAccountClassificationUpdate({ accounts = [], movements = [], reconciliations = [], recurringRules = [], dimensions = [], accountId, ownerName, subAccountName, classificationValue, currencyKind, updatedAt = new Date().toISOString() } = {}) {
  const classification = parseClassification(classificationValue)
  return prepareAccountUpdate({
    accounts,
    movements,
    reconciliations,
    recurringRules,
    dimensions,
    accountId,
    draft: { ownerName, subAccountName, ...classification, currencyKind },
    updatedAt,
  })
}

export function cancelMovementConfirmation(target) {
  const cancelLabel = `${movementLabels[target.type] || 'الحركة'} بقيمة ${money(target.amount, target.currency)}`
  return translateUiText(`هل تريد إلغاء ${cancelLabel}؟ ستبقى الحركة ظاهرة في السجل.`)
}

export function mergeAccountsConfirmation(sourceAccount, targetAccount) {
  const sourceName = preserveUiData(accountLabel(sourceAccount))
  const targetName = preserveUiData(accountLabel(targetAccount))
  return translateUiText(`هل تريد دمج حساب ${sourceName} داخل ${targetName}؟ ستُنقل الحركات ومرفقات الحساب إلى الحساب المختار.`)
}

export function claimSubmission(lock, key) {
  if (!lock || lock.current === key) return false
  lock.current = key
  return true
}

export function releaseSubmission(lock, key) {
  if (lock?.current === key) lock.current = ''
}

export function filterMovementHistory({ movements = [], query = '', type = '', status = '', accountId = '', dimensionId = '', expenseCategoryId = '', accountById = new Map(), dimensionById = new Map() } = {}) {
  const normalizedQuery = normalizeAccountSearchText(query)
  return movements.filter((movement) => {
    if (type && movement.type !== type) return false
    if (status && movement.status !== status) return false
    if (accountId && movement.sourceAccountId !== accountId && movement.destinationAccountId !== accountId) return false
    if (dimensionId && movement.dimensionId !== dimensionId) return false
    if (expenseCategoryId && movement.expenseCategoryId !== expenseCategoryId) return false
    if (!normalizedQuery) return true
    const source = accountById.get(movement.sourceAccountId)
    const destination = accountById.get(movement.destinationAccountId)
    const expenseCategory = accountById.get(movement.expenseCategoryId)
    const dimension = dimensionById.get(movement.dimensionId)
    const haystack = normalizeAccountSearchText([
      movementLabels[movement.type],
      movementStatusLabel(movement.status),
      movement.note,
      source ? accountLabel(source) : '',
      destination ? accountLabel(destination) : '',
      expenseCategory ? accountLabel(expenseCategory) : '',
      dimension?.name,
    ].join(' '))
    return haystack.includes(normalizedQuery)
  })
}

export function mergeMovementHistoryPages(...collections) {
  const byId = new Map()
  for (const movements of collections) {
    for (const movement of Array.isArray(movements) ? movements : []) {
      if (movement?.id) byId.set(movement.id, movement)
    }
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftSequence = Number(left?.databaseSequence)
    const rightSequence = Number(right?.databaseSequence)
    if (Number.isSafeInteger(leftSequence) && Number.isSafeInteger(rightSequence)) return rightSequence - leftSequence
    return String(right?.createdAt || right?.updatedAt || '').localeCompare(String(left?.createdAt || left?.updatedAt || ''))
  })
}

export function mergeReviewMovementPage({ movements = [], page = null } = {}, result = {}, expectedRevision, replace = false) {
  const revision = Number(expectedRevision)
  if (result.stale || !Number.isSafeInteger(revision) || Number(result.revision) !== revision) return null

  const pageMovements = Array.isArray(result.movements) ? result.movements : []
  const movementIds = new Set(replace || page?.revision !== revision ? [] : page?.movementIds || [])
  for (const movement of pageMovements) {
    if (movement?.id) movementIds.add(movement.id)
  }
  const retainedMovements = replace
    ? movements.filter((movement) => movement?.status !== MOVEMENT_STATUSES.NEEDS_REVIEW)
    : movements
  const mergedMovements = mergeMovementHistoryPages(retainedMovements, pageMovements).reverse()
  return {
    movements: sameRecordVersions(movements, mergedMovements) ? movements : mergedMovements,
    page: {
      ...(result.page || {}),
      revision,
      total: replace ? result.page?.total ?? pageMovements.length : page?.total ?? result.page?.total ?? movementIds.size,
      hasMore: Boolean(result.page?.hasMore),
      nextCursor: result.page?.nextCursor || null,
      loaded: movementIds.size,
      movementIds: Array.from(movementIds),
    },
  }
}

export function pendingUploadedOrphanPaths(snapshot = {}, pendingStoragePaths = []) {
  const snapshotPaths = new Set(
    (Array.isArray(snapshot.attachments) ? snapshot.attachments : [])
      .map((attachment) => String(attachment?.storagePath || '').trim())
      .filter(Boolean),
  )
  return Array.from(new Set(pendingStoragePaths))
    .map((storagePath) => String(storagePath || '').trim())
    .filter((storagePath) => storagePath && snapshotPaths.has(storagePath))
}

export function mergeLedgerAccountState({ accounts = [], movements = [], attachments = [], dimensions = [], recurringRules = [], reconciliations = [] } = {}, sourceAccountId, targetAccountId, updatedAt = new Date().toISOString()) {
  const nextMovements = movements.map((movement) => {
    const affected = movement.sourceAccountId === sourceAccountId || movement.destinationAccountId === sourceAccountId || movement.expenseCategoryId === sourceAccountId
    if (!affected) return movement
    return {
      ...movement,
      sourceAccountId: movement.sourceAccountId === sourceAccountId ? targetAccountId : movement.sourceAccountId,
      destinationAccountId: movement.destinationAccountId === sourceAccountId ? targetAccountId : movement.destinationAccountId,
      expenseCategoryId: movement.expenseCategoryId === sourceAccountId ? targetAccountId : movement.expenseCategoryId,
      mergedFromAccountId: sourceAccountId,
      updatedAt,
    }
  })
  const nextAccounts = accounts.map((account) => {
    if (account.id === sourceAccountId) {
      return {
        ...account,
        status: ACCOUNT_STATUSES.INACTIVE,
        mergedIntoAccountId: targetAccountId,
        disabledAt: updatedAt,
        updatedAt,
      }
    }
    return account.id === targetAccountId ? { ...account, updatedAt } : account
  })
  const nextAttachments = attachments.map((attachment) =>
    attachment.accountId === sourceAccountId
      ? {
          ...attachment,
          accountId: targetAccountId,
          mergedFromAccountId: sourceAccountId,
          updatedAt,
        }
      : attachment,
  )
  const nextDimensions = dimensions.map((dimension) =>
    dimension.linkedAccountId === sourceAccountId
      ? { ...dimension, linkedAccountId: targetAccountId, mergedFromAccountId: sourceAccountId, updatedAt }
      : dimension,
  )
  const nextRecurringRules = recurringRules.map((rule) => {
    const template = rule?.template || {}
    const affected = [template.sourceAccountId, template.destinationAccountId, template.expenseCategoryId].includes(sourceAccountId)
    if (!affected) return rule
    return {
      ...rule,
      template: {
        ...template,
        sourceAccountId: template.sourceAccountId === sourceAccountId ? targetAccountId : template.sourceAccountId,
        destinationAccountId: template.destinationAccountId === sourceAccountId ? targetAccountId : template.destinationAccountId,
        expenseCategoryId: template.expenseCategoryId === sourceAccountId ? targetAccountId : template.expenseCategoryId,
      },
      mergedFromAccountId: sourceAccountId,
      updatedAt,
    }
  })
  const nextReconciliations = reconciliations.map((reconciliation) =>
    reconciliation.accountId === sourceAccountId
      ? { ...reconciliation, accountId: targetAccountId, mergedFromAccountId: sourceAccountId, updatedAt }
      : reconciliation,
  )
  return {
    accounts: nextAccounts,
    movements: nextMovements,
    attachments: nextAttachments,
    dimensions: nextDimensions,
    recurringRules: nextRecurringRules,
    reconciliations: nextReconciliations,
  }
}

export function areMergeAccountsCompatible(sourceAccount, targetAccount) {
  if (!sourceAccount || !targetAccount || sourceAccount.id === targetAccount.id) return false
  if (targetAccount.status !== ACCOUNT_STATUSES.ACTIVE) return false
  if (sourceAccount.valueKind === VALUE_KINDS.REVIEW) return true
  if (sourceAccount.valueKind !== targetAccount.valueKind) return false
  const sourceCurrency = sourceAccount.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR
  const targetCurrency = targetAccount.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR
  return sourceCurrency === targetCurrency
}

export function mergeAccountReferenceErrors({ candidate, sourceAccount, targetAccount } = {}) {
  const errors = []
  if (!areMergeAccountsCompatible(sourceAccount, targetAccount)) errors.push('تصنيف أو عملة الحسابين غير متوافقين.')

  for (const dimension of candidate?.dimensions || []) {
    if (dimension.mergedFromAccountId !== sourceAccount?.id || dimension.linkedAccountId !== targetAccount?.id) continue
    const expectedValueKind = dimension.type === DIMENSION_TYPES.ASSET ? VALUE_KINDS.ASSET : VALUE_KINDS.PROJECT
    if (targetAccount.valueKind !== expectedValueKind) errors.push('المشروع أو الأصل لا يطابق الحساب المختار.')
  }

  const reconciliableKinds = new Set([VALUE_KINDS.CASH, VALUE_KINDS.BANK])
  if ((candidate?.reconciliations || []).some((item) => item.mergedFromAccountId === sourceAccount?.id) && !reconciliableKinds.has(targetAccount?.valueKind)) {
    errors.push('مطابقات الرصيد تحتاج حساب كاش أو مصرف.')
  }

  for (const rule of candidate?.recurringRules || []) {
    if (rule.mergedFromAccountId !== sourceAccount?.id || rule.status !== ACCOUNT_STATUSES.ACTIVE) continue
    const movement = { ...rule.template, status: MOVEMENT_STATUSES.POSTED }
    if (!validateMovement(movement, candidate.accounts, candidate.movements || []).ok) {
      errors.push('إحدى الحركات الشهرية لا تناسب الحساب المختار.')
    }
  }

  return Array.from(new Set(errors))
}

export function activeRecurringRuleForMovement(rules = [], movementId = '') {
  if (!movementId) return null
  return (Array.isArray(rules) ? rules : []).find((rule) => (
    rule?.status === 'active' && String(rule.sourceMovementId || '') === String(movementId)
  )) || null
}
