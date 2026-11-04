import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerProdOrderStatus } from '@prisma/client';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProdOrdersService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  list() {
    return this.prisma.customerProdOrder.findMany({
      include: {
        customer: { select: { id: true, name: true, code: true, phone: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: 300,
    });
  }

  async get(id: string) {
    const row = await this.prisma.customerProdOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, code: true, phone: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
    if (!row) throw new NotFoundException('أوردر الإنتاج غير موجود');
    return row;
  }

  async create(data: {
    customerId: string;
    description: string;
    quantity: number;
    unitPrice?: number;
    orderDate?: string;
    deliveryDate?: string;
    notes?: string;
    productId?: string;
    createdById?: string;
  }) {
    if (!data.customerId) throw new BadRequestException('اختر العميل');
    const description = (data.description || '').trim();
    if (description.length < 2) throw new BadRequestException('اكتب البيان');
    const quantity = Number(data.quantity) || 0;
    if (!(quantity > 0)) throw new BadRequestException('أدخل الكمية');

    const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new BadRequestException('العميل غير موجود');

    const number = await this.sequence.next('prod_orders', 'PO');
    return this.prisma.customerProdOrder.create({
      data: {
        number,
        customerId: data.customerId,
        description,
        quantity,
        unitPrice: Number(data.unitPrice) || 0,
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        notes: data.notes?.trim() || null,
        productId: data.productId || null,
        status: CustomerProdOrderStatus.CONFIRMED,
        createdById: data.createdById || null,
      },
      include: {
        customer: { select: { id: true, name: true, code: true, phone: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async update(id: string, data: {
    customerId?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    orderDate?: string;
    deliveryDate?: string | null;
    notes?: string | null;
    productId?: string | null;
    status?: CustomerProdOrderStatus;
  }) {
    const existing = await this.get(id);
    if (existing.status === CustomerProdOrderStatus.CANCELLED) {
      throw new BadRequestException('الأوردر ملغى');
    }
    return this.prisma.customerProdOrder.update({
      where: { id },
      data: {
        customerId: data.customerId ?? undefined,
        description: data.description?.trim() || undefined,
        quantity: data.quantity != null ? Number(data.quantity) : undefined,
        unitPrice: data.unitPrice != null ? Number(data.unitPrice) : undefined,
        orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
        deliveryDate: data.deliveryDate === null ? null : data.deliveryDate ? new Date(data.deliveryDate) : undefined,
        notes: data.notes === undefined ? undefined : (data.notes?.trim() || null),
        productId: data.productId === undefined ? undefined : data.productId,
        status: data.status,
      },
      include: {
        customer: { select: { id: true, name: true, code: true, phone: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.customerProdOrder.delete({ where: { id } });
    return { ok: true };
  }
}
