import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PriceList, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, readPage } from '../common/paging';
import { partyWarehouseWhere } from '../common/warehouse-scope';
import { SequenceService } from '../common/sequence.service';
import { autoCode } from '../common/auto-code';
import { money, type StatementRow, withRunningBalance } from '../common/party-statement';

export const WALK_IN_CODE = 'WALKIN';
export const WALK_IN_NAME = 'عميل سريع';

const DEFAULT_CONTRACT_TERMS = `يتعهد العميل بالتعامل مع شركة Green Zone وفق الشروط المتفق عليها، والالتزام بمواعيد السداد والكميات المعتمدة، ويقر بصحة بياناته الموضحة أعلاه.`;

@Injectable()
export class CustomersService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  async onModuleInit() {
    await this.ensureWalkIn().catch(() => undefined);
  }

  async ensureWalkIn() {
    const named = await this.prisma.customer.findFirst({ where: { name: WALK_IN_NAME } });
    if (named) return named;
    return this.prisma.customer.upsert({
      where: { code: WALK_IN_CODE },
      create: { code: WALK_IN_CODE, name: WALK_IN_NAME, notes: 'عميل نقدي يشتري مرة ويمشي' },
      update: {},
    });
  }

  private async syncWarehouses(customerId: string, warehouseIds?: string[]) {
    if (warehouseIds === undefined) return;
    const unique = [...new Set(warehouseIds.map((id) => id.trim()).filter(Boolean))];
    await this.prisma.customerWarehouse.deleteMany({ where: { customerId } });
    if (unique.length) {
      await this.prisma.customerWarehouse.createMany({
        data: unique.map((warehouseId) => ({ customerId, warehouseId })),
      });
    }
  }

  async ensureByName(name: string, warehouseIds?: string[]) {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new BadRequestException('اسم العميل قصير');
    const existing = await this.prisma.customer.findFirst({
      where: { name: trimmed },
      include: { warehouses: true },
    });
    if (existing) {
      if (warehouseIds?.length && !existing.warehouses.length) {
        await this.syncWarehouses(existing.id, warehouseIds);
      }
      return this.findOne(existing.id);
    }
    const code = `C${Date.now().toString(36).toUpperCase()}`;
    const created = await this.prisma.customer.create({
      data: {
        code,
        name: trimmed,
        warehouses: warehouseIds?.length
          ? { create: [...new Set(warehouseIds)].map((warehouseId) => ({ warehouseId })) }
          : undefined,
      },
      include: { warehouses: { include: { warehouse: true } } },
    });
    return created;
  }

  async findAll(query?: { search?: string; page?: string; pageSize?: string; balance?: string; warehouseIds?: string[] | null }) {
    const page = readPage(query);
    const scope = partyWarehouseWhere(query?.warehouseIds || undefined);
    const searchWhere = query?.search
      ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
      : undefined;
    const balanceWhere = query?.balance === 'debit' ? { balance: { gt: 0 } } : undefined;
    const parts = [scope, searchWhere, balanceWhere].filter(Boolean) as Prisma.CustomerWhereInput[];
    const where: Prisma.CustomerWhereInput = parts.length > 1 ? { AND: parts } : parts[0] || {};
    const include = { warehouses: { include: { warehouse: true } } };
    if (!page) {
      return this.prisma.customer.findMany({ where, include, orderBy: { createdAt: 'desc' } });
    }
    const [total, items, all] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.customer.findMany({ where: scope || {}, select: { balance: true, isActive: true } }),
    ]);
    const summary = {
      debitCount: all.filter((row) => row.balance > 0).length,
      activeCount: all.filter((row) => row.isActive !== false).length,
      totalDue: all.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
    };
    return pageResult(items, total, page, { summary });
  }

  async findOne(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: { warehouses: { include: { warehouse: true } } },
    });
    if (!c) throw new NotFoundException('العميل غير موجود');
    return c;
  }

  async create(data: {
    code?: string;
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    creditLimit?: number;
    priceList?: PriceList;
    notes?: string;
    warehouseIds?: string[];
  }) {
    const { warehouseIds, ...rest } = data;
    const unique = [...new Set((warehouseIds || []).map((id) => id.trim()).filter(Boolean))];
    return this.prisma.customer.create({
      data: {
        ...rest,
        code: autoCode('C', rest.code),
        warehouses: unique.length ? { create: unique.map((warehouseId) => ({ warehouseId })) } : undefined,
      },
      include: { warehouses: { include: { warehouse: true } } },
    });
  }

  bulkSetActive(ids: string[], isActive: boolean) {
    const unique = [...new Set(ids)].slice(0, 200);
    if (!unique.length) return Promise.resolve({ updated: 0 });
    return this.prisma.customer.updateMany({ where: { id: { in: unique } }, data: { isActive } }).then((result) => ({ updated: result.count }));
  }

  async update(id: string, data: Partial<{
    code: string; name: string; phone: string; email: string; address: string;
    creditLimit: number; priceList: PriceList; notes: string; isActive: boolean;
    warehouseIds: string[];
  }>) {
    const { warehouseIds, ...rest } = data;
    await this.syncWarehouses(id, warehouseIds);
    const patch = { ...rest };
    if (patch.code !== undefined) patch.code = autoCode('C', patch.code);
    return this.prisma.customer.update({
      where: { id },
      data: patch,
      include: { warehouses: { include: { warehouse: true } } },
    });
  }

  listPrices(customerId: string) {
    return this.prisma.customerPrice.findMany({
      where: { customerId },
      include: { product: true },
    });
  }

  async setPrices(customerId: string, prices: { productId: string; price: number }[]) {
    await this.findOne(customerId);
    await this.prisma.customerPrice.deleteMany({ where: { customerId } });
    const rows = prices.filter((p) => p.price > 0);
    if (rows.length) {
      await this.prisma.customerPrice.createMany({
        data: rows.map((p) => ({ customerId, productId: p.productId, price: p.price })),
      });
    }
    return this.listPrices(customerId);
  }

  async statement(id: string) {
    const methods = await this.prisma.payMethod.findMany();
    const methodName = (value?: string | null) => methods.find((m) => m.id === value)?.name || null;
    const customer = await this.findOne(id);
    const sales = await this.prisma.salesInvoice.findMany({
      where: { customerId: id, status: { not: 'CANCELLED' } },
      include: {
        lines: { include: { product: { select: { name: true, sku: true } } } },
        warehouse: { select: { name: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });
    const receipts = await this.prisma.receipt.findMany({
      where: { customerId: id },
      include: { salesInvoice: { select: { number: true } } },
      orderBy: { receivedAt: 'asc' },
    });
    const returns = await this.prisma.salesReturn.findMany({
      where: { customerId: id },
      include: { salesInvoice: { select: { number: true } } },
      orderBy: { returnDate: 'asc' },
    });

    const rows: StatementRow[] = [];
    for (const s of sales) {
      const due = money(Math.max(0, s.total - s.paidAmount));
      const via = methodName(s.paymentMethod);
      const groupKey = `sale:${s.id}`;
      const lines = s.lines.length
        ? s.lines
        : [{
            product: { name: '—', sku: null as string | null },
            quantity: 0,
            netWeight: null as number | null,
            unitPrice: 0,
            total: money(s.subtotal + s.tax),
          }];
      lines.forEach((l, idx) => {
        const first = idx === 0;
        const last = idx === lines.length - 1;
        const weight = l.netWeight != null && Number(l.netWeight) > 0 ? Number(l.netWeight) : null;
        rows.push({
          date: s.invoiceDate,
          type: 'فاتورة بيع',
          ref: s.number,
          description: first
            ? `فاتورة بيع ${s.number}${s.warehouse?.name ? ` · ${s.warehouse.name}` : ''}`
            : `↳ بند من ${s.number}`,
          debit: first ? money(s.subtotal + s.tax) : 0,
          credit: 0,
          method: first ? via : null,
          note: first
            ? [
                s.tax > 0.009 ? `ضريبة: ${money(s.tax)}` : null,
                s.notes || null,
              ].filter(Boolean).join(' | ') || null
            : null,
          invoiceTotal: first ? money(s.total) : null,
          invoicePaid: first ? money(s.paidAmount) : null,
          invoiceDue: first ? due : null,
          productName: l.product?.name || '—',
          quantity: Number(l.quantity) || 0,
          weight,
          unitPrice: money(Number(l.unitPrice) || 0),
          lineTotal: money(Number(l.total) || 0),
          groupKey,
          isGroupFirst: first,
          isGroupLast: last,
        });
      });
      if (s.discount > 0.009) {
        rows.push({
          date: s.invoiceDate,
          type: 'خصم فاتورة',
          ref: s.number,
          description: `خصم على فاتورة ${s.number}`,
          debit: 0,
          credit: money(s.discount),
          note: 'يُخصم من إيراد الفاتورة ومن الربح',
          groupKey,
        });
      }
    }
    for (const r of receipts) {
      const isAdvance = !r.salesInvoiceId;
      const via = methodName(r.paymentMethod);
      rows.push({
        date: r.receivedAt,
        type: isAdvance ? 'تحصيل مقدم' : 'تحصيل',
        ref: r.number,
        description: isAdvance
          ? `تحصيل مقدم${via ? ` عبر ${via}` : ''} — يُخصم من الفواتير التالية`
          : r.salesInvoice?.number
            ? `تحصيل على فاتورة ${r.salesInvoice.number}${via ? ` عبر ${via}` : ''}`
            : `تحصيل من العميل${via ? ` عبر ${via}` : ''}`,
        debit: 0,
        credit: money(r.amount),
        method: via,
        note: [r.note, r.referenceNo ? `مرجع: ${r.referenceNo}` : null, via ? `طريقة الدفع: ${via}` : null].filter(Boolean).join(' — ') || null,
      });
    }
    for (const r of returns) {
      rows.push({
        date: r.returnDate,
        type: 'مرتجع بيع',
        ref: r.number,
        description: r.salesInvoice?.number
          ? `مرتجع على فاتورة ${r.salesInvoice.number}`
          : 'مرتجع بيع',
        debit: 0,
        credit: money(r.total),
        note: r.notes,
      });
    }
    const { statement, totals } = withRunningBalance(rows);
    const prepaid = Math.max(0, money(-customer.balance));
    return {
      customer,
      statement,
      balance: customer.balance,
      totals,
      prepaid,
      meaning: customer.balance > 0.009
        ? 'دائن على العميل (−)'
        : customer.balance < -0.009
          ? 'مدين للعميل (+ مقدم)'
          : 'الرصيد متعادل',
    };
  }

  listContracts(search?: string) {
    const where: Prisma.CustomerContractWhereInput = search?.trim()
      ? {
          OR: [
            { number: { contains: search.trim() } },
            { title: { contains: search.trim() } },
            { customer: { name: { contains: search.trim() } } },
            { customer: { phone: { contains: search.trim() } } },
            { customer: { code: { contains: search.trim() } } },
          ],
        }
      : {};
    return this.prisma.customerContract.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            balance: true,
            creditLimit: true,
            priceList: true,
            notes: true,
            isActive: true,
          },
        },
      },
      orderBy: { contractDate: 'desc' },
    });
  }

  async createContract(data: {
    customerId: string;
    contractDate?: string;
    title?: string;
    terms?: string;
    notes?: string;
  }) {
    await this.findOne(data.customerId);
    const number = await this.sequence.next('customer_contract', 'CTR');
    return this.prisma.customerContract.create({
      data: {
        number,
        customerId: data.customerId,
        contractDate: data.contractDate ? new Date(data.contractDate) : new Date(),
        title: data.title?.trim() || 'عقد توريد وتعامل',
        terms: data.terms?.trim() || DEFAULT_CONTRACT_TERMS,
        notes: data.notes?.trim() || null,
      },
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            balance: true,
            creditLimit: true,
            priceList: true,
            notes: true,
            isActive: true,
          },
        },
      },
    });
  }

  async getContract(id: string) {
    const row = await this.prisma.customerContract.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            balance: true,
            creditLimit: true,
            priceList: true,
            notes: true,
            isActive: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('التعاقد غير موجود');
    return row;
  }
}
