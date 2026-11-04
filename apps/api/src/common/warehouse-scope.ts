import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUser = { userId: string; role: string };

/** null = كل المخازن (مدير أو مستخدم من غير ربط). */
export async function userWarehouseIds(prisma: PrismaService, user?: AuthUser | null) {
  if (!user?.userId) return null;
  if (user.role === Role.ADMIN) return null;
  const links = await prisma.userWarehouse.findMany({
    where: { userId: user.userId },
    select: { warehouseId: true },
  });
  if (!links.length) return null;
  return links.map((row) => row.warehouseId);
}

export function warehouseWhere(ids: string[] | null | undefined) {
  if (!ids?.length) return undefined;
  return { warehouseId: { in: ids } };
}

/** أطراف من غير ربط مخزن = ظاهرة للكل. */
export function partyWarehouseWhere(ids: string[] | null | undefined) {
  if (!ids?.length) return undefined;
  return {
    OR: [
      { warehouses: { none: {} } },
      { warehouses: { some: { warehouseId: { in: ids } } } },
    ],
  };
}

export async function assertWarehouseAllowed(prisma: PrismaService, user: AuthUser | undefined, warehouseId: string) {
  const ids = await userWarehouseIds(prisma, user);
  if (!ids) return;
  if (!ids.includes(warehouseId)) {
    throw new ForbiddenException('المخزن ده مش ضمن صلاحيتك');
  }
}
