import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { parseAccess } from '../common/access-map';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FAILED_LOGINS = 3;
const LOCK_MESSAGE =
  'تم إيقاف محاولات الدخول لهذا الحساب. توجّه لمدير النظام لمراجعة البيانات.';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    if (user.loginLocked) {
      throw new ForbiddenException(LOCK_MESSAGE);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failedLoginCount = user.failedLoginCount + 1;
      const loginLocked = failedLoginCount >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount, loginLocked },
      });
      if (loginLocked) {
        throw new ForbiddenException(LOCK_MESSAGE);
      }
      const left = MAX_FAILED_LOGINS - failedLoginCount;
      throw new UnauthorizedException(
        `اسم المستخدم أو كلمة المرور غير صحيحة. متبقي ${left} ${left === 1 ? 'محاولة' : 'محاولات'} قبل إيقاف الحساب.`,
      );
    }

    const payload = { sub: user.id, username: user.username, role: user.role };
    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        lastSeenAt: now,
        failedLoginCount: 0,
        loginLocked: false,
      },
    });
    const warehouseIds = await this.warehouseIdsFor(user.id, user.role);
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        jobTitle: user.jobTitle,
        role: user.role,
        warehouseIds,
        access: parseAccess(user.permissions, user.role),
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        jobTitle: true,
        role: true,
        permissions: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const warehouseIds = await this.warehouseIdsFor(user.id, user.role);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      jobTitle: user.jobTitle,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      warehouseIds,
      access: parseAccess(user.permissions, user.role),
    };
  }

  async heartbeat(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const lastSeenAt = new Date();
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt } });
    return { ok: true, lastSeenAt };
  }

  private async warehouseIdsFor(userId: string, role: string) {
    if (role === 'ADMIN') return [] as string[];
    const links = await this.prisma.userWarehouse.findMany({
      where: { userId },
      select: { warehouseId: true },
    });
    return links.map((row) => row.warehouseId);
  }
}
