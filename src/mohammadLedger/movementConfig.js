import { CURRENCIES, MOVEMENT_TYPES } from './ledgerCore.js'

export const movementLabels = {
  [MOVEMENT_TYPES.OPENING_BALANCE]: 'رصيد افتتاحي',
  [MOVEMENT_TYPES.TRANSFER]: 'تحويل',
  [MOVEMENT_TYPES.CASH_DEPOSIT]: 'إيداع في المصرف',
  [MOVEMENT_TYPES.CASH_WITHDRAWAL]: 'سحب من المصرف',
  [MOVEMENT_TYPES.EXPENSE]: 'مصروف',
  [MOVEMENT_TYPES.TRUCK_EXPENSE]: 'مصروف شاحنة',
  [MOVEMENT_TYPES.TRUCK_INCOME]: 'دخل شاحنة',
  [MOVEMENT_TYPES.USD_SALE]: 'بعت دولار',
  [MOVEMENT_TYPES.USD_PURCHASE]: 'اشتريت دولار',
  [MOVEMENT_TYPES.EXTERNAL_INCOME]: 'دخل',
  [MOVEMENT_TYPES.CORRECTION]: 'تعديل رصيد',
}

export const movementTypeOptions = [
  {
    type: MOVEMENT_TYPES.TRANSFER,
    label: 'تحويل',
    detail: 'نقل فلوس بين حسابين متطابقين',
    tone: 'transfer',
  },
  {
    type: MOVEMENT_TYPES.EXPENSE,
    label: 'مصروف',
    detail: 'خروج فلوس من حساب واحد',
    tone: 'expense',
  },
  {
    type: MOVEMENT_TYPES.CASH_DEPOSIT,
    label: 'إيداع',
    detail: 'من الكاش إلى المصرف',
    tone: 'deposit',
  },
  {
    type: MOVEMENT_TYPES.CASH_WITHDRAWAL,
    label: 'سحب',
    detail: 'من المصرف إلى الكاش',
    tone: 'withdrawal',
  },
  {
    type: MOVEMENT_TYPES.EXTERNAL_INCOME,
    label: 'دخل',
    detail: 'فلوس تدخل من خارج الدفتر',
    tone: 'income',
  },
  {
    type: MOVEMENT_TYPES.USD_SALE,
    label: 'بعت دولار',
    detail: 'دولار يخرج ودينار يدخل',
    tone: 'sale',
  },
  {
    type: MOVEMENT_TYPES.USD_PURCHASE,
    label: 'اشتريت دولار',
    detail: 'دينار يخرج ودولار يدخل',
    tone: 'purchase',
  },
]

export const movementConfigs = {
  [MOVEMENT_TYPES.TRANSFER]: {
    amountLabel: 'المبلغ',
    currencyLocked: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'من',
    destinationLabel: 'إلى',
    sourceQuestion: 'من أين تخرج الفلوس؟',
    destinationQuestion: 'أين تدخل الفلوس؟',
    routeTitle: 'الأطراف',
  },
  [MOVEMENT_TYPES.EXPENSE]: {
    amountLabel: 'كم المصروف؟',
    currencyLocked: false,
    needsDestination: false,
    needsRate: false,
    sourceLabel: 'يخصم من',
    sourceQuestion: 'من أي حساب يخرج المصروف؟',
    routeTitle: 'الحساب',
  },
  [MOVEMENT_TYPES.CASH_DEPOSIT]: {
    amountLabel: 'كم ستودع؟',
    currencyLocked: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'الكاش',
    destinationLabel: 'المصرف',
    sourceQuestion: 'من أي كاش يخرج المبلغ؟',
    destinationQuestion: 'في أي حساب مصرفي يدخل؟',
    routeTitle: 'الإيداع',
  },
  [MOVEMENT_TYPES.CASH_WITHDRAWAL]: {
    amountLabel: 'كم ستسحب؟',
    currencyLocked: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'المصرف',
    destinationLabel: 'الكاش',
    sourceQuestion: 'من أي حساب مصرفي يخرج المبلغ؟',
    destinationQuestion: 'في أي كاش يدخل؟',
    routeTitle: 'السحب',
  },
  [MOVEMENT_TYPES.TRUCK_EXPENSE]: {
    amountLabel: 'كم مصروف الشاحنة؟',
    currencyLocked: false,
    needsDestination: false,
    needsRate: false,
    sourceLabel: 'يخصم من',
    sourceQuestion: 'من أي حساب خرج مصروف الشاحنة؟',
    routeTitle: 'الحساب',
  },
  [MOVEMENT_TYPES.TRUCK_INCOME]: {
    amountLabel: 'كم دخل الشاحنة؟',
    currencyLocked: false,
    needsSource: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'مصدر خارجي',
    destinationLabel: 'يدخل إلى',
    sourceQuestion: 'لا يحتاج مصدر داخل الدفتر.',
    destinationQuestion: 'أين دخلت الفلوس؟',
    routeTitle: 'الدخل',
  },
  [MOVEMENT_TYPES.USD_SALE]: {
    amountLabel: 'كم دولار بعت؟',
    currency: CURRENCIES.USD,
    currencyText: 'دولار',
    currencyLocked: true,
    needsDestination: true,
    needsRate: true,
    rateLabel: 'سعر بيع الدولار',
    sourceLabel: 'الدولار يخرج من',
    destinationLabel: 'الدينار يدخل إلى',
    sourceQuestion: 'من أين خرج الدولار؟',
    destinationQuestion: 'أين دخل الدينار؟',
    routeTitle: 'اتجاه البيع',
  },
  [MOVEMENT_TYPES.USD_PURCHASE]: {
    amountLabel: 'كم دينار دفعت؟',
    currency: CURRENCIES.DINAR,
    currencyText: 'دينار',
    currencyLocked: true,
    needsDestination: true,
    needsRate: true,
    rateLabel: 'سعر شراء الدولار',
    sourceLabel: 'الدينار يخرج من',
    destinationLabel: 'الدولار يدخل إلى',
    sourceQuestion: 'من أين خرج الدينار؟',
    destinationQuestion: 'أين دخل الدولار؟',
    routeTitle: 'اتجاه الشراء',
  },
  [MOVEMENT_TYPES.EXTERNAL_INCOME]: {
    amountLabel: 'كم الدخل؟',
    currencyLocked: false,
    needsSource: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'مصدر خارجي',
    destinationLabel: 'يدخل إلى',
    sourceQuestion: 'لا يحتاج مصدر داخل الدفتر.',
    destinationQuestion: 'أين دخلت الفلوس؟',
    routeTitle: 'الدخل',
  },
  [MOVEMENT_TYPES.CORRECTION]: {
    amountLabel: 'قيمة التصحيح',
    currencyLocked: false,
    needsSource: false,
    needsDestination: true,
    needsRate: false,
    sourceLabel: 'تصحيح',
    destinationLabel: 'الحساب',
    sourceQuestion: 'التصحيح لا يحتاج مصدرًا.',
    destinationQuestion: 'أي حساب تريد تصحيحه؟',
    routeTitle: 'التصحيح',
  },
}

export const movementDefaultAccounts = {
  [MOVEMENT_TYPES.TRANSFER]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.EXPENSE]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.CASH_DEPOSIT]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.CASH_WITHDRAWAL]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.TRUCK_EXPENSE]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.TRUCK_INCOME]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.USD_SALE]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.USD_PURCHASE]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.EXTERNAL_INCOME]: { sourceAccountId: '', destinationAccountId: '' },
  [MOVEMENT_TYPES.CORRECTION]: { sourceAccountId: '', destinationAccountId: '' },
}

export const MOVEMENT_ENTRY_STEPS = {
  TYPE: 1,
  AMOUNT: 2,
  CURRENCY: 3,
  RATE: 4,
  SOURCE: 5,
  DESTINATION: 6,
  NOTE: 7,
  REVIEW: 8,
}

export function movementConfigFor(type) {
  return movementConfigs[type] || movementConfigs[MOVEMENT_TYPES.TRANSFER]
}

export function movementDefaultsFor(type) {
  return movementDefaultAccounts[type] || movementDefaultAccounts[MOVEMENT_TYPES.TRANSFER]
}

export function movementPreferredAccountIds(type, role) {
  if (!type || !role) return []
  return []
}

export function movementNeedsDestination(type) {
  return movementConfigFor(type).needsDestination
}

export function movementNeedsSource(type) {
  return movementConfigFor(type).needsSource !== false
}

export function movementNeedsRate(type) {
  return movementConfigFor(type).needsRate
}

export function movementSupportsDimension(type) {
  return [
    MOVEMENT_TYPES.EXPENSE,
    MOVEMENT_TYPES.TRUCK_EXPENSE,
    MOVEMENT_TYPES.EXTERNAL_INCOME,
    MOVEMENT_TYPES.TRUCK_INCOME,
  ].includes(type)
}

export function movementSupportsExpenseCategory(type) {
  return type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE
}

export function movementCurrencyFor(type, fallback = CURRENCIES.DINAR) {
  return movementConfigFor(type).currency || fallback
}

export function movementAccountCurrencyForRole(type, role, fallback = CURRENCIES.DINAR) {
  if (type === MOVEMENT_TYPES.USD_SALE) return role === 'source' ? CURRENCIES.USD : CURRENCIES.DINAR
  if (type === MOVEMENT_TYPES.USD_PURCHASE) return role === 'source' ? CURRENCIES.DINAR : CURRENCIES.USD
  return movementCurrencyFor(type, fallback)
}

export function movementTone(type) {
  if (type === MOVEMENT_TYPES.EXPENSE || type === MOVEMENT_TYPES.TRUCK_EXPENSE) return 'expense'
  if (type === MOVEMENT_TYPES.EXTERNAL_INCOME || type === MOVEMENT_TYPES.TRUCK_INCOME) return 'income'
  if (type === MOVEMENT_TYPES.USD_SALE) return 'sale'
  if (type === MOVEMENT_TYPES.USD_PURCHASE) return 'purchase'
  if (type === MOVEMENT_TYPES.TRANSFER) return 'transfer'
  if (type === MOVEMENT_TYPES.CASH_DEPOSIT) return 'deposit'
  if (type === MOVEMENT_TYPES.CASH_WITHDRAWAL) return 'withdrawal'
  return 'neutral'
}
