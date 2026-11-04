import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, readPage } from '../common/paging';

type Range = { start: Date; end: Date; prevStart: Date; prevEnd: Date };

function bounds(preset?: string, from?: string, to?: string): Range {
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(end.getTime())) end.setTime(Date.now());
  end.setHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(end);
  if (!from) {
    if (preset === 'week') start.setDate(start.getDate() - 6);
    else if (preset === 'month') start.setDate(1);
    else if (preset === 'year') start.setMonth(0, 1);
  }
  start.setHours(0, 0, 0, 0);
  const span = Math.max(end.getTime() - start.getTime(), 1);
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);
  return { start, end, prevStart, prevEnd };
}

function growth(current: number, previous: number) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

@Injectable()
export class OpsService {
  private scannedAt = 0;

  constructor(private prisma: PrismaService) {}

  async search(q: string) {
    const query = q.trim();
    if (query.length < 1) {
      return { products: [], customers: [], suppliers: [], sales: [], purchases: [], warehouses: [], tasks: [], reports: [] };
    }
    const [products, customers, suppliers, sales, purchases, warehouses, tasks, reports] = await Promise.all([
      this.prisma.product.findMany({
        where: { OR: [{ name: { contains: query } }, { sku: { contains: query } }, { barcode: { contains: query } }] },
        take: 6,
        select: { id: true, name: true, sku: true },
      }),
      this.prisma.customer.findMany({
        where: { OR: [{ name: { contains: query } }, { code: { contains: query } }, { phone: { contains: query } }] },
        take: 6,
        select: { id: true, name: true, code: true },
      }),
      this.prisma.supplier.findMany({
        where: { OR: [{ name: { contains: query } }, { code: { contains: query } }, { phone: { contains: query } }] },
        take: 6,
        select: { id: true, name: true, code: true },
      }),
      this.prisma.salesInvoice.findMany({
        where: { OR: [{ number: { contains: query } }, { customer: { name: { contains: query } } }] },
        take: 6,
        select: { id: true, number: true, total: true, customer: { select: { name: true } } },
      }),
      this.prisma.purchaseInvoice.findMany({
        where: { OR: [{ number: { contains: query } }, { supplier: { name: { contains: query } } }] },
        take: 6,
        select: { id: true, number: true, total: true, supplier: { select: { name: true } } },
      }),
      this.prisma.warehouse.findMany({
        where: { OR: [{ name: { contains: query } }, { code: { contains: query } }] },
        take: 4,
        select: { id: true, name: true, code: true },
      }),
      this.prisma.workTask.findMany({
        where: { title: { contains: query } },
        take: 5,
        select: { id: true, title: true, status: true },
      }),
      this.prisma.savedReport.findMany({
        where: { name: { contains: query } },
        take: 5,
        select: { id: true, name: true },
      }),
    ]);
    return { products, customers, suppliers, sales, purchases, warehouses, tasks, reports };
  }

  async overview(preset?: string, from?: string, to?: string) {
    const range = bounds(preset, from, to);
    const whereSales = { invoiceDate: { gte: range.start, lte: range.end }, status: { not: 'CANCELLED' as const } };
    const wherePrev = { invoiceDate: { gte: range.prevStart, lte: range.prevEnd }, status: { not: 'CANCELLED' as const } };
    const [sales, prevSales, purchases, prevPurchases, recent, groupedCustomers] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: whereSales, _sum: { total: true }, _count: true }),
      this.prisma.salesInvoice.aggregate({ where: wherePrev, _sum: { total: true }, _count: true }),
      this.prisma.purchaseInvoice.aggregate({ where: { ...whereSales }, _sum: { total: true }, _count: true }),
      this.prisma.purchaseInvoice.aggregate({ where: { ...wherePrev }, _sum: { total: true }, _count: true }),
      this.prisma.salesInvoice.findMany({
        where: whereSales,
        orderBy: { invoiceDate: 'desc' },
        take: 8,
        select: { id: true, number: true, total: true, status: true, invoiceDate: true, customer: { select: { name: true } } },
      }),
      this.prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: whereSales,
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
    ]);
    const customerIds = groupedCustomers.map((row) => row.customerId);
    const customerRows = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(customerRows.map((row) => [row.id, row.name]));
    const salesTotal = sales._sum.total || 0;
    const purchaseTotal = purchases._sum.total || 0;
    return {
      from: range.start.toISOString(),
      to: range.end.toISOString(),
      sales: { total: salesTotal, count: sales._count },
      purchases: { total: purchaseTotal, count: purchases._count },
      salesGrowth: growth(salesTotal, prevSales._sum.total || 0),
      purchasesGrowth: growth(purchaseTotal, prevPurchases._sum.total || 0),
      netFlow: salesTotal - purchaseTotal,
      trend: await this.trend(range.start, range.end),
      topProducts: await this.topProducts(range.start, range.end),
      topCustomers: groupedCustomers.map((row) => ({
        id: row.customerId,
        name: names.get(row.customerId) || 'عميل',
        total: row._sum.total || 0,
        count: row._count,
      })),
      recent,
    };
  }

  async insights() {
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const overdueBefore = new Date();
    overdueBefore.setDate(overdueBefore.getDate() - 14);
    const [lowStock, expiring, overdue, duplicateNames, duplicatePhones] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ id: string; sku: string; name: string; minStock: number; quantity: number; warehouseName: string }[]>(`
        SELECT p.id, p.sku, p.name, p.minStock, sb.quantity, w.name as warehouseName
        FROM StockBalance sb
        JOIN Product p ON p.id = sb.productId
        JOIN Warehouse w ON w.id = sb.warehouseId
        WHERE p.minStock > 0 AND sb.quantity <= p.minStock AND p.isActive = 1
        ORDER BY sb.quantity ASC
        LIMIT 20
      `),
      this.prisma.purchaseInvoiceLine.findMany({
        where: { expiryDate: { not: null, lte: soon } },
        include: { product: { select: { name: true, sku: true } }, invoice: { select: { number: true } } },
        orderBy: { expiryDate: 'asc' },
        take: 20,
      }),
      this.prisma.$queryRaw<{ id: string; number: string; total: number; paidAmount: number; invoiceDate: string; customerName: string }[]>`
        SELECT s.id, s.number, s.total, s.paidAmount, s.invoiceDate, c.name as customerName
        FROM SalesInvoice s
        JOIN Customer c ON c.id = s.customerId
        WHERE s.status IN ('CONFIRMED', 'PARTIAL')
          AND s.paidAmount + 0.009 < s.total
          AND s.invoiceDate < ${overdueBefore.toISOString()}
        ORDER BY s.invoiceDate ASC
        LIMIT 20
      `,
      this.prisma.$queryRaw<{ name: string; cnt: number }[]>`
        SELECT name, COUNT(*) AS cnt FROM Product WHERE isActive = 1 GROUP BY name HAVING cnt > 1 LIMIT 20
      `,
      this.prisma.$queryRaw<{ phone: string; cnt: number }[]>`
        SELECT phone, COUNT(*) AS cnt FROM Customer WHERE phone IS NOT NULL AND phone != '' GROUP BY phone HAVING cnt > 1 LIMIT 20
      `,
    ]);
    return {
      lowStock,
      reorder: lowStock.map((row) => ({
        ...row,
        suggestedQty: Math.max(row.minStock * 2 - Number(row.quantity), row.minStock),
      })),
      expiring: expiring.map((line) => ({
        id: line.id,
        product: line.product.name,
        sku: line.product.sku,
        invoice: line.invoice.number,
        expiryDate: line.expiryDate,
        expired: !!line.expiryDate && line.expiryDate.getTime() < Date.now(),
      })),
      overdue: overdue.map((row) => ({
        ...row,
        total: Number(row.total),
        paidAmount: Number(row.paidAmount),
        remaining: Number(row.total) - Number(row.paidAmount),
      })),
      duplicateProducts: duplicateNames.map((row) => ({ name: row.name, count: Number(row.cnt) })),
      duplicateCustomers: duplicatePhones.map((row) => ({ phone: row.phone, count: Number(row.cnt) })),
    };
  }

  async notifications() {
    if (Date.now() - this.scannedAt > 30_000) {
      this.scannedAt = Date.now();
      await this.scanAlerts().catch(() => undefined);
    }
    const [items, unread] = await Promise.all([
      this.prisma.appNotification.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
      this.prisma.appNotification.count({ where: { readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(ids?: string[]) {
    await this.prisma.appNotification.updateMany({
      where: ids?.length ? { id: { in: ids } } : { readAt: null },
      data: { readAt: new Date() },
    });
    return this.notifications();
  }

  async audit(query?: string, pageQuery?: { page?: string; pageSize?: string; status?: string }) {
    const page = readPage(pageQuery);
    const text = query
      ? { OR: [{ action: { contains: query } }, { userName: { contains: query } }, { path: { contains: query } }] }
      : {};
    const where = {
      ...text,
      ...(pageQuery?.status === 'success' ? { status: 'success' } : {}),
      ...(pageQuery?.status === 'failed' ? { NOT: { status: 'success' } } : {}),
    };
    if (!page) {
      return this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    }
    const [total, items, allTotal, success, users] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.auditLog.count({ where: text }),
      this.prisma.auditLog.count({ where: { ...text, status: 'success' } }),
      this.prisma.auditLog.groupBy({ by: ['userName'], where: text }),
    ]);
    return pageResult(items, total, page, {
      summary: { total: allTotal, success, failed: allTotal - success, users: users.filter((row) => row.userName).length },
    });
  }

  activity(userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async scanAlerts() {
    const data = await this.insights();
    const keys: string[] = [];
    const writes = [
      ...data.lowStock.map((row) => this.alert({
        dedupeKey: `alert:stock:${row.id}:${row.warehouseName}`,
        category: 'stock',
        severity: 'warning',
        title: 'مخزون تحت الحد',
        body: `${row.name} في ${row.warehouseName}: ${row.quantity} / الحد ${row.minStock}`,
        href: '/insights',
      }, keys)),
      ...data.expiring.map((row) => this.alert({
        dedupeKey: `alert:expiry:${row.id}`,
        category: 'expiry',
        severity: row.expired ? 'danger' : 'warning',
        title: row.expired ? 'صنف منتهي الصلاحية' : 'صلاحية قاربت على الانتهاء',
        body: `${row.product} — فاتورة ${row.invoice}`,
        href: '/insights',
      }, keys)),
      ...data.overdue.map((row) => this.alert({
        dedupeKey: `alert:overdue:${row.id}`,
        category: 'overdue',
        severity: 'danger',
        title: 'فاتورة متأخرة التحصيل',
        body: `${row.number} — ${row.customerName}`,
        href: `/sales?open=${row.id}`,
      }, keys)),
    ];
    await Promise.all(writes);
    if (keys.length === 0) {
      await this.prisma.appNotification.deleteMany({ where: { dedupeKey: { startsWith: 'alert:' } } });
      return;
    }
    await this.prisma.appNotification.deleteMany({
      where: { dedupeKey: { startsWith: 'alert:' }, NOT: { dedupeKey: { in: keys } } },
    });
  }

  private alert(data: { dedupeKey: string; category: string; severity: string; title: string; body: string; href: string }, keys: string[]) {
    keys.push(data.dedupeKey);
    return this.prisma.appNotification.upsert({
      where: { dedupeKey: data.dedupeKey },
      create: data,
      update: { title: data.title, body: data.body, severity: data.severity, href: data.href, category: data.category },
    });
  }

  private async trend(start: Date, end: Date) {
    const monthly = end.getTime() - start.getTime() > 62 * 86400000;
    const bucket = monthly ? 7 : 10;
    try {
      const [sales, purchases] = await Promise.all([
        this.prisma.$queryRaw<{ bucket: string; total: number | null }[]>`
          SELECT substr(invoiceDate, 1, ${bucket}) AS bucket, SUM(total) AS total
          FROM SalesInvoice
          WHERE status != 'CANCELLED' AND invoiceDate >= ${start.toISOString()} AND invoiceDate <= ${end.toISOString()}
          GROUP BY substr(invoiceDate, 1, ${bucket})
        `,
        this.prisma.$queryRaw<{ bucket: string; total: number | null }[]>`
          SELECT substr(invoiceDate, 1, ${bucket}) AS bucket, SUM(total) AS total
          FROM PurchaseInvoice
          WHERE status != 'CANCELLED' AND invoiceDate >= ${start.toISOString()} AND invoiceDate <= ${end.toISOString()}
          GROUP BY substr(invoiceDate, 1, ${bucket})
        `,
      ]);
      const salesMap = new Map(sales.map((row) => [String(row.bucket), Number(row.total || 0)]));
      const purchaseMap = new Map(purchases.map((row) => [String(row.bucket), Number(row.total || 0)]));
      const labels = new Set([...salesMap.keys(), ...purchaseMap.keys()]);
      return [...labels].sort().map((label) => ({
        label,
        sales: salesMap.get(label) || 0,
        purchases: purchaseMap.get(label) || 0,
      }));
    } catch {
      return [];
    }
  }

  private async topProducts(start: Date, end: Date) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: string; sku: string; name: string; quantity: number; amount: number }[]>`
        SELECT p.id, p.sku, p.name, SUM(l.quantity) AS quantity, SUM(l.total) AS amount
        FROM SalesInvoiceLine l
        JOIN SalesInvoice i ON i.id = l.invoiceId
        JOIN Product p ON p.id = l.productId
        WHERE i.status != 'CANCELLED' AND i.invoiceDate >= ${start.toISOString()} AND i.invoiceDate <= ${end.toISOString()}
        GROUP BY p.id, p.sku, p.name
        ORDER BY amount DESC
        LIMIT 8
      `;
      return rows.map((row) => ({ ...row, quantity: Number(row.quantity), amount: Number(row.amount) }));
    } catch {
      return [];
    }
  }
}
