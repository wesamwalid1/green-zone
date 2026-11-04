import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export function money(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dayRange(from?: string, to?: string) {
  if (!from || !to) return undefined;
  return {
    gte: new Date(`${from.slice(0, 10)}T00:00:00.000Z`),
    lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`),
  };
}

function sliceInvoiceCost(lines: { productId: string; quantity: number; unitCost: number }[], productId: string) {
  const rows = lines.filter((line) => line.productId === productId && line.quantity > 0);
  const quantity = rows.reduce((sum, line) => sum + line.quantity, 0);
  if (quantity <= 0) return null;
  return Math.round((rows.reduce((sum, line) => sum + line.quantity * (line.unitCost || 0), 0) / quantity) * 10000) / 10000;
}

export type ProfitSnapshot = {
  from: string | null;
  to: string | null;
  /** صافي إيراد البيع بعد المرتجعات والخصم والضريبة */
  revenue: number;
  /** تكلفة البضاعة المباعة */
  cogs: number;
  /** مصروفات الفترة */
  expenses: number;
  /** مجمل الربح = إيراد − تكلفة */
  grossProfit: number;
  /** صافي الربح = إيراد − تكلفة − مصروفات (قد يكون سالبًا محاسبيًا) */
  netProfit: number;
  /** الربح القابل للتوزيع على الشركاء (موجب فقط) */
  distributableProfit: number;
  salesTotal: number;
  purchasesTotal: number;
  salesCount: number;
  purchasesCount: number;
};

/**
 * ربح دقيق: مبيعات − تكلفة البضاعة المباعة − مصروفات
 * (المشتريات لا تُخصم من الربح إلا عبر تكلفة ما تم بيعه)
 */
export async function computeProfitSnapshot(
  prisma: PrismaService,
  from?: string,
  to?: string,
  warehouseIds?: string[],
): Promise<ProfitSnapshot> {
  const invoiceDate = dayRange(from, to);
  const expenseDate = dayRange(from, to);
  const posted = { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL, InvoiceStatus.PAID] as InvoiceStatus[] };
  const warehouseFilter = warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {};

  const salesWhere = {
    status: { not: InvoiceStatus.CANCELLED },
    ...warehouseFilter,
    ...(invoiceDate ? { invoiceDate } : {}),
  };
  const purchaseWhere = {
    status: { not: InvoiceStatus.CANCELLED },
    ...warehouseFilter,
    ...(invoiceDate ? { invoiceDate } : {}),
  };

  const [saleInvoices, returnRows, expenses, salesAgg, purchaseAgg, salesCount, purchasesCount] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        status: posted,
        ...warehouseFilter,
        ...(invoiceDate ? { invoiceDate } : {}),
      },
      include: {
        lines: { include: { product: true } },
      },
    }),
    prisma.salesReturn.findMany({
      where: {
        ...warehouseFilter,
        ...(invoiceDate ? { returnDate: invoiceDate } : {}),
      },
      include: {
        salesInvoice: { include: { lines: true } },
        lines: { include: { product: true } },
      },
    }),
    warehouseIds?.length
      ? Promise.resolve([] as { amount: number }[])
      : prisma.expense.findMany({
          where: expenseDate ? { expenseDate } : undefined,
          select: { amount: true },
        }),
    prisma.salesInvoice.aggregate({ where: salesWhere, _sum: { total: true } }),
    prisma.purchaseInvoice.aggregate({ where: purchaseWhere, _sum: { total: true } }),
    prisma.salesInvoice.count({ where: salesWhere }),
    prisma.purchaseInvoice.count({ where: purchaseWhere }),
  ]);

  let revenue = 0;
  let cogs = 0;

  for (const inv of saleInvoices) {
    for (const line of inv.lines) {
      const unitCost = line.unitCost || line.product.costPrice || 0;
      revenue += line.total;
      cogs += line.quantity * unitCost;
    }
    if (inv.discount > 0.009) revenue -= inv.discount;
    if (inv.tax > 0.009) revenue += inv.tax;
  }

  for (const ret of returnRows) {
    for (const line of ret.lines) {
      const fromInvoice = !line.unitCost && ret.salesInvoice
        ? sliceInvoiceCost(ret.salesInvoice.lines, line.productId)
        : 0;
      const unitCost = line.unitCost || fromInvoice || line.product.costPrice || 0;
      revenue -= line.total;
      cogs -= line.quantity * unitCost;
    }
  }

  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  revenue = money(revenue);
  cogs = money(cogs);
  const expensesRounded = money(expenseTotal);
  const grossProfit = money(revenue - cogs);
  const netProfit = money(revenue - cogs - expensesRounded);
  const distributableProfit = money(Math.max(0, netProfit));

  return {
    from: from || null,
    to: to || null,
    revenue,
    cogs,
    expenses: expensesRounded,
    grossProfit,
    netProfit,
    distributableProfit,
    salesTotal: money(salesAgg._sum.total || 0),
    purchasesTotal: money(purchaseAgg._sum.total || 0),
    salesCount,
    purchasesCount,
  };
}

export type PartnerShareRow = {
  partnerId: string;
  code: string;
  name: string;
  phone: string | null;
  sharePercent: number;
  profitShare: number;
  withdrawn: number;
  remaining: number;
  lifetimeProfitShare: number;
  lifetimeWithdrawn: number;
  /** المتبقي الحقيقي المستحق = أرباحه التراكمية − كل سحوباته */
  lifetimeRemaining: number;
};
