import { describe, expect, it } from 'vitest'
import {
  canCancelTransfer,
  canPermanentlyDeleteTransfer,
  cancelTransferSafely,
  getTransferDeletionSafety,
  summarizeDeletionImpact,
} from './deletionSafety'

const baseTransfer = {
  id: 1,
  customerId: 10,
  reference: 'WU-1',
  status: 'received',
  transferAmount: 500,
  systemAmount: null,
  customerAmount: 490,
  margin: null,
  settled: false,
  settledAt: null,
  sentAt: null,
  pickedUpAt: null,
  issueAt: null,
  deletedAt: null,
}

function tx(overrides = {}) {
  return { ...baseTransfer, ...overrides }
}

describe('deletion safety', () => {
  it('allows cancelling incomplete received and issue transfers', () => {
    expect(canCancelTransfer(tx({ status: 'received' }))).toBe(true)
    expect(canCancelTransfer(tx({ status: 'issue', sentAt: '2026-05-01T10:00:00.000Z' }))).toBe(true)
  })

  it('blocks transfers that affect financial ledger state', () => {
    expect(getTransferDeletionSafety(tx({ status: 'picked_up' })).ok).toBe(false)
    expect(getTransferDeletionSafety(tx({ settled: true })).ok).toBe(false)
    expect(getTransferDeletionSafety(tx({ pickedUpAt: '2026-05-01T10:00:00.000Z' })).ok).toBe(false)
    expect(getTransferDeletionSafety(tx({ settledAt: '2026-05-01T10:00:00.000Z' })).ok).toBe(false)
  })

  it('blocks transfers referenced by persisted ledger entries', () => {
    const safety = getTransferDeletionSafety(tx(), [{ id: 'manual-1', transferId: 1, deletedAt: null }])
    expect(safety.ok).toBe(false)
    expect(safety.reasons.join(' ')).toContain('قيد')
  })

  it('requires prior cancellation before permanent delete', () => {
    expect(canPermanentlyDeleteTransfer(tx())).toBe(false)
    expect(canPermanentlyDeleteTransfer(tx({ deletedAt: '2026-05-01T10:00:00.000Z' }))).toBe(true)
  })

  it('adds cancellation metadata without dropping original transfer fields', () => {
    const cancelled = cancelTransferSafely(tx({ note: 'مهم' }), 'خطأ إدخال', '2026-05-01T10:00:00.000Z')
    expect(cancelled.deletedAt).toBe('2026-05-01T10:00:00.000Z')
    expect(cancelled.cancelledAt).toBe('2026-05-01T10:00:00.000Z')
    expect(cancelled.cancelReason).toBe('خطأ إدخال')
    expect(cancelled.note).toBe('مهم')
    expect(cancelled.reference).toBe('WU-1')
  })

  it('reports that cancelling non-picked transfers does not change picked-up financial totals', () => {
    const picked = tx({
      id: 2,
      status: 'picked_up',
      systemAmount: 1000,
      customerAmount: 990,
      margin: 10,
      pickedUpAt: '2026-05-01T11:00:00.000Z',
    })
    const impact = summarizeDeletionImpact([tx({ id: 1 }), picked], [1])
    expect(impact.activeBefore).toBe(2)
    expect(impact.activeAfter).toBe(1)
    expect(impact.financialChanged).toBe(false)
    expect(impact.financialBefore).toEqual(impact.financialAfter)
  })
})
