import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { canDo, hiddenResponseKeys, stripHidden, templateFor } from '@m5azen/shared';
import { actionFor, pageForPath } from '../src/common/access.guard';
import { assertPaidFits, lineAmount, statusFromPayment, taxFromPercent } from '../src/common/invoice-post';
import { SalesService } from '../src/sales/sales.service';
import { PurchasesService } from '../src/purchases/purchases.service';
import { CashService } from '../src/cash/cash.service';
import { ReturnsService } from '../src/returns/returns.service';
import { FinanceService } from '../src/finance/finance.service';
import { SettingsService } from '../src/settings/settings.service';
import { SequenceService } from '../src/common/sequence.service';

process.env.DATABASE_URL = 'file:./prisma/test-business.db';
delete process.env.TURSO_DATABASE_URL;
const prisma = new PrismaClient();
const sequence = new SequenceService(prisma as never);
const sales = new SalesService(prisma as never, sequence);
const purchases = new PurchasesService(prisma as never, sequence);
const cash = new CashService(prisma as never, sequence);
const returns = new ReturnsService(prisma as never, sequence);
const finance = new FinanceService(prisma as never);
const settings = new SettingsService(prisma as never);

let warehouseId = '';
let productId = '';
let customerId = '';
let supplierId = '';
let methodId = '';

describe('permissions and invoice math', () => {
  it('gives each role a different page set', () => {
    const salesAccess = templateFor('SALES');
    const warehouse = templateFor('WAREHOUSE');
    assert.equal(canDo(salesAccess, 'sales', 'create'), true);
    assert.equal(canDo(salesAccess, 'purchases', 'view'), false);
    assert.equal(canDo(salesAccess, 'reports', 'view'), false);
    assert.equal(salesAccess.sales.fields.includes('cost'), false);
    assert.equal(canDo(warehouse, 'purchases', 'create'), true);
    assert.equal(canDo(warehouse, 'sales', 'view'), false);
    assert.equal(canDo(templateFor('ADMIN'), 'settings', 'backup'), true);
    assert.equal(canDo(templateFor('ACCOUNTANT'), 'settings', 'view'), false);
    assert.equal(canDo(templateFor('ACCOUNTANT'), 'reports', 'export'), true);
  });

  it('strips hidden money fields and maps routes', () => {
    const access = templateFor('SALES');
    const hidden = hiddenResponseKeys(access, 'sales');
    const clean = stripHidden({ total: 10, paidAmount: 4, lines: [{ unitCost: 3, costPrice: 3, quantity: 1 }] }, hidden);
    assert.equal(clean.paidAmount, 4);
    assert.equal('unitCost' in clean.lines[0], false);
    assert.equal(clean.lines[0].quantity, 1);
    assert.equal(pageForPath('/api/sales/dues'), 'sales');
    assert.equal(actionFor('POST', '/api/sales', 'sales'), 'create');
    assert.equal(actionFor('POST', '/api/sales/abc/confirm', 'sales'), 'confirm');
    assert.equal(actionFor('POST', '/api/cash/receipts', 'cash'), 'receipt');
    assert.equal(actionFor('POST', '/api/settings/backup', 'settings'), 'backup');
    assert.equal(actionFor('GET', '/api/products', 'products'), 'view');
  });

  it('calculates tax, line totals, and payment status', () => {
    assert.equal(lineAmount(2, 50, 5), 95);
    assert.equal(taxFromPercent(100, 0, 14), 14);
    assert.equal(statusFromPayment(100, 100), 'PAID');
    assert.equal(statusFromPayment(100, 40), 'PARTIAL');
    assert.equal(statusFromPayment(100, 0, false), 'DRAFT');
    assert.throws(() => assertPaidFits(120, 100), /المدفوع/);
  });
});

describe('sales, purchases, cash, returns, and backup', () => {
  it('posts a cash sale, a credit sale, and refuses a short stock sale', async () => {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    const tables = await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`;
    for (const table of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${table.name}"`);
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    const warehouse = await prisma.warehouse.create({ data: { code: 'WH1', name: 'الرئيسي' } });
    const product = await prisma.product.create({ data: { sku: 'P1', name: 'صنف', costPrice: 10, salePrice: 50 } });
    const customer = await prisma.customer.create({ data: { code: 'C1', name: 'عميل' } });
    const supplier = await prisma.supplier.create({ data: { code: 'S1', name: 'مورد' } });
    const account = await prisma.cashAccount.create({ data: { code: 'CASH', name: 'خزنة', balance: 0 } });
    const method = await prisma.payMethod.create({ data: { code: 'CASH', name: 'نقدي', kind: 'IMMEDIATE', cashAccountId: account.id } });
    await prisma.stockBalance.create({ data: { warehouseId: warehouse.id, productId: product.id, quantity: 30 } });
    warehouseId = warehouse.id;
    productId = product.id;
    customerId = customer.id;
    supplierId = supplier.id;
    methodId = method.id;

    const sold = await sales.create({
      customerId, warehouseId, confirm: true, idempotencyKey: 'sale-1',
      payments: [{ methodId, amount: 100 }],
      lines: [{ productId, quantity: 2, unitPrice: 50 }],
    });
    assert.equal(sold.status, 'PAID');
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 28);
    assert.equal((await prisma.customer.findUnique({ where: { id: customerId } }))?.balance, 0);
    assert.equal((await prisma.cashAccount.findFirst())?.balance, 100);
    assert.equal((await prisma.stockMovement.findFirst({ where: { type: 'SALE' } }))?.unitCost, 10);

    const again = await sales.create({
      customerId, warehouseId, confirm: true, idempotencyKey: 'sale-1',
      payments: [{ methodId, amount: 100 }],
      lines: [{ productId, quantity: 2, unitPrice: 50 }],
    });
    assert.equal(again.id, sold.id);
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 28);

    const credit = await sales.create({
      customerId, warehouseId, confirm: true, idempotencyKey: 'sale-credit',
      lines: [{ productId, quantity: 1, unitPrice: 50 }],
    });
    assert.equal(credit.status, 'CONFIRMED');
    assert.equal((await prisma.customer.findUnique({ where: { id: customerId } }))?.balance, 50);
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 27);

    const draft = await sales.create({
      customerId, warehouseId, confirm: false,
      lines: [{ productId, quantity: 1, unitPrice: 50 }],
    });
    assert.equal(draft.status, 'DRAFT');
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 27);

    await assert.rejects(() => sales.create({
      customerId, warehouseId, confirm: true,
      lines: [{ productId, quantity: 100, unitPrice: 50 }],
    }), /كمية/);
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 27);
  });

  it('edits only the quantity delta and delete reverses the invoice', async () => {
    const invoice = await prisma.salesInvoice.findFirst({ where: { status: 'CONFIRMED' }, include: { lines: true } });
    assert.ok(invoice);
    const edited = await sales.update(invoice.id, {
      customerId, warehouseId, confirm: true, discount: 0, taxRate: 0,
      lines: [{ id: invoice.lines[0].id, productId, quantity: 2, unitPrice: 50 }],
    });
    assert.equal(edited.lines[0].quantity, 2);
    assert.equal((await prisma.stockBalance.findFirst())?.quantity, 26);
    await sales.remove(edited.id);
    assert.equal(await prisma.salesInvoice.count({ where: { id: edited.id } }), 0);
  });

  it('posts a purchase once and updates the product cost', async () => {
    const bought = await purchases.create({
      supplierId, warehouseId, confirm: true, idempotencyKey: 'pur-1', tax: 0,
      lines: [{ productId, quantity: 4, unitCost: 12 }],
    });
    const repeat = await purchases.create({
      supplierId, warehouseId, confirm: true, idempotencyKey: 'pur-1', tax: 0,
      lines: [{ productId, quantity: 4, unitCost: 12 }],
    });
    assert.equal(repeat.id, bought.id);
    assert.equal((await prisma.product.findUnique({ where: { id: productId } }))?.costPrice, 12);
    const qty = (await prisma.stockBalance.findFirst())?.quantity || 0;
    assert.ok(qty >= 4);
  });

  it('allocates a customer receipt from the oldest invoice', async () => {
    const first = await sales.create({
      customerId, warehouseId, confirm: true, invoiceDate: '2020-01-01',
      lines: [{ productId, quantity: 1, unitPrice: 30 }],
    });
    const second = await sales.create({
      customerId, warehouseId, confirm: true, invoiceDate: '2020-03-01',
      lines: [{ productId, quantity: 1, unitPrice: 20 }],
    });
    await cash.createReceipt({ customerId, methodId, amount: 35 });
    const older = await prisma.salesInvoice.findUnique({ where: { id: first.id } });
    const newer = await prisma.salesInvoice.findUnique({ where: { id: second.id } });
    assert.equal(older?.status, 'PAID');
    assert.equal(newer?.paidAmount, 5);
    await cash.createReceipt({ customerId, methodId, amount: 10, salesInvoiceId: second.id });
    assert.equal((await prisma.salesInvoice.findUnique({ where: { id: first.id } }))?.paidAmount, older?.paidAmount);
  });

  it('stores the original sale cost on a linked return', async () => {
    const invoice = await sales.create({
      customerId, warehouseId, confirm: true,
      payments: [{ methodId, amount: 40 }],
      lines: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    await prisma.product.update({ where: { id: productId }, data: { costPrice: 99 } });
    const returned = await returns.createSalesReturn({
      customerId, warehouseId, salesInvoiceId: invoice.id,
      lines: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    assert.equal(returned.lines[0].unitCost, invoice.lines[0].unitCost);
    assert.notEqual(returned.lines[0].unitCost, 99);
  });

  it('keeps a pending check out of the cash balance until it clears', async () => {
    const before = (await prisma.cashAccount.findFirst())?.balance || 0;
    const check = await finance.createCheck({
      direction: 'IN', checkNumber: '100', bankName: 'بنك', amount: 25, dueDate: '2026-12-01', customerId,
    });
    assert.equal((await prisma.cashAccount.findFirst())?.balance, before);
    await finance.setCheckStatus(check.id, 'CLEARED', methodId);
    assert.equal((await prisma.cashAccount.findFirst())?.balance, before + 25);
  });

  it('blocks a document dated in a closed month', async () => {
    await prisma.fiscalPeriod.create({ data: { year: 2019, month: 5, closedAt: new Date() } });
    await assert.rejects(() => sales.create({
      customerId, warehouseId, confirm: true, invoiceDate: '2019-05-10',
      lines: [{ productId, quantity: 1, unitPrice: 10 }],
    }), /مقفول/);
  });

  it('pages invoices and exports a restorable snapshot', async () => {
    const page = await sales.findAll({ page: '1', pageSize: '5' });
    assert.equal(Array.isArray(page), false);
    if (!Array.isArray(page)) {
      assert.equal(page.pageSize, 5);
      assert.equal(page.items.length, Math.min(5, page.total));
      assert.ok(page.total >= 5);
    }
    const backup = await settings.backup();
    assert.equal(backup.ok, true);
    assert.ok(backup.snapshot.tables.customer.some((row) => (row as { id: string }).id === customerId));
    await prisma.customer.create({ data: { code: 'TEMP', name: 'مؤقت' } });
    await settings.restore(backup.snapshot);
    assert.equal(await prisma.customer.count({ where: { code: 'TEMP' } }), 0);
    assert.equal(await prisma.customer.count({ where: { id: customerId } }), 1);
  });
});

after(async () => {
  await prisma.$disconnect();
});
