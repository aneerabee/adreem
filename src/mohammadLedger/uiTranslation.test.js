import fs from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { localizeTelegramPayload, preserveUiData, setActiveUiLanguage, stripUiDataProtection, translateUiText } from './uiTranslation.js'

const ARABIC_TEXT = /[\u0600-\u06ff]/u
const UI_SOURCE_FILES = [
  'MohammadLedgerApp.jsx',
  'AdreemChrome.jsx',
  'LoginPage.jsx',
  'AdminUsersPage.jsx',
  'ConfigurationErrorPage.jsx',
]

function visibleArabicLiterals(fileName) {
  const fileUrl = new URL(fileName, import.meta.url)
  const source = fs.readFileSync(fileUrl, 'utf8')
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
  const values = []
  function visit(node) {
    const value = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
      ? node.text.trim()
      : ''
    if (value && ARABIC_TEXT.test(value)) values.push(value)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return values
}

describe('ADREEM UI translation', () => {
  it('uses clear English for core entry and account actions', () => {
    setActiveUiLanguage('en')

    expect(translateUiText('إضافة حركة')).toBe('Add entry')
    expect(translateUiText('اختر من أين تخرج الفلوس.')).toBe('Choose where the money comes from.')
    expect(translateUiText('تأكيد وحفظ الحركة')).toBe('Confirm and save entry')
    expect(translateUiText('الأرصدة')).toBe('Balances')
    expect(translateUiText('لي عند الناس')).toBe('People owe me')
    expect(translateUiText('عليّ للناس')).toBe('I owe people')
    expect(translateUiText('ابحث عن حساب')).toBe('Search accounts')
    expect(translateUiText('دينار كاش')).toBe('Cash dinars')
    expect(translateUiText('دينار شيك')).toBe('Cheque dinars')
    expect(translateUiText('دولار بيننا')).toBe('USD between us')
    expect(translateUiText('كاش وشيك ودولار')).toBe('Cash, cheque, and USD')
    expect(translateUiText('3 أرصدة سابقة')).toBe('3 previous balances')
  })

  it('translates formatted Telegram text without changing its markup', () => {
    expect(translateUiText('<b>ADREEM · مراجعة</b>\n<blockquote>لا شيء معلق.</blockquote>', 'en'))
      .toBe('<b>ADREEM · Review</b>\n<blockquote>Nothing is pending.</blockquote>')
  })

  it('translates compact balance directions without changing the amount', () => {
    expect(translateUiText('لي 500 د.ل', 'en')).toBe('Owed to me 500 LYD')
    expect(translateUiText('عليّ 250 $', 'en')).toBe('I owe 250 $')
    expect(translateUiText('مطابقة الرصيد', 'en')).toBe('Reconcile balance')
    expect(translateUiText('الرصيد الفعلي بالدينار', 'en')).toBe('Actual balance in dinars')
  })

  it('preserves user-entered names and notes', () => {
    expect(translateUiText('محمد الكيفو', 'en')).toBe('محمد الكيفو')
    expect(translateUiText('فاتورة الوقود لشاحنة سعيد', 'en')).toBe('فاتورة الوقود لشاحنة سعيد')
  })

  it('protects user data even when it matches a system label', () => {
    const protectedName = preserveUiData('دخل')

    expect(stripUiDataProtection(translateUiText(protectedName, 'en'))).toBe('دخل')
    expect(stripUiDataProtection(translateUiText(`الحساب: ${protectedName}`, 'en'))).toBe('Account: دخل')
    expect(translateUiText(protectedName, 'ar')).toBe('دخل')
  })

  it('translates financial confirmation messages with protected account names', () => {
    expect(stripUiDataProtection(translateUiText('هل تريد إلغاء تحويل بقيمة 1,200 د.ل؟ ستبقى الحركة ظاهرة في السجل.', 'en')))
      .toBe('Cancel Transfer worth 1,200 LYD? The entry will remain visible in history.')
    expect(stripUiDataProtection(translateUiText(`هل تريد دمج حساب ${preserveUiData('دخل')} داخل ${preserveUiData('مالك')}؟ ستُنقل الحركات ومرفقات الحساب إلى الحساب المختار.`, 'en')))
      .toBe('Merge account دخل into مالك? Entries and account attachments will move to the selected account.')
  })

  it('translates linked person validation without weakening its meaning', () => {
    expect(translateUiText('ربط الشخص بالحسابات الثلاثة غير مكتمل.', 'en')).toBe('The three person balances are not fully linked.')
    expect(translateUiText('حدد هل رصيد دينار شيك لك عنده أو عليك له.', 'en'))
      .toBe('Choose whether the Cheque dinars balance is owed to you or owed by you.')
    expect(translateUiText('لا يمكن حذف حساب من مسار الحفظ العادي. أخفِه أو استخدم مسار التصفير المحمي.', 'en'))
      .toBe('An account cannot be deleted through normal saving. Hide it or use the protected reset flow.')
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

  it('removes data-protection markers from Arabic and English Telegram payloads', () => {
    const protectedName = preserveUiData('دخل')
    const payload = {
      text: `الحساب: ${protectedName}`,
      reply_markup: { inline_keyboard: [[{ text: protectedName, callback_data: 'account:income' }]] },
    }

    expect(localizeTelegramPayload(payload, 'ar')).toEqual({
      text: 'الحساب: دخل',
      reply_markup: { inline_keyboard: [[{ text: 'دخل', callback_data: 'account:income' }]] },
    })
    expect(localizeTelegramPayload(payload, 'en')).toEqual({
      text: 'Account: دخل',
      reply_markup: { inline_keyboard: [[{ text: 'دخل', callback_data: 'account:income' }]] },
    })
  })

  it.each([
    ['تعذر قراءة ملف المرفق.', 'Could not read the attachment file.'],
    ['ملف المرفق غير صالح.', 'The attachment file is invalid.'],
    ['انتهت جلسة الدخول.', 'The sign-in session has expired.'],
    ['حجم المرفق أكبر من 10 ميغابايت.', 'The attachment is larger than 10 MB.'],
    ['نوع المرفق غير مسموح.', 'This attachment type is not allowed.'],
    ['طلبات كثيرة. حاول بعد قليل.', 'Too many requests. Try again shortly.'],
    ['تخزين المرفقات غير مهيأ.', 'Attachment storage is not configured.'],
    ['تعذر حفظ المرفق في السحابة.', 'Could not save the attachment to cloud storage.'],
    ['لا يمكنك فتح هذا المرفق.', 'You cannot open this attachment.'],
    ['لم يعد المرفق موجودًا.', 'This attachment no longer exists.'],
    ['تعذر فتح المرفق من السحابة.', 'Could not open the attachment from cloud storage.'],
    ['تعذر فتح المرفق.', 'Could not open the attachment.'],
  ])('translates attachment error %s', (arabic, english) => {
    expect(translateUiText(arabic, 'en')).toBe(english)
  })

  it('translates every static Arabic UI literal without leaving Arabic system text', () => {
    const untranslated = UI_SOURCE_FILES.flatMap((fileName) => visibleArabicLiterals(fileName))
      .map((value) => ({ value, translated: translateUiText(value, 'en') }))
      .filter(({ translated }) => ARABIC_TEXT.test(translated))

    expect(untranslated).toEqual([])
  })

  it('fully translates dynamic counters, steps, movement labels, and LYD amounts', () => {
    const samples = [
      'الخطوة 3 من 9',
      'تم اختيار: تحويل.',
      '3 حساب · صفحة 1/2',
      '3 عنصر · صفحة 1/2',
      'حركة · تحويل · 1,200 د.ل',
      'قبل: 2,000 د.ل',
      'التغيير: -500 د.ل',
      'بعد: 1,500 د.ل',
      '2 مشروع أو أصل · 3 نوع مصروف',
      '2 مشروع أو أصل · صفحة 1/2',
      '2 نوع مصروف · صفحة 1/2',
      '3 حركة مرتبطة · صفحة 1/2',
      '2 فعالة · 1 مستحقة · صفحة 1/2',
      '10 حركة · أحدث 5',
      '#1 · الحالة: معتمدة',
      '#3 · 🔁 تحويل · 1,250 د.ل',
      '#4 · 🔴 مصروف · 350 د.ل · ملغاة',
      'دخل 5,000 د.ل · مصروف 1,250 د.ل · صافي 3,750 د.ل · 4 حركة معتمدة',
    ]

    for (const sample of samples) expect(translateUiText(sample, 'en')).not.toMatch(ARABIC_TEXT)
  })

  it('translates system labels around Arabic user data without changing that data', () => {
    expect(translateUiText('الحساب الذي خرجت منه الفلوس: محمد · كاش بيننا', 'en'))
      .toBe('Money came from: محمد · Cash between us')
    expect(translateUiText('حذف دخول محمد؟ بيانات الدفتر لن تُحذف.', 'en'))
      .toBe('Remove login for محمد? Ledger data will not be deleted.')
  })
})
