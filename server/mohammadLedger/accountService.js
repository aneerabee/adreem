import { createHash } from 'node:crypto'
import { accountPresetFor, emptyAccountDraft } from '../../src/mohammadLedger/accountConfig.js'
import { createAccount, validateAccount } from '../../src/mohammadLedger/ledgerCore.js'

export function normalizeAccountDraft(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const fallback = emptyAccountDraft()
  return {
    ownerName: String(draft.ownerName || fallback.ownerName).trim(),
    subAccountName: String(draft.subAccountName || preset.subAccountName || fallback.subAccountName).trim(),
    type: preset.type,
    valueKind: preset.valueKind,
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

export function accountIdempotencyKey(parts = []) {
  const raw = parts.map((part) => String(part ?? '')).join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 24)
}
