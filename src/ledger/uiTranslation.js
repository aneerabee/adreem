import { DEFAULT_UI_LANGUAGE, normalizeUiLanguage, UI_LANGUAGES } from './uiLanguage.js'
import { ENGLISH_TEXT } from './uiTranslationDictionary.js'

export const ADREEM_UI_LANGUAGE_STORAGE_KEY = 'adreem-ui-language-v1'

let activeUiLanguage = DEFAULT_UI_LANGUAGE
const USER_DATA_START = '\u2068'
const USER_DATA_END = '\u2069'

export function preserveUiData(value) {
  const text = String(value ?? '').replace(/[\u2068\u2069]/gu, '')
  return `${USER_DATA_START}${text}${USER_DATA_END}`
}

export function stripUiDataProtection(value) {
  return String(value ?? '').replace(/[\u2068\u2069]/gu, '')
}

function maskProtectedUiData(value) {
  const protectedValues = []
  const text = String(value).replace(/\u2068([\s\S]*?)\u2069/gu, (_match, content) => {
    const token = `__ADREEM_USER_DATA_${protectedValues.length}__`
    protectedValues.push(content)
    return token
  })
  return {
    text,
    restore(translated) {
      return protectedValues.reduce(
        (result, content, index) => result.replaceAll(`__ADREEM_USER_DATA_${index}__`, preserveUiData(content)),
        translated,
      )
    },
  }
}

const ENGLISH_PATTERNS = [
  [/^آخر تحقق (.+)$/u, 'Last check $1'],
  [/^فحص كل ساعتين أثناء الاستخدام · آخر تحقق (.+)$/u, 'Checks every two hours while in use · Last check $1'],
  [/^تلقائي كل ساعتين · آخر تحقق (.+)$/u, 'Automatic every two hours · Last check $1'],
  [/^تلقائي كل ساعتين · آخر سعر (.+)$/u, 'Automatic every two hours · Last price $1'],
  [/^السعر الحالي\s+(.+)$/u, 'Current price $1'],
  [/^الخطوة\s+(.+)\s+من\s+(.+)$/u, 'Step $1 of $2'],
  [/^اليوم\s+(\d+)$/u, 'Today $1'],
  [/^مراجعة\s+(\d+)$/u, 'Review $1'],
  [/^(\d+)\s+نتيجة$/u, '$1 results'],
  [/^(\d+)\s+تنبيه$/u, '$1 alerts'],
  [/^(\d+)\s+حركات?$/u, '$1 entries'],
  [/^(\d+)\s+عملية محفوظة$/u, '$1 saved transaction'],
  [/^(\d+)\s+عمليات محفوظة$/u, '$1 saved transactions'],
  [/^الخطوة\s+(.+)$/u, 'Step $1'],
  [/^اليوم:\s*(\d+)\s+حركة$/u, 'Today: $1 entries'],
  [/^المراجعة:\s*(\d+)$/u, 'Review: $1'],
  [/^تحدثت\s+(\d+)\s+أسعار\.\s+بقي\s+(\d+)\s+على سعره السابق\.$/u, 'Updated $1 prices. $2 kept their previous price.'],
  [/^(\d+)\s+حساب\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 accounts · Page $2/$3'],
  [/^(\d+)\s+حركة\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 entries · Page $2/$3'],
  [/^(\d+)\s+حركة\s+·\s+أحدث\s+(\d+)$/u, '$1 entries · Latest $2'],
  [/^(\d+)\s+مشروع أو أصل\s+·\s+(\d+)\s+نوع مصروف$/u, '$1 projects or assets · $2 expense types'],
  [/^(\d+)\s+مشروع أو أصل\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 projects or assets · Page $2/$3'],
  [/^(\d+)\s+نوع مصروف\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 expense types · Page $2/$3'],
  [/^(\d+)\s+حركة مرتبطة\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 linked entries · Page $2/$3'],
  [/^(\d+)\s+حركة معتمدة$/u, '$1 posted entries'],
  [/^آخر الحركات\s+·\s+(\d+)$/u, 'Latest entries · $1'],
  [/^سجل التعديلات\s+·\s+(\d+)$/u, 'Edit history · $1'],
  [/^فلوسي:\s*(.+)$/u, 'My money: $1'],
  [/^دخل\s+(.+)\s+·\s+مصروف\s+(.+)\s+·\s+صافي\s+(.+)\s+·\s+(\d+)\s+حركة معتمدة$/u, 'Income $1 · Expense $2 · Net $3 · $4 posted entries'],
  [/^دولار:\s+دخل\s+(.+)\s+·\s+مصروف\s+(.+)\s+·\s+صافي\s+(.+)\s+·\s+(\d+)\s+حركة معتمدة$/u, 'USD: Income $1 · Expense $2 · Net $3 · $4 posted entries'],
  [/^دخل\s+(.+)\s+·\s+مصروف\s+(.+)\s+·\s+صافي\s+(.+)$/u, 'Income $1 · Expense $2 · Net $3'],
  [/^دولار:\s+دخل\s+(.+)\s+·\s+مصروف\s+(.+)\s+·\s+صافي\s+(.+)$/u, 'USD: Income $1 · Expense $2 · Net $3'],
  [/^(\d+)\s+فعالة\s+·\s+(\d+)\s+مستحقة$/u, '$1 active · $2 due'],
  [/^(\d+)\s+فعالة\s+·\s+(\d+)\s+مستحقة\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 active · $2 due · Page $3/$4'],
  [/^(.+)\s+·\s+يوم\s+(\d+)$/u, '$1 · Day $2'],
  [/^·\s+صفحة\s+(\d+)\/(\d+)$/u, '· Page $1/$2'],
  [/^(\d+)\s+عنصر\s+·\s+صفحة\s+(\d+)\/(\d+)$/u, '$1 items · Page $2/$3'],
  [/^صفحة\s+(\d+)\/(\d+)$/u, 'Page $1/$2'],
  [/^(\d+)\s+عنصر$/u, '$1 items'],
  [/^المشاريع والأصول\s+·\s+(\d+)$/u, 'Projects and assets · $1'],
  [/^أنواع المصروف\s+·\s+(\d+)$/u, 'Expense types · $1'],
  [/^تفاصيل\s+#(\d+)$/u, 'Details #$1'],
  [/^#(\d+)\s+·\s+الحالة:\s*(.+)$/u, (_match, number, status) => `#${number} · Status: ${translateKnownSegment(status)}`],
  [/^(#?)(\d+)\s+·\s+(.+?)\s+·\s+([0-9][0-9,.]*\s+(?:د\.ل|\$))(?:\s+·\s+(معتمدة|ملغاة|ناقصة|مسودة))?$/u, (_match, prefix, number, type, amount, status) => `${prefix}${number} · ${translatePlainSegment(type)} · ${localizeEnglishCurrencyUnit(amount)}${status ? ` · ${translateKnownSegment(status)}` : ''}`],
  [/^(.+)\s+·\s+(\d+)\s+حركة معتمدة$/u, (_match, amount, count) => `${localizeEnglishCurrencyUnit(amount)} · ${count} posted entries`],
  [/^بحث:\s*(.+)$/u, 'Search: $1'],
  [/^(\d+)\s+اختيارات مناسبة\.\s+اضغط الاسم المطلوب\.$/u, '$1 matching choices. Choose the account.'],
  [/^(\d+)\s+حسابات مناسبة\.\s+اختر الحساب\.$/u, '$1 matching accounts. Choose the account.'],
  [/^(\d+)\s+اختيارات مناسبة\.$/u, '$1 matching choices.'],
  [/^(\d+)\s+حسابات مناسبة\.$/u, '$1 matching accounts.'],
  [/^تم اختيار:\s*(.+)\.$/u, (_match, choice) => `Selected: ${translateSystemSequence(choice)}.`],
  [/^تصحيح:\s*(.+)$/u, 'Adjustment: $1'],
  [/^دفتر:\s*(.+)$/u, 'Ledger: $1'],
  [/^فعلي:\s*(.+)$/u, 'Actual: $1'],
  [/^الفرق:\s*(.+)$/u, 'Difference: $1'],
  [/^ملاحظة:\s*(.+)$/u, 'Note: $1'],
  [/^الوقت:\s*(.+)\s+(م|ص)$/u, (_match, time, period) => `Time: ${time} ${period === 'م' ? 'PM' : 'AM'}`],
  [/^الوقت:\s*(.+)$/u, 'Time: $1'],
  [/^السعر:\s*(.+)$/u, 'Rate: $1'],
  [/^قبل:\s*(.+)$/u, 'Before: $1'],
  [/^التغيير:\s*(.+)$/u, 'Change: $1'],
  [/^بعد:\s*(.+)$/u, 'After: $1'],
  [/^سيتم إنشاء تعديل رصيد بقيمة\s+(.+)\.$/u, 'A balance adjustment of $1 will be created.'],
  [/^هذا الحساب عليه رصيد:\s*(.+)\.\s+أصلحه من الويب بدل إخفائه\.$/u, 'This account has a balance: $1. Fix it on the web instead of hiding it.'],
  [/^التحويل يجب أن يكون بين نفس النوع:\s*(.+)\s+إلى\s+(.+)\s+غير مسموح\.$/u, (_match, source, destination) => `Transfer must be between the same type: ${translateSystemSequence(source)} to ${translateSystemSequence(destination)} is not allowed.`],
  [/^رصيد افتتاحي من Numbers:\s*(.+)$/u, 'Opening balance imported from Numbers: $1'],
  [/^رصيد افتتاحي دولار من Numbers:\s*(.+)$/u, 'Opening USD balance imported from Numbers: $1'],
  [/^(تحويل|إيداع في المصرف|سحب من المصرف|دخل|بعت دولار|اشتريت دولار|مصروف شاحنة|دخل شاحنة|تعديل رصيد)\s+([0-9][0-9,.]*)$/u, (_match, type, amount) => `${translateSystemSequence(type)} ${amount}`],
  [/^(تحويل|إيداع في المصرف|سحب من المصرف|دخل|بعت دولار|اشتريت دولار|مصروف شاحنة|دخل شاحنة|تعديل رصيد)\s+([0-9][0-9,.]*\s+(?:د\.ل|\$))$/u, (_match, type, amount) => `${translateSystemSequence(type)} ${localizeEnglishCurrencyUnit(amount)}`],
  [/^تكرار\s+(\d{4}-\d{2})$/u, 'Recurring $1'],
  [/^الإلغاء المباشر متاح فقط خلال آخر\s+(\d+)\s+ساعة\.\s+للحركات القديمة استخدم (?:حركة )?تصحيح\.$/u, 'Direct cancellation is available only for the last $1 hours. Use an adjustment for older entries.'],
  [/^لم يتم تأكيد الحفظ\. سيحاول النظام تلقائيًا خلال\s+(.+)\s+ث\.$/u, 'Save was not confirmed. The system will retry automatically in $1 sec.'],
  [/^لم يتم حفظ التعديل\. أصلح الحركة أولًا حتى لا يتغير الرصيد:\s*(.+)$/u, (_match, error) => `Changes were not saved. Fix the entry first so the balance does not change: ${translateSystemSequence(error)}`],
  [/^هذا التصنيف لا يناسب الحركات السابقة:\s*(.+)$/u, (_match, error) => `This classification does not fit earlier entries: ${translateSystemSequence(error)}`],
  [/^نوع الحساب لا يناسب الحركات السابقة:\s*(.+)$/u, (_match, error) => `This account type does not fit earlier entries: ${translateSystemSequence(error)}`],
  [/^لم يتم رفع المرفق:\s*(.+)$/u, (_match, error) => `Attachment upload failed: ${translateSystemSequence(error)}`],
  [/^حدد هل رصيد\s+(.+)\s+لك عنده أو عليك له\.$/u, (_match, channel) => `Choose whether the ${translateKnownSegment(channel)} balance is owed to you or owed by you.`],
  [/^هل تريد إلغاء\s+(.+)؟\s+ستبقى الحركة ظاهرة في السجل\.$/u, (_match, entry) => {
    const details = entry.match(/^(.+)\s+بقيمة\s+(.+)$/u)
    const translatedEntry = details
      ? `${translateKnownSegment(details[1])} worth ${localizeEnglishCurrencyUnit(details[2])}`
      : translateSystemSequence(entry)
    return `Cancel ${translatedEntry}? The entry will remain visible in history.`
  }],
  [/^هل تريد دمج حساب\s+(.+)\s+داخل\s+(.+)؟\s+ستُنقل الحركات ومرفقات الحساب إلى الحساب المختار\.$/u, (_match, source, target) => `Merge account ${source} into ${target}? Entries and account attachments will move to the selected account.`],
  [/^تعديل الحركات القديمة غير مباشر\. استخدم حركة تصحيح بدل تعديل حركة أقدم من\s+(\d+)\s+ساعة\.$/u, 'Older entries cannot be edited directly. Use an adjustment for entries older than $1 hours.'],
  [/^حذف دخول\s+(.+)؟\s+بيانات الدفتر لن تُحذف\.$/u, 'Remove login for $1? Ledger data will not be deleted.'],
  [/^([+-]?[0-9][0-9,.]*)\s+د\.ل$/u, '$1 LYD'],
  [/^(✓\s*)?دينار د\.ل$/u, '$1Dinar · LYD'],
  [/^(✓\s*)?دولار \$$/u, '$1US dollar $'],
  [/^(✓\s*)?دينار$/u, '$1Dinar'],
  [/^(✓\s*)?دولار$/u, '$1US dollar'],
  [/^تنفيذ #(\d+)$/u, 'Run #$1'],
  [/^إيقاف #(\d+)$/u, 'Stop #$1'],
  [/^إصلاح حركة #(\d+)$/u, 'Fix entry #$1'],
  [/^إلغاء حركة #(\d+)$/u, 'Cancel entry #$1'],
  [/^إلغاء #(\d+)$/u, 'Cancel #$1'],
  [/^إصلاح حساب #(\d+)$/u, 'Fix account #$1'],
  [/^إخفاء إذا صفر #(\d+)$/u, 'Hide if zero #$1'],
  [/^موجود\s+([+-]?[0-9].+)$/u, 'Available $1'],
  [/^ناقص\s+([+-]?[0-9].+)$/u, 'Short $1'],
  [/^أقبض منه\s+([+-]?[0-9].+)$/u, 'They owe me $1'],
  [/^أدفع له\s+([+-]?[0-9].+)$/u, 'I owe them $1'],
  [/^لي\s+([+-]?[0-9].+)$/u, 'Owed to me $1'],
  [/^عليّ\s+([+-]?[0-9].+)$/u, 'I owe $1'],
  [/^لي عنده\s+([+-]?[0-9].+)$/u, 'Owed to me $1'],
  [/^عليّ له\s+([+-]?[0-9].+)$/u, 'I owe them $1'],
  [/^(\d+)\s+أرصدة سابقة$/u, '$1 previous balances'],
  [/^أقبض\s+([+-]?[0-9].+)$/u, 'Collect $1'],
  [/^أدفع\s+([+-]?[0-9].+)$/u, 'Pay $1'],
  [/^قيمة\s+([+-]?[0-9].+)$/u, 'Value $1'],
  [/^مصروف\s+([+-]?[0-9].+)$/u, 'Expense $1'],
  [/^تم إنشاء حساب\s+(.+)\.$/u, 'Account $1 created.'],
  [/^حذف دخول\s+(.+)؟$/u, 'Remove login for $1?'],
  [/^المستخدمون\s+·\s+(.+)$/u, 'Users · $1'],
  [/^تعديل #(\d+)$/u, 'Edit #$1'],
  [/^إلغاء #(\d+)$/u, 'Cancel #$1'],
  [/^ADREEM\s+·\s+إدخال$/u, 'ADREEM · Add'],
  [/^ADREEM\s+·\s+الأرصدة$/u, 'ADREEM · Balances'],
  [/^ADREEM\s+·\s+الحركات$/u, 'ADREEM · Entries'],
  [/^ADREEM\s+·\s+سجل اليوم$/u, 'ADREEM · Today'],
  [/^ADREEM\s+·\s+المراجعة$/u, 'ADREEM · Review'],
  [/^ADREEM\s+·\s+بحث$/u, 'ADREEM · Search'],
  [/^ADREEM\s+·\s+نتائج البحث$/u, 'ADREEM · Search results'],
  [/^ADREEM\s+·\s+المزيد$/u, 'ADREEM · More'],
  [/^ADREEM\s+·\s+التقارير$/u, 'ADREEM · Reports'],
  [/^ADREEM\s+·\s+تنبيهات$/u, 'ADREEM · Alerts'],
  [/^ADREEM\s+·\s+الحساب$/u, 'ADREEM · Account'],
  [/^ADREEM\s+·\s+حساب جديد$/u, 'ADREEM · New account'],
  [/^ADREEM\s+·\s+مطابقة رصيد$/u, 'ADREEM · Reconcile balance'],
  [/^ADREEM\s+·\s+الحركات الشهرية$/u, 'ADREEM · Monthly entries'],
  [/^ADREEM\s+·\s+المستخدمون$/u, 'ADREEM · Users'],
  [/^ADREEM\s+·\s+إدارة المستخدمين$/u, 'ADREEM · User management'],
]

function translateKnownSegment(content) {
  const exact = ENGLISH_TEXT[content]
  if (exact) return localizeEnglishCurrencyUnit(exact)
  for (const [pattern, replacement] of ENGLISH_PATTERNS) {
    if (pattern.test(content)) return localizeEnglishCurrencyUnit(content.replace(pattern, replacement))
  }
  return content
}

function localizeEnglishCurrencyUnit(value) {
  return String(value).replaceAll('د.ل', 'LYD')
}

function translateSystemSequence(value) {
  return String(value ?? '')
    .split(/(?<=[.!؟])\s+/u)
    .map((part) => translateKnownSegment(part))
    .join(' ')
}

function translatePlainSegment(value) {
  const text = String(value ?? '')
  if (!text || !/[\u0600-\u06ff]/u.test(text)) return text
  const leading = text.match(/^\s*/u)?.[0] || ''
  const trailing = text.match(/\s*$/u)?.[0] || ''
  const content = text.slice(leading.length, text.length - trailing.length)
  if (!content) return text
  const marker = content.match(/^([^\p{L}\p{N}]+)(.+)$/u)
  if (marker) {
    const localizedRest = translatePlainSegment(marker[2])
    if (localizedRest !== marker[2]) return `${leading}${marker[1]}${localizedRest}${trailing}`
  }
  const translated = translateKnownSegment(content)
  if (translated !== content) return `${leading}${translated}${trailing}`

  const translatedSequence = translateSystemSequence(content)
  if (translatedSequence !== content) return `${leading}${translatedSequence}${trailing}`

  const parts = content.split(/(\s+·\s+|:\s+|\s+←\s+|\s+→\s+|\s+\|\s+)/u)
  const localizedParts = parts.map((part, index) => index % 2 === 0 ? translateKnownSegment(part) : part)
  const localized = localizedParts.join('')
  return localized === content ? text : `${leading}${localized}${trailing}`
}

function translateVisibleText(value) {
  const protectedText = maskProtectedUiData(value)
  const text = protectedText.text
  const translated = !text.includes('<') && !text.includes('\n')
    ? translatePlainSegment(text)
    : text
    .split(/(<[^>]+>)/u)
    .map((part) => part.startsWith('<') && part.endsWith('>')
      ? part
      : part.split('\n').map(translatePlainSegment).join('\n'))
    .join('')
  return protectedText.restore(translated)
}

export function setActiveUiLanguage(value) {
  activeUiLanguage = normalizeUiLanguage(value)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = activeUiLanguage
    document.documentElement.dir = activeUiLanguage === UI_LANGUAGES.ENGLISH ? 'ltr' : 'rtl'
  }
  return activeUiLanguage
}

export function getActiveUiLanguage() {
  return activeUiLanguage
}

export function translateUiText(value, language = activeUiLanguage) {
  if (typeof value !== 'string') return value
  if (normalizeUiLanguage(language) !== UI_LANGUAGES.ENGLISH) return stripUiDataProtection(value)
  return translateVisibleText(value)
}

export function readRememberedUiLanguage() {
  if (typeof window === 'undefined') return DEFAULT_UI_LANGUAGE
  try {
    return normalizeUiLanguage(window.localStorage?.getItem(ADREEM_UI_LANGUAGE_STORAGE_KEY))
  } catch {
    return DEFAULT_UI_LANGUAGE
  }
}

export function rememberUiLanguage(value) {
  const language = normalizeUiLanguage(value)
  setActiveUiLanguage(language)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(ADREEM_UI_LANGUAGE_STORAGE_KEY, language)
    } catch {
      // The server profile remains the source of truth when browser storage is unavailable.
    }
  }
  return language
}
