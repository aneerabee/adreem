import { VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, postMovement } from './ledgerCore.js'
import { movementLabels } from './movementConfig.js'

export const DIMENSION_TYPES = {
  ASSET: 'asset',
  PROJECT: 'project',
  COST_CENTER: 'cost_center',
}

export const RECURRING_FREQUENCIES = {
  MONTHLY: 'monthly',
}

export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  '',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

function nowIso() {
  return new Date().toISOString()
}

function stableId(prefix, text) {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .slice(0, 48)
  return `${prefix}-${normalized || Date.now()}`
}

function monthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function sameId(left, right) {
  return String(left || '') === String(right || '')
}

export function dimensionsFromAccounts(accounts = [], dimensions = []) {
  const byId = new Map((Array.isArray(dimensions) ? dimensions : []).filter(Boolean).map((dimension) => [dimension.id, dimension]))
  for (const account of accounts) {
    if (account?.status === 'inactive') continue
    if (account?.type !== 'project' && account?.valueKind !== VALUE_KINDS.ASSET) continue
    const id = account.dimensionId || `dimension-account-${account.id}`
    if (byId.has(id)) continue
    byId.set(id, {
      id,
      name: account.ownerName || account.subAccountName || account.legacyName || 'بدون اسم',
      type: account.type === 'project' ? DIMENSION_TYPES.PROJECT : DIMENSION_TYPES.ASSET,
      linkedAccountId: account.id,
      status: 'active',
      createdAt: account.createdAt || nowIso(),
    })
  }
  return Array.from(byId.values()).filter((dimension) => dimension?.status !== 'inactive')
}

export function buildDimensionReports(state = {}) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const movements = Array.isArray(state.movements) ? state.movements : []
  const dimensions = dimensionsFromAccounts(accounts, state.dimensions)
  return dimensions.map((dimension) => {
    const related = movements.filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && sameId(movement.dimensionId, dimension.id))
    const totals = related.reduce(
      (acc, movement) => {
        const amount = Math.abs(Number(movement.amount || 0))
        const bucket = movement.currency === CURRENCIES.USD ? acc.usd : acc.dinar
        if (movement.type === MOVEMENT_TYPES.EXPENSE || movement.type === MOVEMENT_TYPES.TRUCK_EXPENSE) bucket.expense += amount
        if (movement.type === MOVEMENT_TYPES.EXTERNAL_INCOME || movement.type === MOVEMENT_TYPES.TRUCK_INCOME) bucket.income += amount
        return acc
      },
      {
        dinar: { income: 0, expense: 0 },
        usd: { income: 0, expense: 0 },
      },
    )
    const net = totals.dinar.income - totals.dinar.expense
    const netUsd = totals.usd.income - totals.usd.expense
    return {
      dimension,
      movementCount: related.length,
      income: totals.dinar.income,
      expense: totals.dinar.expense,
      net,
      incomeUsd: totals.usd.income,
      expenseUsd: totals.usd.expense,
      netUsd,
    }
  }).sort((a, b) => (Math.abs(b.net) + Math.abs(b.netUsd)) - (Math.abs(a.net) + Math.abs(a.netUsd)) || b.movementCount - a.movementCount)
}

export function validateAttachmentDraft({ label = '', url = '', mimeType = '', sizeBytes = 0 } = {}) {
  const errors = []
  const cleanLabel = String(label || url || '').trim()
  const cleanUrl = String(url || '').trim()
  const cleanMimeType = String(mimeType || '').trim().toLowerCase()
  const cleanSize = Number(sizeBytes || 0)

  if (!cleanLabel && !cleanUrl) errors.push({ field: 'label', message: 'اكتب اسم المرفق أو رابطه.' })
  if (cleanMimeType && !ALLOWED_ATTACHMENT_MIME_TYPES.has(cleanMimeType)) {
    errors.push({ field: 'mimeType', message: 'نوع المرفق غير مسموح.' })
  }
  if (Number.isFinite(cleanSize) && cleanSize > ATTACHMENT_MAX_SIZE_BYTES) {
    errors.push({ field: 'sizeBytes', message: 'حجم المرفق أكبر من الحد المسموح.' })
  }

  return { ok: errors.length === 0, errors }
}

export function createAttachment({ movementId = '', accountId = '', label = '', url = '', source = 'web', mimeType = '', sizeBytes = 0, storagePath = '' } = {}) {
  const validation = validateAttachmentDraft({ label, url, mimeType, sizeBytes })
  if (!validation.ok) return null
  const cleanLabel = String(label || url || '').trim()
  const cleanUrl = String(url || '').trim()
  const cleanMimeType = String(mimeType || '').trim().toLowerCase()
  const createdAt = nowIso()
  return {
    id: stableId('attachment', `${movementId || accountId}-${cleanLabel || cleanUrl}-${createdAt}`),
    movementId,
    accountId,
    label: cleanLabel || cleanUrl,
    url: cleanUrl,
    source,
    mimeType: cleanMimeType,
    sizeBytes: Math.max(0, Math.round(Number(sizeBytes || 0))),
    storagePath: String(storagePath || '').trim(),
    createdAt,
    updatedAt: createdAt,
  }
}

export function attachmentsForRecord(attachments = [], { movementId = '', accountId = '' } = {}) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachment) => {
    if (movementId && attachment.movementId === movementId) return true
    if (accountId && attachment.accountId === accountId) return true
    return false
  })
}

export function createReconciliation({ accountId, actualDinar, actualUsd, expectedDinar, expectedUsd, note = '' }) {
  const createdAt = nowIso()
  const roundedActualDinar = Math.round(Number(actualDinar || 0))
  const roundedActualUsd = Math.round(Number(actualUsd || 0))
  const roundedExpectedDinar = Math.round(Number(expectedDinar || 0))
  const roundedExpectedUsd = Math.round(Number(expectedUsd || 0))
  return {
    id: stableId('reconcile', `${accountId}-${createdAt}`),
    accountId,
    actualDinar: roundedActualDinar,
    actualUsd: roundedActualUsd,
    expectedDinar: roundedExpectedDinar,
    expectedUsd: roundedExpectedUsd,
    diffDinar: roundedActualDinar - roundedExpectedDinar,
    diffUsd: roundedActualUsd - roundedExpectedUsd,
    note: String(note || '').trim(),
    createdAt,
  }
}

export function buildReconciliationCorrectionDrafts(reconciliation) {
  if (!reconciliation?.accountId) return []
  const note = String(reconciliation.note || '').trim()
  return [
    { currency: CURRENCIES.DINAR, delta: Number(reconciliation.diffDinar || 0) },
    { currency: CURRENCIES.USD, delta: Number(reconciliation.diffUsd || 0) },
  ]
    .filter((item) => item.delta !== 0)
    .map((item) => ({
      type: MOVEMENT_TYPES.CORRECTION,
      amount: item.delta,
      currency: item.currency,
      sourceAccountId: null,
      destinationAccountId: reconciliation.accountId,
      note,
      reconciliationId: reconciliation.id,
    }))
}

export function lastReconciliationForAccount(reconciliations = [], accountId) {
  return (Array.isArray(reconciliations) ? reconciliations : [])
    .filter((item) => item.accountId === accountId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null
}

export function createRecurringRuleFromMovement(movement, { frequency = RECURRING_FREQUENCIES.MONTHLY, name = '' } = {}) {
  if (!movement || movement.status !== MOVEMENT_STATUSES.POSTED) return null
  const createdAt = nowIso()
  return {
    id: stableId('recurring', `${movement.type}-${movement.sourceAccountId}-${movement.destinationAccountId}-${createdAt}`),
    name: String(name || `${movementLabels[movement.type] || 'حركة'} ${Math.round(Number(movement.amount || 0)).toLocaleString('en-US')}`).trim(),
    status: 'active',
    frequency,
    template: {
      type: movement.type,
      amount: movement.amount,
      currency: movement.currency,
      sourceAccountId: movement.sourceAccountId || null,
      destinationAccountId: movement.destinationAccountId || null,
      rate: movement.rate,
      note: movement.note,
      dimensionId: movement.dimensionId || '',
    },
    lastRunKey: '',
    createdAt,
    updatedAt: createdAt,
  }
}

export function dueRecurringRules(rules = [], date = new Date()) {
  const key = monthKey(date)
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.status === 'active')
    .filter((rule) => rule.frequency === RECURRING_FREQUENCIES.MONTHLY)
    .filter((rule) => rule.lastRunKey !== key)
}

export function buildLedgerAlerts({
  reviewAccounts = [],
  reviewMovements = [],
  externalMissing = [],
  balances = [],
  movements = [],
  totals = {},
  dueRecurringCount = 0,
  reconciliationDiffCount = 0,
} = {}) {
  const alerts = []
  const negativeMoneyAccounts = balances.filter((bucket) =>
    (bucket.account?.valueKind === VALUE_KINDS.CASH || bucket.account?.valueKind === VALUE_KINDS.BANK) &&
    Math.round(bucket.dinar || 0) < 0,
  )
  const liveMovements = (Array.isArray(movements) ? movements : [])
    .filter((movement) => movement?.status !== MOVEMENT_STATUSES.VOIDED)
    .filter((movement) => movement?.type !== MOVEMENT_TYPES.OPENING_BALANCE)
  const largeMovementCount = liveMovements.filter((movement) => {
    const amount = Math.abs(Number(movement.amount || 0))
    if (movement.currency === CURRENCIES.USD) return amount >= 10_000
    return amount >= 100_000
  }).length
  const movementFrequency = new Map()
  for (const movement of liveMovements) {
    const day = String(movement.createdAt || movement.updatedAt || '').slice(0, 10)
    if (!day) continue
    const key = [
      day,
      movement.type,
      movement.currency,
      Math.round(Number(movement.amount || 0)),
      movement.sourceAccountId || '',
      movement.destinationAccountId || '',
      movement.rate || '',
    ].join('|')
    movementFrequency.set(key, (movementFrequency.get(key) || 0) + 1)
  }
  const duplicateMovementCount = Array.from(movementFrequency.values()).filter((count) => count > 1).length

  if (reviewMovements.length) alerts.push({ tone: 'danger', title: 'حركات ناقصة', value: reviewMovements.length })
  if (reviewAccounts.length) alerts.push({ tone: 'warning', title: 'حسابات للتصنيف', value: reviewAccounts.length })
  if (externalMissing.length) alerts.push({ tone: 'info', title: 'أسماء جديدة', value: externalMissing.length })
  if (negativeMoneyAccounts.length) alerts.push({ tone: 'danger', title: 'حساب مالي ناقص', value: negativeMoneyAccounts.length })
  if (Math.round(Number(totals.iOwePeople || 0)) > 0) alerts.push({ tone: 'warning', title: 'أدفع للناس', value: Math.round(Number(totals.iOwePeople || 0)), format: 'money' })
  if (dueRecurringCount) alerts.push({ tone: 'info', title: 'حركات متكررة', value: dueRecurringCount })
  if (reconciliationDiffCount) alerts.push({ tone: 'warning', title: 'فروق مطابقة', value: reconciliationDiffCount })
  if (largeMovementCount) alerts.push({ tone: 'warning', title: 'حركة كبيرة', value: largeMovementCount })
  if (duplicateMovementCount) alerts.push({ tone: 'info', title: 'تكرار محتمل', value: duplicateMovementCount })
  return alerts
}

export function runRecurringRule(rule, accounts = [], date = new Date()) {
  const runKey = monthKey(date)
  const movement = postMovement(
    {
      ...(rule?.template || {}),
      id: `recurring-${rule.id}-${runKey}`,
      note: [rule?.template?.note, `تكرار ${runKey}`].filter(Boolean).join(' · '),
      recurringRuleId: rule.id,
      recurringRunKey: runKey,
    },
    accounts,
  )
  return {
    movement,
    rule: {
      ...rule,
      ...(movement.status === MOVEMENT_STATUSES.POSTED
        ? {
            lastRunKey: runKey,
            lastRunAt: nowIso(),
            updatedAt: nowIso(),
          }
        : {
            lastFailedRunKey: runKey,
            lastFailedRunAt: nowIso(),
            updatedAt: nowIso(),
          }),
    },
  }
}

export function disableRecurringRule(rule, disabledAt = nowIso()) {
  if (!rule) return null
  return {
    ...rule,
    status: 'inactive',
    disabledAt,
    updatedAt: disabledAt,
  }
}

export function createAuditEvent(action, details = {}) {
  const createdAt = nowIso()
  return {
    id: stableId('audit', `${action}-${createdAt}`),
    action,
    details,
    createdAt,
  }
}
