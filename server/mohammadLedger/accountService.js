import { createHash } from 'node:crypto'
import { accountPresetFor, emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
import { ACCOUNT_STATUSES } from '../../src/mohammadLedger/accountCatalog.js'
import { createAccount, validateAccount } from '../../src/mohammadLedger/ledgerCore.js'

export function normalizeAccountDraft(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const fallback = emptyAccountDraft()
  return {
    ownerName: String(draft.ownerName || fallback.ownerName).trim(),
    subAccountName: String(draft.subAccountName || preset.subAccountName || fallback.subAccountName).trim(),
    type: preset.type,
    valueKind: preset.valueKind,
    currencyKind: draft.currencyKind || fallback.currencyKind,
    openingDinar: 0,
    openingUsd: 0,
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
  return {
    account,
    validation: validateAccount(account, existingAccounts),
  }
}

export async function appendTelegramAccount(repository, draft, metadata = {}) {
  const idempotencyKey = String(metadata.idempotencyKey || '').trim()
  if (!idempotencyKey) throw new Error('Missing Telegram account idempotency key.')

  return repository.update((state) => {
    const existing = state.accounts.find((account) => account.source === 'telegram' && account.idempotencyKey === idempotencyKey)
    if (existing) {
      return {
        state,
        account: existing,
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
    const validation = validateAccount(account, state.accounts)
    if (!validation.ok) {
      return { state, account, validation, rejected: true }
    }
    return {
      state: {
        ...state,
        accounts: [...state.accounts, account],
      },
      account,
      validation,
      duplicate: false,
    }
  })
}

export async function resolveTelegramReviewAccount(repository, accountId, draft, metadata = {}) {
  const id = String(accountId || '').trim()
  if (!id) throw new Error('Missing review account id.')

  return repository.update((state) => {
    const target = state.accounts.find((account) => account.id === id)
    if (!target || target.status !== ACCOUNT_STATUSES.NEEDS_REVIEW) {
      return {
        account: target || null,
        validation: { ok: false, errors: [{ field: 'accountId', message: 'الحساب لم يعد في المراجعة.' }] },
        rejected: true,
      }
    }

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
    const validation = validateAccount(account, state.accounts.filter((item) => item.id !== id))
    if (!validation.ok) return { account, validation, rejected: true }

    return {
      state: {
        ...state,
        accounts: state.accounts.map((item) => (item.id === id ? account : item)),
      },
      account,
      validation,
      duplicate: false,
    }
  })
}

export function accountIdempotencyKey(parts = []) {
  const raw = parts.map((part) => String(part ?? '')).join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 24)
}
