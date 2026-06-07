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

لتمكين فحص التشغيل الكامل من السيرفر بدون وضع التوكن الخام في خريطة الدفاتر، ضع التوكن الحقيقي في:

```text
ADREEM_RUNTIME_TEST_TOKEN=YOUR_LONG_TOKEN
```

هذا المتغير يبقى على السيرفر فقط، ويستخدمه `npm run verify:runtime` لاختبار `/api/ledger`.

## الأمان أمام API

- شغّل API بـ `NODE_ENV=production`.
- اضبط `ADREEM_WEB_ALLOWED_ORIGIN=https://aneerabee.github.io`.
- اجعل API خلف HTTPS فقط.
- دخول المستخدمين يتم بالإيميل وكلمة المرور من صفحة ADREEM العادية.
- جلسة الدخول تولّد token مؤقتًا داخل `sessionStorage` فقط، ولا يُعطى للمستخدم رابط token.
- `ADREEM_WEB_LEDGER_TOKEN_HASHES` يبقى للتوافق وفحص التشغيل فقط، وليس طريقة إنشاء المستخدمين الجديدة.
- صيغة `ADREEM_WEB_LEDGER_TOKENS` ما زالت مدعومة مؤقتًا للتوافق، لكنها ليست الصيغة المعتمدة للدفاتر الجديدة.
- ضع rate limiting في reverse proxy أو firewall لأن API نفسه بسيط ومباشر.
- عند فقدان كلمة مرور مستخدم، أنشئ له كلمة مرور جديدة من صفحة الإدارة بنفس كود الدفتر.

إنشاء hash للتوكن:

```bash
node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('YOUR_LONG_TOKEN').digest('hex'))"
```

أو استخدم أداة ADREEM لتوليد دفتر مستقل كامل:

```bash
npm run ops:create-ledger-access -- --ledger=saeed-book --telegram=555
```

قاعدة العزل: كل مستخدم يحصل على `ledgerId` خاص ويدخل بالإيميل وكلمة المرور. لا تعطي مستخدمين مختلفين نفس `ledgerId`. إدارة المستخدمين تتم من صفحة إدارة ADREEM، وليس من أوامر التلقرام.

## إضافة مستخدم من صفحة الإدارة

اضبط في `adreem.env`:

```text
ADREEM_ADMIN_TOKEN_HASHES=SHA256_OF_ADMIN_TOKEN
ADREEM_TELEGRAM_ADMIN_IDS=YOUR_TELEGRAM_ID
ADREEM_TELEGRAM_USERS_FILE=/home/argaz/apps/adreem/adreem-telegram-users.json
```

رابط الإدارة:

```text
https://aneerabee.github.io/adreem/#admin_token=YOUR_ADMIN_TOKEN
```

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

في الإنتاج، إذا لم توجد جلسة دخول يظهر نموذج الإيميل وكلمة المرور. بعد الدخول يفتح الويب دفتر المستخدم المعزول حسب `ledgerId`.

روابط `#ledger_token=` القديمة مدعومة مؤقتًا للتوافق فقط، ولا تُستخدم لإنشاء مستخدمين جدد.

## قاعدة عدم الحذف الفعلي

ADREEM لا يعتمد على حذف السجلات واحدة بواحدة أثناء التشغيل اليومي. أي إلغاء أو إخفاء يجب أن يبقى كسجل حالة:

- الحركة تصبح `voided`.
- الحساب يصبح `inactive`.
- قاعدة التكرار تصبح `inactive` مع `disabledAt`.
- الاسترجاع أو الدمج لا يفترض أن حذف عنصر من جهاز يعني حذفه من كل الأجهزة.

الحذف الفعلي مسموح فقط في reset كامل للدفتر بعد backup واضح، لأن الدمج بين المحلي والسحابي مصمم لحماية السجلات من الفقد وليس لمزامنة deletes صامتة.
