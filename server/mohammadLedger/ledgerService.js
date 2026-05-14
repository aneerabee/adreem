import { createHash } from 'node:crypto'
import { VALUE_KINDS, getActivePostingAccounts } from '../../src/mohammadLedger/accountCatalog.js'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  buildPostingEntries,
  postMovement,
  previewMovement,
  summarizeBalances,
} from '../../src/mohammadLedger/ledgerCore.js'
import {
  getMovementAccounts as getSharedMovementAccounts,
  rankMovementAccounts,
} from '../../src/mohammadLedger/movementAccounts.js'

const MONEY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const RATE_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })

export function formatInteger(value) {
  return MONEY_FORMAT.format(Math.round(Number(value || 0)))
}

export function formatMoney(value, currency = CURRENCIES.DINAR) {
  return `${formatInteger(value)} ${currency === CURRENCIES.USD ? '$' : 'د.ل'}`
}

export function formatRate(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? RATE_FORMAT.format(number) : ''
}

export function accountLabel(account) {
  if (!account) return ''
  const ownerName = String(account.ownerName || '').trim()
  const subAccountName = String(account.subAccountName || '').trim()
  if (ownerName && subAccountName) return `${ownerName} / ${subAccountName}`
  return ownerName || subAccountName || 'حساب بدون اسم'
}

export function balanceText(account, bucket) {
  const dinar = Math.round(Number(bucket?.dinar || 0))
  const usd = Math.round(Number(bucket?.usd || 0))
  if (usd && !dinar) return formatMoney(Math.abs(usd), CURRENCIES.USD)
  if (!dinar) return 'صفر'
  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return dinar > 0 ? `موجود ${formatMoney(dinar)}` : `ناقص ${formatMoney(Math.abs(dinar))}`
  }
  if (account?.valueKind === VALUE_KINDS.ASSET) return `قيمة ${formatMoney(Math.abs(dinar))}`
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return `مصروف ${formatMoney(Math.abs(dinar))}`
  return dinar > 0 ? `أقبض منه ${formatMoney(dinar)}` : `أدفع له ${formatMoney(Math.abs(dinar))}`
}

export function parseAmountText(text, { allowDecimal = false } = {}) {
  const normalized = String(text || '')
    .replace(/[٬،\s]/g, '')
    .replace(/,/g, '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٫]/g, '.')
  const number = Number(normalized)
  if (!Number.isFinite(number) || number <= 0) return null
  return allowDecimal ? number : Math.round(number)
}

export function buildLedgerSnapshot(state) {
  const balances = summarizeBalances(state.accounts, state.movements)
  const activeAccounts = getActivePostingAccounts(state.accounts)
  return {
    accounts: state.accounts,
    movements: state.movements,
    balances,
    activeAccounts,
    accountById: new Map(state.accounts.map((account) => [account.id, account])),
    balanceByAccountId: new Map(balances.map((bucket) => [bucket.account.id, bucket])),
  }
}

export function getMovementAccounts(state, movementType, role, selected = {}) {
  const snapshot = buildLedgerSnapshot(state)
  return getSharedMovementAccounts(snapshot.accounts, snapshot.balanceByAccountId, movementType, role, selected)
}

export function rankAccountsForTelegram(accounts, state, query = '') {
  const snapshot = buildLedgerSnapshot(state)
  return rankMovementAccounts(accounts, snapshot.balanceByAccountId, query)
}

export function previewDraft(state, draft) {
  return previewMovement(draft, state.accounts, state.movements)
}

export async function appendTelegramMovement(repository, draft, metadata) {
  const idempotencyKey = String(metadata?.idempotencyKey || '').trim()
  if (!idempotencyKey) throw new Error('Missing Telegram movement idempotency key.')

  return repository.update((state) => {
    const existing = state.movements.find((movement) => movement.source === 'telegram' && movement.idempotencyKey === idempotencyKey)
    if (existing) {
      return { state, movement: existing, duplicate: true, preview: previewDraft(state, existing) }
    }

    const movement = postMovement(
      {
        ...draft,
        id: telegramMovementId(idempotencyKey),
        source: 'telegram',
        idempotencyKey,
        telegramUserId: metadata.telegramUserId,
        telegramChatId: metadata.telegramChatId,
      },
      state.accounts,
    )
    const preview = previewDraft(state, movement)
    if (movement.status !== MOVEMENT_STATUSES.POSTED) {
      return { state, movement, preview, rejected: true }
    }
    return {
      state: {
        ...state,
        movements: [...state.movements, movement],
      },
      movement,
      preview,
      duplicate: false,
    }
  })
}

export function movementEffectsText(state, movement) {
  const snapshot = buildLedgerSnapshot(state)
  const entries = buildPostingEntries(movement)
  return entries.map((entry) => {
    const account = snapshot.accountById.get(entry.accountId)
    const beforeBucket = snapshot.balanceByAccountId.get(entry.accountId)
    const before = entry.currency === CURRENCIES.USD ? beforeBucket?.usd || 0 : beforeBucket?.dinar || 0
    const after = before + entry.delta
    const sign = entry.delta > 0 ? '+' : '-'
    return `${accountLabel(account)}\n${formatMoney(before, entry.currency)} → ${formatMoney(after, entry.currency)}\n${sign}${formatMoney(Math.abs(entry.delta), entry.currency)}`
  })
}

function telegramMovementId(idempotencyKey) {
  const readable = idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'movement'
  const hash = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)
  return `telegram-${readable}-${hash}`
}
