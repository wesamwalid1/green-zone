import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { normalizeAccess } from '../common/access-map';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        lastLoginAt: true,
        warehouseLinks: { select: { warehouseId: true, warehouse: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: { username: string; password: string; fullName: string; role: Role }) {
    const exists = await this.prisma.user.findUnique({ where: { username: data.username } });
    if (exists) throw new ConflictException('اسم المستخدم موجود مسبقاً');
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        fullName: data.fullName,
        role: data.role,
      },
      select: { id: true, username: true, fullName: true, role: true, isActive: true },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('كلمة السر الحالية غير صحيحة');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async update(
    id: string,
    data: { fullName?: string; role?: Role; isActive?: boolean; password?: string; permissions?: Record<string, unknown> },
    actorId?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
    const role = data.role || user.role;
    let permissions: string | null | undefined;
    if (data.permissions) {
      const access = normalizeAccess(data.permissions, role);
      if (actorId && actorId === id) {
        access.settings.view = true;
        if (!access.settings.actions.includes('users')) access.settings.actions.push('users');
      }
      permissions = JSON.stringify(access);
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: data.fullName,
        role: data.role,
        isActive: data.isActive,
        ...(passwordHash ? { passwordHash } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
      },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, permissions: true },
    });
  }

  warehouses(userId: string) {
    return this.prisma.userWarehouse.findMany({
      where: { userId },
      include: { warehouse: true },
    });
  }

  async setWarehouses(userId: string, warehouseIds: string[]) {
    await this.prisma.userWarehouse.deleteMany({ where: { userId } });
    if (warehouseIds.length) {
      await this.prisma.userWarehouse.createMany({
        data: warehouseIds.map((warehouseId) => ({ userId, warehouseId })),
      });
    }
    return this.warehouses(userId);
  }
}
