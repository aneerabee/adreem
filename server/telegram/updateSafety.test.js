import { describe, expect, it, vi } from 'vitest'
import { TelegramClientError } from './telegramClient.js'
import { isPrivateTelegramUpdate, processTelegramUpdates, shouldSkipOldUpdates } from './updateSafety.js'

describe('telegram update safety', () => {
  it('keeps startup updates unless skipping is explicitly enabled', () => {
    expect(shouldSkipOldUpdates({})).toBe(false)
    expect(shouldSkipOldUpdates({ TELEGRAM_SKIP_OLD_UPDATES: 'false' })).toBe(false)
    expect(shouldSkipOldUpdates({ TELEGRAM_SKIP_OLD_UPDATES: 'true' })).toBe(true)
  })

  it('accepts only private message and callback chats', () => {
    expect(isPrivateTelegramUpdate({ message: { chat: { id: 1, type: 'private' } } })).toBe(true)
    expect(isPrivateTelegramUpdate({ callback_query: { message: { chat: { id: 1, type: 'private' } } } })).toBe(true)
    expect(isPrivateTelegramUpdate({ message: { chat: { id: -1, type: 'group' } } })).toBe(false)
    expect(isPrivateTelegramUpdate({ callback_query: { message: { chat: { id: -2, type: 'supergroup' } } } })).toBe(false)
  })

  it('commits every offset after successful updates', async () => {
    const committed = []
    const handleUpdate = vi.fn()

    await processTelegramUpdates(
      [{ update_id: 10 }, { update_id: 11 }],
      handleUpdate,
      (offset) => committed.push(offset),
    )

    expect(committed).toEqual([11, 12])
    expect(handleUpdate).toHaveBeenCalledTimes(2)
  })

  it.each([400, 403])('logs and advances past permanent Telegram %i errors', async (status) => {
    const committed = []
    const onPermanentError = vi.fn()
    const permanentError = new TelegramClientError(`Telegram sendMessage failed: ${status}`, {
      method: 'sendMessage',
      status,
    })
    const handleUpdate = vi.fn(async (update) => {
      if (update.update_id === 10) throw permanentError
    })

    await processTelegramUpdates(
      [{ update_id: 10 }, { update_id: 11 }],
      handleUpdate,
      (offset) => committed.push(offset),
      { onPermanentError },
    )

    expect(committed).toEqual([11, 12])
    expect(handleUpdate).toHaveBeenCalledTimes(2)
    expect(onPermanentError).toHaveBeenCalledWith(permanentError, { update_id: 10 })
  })

  it('does not advance past a temporary Telegram error', async () => {
    const committed = []
    const temporaryError = new TelegramClientError('Telegram sendMessage failed: 500', {
      method: 'sendMessage',
      status: 500,
    })
    const handleUpdate = vi.fn(async (update) => {
      if (update.update_id === 11) throw temporaryError
    })

    await expect(processTelegramUpdates(
      [{ update_id: 10 }, { update_id: 11 }, { update_id: 12 }],
      handleUpdate,
      (offset) => committed.push(offset),
    )).rejects.toBe(temporaryError)

    expect(committed).toEqual([11])
    expect(handleUpdate).toHaveBeenCalledTimes(2)
  })

  it('does not advance past an application error', async () => {
    const committed = []
    const applicationError = new Error('failed update')

    await expect(processTelegramUpdates(
      [{ update_id: 10 }],
      async () => { throw applicationError },
      (offset) => committed.push(offset),
    )).rejects.toBe(applicationError)

    expect(committed).toEqual([])
  })
})
