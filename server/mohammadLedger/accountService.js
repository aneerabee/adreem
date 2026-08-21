import { createHash } from 'node:crypto'
import { accountOpeningAmounts, accountOpeningDraftErrors, accountPresetFor, emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
import { accountEditSnapshot, accountUpdateMovementErrors, prepareAccountUpdate } from '../../src/mohammadLedger/accountEditing.js'
import { normalizeAccountText } from '../../src/mohammadLedger/accountCompatibility.js'
import { ACCOUNT_STATUSES } from '../../src/mohammadLedger/accountCatalog.js'
import { createAccount, createOpeningMovements, validateAccount, validateMovement } from '../../src/mohammadLedger/ledgerCore.js'
import { createAuditEvent } from '../../src/mohammadLedger/ledgerOperations.js'
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
    ...openingAmounts,
    notes: String(draft.notes || '').trim(),
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

export function validateAccountDraft(draft, existingAccounts = []) {
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
    const existing = state.accounts.find((account) => account.source === 'telegram' && account.idempotencyKey === idempotencyKey)
    if (existing) {
      const openingMovements = (state.movements || []).filter((movement) => movement.id === `opening-${existing.id}-dinar` || movement.id === `opening-${existing.id}-usd`)
      return {
        state,
        account: existing,
        openingMovements,
        duplicate: true,
        validation: { ok: true, errors: [] },
      }
    }

    const account = buildAccountCandidate(draft, {
      source: 'telegram',
      idempotencyKey,
      telegramUserId: metadata.telegramUserId,
      telegramChatId: metadata.telegramChatId,
    })
    const draftErrors = accountOpeningDraftErrors(draft)
    const validationErrors = [...draftErrors, ...validateAccount(account, state.accounts).errors]
    const validation = { ok: validationErrors.length === 0, errors: validationErrors }
    if (!validation.ok) {
      return { state, account, validation, rejected: true }
    }
    const openingMovements = createOpeningMovements([account], account.createdAt)
    const openingErrors = openingMovements.flatMap((movement) => validateMovement(movement, [...state.accounts, account], state.movements || []).errors)
    if (openingErrors.length) {
      return {
        state,
        account,
        openingMovements: [],
        validation: { ok: false, errors: openingErrors },
        rejected: true,
      }
    }
    return {
      state: {
        ...state,
        accounts: [...state.accounts, account],
        movements: [...(state.movements || []), ...openingMovements],
        auditEvents: [
          ...(state.auditEvents || []),
          createAuditEvent('account.created', {
            accountId: account.id,
            openingMovementIds: openingMovements.map((movement) => movement.id),
            source: 'telegram',
            telegramUserId: metadata.telegramUserId,
            ...telegramAuditDetails(metadata),
          }),
        ],
      },
      account,
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
            before: accountEditSnapshot(target),
            after: accountEditSnapshot(result.account),
            source: 'telegram',
            telegramUserId: metadata.telegramUserId,
            ...telegramAuditDetails(metadata),
          }),
        ],
      },
      account: result.account,
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
