const CANCELABLE_STATUSES = new Set(['received', 'issue', 'with_employee', 'review_hold'])

function hasPersistedLedgerReference(transfer, ledgerEntries = []) {
  if (!transfer) return false
  const transferId = String(transfer.id)
  return (ledgerEntries || []).some((entry) => !entry?.deletedAt && String(entry?.transferId ?? '') === transferId)
}

function roundMoney(value) {
  return Math.round(Number(value) || 0)
}

export function getTransferDeletionSafety(transfer, ledgerEntries = [], { requireDeleted = false } = {}) {
  const reasons = []
  if (!transfer) reasons.push('الحوالة غير موجودة.')
  if (transfer && requireDeleted && !transfer.deletedAt) reasons.push('يجب إلغاء الحوالة أولا قبل الحذف النهائي.')
  if (transfer?.settled) reasons.push('الحوالة مسوّاة.')
  if (transfer?.status === 'picked_up') reasons.push('الحوالة مسحوبة.')
  if (transfer?.pickedUpAt) reasons.push('لديها تاريخ سحب.')
  if (transfer?.settledAt) reasons.push('لديها تاريخ تسوية.')
  if (transfer && !CANCELABLE_STATUSES.has(transfer.status)) reasons.push('حالة الحوالة لا تسمح بالإلغاء.')
  if (hasPersistedLedgerReference(transfer, ledgerEntries)) reasons.push('مرتبطة بقيد محاسبي محفوظ.')

  return {
    ok: reasons.length === 0,
    reasons,
    status: transfer?.status || '',
    hasAmounts: Boolean(
      typeof transfer?.transferAmount === 'number'
      || typeof transfer?.customerAmount === 'number'
      || typeof transfer?.systemAmount === 'number'
      || typeof transfer?.margin === 'number',
    ),
    hasHistory: Array.isArray(transfer?.history) && transfer.history.length > 0,
    wasSentToEmployee: Boolean(transfer?.sentAt),
  }
}

export function canCancelTransfer(transfer, ledgerEntries = []) {
  return getTransferDeletionSafety(transfer, ledgerEntries).ok
}

export function canPermanentlyDeleteTransfer(transfer, ledgerEntries = []) {
  return getTransferDeletionSafety(transfer, ledgerEntries, { requireDeleted: true }).ok
}

export function cancelTransferSafely(transfer, reason = '', now = new Date().toISOString()) {
  return {
    ...transfer,
    deletedAt: transfer.deletedAt || now,
    cancelledAt: transfer.cancelledAt || now,
    cancelReason: String(reason || '').trim(),
    cancellationMode: transfer.status === 'issue' ? 'issue-cancelled' : 'not-completed-cancelled',
    updatedAt: now,
  }
}

export function summarizeDeletionImpact(transfers = [], transferIds = []) {
  const idSet = new Set(transferIds.map((id) => String(id)))
  const active = transfers.filter((t) => !t?.deletedAt)
  const after = active.filter((t) => !idSet.has(String(t.id)))

  const countByStatus = (rows) => rows.reduce((acc, t) => {
    const status = t.status || 'unknown'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})

  const pickedSummary = (rows) => {
    const picked = rows.filter((t) => t.status === 'picked_up')
    return {
      pickedUp: picked.length,
      settled: picked.filter((t) => t.settled).length,
      unsettledPickedUp: picked.filter((t) => !t.settled).length,
      totalSystem: roundMoney(picked.reduce((sum, t) => sum + (Number(t.systemAmount) || 0), 0)),
      totalCustomer: roundMoney(picked.reduce((sum, t) => sum + (Number(t.customerAmount) || 0), 0)),
      totalMargin: roundMoney(picked.reduce((sum, t) => sum + (Number(t.margin) || 0), 0)),
    }
  }

  const beforeFinancial = pickedSummary(active)
  const afterFinancial = pickedSummary(after)
  const selected = active.filter((t) => idSet.has(String(t.id)))

  return {
    selectedCount: selected.length,
    activeBefore: active.length,
    activeAfter: after.length,
    statusBefore: countByStatus(active),
    statusAfter: countByStatus(after),
    statusRemoved: countByStatus(selected),
    financialBefore: beforeFinancial,
    financialAfter: afterFinancial,
    financialChanged: JSON.stringify(beforeFinancial) !== JSON.stringify(afterFinancial),
  }
}
