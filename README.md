# ADREEM

دفتر مالي مستقل متعدد المستخدمين للويب وTelegram. الحسابات والحركات والمرفقات معزولة لكل مالك، ويستخدم الويب والبوت منطق الدفتر نفسه.

## الحالة

- النسخة الحية الحالية القديمة: https://aneerabee.github.io/adreem/
- المستودع: https://github.com/aneerabee/adreem
- مشروع Supabase مستقل للنسخة الثالثة موجود ومخططه مطبق، لكنه لا يصبح إنتاجيًا قبل نقل البيانات والتحقق منها وتجربة النسخ والاسترجاع.
- النسخة الثالثة يجب أن تقدم الويب وواجهة API من أصل HTTPS واحد. لا تُنشر على GitHub Pages مع API في نطاق آخر.

تابع الحالة الفعلية في [docs/adreem-implementation-progress.md](docs/adreem-implementation-progress.md).

## التشغيل المحلي

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## الفحص

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm lint
pnpm audit --prod
```

لبناء النسخة الثالثة يلزم تحديد أصل واحد صريح:

```bash
VITE_ADREEM_API_URL=https://adreem.example.com \
ADREEM_WEB_DEPLOY_TARGET=same-origin \
ADREEM_WEB_RUNTIME_MODE=v3 \
ADREEM_WEB_PUBLIC_ORIGIN=https://adreem.example.com \
VITE_BASE_PATH=/ \
pnpm build
```

## قاعدة البيانات

النسخة الثالثة تستخدم مشروع Supabase مخصصًا لـ ADREEM وجداول منفصلة للحسابات والحركات والقيود والمرفقات. كل صف يحمل صاحب الدفتر ومعرفه، وسياسات عزل الصفوف مفروضة داخل قاعدة البيانات.

طبّق سجل `supabase/migrations/` كاملًا حسب ترتيب أسماء الملفات. لا تستخدم `supabase/schema.sql` القديم لتجهيز النسخة الثالثة.

تفاصيل النقل الآمن: [docs/adreem-v3-migration.md](docs/adreem-v3-migration.md).

## الويب

واجهة API للنسخة الثالثة:

```bash
pnpm api:adreem
```

الدخول يستخدم Supabase Auth. رموز الجلسة تبقى في ملفات ارتباط محمية على الخادم، ولا تحفظ في JavaScript أو تخزين المتصفح. أي حساب لا يحمل عضوية ADREEM صريحة أو غير مفعّل يُرفض.

قالب الإعداد: [deploy/adreem.env.example](deploy/adreem.env.example).

## البوت

```bash
pnpm bot:adreem
```

في النسخة الثالثة يرتبط رقم Telegram بملف المستخدم ودفتره داخل قاعدة ADREEM. حالة الخطوات، مؤشر التحديث، ومطالبات المعالجة تحفظ في قاعدة البيانات مع حجز ذري يمنع تنفيذ التحديث مرتين بعد إعادة التشغيل.

إنشاء المستخدمين وإيقافهم يتم من صفحة إدارة الويب، وليس من محادثة البوت.

## النسخ والاسترجاع

النسخة الاحتياطية مشفرة قبل خروجها من الخادم وتشمل قاعدة البيانات والمرفقات. الاسترجاع مخصص لهدف فارغ، يعيد المرفقات ويتحقق من الحجم والبصمة، ويتراجع عن الرفع الجزئي عند الفشل.

```bash
pnpm ops:backup
pnpm ops:backup:execute
pnpm ops:restore-drill
```

التجهيز والتشغيل: [docs/adreem-backup-restore.md](docs/adreem-backup-restore.md).

## النشر

- شغّل API والبوت على Node.js 22.
- قدّم ملفات `dist` و`/api` من أصل واحد. يوجد مثال في [deploy/Caddyfile.adreem.example](deploy/Caddyfile.adreem.example).
- احتفظ بجميع الأسرار خارج Git وبصلاحية ملف `600`.
- لا تحوّل الخدمة الحية قبل نجاح النقل، المقارنة، النسخة الخارجية، وتجربة الاسترجاع.

دليل التشغيل: [docs/adreem-operational-runbook.md](docs/adreem-operational-runbook.md).
