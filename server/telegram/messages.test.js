import { describe, expect, it } from 'vitest'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/mohammadLedger/ledgerCore.js'
import { ACCOUNT_TYPES, VALUE_KINDS } from '../../src/mohammadLedger/accountCatalog.js'
import { localizeTelegramPayload, stripUiDataProtection } from '../../src/mohammadLedger/uiTranslation.js'
import {
  accountBlockquote,
  accountChoiceLegendText,
  accountChoiceButtonStyle,
  accountChoiceButtonText,
  accountEditHistoryText,
  accountReviewText,
  accountStepText,
  alertsText,
  formatAccountBalance,
  mainMenuText,
  movementBlockquote,
  movementStepText,
  reconciliationReviewText,
  reviewMovementText,
} from './messages.js'
import {
  accountConfirmKeyboard,
  currencyKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  mainMenuKeyboard,
  moreMenuKeyboard,
  movementTextStepKeyboard,
  movementTypeKeyboard,
} from './keyboards.js'

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
    expect(stripUiDataProtection(accountChoiceButtonText(receivable, bucket))).toBe('👤 سعيد · أقبض منه 12,500 د.ل')
    expect(accountChoiceButtonStyle(receivable, bucket)).toBe('success')
    expect(stripUiDataProtection(accountBlockquote(receivable, bucket))).toContain('🟢 سعيد\nكاش بيننا · دينار')
  })

  it('marks money I should pay in red terms', () => {
    const bucket = { dinar: -3200, usd: 0 }

    expect(formatAccountBalance(receivable, bucket)).toBe('أدفع له 3,200 د.ل')
    expect(stripUiDataProtection(accountChoiceButtonText(receivable, bucket))).toBe('👤 سعيد · أدفع له 3,200 د.ل')
    expect(accountChoiceButtonStyle(receivable, bucket)).toBe('danger')
    expect(stripUiDataProtection(accountBlockquote(receivable, bucket))).toContain('🔴 سعيد\nكاش بيننا · دينار')
  })

  it('uses the same visual direction for my own money accounts', () => {
    expect(formatAccountBalance(cash, { dinar: 9000, usd: 0 })).toBe('موجود 9,000 د.ل')
    expect(formatAccountBalance(cash, { dinar: -500, usd: 0 })).toBe('ناقص 500 د.ل')
  })

  it('shows the balance of the currency requested by the movement step', () => {
    const bucket = { dinar: 50_000, usd: 500 }

    expect(stripUiDataProtection(accountChoiceButtonText(cash, bucket, CURRENCIES.USD))).toContain('موجود 500 $')
    expect(stripUiDataProtection(accountChoiceButtonText(cash, bucket, CURRENCIES.USD))).not.toContain('50,000')
    expect(stripUiDataProtection(accountChoiceButtonText(cash, bucket, CURRENCIES.DINAR))).toContain('موجود 50,000 د.ل')
    expect(stripUiDataProtection(accountChoiceButtonText(cash, { dinar: 50_000, usd: 0 }, CURRENCIES.USD))).toContain('💵')
    expect(stripUiDataProtection(accountChoiceButtonText(cash, { dinar: 50_000, usd: 0 }, CURRENCIES.USD))).toContain('0 $')
  })

  it('shows account types once as a legend instead of repeating them in every choice', () => {
    const bank = { ownerName: 'أنا', subAccountName: 'الجمهورية', valueKind: VALUE_KINDS.BANK }
    const cheque = { ownerName: 'سعيد', subAccountName: 'شيك بيننا', valueKind: VALUE_KINDS.RECEIVABLE }

    expect(accountChoiceLegendText([cash, receivable, bank, cheque, cash])).toBe('💵 كاش · 👤 كاش بيننا · 🏦 مصرف · 🧾 شيك بيننا')
    expect(stripUiDataProtection(accountChoiceButtonText(receivable, { dinar: 100, usd: 0 }))).not.toContain('كاش بيننا')
  })

  it('protects colliding account names while translating account type and currency labels', () => {
    const person = {
      type: ACCOUNT_TYPES.PERSON,
      valueKind: VALUE_KINDS.RECEIVABLE,
      ownerName: 'دخل',
      subAccountName: 'كاش',
      currencyKind: CURRENCIES.DINAR,
    }
    const ownCash = {
      type: ACCOUNT_TYPES.CASH,
      valueKind: VALUE_KINDS.CASH,
      ownerName: 'أنا',
      subAccountName: 'مالك',
      currencyKind: CURRENCIES.DINAR,
    }
    const localized = localizeTelegramPayload({
      text: [
        accountBlockquote(person, { dinar: 100 }),
        accountBlockquote(ownCash, { dinar: 200 }),
      ].join('\n'),
    }, 'en')

    expect(localized.text).toContain('🟢 دخل\nCash between us · Dinar')
    expect(localized.text).toContain('🟢 مالك\nCash · Dinar')
    expect(localized.text).not.toContain('🟢 Income')
  })

  it('shows account name history as clear before and after values', () => {
    const text = stripUiDataProtection(accountEditHistoryText('person-1', [{
      id: 'audit-1',
      action: 'account.updated',
      createdAt: '2026-08-20T10:00:00.000Z',
      details: {
        accountId: 'person-1',
        before: { ...receivable, ownerName: 'سعيد', type: ACCOUNT_TYPES.PERSON, currencyKind: CURRENCIES.DINAR },
        after: { ...receivable, ownerName: 'شركة سعيد', type: ACCOUNT_TYPES.PERSON, currencyKind: CURRENCIES.DINAR },
      },
    }]))

    expect(text).toContain('سجل التعديلات · 1')
    expect(text).toContain('الاسم')
    expect(text).toContain('قبل: سعيد')
    expect(text).toContain('بعد: شركة سعيد')
  })

  it('localizes the complete account editing card without translating entered names', () => {
    const history = accountEditHistoryText('person-1', [{
      id: 'audit-1',
      action: 'account.updated',
      createdAt: '2026-08-20T10:00:00.000Z',
      details: {
        accountId: 'person-1',
        before: { ...receivable, ownerName: 'سعيد', type: ACCOUNT_TYPES.PERSON, currencyKind: CURRENCIES.DINAR },
        after: { ...receivable, ownerName: 'شركة سعيد', type: ACCOUNT_TYPES.PERSON, currencyKind: CURRENCIES.DINAR },
      },
    }])
    const localized = localizeTelegramPayload({
      text: `${accountStepText({
        mode: 'edit',
        step: 'owner',
        presetGroup: 'people',
        reviewOriginalLabel: 'سعيد · كاش بيننا · دينار',
        draft: { ...receivable, type: ACCOUNT_TYPES.PERSON, currencyKind: CURRENCIES.DINAR },
      })}\n${history}`,
      reply_markup: accountConfirmKeyboard('edit'),
    }, 'en')
    const visible = stripUiDataProtection(localized.text)

    expect(visible).toContain('ADREEM · Edit account')
    expect(visible).toContain('Edit history · 1')
    expect(visible).toContain('Before: سعيد')
    expect(visible).toContain('After: شركة سعيد')
    expect(localized.reply_markup.inline_keyboard.flat().map((button) => button.text)).toContain('Save account changes')
  })
})

describe('telegram movement presentation', () => {
  it('uses ADREEM as the bot ledger name', () => {
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).toContain('<b>ADREEM</b>')
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).not.toContain('إضافة · الأرصدة · السجل · المراجعة')
    expect(mainMenuText({ todayCount: 2, reviewCount: 1 })).toContain('اليوم: 2 حركة')
  })

  it('aligns the main bot menu with the web work areas', () => {
    const labels = mainMenuKeyboard().inline_keyboard.flat().map((button) => button.text)

    expect(labels).toEqual([
      '➕ حركة جديدة',
      'الأرصدة',
      'السجل',
      'المراجعة',
      'المزيد',
    ])

    expect(moreMenuKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
      '➕ حساب جديد',
      'تنبيهات',
      'مطابقة رصيد',
      'التقارير',
      'الحركات الشهرية',
      'حركات اليوم',
      'بحث عن حساب',
      '↩️ الرئيسية',
    ])
  })

  it('renders smart alerts as compact cards', () => {
    const text = alertsText([
      { tone: 'danger', title: 'حركات ناقصة', value: 2 },
      { tone: 'warning', title: 'أدفع', value: 12500, format: 'money' },
    ])

    expect(text).toContain('<b>ADREEM · تنبيهات</b>')
    expect(text).toContain('<code>2 تنبيه</code>')
    expect(text).toContain('🔴 حركات ناقصة')
    expect(text).toContain('🟠 أدفع')
    expect(text).toContain('12,500 د.ل')
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
      mode: 'create',
      step: 'owner',
      draft: {
        type: 'person',
        valueKind: VALUE_KINDS.RECEIVABLE,
      },
    })

    expect(movementText).toContain('<code>4/9</code>')
    expect(movementText).not.toContain('●')
    expect(movementText).not.toContain('الخطوة الحالية')
    expect(accountText).toContain('<code>2/6</code>')
    expect(accountText).not.toContain('○')
    expect(accountText).not.toContain('الخطوة الحالية')
  })

  it('asks each account question once without repeating instructions', () => {
    const groupText = accountStepText({
      mode: 'create',
      step: 'group',
      draft: {},
    })
    const currencyText = accountStepText({
      mode: 'create',
      step: 'currency',
      presetGroup: 'money',
      draft: {
        ownerName: 'أنا',
        subAccountName: 'الخزنة',
        type: ACCOUNT_TYPES.CASH,
        valueKind: VALUE_KINDS.CASH,
      },
    })
    const reviewText = accountReviewText({
      mode: 'create',
      step: 'review',
      presetGroup: 'money',
      draft: {
        ownerName: 'أنا',
        subAccountName: 'الخزنة',
        type: ACCOUNT_TYPES.CASH,
        valueKind: VALUE_KINDS.CASH,
        currencyKind: CURRENCIES.DINAR,
      },
    })

    expect(groupText.match(/ماذا تريد أن تضيف؟/g)).toHaveLength(1)
    expect(groupText).not.toContain('اختر قسمًا واحدًا')
    expect(currencyText.match(/اختر العملة/g)).toHaveLength(1)
    expect(currencyText).not.toContain('دينار أو دولار')
    expect(reviewText).not.toContain('راجع قبل الحفظ')

    const reconciliationText = reconciliationReviewText({
      draft: { currency: CURRENCIES.DINAR, actualBalance: 100, note: 'عد يدوي' },
    }, {
      account: cash,
      expected: 90,
    })
    expect(reconciliationText).not.toContain('راجع قبل الحفظ')
  })

  it('localizes the opening balance steps without changing the entered account name', () => {
    const session = {
      mode: 'create',
      step: 'direction',
      presetGroup: 'people',
      openingBuffer: '1250',
      draft: {
        ownerName: 'مو إدريس',
        subAccountName: 'شيك بيننا',
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        currencyKind: CURRENCIES.USD,
        openingBalanceAmount: '1250',
        openingBalanceDirection: 'i_owe',
      },
    }
    const localized = localizeTelegramPayload({
      text: `${accountStepText(session)}\n${accountReviewText({ ...session, step: 'review' })}`,
    }, 'en')
    const visible = stripUiDataProtection(localized.text)

    expect(visible).toContain('Who owes this balance?')
    expect(visible).toContain('Opening balance: I owe them 1,250 $')
    expect(visible).toContain('مو إدريس')
  })

  it('keeps account and movement review summaries in their correct flows', () => {
    const accountText = accountStepText({
      mode: 'review',
      step: 'owner',
      presetGroup: 'people',
      draft: { type: ACCOUNT_TYPES.PERSON, valueKind: VALUE_KINDS.RECEIVABLE },
    })
    const movementText = movementStepText({
      mode: 'review',
      step: 'amount',
      draft: { type: MOVEMENT_TYPES.EXPENSE, amount: 0, currency: CURRENCIES.DINAR },
    })

    expect(accountText).not.toContain('الحركة')
    expect(accountText).not.toContain('person')
    expect(movementText).toContain('<b>الحركة:</b> مصروف')
  })

  it('keeps movement choices in compact visual rows', () => {
    expect(movementTypeKeyboard().inline_keyboard.map((row) => row.length)).toEqual([2, 1, 2, 2, 1])
    expect(movementTextStepKeyboard().inline_keyboard.flat().map((button) => button.callback_data)).toEqual(['mv:back', 'mv:cancel'])
  })

  it('marks the current choice clearly when the user goes back', () => {
    const selectedType = movementTypeKeyboard(MOVEMENT_TYPES.EXPENSE).inline_keyboard.flat()
      .find((button) => button.callback_data === `mv:type:${MOVEMENT_TYPES.EXPENSE}`)
    const selectedCurrency = currencyKeyboard(CURRENCIES.DINAR).inline_keyboard.flat()
      .find((button) => button.callback_data === `mv:currency:${CURRENCIES.DINAR}`)
    const selectedDimension = dimensionKeyboard([{ id: 'truck', name: 'شاحنة العمل' }], { selectedId: 'truck' }).inline_keyboard[0][0]
    const selectedCategory = expenseCategoryKeyboard([{ id: 'fuel', ownerName: 'وقود' }], { selectedId: 'fuel' }).inline_keyboard[0][0]

    for (const button of [selectedType, selectedCurrency, selectedDimension, selectedCategory]) {
      expect(button.text).toContain('✓')
      expect(button.style).toBe('success')
    }
  })

  it('renders each movement as a clear standalone card', () => {
    const accounts = new Map([
      ['me-cash', { ownerName: 'أنا', subAccountName: 'كاش' }],
      ['saeed-cash', { ownerName: 'سعيد', subAccountName: 'كاش' }],
    ])
    const card = stripUiDataProtection(movementBlockquote({
      type: MOVEMENT_TYPES.TRANSFER,
      amount: 1250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      createdAt: '2026-05-13T10:15:00.000Z',
      note: 'تجربة <مهمة>',
    }, accounts))

    expect(card).toContain('<blockquote>')
    expect(card).toContain('🔁 تحويل · 1,250 د.ل · مسودة')
    expect(card).toContain('كاش عندي · كاش · دينار ← سعيد · كاش بيننا · دينار')
    expect(card).toContain('ملاحظة: تجربة &lt;مهمة&gt;')
  })

  it('shows approved, canceled, and incomplete status on every movement card', () => {
    for (const [status, label] of [
      [MOVEMENT_STATUSES.POSTED, 'معتمدة'],
      [MOVEMENT_STATUSES.VOIDED, 'ملغاة'],
      [MOVEMENT_STATUSES.NEEDS_REVIEW, 'ناقصة'],
    ]) {
      expect(movementBlockquote({
        type: MOVEMENT_TYPES.EXPENSE,
        status,
        amount: 10,
        currency: CURRENCIES.DINAR,
      })).toContain(`· ${label}`)
    }
  })

  it('keeps history cards concise without dates or normal status', () => {
    const accounts = new Map([
      ['me-cash', { ownerName: 'أنا', subAccountName: 'كاش' }],
      ['saeed-cash', { ownerName: 'سعيد', subAccountName: 'كاش' }],
    ])
    const card = stripUiDataProtection(movementBlockquote({
      type: MOVEMENT_TYPES.TRANSFER,
      status: MOVEMENT_STATUSES.POSTED,
      amount: 1250,
      currency: CURRENCIES.DINAR,
      sourceAccountId: 'me-cash',
      destinationAccountId: 'saeed-cash',
      createdAt: '2026-05-13T10:15:00.000Z',
      note: 'دفعة أولى',
    }, accounts, { number: 3, showTime: false, variant: 'history' }))

    expect(card).toContain('#3 · 🔁 تحويل · 1,250 د.ل')
    expect(card).toContain('📝 دفعة أولى')
    expect(card).not.toContain('الوقت:')
    expect(card).not.toContain('معتمدة')
  })

  it('keeps exceptional status visible in concise history cards', () => {
    const card = movementBlockquote({
      type: MOVEMENT_TYPES.EXPENSE,
      status: MOVEMENT_STATUSES.VOIDED,
      amount: 10,
      currency: CURRENCIES.DINAR,
    }, new Map(), { number: 4, showTime: false, variant: 'history' })

    expect(card).toContain('#4 · 🔴 مصروف · 10 د.ل · ملغاة')
  })

  it('renders movement dates in the shared Tripoli timezone', () => {
    const createdAt = '2026-08-20T22:30:00.000Z'
    const expectedTime = new Date(createdAt).toLocaleTimeString('ar-LY', {
      timeZone: 'Africa/Tripoli',
      hour: '2-digit',
      minute: '2-digit',
    })
    const expectedDay = new Date(createdAt).toLocaleDateString('ar-LY', {
      timeZone: 'Africa/Tripoli',
      month: '2-digit',
      day: '2-digit',
    })

    const card = movementBlockquote({
      type: MOVEMENT_TYPES.EXPENSE,
      amount: 10,
      currency: CURRENCIES.DINAR,
      createdAt,
    }, new Map(), { includeDate: true })

    expect(card).toContain(`الوقت: ${expectedDay} · ${expectedTime}`)
  })

  it('renders review effects as before, change, after', () => {
    const text = stripUiDataProtection(reviewMovementText(
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
    ))

    expect(text).toContain('<b>تأكيد الحركة</b>')
    expect(text).toContain('🔴 من: كاش عندي · كاش · دينار')
    expect(text).toContain('قبل: 2,000 د.ل')
    expect(text).toContain('التغيير: -500 د.ل')
    expect(text).toContain('بعد: 1,500 د.ل')
    expect(text).toContain('🟢 إلى: سعيد · كاش بيننا · دينار')
    expect(text).toContain('التغيير: +500 د.ل')
    expect(text).toContain('بعد: 600 د.ل')
  })

  it('shows the selected project and expense type in the final review', () => {
    const text = stripUiDataProtection(reviewMovementText(
      {
        draft: {
          type: MOVEMENT_TYPES.EXPENSE,
          amount: 500,
          currency: CURRENCIES.DINAR,
          sourceAccountId: 'me-cash',
          dimensionId: 'truck',
          expenseCategoryId: 'fuel',
        },
      },
      {
        validation: { ok: true },
        effects: [{
          account: { id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' },
          before: 2_000,
          delta: -500,
          after: 1_500,
          currency: CURRENCIES.DINAR,
        }],
      },
      {
        accountsById: new Map([['me-cash', { id: 'me-cash', ownerName: 'أنا', subAccountName: 'كاش' }]]),
        dimensionsById: new Map([['truck', { id: 'truck', name: 'شاحنة العمل' }]]),
        expenseCategoriesById: new Map([['fuel', { id: 'fuel', ownerName: 'وقود' }]]),
      },
    ))

    expect(text).toContain('<b>مشروع:</b> شاحنة العمل')
    expect(text).toContain('<b>نوع المصروف:</b> وقود')
  })
})
