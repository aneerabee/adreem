import { ACCOUNT_STATUSES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  summarizeBalances,
  validateAccount,
  validateMovement,
} from '../../src/mohammadLedger/ledgerCore.js'
import { recordTimestamp } from '../../src/mohammadLedger/ledgerState.js'

const OWN_VALUE_KINDS = new Set([VALUE_KINDS.CASH, VALUE_KINDS.BANK, VALUE_KINDS.ASSET])
const RECORD_LISTS = ['accounts', 'movements', 'dimensions', 'attachments', 'recurringRules', 'reconciliations', 'auditEvents']

function changedRecord(record, previousById) {
  const previous = previousById.get(record?.id)
  return !previous || recordTimestamp(record) > recordTimestamp(previous)
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
    if (movement.status !== MOVEMENT_STATUSES.POSTED || !changedRecord(movement, previousMovements)) continue
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
    if (Math.round(Number(bucket.dinar || 0)) === 0 && Math.round(Number(bucket.usd || 0)) === 0) continue
    errors.push({
      code: 'inactive-account-has-balance',
      id: bucket.account.id,
      message: 'لا يمكن إخفاء حساب ما زال يحمل رصيدًا.',
    })
  }

  const previousAttachments = new Map((currentState.attachments || []).map((attachment) => [attachment.id, attachment]))
  for (const attachment of nextState.attachments || []) {
    if (!changedRecord(attachment, previousAttachments) || !attachment.storagePath) continue
    if (!ledgerId || !String(attachment.storagePath).startsWith(`${ledgerId}/`) || String(attachment.storagePath).includes('..')) {
      errors.push({
        code: 'attachment-outside-ledger',
        id: attachment.id,
        message: 'مسار المرفق لا يتبع هذا الدفتر.',
      })
    }
  }

  return { ok: errors.length === 0, errors }
}
