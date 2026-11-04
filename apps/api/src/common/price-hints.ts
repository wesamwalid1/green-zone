import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PriceRow = { productId: string; price: number };

async function latestPrice(
  prisma: PrismaService,
  lineTable: 'SalesInvoiceLine' | 'PurchaseInvoiceLine',
  invoiceTable: 'SalesInvoice' | 'PurchaseInvoice',
  priceColumn: 'unitPrice' | 'unitCost',
  filters: Prisma.Sql[],
) {
  const where = Prisma.join(
    [Prisma.sql`i.status IN ('CONFIRMED', 'PARTIAL', 'PAID')`, ...filters],
    ' AND ',
  );
  return prisma.$queryRaw<PriceRow[]>`
    SELECT productId, price FROM (
      SELECT l.productId AS productId, l.${Prisma.raw(priceColumn)} AS price,
        ROW_NUMBER() OVER (PARTITION BY l.productId ORDER BY i.invoiceDate DESC, i.createdAt DESC) AS rn
      FROM ${Prisma.raw(lineTable)} l
      INNER JOIN ${Prisma.raw(invoiceTable)} i ON i.id = l.invoiceId
      WHERE ${where}
    ) ranked
    WHERE rn = 1
  `;
}

function indexPrices(rows: PriceRow[]) {
  return new Map(rows.map((row) => [row.productId, row.price]));
}

export async function salePriceHints(prisma: PrismaService, customerId?: string, excludeInvoiceId?: string) {
  const customerFilters = [
    ...(customerId ? [Prisma.sql`i.customerId = ${customerId}`] : []),
    ...(excludeInvoiceId ? [Prisma.sql`i.id <> ${excludeInvoiceId}`] : []),
  ];
  const [purchases, customerSales] = await Promise.all([
    latestPrice(prisma, 'PurchaseInvoiceLine', 'PurchaseInvoice', 'unitCost', []),
    customerId
      ? latestPrice(prisma, 'SalesInvoiceLine', 'SalesInvoice', 'unitPrice', customerFilters)
      : Promise.resolve([]),
  ]);
  const lastPurchase = indexPrices(purchases);
  const lastCustomer = indexPrices(customerSales);
  const ids = new Set([...lastPurchase.keys(), ...lastCustomer.keys()]);
  return [...ids].map((productId) => ({
    productId,
    lastPurchase: lastPurchase.get(productId) ?? null,
    lastCustomer: lastCustomer.get(productId) ?? null,
  }));
}

export async function purchasePriceHints(prisma: PrismaService, supplierId?: string, excludeInvoiceId?: string) {
  const supplierFilters = [
    ...(supplierId ? [Prisma.sql`i.supplierId = ${supplierId}`] : []),
    ...(excludeInvoiceId ? [Prisma.sql`i.id <> ${excludeInvoiceId}`] : []),
  ];
  const [supplierBuys, sales] = await Promise.all([
    supplierId
      ? latestPrice(prisma, 'PurchaseInvoiceLine', 'PurchaseInvoice', 'unitCost', supplierFilters)
      : Promise.resolve([]),
    latestPrice(prisma, 'SalesInvoiceLine', 'SalesInvoice', 'unitPrice', []),
  ]);
  const lastSupplier = indexPrices(supplierBuys);
  const lastSale = indexPrices(sales);
  const ids = new Set([...lastSupplier.keys(), ...lastSale.keys()]);
  return [...ids].map((productId) => ({
    productId,
    lastSupplier: lastSupplier.get(productId) ?? null,
    lastSale: lastSale.get(productId) ?? null,
  }));
}
