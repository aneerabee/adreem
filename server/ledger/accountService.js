import { createHash } from 'node:crypto'
import {
  accountOpeningAmounts,
  accountOpeningDraftErrors,
  accountPresetFor,
  counterpartyOpeningDraftErrors,
  emptyAccountDraft,
  emptyCounterpartyOpenings,
  isCounterpartyBundleDraft,
} from '../../src/ledger/accountConfig.js'
import { accountEditSnapshot, accountUpdateMovementErrors, prepareAccountUpdate } from '../../src/ledger/accountEditing.js'
import { normalizeAccountText } from '../../src/ledger/accountCompatibility.js'
import { ACCOUNT_STATUSES } from '../../src/ledger/accountCatalog.js'
import {
  buildCounterpartyAccountBundle,
  buildCounterpartyOpeningMovements,
  validateCounterpartyAccountBundle,
} from '../../src/ledger/counterpartyAccounts.js'
import { createAccount, createOpeningMovements, validateAccount, validateMovement } from '../../src/ledger/ledgerCore.js'
import { createAuditEvent } from '../../src/ledger/ledgerOperations.js'
import { accountSummaryScope } from '../../src/ledger/ledgerScope.js'
import { findTelegramUpdateAuditEvent } from './ledgerService.js'

function telegramAuditDetails(metadata = {}) {
  const telegramIdempotencyKey = String(metadata.idempotencyKey || '').trim()
  return telegramIdempotencyKey ? { telegramIdempotencyKey } : {}
}

export function normalizeAccountDraft(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const fallback = emptyAccountDraft()
  const openingAmounts = accountOpeningAmounts(draft)
  return {
    ownerName: normalizeAccountText(draft.ownerName || fallback.ownerName),
    subAccountName: normalizeAccountText(draft.subAccountName || preset.subAccountName || fallback.subAccountName),
    type: preset.type,
    valueKind: preset.valueKind,
    currencyKind: draft.currencyKind || fallback.currencyKind,
    counterpartyBundle: draft.counterpartyBundle === true,
    counterpartyOpenings: draft.counterpartyOpenings || emptyCounterpartyOpenings(),
    ...openingAmounts,
    notes: String(draft.notes || '').trim(),
    summaryScope: accountSummaryScope({ valueKind: preset.valueKind, summaryScope: draft.summaryScope }),
  }
}

export function buildAccountCandidate(draft = {}, metadata = {}) {
  const normalized = normalizeAccountDraft(draft)
  const account = createAccount(normalized)
  return {
    ...account,
    source: metadata.source || 'manual',
    idempotencyKey: metadata.idempotencyKey || undefined,
    telegramUserId: metadata.telegramUserId,
    telegramChatId: metadata.telegramChatId,
  }
}

export function buildAccountCandidates(draft = {}, metadata = {}) {
  const normalized = normalizeAccountDraft(draft)
  return isCounterpartyBundleDraft(normalized)
    ? buildCounterpartyAccountBundle(normalized, metadata)
    : [buildAccountCandidate(normalized, metadata)]
}

export function validateAccountDraft(draft, existingAccounts = []) {
  const normalized = normalizeAccountDraft(draft)
  if (isCounterpartyBundleDraft(normalized)) {
    return validateCounterpartyAccountBundle(normalized, existingAccounts)
  }
  const account = buildAccountCandidate(draft)
  const errors = [...accountOpeningDraftErrors(draft), ...validateAccount(account, existingAccounts).errors]
  return {
    account,
    validation: { ok: errors.length === 0, errors },
  }
}

export function validateExistingAccountDraft(state = {}, accountId, draft, mode = 'edit') {
  const id = String(accountId || '').trim()
  const target = (state.accounts || []).find((account) => account.id === id)
  if (!target) {
    return {
      account: null,
      validation: { ok: false, errors: [{ field: 'accountId', message: 'الحساب غير موجود.' }] },
      reason: 'missing-account',
    }
  }

  if (mode === 'review') {
    const normalized = normalizeAccountDraft(draft)
    const account = {
      ...target,
      ownerName: normalized.ownerName,
      subAccountName: normalized.subAccountName,
      type: normalized.type,
      valueKind: normalized.valueKind,
      currencyKind: normalized.currencyKind,
      notes: normalized.notes || target.notes || '',
      status: ACCOUNT_STATUSES.ACTIVE,
    }
    const candidateAccounts = (state.accounts || []).map((item) => (item.id === id ? account : item))
    const accountValidation = validateAccount(account, candidateAccounts.filter((item) => item.id !== id))
    const movementErrors = accountValidation.ok
      ? accountUpdateMovementErrors(id, candidateAccounts, state.movements || [])
      : []
    const errors = [...accountValidation.errors, ...movementErrors]
    return {
      account,
      validation: { ok: errors.length === 0, errors },
      reason: movementErrors.length ? 'movement-history' : accountValidation.ok ? '' : 'account-validation',
    }
  }

  const result = prepareAccountUpdate({
    accounts: state.accounts || [],
    movements: state.movements || [],
    reconciliations: state.reconciliations || [],
    recurringRules: state.recurringRules || [],
    dimensions: state.dimensions || [],
    accountId: id,
    draft: normalizeAccountDraft(draft),
  })
  return {
    account: result.account || target,
    validation: { ok: result.ok, errors: result.errors || [] },
    reason: result.reason || '',
    result,
  }
}

export async function appendTelegramAccount(repository, draft, metadata = {}) {
  const idempotencyKey = String(metadata.idempotencyKey || '').trim()
  if (!idempotencyKey) throw new Error('Missing Telegram account idempotency key.')

  return repository.update((state) => {
    const existingAccounts = state.accounts.filter((account) => account.source === 'telegram' && account.idempotencyKey === idempotencyKey)
    const existing = existingAccounts[0]
    if (existing) {
      const existingIds = new Set(existingAccounts.map((account) => account.id))
      const openingMovements = (state.movements || []).filter((movement) => existingIds.has(movement.destinationAccountId) && movement.type === 'opening_balance')
      return {
        state,
        account: existing,
        accounts: existingAccounts,
        openingMovements,
        bundle: existingAccounts.length > 1,
        duplicate: true,
        validation: { ok: true, errors: [] },
      }
    }

    const metadataFields = {
      source: 'telegram',
      idempotencyKey,
      telegramUserId: metadata.telegramUserId,
      telegramChatId: metadata.telegramChatId,
    }
    const normalized = normalizeAccountDraft(draft)
    const isBundle = isCounterpartyBundleDraft(normalized)
    const checked = isBundle
      ? validateCounterpartyAccountBundle(normalized, state.accounts, metadataFields)
      : null
    const accounts = isBundle ? checked.accounts : [buildAccountCandidate(normalized, metadataFields)]
    const account = accounts[0]
    const draftErrors = isBundle ? counterpartyOpeningDraftErrors(normalized) : accountOpeningDraftErrors(draft)
    const validationErrors = isBundle
      ? [...checked.validation.errors]
      : [...draftErrors, ...validateAccount(account, state.accounts).errors]
    const validation = { ok: validationErrors.length === 0, errors: validationErrors }
    if (!validation.ok) {
      return { state, account, accounts, bundle: isBundle, validation, rejected: true }
    }
    const openingResult = isBundle
      ? buildCounterpartyOpeningMovements(accounts, state.movements || [], state.accounts)
      : {
          movements: createOpeningMovements([account], account.createdAt),
          validation: { ok: true, errors: [] },
        }
    const openingMovements = openingResult.movements
    const openingErrors = isBundle
      ? openingResult.validation.errors
      : openingMovements.flatMap((movement) => validateMovement(movement, [...state.accounts, account], state.movements || []).errors)
    if (openingErrors.length) {
      return {
        state,
        account,
        accounts,
        bundle: isBundle,
        openingMovements: [],
        validation: { ok: false, errors: openingErrors },
        rejected: true,
      }
    }
    return {
      state: {
        ...state,
        accounts: [...state.accounts, ...accounts],
        movements: [...(state.movements || []), ...openingMovements],
        auditEvents: [
          ...(state.auditEvents || []),
          createAuditEvent('account.created', {
            accountId: account.id,
            accountIds: accounts.map((item) => item.id),
            counterpartyId: account.counterpartyId || '',
            openingMovementIds: openingMovements.map((movement) => movement.id),
            source: 'telegram',
            telegramUserId: metadata.telegramUserId,
            ...telegramAuditDetails(metadata),
          }),
        ],
      },
      account,
      accounts,
      bundle: isBundle,
      openingMovements,
      validation,
      duplicate: false,
    }
  })
}

export async function resolveTelegramReviewAccount(repository, accountId, draft, metadata = {}) {
  const id = String(accountId || '').trim()
  if (!id) throw new Error('Missing review account id.')

  return repository.update((state) => {
    const existingAudit = findTelegramUpdateAuditEvent(state, metadata.idempotencyKey)
    if (existingAudit) {
      const account = state.accounts.find((item) => item.id === existingAudit.details?.accountId) || null
      return {
        state,
        account,
        validation: { ok: Boolean(account), errors: [] },
        duplicate: true,
      }
    }
    const target = state.accounts.find((account) => account.id === id)
    if (!target || target.status !== ACCOUNT_STATUSES.NEEDS_REVIEW) {
      return {
        account: target || null,
        validation: { ok: false, errors: [{ field: 'accountId', message: 'الحساب لم يعد في المراجعة.' }] },
        rejected: true,
      }
    }

    const checked = validateExistingAccountDraft(state, id, draft, 'review')
    if (!checked.validation.ok) return { ...checked, rejected: true }
    const normalized = normalizeAccountDraft(draft)
    const now = new Date().toISOString()
    const account = {
      ...target,
      ownerName: normalized.ownerName,
      subAccountName: normalized.subAccountName,
      type: normalized.type,
      valueKind: normalized.valueKind,
      currencyKind: normalized.currencyKind,
      notes: normalized.notes || target.notes || '',
      status: ACCOUNT_STATUSES.ACTIVE,
      reviewedAt: now,
      updatedAt: now,
      reviewedBy: metadata.telegramUserId,
      reviewSource: 'telegram',
    }
    const validation = checked.validation

    return {
      state: {
        ...state,
        accounts: state.accounts.map((item) => (item.id === id ? account : item)),
        auditEvents: [
          ...(state.auditEvents || []),
          createAuditEvent('account.updated', {
            accountId: id,
            before: accountEditSnapshot(target),
            after: accountEditSnapshot(account),
            source: 'telegram',
            telegramUserId: metadata.telegramUserId,
            ...telegramAuditDetails(metadata),
          }),
        ],
      },
      account,
      validation,
      duplicate: false,
    }
  })
}

export async function updateTelegramAccount(repository, accountId, draft, metadata = {}) {
  const id = String(accountId || '').trim()
  if (!id) throw new Error('Missing account id.')

  return repository.update((state) => {
    const existingAudit = findTelegramUpdateAuditEvent(state, metadata.idempotencyKey)
    if (existingAudit) {
      const account = state.accounts.find((item) => item.id === existingAudit.details?.accountId) || null
      return {
        state,
        account,
        validation: { ok: Boolean(account), errors: [] },
        changes: [],
        duplicate: true,
      }
    }
    const target = state.accounts.find((account) => account.id === id)
    if (!target || target.status !== ACCOUNT_STATUSES.ACTIVE) {
      return {
        account: target || null,
        validation: { ok: false, errors: [{ field: 'accountId', message: 'الحساب غير متاح للتعديل.' }] },
        rejected: true,
      }
    }

    const checked = validateExistingAccountDraft(state, id, draft, 'edit')
    const result = checked.result
    if (!result.ok) {
      return {
        account: result.account || target,
        validation: { ok: false, errors: result.errors || [] },
        reason: result.reason,
        rejected: true,
      }
    }
    if (!result.changes.length) {
      return {
        state,
        account: target,
        validation: { ok: true, errors: [] },
        changes: [],
        unchanged: true,
      }
    }

    return {
      state: {
        ...state,
        accounts: result.accounts,
        auditEvents: [
          ...(state.auditEvents || []),
          createAuditEvent('account.updated', {
            accountId: id,
            accountIds: result.accountIds || [id],
            before: accountEditSnapshot(target),
            after: accountEditSnapshot(result.account),
            source: 'telegram',
            telegramUserId: metadata.telegramUserId,
            ...telegramAuditDetails(metadata),
          }),
        ],
      },
      account: result.account,
      accountIds: result.accountIds || [id],
      validation: { ok: true, errors: [] },
      changes: result.changes,
      unchanged: false,
    }
  })
}

export function accountIdempotencyKey(parts = []) {
  const raw = parts.map((part) => String(part ?? '')).join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 24)
}
