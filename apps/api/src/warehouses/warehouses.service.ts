import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseKind } from '@prisma/client';
import { autoCode } from '../common/auto-code';
import { PrismaService } from '../prisma/prisma.service';

/** الحد الأقصى لمخازن النسخة الحالية — للتوسعة يتم التواصل مع الدعم */
export const MAX_WAREHOUSES = 3;
export const WAREHOUSE_LIMIT_MESSAGE =
  'النسخة الحالية تدعم حتى 3 مخازن فقط. لإضافة مخزن إضافي، يُرجى التواصل معنا لتفعيل التوسعة.';

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  private async withStock<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return rows.map((row) => ({ ...row, itemCount: 0, quantity: 0 }));
    const totals = await this.prisma.stockBalance.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: rows.map((row) => row.id) }, quantity: { gt: 0 } },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    const byId = new Map(totals.map((row) => [row.warehouseId, row]));
    return rows.map((row) => ({
      ...row,
      itemCount: byId.get(row.id)?._count._all ?? 0,
      quantity: byId.get(row.id)?._sum.quantity ?? 0,
    }));
  }

  private warehouseInclude() {
    return {
      locations: {
        orderBy: { code: 'asc' as const },
        select: { id: true, code: true, name: true },
      },
    };
  }

  private withSections<T extends { locations?: { id: string; code: string; name: string }[] }>(row: T) {
    const { locations, ...rest } = row;
    const sections = locations || [];
    return { ...rest, sections, sectionCount: sections.length };
  }

  async findAll(user?: { userId: string; role: string }) {
    const all = () =>
      this.prisma.warehouse.findMany({
        orderBy: { name: 'asc' },
        include: this.warehouseInclude(),
      });
    let rows;
    if (!user || user.role === 'ADMIN') rows = await all();
    else {
      const links = await this.prisma.userWarehouse.findMany({ where: { userId: user.userId } });
      rows = links.length
        ? await this.prisma.warehouse.findMany({
            where: { id: { in: links.map((l) => l.warehouseId) } },
            orderBy: { name: 'asc' },
            include: this.warehouseInclude(),
          })
        : await all();
    }
    return this.withStock(rows.map((row) => this.withSections(row)));
  }

  async findOne(id: string) {
    const wh = await this.prisma.warehouse.findUnique({
      where: { id },
      include: this.warehouseInclude(),
    });
    if (!wh) throw new NotFoundException('المخزن غير موجود');
    return this.withSections(wh);
  }

  private normalizeSections(sections?: { id?: string; code?: string; name: string }[]) {
    if (!sections?.length) return [] as { id?: string; code: string; name: string }[];
    const used = new Set<string>();
    const result: { id?: string; code: string; name: string }[] = [];
    sections.forEach((row, index) => {
      const name = (row.name || '').trim();
      if (!name) return;
      let code = (row.code || '').trim() || `P${index + 1}`;
      while (used.has(code.toLowerCase())) code = `${code}-${index + 1}`;
      used.add(code.toLowerCase());
      result.push({ id: row.id, code, name });
    });
    return result;
  }

  private async syncSections(
    warehouseId: string,
    sections?: { id?: string; code?: string; name: string }[],
  ) {
    if (sections === undefined) return;
    const next = this.normalizeSections(sections);
    const existing = await this.prisma.warehouseLocation.findMany({ where: { warehouseId } });
    const keep = new Set(next.filter((row) => row.id).map((row) => row.id as string));

    for (const old of existing) {
      if (keep.has(old.id)) continue;
      const linked = await this.prisma.productLocation.count({ where: { locationId: old.id } });
      if (linked > 0) {
        throw new BadRequestException(
          `لا يمكن حذف الجزء «${old.name}» لأنه مربوط بأصناف. انقل الأصناف لجزء آخر أولاً.`,
        );
      }
      await this.prisma.warehouseLocation.delete({ where: { id: old.id } });
    }

    for (const row of next) {
      if (row.id && existing.some((item) => item.id === row.id)) {
        await this.prisma.warehouseLocation.update({
          where: { id: row.id },
          data: { code: row.code, name: row.name },
        });
      } else {
        await this.prisma.warehouseLocation.create({
          data: { warehouseId, code: row.code, name: row.name },
        });
      }
    }
  }

  async create(data: {
    code?: string;
    name: string;
    location?: string;
    description?: string;
    kind?: WarehouseKind;
    sections?: { code?: string; name: string }[];
  }) {
    const existing = await this.prisma.warehouse.count();
    if (existing >= MAX_WAREHOUSES) {
      throw new BadRequestException(WAREHOUSE_LIMIT_MESSAGE);
    }
    const code = autoCode('WH', data.code);
    const name = data.name.trim();
    if (name.length < 2) throw new BadRequestException('اسم المخزن قصير');
    const taken = await this.prisma.warehouse.findUnique({ where: { code } });
    if (taken && (data.code || '').trim()) throw new BadRequestException('كود المخزن مستخدم');
    const finalCode = taken ? autoCode('WH') : code;
    const kind = data.kind && Object.values(WarehouseKind).includes(data.kind) ? data.kind : WarehouseKind.GENERAL;
    const sections = this.normalizeSections(data.sections);
    const warehouse = await this.prisma.warehouse.create({
      data: {
        code: finalCode,
        name,
        kind,
        location: data.location?.trim() || null,
        description: data.description?.trim() || null,
        ...(sections.length
          ? {
              locations: {
                create: sections.map((row) => ({ code: row.code, name: row.name })),
              },
            }
          : {}),
      },
      include: this.warehouseInclude(),
    });
    return this.withSections(warehouse);
  }

  async update(
    id: string,
    data: Partial<{
      code: string;
      name: string;
      location: string;
      description: string;
      isActive: boolean;
      kind: WarehouseKind;
      sections: { id?: string; code?: string; name: string }[];
    }>,
  ) {
    const current = await this.findOne(id);
    const code = data.code !== undefined ? autoCode('WH', data.code) : undefined;
    const name = data.name?.trim();
    if (name !== undefined && name.length < 2) throw new BadRequestException('اسم المخزن قصير');
    if (code && code !== current.code) {
      const taken = await this.prisma.warehouse.findUnique({ where: { code } });
      if (taken) throw new BadRequestException('كود المخزن مستخدم');
    }
    const kind =
      data.kind && Object.values(WarehouseKind).includes(data.kind) ? data.kind : undefined;
    await this.syncSections(id, data.sections);
    const updated = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(kind ? { kind } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.location !== undefined ? { location: data.location.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
      },
      include: this.warehouseInclude(),
    });
    return this.withSections(updated);
  }

  async remove(id: string) {
    const balances = await this.prisma.stockBalance.count({
      where: { warehouseId: id, quantity: { not: 0 } },
    });
    if (balances > 0) {
      throw new BadRequestException('لا يمكن حذف مخزن به أرصدة');
    }
    return this.prisma.warehouse.delete({ where: { id } });
  }
}
