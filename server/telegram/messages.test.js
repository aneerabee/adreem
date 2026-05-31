import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import {
  accountBlockquote,
  accountChoiceButtonStyle,
  accountChoiceButtonText,
  accountStepText,
  formatAccountBalance,
  mainMenuText,
  movementBlockquote,
  movementStepText,
  reviewMovementText,
} from './messages.js'
import { mainMenuKeyboard } from './keyboards.js'

const receivable = {
  ownerName: 'سعيد',
  subAccountName: 'كاش',
  valueKind: VALUE_KINDS.RECEIVABLE,
}

const cash = {
  ownerName: 'أنا',
  subAccountName: 'كاش',
  valueKind: VALUE_KINDS.CASH,
}

describe('telegram account balance presentation', () => {
  it('marks money I should collect in green terms', () => {
    const bucket = { dinar: 12500, usd: 0 }

    expect(formatAccountBalance(receivable, bucket)).toBe('أقبض منه 12,500 د.ل')
    expect(accountChoiceButtonText(receivable, bucket)).toBe('🟢 سعيد · كاش · دينار | أقبض منه 12,500 د.ل')
    expect(accountChoiceButtonStyle(receivable, bucket)).toBe('success')
    expect(accountBlockquote(receivable, bucket)).toContain('🟢 سعيد · كاش')
  })

  it('marks money I should pay in red terms', () => {
    const bucket = { dinar: -3200, usd: 0 }

    expect(formatAccountBalance(receivable, bucket)).toBe('أدفع له 3,200 د.ل')
    expect(accountChoiceButtonText(receivable, bucket)).toBe('🔴 سعيد · كاش · دينار | أدفع له 3,200 د.ل')
    expect(accountChoiceButtonStyle(receivable, bucket)).toBe('danger')
    expect(accountBlockquote(receivable, bucket)).toContain('🔴 سعيد · كاش')
  })

  it('uses the same visual direction for my own money accounts', () => {
    expect(formatAccountBalance(cash, { dinar: 9000, usd: 0 })).toBe('موجود 9,000 د.ل')
    expect(formatAccountBalance(cash, { dinar: -500, usd: 0 })).toBe('ناقص 500 د.ل')
  })
})

describe('telegram movement presentation', () => {
  it('uses ADREEM as the bot ledger name', () => {
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).toContain('<b>ADREEM</b>')
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).toContain('Ledger OS · Telegram')
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).toContain('سجل اليوم: 2 حركة')
  })

  it('aligns the main bot menu with the web work areas', () => {
    const labels = mainMenuKeyboard().inline_keyboard.flat().map((button) => button.text)

    expect(labels).toEqual([
      '+ إدخال حركة',
      '+ حساب جديد',
      '= الأرصدة',
      'سجل اليوم',
      '≡ السجل',
      '! مراجعة',
      'بحث عن حساب',
    ])
  })

  it('uses a compact step counter instead of visual dot noise', () => {
    const movementText = movementStepText({
      step: 'source',
      draft: {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 1250,
        currency: CURRENCIES.DINAR,
        currencyConfirmed: true,
      },
    })
    const accountText = accountStepText({
      step: 'owner',
      draft: {
        type: 'person',
        valueKind: VALUE_KINDS.RECEIVABLE,
      },
    })

    expect(movementText).toContain('<code>4/7</code>')
    expect(movementText).not.toContain('●')
    expect(accountText).toContain('<code>2/5</code>')
    expect(accountText).not.toContain('○')
  })

  it('renders each movement as a clear standalone card', () => {
    const accounts = new Map([
      ['me-cash', { ownerName: 'أنا', subAccountName: 'كاش' }],
      ['saeed-cash', { ownerName: 'سعيد', subAccountName: 'كاش' }],
    ])
    const card = movementBlockquote({
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 1250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      createdAt: '2026-05-13T10:15:00.000Z',
      note: 'تجربة <مهمة>',
    }, accounts)

    expect(card).toContain('<blockquote>')
    expect(card).toContain('🔁 تحويل · 1,250 د.ل')
    expect(card).toContain('كاش: كاش ← سعيد · كاش')
    expect(card).toContain('ملاحظة: تجربة &lt;مهمة&gt;')
  })

  it('renders review effects as before, change, after', () => {
    const text = reviewMovementText(
      {
        draft: {
          type: MOVEMENT_TYPES.TRANSFER,
          amount: 500,
          currency: CURRENCIES.DINAR,
          sourceAccountId: 'me-cash',
          destinationAccountId: 'saeed-cash',
        },
      },
      {
        validation: { ok: true },
        effects: [
          {
            account: { id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' },
            before: 2000,
            delta: -500,
            after: 1500,
            currency: CURRENCIES.DINAR,
          },
          {
            account: { id: 'saeed-cash', ownerName: 'سعيد', subAccountName: 'كاش' },
            before: 100,
            delta: 500,
            after: 600,
            currency: CURRENCIES.DINAR,
          },
        ],
      },
    )

    expect(text).toContain('<b>تأكيد الحركة</b>')
    expect(text).toContain('🔴 من: كاش: كاش')
    expect(text).toContain('قبل: 2,000 د.ل')
    expect(text).toContain('التغيير: -500 د.ل')
    expect(text).toContain('بعد: 1,500 د.ل')
    expect(text).toContain('🟢 إلى: سعيد · كاش')
    expect(text).toContain('التغيير: +500 د.ل')
    expect(text).toContain('بعد: 600 د.ل')
  })
})
