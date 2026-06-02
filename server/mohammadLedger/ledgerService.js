import { createHash } from 'node:crypto'
import { VALUE_KINDS, getActivePostingAccounts } from '../../src/mohammadLedger/accountCatalog.js'
import { accountDisplayName } from '../../src/mohammadLedger/accountConfig.js'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  buildPostingEntries,
  postMovement,
  previewMovement,
  summarizeBalances,
} from '../../src/mohammadLedger/ledgerCore.js'
import {
  buildReconciliationCorrectionDrafts,
  createAttachment,
  createReconciliation,
  createRecurringRuleFromMovement,
} from '../../src/mohammadLedger/ledgerOperations.js'
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
  return account ? accountDisplayName(account) : ''
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

export function parseBalanceText(text) {
  const normalized = String(text || '')
    .replace(/[٬،\s]/g, '')
    .replace(/,/g, '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٫]/g, '.')
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number)
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
      return {
        state,
        movement: existing,
        duplicate: true,
        preview: previewDraft(state, existing),
        needsReview: existing.status !== MOVEMENT_STATUSES.POSTED,
      }
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
      state.movements,
    )
    const preview = previewDraft(state, movement)
    const attachments = appendTelegramAttachment(state.attachments, movement, draft)
    const recurringRules = appendTelegramRecurringRule(state.recurringRules, movement, draft)
    return {
      state: {
        ...state,
        movements: [...state.movements, movement],
        attachments,
        recurringRules,
      },
      movement,
      preview,
      duplicate: false,
      needsReview: movement.status !== MOVEMENT_STATUSES.POSTED,
    }
  })
}

export async function resolveTelegramReviewMovement(repository, movementId, draft, metadata = {}) {
  const id = String(movementId || '').trim()
  if (!id) throw new Error('Missing review movement id.')

  return repository.update((state) => {
    const target = state.movements.find((movement) => movement.id === id)
    if (!target || target.status !== MOVEMENT_STATUSES.NEEDS_REVIEW) {
      return {
        movement: target || null,
        rejected: true,
        needsReview: true,
        preview: target ? previewDraft(state, target) : null,
        error: 'الحركة لم تعد في المراجعة.',
      }
    }

    const movement = postMovement(
      {
        ...target,
        ...draft,
        id: target.id,
        source: target.source || 'telegram',
        idempotencyKey: target.idempotencyKey,
        telegramUserId: target.telegramUserId || metadata.telegramUserId,
        telegramChatId: target.telegramChatId || metadata.telegramChatId,
        reviewedBy: metadata.telegramUserId,
        reviewSource: 'telegram',
      },
      state.accounts,
      state.movements.filter((item) => item.id !== id),
    )
    const preview = previewDraft(
      { ...state, movements: state.movements.filter((item) => item.id !== id) },
      movement,
    )
    const attachments = appendTelegramAttachment(state.attachments, movement, draft)
    const recurringRules = appendTelegramRecurringRule(state.recurringRules, movement, draft)
    return {
      state: {
        ...state,
        movements: state.movements.map((item) => (item.id === id ? movement : item)),
        attachments,
        recurringRules,
      },
      movement,
      preview,
      duplicate: false,
      needsReview: movement.status !== MOVEMENT_STATUSES.POSTED,
    }
  })
}

export async function appendTelegramReconciliation(repository, draft, metadata = {}) {
  const idempotencyKey = String(metadata?.idempotencyKey || '').trim()
  if (!idempotencyKey) throw new Error('Missing Telegram reconciliation idempotency key.')

  return repository.update((state) => {
    const existing = (state.reconciliations || []).find((item) => item.source === 'telegram' && item.idempotencyKey === idempotencyKey)
    if (existing) {
      return {
        state,
        reconciliation: existing,
        correctionMovements: state.movements.filter((movement) => movement.reconciliationId === existing.id),
        duplicate: true,
      }
    }

    const snapshot = buildLedgerSnapshot(state)
    const account = snapshot.accountById.get(draft.accountId)
    const bucket = snapshot.balanceByAccountId.get(draft.accountId)
    const note = String(draft.note || '').trim()
    if (!account) {
      return { state, rejected: true, error: 'الحساب غير موجود.' }
    }
    if (!note) {
      return { state, rejected: true, error: 'المطابقة تحتاج ملاحظة واضحة.' }
    }

    const expectedDinar = Math.round(Number(bucket?.dinar || 0))
    const expectedUsd = Math.round(Number(bucket?.usd || 0))
    const currency = draft.currency || CURRENCIES.DINAR
    const actualDinar = currency === CURRENCIES.DINAR ? draft.actualBalance : expectedDinar
    const actualUsd = currency === CURRENCIES.USD ? draft.actualBalance : expectedUsd
    const reconciliation = {
      ...createReconciliation({
        accountId: draft.accountId,
        actualDinar,
        actualUsd,
        expectedDinar,
        expectedUsd,
        note,
      }),
      currency,
      source: 'telegram',
      idempotencyKey,
      telegramUserId: metadata.telegramUserId,
      telegramChatId: metadata.telegramChatId,
    }

    const correctionMovements = []
    let validationMovements = state.movements
    for (const correctionDraft of buildReconciliationCorrectionDrafts(reconciliation)) {
      if (correctionDraft.currency !== currency) continue
      const movement = postMovement({
        ...correctionDraft,
        id: telegramReconciliationMovementId(idempotencyKey, correctionDraft.currency),
        source: 'telegram',
        idempotencyKey: `${idempotencyKey}-${correctionDraft.currency}`,
        telegramUserId: metadata.telegramUserId,
        telegramChatId: metadata.telegramChatId,
      }, state.accounts, validationMovements)
      correctionMovements.push(movement)
      validationMovements = [...validationMovements, movement]
    }

    return {
      state: {
        ...state,
        reconciliations: [...(state.reconciliations || []), reconciliation],
        movements: [...state.movements, ...correctionMovements],
      },
      reconciliation,
      correctionMovements,
      duplicate: false,
      needsReview: correctionMovements.some((movement) => movement.status !== MOVEMENT_STATUSES.POSTED),
    }
  })
}

function appendTelegramAttachment(attachments = [], movement, draft = {}) {
  const attachment = createAttachment({
    movementId: movement.id,
    label: draft.attachmentLabel,
    url: draft.attachmentUrl,
    source: 'telegram',
  })
  if (!attachment) return attachments
  const hasSameAttachment = (Array.isArray(attachments) ? attachments : []).some((item) =>
    item?.movementId === attachment.movementId &&
    item?.label === attachment.label &&
    item?.url === attachment.url &&
    item?.source === attachment.source,
  )
  return hasSameAttachment ? attachments : [...(Array.isArray(attachments) ? attachments : []), attachment]
}

function appendTelegramRecurringRule(recurringRules = [], movement, draft = {}) {
  if (!draft.recurringEnabled) return recurringRules
  const rule = createRecurringRuleFromMovement(movement, { name: draft.recurringName || '' })
  if (!rule) return recurringRules
  const existingRules = Array.isArray(recurringRules) ? recurringRules : []
  const hasSameRule = existingRules.some((item) =>
    item?.template?.type === rule.template.type &&
    item?.template?.amount === rule.template.amount &&
    item?.template?.currency === rule.template.currency &&
    item?.template?.sourceAccountId === rule.template.sourceAccountId &&
    item?.template?.destinationAccountId === rule.template.destinationAccountId &&
    item?.template?.dimensionId === rule.template.dimensionId &&
    item?.template?.note === rule.template.note,
  )
  return hasSameRule ? recurringRules : [...existingRules, { ...rule, source: 'telegram' }]
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

function telegramReconciliationMovementId(idempotencyKey, currency) {
  const readable = idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'reconcile'
  const hash = createHash('sha256').update(`${idempotencyKey}-${currency}`).digest('hex').slice(0, 16)
  return `telegram-reconcile-${readable}-${currency}-${hash}`
}
