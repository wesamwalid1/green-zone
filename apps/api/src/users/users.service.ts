import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { normalizeAccess } from '../common/access-map';
import { PrismaService } from '../prisma/prisma.service';

/** مستخدم متصل لو آخر نبضة خلال الدقيقتين دول */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const rows = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        jobTitle: true,
        role: true,
        isActive: true,
        loginLocked: true,
        failedLoginCount: true,
        permissions: true,
        createdAt: true,
        lastLoginAt: true,
        lastSeenAt: true,
        warehouseLinks: { select: { warehouseId: true, warehouse: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();
    return rows.map((row) => {
      const lastSeenAt = row.lastSeenAt?.toISOString() || null;
      const lastLoginAt = row.lastLoginAt?.toISOString() || null;
      const online = !!row.lastSeenAt && now - row.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
      return {
        ...row,
        lastSeenAt,
        lastLoginAt,
        online,
        lastAppearanceAt: lastSeenAt || lastLoginAt,
      };
    });
  }

  async create(data: {
    username: string;
    password: string;
    fullName: string;
    jobTitle?: string;
    role?: Role;
    permissions?: Record<string, unknown>;
  }) {
    const exists = await this.prisma.user.findUnique({ where: { username: data.username } });
    if (exists) throw new ConflictException('اسم المستخدم موجود مسبقاً');
    const passwordHash = await bcrypt.hash(data.password, 10);
    const role = data.role || Role.SALES;
    const permissions = data.permissions
      ? JSON.stringify(normalizeAccess(data.permissions, role))
      : null;
    return this.prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        fullName: data.fullName,
        jobTitle: data.jobTitle?.trim() || null,
        role,
        permissions,
      },
      select: { id: true, username: true, fullName: true, jobTitle: true, role: true, isActive: true, permissions: true },
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
    data: {
      username?: string;
      fullName?: string;
      jobTitle?: string | null;
      role?: Role;
      isActive?: boolean;
      password?: string;
      unlockLogin?: boolean;
      permissions?: Record<string, unknown>;
    },
    actorId?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');

    const username = data.username?.trim();
    if (username && username !== user.username) {
      const taken = await this.prisma.user.findUnique({ where: { username } });
      if (taken) throw new ConflictException('اسم المستخدم موجود مسبقاً');
    }

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
    const jobTitle =
      data.jobTitle === undefined ? undefined : (data.jobTitle?.trim() || null);
    const clearLoginLock = data.unlockLogin === true || !!passwordHash;
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(username ? { username } : {}),
        fullName: data.fullName,
        ...(jobTitle !== undefined ? { jobTitle } : {}),
        role: data.role,
        isActive: data.isActive,
        ...(passwordHash ? { passwordHash } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        ...(clearLoginLock ? { loginLocked: false, failedLoginCount: 0 } : {}),
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        jobTitle: true,
        role: true,
        isActive: true,
        loginLocked: true,
        failedLoginCount: true,
        permissions: true,
      },
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
