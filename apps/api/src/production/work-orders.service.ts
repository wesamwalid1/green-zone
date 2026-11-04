import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerProdOrderStatus, StockMovementType, WorkOrderStatus } from '@prisma/client';
import { postStockLine } from '../common/invoice-post';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

const WO_INCLUDE = {
  createdBy: { select: { id: true, fullName: true, username: true } },
  orders: {
    include: {
      customer: { select: { id: true, name: true, code: true, phone: true } },
      engineer: { select: { id: true, fullName: true, jobTitle: true } },
      salesInvoice: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
      lines: {
        include: { product: { select: { id: true, name: true, sku: true, unit: true, costPrice: true } } },
        orderBy: { sortOrder: 'asc' as const },
      },
    },
    orderBy: { orderDate: 'asc' as const },
  },
};

@Injectable()
export class WorkOrdersService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
    private sales: SalesService,
  ) {}

  private summarize<T extends {
    orders: Array<{
      totalCost: number;
      paidAmount: number;
      customer: { id: string; name: string };
      lines: unknown[];
    }>;
  }>(row: T) {
    const totalCost = row.orders.reduce((s, o) => s + (Number(o.totalCost) || 0), 0);
    const paidAmount = row.orders.reduce((s, o) => s + (Number(o.paidAmount) || 0), 0);
    const customers = [...new Map(row.orders.map((o) => [o.customer.id, o.customer.name])).entries()].map(
      ([id, name]) => ({ id, name }),
    );
    const lineCount = row.orders.reduce((s, o) => s + o.lines.length, 0);
    return {
      ...row,
      summary: {
        orderCount: row.orders.length,
        lineCount,
        totalCost,
        paidAmount,
        remaining: Math.max(0, totalCost - paidAmount),
        customers,
      },
    };
  }

  list() {
    return this.prisma.workOrder
      .findMany({
        include: WO_INCLUDE,
        orderBy: { orderDate: 'desc' },
        take: 200,
      })
      .then((rows) => rows.map((row) => this.summarize(row)));
  }

  async get(id: string) {
    const row = await this.prisma.workOrder.findUnique({
      where: { id },
      include: WO_INCLUDE,
    });
    if (!row) throw new NotFoundException('أمر التشغيل غير موجود');
    return this.summarize(row);
  }

  async create(data: { orderIds: string[]; notes?: string; createdById?: string }) {
    const orderIds = [...new Set((data.orderIds || []).filter(Boolean))];
    if (!orderIds.length) throw new BadRequestException('اختر أوردر إنتاج واحداً على الأقل');

    const orders = await this.prisma.customerProdOrder.findMany({
      where: { id: { in: orderIds } },
    });
    if (orders.length !== orderIds.length) throw new BadRequestException('أوردر إنتاج غير موجود');
    for (const order of orders) {
      if (order.workOrderId) throw new BadRequestException(`الأوردر ${order.number} مربوط مسبقاً`);
      if (
        order.status === CustomerProdOrderStatus.CANCELLED ||
        order.status === CustomerProdOrderStatus.DELIVERED ||
        order.status === CustomerProdOrderStatus.IN_RUN
      ) {
        throw new BadRequestException(`حالة الأوردر ${order.number} غير مناسبة للتجميع`);
      }
    }

    const number = await this.sequence.next('work_orders', 'WO');
    const row = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          number,
          notes: data.notes?.trim() || null,
          createdById: data.createdById || null,
          status: WorkOrderStatus.OPEN,
        },
      });
      await tx.customerProdOrder.updateMany({
        where: { id: { in: orderIds } },
        data: { workOrderId: wo.id, status: CustomerProdOrderStatus.IN_RUN },
      });
      return tx.workOrder.findUnique({ where: { id: wo.id }, include: WO_INCLUDE });
    });
    return this.summarize(row!);
  }

  async updateStatus(id: string, status: WorkOrderStatus, actorUserId?: string) {
    const existing = await this.get(id);
    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw new BadRequestException('أمر التشغيل ملغى');
    }
    if (existing.status === WorkOrderStatus.DONE && status !== WorkOrderStatus.DONE) {
      throw new BadRequestException('أمر التشغيل مغلق');
    }

    if (status === WorkOrderStatus.CANCELLED) {
      if (existing.status === WorkOrderStatus.DONE) {
        throw new BadRequestException('لا يمكن إلغاء أمر مُنجَز');
      }
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.customerProdOrder.updateMany({
          where: { workOrderId: id, status: CustomerProdOrderStatus.IN_RUN },
          data: { workOrderId: null, status: CustomerProdOrderStatus.CONFIRMED },
        });
        return tx.workOrder.update({
          where: { id },
          data: { status: WorkOrderStatus.CANCELLED },
          include: WO_INCLUDE,
        });
      });
      return this.summarize(row);
    }

    if (status === WorkOrderStatus.DONE) {
      return this.completeAndInvoice(id, actorUserId);
    }

    const row = await this.prisma.workOrder.update({
      where: { id },
      data: { status },
      include: WO_INCLUDE,
    });
    return this.summarize(row);
  }

  async addOrders(id: string, orderIds: string[]) {
    const wo = await this.get(id);
    if (wo.status === WorkOrderStatus.DONE || wo.status === WorkOrderStatus.CANCELLED) {
      throw new BadRequestException('لا يمكن إضافة أوردرات لأمر مغلق');
    }
    const ids = [...new Set((orderIds || []).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('اختر أوردرات');

    const orders = await this.prisma.customerProdOrder.findMany({ where: { id: { in: ids } } });
    if (orders.length !== ids.length) throw new BadRequestException('أوردر غير موجود');
    for (const order of orders) {
      if (order.workOrderId) throw new BadRequestException(`الأوردر ${order.number} مربوط مسبقاً`);
      if (
        order.status === CustomerProdOrderStatus.CANCELLED ||
        order.status === CustomerProdOrderStatus.DELIVERED
      ) {
        throw new BadRequestException(`حالة الأوردر ${order.number} غير مناسبة`);
      }
    }

    await this.prisma.customerProdOrder.updateMany({
      where: { id: { in: ids } },
      data: { workOrderId: id, status: CustomerProdOrderStatus.IN_RUN },
    });
    if (wo.status === WorkOrderStatus.OPEN) {
      await this.prisma.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.IN_PROGRESS },
      });
    }
    return this.get(id);
  }

  async removeOrder(id: string, orderId: string) {
    const wo = await this.get(id);
    if (wo.status === WorkOrderStatus.DONE || wo.status === WorkOrderStatus.CANCELLED) {
      throw new BadRequestException('لا يمكن فك أوردر من أمر مغلق');
    }
    const order = wo.orders.find((o) => o.id === orderId);
    if (!order) throw new NotFoundException('الأوردر غير موجود في أمر التشغيل');
    await this.prisma.customerProdOrder.update({
      where: { id: orderId },
      data: { workOrderId: null, status: CustomerProdOrderStatus.CONFIRMED },
    });
    return this.get(id);
  }

  private async resolveWarehouseId() {
    const preferred = await this.prisma.warehouse.findFirst({
      where: { isActive: true, kind: 'GENERAL' },
      orderBy: { createdAt: 'asc' },
    });
    if (preferred) return preferred.id;
    const any = await this.prisma.warehouse.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!any) throw new BadRequestException('لا يوجد مخزن نشط لإصدار فاتورة التسليم');
    return any.id;
  }

  private async resolvePayMethodId() {
    const method = await this.prisma.payMethod.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!method) throw new BadRequestException('لا توجد طريقة دفع نشطة لتحصيل مدفوعات الأوردر');
    return method.id;
  }

  /** عند إقفال أمر التشغيل: استلام مخزني ثم فاتورة مبيعات + تحصيل من مدفوع الأوردر */
  private async completeAndInvoice(id: string, actorUserId?: string) {
    const wo = await this.get(id);
    if (!wo.orders.length) throw new BadRequestException('أمر التشغيل فارغ');
    const warehouseId = await this.resolveWarehouseId();
    const methodId = await this.resolvePayMethodId();

    for (const order of wo.orders) {
      if (order.status === CustomerProdOrderStatus.DELIVERED && order.salesInvoiceId) continue;
      if (!order.lines.length) {
        throw new BadRequestException(`الأوردر ${order.number} بدون بنود`);
      }

      await this.prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
          const bal = await tx.stockBalance.findUnique({
            where: { warehouseId_productId: { warehouseId, productId: line.productId } },
          });
          const have = bal?.quantity ?? 0;
          const need = Math.max(0, line.quantity - have);
          if (need > 0.0001) {
            await postStockLine(tx, {
              warehouseId,
              productId: line.productId,
              quantity: need,
              unitCost: Number(line.product.costPrice) || Number(line.unitPrice) || 0,
              type: StockMovementType.PRODUCTION_IN,
              reference: `WO:${wo.number}/PO:${order.number}`,
              direction: 'in',
              note: `استلام من تصنيع خارجي — ${order.number}`,
              productName: line.product.name,
            });
          }
        }
      });

      const paid = Math.max(0, Number(order.paidAmount) || 0);
      const invoice = await this.sales.create({
        customerId: order.customerId,
        warehouseId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        notes: `تسليم أمر تشغيل ${wo.number} / أوردر ${order.number}${
          order.paymentMethods ? ` — دفع: ${order.paymentMethods}` : ''
        }`,
        confirm: true,
        createdById: actorUserId,
        payments: paid > 0 ? [{ methodId, amount: paid }] : undefined,
        lines: order.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });

      await this.prisma.customerProdOrder.update({
        where: { id: order.id },
        data: {
          status: CustomerProdOrderStatus.DELIVERED,
          salesInvoiceId: invoice.id,
        },
      });
    }

    const row = await this.prisma.workOrder.update({
      where: { id },
      data: { status: WorkOrderStatus.DONE },
      include: WO_INCLUDE,
    });
    return this.summarize(row);
  }

  async remove(id: string) {
    const existing = await this.get(id);
    if (existing.status === WorkOrderStatus.DONE) {
      throw new BadRequestException('لا يمكن حذف أمر مُنجَز');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customerProdOrder.updateMany({
        where: { workOrderId: id, status: CustomerProdOrderStatus.IN_RUN },
        data: { workOrderId: null, status: CustomerProdOrderStatus.CONFIRMED },
      });
      await tx.workOrder.delete({ where: { id } });
    });
    return { ok: true };
  }
}
