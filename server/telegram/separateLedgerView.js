import { MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/ledger/ledgerCore.js'
import { filterSeparateRecords } from '../../src/ledger/separateRecords.js'

const SEPARATE_RECORD_LOAD_LIMIT = 250
const MAX_SEPARATE_RECORD_PAGES = 100
const MAX_SNAPSHOT_ATTEMPTS = 3

function revisionValue(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

async function loadRelationalSeparateRecords(repository) {
  for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const movements = []
    const seenCursors = new Set()
    let beforeSequence = null
    let snapshotRevision = null
    let snapshotChanged = false

    for (let pageIndex = 0; pageIndex < MAX_SEPARATE_RECORD_PAGES; pageIndex += 1) {
      const result = await repository.loadMovements({
        movementType: MOVEMENT_TYPES.RECORD_ONLY,
        status: MOVEMENT_STATUSES.POSTED,
        movementLimit: SEPARATE_RECORD_LOAD_LIMIT,
        beforeSequence: beforeSequence || undefined,
        includeTotal: false,
      })
      const resultRevision = revisionValue(result.revision)
      if (snapshotRevision === null) snapshotRevision = resultRevision
      else if (resultRevision !== null && resultRevision !== snapshotRevision) {
        snapshotChanged = true
        break
      }

      movements.push(...(result.movements || []))
      if (!result.page?.hasMore) return filterSeparateRecords(movements)

      const nextCursor = Number(result.page?.nextCursor)
      if (!Number.isSafeInteger(nextCursor) || nextCursor <= 0 || seenCursors.has(nextCursor)) {
        throw new Error('تعذر إكمال قراءة الحسابات المنفصلة.')
      }
      seenCursors.add(nextCursor)
      beforeSequence = nextCursor
    }

    if (!snapshotChanged) throw new Error('عدد الحسابات المنفصلة أكبر من الحد الآمن للعرض.')
  }
  throw new Error('تغير الدفتر أثناء قراءة الحسابات المنفصلة. أعد المحاولة.')
}

export async function loadSeparateLedgerRecords(repository) {
  if (typeof repository.loadMovements === 'function') {
    return loadRelationalSeparateRecords(repository)
  }
  const { state } = await repository.load()
  return filterSeparateRecords(state.movements || [])
}

export function paginateSeparateLedgerRecords(records = [], requestedPage = 0, pageSize = 8) {
  const safePageSize = Math.max(1, Number(pageSize) || 1)
  const pageCount = Math.max(1, Math.ceil(records.length / safePageSize))
  const page = Math.min(Math.max(0, Number(requestedPage) || 0), pageCount - 1)
  return {
    page,
    pageCount,
    total: records.length,
    visibleRecords: records.slice(page * safePageSize, (page + 1) * safePageSize),
  }
}
