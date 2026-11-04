import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WarehouseKind } from '@prisma/client';
import { autoCode } from '../common/auto-code';
import { PrismaService } from '../prisma/prisma.service';

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

  async findAll(user?: { userId: string; role: string }) {
    const all = () => this.prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
    if (!user || user.role === 'ADMIN') return this.withStock(await all());
    const links = await this.prisma.userWarehouse.findMany({ where: { userId: user.userId } });
    if (!links.length) return this.withStock(await all());
    return this.withStock(await this.prisma.warehouse.findMany({
      where: { id: { in: links.map((l) => l.warehouseId) } },
      orderBy: { name: 'asc' },
    }));
  }

  async findOne(id: string) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('المخزن غير موجود');
    return wh;
  }

  async create(data: { code?: string; name: string; location?: string; description?: string; kind?: WarehouseKind }) {
    const code = autoCode('WH', data.code);
    const name = data.name.trim();
    if (name.length < 2) throw new BadRequestException('اسم المخزن قصير');
    const taken = await this.prisma.warehouse.findUnique({ where: { code } });
    if (taken && (data.code || '').trim()) throw new BadRequestException('كود المخزن مستخدم');
    const finalCode = taken ? autoCode('WH') : code;
    const kind = data.kind && Object.values(WarehouseKind).includes(data.kind) ? data.kind : WarehouseKind.GENERAL;
    return this.prisma.warehouse.create({
      data: {
        code: finalCode,
        name,
        kind,
        location: data.location?.trim() || null,
        description: data.description?.trim() || null,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{ code: string; name: string; location: string; description: string; isActive: boolean; kind: WarehouseKind }>,
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
    return this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(kind ? { kind } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.location !== undefined ? { location: data.location.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
      },
    });
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
