import { isDeepStrictEqual } from 'node:util'
import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import { accountStructureLockErrors } from '../../src/ledger/accountEditing.js'
import { counterpartyAccountChannels } from '../../src/ledger/accountConfig.js'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  roundMoney,
  summarizeBalances,
  validateAccount,
  validateMovement,
} from '../../src/ledger/ledgerCore.js'
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  DIMENSION_TYPES,
  RECURRING_FREQUENCIES,
  normalizeRecurringDateKey,
  validateAttachmentDraft,
} from '../../src/ledger/ledgerOperations.js'

const OWN_VALUE_KINDS = new Set([VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.ASSET])
const RECORD_LISTS = ['accounts', 'movements', 'dimensions', 'attachments', 'recurringRules', 'reconciliations', 'auditEvents']
const ACCOUNT_CLASSIFICATION_FIELDS = ['type', 'valueKind', 'currencyKind']
const ACTIVE_STATUS = 'active'
const INACTIVE_STATUS = 'inactive'
const RECORD_STATUSES = new Set([ACTIVE_STATUS, INACTIVE_STATUS])
const VOID_WINDOW_MS = 24 * 60 * 60 * 1000
const RAW_BALANCE_EPSILON = 1e-9
const RECONCILIATION_VALUE_FIELDS = ['actualDinar', 'actualUsd', 'expectedDinar', 'expectedUsd', 'diffDinar', 'diffUsd']
const RECONCILABLE_VALUE_KINDS = new Set([
  VALUE_KINDS.CASH,
  VALUE_KINDS.BANK,
  VALUE_KINDS.RECEIVABLE,
  VALUE_KINDS.ASSET,
])
const SOURCE_REQUIRED_RULE_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.CASH_DEPOSIT,
  MOVEMENT_TYPES.CASH_WITHDRAWAL,
  MOVEMENT_TYPES.EXPENSE,
  MOVEMENT_TYPES.TRUCK_EXPENSE,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
])
const DESTINATION_REQUIRED_RULE_TYPES = new Set([
  MOVEMENT_TYPES.TRANSFER,
  MOVEMENT_TYPES.CASH_DEPOSIT,
  MOVEMENT_TYPES.CASH_WITHDRAWAL,
  MOVEMENT_TYPES.TRUCK_INCOME,
  MOVEMENT_TYPES.USD_SALE,
  MOVEMENT_TYPES.USD_PURCHASE,
  MOVEMENT_TYPES.EXTERNAL_INCOME,
  MOVEMENT_TYPES.CORRECTION,
])
const DIMENSION_MOVEMENT_TYPES = new Set([
  MOVEMENT_TYPES.EXPENSE,
  MOVEMENT_TYPES.TRUCK_EXPENSE,
  MOVEMENT_TYPES.EXTERNAL_INCOME,
  MOVEMENT_TYPES.TRUCK_INCOME,
])
const POSTED_ROLLBACK_STATUSES = new Set([MOVEMENT_STATUSES.DRAFT, MOVEMENT_STATUSES.NEEDS_REVIEW])
const MOVEMENT_VALUE_FIELDS = [
  'type',
  'amount',
  'currency',
  'rate',
  'sourceAccountId',
  'destinationAccountId',
  'dimensionId',
  'expenseCategoryId',
  'note',
]

function changedRecord(record, previousById) {
  const previous = previousById.get(record?.id)
  return !previous || !isDeepStrictEqual(record, previous)
}

function recordsById(records = []) {
  return new Map((Array.isArray(records) ? records : []).map((record) => [cleanId(record?.id), record]))
}

function cleanId(value) {
  return String(value || '').trim()
}

function validTimestamp(value) {
  return Number.isFinite(new Date(value || '').getTime())
}

function validationNow(value) {
  const parsed = typeof value === 'number' ? value : new Date(value || '').getTime()
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function pushError(errors, code, recordType, record, field, message) {
  errors.push({ code, recordType, id: record?.id, field, message })
}

function changedRecordIds(nextRecords = [], currentRecords = []) {
  const nextById = recordsById(nextRecords)
  const currentById = recordsById(currentRecords)
  return new Set(
    Array.from(new Set([...nextById.keys(), ...currentById.keys()]))
      .filter((id) => !isDeepStrictEqual(nextById.get(id), currentById.get(id))),
  )
}

function changedAccountClassification(account, previousById) {
  const previous = previousById.get(account?.id)
  return Boolean(previous) && ACCOUNT_CLASSIFICATION_FIELDS.some((field) => account?.[field] !== previous?.[field])
}

function validateCounterpartyGroups(accounts = [], errors = []) {
  const expectedKinds = new Set(counterpartyAccountChannels.map((channel) => channel.key))
  const groups = new Map()
  for (const account of accounts) {
    const counterpartyId = cleanId(account?.counterpartyId)
    if (!counterpartyId) continue
    groups.set(counterpartyId, [...(groups.get(counterpartyId) || []), account])
  }
  for (const [counterpartyId, group] of groups) {
    const ownerNames = new Set(group.map((account) => String(account.ownerName || '').trim()))
    const kinds = new Set(group.map((account) => account.counterpartyKind))
    if (group.length !== expectedKinds.size || kinds.size !== expectedKinds.size || Array.from(expectedKinds).some((kind) => !kinds.has(kind))) {
      errors.push({
        code: 'invalid-counterparty-bundle',
        recordType: 'accounts',
        id: counterpartyId,
        field: 'counterpartyKind',
        message: 'حسابات الشخص المرتبطة يجب أن تبقى دينار كاش ودينار شيك ودولار معًا.',
      })
    }
    if (ownerNames.size !== 1) {
      errors.push({
        code: 'invalid-counterparty-bundle',
        recordType: 'accounts',
        id: counterpartyId,
        field: 'ownerName',
        message: 'اسم الشخص يجب أن يكون موحدًا في حساباته الثلاثة.',
      })
    }
  }
}

function dependsOnAccounts(movement, accountIds) {
  return [movement?.sourceAccountId, movement?.destinationAccountId, movement?.expenseCategoryId]
    .some((accountId) => accountId && accountIds.has(accountId))
}

function invalidMovementStatusTransition(movement, previousById) {
  const previous = previousById.get(movement?.id)
  if (!previous || previous.status === movement?.status) return false
  if (movement?.status === MOVEMENT_STATUSES.VOIDED) {
    const canVoid = previous.status === MOVEMENT_STATUSES.POSTED || previous.status === MOVEMENT_STATUSES.NEEDS_REVIEW
    const voidedAt = new Date(movement.voidedAt || '').getTime()
    const changedValue = MOVEMENT_VALUE_FIELDS.some((field) => movement?.[field] !== previous?.[field])
    return !canVoid || changedValue || !String(movement.voidReason || '').trim() || !Number.isFinite(voidedAt)
  }
  if (previous.status === MOVEMENT_STATUSES.POSTED) {
    if (POSTED_ROLLBACK_STATUSES.has(movement?.status)) return true
    return true
  }
  return previous.status === MOVEMENT_STATUSES.VOIDED && movement?.status !== MOVEMENT_STATUSES.VOIDED
}

function voidWindowExpired(movement, previousById, now) {
  const previous = previousById.get(movement?.id)
  if (!previous || previous.status === movement?.status || movement?.status !== MOVEMENT_STATUSES.VOIDED) return false
  if (previous.status !== MOVEMENT_STATUSES.POSTED) return false
  const movementTime = new Date(previous.createdAt || previous.updatedAt || '').getTime()
  return !Number.isFinite(movementTime) || now - movementTime > VOID_WINDOW_MS
}

function editWindowExpired(movement, previousById, now) {
  const previous = previousById.get(movement?.id)
  if (!previous || previous.status !== MOVEMENT_STATUSES.POSTED || movement?.status !== MOVEMENT_STATUSES.POSTED) return false
  if (!MOVEMENT_VALUE_FIELDS.some((field) => movement?.[field] !== previous?.[field])) return false
  const movementTime = new Date(previous.createdAt || previous.updatedAt || '').getTime()
  return !Number.isFinite(movementTime) || now - movementTime > VOID_WINDOW_MS
}

function buildDimensionMaps(accounts, dimensions) {
  const all = new Map()
  for (const dimension of dimensions) {
    const id = cleanId(dimension?.id)
    if (id) all.set(id, dimension)
  }
  for (const account of accounts) {
    if (account?.valueKind !== VALUE_KINDS.PROJECT && account?.valueKind !== VALUE_KINDS.ASSET) continue
    const id = cleanId(account.dimensionId || `dimension-account-${account.id}`)
    if (!id || all.has(id)) continue
    all.set(id, {
      id,
      type: account.valueKind === VALUE_KINDS.PROJECT ? DIMENSION_TYPES.PROJECT : DIMENSION_TYPES.ASSET,
      linkedAccountId: account.id,
      status: account.status === ACCOUNT_STATUSES.INACTIVE ? INACTIVE_STATUS : ACTIVE_STATUS,
    })
  }
  const active = new Map(Array.from(all).filter(([, dimension]) => {
    if (dimension?.status === INACTIVE_STATUS) return false
    const linkedAccountId = cleanId(dimension?.linkedAccountId)
    return !linkedAccountId || accounts.find((account) => cleanId(account?.id) === linkedAccountId)?.status === ACCOUNT_STATUSES.ACTIVE
  }))
  return { all, active }
}

function rawPostingEntries(movement) {
  if (movement?.status !== MOVEMENT_STATUSES.POSTED) return []
  const amount = Number(movement.amount)
  if (!Number.isFinite(amount)) return []
  const currency = movement.currency
  switch (movement.type) {
    case MOVEMENT_TYPES.OPENING_BALANCE:
    case MOVEMENT_TYPES.EXTERNAL_INCOME:
    case MOVEMENT_TYPES.TRUCK_INCOME:
      return [{ accountId: movement.destinationAccountId, currency, delta: amount }]
    case MOVEMENT_TYPES.EXPENSE:
    case MOVEMENT_TYPES.TRUCK_EXPENSE:
      return [{ accountId: movement.sourceAccountId, currency, delta: -Math.abs(amount) }]
    case MOVEMENT_TYPES.TRANSFER:
    case MOVEMENT_TYPES.CASH_DEPOSIT:
    case MOVEMENT_TYPES.CASH_WITHDRAWAL:
      return [
        { accountId: movement.sourceAccountId, currency, delta: -Math.abs(amount) },
        { accountId: movement.destinationAccountId, currency, delta: Math.abs(amount) },
      ]
    case MOVEMENT_TYPES.USD_SALE:
      return [
        { accountId: movement.sourceAccountId, currency: CURRENCIES.USD, delta: -Math.abs(amount) },
        {
          accountId: movement.destinationAccountId,
          currency: CURRENCIES.DINAR,
          delta: Math.round(Math.abs(amount) * Number(movement.rate || 0)),
        },
      ]
    case MOVEMENT_TYPES.USD_PURCHASE:
      return [
        { accountId: movement.sourceAccountId, currency: CURRENCIES.DINAR, delta: -Math.abs(amount) },
        {
          accountId: movement.destinationAccountId,
          currency: CURRENCIES.USD,
          delta: movement.rate > 0 ? Math.round(Math.abs(amount) / movement.rate) : 0,
        },
      ]
    case MOVEMENT_TYPES.CORRECTION:
      return [{ accountId: movement.destinationAccountId, currency, delta: amount }]
    default:
      return []
  }
}

function rawBalancesByAccount(movements) {
  const balances = new Map()
  for (const movement of movements) {
    for (const entry of rawPostingEntries(movement)) {
      const accountId = cleanId(entry.accountId)
      if (!accountId) continue
      const balance = balances.get(accountId) || { dinar: 0, usd: 0 }
      if (entry.currency === CURRENCIES.DINAR) balance.dinar += entry.delta
      if (entry.currency === CURRENCIES.USD) balance.usd += entry.delta
      balances.set(accountId, balance)
    }
  }
  return balances
}

function validateDimensionRecord(dimension, accountById, errors) {
  if (!String(dimension?.name || '').trim()) {
    pushError(errors, 'invalid-dimension', 'dimensions', dimension, 'name', 'اسم المركز أو المشروع مطلوب.')
  }
  if (!Object.values(DIMENSION_TYPES).includes(dimension?.type)) {
    pushError(errors, 'invalid-dimension', 'dimensions', dimension, 'type', 'نوع المركز أو المشروع غير معروف.')
  }
  if (!RECORD_STATUSES.has(dimension?.status)) {
    pushError(errors, 'invalid-dimension', 'dimensions', dimension, 'status', 'حالة المركز أو المشروع غير صالحة.')
  }
  const linkedAccountId = cleanId(dimension?.linkedAccountId)
  if (!linkedAccountId || dimension?.status === INACTIVE_STATUS) return
  const linkedAccount = accountById.get(linkedAccountId)
  if (!linkedAccount) {
    pushError(errors, 'dimension-account-missing', 'dimensions', dimension, 'linkedAccountId', 'الحساب المرتبط بالمركز أو المشروع غير موجود.')
    return
  }
  const expectedValueKind = dimension.type === DIMENSION_TYPES.ASSET
    ? VALUE_KINDS.ASSET
    : dimension.type === DIMENSION_TYPES.PROJECT || dimension.type === DIMENSION_TYPES.COST_CENTER
      ? VALUE_KINDS.PROJECT
      : null
  if (expectedValueKind && linkedAccount.valueKind !== expectedValueKind) {
    pushError(errors, 'dimension-account-mismatch', 'dimensions', dimension, 'linkedAccountId', 'الحساب المرتبط لا يطابق نوع المركز أو المشروع.')
  }
  if (linkedAccount.status !== ACCOUNT_STATUSES.ACTIVE) {
    pushError(errors, 'dimension-account-inactive', 'dimensions', dimension, 'linkedAccountId', 'المركز أو المشروع النشط لا يمكن ربطه بحساب مخفي.')
  }
}

function validateReconciliationRecord(reconciliation, accountById, errors) {
  const accountId = cleanId(reconciliation?.accountId)
  const account = accountById.get(accountId)
  if (!accountId || !account) {
    pushError(errors, 'reconciliation-account-missing', 'reconciliations', reconciliation, 'accountId', 'الحساب المرتبط بالمطابقة غير موجود.')
  } else if (account.status !== ACCOUNT_STATUSES.ACTIVE || !RECONCILABLE_VALUE_KINDS.has(account.valueKind)) {
    pushError(errors, 'reconciliation-account-invalid', 'reconciliations', reconciliation, 'accountId', 'الحساب المرتبط بالمطابقة غير صالح للمطابقة.')
  }
  if (!String(reconciliation?.note || '').trim()) {
    pushError(errors, 'invalid-reconciliation', 'reconciliations', reconciliation, 'note', 'المطابقة تحتاج ملاحظة واضحة.')
  }
  if (!validTimestamp(reconciliation?.createdAt)) {
    pushError(errors, 'invalid-reconciliation', 'reconciliations', reconciliation, 'createdAt', 'وقت المطابقة غير صالح.')
  }
  for (const field of RECONCILIATION_VALUE_FIELDS) {
    if (!Number.isFinite(reconciliation?.[field])) {
      pushError(errors, 'invalid-reconciliation', 'reconciliations', reconciliation, field, 'قيم المطابقة يجب أن تكون أرقامًا صالحة.')
    } else if (!Number.isInteger(reconciliation[field])) {
      pushError(errors, 'invalid-reconciliation-amount', 'reconciliations', reconciliation, field, 'قيم العملات في المطابقة يجب أن تكون أعدادًا صحيحة.')
    }
  }
  if (
    Number.isFinite(reconciliation?.actualDinar) &&
    Number.isFinite(reconciliation?.expectedDinar) &&
    Number.isFinite(reconciliation?.diffDinar) &&
    roundMoney(reconciliation.actualDinar - reconciliation.expectedDinar) !== reconciliation.diffDinar
  ) {
    pushError(errors, 'reconciliation-difference-mismatch', 'reconciliations', reconciliation, 'diffDinar', 'فرق الدينار في المطابقة لا يطابق الفعلي والمتوقع.')
  }
  if (
    Number.isFinite(reconciliation?.actualUsd) &&
    Number.isFinite(reconciliation?.expectedUsd) &&
    Number.isFinite(reconciliation?.diffUsd) &&
    roundMoney(reconciliation.actualUsd - reconciliation.expectedUsd) !== reconciliation.diffUsd
  ) {
    pushError(errors, 'reconciliation-difference-mismatch', 'reconciliations', reconciliation, 'diffUsd', 'فرق الدولار في المطابقة لا يطابق الفعلي والمتوقع.')
  }
  if (reconciliation?.currency && !Object.values(CURRENCIES).includes(reconciliation.currency)) {
    pushError(errors, 'invalid-reconciliation', 'reconciliations', reconciliation, 'currency', 'عملة المطابقة غير صالحة.')
  }
}

function validateAccountReference(owner, references, field, accountById, errors, code, recordType, { requireActive = false } = {}) {
  const accountId = cleanId(references?.[field])
  if (!accountId) return
  const account = accountById.get(accountId)
  if (!account) {
    if (requireActive) pushError(errors, code, recordType, owner, field, 'الحساب المشار إليه غير موجود.')
  } else if (requireActive && account.status !== ACCOUNT_STATUSES.ACTIVE) {
    pushError(errors, 'recurring-account-reference-inactive', recordType, owner, field, 'القاعدة الشهرية النشطة لا يمكن أن تشير إلى حساب مخفي.')
  }
}

function validateRecurringRuleRecord(rule, accountById, dimensionMaps, errors) {
  if (!String(rule?.name || '').trim()) {
    pushError(errors, 'invalid-recurring-rule', 'recurringRules', rule, 'name', 'اسم القاعدة الشهرية مطلوب.')
  }
  if (!RECORD_STATUSES.has(rule?.status)) {
    pushError(errors, 'invalid-recurring-rule', 'recurringRules', rule, 'status', 'حالة القاعدة الشهرية غير صالحة.')
  }
  if (rule?.frequency !== RECURRING_FREQUENCIES.MONTHLY) {
    pushError(errors, 'invalid-recurring-frequency', 'recurringRules', rule, 'frequency', 'تكرار القاعدة الشهرية غير صالح.')
  }
  if (!Number.isInteger(rule?.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
    pushError(errors, 'invalid-recurring-day', 'recurringRules', rule, 'dayOfMonth', 'يوم القاعدة الشهرية يجب أن يكون بين 1 و31.')
  }
  const firstRunOn = normalizeRecurringDateKey(rule?.firstRunOn)
  const nextRunOn = normalizeRecurringDateKey(rule?.nextRunOn)
  if (rule?.firstRunOn && !firstRunOn) {
    pushError(errors, 'invalid-recurring-first-date', 'recurringRules', rule, 'firstRunOn', 'تاريخ بدء الحركة الشهرية غير صالح.')
  }
  if (rule?.nextRunOn && !nextRunOn) {
    pushError(errors, 'invalid-recurring-next-date', 'recurringRules', rule, 'nextRunOn', 'الموعد القادم للحركة الشهرية غير صالح.')
  }
  if (firstRunOn && !nextRunOn && rule?.status === ACTIVE_STATUS) {
    pushError(errors, 'recurring-next-date-required', 'recurringRules', rule, 'nextRunOn', 'الموعد القادم مطلوب للحركة الشهرية النشطة.')
  }
  if (nextRunOn && Number(nextRunOn.slice(8, 10)) !== rule?.dayOfMonth) {
    pushError(errors, 'recurring-day-date-mismatch', 'recurringRules', rule, 'dayOfMonth', 'يوم الحركة الشهرية لا يطابق موعدها القادم.')
  }
  if (rule?.nextRunAt && Number.isNaN(new Date(rule.nextRunAt).getTime())) {
    pushError(errors, 'invalid-recurring-next-time', 'recurringRules', rule, 'nextRunAt', 'وقت الاستحقاق القادم غير صالح.')
  }
  const template = rule?.template
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    pushError(errors, 'invalid-recurring-template', 'recurringRules', rule, 'template', 'قالب القاعدة الشهرية غير صالح.')
    return
  }
  const type = template.type
  if (!Object.values(MOVEMENT_TYPES).includes(type) || type === MOVEMENT_TYPES.OPENING_BALANCE) {
    pushError(errors, 'invalid-recurring-movement-type', 'recurringRules', rule, 'template.type', 'نوع حركة القاعدة الشهرية غير صالح.')
  }
  if (!Number.isFinite(template.amount) || !Number.isInteger(template.amount) || template.amount === 0 || (type !== MOVEMENT_TYPES.CORRECTION && template.amount < 0)) {
    pushError(errors, 'invalid-recurring-template', 'recurringRules', rule, 'template.amount', 'قيمة القاعدة الشهرية غير صالحة.')
  }
  if (!Object.values(CURRENCIES).includes(template.currency)) {
    pushError(errors, 'invalid-recurring-template', 'recurringRules', rule, 'template.currency', 'عملة القاعدة الشهرية غير صالحة.')
  }
  if ((type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE) && (!Number.isFinite(template.rate) || template.rate <= 0)) {
    pushError(errors, 'invalid-recurring-template', 'recurringRules', rule, 'template.rate', 'سعر صرف القاعدة الشهرية غير صالح.')
  }
  if (SOURCE_REQUIRED_RULE_TYPES.has(type) && !cleanId(template.sourceAccountId)) {
    pushError(errors, 'recurring-source-account-missing', 'recurringRules', rule, 'template.sourceAccountId', 'حساب مصدر القاعدة الشهرية مطلوب.')
  }
  if (DESTINATION_REQUIRED_RULE_TYPES.has(type) && !cleanId(template.destinationAccountId)) {
    pushError(errors, 'recurring-destination-account-missing', 'recurringRules', rule, 'template.destinationAccountId', 'حساب وجهة القاعدة الشهرية مطلوب.')
  }
  const activeRule = rule?.status === ACTIVE_STATUS
  validateAccountReference(rule, template, 'sourceAccountId', accountById, errors, 'recurring-account-reference-missing', 'recurringRules', { requireActive: activeRule })
  validateAccountReference(rule, template, 'destinationAccountId', accountById, errors, 'recurring-account-reference-missing', 'recurringRules', { requireActive: activeRule })
  const expenseCategoryId = cleanId(template.expenseCategoryId)
  if (expenseCategoryId && activeRule) {
    const category = accountById.get(expenseCategoryId)
    if (!category || category.valueKind !== VALUE_KINDS.EXPENSE || category.status !== ACCOUNT_STATUSES.ACTIVE) {
      pushError(errors, 'recurring-expense-category-invalid', 'recurringRules', rule, 'template.expenseCategoryId', 'نوع المصروف في القاعدة الشهرية غير صالح.')
    }
  }
  const dimensionId = cleanId(template.dimensionId)
  if (dimensionId && activeRule && (!DIMENSION_MOVEMENT_TYPES.has(type) || !dimensionMaps.active.has(dimensionId))) {
    pushError(errors, 'recurring-dimension-invalid', 'recurringRules', rule, 'template.dimensionId', 'المركز أو المشروع في القاعدة الشهرية غير صالح.')
  }
}

function validateMovementReferences(movement, dimensionMaps, reconciliationById, recurringRuleById, errors) {
  const dimensionId = cleanId(movement?.dimensionId)
  if (dimensionId && (!DIMENSION_MOVEMENT_TYPES.has(movement?.type) || !dimensionMaps.all.has(dimensionId))) {
    pushError(errors, 'movement-dimension-invalid', 'movements', movement, 'dimensionId', 'المركز أو المشروع المرتبط بالحركة غير صالح.')
  }

  const reconciliationId = cleanId(movement?.reconciliationId)
  if (reconciliationId) {
    const reconciliation = reconciliationById.get(reconciliationId)
    if (!reconciliation) {
      pushError(errors, 'movement-reconciliation-missing', 'movements', movement, 'reconciliationId', 'المطابقة المرتبطة بالحركة غير موجودة.')
    } else if (
      movement.type !== MOVEMENT_TYPES.CORRECTION ||
      cleanId(movement.destinationAccountId) !== cleanId(reconciliation.accountId)
    ) {
      pushError(errors, 'movement-reconciliation-mismatch', 'movements', movement, 'reconciliationId', 'حركة المطابقة لا تطابق حساب المطابقة أو نوعها.')
    } else {
      const expectedDifference = movement.currency === CURRENCIES.USD
        ? reconciliation.diffUsd
        : movement.currency === CURRENCIES.DINAR
          ? reconciliation.diffDinar
          : null
      if (!Number.isFinite(expectedDifference) || movement.amount !== expectedDifference) {
        pushError(errors, 'movement-reconciliation-amount-mismatch', 'movements', movement, 'amount', 'قيمة حركة المطابقة لا تطابق فرق المطابقة.')
      }
    }
  }

  const recurringRuleId = cleanId(movement?.recurringRuleId)
  const recurringRunKey = String(movement?.recurringRunKey || '').trim()
  if (recurringRuleId || recurringRunKey) {
    const rule = recurringRuleById.get(recurringRuleId)
    if (!rule) {
      pushError(errors, 'movement-recurring-rule-missing', 'movements', movement, 'recurringRuleId', 'القاعدة الشهرية المرتبطة بالحركة غير موجودة.')
    } else if (movement.type !== rule.template?.type) {
      pushError(errors, 'movement-recurring-type-mismatch', 'movements', movement, 'type', 'نوع الحركة لا يطابق نوع القاعدة الشهرية.')
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(recurringRunKey)) {
      pushError(errors, 'invalid-recurring-run-key', 'movements', movement, 'recurringRunKey', 'مرجع شهر تنفيذ القاعدة غير صالح.')
    }
  }
}

function duplicateOrMissingIdErrors(state) {
  const errors = []
  for (const listName of RECORD_LISTS) {
    const list = Array.isArray(state?.[listName]) ? state[listName] : []
    const ids = new Set()
    for (const record of list) {
      const id = String(record?.id || '').trim()
      if (!id) {
        errors.push({ code: 'missing-id', recordType: listName, message: `سجل بدون معرف في ${listName}.` })
        continue
      }
      if (ids.has(id)) errors.push({ code: 'duplicate-id', recordType: listName, id, message: `المعرف ${id} مكرر.` })
      ids.add(id)
    }
  }
  return errors
}

export function validateLedgerStateTransition(nextState = {}, currentState = {}, { ledgerId = '', now, allowedDeletedAccountIds = [] } = {}) {
  const errors = duplicateOrMissingIdErrors(nextState)
  const accounts = Array.isArray(nextState.accounts) ? nextState.accounts : []
  const movements = Array.isArray(nextState.movements) ? nextState.movements : []
  const dimensions = Array.isArray(nextState.dimensions) ? nextState.dimensions : []
  const reconciliations = Array.isArray(nextState.reconciliations) ? nextState.reconciliations : []
  const recurringRules = Array.isArray(nextState.recurringRules) ? nextState.recurringRules : []
  const previousAccounts = recordsById(currentState.accounts)
  const previousMovements = recordsById(currentState.movements)
  const previousDimensions = recordsById(currentState.dimensions)
  const previousReconciliations = recordsById(currentState.reconciliations)
  const previousRecurringRules = recordsById(currentState.recurringRules)
  const accountById = recordsById(accounts)
  const allowedDeletedAccounts = new Set((Array.isArray(allowedDeletedAccountIds) ? allowedDeletedAccountIds : [])
    .map(cleanId)
    .filter(Boolean))
  const reconciliationById = recordsById(reconciliations)
  const recurringRuleById = recordsById(recurringRules)
  const dimensionMaps = buildDimensionMaps(accounts, dimensions)
  const nowMs = validationNow(now)
  const changedAccountIds = changedRecordIds(accounts, currentState.accounts)
  const changedDimensionIds = changedRecordIds(dimensions, currentState.dimensions)
  const changedReconciliationIds = changedRecordIds(reconciliations, currentState.reconciliations)
  const changedRecurringRuleIds = changedRecordIds(recurringRules, currentState.recurringRules)
  validateCounterpartyGroups(accounts, errors)
  for (const previousAccount of previousAccounts.values()) {
    if (accountById.has(cleanId(previousAccount.id))) continue
    if (allowedDeletedAccounts.has(cleanId(previousAccount.id))) continue
    errors.push({
      code: 'account-deletion-not-allowed',
      recordType: 'accounts',
      id: previousAccount.id,
      message: 'لا يمكن حذف حساب من مسار الحفظ العادي. أخفِه أو استخدم مسار التصفير المحمي.',
    })
  }
  for (const accountId of changedAccountIds) {
    const nextAccount = accountById.get(accountId)
    const previousAccount = previousAccounts.get(accountId)
    for (const account of [nextAccount, previousAccount]) {
      if (account?.valueKind !== VALUE_KINDS.PROJECT && account?.valueKind !== VALUE_KINDS.ASSET) continue
      changedDimensionIds.add(cleanId(account.dimensionId || `dimension-account-${account.id}`))
    }
  }
  if (String(nextState.resetAt || '') !== String(currentState.resetAt || '')) {
    errors.push({
      code: 'client-reset-not-allowed',
      field: 'resetAt',
      message: 'لا يمكن تصفير الدفتر من مسار الحفظ العادي.',
    })
  }
  const reclassifiedAccountIds = new Set(
    accounts
      .filter((account) => changedAccountClassification(account, previousAccounts))
      .map((account) => account.id),
  )

  for (const account of accounts) {
    if (!changedRecord(account, previousAccounts)) continue
    const previousAccount = previousAccounts.get(cleanId(account.id))
    if (previousAccount) {
      for (const field of ['openingDinar', 'openingUsd']) {
        if (Number(account?.[field] || 0) === Number(previousAccount?.[field] || 0)) continue
        errors.push({
          code: 'account-opening-immutable',
          id: account.id,
          field,
          message: 'الرصيد الافتتاحي يحدد عند إنشاء الحساب فقط ولا يمكن تغييره لاحقًا.',
        })
      }
      accountStructureLockErrors(previousAccount, account, {
        accounts: currentState.accounts || [],
        movements: currentState.movements || [],
        reconciliations: currentState.reconciliations || [],
        recurringRules: currentState.recurringRules || [],
        dimensions: currentState.dimensions || [],
      }).forEach((error) => errors.push({
        code: 'account-structure-locked',
        id: account.id,
        field: error.field,
        message: error.message,
      }))
    }
    const validation = validateAccount(account, accounts.filter((item) => item.id !== account.id))
    validation.errors.forEach((error) => errors.push({
      code: 'invalid-account',
      id: account.id,
      field: error.field,
      message: error.message,
    }))

    if (!previousAccount) {
      for (const [field, currency, suffix] of [
        ['openingDinar', CURRENCIES.DINAR, 'dinar'],
        ['openingUsd', CURRENCIES.USD, 'usd'],
      ]) {
        const amount = Number(account?.[field] || 0)
        if (!amount) continue
        const expectedId = `opening-${account.id}-${suffix}`
        const matchingMovement = movements.find((movement) => movement.id === expectedId)
        if (
          matchingMovement?.type === MOVEMENT_TYPES.OPENING_BALANCE &&
          matchingMovement?.status === MOVEMENT_STATUSES.POSTED &&
          matchingMovement?.destinationAccountId === account.id &&
          !matchingMovement?.sourceAccountId &&
          matchingMovement?.currency === currency &&
          Number(matchingMovement?.amount) === amount
        ) continue
        errors.push({
          code: 'account-opening-movement-missing',
          id: account.id,
          field,
          message: 'الرصيد الافتتاحي يحتاج حركة افتتاحية مطابقة عند إنشاء الحساب.',
        })
      }
    }
  }

  for (const movement of movements) {
    const previousMovement = previousMovements.get(cleanId(movement.id))
    if (previousMovement?.type === MOVEMENT_TYPES.OPENING_BALANCE && changedRecord(movement, previousMovements)) {
      errors.push({
        code: 'opening-movement-immutable',
        id: movement.id,
        message: 'حركة الرصيد الافتتاحي ثابتة بعد إنشاء الحساب. استخدم مطابقة أو تصحيحًا بدل تغييرها.',
      })
    }
    if (!previousMovement && movement?.type === MOVEMENT_TYPES.OPENING_BALANCE) {
      const destinationAccountId = cleanId(movement.destinationAccountId)
      const destinationAccount = accountById.get(destinationAccountId)
      const suffix = movement.currency === CURRENCIES.USD ? 'usd' : 'dinar'
      const openingField = movement.currency === CURRENCIES.USD ? 'openingUsd' : 'openingDinar'
      if (previousAccounts.has(destinationAccountId)) {
        errors.push({
          code: 'opening-account-not-new',
          id: movement.id,
          field: 'destinationAccountId',
          message: 'الرصيد الافتتاحي يمكن إضافته عند إنشاء الحساب فقط.',
        })
      }
      if (
        !destinationAccount ||
        movement.id !== `opening-${destinationAccountId}-${suffix}` ||
        Number(movement.amount) !== Number(destinationAccount?.[openingField] || 0)
      ) {
        errors.push({
          code: 'opening-movement-mismatch',
          id: movement.id,
          field: 'amount',
          message: 'حركة الرصيد الافتتاحي لا تطابق الحساب الجديد.',
        })
      }
    }
    if (
      Number.isFinite(movement?.amount) &&
      !Number.isInteger(movement.amount) &&
      (!previousMovement || movement.amount !== previousMovement.amount)
    ) {
      errors.push({
        code: 'invalid-movement-amount',
        recordType: 'movements',
        id: movement.id,
        field: 'amount',
        message: 'مبلغ الحركة يجب أن يكون عددًا صحيحًا. سعر الصرف فقط يمكن أن يكون كسريًا.',
      })
    }
    if (previousMovement?.status === MOVEMENT_STATUSES.VOIDED && changedRecord(movement, previousMovements)) {
      errors.push({
        code: 'voided-movement-is-immutable',
        id: movement.id,
        message: 'لا يمكن تعديل حركة ملغاة.',
      })
    }
    if (invalidMovementStatusTransition(movement, previousMovements)) {
      errors.push({
        code: 'invalid-movement-status-transition',
        id: movement.id,
        field: 'status',
        message: 'لا يمكن إعادة حركة ملغاة أو إرجاع حركة معتمدة إلى المسودة أو المراجعة.',
      })
    }
    if (voidWindowExpired(movement, previousMovements, nowMs)) {
      errors.push({
        code: 'movement-void-window-expired',
        recordType: 'movements',
        id: movement.id,
        field: 'status',
        message: 'لا يمكن إلغاء حركة أقدم من 24 ساعة. استخدم حركة تصحيح.',
      })
    }
    if (editWindowExpired(movement, previousMovements, nowMs)) {
      errors.push({
        code: 'movement-edit-window-expired',
        recordType: 'movements',
        id: movement.id,
        field: 'updatedAt',
        message: 'لا يمكن تعديل حركة أقدم من 24 ساعة. استخدم حركة تصحيح.',
      })
    }
    if (previousMovement?.createdAt && String(movement?.createdAt || '') !== String(previousMovement.createdAt)) {
      errors.push({
        code: 'movement-created-at-immutable',
        recordType: 'movements',
        id: movement.id,
        field: 'createdAt',
        message: 'لا يمكن تغيير وقت إنشاء حركة موجودة.',
      })
    }
    if (
      previousMovement?.status === MOVEMENT_STATUSES.POSTED &&
      previousMovement.type !== movement.type &&
      (previousMovement.type === MOVEMENT_TYPES.RECORD_ONLY || movement.type === MOVEMENT_TYPES.RECORD_ONLY)
    ) {
      errors.push({
        code: 'movement-posting-mode-immutable',
        recordType: 'movements',
        id: movement.id,
        field: 'type',
        message: 'لا يمكن تحويل حركة مالية إلى تسجيل فقط أو العكس. ألغ الحركة وأنشئ واحدة جديدة.',
      })
    }
    if (
      changedRecord(movement, previousMovements) ||
      changedDimensionIds.has(cleanId(movement.dimensionId)) ||
      changedReconciliationIds.has(cleanId(movement.reconciliationId)) ||
      changedRecurringRuleIds.has(cleanId(movement.recurringRuleId))
    ) {
      validateMovementReferences(movement, dimensionMaps, reconciliationById, recurringRuleById, errors)
    }
    if (
      movement.status !== MOVEMENT_STATUSES.POSTED ||
      (!changedRecord(movement, previousMovements) && !dependsOnAccounts(movement, reclassifiedAccountIds))
    ) continue
    const validation = validateMovement(
      movement,
      accounts,
      movements.filter((item) => item.id !== movement.id),
      { originalMovement: previousMovement },
    )
    validation.errors.forEach((error) => errors.push({
      code: 'invalid-posted-movement',
      id: movement.id,
      field: error.field,
      message: error.message,
    }))
  }

  const balances = summarizeBalances(accounts, movements)
  for (const bucket of balances) {
    if (!OWN_VALUE_KINDS.has(bucket.account?.valueKind)) continue
    for (const [currency, value] of [[CURRENCIES.DINAR, bucket.dinar], [CURRENCIES.USD, bucket.usd]]) {
      if (Number(value || 0) >= 0) continue
      errors.push({
        code: 'negative-own-balance',
        id: bucket.account.id,
        currency,
        message: 'لا يمكن أن يكون رصيد فلوسك أو الأصل بالسالب.',
      })
    }
  }

  const balancesIncludingInactive = summarizeBalances(
    accounts.map((account) => ({ ...account, status: ACCOUNT_STATUSES.ACTIVE })),
    movements,
  )
  const rawBalances = rawBalancesByAccount(movements)
  for (const bucket of balancesIncludingInactive) {
    if (accountById.get(bucket.account.id)?.status !== ACCOUNT_STATUSES.INACTIVE) continue
    const rawBalance = rawBalances.get(cleanId(bucket.account.id))
    const carriesRawValue = Math.abs(Number(rawBalance?.dinar || 0)) > RAW_BALANCE_EPSILON ||
      Math.abs(Number(rawBalance?.usd || 0)) > RAW_BALANCE_EPSILON
    if (Number(bucket.dinar || 0) === 0 && Number(bucket.usd || 0) === 0 && !carriesRawValue) continue
    errors.push({
      code: 'inactive-account-has-balance',
      id: bucket.account.id,
      message: 'لا يمكن إخفاء حساب ما زال يحمل رصيدًا.',
    })
  }

  for (const dimension of dimensions) {
    const linkedAccountChanged = changedAccountIds.has(cleanId(dimension?.linkedAccountId))
    if (!changedRecord(dimension, previousDimensions) && !linkedAccountChanged) continue
    validateDimensionRecord(dimension, accountById, errors)
  }

  for (const reconciliation of reconciliations) {
    const accountChanged = changedAccountIds.has(cleanId(reconciliation?.accountId))
    if (!changedRecord(reconciliation, previousReconciliations) && !accountChanged) continue
    validateReconciliationRecord(reconciliation, accountById, errors)
  }

  for (const rule of recurringRules) {
    const template = rule?.template || {}
    const accountReferenceChanged = [template.sourceAccountId, template.destinationAccountId, template.expenseCategoryId]
      .some((accountId) => changedAccountIds.has(cleanId(accountId)))
    const dimensionReferenceChanged = changedDimensionIds.has(cleanId(template.dimensionId))
    if (
      !changedRecord(rule, previousRecurringRules) &&
      !accountReferenceChanged &&
      !dimensionReferenceChanged
    ) continue
    validateRecurringRuleRecord(rule, accountById, dimensionMaps, errors)
  }

  const previousAttachments = new Map((currentState.attachments || []).map((attachment) => [attachment.id, attachment]))
  const accountIds = new Set(accounts.map((account) => account.id))
  const movementIds = new Set(movements.map((movement) => movement.id))
  for (const attachment of nextState.attachments || []) {
    if (!changedRecord(attachment, previousAttachments)) continue
    const storagePath = String(attachment.storagePath || '').trim()
    const draftValidation = validateAttachmentDraft(attachment)
    draftValidation.errors.forEach((error) => errors.push({
      code: 'invalid-attachment',
      id: attachment.id,
      field: error.field,
      message: error.message,
    }))
    if (!attachment.accountId && !attachment.movementId) {
      errors.push({ code: 'orphan-attachment', id: attachment.id, message: 'يجب ربط المرفق بحساب أو حركة.' })
    }
    if (attachment.accountId && !accountIds.has(attachment.accountId)) {
      errors.push({ code: 'attachment-account-missing', id: attachment.id, message: 'الحساب المرتبط بالمرفق غير موجود.' })
    }
    if (attachment.movementId && !movementIds.has(attachment.movementId)) {
      errors.push({ code: 'attachment-movement-missing', id: attachment.id, message: 'الحركة المرتبطة بالمرفق غير موجودة.' })
    }
    if (storagePath && (!ledgerId || !storagePath.startsWith(`${ledgerId}/`) || storagePath.includes('..'))) {
      errors.push({
        code: 'attachment-outside-ledger',
        id: attachment.id,
        message: 'مسار المرفق لا يتبع هذا الدفتر.',
      })
    }
    if (storagePath && (!ALLOWED_ATTACHMENT_MIME_TYPES.has(String(attachment.mimeType || '').toLowerCase()) || Number(attachment.sizeBytes || 0) <= 0 || Number(attachment.sizeBytes) > ATTACHMENT_MAX_SIZE_BYTES)) {
      errors.push({ code: 'invalid-stored-attachment', id: attachment.id, message: 'بيانات الملف المحفوظ غير مكتملة أو غير مسموحة.' })
    }
  }

  return { ok: errors.length === 0, errors }
}
