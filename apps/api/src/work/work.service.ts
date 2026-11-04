import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, TaskPriority, TaskStatus } from '@prisma/client';
async function loadExcel() {
  return import('exceljs');
}
import { createReadStream, existsSync, unlinkSync } from 'fs';
import { extname, join, resolve } from 'path';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = { userId: string; username: string; role: string };

type ReportDefinition = {
  module: string;
  fields: string[];
  from?: string;
  to?: string;
  groupBy?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: { status?: string; activeOnly?: boolean; balanceOnly?: boolean };
};

type FlatRow = Record<string, string | number>;

const NEXT_STATUS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  IN_PROGRESS: [TaskStatus.REVIEW, TaskStatus.CANCELLED],
  REVIEW: [TaskStatus.APPROVED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  APPROVED: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [TaskStatus.PENDING],
};

const TRIGGERS = ['LOW_STOCK', 'OVERDUE_INVOICE', 'PRICE_RISK', 'SALES_DROP', 'TASK_OVERDUE', 'DUPLICATE_PHONE', 'SLOW_PRODUCT'] as const;
const ACTIONS = ['NOTIFY', 'CREATE_TASK', 'BOTH'] as const;

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const CATALOG: Record<string, {
  label: string;
  fields: { key: string; label: string; numeric?: boolean }[];
  groups: string[];
  statuses?: string[];
}> = {
  sales: {
    label: 'فواتير المبيعات',
    fields: [
      { key: 'number', label: 'الرقم' },
      { key: 'invoiceDate', label: 'التاريخ' },
      { key: 'customer', label: 'العميل' },
      { key: 'warehouse', label: 'المخزن' },
      { key: 'status', label: 'الحالة' },
      { key: 'total', label: 'الإجمالي', numeric: true },
      { key: 'paidAmount', label: 'المدفوع', numeric: true },
      { key: 'remaining', label: 'المتبقي', numeric: true },
    ],
    groups: ['status', 'customer', 'warehouse'],
    statuses: ['DRAFT', 'CONFIRMED', 'PARTIAL', 'PAID', 'CANCELLED'],
  },
  purchases: {
    label: 'فواتير المشتريات',
    fields: [
      { key: 'number', label: 'الرقم' },
      { key: 'invoiceDate', label: 'التاريخ' },
      { key: 'supplier', label: 'المورد' },
      { key: 'warehouse', label: 'المخزن' },
      { key: 'status', label: 'الحالة' },
      { key: 'total', label: 'الإجمالي', numeric: true },
      { key: 'paidAmount', label: 'المدفوع', numeric: true },
      { key: 'remaining', label: 'المتبقي', numeric: true },
    ],
    groups: ['status', 'supplier', 'warehouse'],
    statuses: ['DRAFT', 'CONFIRMED', 'PARTIAL', 'PAID', 'CANCELLED'],
  },
  customers: {
    label: 'العملاء',
    fields: [
      { key: 'code', label: 'الكود' },
      { key: 'name', label: 'الاسم' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'priceList', label: 'قائمة السعر' },
      { key: 'balance', label: 'الرصيد', numeric: true },
      { key: 'isActive', label: 'نشط' },
    ],
    groups: ['priceList', 'isActive'],
  },
  products: {
    label: 'الأصناف',
    fields: [
      { key: 'sku', label: 'الكود' },
      { key: 'name', label: 'الاسم' },
      { key: 'brand', label: 'الماركة' },
      { key: 'unit', label: 'الوحدة' },
      { key: 'costPrice', label: 'التكلفة', numeric: true },
      { key: 'salePrice', label: 'البيع', numeric: true },
      { key: 'minStock', label: 'حد الطلب', numeric: true },
      { key: 'isActive', label: 'نشط' },
    ],
    groups: ['brand', 'isActive'],
  },
  stock: {
    label: 'أرصدة المخزون',
    fields: [
      { key: 'sku', label: 'الكود' },
      { key: 'product', label: 'الصنف' },
      { key: 'warehouse', label: 'المخزن' },
      { key: 'quantity', label: 'الكمية', numeric: true },
      { key: 'minStock', label: 'حد الطلب', numeric: true },
      { key: 'shortage', label: 'النقص', numeric: true },
    ],
    groups: ['warehouse', 'product'],
  },
};

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function rangeFrom(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const start = from ? new Date(from) : new Date('2000-01-01');
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('نطاق التاريخ غير صالح');
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { gte: start, lte: end };
}

@Injectable()
export class WorkService {
  constructor(private prisma: PrismaService) {}

  catalog() {
    return {
      modules: Object.entries(CATALOG).map(([key, value]) => ({
        key,
        label: value.label,
        fields: value.fields,
        groups: value.groups,
        statuses: value.statuses || [],
      })),
      triggers: [
        { key: 'LOW_STOCK', label: 'الصنف تحت حد الطلب' },
        { key: 'OVERDUE_INVOICE', label: 'فاتورة بيع متأخرة أكثر من 14 يوم' },
        { key: 'PRICE_RISK', label: 'سعر البيع أقل من التكلفة' },
        { key: 'SALES_DROP', label: 'انخفاض المبيعات عن الشهر السابق' },
        { key: 'TASK_OVERDUE', label: 'مهمة تجاوزت تاريخ الاستحقاق' },
        { key: 'DUPLICATE_PHONE', label: 'هاتف عميل مكرر' },
        { key: 'SLOW_PRODUCT', label: 'صنف راكد 90 يومًا' },
      ],
      actions: [
        { key: 'NOTIFY', label: 'تنبيه فقط' },
        { key: 'CREATE_TASK', label: 'إنشاء مهمة' },
        { key: 'BOTH', label: 'تنبيه ومهمة' },
      ],
      taskStatuses: Object.keys(NEXT_STATUS),
    };
  }

  private cleanDefinition(input: ReportDefinition): ReportDefinition {
    const spec = CATALOG[input.module];
    if (!spec) throw new BadRequestException('الوحدة غير مدعومة في منشئ التقارير');
    const allowed = new Set(spec.fields.map((field) => field.key));
    const fields = (input.fields || []).filter((field) => allowed.has(field));
    const chosen = fields.length ? fields : spec.fields.map((field) => field.key);
    const groupBy = input.groupBy && spec.groups.includes(input.groupBy) ? input.groupBy : undefined;
    const sortBy = input.sortBy && chosen.includes(input.sortBy) ? input.sortBy : chosen[0];
    const sortDir = input.sortDir === 'asc' ? 'asc' : 'desc';
    const status = input.filters?.status && spec.statuses?.includes(input.filters.status) ? input.filters.status : undefined;
    return {
      module: input.module,
      fields: chosen,
      from: input.from || undefined,
      to: input.to || undefined,
      groupBy,
      sortBy,
      sortDir,
      filters: {
        status,
        activeOnly: !!input.filters?.activeOnly,
        balanceOnly: !!input.filters?.balanceOnly,
      },
    };
  }

  async runReport(raw: ReportDefinition) {
    const definition = this.cleanDefinition(raw);
    const spec = CATALOG[definition.module];
    const rows = await this.collect(definition);
    const sorted = [...rows].sort((a, b) => {
      const left = a[definition.sortBy || ''] ?? '';
      const right = b[definition.sortBy || ''] ?? '';
      const dir = definition.sortDir === 'asc' ? 1 : -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * dir;
      return String(left).localeCompare(String(right), 'ar') * dir;
    });
    const limited = sorted.slice(0, 1000);
    const projected = definition.groupBy ? this.group(limited, definition, spec) : limited.map((row) => this.pick(row, definition.fields));
    const sums: Record<string, number> = {};
    for (const field of spec.fields.filter((item) => item.numeric && definition.fields.includes(item.key))) {
      sums[field.key] = projected.reduce((sum, row) => sum + (Number(row[field.key]) || 0), 0);
    }
    return {
      definition,
      columns: (definition.groupBy
        ? [{ key: 'group', label: 'المجموعة' }, { key: 'count', label: 'العدد' }, ...spec.fields.filter((field) => field.numeric && definition.fields.includes(field.key))]
        : spec.fields.filter((field) => definition.fields.includes(field.key))
      ).map((field) => ({ key: field.key, label: field.label })),
      rows: projected,
      totalRows: projected.length,
      truncated: sorted.length > 1000,
      sums,
    };
  }

  private pick(row: FlatRow, fields: string[]): FlatRow {
    const out: FlatRow = {};
    for (const field of fields) out[field] = row[field] ?? '';
    return out;
  }

  private group(rows: FlatRow[], definition: ReportDefinition, spec: (typeof CATALOG)[string]) {
    const buckets = new Map<string, FlatRow[]>();
    for (const row of rows) {
      const key = String(row[definition.groupBy || ''] || '—');
      const list = buckets.get(key) || [];
      list.push(row);
      buckets.set(key, list);
    }
    const numeric = spec.fields.filter((field) => field.numeric && definition.fields.includes(field.key));
    return [...buckets.entries()].map(([group, list]) => {
      const out: FlatRow = { group, count: list.length };
      for (const field of numeric) {
        out[field.key] = list.reduce((sum, row) => sum + (Number(row[field.key]) || 0), 0);
      }
      return out;
    });
  }

  private async collect(definition: ReportDefinition): Promise<FlatRow[]> {
    if (definition.module === 'sales' || definition.module === 'purchases') {
      const dates = rangeFrom(definition.from, definition.to);
      const status = definition.filters?.status as InvoiceStatus | undefined;
      const dateFilter = dates ? { invoiceDate: dates } : {};
      if (definition.module === 'sales') {
        const invoices = await this.prisma.salesInvoice.findMany({
          where: { ...dateFilter, ...(status ? { status } : {}) },
          include: { customer: { select: { name: true } }, warehouse: { select: { name: true } } },
          take: 2000,
        });
        return invoices.map((row) => ({
          number: row.number,
          invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
          customer: row.customer.name,
          warehouse: row.warehouse.name,
          status: row.status,
          total: row.total,
          paidAmount: row.paidAmount,
          remaining: Math.max(row.total - row.paidAmount, 0),
        }));
      }
      const invoices = await this.prisma.purchaseInvoice.findMany({
        where: { ...dateFilter, ...(status ? { status } : {}) },
        include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
        take: 2000,
      });
      return invoices.map((row) => ({
        number: row.number,
        invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
        supplier: row.supplier.name,
        warehouse: row.warehouse.name,
        status: row.status,
        total: row.total,
        paidAmount: row.paidAmount,
        remaining: Math.max(row.total - row.paidAmount, 0),
      }));
    }
    if (definition.module === 'customers') {
      const customers = await this.prisma.customer.findMany({ orderBy: { name: 'asc' }, take: 2000 });
      return customers
        .filter((row) => !definition.filters?.activeOnly || row.isActive)
        .filter((row) => !definition.filters?.balanceOnly || row.balance > 0)
        .map((row) => ({
          code: row.code,
          name: row.name,
          phone: row.phone || '',
          priceList: row.priceList,
          balance: row.balance,
          isActive: row.isActive ? 'نعم' : 'لا',
        }));
    }
    if (definition.module === 'products') {
      const products = await this.prisma.product.findMany({ orderBy: { name: 'asc' }, take: 2000 });
      return products
        .filter((row) => !definition.filters?.activeOnly || row.isActive)
        .map((row) => ({
          sku: row.sku,
          name: row.name,
          brand: row.brand || '',
          unit: row.unit,
          costPrice: row.costPrice,
          salePrice: row.salePrice,
          minStock: row.minStock,
          isActive: row.isActive ? 'نعم' : 'لا',
        }));
    }
    const balances = await this.prisma.stockBalance.findMany({
      include: { product: true, warehouse: true },
      take: 2000,
    });
    return balances.map((row) => ({
      sku: row.product.sku,
      product: row.product.name,
      warehouse: row.warehouse.name,
      quantity: row.quantity,
      minStock: row.product.minStock,
      shortage: Math.max(row.product.minStock - row.quantity, 0),
    }));
  }

  async exportReport(raw: ReportDefinition, format: string) {
    const report = await this.runReport(raw);
    if (format === 'csv') {
      const header = report.columns.map((column) => column.label).join(',');
      const lines = report.rows.map((row) => report.columns.map((column) => {
        const value = String(row[column.key] ?? '').replace(/"/g, '""');
        return `"${value}"`;
      }).join(','));
      return { mime: 'text/csv; charset=utf-8', filename: 'report.csv', body: Buffer.from(`\uFEFF${[header, ...lines].join('\n')}`, 'utf8') };
    }
    const ExcelJS = await loadExcel();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('تقرير');
    sheet.columns = report.columns.map((column) => ({ header: column.label, key: column.key, width: 18 }));
    report.rows.forEach((row) => sheet.addRow(row));
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'report.xlsx',
      body: Buffer.from(buffer),
    };
  }

  listReports(user: AuthUser) {
    return this.prisma.savedReport.findMany({
      where: user.role === 'ADMIN' ? undefined : { ownerId: user.userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async saveReport(user: AuthUser, name: string, raw: ReportDefinition) {
    const definition = this.cleanDefinition(raw);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new BadRequestException('اكتب اسمًا للتقرير');
    return this.prisma.savedReport.create({
      data: {
        name: trimmed,
        definition: JSON.stringify(definition),
        ownerId: user.userId,
        ownerName: user.username,
      },
    });
  }

  async savedDefinition(id: string, user: AuthUser) {
    const saved = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!saved) throw new NotFoundException('التقرير غير موجود');
    if (user.role !== 'ADMIN' && saved.ownerId !== user.userId) throw new ForbiddenException('هذا التقرير لمستخدم آخر');
    return { saved, definition: JSON.parse(saved.definition) as ReportDefinition };
  }

  async duplicateReport(id: string, user: AuthUser) {
    const { saved, definition } = await this.savedDefinition(id, user);
    return this.saveReport(user, `${saved.name} نسخة`, definition);
  }

  async removeReport(id: string, user: AuthUser) {
    await this.savedDefinition(id, user);
    await this.prisma.savedReport.delete({ where: { id } });
    return { ok: true };
  }

  async intelligence() {
    const items = await this.signals();
    return { generatedAt: new Date().toISOString(), items };
  }

  private async signals() {
    const now = new Date();
    const overdueBefore = new Date(now);
    overdueBefore.setDate(overdueBefore.getDate() - 14);
    const slowBefore = new Date(now);
    slowBefore.setDate(slowBefore.getDate() - 90);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [products, balances, customers, overdue, soldLines, thisSales, prevSales, lateTasks] = await Promise.all([
      this.prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true, costPrice: true, salePrice: true, minStock: true } }),
      this.prisma.stockBalance.groupBy({ by: ['productId'], _sum: { quantity: true } }),
      this.prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true, phone: true } }),
      this.prisma.salesInvoice.findMany({
        where: {
          status: { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL] },
          invoiceDate: { lt: overdueBefore },
        },
        select: { id: true, number: true, total: true, paidAmount: true, customer: { select: { name: true } } },
        take: 30,
      }),
      this.prisma.salesInvoiceLine.findMany({
        where: { invoice: { invoiceDate: { gte: slowBefore }, status: { not: InvoiceStatus.CANCELLED } } },
        select: { productId: true },
        distinct: ['productId'],
      }),
      this.prisma.salesInvoice.aggregate({
        where: { invoiceDate: { gte: monthStart }, status: { not: InvoiceStatus.CANCELLED } },
        _sum: { total: true },
      }),
      this.prisma.salesInvoice.aggregate({
        where: { invoiceDate: { gte: prevStart, lt: monthStart }, status: { not: InvoiceStatus.CANCELLED } },
        _sum: { total: true },
      }),
      this.prisma.workTask.findMany({
        where: { dueDate: { lt: now }, status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] } },
        take: 20,
      }),
    ]);

    const qty = new Map(balances.map((row) => [row.productId, row._sum.quantity || 0]));
    const sold = new Set(soldLines.map((row) => row.productId));
    const items: { trigger: string; key: string; title: string; detail: string; href: string; suggestion: string }[] = [];

    for (const product of products) {
      const onHand = qty.get(product.id) || 0;
      if (product.minStock > 0 && onHand <= product.minStock) {
        const suggested = Math.max(product.minStock * 2 - onHand, product.minStock);
        items.push({
          trigger: 'LOW_STOCK',
          key: product.id,
          title: `نقص مخزون: ${product.name}`,
          detail: `الرصيد ${onHand} والحد ${product.minStock}. الكمية المقترحة للطلب ${suggested}.`,
          href: `/products?q=${encodeURIComponent(product.sku)}`,
          suggestion: 'أنشئ أمر شراء أو مهمة لأمين المخزن',
        });
      }
      if (product.costPrice > 0 && product.salePrice > 0 && product.salePrice < product.costPrice) {
        items.push({
          trigger: 'PRICE_RISK',
          key: product.id,
          title: `سعر خاسر: ${product.name}`,
          detail: `البيع ${product.salePrice} أقل من التكلفة ${product.costPrice}.`,
          href: `/products?q=${encodeURIComponent(product.sku)}`,
          suggestion: 'راجع سعر البيع قبل فاتورة جديدة',
        });
      }
      if (onHand > 0 && !sold.has(product.id)) {
        items.push({
          trigger: 'SLOW_PRODUCT',
          key: product.id,
          title: `صنف راكد: ${product.name}`,
          detail: `عليه رصيد ${onHand} ولم يُبع خلال 90 يومًا.`,
          href: `/products?q=${encodeURIComponent(product.sku)}`,
          suggestion: 'راجع التسعير أو انقل الكمية لمخزن أنشط',
        });
      }
    }

    for (const invoice of overdue) {
      const remaining = invoice.total - invoice.paidAmount;
      if (remaining <= 0) continue;
      items.push({
        trigger: 'OVERDUE_INVOICE',
        key: invoice.id,
        title: `فاتورة متأخرة ${invoice.number}`,
        detail: `${invoice.customer.name} · المتبقي ${remaining.toFixed(2)}`,
        href: `/sales?open=${invoice.id}`,
        suggestion: 'تابع التحصيل أو حوّلها لمهمة',
      });
    }

    const phones = new Map<string, { id: string; name: string }[]>();
    for (const customer of customers) {
      const phone = (customer.phone || '').trim();
      if (!phone) continue;
      const list = phones.get(phone) || [];
      list.push({ id: customer.id, name: customer.name });
      phones.set(phone, list);
    }
    for (const [phone, list] of phones) {
      if (list.length < 2) continue;
      items.push({
        trigger: 'DUPLICATE_PHONE',
        key: phone,
        title: `هاتف مكرر ${phone}`,
        detail: list.map((row) => row.name).join(' · '),
        href: `/customers?q=${encodeURIComponent(phone)}`,
        suggestion: 'ادمج البطاقات المكررة قبل كشوف جديدة',
      });
    }

    const current = thisSales._sum.total || 0;
    const previous = prevSales._sum.total || 0;
    if (previous > 0 && current < previous * 0.85) {
      const drop = Math.round(((previous - current) / previous) * 100);
      items.push({
        trigger: 'SALES_DROP',
        key: dayStamp(monthStart).slice(0, 7),
        title: `المبيعات أقل ${drop}% عن الشهر السابق`,
        detail: `هذا الشهر ${current.toFixed(2)} مقابل ${previous.toFixed(2)}.`,
        href: '/analytics',
        suggestion: 'افتح التحليلات وقارن أفضل العملاء والأصناف',
      });
    }

    for (const task of lateTasks) {
      items.push({
        trigger: 'TASK_OVERDUE',
        key: task.id,
        title: `مهمة متأخرة: ${task.title}`,
        detail: task.assigneeName ? `مسندة إلى ${task.assigneeName}` : 'بدون مسؤول',
        href: '/tasks',
        suggestion: 'حدّث الحالة أو أعد الإسناد',
      });
    }

    return items.slice(0, 80);
  }

  async ensureRules() {
    const count = await this.prisma.automationRule.count();
    if (count > 0) return;
    await this.prisma.automationRule.createMany({
      data: [
        { name: 'تنبيه نقص المخزون', trigger: 'LOW_STOCK', action: 'BOTH' },
        { name: 'متابعة الفواتير المتأخرة', trigger: 'OVERDUE_INVOICE', action: 'NOTIFY' },
      ],
    });
  }

  async listRules() {
    await this.ensureRules();
    return this.prisma.automationRule.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { runs: true } } } });
  }

  async createRule(name: string, trigger: string, action: string) {
    if (!TRIGGERS.includes(trigger as (typeof TRIGGERS)[number])) throw new BadRequestException('المحفز غير معروف');
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) throw new BadRequestException('الإجراء غير معروف');
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new BadRequestException('اسم القاعدة قصير');
    return this.prisma.automationRule.create({ data: { name: trimmed, trigger, action } });
  }

  async updateRule(id: string, data: { name?: string; action?: string; isActive?: boolean }) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('القاعدة غير موجودة');
    if (data.action && !ACTIONS.includes(data.action as (typeof ACTIONS)[number])) throw new BadRequestException('الإجراء غير معروف');
    return this.prisma.automationRule.update({
      where: { id },
      data: {
        name: data.name?.trim() || undefined,
        action: data.action,
        isActive: data.isActive,
      },
    });
  }

  async removeRule(id: string) {
    await this.prisma.automationRule.delete({ where: { id } });
    return { ok: true };
  }

  recentRuns() {
    return this.prisma.automationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { rule: { select: { name: true, trigger: true } } },
    });
  }

  async runAutomation(user: AuthUser) {
    await this.ensureRules();
    const [rules, signals] = await Promise.all([
      this.prisma.automationRule.findMany({ where: { isActive: true } }),
      this.signals(),
    ]);
    let notifications = 0;
    let tasks = 0;
    let skipped = 0;
    for (const rule of rules) {
      const hits = signals.filter((item) => item.trigger === rule.trigger);
      for (const hit of hits) {
        const dedupeKey = `${rule.id}:${hit.key}:${dayStamp()}`;
        const exists = await this.prisma.automationRun.findUnique({ where: { dedupeKey } });
        if (exists) {
          skipped += 1;
          continue;
        }
        if (rule.action === 'NOTIFY' || rule.action === 'BOTH') {
          await this.prisma.appNotification.create({
            data: {
              dedupeKey: `auto:${dedupeKey}`,
              category: 'alert',
              severity: 'warning',
              title: hit.title,
              body: `${hit.detail} ${hit.suggestion}`,
              href: hit.href,
            },
          });
          notifications += 1;
        }
        if (rule.action === 'CREATE_TASK' || rule.action === 'BOTH') {
          await this.prisma.workTask.create({
            data: {
              title: hit.title,
              description: `${hit.detail}\n${hit.suggestion}`,
              priority: TaskPriority.HIGH,
              createdById: user.userId,
              createdByName: user.username,
              entityLabel: hit.href,
            },
          });
          tasks += 1;
        }
        await this.prisma.automationRun.create({
          data: { ruleId: rule.id, dedupeKey, summary: hit.title },
        });
      }
    }
    return { notifications, tasks, skipped, rules: rules.length };
  }

  async listTasks(status?: string) {
    const where = status && status in NEXT_STATUS ? { status: status as TaskStatus } : undefined;
    const tasks = await this.prisma.workTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { _count: { select: { comments: true } } },
    });
    return tasks.map((task) => ({ ...task, next: NEXT_STATUS[task.status] }));
  }

  people() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async createTask(user: AuthUser, input: {
    title: string;
    description?: string;
    priority?: string;
    assigneeId?: string;
    dueDate?: string;
    entityType?: string;
    entityId?: string;
  }) {
    const title = input.title.trim();
    if (title.length < 2) throw new BadRequestException('عنوان المهمة قصير');
    let assigneeName: string | undefined;
    if (input.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: input.assigneeId }, select: { fullName: true, isActive: true } });
      if (!assignee?.isActive) throw new BadRequestException('المسؤول غير موجود');
      assigneeName = assignee.fullName;
    }
    if (input.entityType && input.entityId) await this.assertEntity(input.entityType, input.entityId);
    const due = input.dueDate ? new Date(input.dueDate) : undefined;
    if (due && Number.isNaN(due.getTime())) throw new BadRequestException('تاريخ الاستحقاق غير صالح');
    return this.prisma.workTask.create({
      data: {
        title,
        description: input.description?.trim() || null,
        priority: input.priority && input.priority in TaskPriority ? (input.priority as TaskPriority) : TaskPriority.MEDIUM,
        assigneeId: input.assigneeId || null,
        assigneeName,
        dueDate: due,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        createdById: user.userId,
        createdByName: user.username,
      },
    });
  }

  async moveTask(id: string, status: TaskStatus) {
    const task = await this.prisma.workTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('المهمة غير موجودة');
    if (!NEXT_STATUS[task.status].includes(status)) {
      throw new BadRequestException('لا يمكن نقل المهمة إلى هذه الحالة');
    }
    return this.prisma.workTask.update({ where: { id }, data: { status } });
  }

  async commentTask(user: AuthUser, id: string, body: string) {
    const task = await this.prisma.workTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('المهمة غير موجودة');
    const text = body.trim();
    if (text.length < 1) throw new BadRequestException('التعليق فارغ');
    return this.prisma.taskComment.create({
      data: { taskId: id, body: text, userId: user.userId, userName: user.username },
    });
  }

  comments(taskId: string) {
    return this.prisma.taskComment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
  }

  async removeTask(id: string) {
    await this.prisma.workTask.delete({ where: { id } });
    return { ok: true };
  }

  listViews(user: AuthUser, module: string) {
    return this.prisma.savedView.findMany({
      where: { module, ownerId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async saveView(user: AuthUser, module: string, name: string, query: string) {
    const allowed = ['customers', 'products', 'sales', 'purchases'];
    if (!allowed.includes(module)) throw new BadRequestException('هذه الشاشة لا تحفظ عروضًا بعد');
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new BadRequestException('اسم العرض قصير');
    JSON.parse(query);
    return this.prisma.savedView.create({
      data: { module, name: trimmed, query, ownerId: user.userId, ownerName: user.username },
    });
  }

  async removeView(user: AuthUser, id: string) {
    const view = await this.prisma.savedView.findUnique({ where: { id } });
    if (!view || (view.ownerId !== user.userId && user.role !== 'ADMIN')) throw new NotFoundException('العرض غير موجود');
    await this.prisma.savedView.delete({ where: { id } });
    return { ok: true };
  }

  private uploadRoot() {
    return resolve(process.cwd(), 'uploads');
  }

  private async assertEntity(entityType: string, entityId: string) {
    const checks: Record<string, () => Promise<unknown>> = {
      customer: () => this.prisma.customer.findUnique({ where: { id: entityId }, select: { id: true } }),
      product: () => this.prisma.product.findUnique({ where: { id: entityId }, select: { id: true } }),
      supplier: () => this.prisma.supplier.findUnique({ where: { id: entityId }, select: { id: true } }),
      sales: () => this.prisma.salesInvoice.findUnique({ where: { id: entityId }, select: { id: true } }),
      purchase: () => this.prisma.purchaseInvoice.findUnique({ where: { id: entityId }, select: { id: true } }),
      task: () => this.prisma.workTask.findUnique({ where: { id: entityId }, select: { id: true } }),
    };
    const check = checks[entityType];
    if (!check) throw new BadRequestException('نوع السجل غير مدعوم للمرفقات');
    const found = await check();
    if (!found) throw new NotFoundException('السجل غير موجود');
  }

  async addAttachment(user: AuthUser, entityType: string, entityId: string, file?: { originalname: string; size: number; buffer: Buffer }) {
    if (!file?.buffer?.length) throw new BadRequestException('الملف مفقود');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('الحد الأقصى للملف 5 ميجا');
    const ext = extname(file.originalname || '').toLowerCase();
    const mime = EXT_MIME[ext];
    if (!mime) throw new BadRequestException('نوع الملف غير مسموح. المسموح: PDF والصور وCSV وExcel');
    await this.assertEntity(entityType, entityId);
    const storageName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await this.prisma.fileBlob.create({ data: { key: `attachments/${storageName}`, mimeType: mime, data: new Uint8Array(file.buffer) } });
    const safeName = (file.originalname || `file${ext}`).replace(/[^\w.\u0600-\u06FF -]/g, '').slice(0, 160) || `file${ext}`;
    return this.prisma.attachment.create({
      data: {
        entityType,
        entityId,
        fileName: safeName,
        mimeType: mime,
        size: file.size,
        storageName,
        uploadedById: user.userId,
        uploadedByName: user.username,
      },
    });
  }

  listAttachments(entityType: string, entityId: string) {
    return this.prisma.attachment.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async openAttachment(id: string) {
    const file = await this.prisma.attachment.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('المرفق غير موجود');
    const blob = await this.prisma.fileBlob.findUnique({ where: { key: `attachments/${file.storageName}` } });
    if (blob) return { ...file, stream: Readable.from(Buffer.from(blob.data)) };
    const root = this.uploadRoot();
    const absolute = resolve(root, file.storageName);
    if (!absolute.startsWith(root) || !existsSync(absolute)) throw new NotFoundException('الملف غير موجود على الخادم');
    return { ...file, stream: createReadStream(absolute) };
  }

  async removeAttachment(user: AuthUser, id: string) {
    const file = await this.prisma.attachment.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('المرفق غير موجود');
    if (user.role !== 'ADMIN' && file.uploadedById !== user.userId) throw new ForbiddenException('لا يمكنك حذف مرفق مستخدم آخر');
    const absolute = resolve(this.uploadRoot(), file.storageName);
    if (absolute.startsWith(this.uploadRoot()) && existsSync(absolute)) unlinkSync(absolute);
    await this.prisma.fileBlob.deleteMany({ where: { key: `attachments/${file.storageName}` } });
    await this.prisma.attachment.delete({ where: { id } });
    return { ok: true };
  }

  async entity360(entityType: string, entityId: string) {
    await this.assertEntity(entityType, entityId);
    const [notes, tasks, attachments] = await Promise.all([
      this.prisma.recordNote.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.workTask.findMany({ where: { entityType, entityId }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      this.prisma.attachment.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    if (entityType === 'customer') {
      const customer = await this.prisma.customer.findUnique({ where: { id: entityId } });
      const invoices = await this.prisma.salesInvoice.findMany({
        where: { customerId: entityId },
        orderBy: { invoiceDate: 'desc' },
        take: 8,
        select: { id: true, number: true, total: true, paidAmount: true, status: true, invoiceDate: true },
      });
      return { entityType, customer, invoices, notes, tasks, attachments, flags: {} };
    }
    if (entityType === 'product') {
      const product = await this.prisma.product.findUnique({ where: { id: entityId } });
      const stock = await this.prisma.stockBalance.findMany({
        where: { productId: entityId },
        include: { warehouse: { select: { name: true } } },
      });
      const priceRisk = !!product && product.costPrice > 0 && product.salePrice < product.costPrice;
      return { entityType, product, stock, notes, tasks, attachments, flags: { priceRisk } };
    }
    return { entityType, notes, tasks, attachments };
  }

  async drill(metric: string, preset?: string, from?: string, to?: string) {
    if (metric !== 'sales' && metric !== 'purchases') throw new BadRequestException('المؤشر غير مدعوم');
    const end = to ? new Date(to) : new Date();
    end.setHours(23, 59, 59, 999);
    const start = from ? new Date(from) : new Date(end);
    if (!from) {
      if (preset === 'week') start.setDate(start.getDate() - 6);
      else if (preset === 'year') start.setMonth(0, 1);
      else start.setDate(1);
    }
    start.setHours(0, 0, 0, 0);
    const where = { invoiceDate: { gte: start, lte: end }, status: { not: InvoiceStatus.CANCELLED } };
    if (metric === 'sales') {
      const rows = await this.prisma.salesInvoice.findMany({
        where,
        orderBy: { invoiceDate: 'desc' },
        take: 200,
        select: { id: true, number: true, total: true, status: true, invoiceDate: true, customer: { select: { name: true } } },
      });
      return {
        metric,
        total: rows.reduce((sum, row) => sum + row.total, 0),
        count: rows.length,
        rows: rows.map((row) => ({
          id: row.id,
          number: row.number,
          party: row.customer.name,
          total: row.total,
          status: row.status,
          date: row.invoiceDate,
          href: `/sales?open=${row.id}`,
        })),
      };
    }
    const rows = await this.prisma.purchaseInvoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      take: 200,
      select: { id: true, number: true, total: true, status: true, invoiceDate: true, supplier: { select: { name: true } } },
    });
    return {
      metric,
      total: rows.reduce((sum, row) => sum + row.total, 0),
      count: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        number: row.number,
        party: row.supplier.name,
        total: row.total,
        status: row.status,
        date: row.invoiceDate,
        href: `/purchases?open=${row.id}`,
      })),
    };
  }
}
