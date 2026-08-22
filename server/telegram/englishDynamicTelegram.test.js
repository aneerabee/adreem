import { describe, expect, it } from 'vitest'
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, VALUE_KINDS } from '../../src/ledger/accountCatalog.js'
import { CURRENCIES, MOVEMENT_STATUSES, MOVEMENT_TYPES } from '../../src/ledger/ledgerCore.js'
import { movementLabels } from '../../src/ledger/movementConfig.js'
import { formatMoney } from '../ledger/ledgerService.js'
import {
  accountBlockquote,
  alertsText,
  escapeHtml,
  mainMenuText,
  movementBlockquote,
  movementStepText,
  protectedAccountLabel,
  reconciliationReviewText,
  reconciliationStepText,
  reviewMovementText,
} from './messages.js'
import {
  accountChoicesKeyboard,
  accountCurrencyKeyboard,
  accountDetailKeyboard,
  accountGroupKeyboard,
  accountsBrowserKeyboard,
  accountTypeKeyboard,
  confirmKeyboard,
  currencyKeyboard,
  dimensionKeyboard,
  expenseCategoryKeyboard,
  historyKeyboard,
  mainMenuKeyboard,
  movementTypeKeyboard,
  netTargetKeyboard,
  reconciliationAccountKeyboard,
  reconciliationConfirmKeyboard,
  reconciliationCurrencyKeyboard,
  recurringRulesKeyboard,
  reportDetailKeyboard,
  reportKeyboard,
  reportListKeyboard,
  reviewKeyboard,
  separateLedgerKeyboard,
  separateVoidConfirmKeyboard,
} from './keyboards.js'
import { localizeTelegramPayload, preserveUiData } from '../../src/ledger/uiTranslation.js'

const ALLOWED_ARABIC_USER_NAME = 'أحمد التجريبي'
const COLLIDING_PROJECT_NAME = 'دخل'
const COLLIDING_EXPENSE_NAME = 'مالك'
const COLLIDING_NOTE = 'مصروف'
const USER_DATA_VALUES = [ALLOWED_ARABIC_USER_NAME, COLLIDING_PROJECT_NAME, COLLIDING_EXPENSE_NAME, COLLIDING_NOTE]
const ARABIC_TEXT = /\p{Script=Arabic}/u

const cashAccount = {
  id: 'cash-main',
  ownerName: 'Me',
  subAccountName: 'Main vault',
  type: ACCOUNT_TYPES.CASH,
  valueKind: VALUE_KINDS.CASH,
  currencyKind: CURRENCIES.DINAR,
  status: ACCOUNT_STATUSES.ACTIVE,
}

const personAccount = {
  id: 'person-arabic',
  ownerName: ALLOWED_ARABIC_USER_NAME,
  subAccountName: 'كاش بيننا',
  type: ACCOUNT_TYPES.PERSON,
  valueKind: VALUE_KINDS.RECEIVABLE,
  currencyKind: CURRENCIES.DINAR,
  status: ACCOUNT_STATUSES.ACTIVE,
}

const cashBucket = { account: cashAccount, dinar: 12_500, usd: 0 }
const personBucket = { account: personAccount, dinar: 3_200, usd: 0 }
const balancesByAccountId = new Map([
  [cashAccount.id, cashBucket],
  [personAccount.id, personBucket],
])
const accountsById = new Map([
  [cashAccount.id, cashAccount],
  [personAccount.id, personAccount],
])

const movement = {
  id: 'movement-1',
  type: MOVEMENT_TYPES.TRANSFER,
  amount: 1_250,
  currency: CURRENCIES.DINAR,
  sourceAccountId: cashAccount.id,
  destinationAccountId: personAccount.id,
  note: 'Fuel delivery',
  status: MOVEMENT_STATUSES.POSTED,
  createdAt: '2026-08-19T10:15:00.000Z',
}

const movementSession = {
  step: 'review',
  draft: {
    ...movement,
    currencyConfirmed: true,
    attachmentLabel: 'receipt.pdf',
    recurringEnabled: true,
  },
}

const movementPreview = {
  validation: { ok: true, errors: [] },
  effects: [
    { account: cashAccount, before: 2_000, delta: -1_250, after: 750, currency: CURRENCIES.DINAR },
    { account: personAccount, before: 100, delta: 1_250, after: 1_350, currency: CURRENCIES.DINAR },
  ],
}

function combineKeyboards(...keyboards) {
  return {
    inline_keyboard: keyboards.flatMap((keyboard) => keyboard.inline_keyboard || []),
  }
}

function visiblePayloadText(payload) {
  const buttons = payload.reply_markup?.inline_keyboard
    ?.flat()
    .map((button) => button.text)
    .filter(Boolean) || []
  return [payload.text, payload.caption, ...buttons].filter(Boolean).join('\n')
}

function remainingArabicLines(payload) {
  const visible = USER_DATA_VALUES.reduce((text, value) => text.replaceAll(value, ''), visiblePayloadText(payload))
  return [...new Set(visible.split('\n').map((line) => line.trim()).filter((line) => ARABIC_TEXT.test(line)))]
}

function userDataOccurrences(payload, value) {
  return visiblePayloadText(payload).split(value).length - 1
}

function protectedUserDataOccurrences(payload, value) {
  return visiblePayloadText(payload).split(`\u2068${value}\u2069`).length - 1
}

const routeCases = [
  {
    name: 'balances and account browsing',
    payload: {
      text: [
        '<b>ADREEM · الأرصدة</b>',
        '<code>2 حساب · صفحة 1/2</code>',
        '',
        `<blockquote>${escapeHtml(`فلوسي: ${formatMoney(cashBucket.dinar)}\nأقبض: ${formatMoney(personBucket.dinar)}\nأدفع: ${formatMoney(500)}`)}</blockquote>`,
        '',
        accountBlockquote(personAccount, personBucket),
      ].join('\n'),
      reply_markup: accountsBrowserKeyboard([cashBucket, personBucket], { page: 0, pageCount: 2 }),
    },
  },
  {
    name: 'net calculator and separate account controls',
    payload: {
      text: [
        '<b>ADREEM · الصافي</b>',
        '<blockquote>دينار: 10,000 د.ل\nدولار: 250 $\n\nالصافي: 11,875 د.ل\nالسعر: 7.5</blockquote>',
        '<b>الحسابات الداخلة · 2</b>',
        '<code>صفحة 1/2</code>',
        '<blockquote>لا توجد حسابات داخلة.</blockquote>',
      ].join('\n'),
      reply_markup: netTargetKeyboard(CURRENCIES.DINAR, { showAccounts: true, page: 0, pageCount: 2 }),
    },
  },
  {
    name: 'movement entry, review, and account choices',
    payload: {
      text: [
        movementStepText(movementSession, accountsById),
        reviewMovementText(movementSession, movementPreview),
        movementBlockquote(movement, accountsById, { includeDate: true }),
      ].join('\n\n'),
      reply_markup: combineKeyboards(
        movementTypeKeyboard(),
        currencyKeyboard(CURRENCIES.DINAR),
        accountChoicesKeyboard([cashAccount, personAccount], 'source', balancesByAccountId),
        confirmKeyboard(),
      ),
    },
  },
  {
    name: 'reconciliation steps, review, and choices',
    payload: {
      text: [
        reconciliationStepText({
          step: 'actual',
          draft: { accountId: cashAccount.id, currency: CURRENCIES.DINAR, actualBalance: 12_000, note: 'Counted cash' },
        }, accountsById, balancesByAccountId),
        reconciliationReviewText({
          draft: { accountId: cashAccount.id, currency: CURRENCIES.DINAR, actualBalance: 12_000, note: 'Counted cash' },
        }, { account: cashAccount, expected: cashBucket.dinar }),
      ].join('\n\n'),
      reply_markup: combineKeyboards(
        reconciliationAccountKeyboard([cashAccount, personAccount], balancesByAccountId),
        reconciliationCurrencyKeyboard(CURRENCIES.DINAR),
        reconciliationConfirmKeyboard(),
      ),
    },
  },
  {
    name: 'search prompts and dynamic results',
    payload: {
      text: [
        '<b>ADREEM · بحث</b>',
        '<blockquote>اكتب اسم شخص، جهة، كاش، أو مصرف.</blockquote>',
        `<b>بحث:</b> ${preserveUiData(ALLOWED_ARABIC_USER_NAME)}`,
        '<b>2 اختيارات مناسبة.</b> اضغط الاسم المطلوب.',
        '<b>2 حسابات مناسبة.</b> اختر الحساب.',
        '<b>ADREEM · نتائج البحث</b>\n<code>2 نتيجة</code>\n<b>اختر الحساب</b>',
      ].join('\n'),
      reply_markup: accountsBrowserKeyboard([personBucket], { page: 0, pageCount: 1 }),
    },
  },
  {
    name: 'history cards, counters, pages, and actions',
    payload: {
      text: [
        '<b>ADREEM · الحركات</b>',
        '<code>10 حركة · صفحة 2/3</code>',
        movementBlockquote(movement, accountsById, { includeDate: true }),
      ].join('\n\n'),
      reply_markup: historyKeyboard({
        actionSessionId: 'history-card',
        page: 1,
        pageCount: 3,
        choices: { movements: { movement: movement.id } },
      }),
    },
  },
  {
    name: 'review items, counters, pages, and actions',
    payload: {
      text: [
        '<b>ADREEM · مراجعة</b>',
        '<code>2 عنصر · صفحة 1/2</code>',
        `<blockquote>#1 · حساب · ${escapeHtml(protectedAccountLabel(personAccount))}</blockquote>`,
        `<blockquote>#2 · حركة · ${movementLabels[movement.type]} · ${formatMoney(movement.amount, movement.currency)}</blockquote>`,
      ].join('\n'),
      reply_markup: reviewKeyboard({
        actionSessionId: 'review-card',
        page: 0,
        pageCount: 2,
        pageSize: 8,
        items: [
          { kind: 'account', token: 'account', number: 1 },
          { kind: 'movement', token: 'movement', number: 2 },
        ],
      }),
    },
  },
  {
    name: 'project and expense reports with counters, pages, and statuses',
    payload: {
      text: [
        '<b>ADREEM · التقارير</b>',
        '<blockquote>اختر القائمة التي تريد فتحها.</blockquote>',
        '<code>2 مشروع أو أصل · 3 نوع مصروف</code>',
        '<b>ADREEM · المشاريع والأصول</b>',
        '<code>2 عنصر · صفحة 1/2</code>',
        `<blockquote>${preserveUiData(COLLIDING_PROJECT_NAME)}\n${escapeHtml(`دخل ${formatMoney(5_000)} · مصروف ${formatMoney(1_250)} · صافي ${formatMoney(3_750)} · 4 حركة معتمدة`)}\n${escapeHtml(`دولار: دخل ${formatMoney(500, CURRENCIES.USD)} · مصروف ${formatMoney(100, CURRENCIES.USD)} · صافي ${formatMoney(400, CURRENCIES.USD)} · 4 حركة معتمدة`)}</blockquote>`,
        '<b>ADREEM · أنواع المصروف</b>',
        '<code>3 نوع مصروف · صفحة 1/2</code>',
        `<blockquote>${preserveUiData(COLLIDING_EXPENSE_NAME)}\n${formatMoney(1_250)} · 3 حركة معتمدة</blockquote>`,
        '<code>3 حركة مرتبطة · صفحة 1/2</code>',
        '<b>#1 · الحالة: معتمدة</b>',
      ].join('\n'),
      reply_markup: combineKeyboards(
        reportKeyboard({ projects: 2, expenses: 3 }),
        reportListKeyboard({ kind: 'project', page: 0, pageCount: 2, items: [{ number: 1, token: 'project' }] }),
        reportDetailKeyboard({ kind: 'project', page: 0, pageCount: 2, listPage: 0 }),
      ),
    },
  },
  {
    name: 'recurring rules and user data that collide with system labels',
    payload: {
      text: [
        '<b>ADREEM · الحركات الشهرية</b>',
        '<code>2 فعالة · 1 مستحقة · صفحة 1/2</code>',
        `<blockquote>#1 · ${preserveUiData(COLLIDING_PROJECT_NAME)}\n${formatMoney(1_200)} · يوم 1\nمستحقة الآن</blockquote>`,
        movementBlockquote({ ...movement, note: COLLIDING_NOTE }, accountsById),
      ].join('\n'),
      reply_markup: combineKeyboards(
        recurringRulesKeyboard({
          actionSessionId: 'recurring-collision',
          page: 0,
          pageCount: 2,
          items: [{ id: 'due-rule', number: 1, token: 'due' }],
          dueRuleIds: ['due-rule'],
        }),
        dimensionKeyboard([{ id: 'project', name: COLLIDING_PROJECT_NAME }]),
        expenseCategoryKeyboard([{ id: 'expense', ownerName: COLLIDING_EXPENSE_NAME }]),
      ),
    },
  },
  {
    name: 'summary counters and alerts',
    payload: {
      text: [
        mainMenuText({ todayCount: 12, reviewCount: 3 }),
        alertsText([
          { tone: 'danger', title: 'حركات ناقصة', value: 3 },
          { tone: 'warning', title: 'أدفع', value: 1_250, format: 'money' },
        ]),
      ].join('\n\n'),
      reply_markup: mainMenuKeyboard(),
    },
  },
  {
    name: 'separate accounts, actions, and cancellation confirmation',
    payload: {
      text: [
        '<b>ADREEM · منفصل</b>',
        '<code>1 حساب · صفحة 1/1</code>',
        `<blockquote>#1 · 🟢 ${preserveUiData(ALLOWED_ARABIC_USER_NAME)}\nلي · ${formatMoney(850)}\n${preserveUiData(COLLIDING_NOTE)}</blockquote>`,
        '<b>إلغاء الحساب المنفصل؟</b>',
        '<blockquote>لن تتأثر الأرصدة الرئيسية.</blockquote>',
      ].join('\n'),
      reply_markup: combineKeyboards(
        separateLedgerKeyboard({
          balanceFilter: 'separate',
          page: 0,
          pageCount: 1,
          items: [{ number: 1, token: 'side' }],
        }),
        separateVoidConfirmKeyboard({ page: 0 }, 'side'),
      ),
    },
  },
  {
    name: 'currencies and dynamic action buttons',
    payload: {
      text: `<b>العملة</b>\n${formatMoney(1_250, CURRENCIES.DINAR)}\n${formatMoney(500, CURRENCIES.USD)}`,
      reply_markup: combineKeyboards(
        accountGroupKeyboard('money'),
        accountTypeKeyboard('asset', 'tracking'),
        accountDetailKeyboard('كاش بيننا', ['كاش بيننا', 'شيك بيننا']),
        accountCurrencyKeyboard(CURRENCIES.DINAR),
        recurringRulesKeyboard({
          actionSessionId: 'recurring-card',
          choices: { rules: { due: 'due-rule', later: 'later-rule' } },
          dueRuleIds: ['due-rule'],
        }),
      ),
    },
  },
]

describe('English dynamic Telegram localization', () => {
  it.each(routeCases)('$name leaves no Arabic system text', ({ payload }) => {
    const localized = localizeTelegramPayload(payload, 'en')
    for (const value of USER_DATA_VALUES) {
      expect(userDataOccurrences(localized, value)).toBe(protectedUserDataOccurrences(payload, value))
    }
    expect(remainingArabicLines(localized)).toEqual([])
  })

  it('preserves the one explicitly allowed Arabic user name unchanged', () => {
    const payload = {
      text: `<b>${ALLOWED_ARABIC_USER_NAME}</b>`,
      reply_markup: {
        inline_keyboard: [[{ text: ALLOWED_ARABIC_USER_NAME, callback_data: 'account:user' }]],
      },
    }

    expect(localizeTelegramPayload(payload, 'en')).toEqual(payload)
  })

  it('localizes the review wizard title without leaking Arabic system text', () => {
    const payload = {
      text: movementStepText({ ...movementSession, mode: 'review' }, accountsById),
    }

    expect(remainingArabicLines(localizeTelegramPayload(payload, 'en'))).toEqual([])
  })
})
