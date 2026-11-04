import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrgService {
  constructor(private prisma: PrismaService) {}

  list(kind?: OrgKind) {
    return this.prisma.orgNode.findMany({
      where: kind ? { kind } : undefined,
      include: {
        parent: { select: { id: true, name: true, kind: true } },
        _count: { select: { members: true, children: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(data: {
    kind: OrgKind;
    name: string;
    code?: string;
    subtitle?: string;
    levelMark?: string;
    parentId?: string;
  }) {
    await this.assertParent(data.kind, data.parentId);
    return this.prisma.orgNode.create({
      data: {
        kind: data.kind,
        name: data.name.trim(),
        code: data.code?.trim() || null,
        subtitle: data.subtitle?.trim() || null,
        levelMark: data.levelMark?.trim() || null,
        parentId: data.parentId || null,
      },
    });
  }

  async update(id: string, data: {
    name?: string;
    code?: string;
    subtitle?: string;
    levelMark?: string;
    parentId?: string | null;
  }) {
    const node = await this.prisma.orgNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException('العنصر غير موجود');
    if (data.parentId) await this.assertParent(node.kind, data.parentId);
    return this.prisma.orgNode.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        code: data.code?.trim(),
        subtitle: data.subtitle?.trim(),
        levelMark: data.levelMark?.trim(),
        parentId: data.parentId,
      },
    });
  }

  async remove(id: string) {
    const children = await this.prisma.orgNode.count({ where: { parentId: id } });
    if (children) throw new BadRequestException('احذف العناصر التابعة أولًا');
    await this.prisma.user.updateMany({ where: { orgNodeId: id }, data: { orgNodeId: null } });
    return this.prisma.orgNode.delete({ where: { id } });
  }

  async assign(userId: string, nodeId: string | null) {
    if (nodeId) {
      const node = await this.prisma.orgNode.findUnique({ where: { id: nodeId } });
      if (!node) throw new NotFoundException('المجموعة غير موجودة');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { orgNodeId: nodeId },
      select: { id: true, fullName: true, username: true, role: true, orgNodeId: true },
    });
  }

  members() {
    return this.prisma.user.findMany({
      select: { id: true, fullName: true, username: true, role: true, orgNodeId: true, isActive: true },
      orderBy: { fullName: 'asc' },
    });
  }

  private async assertParent(kind: OrgKind, parentId?: string) {
    if (kind === OrgKind.DEPARTMENT && !parentId) {
      throw new BadRequestException('القسم لازم يتبع إدارة');
    }
    if (!parentId) return;
    const parent = await this.prisma.orgNode.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('الإدارة التابعة غير موجودة');
    if (kind === OrgKind.DEPARTMENT && parent.kind !== OrgKind.ADMINISTRATION) {
      throw new BadRequestException('القسم يتبع إدارة رئيسية فقط');
    }
  }
}
