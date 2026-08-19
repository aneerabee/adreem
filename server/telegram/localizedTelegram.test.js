import { describe, expect, it, vi } from 'vitest'
import { createLocalizedTelegramClient } from './localizedTelegram.js'

function fakeClient() {
  return {
    getUpdates: vi.fn(),
    sendMessage: vi.fn(async (payload) => payload),
    editMessageText: vi.fn(async (payload) => payload),
    deleteMessage: vi.fn(),
    answerCallbackQuery: vi.fn(),
    getFile: vi.fn(),
    downloadFile: vi.fn(),
  }
}

describe('localized Telegram client', () => {
  it('translates system text and buttons for an English user', async () => {
    const client = fakeClient()
    const localized = createLocalizedTelegramClient(client, 'en')

    const payload = await localized.sendMessage({
      chat_id: 1,
      text: '<b>ADREEM · الأرصدة</b>\nاختر الحساب',
      reply_markup: { inline_keyboard: [[{ text: '↩️ الرئيسية', callback_data: 'main:home' }]] },
    })

    expect(payload.text).toBe('<b>ADREEM · Balances</b>\nChoose account')
    expect(payload.reply_markup.inline_keyboard[0][0].text).toBe('↩️ Home')
    expect(payload.reply_markup.inline_keyboard[0][0].callback_data).toBe('main:home')
  })

  it('keeps Arabic payloads unchanged for an Arabic user', async () => {
    const client = fakeClient()
    const localized = createLocalizedTelegramClient(client, 'ar')
    const payload = { chat_id: 1, text: 'اختر الحساب' }

    expect(await localized.sendMessage(payload)).toBe(payload)
  })

  it('does not translate an unknown user account name', async () => {
    const client = fakeClient()
    const localized = createLocalizedTelegramClient(client, 'en')

    const payload = await localized.sendMessage({ chat_id: 1, text: '<b>محمد الكيفو</b>' })

    expect(payload.text).toBe('<b>محمد الكيفو</b>')
  })
})
