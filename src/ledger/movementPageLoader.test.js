import { describe, expect, it, vi } from 'vitest'
import { COMPLETE_MOVEMENT_PAGE_SIZE, loadEveryMovementPage } from './movementPageLoader.js'

const page = (ids, nextCursor = null) => ({ movements: ids.map((id) => ({ id })), attachments: [], page: { hasMore: Boolean(nextCursor), nextCursor } })

describe('movement page loader', () => {
  it('follows the pages to the end with the same filter', async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce(page(['c', 'b'], 20))
      .mockResolvedValueOnce(page(['a']))
    const result = await loadEveryMovementPage({ expenseCategoryId: 'food' }, 'profile', loadPage)
    expect(result.movements.map((movement) => movement.id)).toEqual(['c', 'b', 'a'])
    expect(result.page).toEqual({ hasMore: false, nextCursor: null })
    expect(loadPage).toHaveBeenNthCalledWith(1, { expenseCategoryId: 'food', before: null, limit: COMPLETE_MOVEMENT_PAGE_SIZE, requestKey: 'profile' })
    expect(loadPage).toHaveBeenNthCalledWith(2, { expenseCategoryId: 'food', before: 20, limit: COMPLETE_MOVEMENT_PAGE_SIZE, requestKey: 'profile' })
  })

  it('stops quietly when a newer request replaced this one', async () => {
    const loadPage = vi.fn().mockResolvedValue({ ...page(['a'], 9), stale: true })
    await expect(loadEveryMovementPage({ accountId: 'cash' }, 'profile', loadPage)).resolves.toEqual({ stale: true })
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('refuses a cursor that repeats instead of looping forever', async () => {
    const loadPage = vi.fn().mockResolvedValue(page(['a'], 7))
    await expect(loadEveryMovementPage({ accountId: 'cash' }, 'profile', loadPage)).rejects.toThrow('repeated-statement-cursor')
    expect(loadPage).toHaveBeenCalledTimes(2)
  })
})
