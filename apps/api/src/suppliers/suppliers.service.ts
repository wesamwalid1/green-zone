import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { autoCode } from '../common/auto-code';
import { pageResult, readPage } from '../common/paging';
import { partyWarehouseWhere } from '../common/warehouse-scope';
import { money, type StatementRow, withRunningBalance } from '../common/party-statement';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  private async syncWarehouses(supplierId: string, warehouseIds?: string[]) {
    if (warehouseIds === undefined) return;
    const unique = [...new Set(warehouseIds.map((id) => id.trim()).filter(Boolean))];
    await this.prisma.supplierWarehouse.deleteMany({ where: { supplierId } });
    if (unique.length) {
      await this.prisma.supplierWarehouse.createMany({
        data: unique.map((warehouseId) => ({ supplierId, warehouseId })),
      });
    }
  }

  async findAll(query?: { search?: string; page?: string; pageSize?: string; balance?: string; warehouseIds?: string[] | null }) {
    const page = readPage(query);
    const scope = partyWarehouseWhere(query?.warehouseIds || undefined);
    const searchWhere = query?.search
      ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
      : undefined;
    const balanceWhere = query?.balance === 'debit'
      ? { balance: { gt: 0 } }
      : query?.balance === 'credit'
        ? { balance: { lt: 0 } }
        : undefined;
    const parts = [scope, searchWhere, balanceWhere].filter(Boolean) as Prisma.SupplierWhereInput[];
    const where: Prisma.SupplierWhereInput = parts.length > 1 ? { AND: parts } : parts[0] || {};
    const include = { warehouses: { include: { warehouse: true } } };
    if (!page) return this.prisma.supplier.findMany({ where, include, orderBy: { name: 'asc' } });
    const [total, items, all] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({ where, include, orderBy: { name: 'asc' }, skip: page.skip, take: page.take }),
      this.prisma.supplier.findMany({ where: scope || {}, select: { balance: true } }),
    ]);
    return pageResult(items, total, page, {
      summary: {
        debitCount: all.filter((row) => row.balance > 0).length,
        creditCount: all.filter((row) => row.balance < 0).length,
      },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: { warehouses: { include: { warehouse: true } } },
    });
    if (!s) throw new NotFoundException('المورد غير موجود');
    return s;
  }

  async create(data: {
    code?: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    notes?: string;
    warehouseIds?: string[];
  }) {
    const { warehouseIds, ...rest } = data;
    const unique = [...new Set((warehouseIds || []).map((id) => id.trim()).filter(Boolean))];
    return this.prisma.supplier.create({
      data: {
        ...rest,
        code: autoCode('S', rest.code),
        warehouses: unique.length ? { create: unique.map((warehouseId) => ({ warehouseId })) } : undefined,
      },
      include: { warehouses: { include: { warehouse: true } } },
    });
  }

  async update(id: string, data: Partial<{
    code: string; name: string; phone: string; email: string; address: string; notes: string; isActive: boolean;
    warehouseIds: string[];
  }>) {
    const { warehouseIds, ...rest } = data;
    await this.syncWarehouses(id, warehouseIds);
    const patch = { ...rest };
    if (patch.code !== undefined) patch.code = autoCode('S', patch.code);
    return this.prisma.supplier.update({
      where: { id },
      data: patch,
      include: { warehouses: { include: { warehouse: true } } },
    });
  }

  async statement(id: string) {
    const methods = await this.prisma.payMethod.findMany();
    const methodName = (value?: string | null) => methods.find((m) => m.id === value)?.name || null;
    const supplier = await this.findOne(id);
    const purchases = await this.prisma.purchaseInvoice.findMany({
      where: { supplierId: id, status: { not: 'CANCELLED' } },
      include: {
        lines: { include: { product: { select: { name: true, sku: true } } } },
        warehouse: { select: { name: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });
    const payments = await this.prisma.payment.findMany({
      where: { supplierId: id },
      include: { purchaseInvoice: { select: { number: true } } },
      orderBy: { paidAt: 'asc' },
    });
    const returns = await this.prisma.purchaseReturn.findMany({
      where: { supplierId: id },
      include: { purchaseInvoice: { select: { number: true } } },
      orderBy: { returnDate: 'asc' },
    });

    const rows: StatementRow[] = [];

    for (const p of purchases) {
      const due = money(Math.max(0, p.total - p.paidAmount));
      const via = methodName(p.paymentMethod);
      const groupKey = `purchase:${p.id}`;
      const lines = p.lines.length
        ? p.lines
        : [{
            product: { name: '—', sku: null as string | null },
            quantity: 0,
            netWeight: null as number | null,
            unitCost: 0,
            total: money(p.total),
          }];
      lines.forEach((l, idx) => {
        const first = idx === 0;
        const last = idx === lines.length - 1;
        const weight = l.netWeight != null && Number(l.netWeight) > 0 ? Number(l.netWeight) : null;
        rows.push({
          date: p.invoiceDate,
          type: 'شراء',
          ref: p.number,
          description: first
            ? `فاتورة شراء ${p.number}${p.warehouse?.name ? ` · ${p.warehouse.name}` : ''}`
            : `↳ بند من ${p.number}`,
          debit: first ? money(p.total) : 0,
          credit: 0,
          method: first ? via : null,
          note: first ? (p.notes || null) : null,
          invoiceTotal: first ? money(p.total) : null,
          invoicePaid: first ? money(p.paidAmount) : null,
          invoiceDue: first ? due : null,
          productName: l.product?.name || '—',
          quantity: Number(l.quantity) || 0,
          weight,
          unitPrice: money(Number(l.unitCost) || 0),
          lineTotal: money(Number(l.total) || 0),
          groupKey,
          isGroupFirst: first,
          isGroupLast: last,
        });
      });
    }

    for (const p of payments) {
      const isAdvance = !p.purchaseInvoiceId;
      const isSettlement = (p.note || '').includes('دفعة مقدمة') || (p.paymentMethod || '') === 'PREPAID';
      const type = isAdvance ? 'دفعة مقدمة' : isSettlement && !p.cashAccountId ? 'تسوية من رصيد مقدم' : 'سداد';
      const via = methodName(p.paymentMethod) || (p.paymentMethod === 'PREPAID' ? 'رصيد مقدم' : null);
      rows.push({
        date: p.paidAt,
        type,
        ref: p.number,
        description: isAdvance
          ? `دفعة مقدمة${via ? ` عبر ${via}` : ''}`
          : `سداد${via ? ` عبر ${via}` : ''}`,
        debit: 0,
        credit: money(p.amount),
        method: via,
        note: [p.note, p.referenceNo ? `مرجع: ${p.referenceNo}` : null].filter(Boolean).join(' — ') || null,
      });
    }

    for (const r of returns) {
      rows.push({
        date: r.returnDate,
        type: 'مرتجع',
        ref: r.number,
        description: 'مرتجع',
        debit: 0,
        credit: money(r.total),
        note: r.notes,
      });
    }

    const { statement, totals } = withRunningBalance(rows);
    const prepaid = Math.max(0, money(-supplier.balance));
    return {
      supplier,
      statement,
      balance: supplier.balance,
      totals,
      prepaid,
      meaning: supplier.balance > 0.009
        ? 'مدين للمورد'
        : supplier.balance < -0.009
          ? 'دائن عند المورد (دفع مقدم)'
          : 'الرصيد متعادل',
    };
  }
}
