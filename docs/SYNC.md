# مزامنة أونلاين / أوفلاين — مرحلة 1

## النطاق المؤكد

- جهاز ديسكتوب واحد (كاتب أساسي) لكل فرع يعمل أوفلاين.
- الويب أونلاين فقط؛ زر «تحميل الديسكتوب» في الهيدر وشاشة الدخول.
- سياسة تعارض: **آخر كتابة تفوز** + سجل `SyncConflict` للمراجعة.

## الكيانات

Customer, Supplier, Product (+ tradeUnits), StockBalance, SalesInvoice (+ lines), PurchaseInvoice (+ lines), Expense, CashAccount.

## تدفق العمل

1. المستخدم يفتح الويب بالنت → يحمّل Setup من `/api/desktop/download`.
2. يثبت الديسكتوب → يعمل على SQLite محلي.
3. من شريط المزامنة: يضبط `cloudUrl` + `SYNC_API_KEY`.
4. «تحميل أولي» يسحب من السحابة؛ «مزامنة» تدفع التغييرات المحلية وتسحب البعيد.

## API

| المسار | الوصف |
|--------|--------|
| `GET /api/sync/status` | حالة الاتصال والطابور |
| `POST /api/sync/configure` | حفظ رابط السحابة |
| `POST /api/sync/run` | دورة push + pull |
| `POST /api/sync/bootstrap` | سحب أولي |
| `POST /api/sync/seed-outbox` | صف كل الصفوف الحالية للطابور |
| `POST /api/sync/push` | السحابة تستقبل (مفتاح `x-sync-key`) |
| `GET /api/sync/pull` | السحابة تصدّر التغييرات |
| `GET /api/desktop/download` | تنزيل المثبّت |

## متغيرات البيئة

انظر [`.env.example`](../.env.example) و[`docs/DEPLOY.md`](./DEPLOY.md).
