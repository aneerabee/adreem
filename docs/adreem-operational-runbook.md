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

## الأمان أمام API

- شغّل API بـ `NODE_ENV=production`.
- اضبط `ADREEM_WEB_ALLOWED_ORIGIN=https://aneerabee.github.io`.
- اجعل API خلف HTTPS فقط.
- استخدم token طويل وعشوائي لكل دفتر داخل `ADREEM_WEB_LEDGER_TOKENS`.
- ضع rate limiting في reverse proxy أو firewall لأن API نفسه بسيط ومباشر.
- عند فقدان رابط token، غيّره في `ADREEM_WEB_LEDGER_TOKENS` وأعد تشغيل `adreem-api.service`.

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

## الرابط الخاص

يفتح الويب الدفتر السحابي فقط عند وجود token:

```text
https://aneerabee.github.io/adreem/#ledger_token=YOUR_TOKEN
```

بدون token يعمل الويب محليًا فقط ولا يقرأ من Supabase.

## قاعدة عدم الحذف الفعلي

ADREEM لا يعتمد على حذف السجلات واحدة بواحدة أثناء التشغيل اليومي. أي إلغاء أو إخفاء يجب أن يبقى كسجل حالة:

- الحركة تصبح `voided`.
- الحساب يصبح `inactive`.
- قاعدة التكرار تصبح `inactive` مع `disabledAt`.
- الاسترجاع أو الدمج لا يفترض أن حذف عنصر من جهاز يعني حذفه من كل الأجهزة.

الحذف الفعلي مسموح فقط في reset كامل للدفتر بعد backup واضح، لأن الدمج بين المحلي والسحابي مصمم لحماية السجلات من الفقد وليس لمزامنة deletes صامتة.
