import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  summarizeBalances,
  validateAccount,
  validateMovement,
} from '../../src/mohammadLedger/ledgerCore.js'
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  validateAttachmentDraft,
} from '../../src/mohammadLedger/ledgerOperations.js'
import { recordTimestamp } from '../../src/mohammadLedger/ledgerState.js'

const OWN_VALUE_KINDS = new Set([VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.ASSET])
const RECORD_LISTS = ['accounts', 'movements', 'dimensions', 'attachments', 'recurringRules', 'reconciliations', 'auditEvents']
const ACCOUNT_CLASSIFICATION_FIELDS = ['type', 'valueKind', 'currencyKind']
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
  return !previous || recordTimestamp(record) > recordTimestamp(previous)
}

function changedAccountClassification(account, previousById) {
  const previous = previousById.get(account?.id)
  return Boolean(previous) && ACCOUNT_CLASSIFICATION_FIELDS.some((field) => account?.[field] !== previous?.[field])
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

export function validateLedgerStateTransition(nextState = {}, currentState = {}, { ledgerId = '' } = {}) {
  const errors = duplicateOrMissingIdErrors(nextState)
  const accounts = Array.isArray(nextState.accounts) ? nextState.accounts : []
  const movements = Array.isArray(nextState.movements) ? nextState.movements : []
  const previousAccounts = new Map((currentState.accounts || []).map((account) => [account.id, account]))
  const previousMovements = new Map((currentState.movements || []).map((movement) => [movement.id, movement]))
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
    const validation = validateAccount(account, accounts.filter((item) => item.id !== account.id))
    validation.errors.forEach((error) => errors.push({
      code: 'invalid-account',
      id: account.id,
      field: error.field,
      message: error.message,
    }))
  }

  for (const movement of movements) {
    const previousMovement = previousMovements.get(movement.id)
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
    if (
      movement.status !== MOVEMENT_STATUSES.POSTED ||
      (!changedRecord(movement, previousMovements) && !dependsOnAccounts(movement, reclassifiedAccountIds))
    ) continue
    const validation = validateMovement(movement, accounts, movements.filter((item) => item.id !== movement.id))
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
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  for (const bucket of balancesIncludingInactive) {
    if (accountById.get(bucket.account.id)?.status !== ACCOUNT_STATUSES.INACTIVE) continue
    if (Number(bucket.dinar || 0) === 0 && Number(bucket.usd || 0) === 0) continue
    errors.push({
      code: 'inactive-account-has-balance',
      id: bucket.account.id,
      message: 'لا يمكن إخفاء حساب ما زال يحمل رصيدًا.',
    })
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
