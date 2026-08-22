import { ACCOUNT_CURRENCY_KINDS, VALUE_KINDS } from './accountCatalog.js'
import { accountDetailName, accountNeedsCurrency, accountPresetFor, accountPrimaryName } from './accountConfig.js'
import { MOVEMENT_STATUSES, validateAccount, validateMovement } from './ledgerCore.js'
import { ACCOUNT_SUMMARY_SCOPES, accountSummaryScope, accountSupportsNetScope } from './ledgerScope.js'

const STRUCTURE_LOCKING_MOVEMENT_STATUSES = new Set([
  MOVEMENT_STATUSES.POSTED,
  MOVEMENT_STATUSES.VOIDED,
])

export function accountEditSnapshot(account = {}) {
  return {
    ownerName: account.ownerName || '',
    subAccountName: account.subAccountName || '',
    type: account.type || '',
    valueKind: account.valueKind || '',
    currencyKind: account.currencyKind || ACCOUNT_CURRENCY_KINDS.DINAR,
    ...(accountSupportsNetScope(account) ? { summaryScope: accountSummaryScope(account) } : {}),
  }
}

function accountEditTypeLabel(account = {}) {
  const preset = accountPresetFor(account.type, account.valueKind)
  return account.valueKind === VALUE_KINDS.RECEIVABLE ? `${preset.title} · ${accountDetailName(account)}` : preset.title
}

function accountEditCurrencyLabel(account = {}) {
  if (!accountNeedsCurrency(account)) return ''
  return account.currencyKind === ACCOUNT_CURRENCY_KINDS.USD ? 'دولار' : 'دينار'
}

export function accountEditChanges(before = {}, after = {}) {
  const changes = []
  const beforeName = accountPrimaryName(before)
  const afterName = accountPrimaryName(after)
  if (beforeName !== afterName) changes.push({ key: 'name', label: 'الاسم', before: beforeName, after: afterName, protectsUserData: true })

  const beforeType = accountEditTypeLabel(before)
  const afterType = accountEditTypeLabel(after)
  if (beforeType !== afterType) changes.push({ key: 'type', label: 'نوع الحساب', before: beforeType, after: afterType })

  const beforeCurrency = accountEditCurrencyLabel(before)
  const afterCurrency = accountEditCurrencyLabel(after)
  if (beforeCurrency !== afterCurrency) changes.push({ key: 'currency', label: 'العملة', before: beforeCurrency || 'بدون عملة', after: afterCurrency || 'بدون عملة' })
  const beforeScope = accountSummaryScope(before)
  const afterScope = accountSummaryScope(after)
  if (beforeScope && afterScope && beforeScope !== afterScope) {
    changes.push({
      key: 'summaryScope',
      label: 'الصافي العام',
      before: beforeScope === ACCOUNT_SUMMARY_SCOPES.INCLUDED ? 'داخل الصافي' : 'حساب منفصل',
      after: afterScope === ACCOUNT_SUMMARY_SCOPES.INCLUDED ? 'داخل الصافي' : 'حساب منفصل',
      protectsUserData: true,
    })
  }
  return changes
}

export function accountUpdateCurrency(account, classification, requestedCurrencyKind) {
  if (!accountNeedsCurrency(classification)) return account.currencyKind
  if (requestedCurrencyKind === ACCOUNT_CURRENCY_KINDS.DINAR || requestedCurrencyKind === ACCOUNT_CURRENCY_KINDS.USD) return requestedCurrencyKind
  if (requestedCurrencyKind === ACCOUNT_CURRENCY_KINDS.MULTI && account.currencyKind === ACCOUNT_CURRENCY_KINDS.MULTI) return requestedCurrencyKind
  return account.currencyKind === ACCOUNT_CURRENCY_KINDS.USD || account.currencyKind === ACCOUNT_CURRENCY_KINDS.MULTI
    ? account.currencyKind
    : ACCOUNT_CURRENCY_KINDS.DINAR
}

export function accountUpdateMovementErrors(accountId, candidateAccounts = [], movements = []) {
  return movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && [movement.sourceAccountId, movement.destinationAccountId, movement.expenseCategoryId].includes(accountId))
    .flatMap(
      (movement) =>
        validateMovement(
          movement,
          candidateAccounts,
          movements.filter((item) => item.id !== movement.id),
          { originalMovement: movement },
        ).errors,
    )
}

function referencesAnyAccount(record = {}, accountIds = new Set()) {
  return [record.sourceAccountId, record.destinationAccountId, record.expenseCategoryId].some((accountId) => accountIds.has(accountId))
}

export function accountStructureUsage(accountOrId, {
  accounts = [],
  movements = [],
  reconciliations = [],
  recurringRules = [],
  dimensions = [],
} = {}) {
  const account = accountOrId && typeof accountOrId === 'object' ? accountOrId : null
  const id = String(account?.id || accountOrId || '').trim()
  if (!id) return { movement: false, reconciliation: false, recurringRule: false, dimension: false, locked: false }

  const relatedAccounts = account?.counterpartyId
    ? accounts.filter((item) => item.counterpartyId === account.counterpartyId)
    : []
  const accountIds = new Set([id, ...relatedAccounts.map((item) => item.id)].filter(Boolean))
  const linkedDimensions = dimensions.filter((item) => accountIds.has(item.linkedAccountId))
  const dimensionIds = new Set([
    account?.dimensionId,
    ...Array.from(accountIds, (accountId) => `dimension-account-${accountId}`),
    ...linkedDimensions.map((item) => item.id),
  ].filter(Boolean))
  const linkedBundle = Boolean(account?.counterpartyId)
  const databaseStructureLock = Boolean(account?.structureLocked || relatedAccounts.some((item) => item.structureLocked))
  const movement = Number(account?.postedCount || 0) > 0 || relatedAccounts.some((item) => Number(item.postedCount || 0) > 0) || movements.some((item) => STRUCTURE_LOCKING_MOVEMENT_STATUSES.has(item.status) && (
    referencesAnyAccount(item, accountIds) || dimensionIds.has(item.dimensionId)
  ))
  const reconciliation = reconciliations.some((item) => accountIds.has(item.accountId))
  const recurringRule = recurringRules.some((item) => (
    referencesAnyAccount(item.template, accountIds) || dimensionIds.has(item.template?.dimensionId)
  ))
  const dimension = linkedDimensions.length > 0
  return {
    movement,
    reconciliation,
    recurringRule,
    dimension,
    linkedBundle,
    databaseStructureLock,
    locked: linkedBundle || databaseStructureLock || movement || reconciliation || recurringRule || dimension,
  }
}

export function accountStructureChanges(before = {}, after = {}) {
  const changes = []
  if (before.type !== after.type) changes.push('type')
  if (before.valueKind !== after.valueKind) changes.push('valueKind')
  if (before.currencyKind !== after.currencyKind) changes.push('currencyKind')
  if (
    (before.valueKind === VALUE_KINDS.RECEIVABLE || after.valueKind === VALUE_KINDS.RECEIVABLE) &&
    accountDetailName(before) !== accountDetailName(after)
  ) changes.push('subAccountName')
  return changes
}

function accountFrozenChanges(before = {}, after = {}) {
  const changes = []
  if (before.ownerName !== after.ownerName) changes.push('ownerName')
  if (before.subAccountName !== after.subAccountName) changes.push('subAccountName')
  if (before.type !== after.type) changes.push('type')
  if (before.valueKind !== after.valueKind) changes.push('valueKind')
  if (before.currencyKind !== after.currencyKind) changes.push('currencyKind')
  if (String(before.notes || '') !== String(after.notes || '')) changes.push('notes')
  return changes
}

export function accountStructureLockErrors(currentAccount, nextAccount, context = {}) {
  const usage = accountStructureUsage(currentAccount, context)
  if (!usage.locked) return []
  const fields = usage.movement
    ? accountFrozenChanges(currentAccount, nextAccount)
    : accountStructureChanges(currentAccount, nextAccount)
  if (!fields.length) return []
  return [{
    field: fields[0],
    message: usage.movement
      ? 'بيانات الحساب ثابتة بعد أول حركة ولا يمكن تعديلها. المطابقة تبقى عملية مستقلة ومسجلة.'
      : 'لا يمكن تغيير نوع الحساب أو طريقة التعامل أو العملة بعد استعماله. يمكنك تعديل الاسم والملاحظات فقط.',
  }]
}

export function prepareAccountUpdate({
  accounts = [],
  movements = [],
  reconciliations = [],
  recurringRules = [],
  dimensions = [],
  accountId,
  draft = {},
  updatedAt = new Date().toISOString(),
} = {}) {
  const currentAccount = accounts.find((account) => account.id === accountId)
  if (!currentAccount) return { ok: false, reason: 'missing-account', errors: [{ message: 'الحساب غير موجود.' }] }

  const classification = {
    type: draft.type || currentAccount.type,
    valueKind: draft.valueKind || currentAccount.valueKind,
  }
  const nextAccount = {
    ...currentAccount,
    ownerName: String(draft.ownerName ?? currentAccount.ownerName ?? '').trim(),
    subAccountName: String(draft.subAccountName ?? currentAccount.subAccountName ?? '').trim(),
    type: classification.type,
    valueKind: classification.valueKind,
    currencyKind: accountUpdateCurrency(currentAccount, classification, draft.currencyKind),
    notes: draft.notes === undefined ? currentAccount.notes : String(draft.notes || '').trim(),
    ...(accountSupportsNetScope({ valueKind: classification.valueKind })
      ? { summaryScope: Object.values(ACCOUNT_SUMMARY_SCOPES).includes(draft.summaryScope) ? draft.summaryScope : accountSummaryScope(currentAccount) }
      : {}),
    updatedAt,
  }
  if (!accountSupportsNetScope(nextAccount)) delete nextAccount.summaryScope
  const linkedAccountIds = new Set(currentAccount.counterpartyId
    ? accounts.filter((account) => account.counterpartyId === currentAccount.counterpartyId).map((account) => account.id)
    : [accountId])
  const renameLinkedAccounts = linkedAccountIds.size > 1 && currentAccount.ownerName !== nextAccount.ownerName
  const candidateAccounts = accounts.map((account) => {
    if (account.id === accountId) return nextAccount
    if (renameLinkedAccounts && linkedAccountIds.has(account.id)) {
      return { ...account, ownerName: nextAccount.ownerName, updatedAt }
    }
    return account
  })
  const structureErrors = accountStructureLockErrors(currentAccount, nextAccount, {
    accounts,
    movements,
    reconciliations,
    recurringRules,
    dimensions,
  })
  if (structureErrors.length) return { ok: false, reason: 'account-structure-locked', errors: structureErrors }

  const updatedAccountIds = renameLinkedAccounts ? linkedAccountIds : new Set([accountId])
  const validationErrors = []
  const acceptedAccounts = candidateAccounts.filter((account) => !updatedAccountIds.has(account.id))
  for (const account of candidateAccounts.filter((item) => updatedAccountIds.has(item.id))) {
    const validation = validateAccount(account, acceptedAccounts)
    validationErrors.push(...validation.errors)
    if (validation.ok) acceptedAccounts.push(account)
  }
  if (validationErrors.length) return { ok: false, reason: 'account-validation', errors: validationErrors }

  const movementErrors = Array.from(updatedAccountIds).flatMap((id) => accountUpdateMovementErrors(id, candidateAccounts, movements))
  if (movementErrors.length) return { ok: false, reason: 'movement-history', errors: movementErrors }
  return {
    ok: true,
    accounts: candidateAccounts,
    account: nextAccount,
    accountIds: Array.from(updatedAccountIds),
    previousAccount: currentAccount,
    changes: accountEditChanges(currentAccount, nextAccount),
  }
}
