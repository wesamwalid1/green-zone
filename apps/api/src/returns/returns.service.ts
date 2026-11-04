import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import { pageResult, readPage } from '../common/paging';

function sliceCost(
  lines: { productId: string; quantity: number; unitCost: number }[],
  productId: string,
  skip: number,
  quantity: number,
) {
  let leftSkip = skip;
  let left = quantity;
  let costSum = 0;
  let taken = 0;
  for (const line of lines) {
    if (line.productId !== productId) continue;
    let available = line.quantity;
    if (leftSkip > 0) {
      const used = Math.min(leftSkip, available);
      leftSkip -= used;
      available -= used;
    }
    if (available <= 0) continue;
    const take = Math.min(available, left);
    costSum += take * (line.unitCost || 0);
    taken += take;
    left -= take;
    if (left <= 0.0001) break;
  }
  if (taken <= 0.0001 || costSum <= 0) return null;
  return Math.round((costSum / taken) * 10000) / 10000;
}

@Injectable()
export class ReturnsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  async onModuleInit() {
    const pending = await this.prisma.salesReturnLine.findFirst({
      where: { OR: [{ unitCost: null }, { unitCost: 0 }], salesReturn: { salesInvoiceId: { not: null } } },
      select: { id: true },
    });
    if (!pending) return;
    const returns = await this.prisma.salesReturn.findMany({
      where: { salesInvoiceId: { not: null } },
      include: { lines: true, salesInvoice: { include: { lines: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(returns.flatMap((row) => row.lines.map((line) => line.productId)))] } },
      select: { id: true, costPrice: true },
    });
    const currentCost = new Map(products.map((product) => [product.id, product.costPrice || 0]));
    const skip = new Map<string, number>();
    for (const row of returns) {
      for (const line of row.lines) {
        const key = `${row.salesInvoiceId}:${line.productId}`;
        const computed = sliceCost(row.salesInvoice?.lines || [], line.productId, skip.get(key) || 0, line.quantity) ?? currentCost.get(line.productId) ?? 0;
        const unitCost = line.unitCost && line.unitCost > 0 ? line.unitCost : computed;
        skip.set(key, (skip.get(key) || 0) + line.quantity);
        if (line.unitCost === unitCost) continue;
        await this.prisma.salesReturnLine.update({ where: { id: line.id }, data: { unitCost } });
        await this.prisma.stockMovement.updateMany({
          where: { reference: row.number, productId: line.productId, type: StockMovementType.SALE_RETURN },
          data: { unitCost },
        });
      }
    }
  }

  async listSalesReturns(query?: { page?: string; pageSize?: string; q?: string }) {
    const page = readPage(query);
    const where = query?.q
      ? { OR: [{ number: { contains: query.q } }, { customer: { name: { contains: query.q } } }, { warehouse: { name: { contains: query.q } } }, { salesInvoice: { number: { contains: query.q } } }] }
      : undefined;
    const include = { customer: true, warehouse: true, salesInvoice: true, lines: { include: { product: true } } };
    if (!page) return this.prisma.salesReturn.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const [total, items, all] = await Promise.all([
      this.prisma.salesReturn.count({ where }),
      this.prisma.salesReturn.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.salesReturn.findMany({ select: { total: true, returnDate: true } }),
    ]);
    const month = all.filter((row) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(row.returnDate).slice(0, 7) === monthKey);
    return pageResult(items, total, page, {
      summary: { count: all.length, amount: all.reduce((sum, row) => sum + row.total, 0), monthCount: month.length, monthAmount: month.reduce((sum, row) => sum + row.total, 0) },
    });
  }

  async listPurchaseReturns(query?: { page?: string; pageSize?: string; q?: string }) {
    const page = readPage(query);
    const where = query?.q
      ? { OR: [{ number: { contains: query.q } }, { supplier: { name: { contains: query.q } } }, { warehouse: { name: { contains: query.q } } }, { purchaseInvoice: { number: { contains: query.q } } }] }
      : undefined;
    const include = { supplier: true, warehouse: true, purchaseInvoice: true, lines: { include: { product: true } } };
    if (!page) return this.prisma.purchaseReturn.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    const [total, items, all] = await Promise.all([
      this.prisma.purchaseReturn.count({ where }),
      this.prisma.purchaseReturn.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.purchaseReturn.findMany({ select: { total: true } }),
    ]);
    return pageResult(items, total, page, {
      summary: { count: all.length, amount: all.reduce((sum, row) => sum + row.total, 0) },
    });
  }

  async salesReturnable(customerId: string) {
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        customerId,
        status: { in: ['CONFIRMED', 'PARTIAL', 'PAID'] },
      },
      include: {
        lines: { include: { product: true } },
        warehouse: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const returns = await this.prisma.salesReturn.findMany({
      where: { customerId },
      include: { lines: true },
    });

    const linked = new Map<string, number>();
    const unlinked = new Map<string, number>();
    for (const r of returns) {
      for (const line of r.lines) {
        if (r.salesInvoiceId) {
          const key = `${r.salesInvoiceId}:${line.productId}`;
          linked.set(key, (linked.get(key) || 0) + line.quantity);
        } else {
          unlinked.set(line.productId, (unlinked.get(line.productId) || 0) + line.quantity);
        }
      }
    }

    const grouped = invoices.map((inv) => {
      const byProduct = new Map<string, {
        productId: string; sku: string; name: string; unit: string;
        quantity: number; unitPrice: number;
      }>();
      for (const line of inv.lines) {
        const existing = byProduct.get(line.productId);
        if (!existing) {
          byProduct.set(line.productId, {
            productId: line.productId,
            sku: line.product.sku,
            name: line.product.name,
            unit: line.product.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          });
        } else {
          existing.quantity += line.quantity;
        }
      }

      const lines = Array.from(byProduct.values()).map((line) => {
        let returnedQty = linked.get(`${inv.id}:${line.productId}`) || 0;
        const loose = unlinked.get(line.productId) || 0;
        const room = Math.max(0, line.quantity - returnedQty);
        const take = Math.min(room, loose);
        returnedQty += take;
        unlinked.set(line.productId, loose - take);
        const remainingQty = Math.max(0, line.quantity - returnedQty);
        return { ...line, returnedQty, remainingQty };
      }).filter((line) => line.remainingQty > 0);

      return {
        id: inv.id,
        number: inv.number,
        invoiceDate: inv.invoiceDate,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouse.name,
        total: inv.total,
        lines,
      };
    }).filter((inv) => inv.lines.length > 0)
      .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());

    return { customerId, invoices: grouped };
  }

  async purchasesReturnable(supplierId: string) {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        supplierId,
        status: { in: ['CONFIRMED', 'PARTIAL', 'PAID'] },
      },
      include: {
        lines: { include: { product: true } },
        warehouse: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const returns = await this.prisma.purchaseReturn.findMany({
      where: { supplierId },
      include: { lines: true },
    });

    const linked = new Map<string, number>();
    const unlinked = new Map<string, number>();
    for (const r of returns) {
      for (const line of r.lines) {
        if (r.purchaseInvoiceId) {
          const key = `${r.purchaseInvoiceId}:${line.productId}`;
          linked.set(key, (linked.get(key) || 0) + line.quantity);
        } else {
          unlinked.set(line.productId, (unlinked.get(line.productId) || 0) + line.quantity);
        }
      }
    }

    const grouped = invoices.map((inv) => {
      const byProduct = new Map<string, {
        productId: string; sku: string; name: string; unit: string;
        quantity: number; unitCost: number;
      }>();
      for (const line of inv.lines) {
        const existing = byProduct.get(line.productId);
        if (!existing) {
          byProduct.set(line.productId, {
            productId: line.productId,
            sku: line.product.sku,
            name: line.product.name,
            unit: line.product.unit,
            quantity: line.quantity,
            unitCost: line.unitCost,
          });
        } else {
          existing.quantity += line.quantity;
        }
      }

      const lines = Array.from(byProduct.values()).map((line) => {
        let returnedQty = linked.get(`${inv.id}:${line.productId}`) || 0;
        const loose = unlinked.get(line.productId) || 0;
        const room = Math.max(0, line.quantity - returnedQty);
        const take = Math.min(room, loose);
        returnedQty += take;
        unlinked.set(line.productId, loose - take);
        const remainingQty = Math.max(0, line.quantity - returnedQty);
        return { ...line, returnedQty, remainingQty };
      }).filter((line) => line.remainingQty > 0);

      return {
        id: inv.id,
        number: inv.number,
        invoiceDate: inv.invoiceDate,
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouse.name,
        total: inv.total,
        lines,
      };
    }).filter((inv) => inv.lines.length > 0)
      .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());

    return { supplierId, invoices: grouped };
  }

  async createSalesReturn(data: {
    customerId: string;
    warehouseId: string;
    salesInvoiceId?: string;
    notes?: string;
    lines: { productId: string; quantity: number; unitPrice: number }[];
  }) {
    if (!data.lines?.length) throw new BadRequestException('أضف بنوداً');
    await assertPeriodsOpen(this.prisma, new Date());

    const returnable = await this.salesReturnable(data.customerId);
    const pool = data.salesInvoiceId
      ? returnable.invoices.filter((inv) => inv.id === data.salesInvoiceId)
      : returnable.invoices;
    const remainingByProduct = new Map<string, number>();
    for (const inv of pool) {
      for (const line of inv.lines) {
        remainingByProduct.set(line.productId, (remainingByProduct.get(line.productId) || 0) + line.remainingQty);
      }
    }
    for (const line of data.lines) {
      if (line.quantity <= 0) throw new BadRequestException('كمية الإرجاع يجب أن تكون أكبر من صفر');
      const remaining = remainingByProduct.get(line.productId) || 0;
      if (line.quantity > remaining) {
        throw new BadRequestException(`الكمية المرتجعة أكبر من المتاح للصنف (${remaining})`);
      }
    }

    const number = await this.sequence.next('sales_return', 'SR');
    const products = await this.prisma.product.findMany({
      where: { id: { in: data.lines.map((line) => line.productId) } },
      select: { id: true, costPrice: true },
    });
    const currentCost = new Map(products.map((product) => [product.id, product.costPrice || 0]));
    let invoiceLines: { productId: string; quantity: number; unitCost: number }[] = [];
    const skip = new Map<string, number>();
    if (data.salesInvoiceId) {
      const invoice = await this.prisma.salesInvoice.findUnique({
        where: { id: data.salesInvoiceId },
        include: { lines: true },
      });
      if (!invoice) throw new BadRequestException('فاتورة البيع غير موجودة');
      invoiceLines = invoice.lines;
      const prior = await this.prisma.salesReturn.findMany({
        where: { salesInvoiceId: data.salesInvoiceId },
        include: { lines: true },
      });
      for (const row of prior) {
        for (const line of row.lines) skip.set(line.productId, (skip.get(line.productId) || 0) + line.quantity);
      }
    }
    const lines = data.lines.map((line) => {
      const fromInvoice = data.salesInvoiceId
        ? sliceCost(invoiceLines, line.productId, skip.get(line.productId) || 0, line.quantity)
        : null;
      if (data.salesInvoiceId) skip.set(line.productId, (skip.get(line.productId) || 0) + line.quantity);
      return {
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: fromInvoice ?? currentCost.get(line.productId) ?? 0,
        total: line.quantity * line.unitPrice,
      };
    });
    const total = lines.reduce((s, l) => s + l.total, 0);

    return this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await tx.stockBalance.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: data.warehouseId,
              productId: line.productId,
            },
          },
          create: {
            warehouseId: data.warehouseId,
            productId: line.productId,
            quantity: line.quantity,
          },
          update: { quantity: { increment: line.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: data.warehouseId,
            productId: line.productId,
            type: StockMovementType.SALE_RETURN,
            quantity: line.quantity,
            unitCost: line.unitCost,
            reference: number,
          },
        });
      }
      await tx.customer.update({
        where: { id: data.customerId },
        data: { balance: { decrement: total } },
      });
      return tx.salesReturn.create({
        data: {
          number,
          customerId: data.customerId,
          warehouseId: data.warehouseId,
          salesInvoiceId: data.salesInvoiceId,
          total,
          notes: data.notes,
          lines: { create: lines },
        },
        include: {
          customer: true,
          warehouse: true,
          lines: { include: { product: true } },
        },
      });
    });
  }

  async createPurchaseReturn(data: {
    supplierId: string;
    warehouseId: string;
    purchaseInvoiceId?: string;
    notes?: string;
    lines: { productId: string; quantity: number; unitCost: number }[];
  }) {
    if (!data.lines?.length) throw new BadRequestException('أضف بنوداً');
    await assertPeriodsOpen(this.prisma, new Date());

    const returnable = await this.purchasesReturnable(data.supplierId);
    const pool = data.purchaseInvoiceId
      ? returnable.invoices.filter((inv) => inv.id === data.purchaseInvoiceId)
      : returnable.invoices;
    const remainingByProduct = new Map<string, number>();
    for (const inv of pool) {
      for (const line of inv.lines) {
        remainingByProduct.set(line.productId, (remainingByProduct.get(line.productId) || 0) + line.remainingQty);
      }
    }
    for (const line of data.lines) {
      if (line.quantity <= 0) throw new BadRequestException('كمية الإرجاع يجب أن تكون أكبر من صفر');
      const remaining = remainingByProduct.get(line.productId) || 0;
      if (line.quantity > remaining) {
        throw new BadRequestException(`الكمية المرتجعة أكبر من المتاح للصنف (${remaining})`);
      }
    }

    const number = await this.sequence.next('purchase_return', 'PR');
    const lines = data.lines.map((l) => ({
      ...l,
      total: l.quantity * l.unitCost,
    }));
    const total = lines.reduce((s, l) => s + l.total, 0);

    return this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const bal = await tx.stockBalance.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: data.warehouseId,
              productId: line.productId,
            },
          },
        });
        if (!bal || bal.quantity < line.quantity) {
          throw new BadRequestException('كمية غير كافية لمرتجع الشراء');
        }
        await tx.stockBalance.update({
          where: { id: bal.id },
          data: { quantity: { decrement: line.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: data.warehouseId,
            productId: line.productId,
            type: StockMovementType.PURCHASE_RETURN,
            quantity: -line.quantity,
            unitCost: line.unitCost,
            reference: number,
          },
        });
      }
      await tx.supplier.update({
        where: { id: data.supplierId },
        data: { balance: { decrement: total } },
      });
      return tx.purchaseReturn.create({
        data: {
          number,
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          purchaseInvoiceId: data.purchaseInvoiceId,
          total,
          notes: data.notes,
          lines: { create: lines },
        },
        include: {
          supplier: true,
          warehouse: true,
          lines: { include: { product: true } },
        },
      });
    });
  }
}
