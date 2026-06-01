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
- `ADREEM_TELEGRAM_ADMIN_IDS` حتى يستطيع صاحب النظام إضافة مستخدمين مستقلين من داخل البوت
- `ADREEM_TELEGRAM_LEDGER_IDS` عند وجود أكثر من مستخدم، مثل `user-id=main,user-id-2=second-book`
- `ADREEM_TELEGRAM_USERS_FILE` لحفظ المستخدمين المضافين من البوت، مثل `/home/argaz/apps/adreem/adreem-telegram-users.json`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

أوامر إدارة المستخدمين داخل البوت:

```text
/myid
/users
/adduser TELEGRAM_ID LEDGER_ID
```

مثال:

```text
/adduser 555 saeed-book
```

لا تجعل البوت مفتوحًا للجميع. أي مستخدم غير مضاف يرى رقمه فقط، وأنت تضيفه إلى دفتر مستقل من الأمر أعلاه.

## API الويب المعزول

```bash
npm run api:adreem
```

متطلبات السيرفر:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADREEM_WEB_LEDGER_TOKEN_HASHES` بصيغة `sha256-token-rabee=main,sha256-token-saeed=saeed-book`
- اختياريًا: `ADREEM_API_PORT` و `ADREEM_WEB_ALLOWED_ORIGIN`

لإنشاء hash للتوكن:

```bash
node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('token-rabee').digest('hex'))"
```

`ADREEM_WEB_LEDGER_TOKENS` ما زال مدعومًا مؤقتًا للتوافق، لكنه ليس الصيغة المعتمدة للدفاتر الجديدة.

لإنشاء دفتر مستقل جديد مع رابط ويب خاص وخريطة Telegram آمنة:

```bash
npm run ops:create-ledger-access -- --ledger=saeed-book --telegram=555
```

الناتج يعطيك رابط الويب الخاص مرة واحدة، وسطر `ADREEM_WEB_LEDGER_TOKEN_HASHES` الذي يوضع في `adreem.env`، وسطر `ADREEM_TELEGRAM_LEDGER_IDS` عند وجود Telegram user id.

في الإنتاج يجب ضبط `ADREEM_WEB_ALLOWED_ORIGIN` على رابط GitHub Pages الفعلي، مثل:

```text
https://aneerabee.github.io
```

عند ضبط `VITE_ADREEM_API_URL` في الويب، يستخدم التطبيق API فقط إذا فتح المستخدم الرابط برمز خاص في hash:

```text
https://aneerabee.github.io/adreem/#ledger_token=token-rabee
```

إذا كان `VITE_ADREEM_API_URL` موجودًا ولا يوجد token، لا يرجع الويب إلى Supabase anon؛ يعمل محليًا فقط إلى أن يدخل token صحيح.

في الإنتاج:

- شغّل API خلف HTTPS فقط.
- شغّله بـ `NODE_ENV=production`.
- لا تضع token داخل `VITE_ADREEM_API_URL`; هذا المتغير URL عام فقط.
- استخدم tokens طويلة وعشوائية، وضع hash فقط داخل `ADREEM_WEB_LEDGER_TOKEN_HASHES`.
- ضع rate limiting في طبقة reverse proxy أو firewall أمام API.

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
