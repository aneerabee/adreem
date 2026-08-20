# ADREEM Operational Runbook

## الهدف

تشغيل ADREEM بشكل سحابي آمن:

- الويب وواجهة API للنسخة الثالثة خلف أصل HTTPS واحد.
- API خاص يحفظ ويقرأ من Supabase عبر service role فقط.
- Telegram Bot يعمل كخدمة systemd مستقلة.
- لا توجد مفاتيح Supabase أو Telegram داخل بناء الويب أو Git.
- رموز دخول Supabase تبقى داخل ملفات ارتباط `Secure` و`HttpOnly` ولا تصل إلى JavaScript.

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

استخدم مشروع Supabase مخصصًا لـ ADREEM، واربط أداة Supabase بالمشروع الصحيح ثم طبّق سجل الترحيلات بدل `supabase/schema.sql` القديم:

```bash
supabase link --project-ref YOUR_ADREEM_PROJECT_REF
supabase migration list --linked
supabase db push --linked
supabase migration list --linked
```

لا تفتح النسخة الثالثة قبل أن تعرض القائمة البعيدة الترحيلات التالية كمطبّقة بالترتيب نفسه:

```text
20260820213621_lock_down_adreem_ml_state.sql
20260820213622_create_private_adreem_attachments_bucket.sql
20260820213624_enforce_ml_state_timestamps.sql
20260820213626_create_adreem_v3_schema.sql
20260820213628_create_adreem_v3_ledger_functions.sql
20260820213629_add_adreem_bot_state_claim_cas.sql
20260820213631_add_adreem_bot_effect_cas.sql
20260820213833_remove_empty_legacy_state_from_v3.sql
```

الترحيل الأخير يحذف جداول التوافق القديمة من المشروع المستقل فقط بعد إثبات أنها فارغة، ويرفض التنفيذ إذا وجد أي صف.

لا تشغّل ملفات الترحيل منفردة خارج سجل Supabase، ولا تستخدم `supabase/schema.sql` لتجهيز النسخة الثالثة. بعد تطبيقها نفّذ ترحيل البيانات وفق `docs/adreem-v3-migration.md` وافحص النتيجة قبل التحويل.

## شرط النشر للنسخة الثالثة

لا تشغّل النسخة الثالثة من `https://aneerabee.github.io` مع API على نطاق آخر. هذا توزيع متعدد الأصول، ولا يضمن استقبال ملف الارتباط عند أول دخول من الصفحة الحالية. وضع الإنتاج يفشل عند التشغيل إذا اختلف `ADREEM_WEB_ALLOWED_ORIGIN` عن `ADREEM_API_PUBLIC_ORIGIN` بدل الرجوع إلى تخزين الرموز في المتصفح.

انشر الويب وAPI خلف أصل واحد، مثل:

```text
https://adreem.example.com/
https://adreem.example.com/api/
```

يبقى GitHub Pages صالحًا للوضع القديم قبل القطع فقط. سير العمل `.github/workflows/deploy.yml` لا يعمل عند دفع الكود؛ تشغيله يدوي ويتطلب تأكيد `deploy_legacy`، كما يرفض التنفيذ ما لم تكن متغيرات المستودع `ADREEM_WEB_RUNTIME_MODE=legacy` و`ADREEM_LEGACY_PAGES_DEPLOY=true`. غياب أي شرط أو ضبط الوضع على `v3` يوقف النشر. عند التحويل إلى النسخة الثالثة لا تستخدم GitHub Pages؛ الملفات النهائية وAPI يجب أن يقدمهما النطاق نفسه.

بناء النسخة الثالثة للأصل الموحد:

```bash
ADREEM_WEB_DEPLOY_TARGET=same-origin \
ADREEM_WEB_RUNTIME_MODE=v3 \
ADREEM_WEB_PUBLIC_ORIGIN=https://adreem.example.com \
VITE_ADREEM_API_URL=https://adreem.example.com \
pnpm verify:web-env

VITE_BASE_PATH=/ \
VITE_DEFAULT_APP=adreem \
VITE_ADREEM_API_URL=https://adreem.example.com \
pnpm build
```

إعداد خادم النسخة الثالثة:

```text
NODE_ENV=production
ADREEM_AUTH_MODE=supabase
ADREEM_WEB_ALLOWED_ORIGIN=https://adreem.example.com
ADREEM_API_PUBLIC_ORIGIN=https://adreem.example.com
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
ADREEM_TELEGRAM_DURABLE_STATE=true
# اختياري، الافتراضي 30 يومًا
ADREEM_AUTH_REFRESH_MAX_AGE_SECONDS=2592000
```

اكتب الأصل بلا شرطة مائلة أخيرة وبلا مسار. يجب أن ينهي الوكيل HTTPS وأن يمرر `Set-Cookie` كما هو. لا تضف `Domain` إلى ملفات الارتباط ولا تغيّر `Path=/`.

لا تضف `VITE_SUPABASE_URL` أو `VITE_SUPABASE_ANON_KEY` إلى بناء الإنتاج.

`VITE_ADREEM_API_URL` في نشر الأصل الموحد هو الأصل نفسه بلا `/api`، لأن الواجهة تضيف مسارات `/api/...` إلى هذه القيمة. لا تضع فيه رمزًا أو مفتاحًا.

يحتفظ المتصفح فقط بالقيمة غير السرية `cookie-v3` لمعرفة أن شاشة الدفتر يجب أن تُفتح. لا تحتوي `localStorage` أو `sessionStorage` على رمز وصول أو تجديد في النسخة الثالثة.

## Caddy للأصل الموحد

الملف `deploy/Caddyfile.adreem.example` مثال إنتاجي مستقل، ولا يغيّر إعداد Caddy الحي. استبدل `adreem.example.com` بالنطاق الحقيقي وتأكد أن مسار `root` يطابق مجلد `dist`. المثال:

- يقدّم ملفات `dist` مع رجوع تطبيق الصفحة الواحدة إلى `index.html`.
- يمرّر `/api` و`/api/*` و`/health` و`/ready` إلى `127.0.0.1:8787` مع إبقاء المسار كما هو.
- يمنع تخزين ردود API ويضيف رؤوس النقل الصارم وسياسة المحتوى ومنع الإطارات والتخمين.

تحقق من المثال بعد تعديل نسخة مؤقتة منه، وقبل دمجه في إعداد الخادم:

```bash
caddy fmt --diff /tmp/Caddyfile.adreem
caddy validate --config /tmp/Caddyfile.adreem --adapter caddyfile
```

ابنِ `dist` بإعدادات الأصل الموحد أعلاه، ثم ادمج كتلة ADREEM في ملف Caddy الحي مع الاحتفاظ بنسخة رجوع. لا تستبدل ملفًا حيًا كاملًا بالمثال. قبل إعادة التحميل وبعد الدمج:

```bash
curl -fsS http://127.0.0.1:8787/health
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

اختبر النطاق قبل تحويل DNS أو بعده. غيّر العنوان إلى عنوان الخادم العام عند الحاجة:

```bash
curl --resolve adreem.example.com:443:SERVER_PUBLIC_IP -fsS https://adreem.example.com/health
curl --resolve adreem.example.com:443:SERVER_PUBLIC_IP -i https://adreem.example.com/ready
curl --resolve adreem.example.com:443:SERVER_PUBLIC_IP -sSI https://adreem.example.com/
curl --resolve adreem.example.com:443:SERVER_PUBLIC_IP -i https://adreem.example.com/api/profile
```

يجب أن تنجح `/health`، وأن تعكس `/ready` جاهزية قاعدة البيانات، وأن يحمل رد الصفحة رؤوس الأمان. طلب `/api/profile` بلا جلسة يجب أن يصل إلى الخدمة المحلية ويُرفض بالمصادقة، لا أن يعيد `index.html`.

لتمكين فحص التشغيل الكامل من السيرفر، ضع حساب اختبار حقيقي في registry:

```text
ADREEM_RUNTIME_TEST_EMAIL=owner@example.com
ADREEM_RUNTIME_TEST_PASSWORD=owner-password
```

هذه المتغيرات تبقى على السيرفر فقط. فاحص التشغيل الحالي المعتمد على ترويسة الرمز مناسب للوضع القديم، وليس إثباتًا لجلسة النسخة الثالثة. افحص النسخة الثالثة بطلب يحفظ ملفي الارتباط أو من متصفح حقيقي على الأصل النهائي. استخدم مستخدم مراقبة مخصصًا ودفترًا معزولًا، لا حساب مستخدم حقيقي.

## الأمان أمام API

- شغّل API بـ `NODE_ENV=production`.
- اضبط `ADREEM_WEB_ALLOWED_ORIGIN` و`ADREEM_API_PUBLIC_ORIGIN` على أصل HTTPS نفسه بالضبط.
- اجعل API خلف HTTPS فقط.
- دخول المستخدمين يتم بالإيميل وكلمة المرور من صفحة ADREEM العادية.
- جلسة النسخة الثالثة تضع رمز الوصول والتجديد في ملفي ارتباط `Secure; HttpOnly; SameSite=Strict`، وتجدد الرمزين داخل API دون إعادتهما في JSON.
- كل رد CORS يسمح بالاعتمادات لأصل واحد مضبوط فقط، وكل طلب متصفح من أصل مخالف يُرفض قبل المصادقة.
- يستمر الدخول عبر ملف ارتباط التجديد حتى تسجيل الخروج أو انتهاء مدة الجلسة أو حذف بيانات الموقع.
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
https://adreem.example.com/?admin=users
```

الإدارة لا تستخدم توكنًا يدويًا. ادخل أولًا بحساب المالك بالإيميل وكلمة المرور، ثم افتح رابط الإدارة أو زر `إدارة` من واجهة ADREEM.

من الصفحة:

- اكتب اسم المستخدم.
- اكتب إيميل المستخدم.
- اكتب كلمة مرور 8 أحرف على الأقل.
- اكتب كود دفتر إنجليزي واضح مثل `main-ledger` أو `business-book`.
- ضع رقم تيليغرام اختياريًا فقط إذا كان هذا المستخدم سيستعمل البوت.
- بعد الإنشاء يدخل المستخدم من رابط الأصل الموحد، مثل `https://adreem.example.com/`.

أي مستخدم غير مضاف لا يستطيع الدخول للدفتر، لكنه يرى رقم تيليغرام الخاص به فقط حتى يرسله لك. لا تفعّل وضع "الجميع مسموح" للدفتر المالي؛ هذا يكسر العزل.

الأوامر المتبقية من داخل البوت:

```text
/myid
/users
```

البوت لا ينشئ مستخدمين. عند إضافة مستخدم من صفحة الإدارة تُحفظ كلمة المرور كـ hash فقط داخل `ADREEM_TELEGRAM_USERS_FILE`، والـ API يقرأ هذا الملف عند كل طلب، لذلك لا تحتاج لإعادة تشغيل API بعد إضافة مستخدم جديد.

## systemd

اترك `TELEGRAM_SKIP_OLD_UPDATES=false` في التشغيل الحقيقي. تفعيله يحذف الرسائل التي وصلت أثناء توقف البوت عند أول تشغيل، ويُستخدم فقط عند إنشاء بوت جديد بلا بيانات تشغيلية.

### توافق Node

- النسخة الثالثة من API والبوت تعمل على Node `22.23.2` المثبت في `/home/argaz/.local/node-v22.23.2/bin/node`.
- وحدتا systemd تستدعيان هذا المسار نفسه مباشرة؛ حدّث الوحدتين والدليل معًا عند ترقية Node.
- `pnpm` غير مطلوب وقت تشغيل الخدمتين. نفّذ البناء والاختبارات محليًا أو في التكامل المستمر، ولا تفترض أن الخادم مناسب للبناء.

قبل أي تحديث تشغيلي، افحص النسخ دون تغيير الخدمة:

```bash
pnpm --version
/home/argaz/.local/node-v22.23.2/bin/node --version
systemctl --version
```

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

الوحدتان تمنعان اكتساب صلاحيات جديدة ومساحات الأسماء غير اللازمة، وتبقيان الشبكة والكتابة داخل مجلد المستخدم متاحتين. تم اختبار القيود فعليًا بوحدة مستخدم مؤقتة على الخادم الحالي. لا تضف قيود إسقاط صلاحيات النواة مثل `PrivateDevices=true` إلى وحدات المستخدم الحالية؛ مدير الخدمات يفشل معها برمز `218/CAPABILITIES`. أعد تقييمها فقط عند الانتقال إلى وحدات نظام.

لا تضف `ProtectHome=true` لأن ملفات المستخدمين والنسخ الاحتياطية وسجل التدقيق محفوظة تحت `/home/argaz`، ولا تضف `MemoryDenyWriteExecute=true` لأنه غير مناسب لمحرك Node.

تحقق من الوحدات قبل نسخها، ثم راجع مستوى الحماية بعد التثبيت:

```bash
systemd-analyze verify deploy/systemd/adreem-api.service
systemd-analyze verify deploy/systemd/adreem-bot.service
systemd-analyze security --user adreem-api.service adreem-bot.service
```

## تدوير السجلات

ملف `deploy/logrotate/adreem` يحتفظ بـ14 دورة لسجلات الخدمتين و30 دورة لسجل التدقيق، مع ضغط وصلاحية `0600`. سجلات الخدمتين تستخدم النسخ ثم التفريغ لأن systemd يبقي الملفات مفتوحة؛ سجل التدقيق لا يستخدم ذلك لأن التطبيق يفتح الملف عند كل كتابة.

ثبّت الإعداد كمسؤول نظام ثم افحصه دون إجبار التدوير:

```bash
sudo install -o root -g root -m 0644 deploy/logrotate/adreem /etc/logrotate.d/adreem
sudo logrotate --debug /etc/logrotate.d/adreem
```

لا يحتاج تدوير السجلات إلى إعادة تشغيل API أو البوت.

## فحص التشغيل

بعد تشغيل API:

```bash
systemctl --user status adreem-api.service --no-pager
systemctl --user status adreem-bot.service --no-pager
```

شغّل `pnpm verify:runtime` للوضع القديم فقط إلى أن يصبح الفاحص قادرًا على حفظ ملفات الارتباط. في النسخة الثالثة نفّذ فحص دخول حقيقي من رابط الإنتاج، ثم تأكد من نجاح تحميل الدفتر وتجديد الصفحة والخروج، ومن غياب الرموز عن تخزين المتصفح.

إذا فشل SSH من الجهاز المحلي، لا تعتبر حالة Contabo مؤكدة. آخر كلمة حاسمة يجب أن تأتي من `systemctl` و `/health` على السيرفر نفسه.

## دخول المستخدم

الرابط العام:

```text
https://adreem.example.com/
```

في الإنتاج، إذا لم توجد علامة جلسة يظهر نموذج الإيميل وكلمة المرور. بعد الدخول يفتح الويب دفتر المستخدم المعزول حسب `ledgerId`. علامة المتصفح ليست اعتماد دخول؛ ملفات الارتباط المحمية وحدها تثبت الجلسة أمام API.

روابط `#ledger_token=` القديمة غير معتمدة للتشغيل الجديد. استخدم تسجيل الدخول من صفحة ADREEM.

## قاعدة عدم الحذف الفعلي

ADREEM لا يعتمد على حذف السجلات واحدة بواحدة أثناء التشغيل اليومي. أي إلغاء أو إخفاء يجب أن يبقى كسجل حالة:

- الحركة تصبح `voided`.
- الحساب يصبح `inactive`.
- قاعدة التكرار تصبح `inactive` مع `disabledAt`.
- الاسترجاع أو الدمج لا يفترض أن حذف عنصر من جهاز يعني حذفه من كل الأجهزة.

الحذف الفعلي مسموح فقط في reset كامل للدفتر بعد backup واضح، لأن الدمج بين المحلي والسحابي مصمم لحماية السجلات من الفقد وليس لمزامنة deletes صامتة.
