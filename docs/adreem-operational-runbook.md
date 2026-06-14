# ADREEM Operational Runbook

## الهدف

تشغيل ADREEM بشكل سحابي آمن:

- الويب على GitHub Pages.
- API خاص يحفظ ويقرأ من Supabase عبر service role فقط.
- Telegram Bot يعمل كخدمة systemd مستقلة.
- لا توجد مفاتيح Supabase أو Telegram داخل GitHub Pages أو Git.

## المتغيرات

استخدم `deploy/adreem.env.example` كقالب وأنشئ على السيرفر:

```text
/home/argaz/apps/adreem/adreem.env
```

الصلاحية المطلوبة:

```bash
chmod 600 /home/argaz/apps/adreem/adreem.env
```

## قاعدة البيانات

طبّق `supabase/schema.sql` على Supabase قبل فتح API للإنتاج. هذا يغلق سياسات anon على `ml_state` ويجعل الوصول من الويب يمر عبر API فقط.

## GitHub Pages

يحتاج الريبو إلى secret واحد للويب:

```bash
gh secret set VITE_ADREEM_API_URL -R aneerabee/adreem --body "https://your-adreem-api.example.com"
```

لا تضف `VITE_SUPABASE_URL` أو `VITE_SUPABASE_ANON_KEY` في build الإنتاج.

`VITE_ADREEM_API_URL` يجب أن يكون رابط API فقط، بدون token وبدون أي مفتاح.

لتمكين فحص التشغيل الكامل من السيرفر، ضع حساب اختبار حقيقي في registry:

```text
ADREEM_RUNTIME_TEST_EMAIL=owner@example.com
ADREEM_RUNTIME_TEST_PASSWORD=owner-password
```

هذه المتغيرات تبقى على السيرفر فقط، ويستخدمها `npm run verify:runtime` لتسجيل الدخول ثم اختبار `/api/ledger`.

## الأمان أمام API

- شغّل API بـ `NODE_ENV=production`.
- اضبط `ADREEM_WEB_ALLOWED_ORIGIN=https://aneerabee.github.io`.
- اجعل API خلف HTTPS فقط.
- دخول المستخدمين يتم بالإيميل وكلمة المرور من صفحة ADREEM العادية.
- جلسة الدخول تولّد token طويل الأجل لهذا الجهاز داخل `localStorage`، ولا يطلب الدخول مرة أخرى إلا عند تسجيل الخروج أو حذف بيانات الموقع.
- لا تستخدم `ADREEM_WEB_LEDGER_TOKEN_HASHES` أو `ADREEM_WEB_LEDGER_TOKENS` لتشغيل دفاتر الويب. الوصول يتم من جلسات الإيميل وكلمة المرور فقط.
- API يحتوي rate limiting داخلي للـ login والإدارة والحفظ والمرفقات، ويمكن إضافة reverse proxy أو firewall كطبقة إضافية.
- اضبط `ADREEM_AUDIT_LOG_FILE` لحفظ سجل إداري JSONL.
- اضبط `ADREEM_BACKUP_DIR` لتفعيل snapshots تلقائية قبل/بعد حفظ الدفتر.
- عند فقدان كلمة مرور مستخدم، أنشئ له كلمة مرور جديدة من صفحة الإدارة بنفس كود الدفتر.

قاعدة العزل: كل مستخدم يحصل على `ledgerId` خاص ويدخل بالإيميل وكلمة المرور. لا تعطي مستخدمين مختلفين نفس `ledgerId`. إدارة المستخدمين تتم من صفحة إدارة ADREEM، وليس من أوامر التلقرام.

## إضافة مستخدم من صفحة الإدارة

اضبط في `adreem.env`:

```text
ADREEM_OWNER_EMAILS=owner@example.com
ADREEM_TELEGRAM_ADMIN_IDS=YOUR_TELEGRAM_ID
ADREEM_TELEGRAM_USERS_FILE=/home/argaz/apps/adreem/adreem-telegram-users.json
```

رابط الإدارة:

```text
https://aneerabee.github.io/adreem/?admin=users
```

الإدارة لا تستخدم توكنًا يدويًا. ادخل أولًا بحساب المالك بالإيميل وكلمة المرور، ثم افتح رابط الإدارة أو زر `إدارة` من واجهة ADREEM.

من الصفحة:

- اكتب اسم المستخدم.
- اكتب إيميل المستخدم.
- اكتب كلمة مرور 8 أحرف على الأقل.
- اكتب كود دفتر إنجليزي واضح مثل `mohammad` أو `saeed-book`.
- ضع Telegram ID اختياريًا فقط إذا كان هذا المستخدم سيستعمل البوت.
- بعد الإنشاء يدخل المستخدم من الرابط العام: `https://aneerabee.github.io/adreem/`.

أي مستخدم غير مضاف لا يستطيع الدخول للدفتر، لكنه يرى Telegram ID الخاص به فقط حتى يرسله لك. لا تفعّل وضع "الجميع مسموح" للدفتر المالي؛ هذا يكسر العزل.

الأوامر المتبقية من داخل البوت:

```text
/myid
/users
```

البوت لا ينشئ مستخدمين. عند إضافة مستخدم من صفحة الإدارة تُحفظ كلمة المرور كـ hash فقط داخل `ADREEM_TELEGRAM_USERS_FILE`، والـ API يقرأ هذا الملف عند كل طلب، لذلك لا تحتاج لإعادة تشغيل API بعد إضافة مستخدم جديد.

## systemd

المسارات القياسية المقترحة:

```text
/home/argaz/apps/adreem
/home/argaz/logs/adreem-api.log
/home/argaz/logs/adreem-api-error.log
/home/argaz/logs/adreem-bot.log
/home/argaz/logs/adreem-bot-error.log
```

انسخ ملفات الخدمة:

```bash
cp deploy/systemd/adreem-api.service ~/.config/systemd/user/adreem-api.service
cp deploy/systemd/adreem-bot.service ~/.config/systemd/user/adreem-bot.service
systemctl --user daemon-reload
systemctl --user enable --now adreem-api.service adreem-bot.service
```

## فحص التشغيل

بعد تشغيل API:

```bash
npm run verify:runtime
systemctl --user status adreem-api.service --no-pager
systemctl --user status adreem-bot.service --no-pager
```

إذا فشل SSH من الجهاز المحلي، لا تعتبر حالة Contabo مؤكدة. آخر كلمة حاسمة يجب أن تأتي من `systemctl` و `/health` على السيرفر نفسه.

## دخول المستخدم

الرابط العام:

```text
https://aneerabee.github.io/adreem/
```

في الإنتاج، إذا لم توجد جلسة دخول محفوظة يظهر نموذج الإيميل وكلمة المرور. بعد الدخول يفتح الويب دفتر المستخدم المعزول حسب `ledgerId` ويتذكر هذا الجهاز الدخول إلى أن يتم الخروج أو حذف بيانات الموقع.

روابط `#ledger_token=` القديمة غير معتمدة للتشغيل الجديد. استخدم تسجيل الدخول من صفحة ADREEM.

## قاعدة عدم الحذف الفعلي

ADREEM لا يعتمد على حذف السجلات واحدة بواحدة أثناء التشغيل اليومي. أي إلغاء أو إخفاء يجب أن يبقى كسجل حالة:

- الحركة تصبح `voided`.
- الحساب يصبح `inactive`.
- قاعدة التكرار تصبح `inactive` مع `disabledAt`.
- الاسترجاع أو الدمج لا يفترض أن حذف عنصر من جهاز يعني حذفه من كل الأجهزة.

الحذف الفعلي مسموح فقط في reset كامل للدفتر بعد backup واضح، لأن الدمج بين المحلي والسحابي مصمم لحماية السجلات من الفقد وليس لمزامنة deletes صامتة.
