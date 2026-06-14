# ADREEM

دفتر مالي مستقل لإدارة الأشخاص، الحسابات، الأصول، المصروفات، والحركات من الويب وTelegram Bot بنفس منطق الدفتر.

## الروابط

- التطبيق: https://aneerabee.github.io/adreem/
- خيارات التصميم: https://aneerabee.github.io/adreem/adreem-redesign-options.html
- GitHub: https://github.com/aneerabee/adreem

ملاحظة: اسم المنتج داخل النظام هو ADREEM. مسار GitHub Pages الحالي يبقى `/adreem/` لأنه تابع لاسم مستودع GitHub الحالي.

## التشغيل المحلي

```bash
npm ci
npm run dev
```

## الفحص

```bash
npm run lint
npm run test
npm run build
```

## البوت

```bash
npm run bot:adreem
```

يحتاج البوت إلى متغيرات البيئة الخاصة بـTelegram وSupabase. لا تضع المفاتيح السرية داخل Git.

متطلبات البوت على السيرفر:

- `TELEGRAM_BOT_TOKEN`
- `ADREEM_TELEGRAM_USER_IDS` أو `ADREEM_TELEGRAM_USER_ID`
- `ADREEM_TELEGRAM_ADMIN_IDS` حتى يستطيع صاحب النظام عرض المستخدمين ومعرفة الأرقام
- `ADREEM_TELEGRAM_LEDGER_IDS` عند وجود أكثر من مستخدم، مثل `user-id=main,user-id-2=second-book`
- `ADREEM_TELEGRAM_USERS_FILE` لحفظ المستخدمين الذين تنشئهم صفحة الإدارة، مثل `/home/argaz/apps/adreem/adreem-telegram-users.json`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

أوامر البوت الإدارية المتبقية:

```text
/myid
/users
```

لا تنشئ المستخدمين من Telegram. المستخدمون يضافون من صفحة إدارة ADREEM بالإيميل وكلمة المرور، ويمكن ربط Telegram ID اختياريًا بنفس الدفتر.

## API الويب المعزول

```bash
npm run api:adreem
```

متطلبات السيرفر:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADREEM_OWNER_EMAILS` لتحديد مالك صفحة الإدارة
- `ADREEM_TELEGRAM_USERS_FILE` لمسجل المستخدمين
- اختياريًا: `ADREEM_API_PORT` و `ADREEM_WEB_ALLOWED_ORIGIN`
- اختياريًا للمرفقات: `ADREEM_ATTACHMENTS_BUCKET`
- اختياريًا للنسخ: `ADREEM_BACKUP_DIR` و `ADREEM_BACKUP_LIMIT`
- اختياريًا للتدقيق: `ADREEM_AUDIT_LOG_FILE`

إضافة المستخدمين تتم من صفحة الإدارة: `https://aneerabee.github.io/adreem/?admin=users`.
كل مستخدم يدخل من الرابط العام بالإيميل وكلمة المرور، وكل مستخدم له `ledgerId` مستقل.

في الإنتاج يجب ضبط `ADREEM_WEB_ALLOWED_ORIGIN` على رابط GitHub Pages الفعلي، مثل:

```text
https://aneerabee.github.io
```

عند ضبط `VITE_ADREEM_API_URL` في الويب، يستخدم التطبيق API بعد تسجيل الدخول فقط. إذا لم توجد جلسة دخول، تظهر صفحة الدخول ولا يرجع الويب إلى Supabase anon.

في الإنتاج:

- شغّل API خلف HTTPS فقط.
- شغّله بـ `NODE_ENV=production`.
- لا تضع أسرارًا داخل `VITE_ADREEM_API_URL`; هذا المتغير URL عام فقط.
- API يحتوي rate limiting داخلي للـ login والحفظ والإدارة، ويمكن إضافة reverse proxy rate limiting كطبقة إضافية.
- سجلات الإدارة والحفظ تكتب في `ADREEM_AUDIT_LOG_FILE` عند ضبطه.
- snapshots تلقائية تكتب في `ADREEM_BACKUP_DIR` قبل/بعد الحفظ المهم.

## التخزين

- الصف السحابي الحالي: `adreem:adreem:main`.
- يقرأ النظام صف `default` القديم فقط للهجرة، ثم يحفظ على صف ADREEM الجديد.
- الويب العام لا يحصل على `SUPABASE_ANON_KEY` في build GitHub Pages، ولا يتصل مباشرة بقاعدة البيانات.
- الاتصال السحابي من الويب يمر عبر ADREEM API فقط، والـ API وحده يستخدم `SUPABASE_SERVICE_ROLE_KEY` على السيرفر.
- RLS في `ml_state` مغلق بدون سياسات anon. هذا مقصود حتى لا يستطيع رابط الويب العام قراءة أو تعديل قاعدة البيانات مباشرة.
- القراءة من صف `default` القديم تتم فقط من السيرفر عبر service role لهجرة بيانات الدفتر الرئيسي، ولا تفتح أي وصول عام.
- يمكن تشغيل Supabase المباشر محليًا فقط عند الحاجة المؤقتة بتفعيل `VITE_ENABLE_SUPABASE_DIRECT=true` مع مفاتيح محلية خاصة، ولا يعمل هذا المسار في build الإنتاج حتى لو ضُبط المتغير بالخطأ.
- عزل Telegram لعدة مستخدمين يتم عبر `ADREEM_TELEGRAM_LEDGER_IDS` مثل `278516861=main,555=saeed-book`، ويتطلب `SUPABASE_SERVICE_ROLE_KEY` على السيرفر. لا تستخدم anon key لتشغيل عدة دفاتر من البوت.
- لا يوجد حذف فعلي للسجلات أثناء التشغيل اليومي: الإلغاء يصبح `voided`، إخفاء الحساب يصبح `inactive`، وإيقاف التكرار يصبح `inactive`. الحذف الكامل يكون فقط عبر reset دفتر كامل بعد backup.

## التشغيل السحابي

راجع [docs/adreem-operational-runbook.md](docs/adreem-operational-runbook.md).
