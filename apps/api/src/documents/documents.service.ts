import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocKind, DocStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { SalesService } from '../sales/sales.service';
import { PurchasesService } from '../purchases/purchases.service';

const PREFIX: Record<DocKind, string> = {
  QUOTATION: 'QUO',
  SALES_ORDER: 'SO',
  PURCHASE_ORDER: 'PO',
};

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
    private sales: SalesService,
    private purchases: PurchasesService,
  ) {}

  list(kind?: DocKind) {
    return this.prisma.tradeDocument.findMany({
      where: kind ? { kind } : undefined,
      include: {
        customer: true,
        supplier: true,
        warehouse: true,
        lines: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    kind: DocKind;
    customerId?: string;
    supplierId?: string;
    warehouseId?: string;
    docDate?: string;
    notes?: string;
    discount?: number;
    taxRate?: number;
    lines: { productId: string; description?: string; quantity: number; unitPrice: number; discount?: number }[];
  }) {
    if (!data.lines?.length) throw new BadRequestException('أضف بنوداً');
    if (data.kind === DocKind.PURCHASE_ORDER && !data.supplierId) {
      throw new BadRequestException('اختر المورد');
    }
    if (data.kind !== DocKind.PURCHASE_ORDER && !data.customerId) {
      throw new BadRequestException('اختر العميل');
    }
    const number = await this.sequence.next(`doc_${data.kind}`, PREFIX[data.kind]);
    const lines = data.lines.map((l) => ({
      productId: l.productId,
      description: l.description?.trim() || null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount || 0,
      total: l.quantity * l.unitPrice - (l.discount || 0),
    }));
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const discount = data.discount || 0;
    const taxRate = data.taxRate || 0;
    const tax = Math.round((subtotal - discount) * taxRate * 100) / 10000;
    const total = subtotal - discount + tax;
    return this.prisma.tradeDocument.create({
      data: {
        kind: data.kind,
        number,
        status: DocStatus.OPEN,
        customerId: data.customerId || null,
        supplierId: data.supplierId || null,
        warehouseId: data.warehouseId || null,
        docDate: data.docDate ? new Date(data.docDate) : new Date(),
        notes: data.notes,
        discount,
        taxRate,
        total,
        lines: { create: lines },
      },
      include: { customer: true, supplier: true, warehouse: true, lines: { include: { product: true } } },
    });
  }

  async cancel(id: string) {
    const doc = await this.prisma.tradeDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('المستند غير موجود');
    if (doc.status === DocStatus.CONVERTED) throw new BadRequestException('المستند اتحول لفاتورة');
    return this.prisma.tradeDocument.update({ where: { id }, data: { status: DocStatus.CANCELLED } });
  }

  async convert(id: string, createdById?: string) {
    const doc = await this.prisma.tradeDocument.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException('المستند غير موجود');
    if (doc.status === DocStatus.CONVERTED) throw new BadRequestException('المستند اتحول قبل كده');
    if (doc.status === DocStatus.CANCELLED) throw new BadRequestException('المستند ملغي');
    if (!doc.warehouseId) throw new BadRequestException('حدد المخزن قبل التحويل');

    const lines = doc.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitCost: l.unitPrice,
      discount: l.discount,
    }));

    const invoice = doc.kind === DocKind.PURCHASE_ORDER
      ? await this.purchases.create({
          supplierId: doc.supplierId!,
          warehouseId: doc.warehouseId,
          discount: doc.discount,
          tax: doc.taxRate,
          notes: `من ${doc.number}`,
          confirm: false,
          createdById,
          lines,
        })
      : await this.sales.create({
          customerId: doc.customerId!,
          warehouseId: doc.warehouseId,
          discount: doc.discount,
          taxRate: doc.taxRate,
          notes: `من ${doc.number}`,
          confirm: false,
          createdById,
          lines,
        });

    await this.prisma.tradeDocument.update({
      where: { id },
      data: { status: DocStatus.CONVERTED, convertedId: invoice.id },
    });
    return invoice;
  }
}
