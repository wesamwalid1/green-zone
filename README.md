# مخازن — نظام ERP لإدارة المخازن

نظام محلي للشركة (ويب + ديسكتوب عبر Tauri 2) لإدارة المخازن والمبيعات والمشتريات والخزنة والمرتجعات والتقارير.

## المتطلبات

- Node.js 20+
- Rust (للديسكتوب فقط) — [rustup.rs](https://rustup.rs)
- Windows: Microsoft Visual C++ Build Tools + WebView2 (عادة موجود)

## التشغيل السريع

```bash
npm install
cd apps/api
npx prisma db push
npx tsx prisma/seed.ts
```

ثم في طرفيتين:

```bash
# السيرفر المحلي
npm run dev:api

# الواجهة الويب
npm run dev:web
```

افتح: http://localhost:5173

**دخول افتراضي:** `admin` / `admin123`

## الديسكتوب (Tauri 2)

تأكد أن الـ API شغال، ثم:

```bash
npm run dev:desktop
```

لبناء مثبت Windows:

```bash
npm run build:desktop
```

الملف الناتج في: `apps/desktop/src-tauri/target/release/bundle/`

## هيكل المشروع

```
apps/api       — NestJS + Prisma + SQLite
apps/web       — React + Vite + Tailwind (عربي RTL)
apps/desktop   — Tauri 2 يغلف نفس الواجهة
packages/shared — أنواع مشتركة
```

## الوحدات

- لوحة التحكم
- المخازن (مع حقول/أعمدة مخصصة)
- الأصناف والمخزون والتحويل
- الموردين والعملاء + كشوف حساب ملونة
- الخزنة (وارد/صادر/تحصيل/سداد)
- المبيعات والمشتريات
- المرتجعات
- التقارير + طباعة/PDF + Excel
- إعدادات + نسخ احتياطي لقاعدة البيانات

## الشبكة المحلية

1. شغّل الـ API على جهاز السيرفر: `npm run start -w @m5azen/api`
2. من الأجهزة الأخرى أو الديسكتوب: في شاشة الدخول أو الإعدادات ضع عنوان مثل `http://192.168.1.10:3001`

## قاعدة البيانات

يستخدم SQLite محلياً (`apps/api/prisma/dev.db`) لسهولة التثبيت والنسخ الاحتياطي بدون سيرفر منفصل.
