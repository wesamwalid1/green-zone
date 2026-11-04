// Fills the system with realistic business data through the real API so stock,
// cash, balances and ledger stay consistent. Safe to re-run: it stops if the
// demo warehouses already exist.
// Usage: node scripts/seed-demo.mjs [baseUrl]
const BASE = (process.argv[2] || process.env.M5AZEN_URL || 'http://localhost:3001').replace(/\/$/, '') + '/api';

let seed = 20261009;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => Math.floor(min + rand() * (max - min + 1));

let token = '';
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function daysAgo(n, hour = 11) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, between(0, 59), 0, 0);
  return d.toISOString();
}

const WAREHOUSES = [
  { code: 'WH02', name: 'فرع الإسكندرية', location: 'الإسكندرية - سموحة', description: 'مخزن الفرع الساحلي' },
  { code: 'WH03', name: 'فرع المنصورة', location: 'المنصورة - شارع الجمهورية', description: 'مخزن الدلتا' },
];

const CATEGORIES = ['لابتوب وكمبيوتر', 'شاشات', 'إكسسوارات', 'شبكات', 'تخزين', 'طابعات', 'موبايلات'];

const PRODUCTS = [
  ['LAP-001', 'لابتوب Dell Latitude 5440 i5', 'Dell', 'لابتوب وكمبيوتر', 26500, 31000, 29500, 5],
  ['LAP-002', 'لابتوب HP ProBook 450 G10', 'HP', 'لابتوب وكمبيوتر', 24800, 29000, 27600, 5],
  ['LAP-003', 'لابتوب Lenovo ThinkPad E14', 'Lenovo', 'لابتوب وكمبيوتر', 27200, 32500, 30800, 4],
  ['LAP-004', 'لابتوب ASUS Vivobook 15', 'ASUS', 'لابتوب وكمبيوتر', 17900, 21500, 20300, 6],
  ['PC-001', 'كمبيوتر مكتبي Core i7 الجيل 13', 'AK Tech', 'لابتوب وكمبيوتر', 31000, 36500, 34800, 3],
  ['MON-001', 'شاشة Samsung 24 بوصة FHD', 'Samsung', 'شاشات', 4300, 5400, 5050, 10],
  ['MON-002', 'شاشة LG 27 بوصة IPS', 'LG', 'شاشات', 6900, 8400, 7900, 8],
  ['MON-003', 'شاشة Dell 32 بوصة 4K', 'Dell', 'شاشات', 15200, 18500, 17400, 3],
  ['ACC-001', 'ماوس Logitech M185 لاسلكي', 'Logitech', 'إكسسوارات', 310, 450, 400, 40],
  ['ACC-002', 'كيبورد Logitech K120', 'Logitech', 'إكسسوارات', 360, 520, 470, 30],
  ['ACC-003', 'سماعة رأس HyperX Cloud II', 'HyperX', 'إكسسوارات', 2900, 3700, 3450, 10],
  ['ACC-004', 'كاميرا ويب Logitech C920', 'Logitech', 'إكسسوارات', 2600, 3350, 3100, 8],
  ['ACC-005', 'حقيبة لابتوب 15.6 بوصة', 'Targus', 'إكسسوارات', 520, 790, 700, 25],
  ['NET-001', 'راوتر TP-Link Archer AX55', 'TP-Link', 'شبكات', 2700, 3450, 3200, 10],
  ['NET-002', 'سويتش TP-Link 8 منفذ جيجابت', 'TP-Link', 'شبكات', 690, 950, 870, 15],
  ['NET-003', 'كابل شبكة Cat6 بكرة 305 متر', 'D-Link', 'شبكات', 3100, 3900, 3650, 5],
  ['STO-001', 'هارد SSD Samsung 1TB NVMe', 'Samsung', 'تخزين', 3300, 4150, 3900, 15],
  ['STO-002', 'هارد خارجي WD 2TB', 'WD', 'تخزين', 2800, 3550, 3300, 12],
  ['STO-003', 'فلاشة SanDisk 64GB', 'SanDisk', 'تخزين', 190, 290, 255, 60],
  ['PRN-001', 'طابعة HP LaserJet M211dw', 'HP', 'طابعات', 7400, 8900, 8400, 4],
  ['PRN-002', 'حبر HP 136A أصلي', 'HP', 'طابعات', 1650, 2150, 1990, 15],
  ['MOB-001', 'موبايل Samsung Galaxy A55', 'Samsung', 'موبايلات', 15800, 18200, 17400, 6],
  ['MOB-002', 'موبايل Xiaomi Redmi Note 13', 'Xiaomi', 'موبايلات', 9100, 10800, 10300, 8],
  ['MOB-003', 'شاحن Anker سريع 65 وات', 'Anker', 'موبايلات', 1150, 1550, 1420, 20],
];

const SUPPLIERS = [
  ['SUP-101', 'الشركة المصرية للحاسبات', '01001234567', 'القاهرة - مدينة نصر'],
  ['SUP-102', 'رايه للتوزيع', '01112345678', 'القاهرة - التجمع الخامس'],
  ['SUP-103', 'المتحدة للإلكترونيات', '01223456789', 'الجيزة - الدقي'],
  ['SUP-104', 'نور للشبكات والاتصالات', '01098765432', 'الإسكندرية - سيدي جابر'],
  ['SUP-105', 'الأهرام لمستلزمات المكاتب', '01287654321', 'القاهرة - وسط البلد'],
];

const CUSTOMERS = [
  ['CUS-101', 'شركة النيل للمقاولات', '01005551234', 'القاهرة - المعادي', 250000, 'WHOLESALE'],
  ['CUS-102', 'مدارس المستقبل الخاصة', '01115552345', 'الجيزة - 6 أكتوبر', 200000, 'WHOLESALE'],
  ['CUS-103', 'مكتب الفا للمحاسبة', '01225553456', 'القاهرة - مصر الجديدة', 0, 'RETAIL'],
  ['CUS-104', 'صيدليات الشفاء', '01015554567', 'الإسكندرية - سموحة', 150000, 'WHOLESALE'],
  ['CUS-105', 'أحمد محمود السيد', '01125555678', 'المنصورة - توريل', 0, 'RETAIL'],
  ['CUS-106', 'مستشفى الرحمة', '01235556789', 'المنصورة - الجلاء', 300000, 'WHOLESALE'],
  ['CUS-107', 'كافيه سنترال', '01065557890', 'القاهرة - الزمالك', 0, 'RETAIL'],
  ['CUS-108', 'شركة دلتا للشحن', '01155558901', 'طنطا - شارع البحر', 180000, 'WHOLESALE'],
  ['CUS-109', 'منى عبد الرحمن', '01275559012', 'الإسكندرية - ميامي', 0, 'RETAIL'],
  ['CUS-110', 'مركز الأمل للتدريب', '01095550123', 'القاهرة - شبرا', 0, 'RETAIL'],
  ['CUS-111', 'فندق البحر الأحمر', '01145551357', 'الغردقة - السقالة', 220000, 'WHOLESALE'],
  ['CUS-112', 'محمد إبراهيم حسن', '01265552468', 'الجيزة - الهرم', 0, 'RETAIL'],
];

async function main() {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.accessToken;

  const existingWh = await call('GET', '/warehouses');
  if (existingWh.some((w) => w.code === 'WH02')) {
    console.log('Demo data already present, nothing to do.');
    return;
  }

  const mainWh = existingWh.find((w) => w.code === 'WH01') || existingWh[0];
  const warehouses = [mainWh];
  for (const w of WAREHOUSES) warehouses.push(await call('POST', '/warehouses', w));

  const accounts = await call('GET', '/cash/accounts');
  const cash = accounts.find((a) => a.code === 'CASH01') || accounts[0];
  const bank = await call('POST', '/cash/accounts', { code: 'BANK01', name: 'بنك مصر - حساب جاري', balance: 3200000, accountType: 'BANK' });
  const cib = await call('POST', '/cash/accounts', { code: 'BANK02', name: 'البنك التجاري الدولي CIB', balance: 1800000, accountType: 'BANK' });
  const richestBank = async () => {
    const list = await call('GET', '/cash/accounts');
    return list.filter((a) => a.accountType === 'BANK').sort((a, b) => b.balance - a.balance)[0];
  };
  const branchCash = await call('POST', '/cash/accounts', { code: 'CASH02', name: 'خزنة فرع الإسكندرية', balance: 25000, accountType: 'CASH' });

  const existingCats = await call('GET', '/products/categories');
  const catId = {};
  for (const name of CATEGORIES) {
    const found = existingCats.find((c) => c.name === name);
    catId[name] = (found || (await call('POST', '/products/categories', { name }))).id;
  }

  const products = [];
  for (const [sku, name, brand, cat, cost, sale, wholesale, minStock] of PRODUCTS) {
    const p = await call('POST', '/products', {
      sku, name, brand, unit: 'قطعة', costPrice: cost, salePrice: sale, wholesalePrice: wholesale, minStock,
      barcode: '622' + String(between(100000000, 999999999)), categoryId: catId[cat],
    });
    products.push({ ...p, cost, sale, wholesale, minStock });
  }

  const suppliers = [];
  for (const [code, name, phone, address] of SUPPLIERS) suppliers.push(await call('POST', '/suppliers', { code, name, phone, address }));

  const customers = [];
  for (const [code, name, phone, address, creditLimit, priceList] of CUSTOMERS) {
    customers.push(await call('POST', '/customers', { code, name, phone, address, creditLimit, priceList }));
  }

  // Purchases: stock up every warehouse 30-55 days ago.
  let purchaseCount = 0;
  for (let i = 0; i < 12; i++) {
    const wh = i < 7 ? warehouses[0] : warehouses[1 + (i % 2)];
    const items = i < 3
      ? products.slice(i * 8, i * 8 + 8)
      : [...products].sort(() => rand() - 0.5).slice(0, between(4, 7));
    const lines = items.map((p) => ({
      productId: p.id,
      quantity: p.cost > 10000 ? between(3, 6) : p.cost > 2000 ? between(8, 16) : between(30, 70),
      unitCost: p.cost,
    }));
    const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const payMode = i % 5;
    const paidAmount = payMode === 0 ? 0 : payMode === 1 ? Math.round(total * 0.5) : total;
    const payer = await richestBank();
    await call('POST', '/purchases', {
      supplierId: suppliers[i % suppliers.length].id,
      warehouseId: wh.id,
      invoiceDate: daysAgo(55 - i * 2, 10),
      confirm: true,
      paidAmount,
      cashAccountId: paidAmount > 0 ? payer.id : undefined,
      paymentMethod: 'BANK_TRANSFER',
      notes: i === 0 ? 'توريد افتتاحي للموسم' : undefined,
      lines,
    });
    purchaseCount++;
  }

  // Recent purchases (a couple still open so the supplier due alerts show).
  for (const [ago, sIdx, paidRatio] of [[3, 1, 0], [1, 3, 0.4]]) {
    const items = [...products].sort(() => rand() - 0.5).slice(0, 4);
    const lines = items.map((p) => ({ productId: p.id, quantity: p.cost > 10000 ? 3 : p.cost > 2000 ? 8 : 25, unitCost: p.cost }));
    const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const paidAmount = Math.round(total * paidRatio);
    const payer = await richestBank();
    await call('POST', '/purchases', {
      supplierId: suppliers[sIdx].id, warehouseId: warehouses[0].id, invoiceDate: daysAgo(ago, 9), confirm: true,
      paidAmount, cashAccountId: paidAmount > 0 ? payer.id : undefined, paymentMethod: 'BANK_TRANSFER', lines,
    });
    purchaseCount++;
  }

  // Stock levels per warehouse, used to keep sales within available quantity.
  const balances = await call('GET', '/stock/balances');
  const stock = new Map();
  for (const b of balances) stock.set(`${b.warehouseId}:${b.productId}`, b.quantity);

  // Sales: spread across the last 40 days with a mix of paid / partial / credit.
  let salesCount = 0;
  const owed = new Map();
  const methods = ['CASH', 'CASH', 'CASH', 'CARD', 'INSTAPAY', 'BANK_TRANSFER'];
  for (let day = 40; day >= 0; day--) {
    const perDay = day % 7 === 5 ? 1 : between(1, 3);
    for (let k = 0; k < perDay; k++) {
      const wh = rand() < 0.6 ? warehouses[0] : pick(warehouses.slice(1));
      const customer = pick(customers);
      const wholesale = customer.priceList === 'WHOLESALE';
      const available = products.filter((p) => (stock.get(`${wh.id}:${p.id}`) || 0) > 3);
      if (!available.length) continue;
      const items = [...available].sort(() => rand() - 0.5).slice(0, between(1, 4));
      const lines = items.map((p) => {
        const have = stock.get(`${wh.id}:${p.id}`) || 0;
        const want = p.sale > 10000 ? between(1, 2) : p.sale > 2000 ? between(1, 4) : between(2, 12);
        const quantity = Math.min(want, Math.max(1, have - 2));
        return { productId: p.id, quantity, unitPrice: wholesale ? p.wholesale : p.sale };
      });
      const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      const discount = subtotal > 30000 ? Math.round(subtotal * 0.02) : 0;
      const total = subtotal - discount;

      let paidAmount = total;
      if (wholesale) {
        const r = rand();
        paidAmount = r < 0.35 ? 0 : r < 0.7 ? Math.round(total * 0.5) : total;
      } else if (day <= 6 && rand() < 0.3) {
        paidAmount = Math.round(total * 0.3);
      }
      const owedNow = owed.get(customer.id) || 0;
      if (customer.creditLimit > 0 && owedNow + total - paidAmount > customer.creditLimit) paidAmount = total;
      owed.set(customer.id, owedNow + total - paidAmount);
      const method = pick(methods);
      const account = method === 'CASH' ? (wh.code === 'WH02' ? branchCash : cash) : method === 'CARD' ? cib : bank;

      await call('POST', '/sales', {
        customerId: customer.id, warehouseId: wh.id, invoiceDate: daysAgo(day, between(10, 20)),
        discount, confirm: true, paidAmount, cashAccountId: paidAmount > 0 ? account.id : undefined,
        paymentMethod: method, lines,
      });
      for (const l of lines) stock.set(`${wh.id}:${l.productId}`, (stock.get(`${wh.id}:${l.productId}`) || 0) - l.quantity);
      salesCount++;
    }
  }

  // Collections and supplier payments against some open invoices.
  const sales = await call('GET', '/sales');
  const openSales = sales.filter((s) => s.total - s.paidAmount > 1 && new Date(s.invoiceDate) < new Date(Date.now() - 12 * 864e5));
  for (const inv of openSales.slice(0, 6)) {
    await call('POST', '/cash/receipts', {
      customerId: inv.customerId, cashAccountId: bank.id, amount: Math.round((inv.total - inv.paidAmount) * 0.6),
      salesInvoiceId: inv.id, paymentMethod: 'BANK_TRANSFER', note: 'دفعة من الحساب',
    });
  }
  const purchases = await call('GET', '/purchases');
  const openPurchases = purchases.filter((p) => p.total - p.paidAmount > 1 && new Date(p.invoiceDate) < new Date(Date.now() - 20 * 864e5));
  for (const inv of openPurchases.slice(0, 2)) {
    const payer = await richestBank();
    await call('POST', '/cash/payments', {
      supplierId: inv.supplierId, cashAccountId: payer.id, amount: Math.round((inv.total - inv.paidAmount) * 0.5),
      purchaseInvoiceId: inv.id, paymentMethod: 'BANK_TRANSFER', note: 'سداد جزئي',
    });
  }

  // Low stock on a few items so alerts have something real to show.
  const transferItems = products.filter((p) => (stock.get(`${warehouses[0].id}:${p.id}`) || 0) > 10).slice(0, 3);
  if (transferItems.length) {
    await call('POST', '/stock/transfers', {
      fromWarehouseId: warehouses[0].id, toWarehouseId: warehouses[2].id, note: 'تعزيز مخزون فرع المنصورة',
      lines: transferItems.map((p) => ({ productId: p.id, quantity: 4 })),
    });
  }

  // Operating expenses.
  const existingExpCats = await call('GET', '/finance/expense-categories');
  const expCat = {};
  for (const name of ['إيجار', 'كهرباء ومياه', 'رواتب', 'نقل وشحن', 'تسويق', 'صيانة']) {
    const found = existingExpCats.find((c) => c.name === name);
    expCat[name] = (found || (await call('POST', '/finance/expense-categories', { name }))).id;
  }
  const expenses = [
    ['إيجار', bank, 18000, 38, 'إيجار المعرض الرئيسي'],
    ['رواتب', bank, 64000, 32, 'رواتب الشهر'],
    ['كهرباء ومياه', cash, 3450, 27, 'فاتورة الكهرباء'],
    ['نقل وشحن', cash, 1850, 21, 'شحن بضاعة لفرع الإسكندرية'],
    ['تسويق', cib, 7500, 16, 'إعلانات ممولة'],
    ['صيانة', cash, 1200, 11, 'صيانة التكييفات'],
    ['نقل وشحن', branchCash, 950, 6, 'توصيل طلبيات'],
    ['إيجار', bank, 18000, 8, 'إيجار المعرض الرئيسي'],
    ['كهرباء ومياه', cash, 3720, 2, 'فاتورة الكهرباء'],
  ];
  for (const [cat, acc, amount, ago, notes] of expenses) {
    await call('POST', '/finance/expenses', {
      categoryId: expCat[cat], accountId: acc.id, amount, expenseDate: daysAgo(ago, 13), notes,
      paymentMethod: acc.accountType === 'BANK' ? 'BANK_TRANSFER' : 'CASH',
    });
  }

  // Post-dated checks.
  const checks = [
    ['IN', '100245', 'بنك مصر', 45000, 6, customers[0].id, undefined],
    ['IN', '558120', 'البنك الأهلي', 32000, 14, customers[5].id, undefined],
    ['OUT', '771093', 'CIB', 60000, 9, undefined, suppliers[0].id],
  ];
  for (const [direction, checkNumber, bankName, amount, inDays, customerId, supplierId] of checks) {
    await call('POST', '/finance/checks', {
      direction, checkNumber, bankName, amount, dueDate: daysAgo(-inDays), issueDate: daysAgo(1), customerId, supplierId,
    });
  }

  console.log(`Done: ${products.length} products, ${customers.length} customers, ${suppliers.length} suppliers, ${purchaseCount} purchases, ${salesCount} sales, ${expenses.length} expenses.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
