import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { loadSeparateLedgerRecords, paginateSeparateLedgerRecords } from './separateLedgerView.js'

function record(id, sequence, overrides = {}) {
  return {
    id,
    sequence,
    type: MOVEMENT_TYPES.RECORD_ONLY,
    status: MOVEMENT_STATUSES.POSTED,
    amount: 100,
    currency: CURRENCIES.DINAR,
    relatedName: `حساب ${id}`,
    recordDirection: 'receivable',
    createdAt: `2026-08-22T00:00:${String(sequence).padStart(2, '0')}Z`,
    ...overrides,
  }
}

describe('Telegram separate ledger view', () => {
  it('projects edits and cancellations across raw database pages before paginating', async () => {
    const calls = []
    const repository = {
      loadMovements: async (options) => {
        calls.push(options)
        if (!options.beforeSequence) {
          return {
            movements: [
              record('void-2', 7, { supersedesSeparateRecordId: 'edit-2', separateRecordAction: 'void' }),
              record('edit-2', 6, { supersedesSeparateRecordId: 'old-2', amount: 260 }),
              record('edit-1', 5, { supersedesSeparateRecordId: 'old-1', amount: 180 }),
            ],
            page: { hasMore: true, nextCursor: 5 },
            revision: 9,
          }
        }
        return {
          movements: [record('old-2', 4), record('old-1', 3), record('current', 2)],
          page: { hasMore: false, nextCursor: 2 },
          revision: 9,
        }
      },
    }

    const records = await loadSeparateLedgerRecords(repository)

    expect(records.map((item) => item.id)).toEqual(['edit-1', 'current'])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      movementType: MOVEMENT_TYPES.RECORD_ONLY,
      status: MOVEMENT_STATUSES.POSTED,
      movementLimit: 250,
      includeTotal: false,
    })
    expect(calls[1].beforeSequence).toBe(5)
  })

  it('restarts when the ledger revision changes between pages', async () => {
    let call = 0
    const repository = {
      loadMovements: async () => {
        call += 1
        if (call === 1) return { movements: [record('stale', 5)], page: { hasMore: true, nextCursor: 5 }, revision: 1 }
        if (call === 2) return { movements: [record('old', 4)], page: { hasMore: false, nextCursor: 4 }, revision: 2 }
        return { movements: [record('fresh', 6)], page: { hasMore: false, nextCursor: 6 }, revision: 2 }
      },
    }

    await expect(loadSeparateLedgerRecords(repository)).resolves.toMatchObject([{ id: 'fresh' }])
    expect(call).toBe(3)
  })

  it('supports legacy repositories and bounds visible pages using active records only', async () => {
    const old = record('old', 1)
    const edited = record('edited', 2, { supersedesSeparateRecordId: 'old' })
    const repository = { load: async () => ({ state: { movements: [old, edited, record('second', 3)] } }) }

    const records = await loadSeparateLedgerRecords(repository)
    const page = paginateSeparateLedgerRecords(records, 9, 1)

    expect(records.map((item) => item.id)).toEqual(['second', 'edited'])
    expect(page).toMatchObject({ page: 1, pageCount: 2, total: 2 })
    expect(page.visibleRecords.map((item) => item.id)).toEqual(['edited'])
  })
})
