import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { normalizeTenders, postSupplierTenders, reversePurchaseMoney, sumTenders, syncPurchaseTenders, TenderInput } from '../cash/tenders';
import { assertPeriodsOpen } from '../settings/period-lock';
import { assertPaidFits, lineAmount, paidAmountOf, postStockLine, statusFromPayment, sumLineTotals, taxFromPercent } from '../common/invoice-post';
import { baseUnitPrice, resolveTradeQty } from '../common/trade-units';
import { applySupplierPrepaid } from '../common/supplier-credit';
import { claimRequest, finishRequest, releaseRequest } from '../common/idempotency';
import { pageResult, readPage } from '../common/paging';
import { dueTone } from '../common/due';
import { purchasePriceHints } from '../common/price-hints';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  priceHints(supplierId?: string, excludeInvoiceId?: string) {
    return purchasePriceHints(this.prisma, supplierId, excludeInvoiceId);
  }

  async findAll(query?: { status?: InvoiceStatus; page?: string; pageSize?: string; q?: string; due?: string; warehouseIds?: string[] | null }) {
    const page = readPage(query);
    const where: Prisma.PurchaseInvoiceWhereInput = {};
    if (query?.warehouseIds?.length) where.warehouseId = { in: query.warehouseIds };
    if (query?.due === '1') where.status = { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL] };
    else if (query?.status) where.status = query.status;
    if (query?.q) {
      where.OR = [
        { number: { contains: query.q } },
        { supplier: { name: { contains: query.q } } },
        { warehouse: { name: { contains: query.q } } },
      ];
    }
    const include = {
      supplier: true,
      warehouse: true,
      lines: { include: { product: true } },
      payments: { orderBy: { paidAt: 'asc' as const } },
    };
    if (!page) {
      return this.prisma.purchaseInvoice.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    }
    const [total, items, all] = await Promise.all([
      this.prisma.purchaseInvoice.count({ where }),
      this.prisma.purchaseInvoice.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.purchaseInvoice.findMany({ where, select: { status: true, total: true, paidAmount: true, invoiceDate: true } }),
    ]);
    const live = all.filter((row) => row.status !== InvoiceStatus.CANCELLED && row.status !== InvoiceStatus.DRAFT);
    const summary = { count: all.length, total: 0, paid: 0, due: 0, red: 0, yellow: 0, green: 0 };
    for (const row of live) {
      summary.total += row.total;
      summary.paid += row.paidAmount;
      summary.due += Math.max(0, row.total - row.paidAmount);
    }
    for (const row of all) {
      if (row.status === InvoiceStatus.CANCELLED) continue;
      const tone = dueTone(row.invoiceDate, row.total - row.paidAmount);
      if (tone === 'red' || tone === 'yellow' || tone === 'green') summary[tone] += 1;
    }
    return pageResult(items, total, page, { summary });
  }

  dues(warehouseIds?: string[] | null) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        status: { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL] },
        ...(warehouseIds?.length ? { warehouseId: { in: warehouseIds } } : {}),
      },
      select: { invoiceDate: true, total: true, paidAmount: true, supplierId: true },
    });
  }

  async findOne(id: string) {
    const inv = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        lines: { include: { product: true } },
        payments: true,
        createdBy: { select: { fullName: true } },
      },
    });
    if (!inv) throw new NotFoundException('فاتورة الشراء غير موجودة');
    return inv;
  }

  async create(data: {
    supplierId: string;
    warehouseId: string;
    invoiceDate?: string;
    discount?: number;
    tax?: number;
    notes?: string;
    paidAmount?: number;
    payments?: TenderInput[];
    confirm?: boolean;
    createdById?: string;
    idempotencyKey?: string;
    lines: {
      productId: string;
      quantity: number;
      unitCost: number;
      discount?: number;
      invoiceUnit?: string;
      unitFactor?: number;
      netWeight?: number;
      batchNumber?: string;
      expiryDate?: string;
    }[];
  }) {
    if (!data.lines?.length) throw new BadRequestException('أضف بنوداً للفاتورة');
    const claim = await claimRequest(this.prisma, { key: data.idempotencyKey, scope: 'purchases', userId: data.createdById });
    if (claim.status === 'replay') return this.findOne(claim.resourceId);
    try {
      const invoice = await this.insertPurchase(data);
      await finishRequest(this.prisma, claim.key, invoice.id);
      return invoice;
    } catch (error) {
      await releaseRequest(this.prisma, claim.key);
      throw error;
    }
  }

  private async insertPurchase(data: {
    supplierId: string;
    warehouseId: string;
    invoiceDate?: string;
    discount?: number;
    tax?: number;
    notes?: string;
    paidAmount?: number;
    payments?: TenderInput[];
    confirm?: boolean;
    createdById?: string;
    lines: {
      productId: string;
      quantity: number;
      unitCost: number;
      discount?: number;
      invoiceUnit?: string;
      unitFactor?: number;
      netWeight?: number;
      batchNumber?: string;
      expiryDate?: string;
    }[];
  }) {
    await assertPeriodsOpen(this.prisma, data.invoiceDate || new Date());
    const number = await this.sequence.next('purchases', 'PUR');
    const parts = normalizeTenders(data.payments);
    const lines = data.lines.map((l) => {
      const resolved = resolveTradeQty({
        quantity: l.quantity,
        unitFactor: l.unitFactor,
        netWeight: l.netWeight,
        invoiceUnit: l.invoiceUnit,
      });
      if (!(resolved.invoiceQty > 0) || !(resolved.stockQty > 0)) {
        throw new BadRequestException('كمية البند غير صالحة');
      }
      return {
        productId: l.productId,
        quantity: resolved.invoiceQty,
        unitCost: l.unitCost,
        discount: 0,
        total: lineAmount(resolved.invoiceQty, l.unitCost, 0),
        invoiceUnit: resolved.invoiceUnit,
        unitFactor: resolved.unitFactor,
        netWeight: resolved.legacyWeight ? resolved.stockQty : null,
        batchNumber: null as string | null,
        expiryDate: null as Date | null,
        stockQty: resolved.stockQty,
        stockUnitCost: baseUnitPrice(l.unitCost, resolved.unitFactor),
      };
    });
    const subtotal = sumLineTotals(lines);
    const discount = data.discount || 0;
    const taxPercent = data.tax || 0;
    const tax = taxFromPercent(subtotal, discount, taxPercent);
    const total = subtotal - discount + tax;
    const paidAmount = paidAmountOf(parts, data.paidAmount || 0);
    assertPaidFits(paidAmount, total, !!data.confirm, parts.length);
    const paymentNumbers: string[] = [];
    if (data.confirm) {
      for (let i = 0; i < parts.length; i++) paymentNumbers.push(await this.sequence.next('payments', 'PAY'));
    }

    return this.prisma.$transaction(async (tx) => {
      let status: InvoiceStatus = InvoiceStatus.DRAFT;
      if (data.confirm) {
        status = statusFromPayment(total, paidAmount);
        for (const line of lines) {
          await postStockLine(tx, {
            warehouseId: data.warehouseId,
            productId: line.productId,
            quantity: line.stockQty,
            unitCost: line.stockUnitCost,
            type: StockMovementType.PURCHASE,
            reference: number,
            direction: 'in',
            note: line.invoiceUnit
              ? `${line.quantity} ${line.invoiceUnit}`
              : line.netWeight != null
                ? `وزن صافي: ${line.netWeight}`
                : null,
          });
          await tx.product.update({
            where: { id: line.productId },
            data: { costPrice: line.stockUnitCost },
          });
        }
      }

      const invoice = await tx.purchaseInvoice.create({
        data: {
          number,
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          status,
          invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
          subtotal,
          discount,
          tax,
          total,
          paidAmount,
          paymentMethod: parts.length === 1 ? parts[0].methodId : '',
          notes: data.notes,
          createdById: data.createdById,
          lines: {
            create: lines.map(({ stockQty: _s, stockUnitCost: _c, ...line }) => line),
          },
        },
        include: { supplier: true, warehouse: true, lines: { include: { product: true } } },
      });

      if (data.confirm) {
        if (parts.length) {
          await postSupplierTenders(tx, {
            parts,
            supplierId: data.supplierId,
            purchaseInvoiceId: invoice.id,
            invoiceNumber: number,
            createdById: data.createdById,
            paymentNumbers,
          });
        }
        const credit = await applySupplierPrepaid(tx, {
          supplierId: data.supplierId,
          purchaseInvoiceId: invoice.id,
          invoiceNumber: number,
          invoiceTotal: total,
          alreadyPaid: paidAmount,
          nextPaymentNumber: () => this.sequence.next('payments', 'PAY'),
        });
        if (credit.applied > 0.009) {
          return tx.purchaseInvoice.findUniqueOrThrow({
            where: { id: invoice.id },
            include: { supplier: true, warehouse: true, lines: { include: { product: true } }, payments: true },
          });
        }
      }

      return invoice;
    });
  }

  async confirm(id: string, payments?: TenderInput[]) {
    const inv = await this.findOne(id);
    if (inv.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('الفاتورة ليست مسودة');
    }
    await assertPeriodsOpen(this.prisma, inv.invoiceDate);
    const parts = normalizeTenders(payments);
    const paidAmount = parts.length ? sumTenders(parts) : 0;
    if (paidAmount > inv.total + 0.009) throw new BadRequestException('المدفوع أكبر من إجمالي الفاتورة');
    const paymentNumbers: string[] = [];
    for (let i = 0; i < parts.length; i++) paymentNumbers.push(await this.sequence.next('payments', 'PAY'));
    return this.prisma.$transaction(async (tx) => {
      for (const line of inv.lines) {
        const resolved = resolveTradeQty({
          quantity: line.quantity,
          unitFactor: line.unitFactor,
          netWeight: line.netWeight,
          invoiceUnit: line.invoiceUnit,
        });
        const stockUnitCost = baseUnitPrice(line.unitCost, resolved.unitFactor);
        await postStockLine(tx, {
          warehouseId: inv.warehouseId,
          productId: line.productId,
          quantity: resolved.stockQty,
          unitCost: stockUnitCost,
          type: StockMovementType.PURCHASE,
          reference: inv.number,
          direction: 'in',
          note: line.invoiceUnit
            ? `${line.quantity} ${line.invoiceUnit}`
            : line.netWeight != null
              ? `وزن صافي: ${line.netWeight}`
              : null,
        });
        await tx.product.update({
          where: { id: line.productId },
          data: { costPrice: stockUnitCost },
        });
      }
      if (parts.length) {
        await postSupplierTenders(tx, {
          parts,
          supplierId: inv.supplierId,
          purchaseInvoiceId: inv.id,
          invoiceNumber: inv.number,
          paymentNumbers,
        });
      }
      const status = statusFromPayment(inv.total, paidAmount);
      await tx.purchaseInvoice.update({
        where: { id },
        data: { status, paidAmount, paymentMethod: parts.length === 1 ? parts[0].methodId : '' },
      });
      await applySupplierPrepaid(tx, {
        supplierId: inv.supplierId,
        purchaseInvoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceTotal: inv.total,
        alreadyPaid: paidAmount,
        nextPaymentNumber: () => this.sequence.next('payments', 'PAY'),
      });
      return tx.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        include: { supplier: true, warehouse: true, lines: { include: { product: true } }, payments: true },
      });
    });
  }

  async update(id: string, data: {
    supplierId: string;
    warehouseId: string;
    invoiceDate?: string;
    discount?: number;
    tax?: number;
    notes?: string;
    paidAmount?: number;
    payments?: TenderInput[];
    confirm?: boolean;
    lines: {
      id?: string;
      productId: string;
      quantity: number;
      unitCost: number;
      discount?: number;
      invoiceUnit?: string;
      unitFactor?: number;
      netWeight?: number;
      batchNumber?: string;
      expiryDate?: string;
    }[];
  }) {
    const inv = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { lines: true, payments: true, returns: true },
    });
    if (!inv) throw new NotFoundException('فاتورة الشراء غير موجودة');
    await assertPeriodsOpen(this.prisma, inv.invoiceDate, data.invoiceDate);
    if (inv.returns.length) throw new BadRequestException('لا يمكن تعديل فاتورة عليها مرتجعات');
    if (!data.lines?.length) throw new BadRequestException('أضف بنوداً للفاتورة');

    const lines = data.lines.map((l) => {
      const resolved = resolveTradeQty({
        quantity: l.quantity,
        unitFactor: l.unitFactor,
        netWeight: l.netWeight,
        invoiceUnit: l.invoiceUnit,
      });
      if (!(resolved.invoiceQty > 0) || !(resolved.stockQty > 0)) {
        throw new BadRequestException('كمية البند غير صالحة');
      }
      return {
        id: l.id,
        productId: l.productId,
        quantity: resolved.invoiceQty,
        unitCost: l.unitCost,
        discount: 0,
        total: resolved.invoiceQty * l.unitCost,
        invoiceUnit: resolved.invoiceUnit,
        unitFactor: resolved.unitFactor,
        netWeight: resolved.legacyWeight ? resolved.stockQty : null,
        batchNumber: null as string | null,
        expiryDate: null as Date | null,
        stockQty: resolved.stockQty,
        stockUnitCost: baseUnitPrice(l.unitCost, resolved.unitFactor),
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = data.discount || 0;
    const taxPercent = data.tax || 0;
    const tax = Math.round((subtotal - discount) * taxPercent * 100) / 10000;
    const total = subtotal - discount + tax;
    const parts = data.payments ? normalizeTenders(data.payments) : [];
    const paidAmount = data.payments ? sumTenders(parts) : (data.paidAmount ?? inv.paidAmount);
    if (paidAmount > total + 0.009) throw new BadRequestException('المدفوع أكبر من إجمالي الفاتورة');
    const alreadyPosted = inv.status !== InvoiceStatus.DRAFT;
    const posting = alreadyPosted || !!data.confirm;
    if (posting && paidAmount > 0 && !parts.length) throw new BadRequestException('قسّم المدفوع على طرق الدفع');
    if (alreadyPosted) {
      return this.revisePostedPurchase(
        id,
        inv,
        data,
        lines.map(({ stockQty: _s, stockUnitCost: _c, ...line }) => ({ ...line, stockQty: _s, stockUnitCost: _c })),
        parts,
        subtotal,
        discount,
        tax,
        total,
      );
    }

    const paymentNumbers: string[] = [];
    if (posting) {
      for (let i = 0; i < parts.length; i++) paymentNumbers.push(await this.sequence.next('payments', 'PAY'));
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: id } });

      if (posting) {
        for (const line of lines) {
          await tx.stockBalance.upsert({
            where: { warehouseId_productId: { warehouseId: data.warehouseId, productId: line.productId } },
            create: { warehouseId: data.warehouseId, productId: line.productId, quantity: line.stockQty },
            update: { quantity: { increment: line.stockQty } },
          });
          await tx.stockMovement.create({
            data: {
              warehouseId: data.warehouseId,
              productId: line.productId,
              type: StockMovementType.PURCHASE,
              quantity: line.stockQty,
              unitCost: line.stockUnitCost,
              reference: inv.number,
              note: line.invoiceUnit ? `${line.quantity} ${line.invoiceUnit}` : null,
            },
          });
          await tx.product.update({ where: { id: line.productId }, data: { costPrice: line.stockUnitCost } });
        }
        if (parts.length) {
          await postSupplierTenders(tx, {
            parts,
            supplierId: data.supplierId,
            purchaseInvoiceId: id,
            invoiceNumber: inv.number,
            paymentNumbers,
          });
        }
      }

      const status = !posting
        ? InvoiceStatus.DRAFT
        : paidAmount >= total
          ? InvoiceStatus.PAID
          : paidAmount > 0
            ? InvoiceStatus.PARTIAL
            : InvoiceStatus.CONFIRMED;

      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : inv.invoiceDate,
          subtotal,
          discount,
          tax,
          total,
          paidAmount,
          paymentMethod: parts.length === 1 ? parts[0].methodId : (parts.length ? '' : inv.paymentMethod),
          notes: data.notes,
          status,
          lines: {
            create: lines.map(({ stockQty: _s, stockUnitCost: _c, ...line }) => ({ ...line, id: undefined })),
          },
        },
        include: { supplier: true, warehouse: true, lines: { include: { product: true } }, payments: true },
      });
      if (posting) {
        await applySupplierPrepaid(tx, {
          supplierId: data.supplierId,
          purchaseInvoiceId: id,
          invoiceNumber: inv.number,
          invoiceTotal: total,
          alreadyPaid: paidAmount,
          nextPaymentNumber: () => this.sequence.next('payments', 'PAY'),
        });
        return tx.purchaseInvoice.findUniqueOrThrow({
          where: { id },
          include: { supplier: true, warehouse: true, lines: { include: { product: true } }, payments: true },
        });
      }
      return updated;
    });
  }

  private async revisePostedPurchase(
    id: string,
    inv: {
      number: string;
      supplierId: string;
      warehouseId: string;
      total: number;
      paidAmount: number;
      invoiceDate: Date;
      lines: {
        id: string;
        productId: string;
        quantity: number;
        unitCost: number;
        invoiceUnit?: string | null;
        unitFactor?: number | null;
        netWeight?: number | null;
      }[];
      payments: { id: string; number: string; amount: number; cashAccountId: string | null; paymentMethod: string; referenceNo: string | null }[];
    },
    data: { supplierId: string; warehouseId: string; invoiceDate?: string; notes?: string },
    lines: {
      id?: string;
      productId: string;
      quantity: number;
      unitCost: number;
      discount: number;
      total: number;
      invoiceUnit: string | null;
      unitFactor: number;
      netWeight: number | null;
      batchNumber: string | null;
      expiryDate: Date | null;
      stockQty: number;
      stockUnitCost: number;
    }[],
    parts: TenderInput[],
    subtotal: number,
    discount: number,
    tax: number,
    total: number,
  ) {
    const replacements = parts.filter((part) => {
      if (!part.id) return true;
      const row = inv.payments.find((payment) => payment.id === part.id);
      return !row || row.paymentMethod !== part.methodId;
    }).length;
    const newNumbers: string[] = [];
    for (let i = 0; i < replacements; i++) newNumbers.push(await this.sequence.next('payments', 'PAY'));
    const oldStockLines = inv.lines.map((line) => {
      const resolved = resolveTradeQty({
        quantity: line.quantity,
        unitFactor: line.unitFactor,
        netWeight: line.netWeight,
        invoiceUnit: line.invoiceUnit,
      });
      return {
        productId: line.productId,
        quantity: resolved.stockQty,
        unitCost: baseUnitPrice(line.unitCost, resolved.unitFactor),
      };
    });
    const newStockLines = lines.map((line) => ({
      productId: line.productId,
      quantity: line.stockQty,
      unitCost: line.stockUnitCost,
    }));
    return this.prisma.$transaction(async (tx) => {
      await this.applyPurchaseStockDelta(tx, inv.warehouseId, data.warehouseId, inv.number, oldStockLines, newStockLines);
      const paidAmount = await syncPurchaseTenders(tx, {
        existing: inv.payments,
        parts,
        supplierId: data.supplierId,
        purchaseInvoiceId: id,
        invoiceNumber: inv.number,
        newNumbers,
      });
      if (paidAmount > total + 0.009) throw new BadRequestException('المدفوع أكبر من إجمالي الفاتورة');
      const oldDue = inv.total - inv.paidAmount;
      const newDue = total - paidAmount;
      if (data.supplierId === inv.supplierId) {
        const delta = newDue - oldDue;
        if (Math.abs(delta) >= 0.009) {
          await tx.supplier.update({ where: { id: inv.supplierId }, data: { balance: { increment: delta } } });
        }
      } else {
        if (Math.abs(oldDue) >= 0.009) {
          await tx.supplier.update({ where: { id: inv.supplierId }, data: { balance: { decrement: oldDue } } });
        }
        if (Math.abs(newDue) >= 0.009) {
          await tx.supplier.update({ where: { id: data.supplierId }, data: { balance: { increment: newDue } } });
        }
      }
      const kept = new Set(lines.map((line) => line.id).filter((lineId): lineId is string => !!lineId));
      for (const old of inv.lines) {
        if (!kept.has(old.id)) await tx.purchaseInvoiceLine.delete({ where: { id: old.id } });
      }
      for (const line of lines) {
        const previous = line.id ? inv.lines.find((row) => row.id === line.id) : undefined;
        const row = {
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          discount: line.discount,
          total: line.total,
          invoiceUnit: line.invoiceUnit,
          unitFactor: line.unitFactor,
          netWeight: line.netWeight,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
        };
        if (previous) await tx.purchaseInvoiceLine.update({ where: { id: previous.id }, data: row });
        else await tx.purchaseInvoiceLine.create({ data: { invoiceId: id, ...row } });
        if (!previous || Math.abs(previous.unitCost - line.unitCost) >= 0.009 || Math.abs((previous.unitFactor || 1) - line.unitFactor) >= 0.0001) {
          await tx.product.update({ where: { id: line.productId }, data: { costPrice: line.stockUnitCost } });
        }
      }
      const methods = await tx.payment.findMany({ where: { purchaseInvoiceId: id }, select: { paymentMethod: true } });
      const status = paidAmount >= total - 0.009
        ? InvoiceStatus.PAID
        : paidAmount > 0
          ? InvoiceStatus.PARTIAL
          : InvoiceStatus.CONFIRMED;
      return tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : inv.invoiceDate,
          subtotal,
          discount,
          tax,
          total,
          paidAmount,
          paymentMethod: methods.length === 1 ? methods[0].paymentMethod : '',
          notes: data.notes,
          status,
        },
        include: { supplier: true, warehouse: true, lines: { include: { product: true } }, payments: true },
      });
    });
  }

  private async applyPurchaseStockDelta(
    tx: Prisma.TransactionClient,
    oldWarehouse: string,
    newWarehouse: string,
    reference: string,
    oldLines: { productId: string; quantity: number; unitCost: number }[],
    newLines: { productId: string; quantity: number; unitCost: number }[],
  ) {
    if (oldWarehouse !== newWarehouse) {
      for (const line of oldLines) {
        const bal = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: oldWarehouse, productId: line.productId } },
        });
        if (!bal || bal.quantity < line.quantity) throw new BadRequestException('لا يمكن نقل الفاتورة لأن كمية المخزون أقل من كمية الفاتورة');
        await tx.stockBalance.update({ where: { id: bal.id }, data: { quantity: { decrement: line.quantity } } });
      }
      for (const line of newLines) {
        await tx.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId: newWarehouse, productId: line.productId } },
          create: { warehouseId: newWarehouse, productId: line.productId, quantity: line.quantity },
          update: { quantity: { increment: line.quantity } },
        });
      }
      return;
    }
    const oldQty = new Map<string, number>();
    const newQty = new Map<string, number>();
    for (const line of oldLines) oldQty.set(line.productId, (oldQty.get(line.productId) || 0) + line.quantity);
    for (const line of newLines) newQty.set(line.productId, (newQty.get(line.productId) || 0) + line.quantity);
    for (const productId of new Set([...oldQty.keys(), ...newQty.keys()])) {
      const delta = (newQty.get(productId) || 0) - (oldQty.get(productId) || 0);
      if (Math.abs(delta) < 0.0001) continue;
      if (delta < 0) {
        const bal = await tx.stockBalance.findUnique({
          where: { warehouseId_productId: { warehouseId: oldWarehouse, productId } },
        });
        if (!bal || bal.quantity < -delta) throw new BadRequestException('لا يمكن إنقاص الكمية لأن المخزون أقل من الفرق');
        await tx.stockBalance.update({ where: { id: bal.id }, data: { quantity: { increment: delta } } });
      } else {
        await tx.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId: oldWarehouse, productId } },
          create: { warehouseId: oldWarehouse, productId, quantity: delta },
          update: { quantity: { increment: delta } },
        });
      }
      const sample = newLines.find((line) => line.productId === productId) || oldLines.find((line) => line.productId === productId);
      await tx.stockMovement.create({
        data: {
          warehouseId: oldWarehouse,
          productId,
          type: StockMovementType.ADJUSTMENT,
          quantity: delta,
          unitCost: sample?.unitCost || 0,
          reference,
          note: 'تعديل فاتورة شراء',
        },
      });
    }
  }

  async remove(id: string) {
    const inv = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { lines: true, payments: true, returns: true },
    });
    if (!inv) throw new NotFoundException('فاتورة الشراء غير موجودة');
    await assertPeriodsOpen(this.prisma, inv.invoiceDate);
    if (inv.returns.length) {
      throw new BadRequestException('لا يمكن حذف فاتورة عليها مرتجعات');
    }

    return this.prisma.$transaction(async (tx) => {
      if (inv.status !== InvoiceStatus.DRAFT) {
        for (const line of inv.lines) {
          const stockQty = resolveTradeQty({
            quantity: line.quantity,
            unitFactor: line.unitFactor,
            netWeight: line.netWeight,
            invoiceUnit: line.invoiceUnit,
          }).stockQty;
          const bal = await tx.stockBalance.findUnique({
            where: {
              warehouseId_productId: {
                warehouseId: inv.warehouseId,
                productId: line.productId,
              },
            },
          });
          if (!bal || bal.quantity < stockQty) {
            throw new BadRequestException('لا يمكن الحذف لأن كمية المخزون أقل من كمية الفاتورة');
          }
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: { quantity: { decrement: stockQty } },
          });
        }
        await tx.stockMovement.deleteMany({
          where: {
            reference: inv.number,
            warehouseId: inv.warehouseId,
            type: StockMovementType.PURCHASE,
          },
        });
        const due = inv.total - inv.paidAmount;
        if (due !== 0) {
          await tx.supplier.update({
            where: { id: inv.supplierId },
            data: { balance: { decrement: due } },
          });
        }
        await reversePurchaseMoney(tx, id, inv.payments);
      } else {
        await tx.payment.deleteMany({ where: { purchaseInvoiceId: id } });
      }
      await tx.purchaseInvoice.delete({ where: { id } });
      return { ok: true };
    });
  }
}
