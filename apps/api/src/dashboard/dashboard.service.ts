import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dueTone } from '../common/due';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const startOfPrevMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
    const openStatuses = ['CONFIRMED', 'PARTIAL'] as const;

    const [
      salesToday,
      purchasesToday,
      cashAccounts,
      payMethods,
      lowStock,
      recentSales,
      recentPurchases,
      customers,
      suppliers,
      salesMonth,
      salesPrevMonth,
      purchasesMonth,
      purchasesPrevMonth,
      productCount,
      warehouseCount,
      openSales,
      openPurchases,
    ] = await Promise.all([
      this.prisma.salesInvoice.aggregate({
        where: { invoiceDate: { gte: startOfDay }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { invoiceDate: { gte: startOfDay }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.cashAccount.findMany({ where: { isActive: true } }),
      this.prisma.payMethod.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.$queryRawUnsafe<
        { id: string; sku: string; name: string; minStock: number; quantity: number; warehouseName: string }[]
      >(`
          SELECT p.id, p.sku, p.name, p.minStock, sb.quantity, w.name as warehouseName
          FROM StockBalance sb
          JOIN Product p ON p.id = sb.productId
          JOIN Warehouse w ON w.id = sb.warehouseId
          WHERE p.minStock > 0 AND sb.quantity <= p.minStock AND p.isActive = 1
          ORDER BY sb.quantity ASC
          LIMIT 10
        `),
      this.prisma.salesInvoice.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, createdBy: { select: { fullName: true } } },
      }),
      this.prisma.purchaseInvoice.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, createdBy: { select: { fullName: true } } },
      }),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.supplier.count({ where: { isActive: true } }),
      this.prisma.salesInvoice.aggregate({
        where: { invoiceDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.salesInvoice.aggregate({
        where: { invoiceDate: { gte: startOfPrevMonth, lt: startOfMonth }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { invoiceDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { invoiceDate: { gte: startOfPrevMonth, lt: startOfMonth }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.warehouse.count({ where: { isActive: true } }),
      this.prisma.salesInvoice.aggregate({
        where: { status: { in: [...openStatuses] } },
        _sum: { total: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: { status: { in: [...openStatuses] } },
        _sum: { total: true, paidAmount: true },
        _count: true,
      }),
    ]);

    const cashBalance = cashAccounts.reduce((s, a) => s + a.balance, 0);
    const trend = await this.weekTrend(startOfDay);

    return {
      salesToday: { total: salesToday._sum.total || 0, count: salesToday._count },
      purchasesToday: { total: purchasesToday._sum.total || 0, count: purchasesToday._count },
      cashBalance,
      cashAccounts,
      payMethods,
      lowStock,
      recentSales,
      recentPurchases,
      customersCount: customers,
      suppliersCount: suppliers,
      salesMonth: { total: salesMonth._sum.total || 0, count: salesMonth._count },
      salesPrevMonth: { total: salesPrevMonth._sum.total || 0, count: salesPrevMonth._count },
      purchasesMonth: { total: purchasesMonth._sum.total || 0, count: purchasesMonth._count },
      purchasesPrevMonth: { total: purchasesPrevMonth._sum.total || 0, count: purchasesPrevMonth._count },
      productCount,
      warehouseCount,
      receivables: {
        count: openSales._count,
        amount: Math.max(0, (openSales._sum.total || 0) - (openSales._sum.paidAmount || 0)),
      },
      payables: {
        count: openPurchases._count,
        amount: Math.max(0, (openPurchases._sum.total || 0) - (openPurchases._sum.paidAmount || 0)),
      },
      trend,
    };
  }

  private async weekTrend(startOfDay: Date) {
    const since = new Date(startOfDay);
    since.setDate(since.getDate() - 6);
    try {
      const sinceIso = since.toISOString();
      const [saleRows, purchaseRows] = await Promise.all([
        this.prisma.$queryRaw<{ day: string; total: number | null }[]>`
          SELECT substr(invoiceDate, 1, 10) AS day, SUM(total) AS total
          FROM SalesInvoice
          WHERE status != 'CANCELLED' AND invoiceDate >= ${sinceIso}
          GROUP BY substr(invoiceDate, 1, 10)
        `,
        this.prisma.$queryRaw<{ day: string; total: number | null }[]>`
          SELECT substr(invoiceDate, 1, 10) AS day, SUM(total) AS total
          FROM PurchaseInvoice
          WHERE status != 'CANCELLED' AND invoiceDate >= ${sinceIso}
          GROUP BY substr(invoiceDate, 1, 10)
        `,
      ]);
      const sales = new Map(saleRows.map((row) => [String(row.day), Number(row.total || 0)]));
      const purchases = new Map(purchaseRows.map((row) => [String(row.day), Number(row.total || 0)]));
      return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(since);
        day.setDate(since.getDate() + index);
        const key = day.toISOString().slice(0, 10);
        return { day: key, sales: sales.get(key) || 0, purchases: purchases.get(key) || 0 };
      });
    } catch {
      return [];
    }
  }

  async insight() {
    const since30 = new Date();
    since30.setHours(0, 0, 0, 0);
    since30.setDate(since30.getDate() - 29);
    const monthStart = new Date(since30);
    monthStart.setDate(1);
    const from = monthStart < since30 ? monthStart : since30;
    const [sales, purchases, categories] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          OR: [
            { invoiceDate: { gte: from }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
            { status: { in: ['CONFIRMED', 'PARTIAL'] } },
          ],
        },
        include: {
          customer: { select: { name: true } },
          warehouse: { select: { name: true } },
          lines: { include: { product: { select: { name: true, categoryId: true } } } },
        },
      }),
      this.prisma.purchaseInvoice.findMany({
        where: { invoiceDate: { gte: since30 }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: { invoiceDate: true, total: true },
      }),
      this.prisma.category.findMany(),
    ]);
    const days30 = Array.from({ length: 30 }, (_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (29 - index));
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
    });
    const dayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
    const salesByDay = new Map<string, number>();
    const countByDay = new Map<string, number>();
    const purchasesByDay = new Map<string, number>();
    const productRevenue = new Map<string, { value: number; qty: number }>();
    const customerRevenue = new Map<string, { value: number; count: number }>();
    const categoryRevenue = new Map<string, number>();
    const branchRevenue = new Map<string, number>();
    const aging = { red: { count: 0, amount: 0 }, yellow: { count: 0, amount: 0 }, green: { count: 0, amount: 0 } };
    let monthRevenue = 0;
    let monthCost = 0;
    let monthCount = 0;
    for (const sale of sales) {
      const key = dayKey(sale.invoiceDate);
      const inMonth = sale.invoiceDate >= monthStart;
      if (inMonth) {
        monthRevenue += sale.total;
        monthCount += 1;
        monthCost += sale.lines.reduce((sum, line) => sum + line.quantity * (line.unitCost || 0), 0);
      }
      const remaining = sale.total - sale.paidAmount;
      const tone = dueTone(sale.invoiceDate, remaining);
      if (tone !== 'clear') {
        aging[tone].count += 1;
        aging[tone].amount += remaining;
      }
      if (sale.invoiceDate < since30) continue;
      salesByDay.set(key, (salesByDay.get(key) || 0) + sale.total);
      countByDay.set(key, (countByDay.get(key) || 0) + 1);
      const customer = customerRevenue.get(sale.customer.name) || { value: 0, count: 0 };
      customerRevenue.set(sale.customer.name, { value: customer.value + sale.total, count: customer.count + 1 });
      branchRevenue.set(sale.warehouse.name, (branchRevenue.get(sale.warehouse.name) || 0) + sale.total);
      for (const line of sale.lines) {
        const name = line.product.name;
        const product = productRevenue.get(name) || { value: 0, qty: 0 };
        productRevenue.set(name, { value: product.value + line.total, qty: product.qty + line.quantity });
        const category = categories.find((item) => item.id === line.product.categoryId)?.name || 'بدون تصنيف';
        categoryRevenue.set(category, (categoryRevenue.get(category) || 0) + line.total);
      }
    }
    for (const purchase of purchases) {
      const key = dayKey(purchase.invoiceDate);
      purchasesByDay.set(key, (purchasesByDay.get(key) || 0) + purchase.total);
    }
    const sorted = <T,>(map: Map<string, T>, value: (item: T) => number) => [...map.entries()].sort((a, b) => value(b[1]) - value(a[1]));
    const cats = sorted(categoryRevenue, (value) => value);
    const topCats = cats.slice(0, 6);
    const otherCats = cats.slice(6).reduce((sum, [, value]) => sum + value, 0);
    const palette = ['#1e3a5f', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#64748b', '#14b8a6'];
    return {
      labels: days30.map((day) => `${Number(day.slice(8))}/${Number(day.slice(5, 7))}`),
      salesSeries: days30.map((day) => salesByDay.get(day) || 0),
      purchaseSeries: days30.map((day) => purchasesByDay.get(day) || 0),
      countSeries: days30.map((day) => countByDay.get(day) || 0),
      monthRevenue,
      monthProfit: monthRevenue - monthCost,
      monthCount,
      revenue30: days30.reduce((sum, day) => sum + (salesByDay.get(day) || 0), 0),
      purchases30: days30.reduce((sum, day) => sum + (purchasesByDay.get(day) || 0), 0),
      topProducts: sorted(productRevenue, (item) => item.value).slice(0, 5).map(([label, item]) => ({ label, value: item.value, hint: `${item.qty.toLocaleString('ar-EG')} ك مباعة` })),
      topCustomers: sorted(customerRevenue, (item) => item.value).slice(0, 5).map(([label, item]) => ({ label, value: item.value, hint: `${item.count.toLocaleString('ar-EG')} فاتورة` })),
      branches: sorted(branchRevenue, (value) => value).map(([label, value]) => ({ label, value })),
      slices: [
        ...topCats.map(([label, value], index) => ({ label, value, color: palette[index % palette.length] })),
        ...(otherCats > 0 ? [{ label: 'أخرى', value: otherCats, color: '#cbd5e1' }] : []),
      ],
      aging,
    };
  }
}
