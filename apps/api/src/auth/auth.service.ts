import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { parseAccess } from '../common/access-map';
import { PrismaService } from '../prisma/prisma.service';

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
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    const payload = { sub: user.id, username: user.username, role: user.role };
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const warehouseIds = await this.warehouseIdsFor(user.id, user.role);
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        warehouseIds,
        access: parseAccess(user.permissions, user.role),
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, fullName: true, role: true, permissions: true, isActive: true, lastLoginAt: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const warehouseIds = await this.warehouseIdsFor(user.id, user.role);
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      warehouseIds,
      access: parseAccess(user.permissions, user.role),
    };
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
