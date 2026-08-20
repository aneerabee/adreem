import { VALUE_KINDS } from './accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES, postMovement, roundMoney } from './ledgerCore.js'
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

function dimensionFromAccount(account) {
  if (account?.valueKind !== VALUE_KINDS.PROJECT && account?.valueKind !== VALUE_KINDS.ASSET) return null
  return {
    id: account.dimensionId || `dimension-account-${account.id}`,
    name: account.ownerName || account.subAccountName || account.legacyName || 'بدون اسم',
    type: account.type === 'project' ? DIMENSION_TYPES.PROJECT : DIMENSION_TYPES.ASSET,
    linkedAccountId: account.id,
    status: account.status === 'inactive' ? 'inactive' : 'active',
    createdAt: account.createdAt || nowIso(),
  }
}

export function dimensionsFromAccounts(accounts = [], dimensions = []) {
  const byId = new Map((Array.isArray(dimensions) ? dimensions : []).filter(Boolean).map((dimension) => [dimension.id, dimension]))
  for (const account of accounts) {
    if (account?.status === 'inactive') continue
    const dimension = dimensionFromAccount(account)
    if (!dimension || byId.has(dimension.id)) continue
    byId.set(dimension.id, dimension)
  }
  return Array.from(byId.values()).filter((dimension) => dimension?.status !== 'inactive')
}

export function buildExpenseCategoryReports(state = {}) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const movements = Array.isArray(state.movements) ? state.movements : []
  const categories = new Map(
    accounts
      .filter((account) => account?.valueKind === VALUE_KINDS.EXPENSE && account?.status !== 'inactive')
      .map((account) => [account.id, account]),
  )
  const totals = new Map()

  for (const movement of movements) {
    if (movement?.status !== MOVEMENT_STATUSES.POSTED) continue
    if (movement.type !== MOVEMENT_TYPES.EXPENSE && movement.type !== MOVEMENT_TYPES.TRUCK_EXPENSE) continue
    const categoryId = categories.has(movement.expenseCategoryId) ? movement.expenseCategoryId : ''
    const current = totals.get(categoryId) || { categoryId, dinar: 0, usd: 0, count: 0 }
    if (movement.currency === CURRENCIES.USD) current.usd += Math.abs(Number(movement.amount || 0))
    else current.dinar += Math.abs(Number(movement.amount || 0))
    current.count += 1
    totals.set(categoryId, current)
  }

  return Array.from(totals.values())
    .map((item) => ({
      ...item,
      name: item.categoryId ? categories.get(item.categoryId)?.ownerName || 'مصروف' : 'بدون تصنيف',
    }))
    .sort((left, right) => (right.dinar + right.usd) - (left.dinar + left.usd) || right.count - left.count)
}

export function buildDimensionReports(state = {}) {
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const movements = Array.isArray(state.movements) ? state.movements : []
  const dimensionsById = new Map(dimensionsFromAccounts(accounts, state.dimensions).map((dimension) => [dimension.id, dimension]))
  const historicDimensionIds = new Set(
    movements
      .filter((movement) => movement?.status === MOVEMENT_STATUSES.POSTED && movement.dimensionId)
      .map((movement) => movement.dimensionId),
  )
  const knownDimensions = new Map(
    (Array.isArray(state.dimensions) ? state.dimensions : [])
      .filter(Boolean)
      .map((dimension) => [dimension.id, dimension]),
  )
  for (const account of accounts) {
    const dimension = dimensionFromAccount(account)
    if (dimension && !knownDimensions.has(dimension.id)) knownDimensions.set(dimension.id, dimension)
  }
  for (const dimensionId of historicDimensionIds) {
    const dimension = knownDimensions.get(dimensionId)
    if (dimension && !dimensionsById.has(dimensionId)) dimensionsById.set(dimensionId, dimension)
  }
  const dimensions = Array.from(dimensionsById.values())
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
  if (cleanUrl) {
    try {
      const parsed = new URL(cleanUrl)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        errors.push({ field: 'url', message: 'رابط المرفق يجب أن يبدأ بـ https أو http.' })
      }
    } catch {
      errors.push({ field: 'url', message: 'رابط المرفق غير صالح.' })
    }
  }
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
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  }
}

export function attachmentsForRecord(attachments = [], { movementId = '', accountId = '' } = {}) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachment) => {
    if (attachment?.status === 'inactive') return false
    if (movementId && attachment.movementId === movementId) return true
    if (accountId && attachment.accountId === accountId) return true
    return false
  })
}

export function hideAttachment(attachment, hiddenAt = nowIso()) {
  if (!attachment || attachment.status === 'inactive') return attachment || null
  return {
    ...attachment,
    status: 'inactive',
    disabledAt: hiddenAt,
    updatedAt: hiddenAt,
  }
}

export function createReconciliation({ accountId, actualDinar, actualUsd, expectedDinar, expectedUsd, note = '' }) {
  const createdAt = nowIso()
  const roundedActualDinar = roundMoney(Number(actualDinar || 0))
  const roundedActualUsd = roundMoney(Number(actualUsd || 0))
  const roundedExpectedDinar = roundMoney(Number(expectedDinar || 0))
  const roundedExpectedUsd = roundMoney(Number(expectedUsd || 0))
  return {
    id: stableId('reconcile', `${accountId}-${createdAt}`),
    accountId,
    actualDinar: roundedActualDinar,
    actualUsd: roundedActualUsd,
    expectedDinar: roundedExpectedDinar,
    expectedUsd: roundedExpectedUsd,
    diffDinar: roundMoney(roundedActualDinar - roundedExpectedDinar),
    diffUsd: roundMoney(roundedActualUsd - roundedExpectedUsd),
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

export function findUnresolvedReconciliationDifferences(reconciliations = [], movements = []) {
  const postedCorrections = (Array.isArray(movements) ? movements : []).filter((movement) =>
    movement?.type === MOVEMENT_TYPES.CORRECTION && movement.status === MOVEMENT_STATUSES.POSTED,
  )

  return (Array.isArray(reconciliations) ? reconciliations : []).map((reconciliation) => {
    const corrected = postedCorrections
      .filter((movement) =>
        sameId(movement.reconciliationId, reconciliation.id) &&
        sameId(movement.destinationAccountId, reconciliation.accountId),
      )
      .reduce(
        (totals, movement) => {
          if (movement.currency === CURRENCIES.USD) {
            return { ...totals, usd: roundMoney(totals.usd + Number(movement.amount || 0)) }
          }
          return { ...totals, dinar: roundMoney(totals.dinar + Number(movement.amount || 0)) }
        },
        { dinar: 0, usd: 0 },
      )
    return {
      reconciliation,
      unresolvedDinar: roundMoney(Number(reconciliation.diffDinar || 0) - corrected.dinar),
      unresolvedUsd: roundMoney(Number(reconciliation.diffUsd || 0) - corrected.usd),
    }
  }).filter((item) => item.unresolvedDinar !== 0 || item.unresolvedUsd !== 0)
}

export function lastReconciliationForAccount(reconciliations = [], accountId) {
  return (Array.isArray(reconciliations) ? reconciliations : [])
    .filter((item) => item.accountId === accountId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null
}

export function recurringTemplateFromMovement(movement = {}) {
  return {
    type: movement.type,
    amount: movement.amount,
    currency: movement.currency,
    sourceAccountId: movement.sourceAccountId || null,
    destinationAccountId: movement.destinationAccountId || null,
    rate: movement.rate,
    note: movement.note,
    dimensionId: movement.dimensionId || '',
    expenseCategoryId: movement.expenseCategoryId || '',
  }
}

export function createRecurringRuleFromMovement(movement, { frequency = RECURRING_FREQUENCIES.MONTHLY, name = '', dayOfMonth } = {}) {
  if (!movement || movement.status !== MOVEMENT_STATUSES.POSTED) return null
  const createdAt = nowIso()
  return {
    id: stableId('recurring', `${movement.type}-${movement.sourceAccountId}-${movement.destinationAccountId}-${createdAt}`),
    name: String(name || `${movementLabels[movement.type] || 'حركة'} ${Math.round(Number(movement.amount || 0)).toLocaleString('en-US')}`).trim(),
    status: 'active',
    frequency,
    dayOfMonth: Math.min(31, Math.max(1, Math.round(Number(dayOfMonth || new Date(movement.createdAt || createdAt).getDate())))),
    executionMode: 'manual',
    sourceMovementId: movement.id,
    template: recurringTemplateFromMovement(movement),
    lastRunKey: '',
    createdAt,
    updatedAt: createdAt,
  }
}

export function dueRecurringRules(rules = [], date = new Date()) {
  const key = monthKey(date)
  const day = date.getDate()
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.status === 'active')
    .filter((rule) => rule.frequency === RECURRING_FREQUENCIES.MONTHLY)
    .filter((rule) => {
      const createdAt = new Date(rule.createdAt || 0)
      return Number.isNaN(createdAt.getTime()) || monthKey(createdAt) !== key
    })
    .filter((rule) => day >= Math.min(lastDayOfMonth, Math.min(31, Math.max(1, Number(rule.dayOfMonth || 1)))))
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
  if (reviewAccounts.length) alerts.push({ tone: 'warning', title: 'تصنيف', value: reviewAccounts.length })
  if (externalMissing.length) alerts.push({ tone: 'info', title: 'أسماء', value: externalMissing.length })
  if (negativeMoneyAccounts.length) alerts.push({ tone: 'danger', title: 'فلوس ناقصة', value: negativeMoneyAccounts.length })
  if (Math.round(Number(totals.iOwePeople || 0)) > 0) alerts.push({ tone: 'warning', title: 'أدفع', value: Math.round(Number(totals.iOwePeople || 0)), format: 'money' })
  if (dueRecurringCount) alerts.push({ tone: 'info', title: 'حركات متكررة', value: dueRecurringCount })
  if (reconciliationDiffCount) alerts.push({ tone: 'warning', title: 'فروق مطابقة', value: reconciliationDiffCount })
  if (largeMovementCount) alerts.push({ tone: 'warning', title: 'حركة كبيرة', value: largeMovementCount })
  if (duplicateMovementCount) alerts.push({ tone: 'info', title: 'تكرار محتمل', value: duplicateMovementCount })
  return alerts
}

export function runRecurringRule(rule, accounts = [], movementsOrDate = [], date = new Date()) {
  const movements = Array.isArray(movementsOrDate) ? movementsOrDate : []
  const runDate = Array.isArray(movementsOrDate) ? date : movementsOrDate
  const runKey = monthKey(runDate)
  const baseMovementId = `recurring-${rule.id}-${runKey}`
  const currentRun = movements.filter((movement) =>
    sameId(movement.recurringRuleId, rule.id) && movement.recurringRunKey === runKey,
  )
  const currentActiveAttempt = currentRun.find((movement) => movement.status !== MOVEMENT_STATUSES.VOIDED)
  let movementId = currentActiveAttempt?.id || baseMovementId
  let retry = 1
  while (!currentActiveAttempt && movements.some((movement) => sameId(movement.id, movementId))) {
    movementId = `${baseMovementId}-retry-${retry}`
    retry += 1
  }
  const movement = postMovement(
    {
      ...(rule?.template || {}),
      id: movementId,
      note: [rule?.template?.note, `تكرار ${runKey}`].filter(Boolean).join(' · '),
      recurringRuleId: rule.id,
      recurringRunKey: runKey,
    },
    accounts,
    movements,
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

export function syncRecurringRulesFromMovement(rules = [], movement, updatedAt = nowIso()) {
  if (
    !movement?.recurringRuleId ||
    !movement?.recurringRunKey ||
    movement.status !== MOVEMENT_STATUSES.POSTED
  ) return Array.isArray(rules) ? rules : []

  return (Array.isArray(rules) ? rules : []).map((rule) =>
    sameId(rule.id, movement.recurringRuleId)
      ? {
          ...rule,
          lastRunKey: movement.recurringRunKey,
          lastRunAt: movement.updatedAt || movement.createdAt || updatedAt,
          updatedAt,
        }
      : rule,
  )
}

export function syncRecurringRuleFromSourceMovement(rule, movement, updatedAt = nowIso()) {
  if (!rule) return null
  if (!movement || !sameId(rule.sourceMovementId, movement.id)) return rule
  if (movement.status === MOVEMENT_STATUSES.VOIDED) {
    return {
      ...rule,
      status: 'inactive',
      disabledAt: movement.voidedAt || movement.updatedAt || updatedAt,
      updatedAt,
    }
  }
  if (movement.status !== MOVEMENT_STATUSES.POSTED) return rule
  return {
    ...rule,
    template: recurringTemplateFromMovement(movement),
    updatedAt,
  }
}

export function syncRecurringRulesFromSourceMovement(rules = [], movement, updatedAt = nowIso()) {
  return (Array.isArray(rules) ? rules : []).map((rule) =>
    syncRecurringRuleFromSourceMovement(rule, movement, updatedAt),
  )
}

export function executeRecurringRuleInState(state = {}, ruleId, date = new Date()) {
  const rules = Array.isArray(state.recurringRules) ? state.recurringRules : []
  const rule = rules.find((item) => sameId(item.id, ruleId))
  if (!rule || rule.status !== 'active') {
    return { ok: false, state, message: 'الحركة الشهرية غير موجودة أو متوقفة.' }
  }

  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const movements = Array.isArray(state.movements) ? state.movements : []
  const runKey = monthKey(date)
  const currentRun = movements.filter((movement) =>
    sameId(movement.recurringRuleId, rule.id) && movement.recurringRunKey === runKey,
  )
  const dueRule = currentRun.length > 0 && currentRun.every((movement) => movement.status === MOVEMENT_STATUSES.VOIDED)
    ? { ...rule, lastRunKey: '' }
    : rule
  if (!dueRecurringRules([dueRule], date).length) {
    return { ok: false, state, message: 'هذه الحركة ليست مستحقة الآن.' }
  }

  const result = runRecurringRule(rule, accounts, movements, date)
  const existing = movements.find((movement) => sameId(movement.id, result.movement.id))
  const movement = existing || result.movement
  const nextRules = movement.status === MOVEMENT_STATUSES.POSTED
    ? syncRecurringRulesFromMovement(rules, movement)
    : rules.map((item) => (sameId(item.id, rule.id) ? result.rule : item))
  const duplicate = Boolean(existing)
  const message = duplicate
    ? movement.status === MOVEMENT_STATUSES.POSTED
      ? 'هذه الحركة منفذة لهذا الشهر بالفعل.'
      : 'هذه الحركة موجودة في المراجعة بالفعل.'
    : movement.status === MOVEMENT_STATUSES.POSTED
      ? 'تم تنفيذ الحركة الشهرية.'
      : 'تعذر اعتماد الحركة وحُفظت في المراجعة.'

  return {
    ok: !duplicate,
    duplicate,
    movement,
    state: {
      ...state,
      movements: duplicate ? movements : [...movements, movement],
      recurringRules: nextRules,
      auditEvents: duplicate
        ? (Array.isArray(state.auditEvents) ? state.auditEvents : [])
        : [
            ...(Array.isArray(state.auditEvents) ? state.auditEvents : []),
            createAuditEvent('recurring.executed', {
              ruleId: rule.id,
              movementId: movement.id,
              status: movement.status,
            }),
          ],
    },
    message,
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

export function updateRecurringRule(rule, updates = {}, updatedAt = nowIso()) {
  if (!rule) return null
  const dayOfMonth = updates.dayOfMonth === undefined
    ? rule.dayOfMonth || 1
    : Math.min(31, Math.max(1, Math.round(Number(updates.dayOfMonth || 1))))
  return {
    ...rule,
    name: updates.name === undefined ? rule.name : String(updates.name || rule.name || '').trim(),
    dayOfMonth,
    updatedAt,
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
