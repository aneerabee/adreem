import { loadAdreemMovementPage } from './ledgerPersistence'

export const COMPLETE_MOVEMENT_PAGE_SIZE = 250
const COMPLETE_MOVEMENT_PAGE_LIMIT = 1000

// Reads every page of one filter; a newer request with the same key ends the read quietly.
export async function loadEveryMovementPage(filter, requestKey, loadPage = loadAdreemMovementPage) {
  const movements = []
  const attachments = []
  const seenCursors = new Set()
  let before = null
  for (let pageIndex = 0; pageIndex < COMPLETE_MOVEMENT_PAGE_LIMIT; pageIndex += 1) {
    const result = await loadPage({ ...filter, before, limit: COMPLETE_MOVEMENT_PAGE_SIZE, requestKey })
    if (result.stale) return { stale: true }
    movements.push(...(result.movements || []))
    attachments.push(...(result.attachments || []))
    const nextCursor = result.page?.hasMore ? result.page.nextCursor : null
    if (!nextCursor) return { movements, attachments, page: { hasMore: false, nextCursor: null } }
    if (seenCursors.has(nextCursor)) throw new Error('repeated-statement-cursor')
    seenCursors.add(nextCursor)
    before = nextCursor
  }
  throw new Error('statement-page-limit')
}
