# نشر Green Zone أونلاين (VPS)

## نطاق المرحلة 1 (مؤكد)

- **كاتب أوفلاين أساسي لكل فرع/جهاز**: جهاز ديسكتوب واحد يكتب أوفلاين ويتزامن مع السحابة.
- أجهزة إضافية تكتب أوفلاين على نفس الفرع = مرحلة 2 (تعارضات أدق).
- **الويب أونلاين فقط**. بدون نت → المتصفح مش هيفتح؛ المستخدم يفتح الديسكتوب.

## الاستضافة المعتمدة

| المكوّن | الاختيار |
|--------|----------|
| السيرفر | VPS (Ubuntu) + Docker Compose من [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) |
| قاعدة البيانات | SQLite على volume محلي، أو **Turso** (`TURSO_DATABASE_URL`) المتوافق مع Prisma الحالي |
| الدومين | يشير لـ HTTPS عبر Nginx/Caddy أمام المنفذ 3001 |
| تحميل الديسكتوب | ملف `Setup.exe` في `/downloads/` أو رابط `DESKTOP_DOWNLOAD_URL` |

> Postgres مؤجّل: المخطط الحالي SQLite/Turso. التحويل لـ Postgres خطوة منفصلة لاحقًا.

## خطوات سريعة على VPS

```bash
git clone <repo> greenzone && cd greenzone
cp .env.example .env
# عدّل JWT_SECRET و DESKTOP_DOWNLOAD_URL
cd deploy && docker compose up -d --build
```

ضع شهادة HTTPS (Caddy مثال):

```
greenzone.example.com {
  reverse_proxy localhost:3001
}
```

ارفع المثبّت إلى `apps/web/public/downloads/GreenZone-Setup.exe` قبل البناء، أو اضبط:

```
DESKTOP_DOWNLOAD_URL=https://github.com/wesamwalid1/green-zone/releases/latest/download/GreenZone-Setup.exe
```

## ربط الديسكتوب بالسحابة

1. ثبّت البرنامج من زر «تحميل نسخة سطح المكتب» في الويب.
2. من شريط المزامنة أو إعدادات الاتصال: أدخل رابط السيرفر السحابي (مثل `https://greenzone.example.com`).
3. سجّل الدخول بنفس الحساب؛ عند رجوع النت تُدفع التغييرات المحلية وتُجلب تحديثات السحابة.
