import { describe, expect, it, vi } from 'vitest'
import { TelegramClientError } from './telegramClient.js'
import {
  createIdempotentTelegramEffectClient,
  isPrivateTelegramUpdate,
  processTelegramUpdates,
  runCallbackActionWithBestEffortAck,
  shouldSkipOldUpdates,
  TelegramUpdateNotCompletedError,
} from './updateSafety.js'

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
    const handleUpdate = vi.fn(async () => ({ status: 'completed' }))

    await processTelegramUpdates(
      [{ update_id: 10 }, { update_id: 11 }],
      handleUpdate,
      (offset) => committed.push(offset),
    )

    expect(committed).toEqual([11, 12])
    expect(handleUpdate).toHaveBeenCalledTimes(2)
  })

  it.each([400, 403])('logs but does not advance past permanent Telegram %i errors without completion proof', async (status) => {
    const committed = []
    const onPermanentError = vi.fn()
    const permanentError = new TelegramClientError(`Telegram sendMessage failed: ${status}`, {
      method: 'sendMessage',
      status,
    })
    const handleUpdate = vi.fn(async (update) => {
      if (update.update_id === 10) throw permanentError
    })

    await expect(processTelegramUpdates(
      [{ update_id: 10 }, { update_id: 11 }],
      handleUpdate,
      (offset) => committed.push(offset),
      { onPermanentError },
    )).rejects.toBe(permanentError)

    expect(committed).toEqual([])
    expect(handleUpdate).toHaveBeenCalledTimes(1)
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
      return { status: 'completed' }
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

  it('requires durable completion proof before moving the offset', async () => {
    const committed = []

    await expect(processTelegramUpdates(
      [{ update_id: 15 }],
      async () => undefined,
      (offset) => committed.push(offset),
    )).rejects.toBeInstanceOf(TelegramUpdateNotCompletedError)

    expect(committed).toEqual([])
  })

  it('advances past a quarantined update only after receiving its durable terminal proof', async () => {
    const events = []
    const onQuarantined = vi.fn((result, update) => {
      events.push(`quarantined:${update.update_id}:${result.attempts}`)
    })

    await processTelegramUpdates(
      [{ update_id: 16 }, { update_id: 17 }],
      async (update) => {
        events.push(`handled:${update.update_id}`)
        return update.update_id === 16
          ? { status: 'quarantined', attempts: 3, failure: { code: 'ATTEMPTS_EXHAUSTED' } }
          : { status: 'completed' }
      },
      async (nextOffset) => {
        events.push(`offset:${nextOffset}`)
      },
      { onQuarantined },
    )

    expect(events).toEqual([
      'handled:16',
      'quarantined:16:3',
      'offset:17',
      'handled:17',
      'offset:18',
    ])
    expect(onQuarantined).toHaveBeenCalledTimes(1)
  })

  it('runs the callback action before acknowledging and ignores a permanent ack failure', async () => {
    const order = []
    const ackError = new TelegramClientError('Telegram answerCallbackQuery failed: 400', {
      method: 'answerCallbackQuery',
      status: 400,
    })
    const onAckError = vi.fn()

    await expect(runCallbackActionWithBestEffortAck(
      async () => {
        order.push('action')
        return 'saved'
      },
      async () => {
        order.push('ack')
        throw ackError
      },
      { onAckError },
    )).resolves.toBe('saved')

    expect(order).toEqual(['action', 'ack'])
    expect(onAckError).toHaveBeenCalledWith(ackError)
  })

  it('routes matching Telegram messages through one stable durable effect key', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 18 }))
    const runEffect = vi.fn(async (_effectId, handler) => handler())
    const client = createIdempotentTelegramEffectClient({ sendMessage }, runEffect)
    const payload = { text: 'saved', chat_id: 5 }

    await client.sendMessage(payload)
    await client.sendMessage({ chat_id: 5, text: 'saved' })

    expect(runEffect.mock.calls[0][0]).toBe(runEffect.mock.calls[1][0])
    expect(runEffect.mock.calls[0][2]).toEqual({ method: 'sendMessage' })
  })
})
