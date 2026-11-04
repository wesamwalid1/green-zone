import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export async function claimRequest(
  prisma: PrismaService,
  input: { key?: string | null; scope: string; userId?: string },
) {
  const key = input.key?.trim();
  if (!key) return { status: 'new' as const, key: undefined };
  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (existing?.resourceId) return { status: 'replay' as const, key, resourceId: existing.resourceId };
  if (existing) throw new BadRequestException('الطلب قيد الحفظ');
  try {
    await prisma.idempotencyKey.create({
      data: { key, scope: input.scope, userId: input.userId || '', resourceId: '' },
    });
    return { status: 'new' as const, key };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const row = await prisma.idempotencyKey.findUnique({ where: { key } });
      if (row?.resourceId) return { status: 'replay' as const, key, resourceId: row.resourceId };
      throw new BadRequestException('الطلب قيد الحفظ');
    }
    throw error;
  }
}

export async function finishRequest(prisma: PrismaService, key: string | undefined, resourceId: string) {
  if (!key) return;
  await prisma.idempotencyKey.update({ where: { key }, data: { resourceId } });
}

export async function releaseRequest(prisma: PrismaService, key: string | undefined) {
  if (!key) return;
  await prisma.idempotencyKey.deleteMany({ where: { key, resourceId: '' } });
}
