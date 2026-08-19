import { describe, expect, it } from 'vitest'
import { localizeTelegramPayload, setActiveUiLanguage, translateUiText } from './uiTranslation.js'

describe('ADREEM UI translation', () => {
  it('uses clear English for core entry and account actions', () => {
    setActiveUiLanguage('en')

    expect(translateUiText('إضافة حركة')).toBe('Add entry')
    expect(translateUiText('اختر من أين تخرج الفلوس.')).toBe('Choose where the money comes from.')
    expect(translateUiText('تأكيد وحفظ الحركة')).toBe('Confirm and save entry')
    expect(translateUiText('الأرصدة')).toBe('Balances')
  })

  it('translates formatted Telegram text without changing its markup', () => {
    expect(translateUiText('<b>ADREEM · مراجعة</b>\n<blockquote>لا شيء معلق.</blockquote>', 'en'))
      .toBe('<b>ADREEM · Review</b>\n<blockquote>Nothing is pending.</blockquote>')
  })

  it('preserves user-entered names and notes', () => {
    expect(translateUiText('محمد الكيفو', 'en')).toBe('محمد الكيفو')
    expect(translateUiText('فاتورة الوقود لشاحنة سعيد', 'en')).toBe('فاتورة الوقود لشاحنة سعيد')
  })

  it('keeps callback data unchanged while translating button labels', () => {
    const payload = localizeTelegramPayload({
      text: 'اختر الحساب',
      reply_markup: {
        inline_keyboard: [[{ text: '↩️ رجوع', callback_data: 'mv:back:123' }]],
      },
    }, 'en')

    expect(payload.text).toBe('Choose account')
    expect(payload.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '↩️ Back',
      callback_data: 'mv:back:123',
    })
  })
})
