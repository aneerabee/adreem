import { ArrowDownToLine, ArrowUpFromLine, Banknote, CircleDollarSign, Landmark, SlidersHorizontal } from 'lucide-react'
import { COUNTERPARTY_ACCOUNT_KINDS } from './accountConfig'
import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore'

export const CANCEL_WINDOW_HOURS = 24
export const CANCEL_WINDOW_MS = CANCEL_WINDOW_HOURS * 60 * 60 * 1000
export const USD_MAXIMUM_FRACTION_DIGITS = 6
export const REVIEW_MOVEMENT_PAGE_SIZE = 50
export const SEPARATE_RECORD_PAGE_SIZE = 250
export const MAX_SEPARATE_RECORD_PAGES = 100
export const TEMPORARY_NET_RESET_MS = 5 * 60 * 1000
export const UI_MOTION_TRANSITION = Object.freeze({ duration: 0.2, ease: [0.22, 1, 0.36, 1] })
export const FLOW_STAGE_MOTION = Object.freeze({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: UI_MOTION_TRANSITION,
})
export const BALANCE_PANE_MOTION = Object.freeze({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.12, ease: 'easeOut' },
})
export const COUNTERPARTY_BALANCE_FILTERS = Object.freeze([
  { key: 'all', label: 'الكل', icon: SlidersHorizontal },
  { key: 'receivable', label: 'أقبض', icon: ArrowDownToLine },
  { key: 'payable', label: 'أدفع', icon: ArrowUpFromLine },
  { key: COUNTERPARTY_ACCOUNT_KINDS.CASH_DINAR, label: 'كاش', icon: Banknote },
  { key: COUNTERPARTY_ACCOUNT_KINDS.CHEQUE_DINAR, label: 'شيك', icon: Landmark },
  { key: COUNTERPARTY_ACCOUNT_KINDS.CASH_USD, label: 'USD', icon: CircleDollarSign },
  { key: COUNTERPARTY_ACCOUNT_KINDS.CASH_TRY, label: 'TRY', icon: CircleDollarSign },
  { key: COUNTERPARTY_ACCOUNT_KINDS.CASH_EUR, label: 'EUR', icon: CircleDollarSign },
])
export const CURRENCY_OPTIONS = Object.freeze([
  { value: CURRENCIES.DINAR, label: 'LYD', field: 'dinar' },
  { value: CURRENCIES.USD, label: 'USD', field: 'usd' },
  { value: CURRENCIES.TRY, label: 'TRY', field: 'try' },
  { value: CURRENCIES.EUR, label: 'EUR', field: 'eur' },
])

export function currencyField(currency) {
  return CURRENCY_OPTIONS.find((option) => option.value === currency)?.field || 'dinar'
}
export const EXPENSE_CATEGORY_TONES = Object.freeze(['coral', 'blue', 'green', 'amber', 'plum', 'teal'])
export const BALANCE_FOCUS_LABELS = Object.freeze({
  cash: 'الكاش',
  bank: 'المصرف',
  receivable: 'أقبض من الناس',
  payable: 'أدفع للناس',
  credit_card: 'بطاقاتي',
})
export const MOVEMENT_REQUEST_KEYS = Object.freeze({
  accountProfile: 'account-profile',
  expenses: 'expenses',
  history: 'history',
  ledgerFeed: 'ledger-feed',
  review: 'review',
  separate: 'separate',
  todaySummary: 'today-summary',
})

export const accountGroupTabs = [
  { key: 'money', label: 'فلوسي', title: 'فلوسي' },
  { key: 'cards', label: 'بطاقاتي', title: 'بطاقاتي' },
  { key: 'people', label: 'الناس', title: 'الناس' },
  { key: 'assets', label: 'تتبّع', title: 'التتبّع' },
  { key: 'expenses', label: 'مصروفات', title: 'المصروفات' },
  { key: 'separate', label: 'منفصل', title: 'السجل المنفصل' },
]

export const ACCOUNT_WIZARD_STEPS = {
  GROUP: 'group',
  PRESET: 'preset',
  NAME: 'name',
  DETAIL: 'detail',
  CURRENCY: 'currency',
  OPENING: 'opening',
  SAVE: 'save',
}

export const sectionTitles = {
  entry: 'إضافة',
  accounts: 'الأرصدة',
  investments: 'محفظتي',
  history: 'السجل',
  review: 'المراجعة',
}
export const sectionOrder = Object.keys(sectionTitles)

export const movementOptionGroups = [
  {
    key: 'daily',
    title: 'اليومي',
    hint: 'الأكثر استعمالًا',
    types: [MOVEMENT_TYPES.TRANSFER, MOVEMENT_TYPES.EXPENSE, MOVEMENT_TYPES.EXTERNAL_INCOME, MOVEMENT_TYPES.INVESTMENT_DEPOSIT],
  },
  {
    key: 'banking',
    title: 'المصرف',
    hint: 'إيداع أو سحب',
    types: [MOVEMENT_TYPES.CASH_DEPOSIT, MOVEMENT_TYPES.CASH_WITHDRAWAL],
  },
  {
    key: 'cards',
    title: 'بطاقات الائتمان',
    hint: 'دفع وسداد',
    types: [MOVEMENT_TYPES.CARD_CHARGE, MOVEMENT_TYPES.CARD_PAYMENT],
  },
  {
    key: 'exchange',
    title: 'USD',
    hint: 'بيع أو شراء',
    types: [MOVEMENT_TYPES.USD_SALE, MOVEMENT_TYPES.USD_PURCHASE],
  },
  {
    key: 'investment',
    title: 'محفظتي',
    hint: 'سحب USD',
    types: [MOVEMENT_TYPES.INVESTMENT_WITHDRAWAL],
  },
  {
    key: 'record',
    title: 'متابعة',
    hint: 'دون تغيير الرصيد',
    types: [MOVEMENT_TYPES.RECORD_ONLY],
  },
]

export const MOVEMENT_EDITABLE_FIELDS = Object.freeze([
  'amount',
  'rate',
  'sourceAccountId',
  'destinationAccountId',
  'investmentPlatformId',
  'note',
  'dimensionId',
  'expenseCategoryId',
])
