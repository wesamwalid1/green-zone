import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerProdOrderStatus, Role } from '@prisma/client';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';

type LineInput = {
  productId: string;
  quantity: number;
  unitPrice?: number;
  specs?: string | null;
};

const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, code: true, phone: true } },
  engineer: { select: { id: true, fullName: true, jobTitle: true, username: true } },
  workOrder: { select: { id: true, number: true, status: true } },
  salesInvoice: { select: { id: true, number: true, status: true, total: true, paidAmount: true } },
  lines: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    orderBy: { sortOrder: 'asc' as const },
  },
};

@Injectable()
export class ProdOrdersService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  private withRemaining<T extends { totalCost: number; paidAmount: number }>(row: T) {
    const totalCost = Number(row.totalCost) || 0;
    const paidAmount = Number(row.paidAmount) || 0;
    return { ...row, remaining: Math.max(0, totalCost - paidAmount) };
  }

  private normalizeLines(lines?: LineInput[]) {
    if (!lines?.length) throw new BadRequestException('أضف بنداً واحداً على الأقل');
    const normalized = lines.map((line, index) => {
      const productId = (line.productId || '').trim();
      if (!productId) throw new BadRequestException('اختر الصنف في كل بند');
      const quantity = Number(line.quantity) || 0;
      if (!(quantity > 0)) throw new BadRequestException('كمية البند يجب أن تكون أكبر من صفر');
      const unitPrice = Number(line.unitPrice) || 0;
      if (unitPrice < 0) throw new BadRequestException('سعر البند غير صالح');
      return {
        productId,
        quantity,
        unitPrice,
        specs: line.specs?.trim() || null,
        sortOrder: index,
      };
    });
    return normalized;
  }

  private sumLines(lines: { quantity: number; unitPrice: number }[]) {
    return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  }

  list(actor?: { userId: string; role: Role }) {
    // الأوردرات المربوطة بأمر تشغيل تتشال من قائمة أوردر الإنتاج
    const where: {
      workOrderId: null;
      engineerId?: string;
    } = { workOrderId: null };
    if (actor && actor.role !== Role.ADMIN && actor.role !== Role.ACCOUNTANT) {
      where.engineerId = actor.userId;
    }
    return this.prisma.customerProdOrder
      .findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { orderDate: 'desc' },
        take: 400,
      })
      .then((rows) => rows.map((row) => this.withRemaining(row)));
  }

  listAvailableForWorkOrder() {
    return this.prisma.customerProdOrder
      .findMany({
        where: {
          workOrderId: null,
          status: { in: [CustomerProdOrderStatus.CONFIRMED, CustomerProdOrderStatus.DRAFT] },
        },
        include: ORDER_INCLUDE,
        orderBy: { orderDate: 'desc' },
        take: 400,
      })
      .then((rows) => rows.map((row) => this.withRemaining(row)));
  }

  async get(id: string) {
    const row = await this.prisma.customerProdOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundException('أوردر الإنتاج غير موجود');
    return this.withRemaining(row);
  }

  listEngineers() {
    return this.prisma.user.findMany({
      where: { isActive: true, loginLocked: false },
      select: { id: true, fullName: true, jobTitle: true, username: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async create(data: {
    customerId: string;
    engineerId?: string;
    region?: string;
    address?: string;
    paymentMethods?: string;
    totalCost?: number;
    paidAmount?: number;
    orderDate?: string;
    receiveDate?: string;
    notes?: string;
    lines: LineInput[];
    createdById?: string;
  }) {
    if (!data.customerId) throw new BadRequestException('اختر العميل');
    const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new BadRequestException('العميل غير موجود');

    const lines = this.normalizeLines(data.lines);
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true },
    });
    if (products.length !== new Set(lines.map((l) => l.productId)).size) {
      throw new BadRequestException('صنف غير موجود في البنود');
    }

    // المهندس = صاحب الحساب المسجّل دائماً (مش اختيار يدوي)
    const engineerId = data.createdById || null;
    if (!engineerId) throw new BadRequestException('تعذر تحديد المهندس من الحساب');

    const linesTotal = this.sumLines(lines);
    const totalCost = data.totalCost != null && Number(data.totalCost) > 0 ? Number(data.totalCost) : linesTotal;
    const paidAmount = Math.max(0, Number(data.paidAmount) || 0);
    if (paidAmount > totalCost + 0.001) throw new BadRequestException('المدفوع أكبر من التكلفة');

    const number = await this.sequence.next('prod_orders', 'PO');
    const row = await this.prisma.customerProdOrder.create({
      data: {
        number,
        customerId: data.customerId,
        engineerId,
        region: data.region?.trim() || null,
        address: data.address?.trim() || null,
        paymentMethods: data.paymentMethods?.trim() || null,
        totalCost,
        paidAmount,
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        receiveDate: data.receiveDate ? new Date(data.receiveDate) : null,
        notes: data.notes?.trim() || null,
        status: CustomerProdOrderStatus.CONFIRMED,
        createdById: data.createdById || null,
        lines: { create: lines },
      },
      include: ORDER_INCLUDE,
    });
    return this.withRemaining(row);
  }

  async update(
    id: string,
    data: {
      customerId?: string;
      engineerId?: string | null;
      region?: string | null;
      address?: string | null;
      paymentMethods?: string | null;
      totalCost?: number;
      paidAmount?: number;
      orderDate?: string;
      receiveDate?: string | null;
      notes?: string | null;
      status?: CustomerProdOrderStatus;
      lines?: LineInput[];
    },
  ) {
    const existing = await this.get(id);
    if (existing.status === CustomerProdOrderStatus.CANCELLED) {
      throw new BadRequestException('الأوردر ملغى');
    }
    if (existing.status === CustomerProdOrderStatus.DELIVERED) {
      throw new BadRequestException('لا يمكن تعديل أوردر مُسلَّم');
    }
    if (existing.workOrderId && data.lines) {
      throw new BadRequestException('لا يمكن تعديل بنود أوردر مربوط بأمر تشغيل');
    }

    let lines = existing.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      specs: l.specs,
      sortOrder: l.sortOrder,
    }));
    if (data.lines) {
      lines = this.normalizeLines(data.lines);
      const products = await this.prisma.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true },
      });
      if (products.length !== new Set(lines.map((l) => l.productId)).size) {
        throw new BadRequestException('صنف غير موجود في البنود');
      }
    }

    const linesTotal = this.sumLines(lines);
    const totalCost =
      data.totalCost != null ? Number(data.totalCost) : data.lines ? linesTotal : existing.totalCost;
    const paidAmount = data.paidAmount != null ? Math.max(0, Number(data.paidAmount)) : existing.paidAmount;
    if (paidAmount > totalCost + 0.001) throw new BadRequestException('المدفوع أكبر من التكلفة');

    if (data.status === CustomerProdOrderStatus.IN_RUN && !existing.workOrderId) {
      throw new BadRequestException('حالة التشغيل تتم عبر أمر التشغيل فقط');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (data.lines) {
        await tx.customerProdOrderLine.deleteMany({ where: { orderId: id } });
        await tx.customerProdOrderLine.createMany({
          data: lines.map((line) => ({ ...line, orderId: id })),
        });
      }
      return tx.customerProdOrder.update({
        where: { id },
        data: {
          customerId: data.customerId ?? undefined,
          // المهندس ثابت من الحساب عند الإنشاء — لا يتغيّر بالتعديل
          region: data.region === undefined ? undefined : data.region?.trim() || null,
          address: data.address === undefined ? undefined : data.address?.trim() || null,
          paymentMethods:
            data.paymentMethods === undefined ? undefined : data.paymentMethods?.trim() || null,
          totalCost,
          paidAmount,
          orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
          receiveDate:
            data.receiveDate === undefined
              ? undefined
              : data.receiveDate === null
                ? null
                : new Date(data.receiveDate),
          notes: data.notes === undefined ? undefined : data.notes?.trim() || null,
          status: data.status,
        },
        include: ORDER_INCLUDE,
      });
    });
    return this.withRemaining(row);
  }

  async remove(id: string) {
    const existing = await this.get(id);
    if (existing.workOrderId) throw new BadRequestException('الأوردر مربوط بأمر تشغيل');
    if (existing.status === CustomerProdOrderStatus.DELIVERED) {
      throw new BadRequestException('لا يمكن حذف أوردر مُسلَّم');
    }
    await this.prisma.customerProdOrder.delete({ where: { id } });
    return { ok: true };
  }
}
