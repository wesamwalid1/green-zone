import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductionStatus, StockMovementType, WarehouseKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import { postStockLine } from '../common/invoice-post';

function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class ProductionService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  /** يضمن وجود مخزن خام ومخزن تصنيع */
  async ensureWarehouses() {
    const raw = await this.prisma.warehouse.upsert({
      where: { code: 'RAW' },
      create: {
        code: 'RAW',
        name: 'مخزن خام',
        kind: WarehouseKind.RAW,
        description: 'مواد مشتراة / خام للتصنيع',
      },
      update: { kind: WarehouseKind.RAW, isActive: true },
    });
    const finished = await this.prisma.warehouse.upsert({
      where: { code: 'MFG' },
      create: {
        code: 'MFG',
        name: 'مخزن تصنيع',
        kind: WarehouseKind.MANUFACTURING,
        description: 'منتجات مصنّعة جاهزة',
      },
      update: { kind: WarehouseKind.MANUFACTURING, isActive: true },
    });
    return { raw, finished };
  }

  warehouses() {
    return this.ensureWarehouses();
  }

  // ─── BOM ──────────────────────────────────────────────────
  listRecipes() {
    return this.prisma.bomRecipe.findMany({
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } },
        lines: {
          include: { material: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } } },
          orderBy: { material: { name: 'asc' } },
        },
        _count: { select: { orders: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getRecipe(id: string) {
    const row = await this.prisma.bomRecipe.findUnique({
      where: { id },
      include: {
        product: true,
        lines: { include: { material: true }, orderBy: { material: { name: 'asc' } } },
      },
    });
    if (!row) throw new NotFoundException('الوصفة غير موجودة');
    return row;
  }

  async createRecipe(data: {
    name: string;
    productId: string;
    outputQty?: number;
    notes?: string;
    lines: { materialId: string; quantity: number }[];
  }) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('اسم الوصفة مطلوب');
    const outputQty = Math.max(0.0001, Number(data.outputQty) || 1);
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
    if (!product || !product.isActive) throw new BadRequestException('المنتج النهائي غير موجود');
    const lines = this.normalizeBomLines(data.lines, data.productId);
    await this.assertMaterials(lines.map((l) => l.materialId));

    return this.prisma.bomRecipe.create({
      data: {
        name,
        productId: data.productId,
        outputQty,
        notes: data.notes?.trim() || null,
        lines: { create: lines },
      },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        lines: { include: { material: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } } } },
      },
    });
  }

  async updateRecipe(
    id: string,
    data: Partial<{
      name: string;
      productId: string;
      outputQty: number;
      notes: string | null;
      isActive: boolean;
      lines: { materialId: string; quantity: number }[];
    }>,
  ) {
    await this.getRecipe(id);
    if (data.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
      if (!product || !product.isActive) throw new BadRequestException('المنتج النهائي غير موجود');
    }
    const lines = data.lines ? this.normalizeBomLines(data.lines, data.productId) : null;
    if (lines) await this.assertMaterials(lines.map((l) => l.materialId));

    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.bomLine.deleteMany({ where: { recipeId: id } });
        await tx.bomLine.createMany({
          data: lines.map((l) => ({ recipeId: id, materialId: l.materialId, quantity: l.quantity })),
        });
      }
      return tx.bomRecipe.update({
        where: { id },
        data: {
          ...(data.name != null ? { name: data.name.trim() } : {}),
          ...(data.productId ? { productId: data.productId } : {}),
          ...(data.outputQty != null ? { outputQty: Math.max(0.0001, Number(data.outputQty) || 1) } : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
        },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          lines: { include: { material: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } } } },
        },
      });
    });
  }

  async deleteRecipe(id: string) {
    const posted = await this.prisma.productionOrder.count({
      where: { recipeId: id, status: ProductionStatus.POSTED },
    });
    if (posted) throw new BadRequestException('لا تُحذف وصفة لها أوامر إنتاج مرحّلة');
    await this.prisma.productionOrder.deleteMany({ where: { recipeId: id, status: ProductionStatus.DRAFT } });
    await this.prisma.bomRecipe.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الوصفة غير موجودة');
    });
    return { ok: true };
  }

  private normalizeBomLines(lines: { materialId: string; quantity: number }[], finishedProductId?: string) {
    if (!lines?.length) throw new BadRequestException('أضف مادة خام واحدة على الأقل');
    const map = new Map<string, number>();
    for (const line of lines) {
      const qty = Number(line.quantity) || 0;
      if (qty <= 0) throw new BadRequestException('كمية المادة لازم تكون أكبر من صفر');
      if (finishedProductId && line.materialId === finishedProductId) {
        throw new BadRequestException('لا يمكن أن يكون المنتج النهائي مادة في وصفته');
      }
      map.set(line.materialId, (map.get(line.materialId) || 0) + qty);
    }
    return [...map.entries()].map(([materialId, quantity]) => ({ materialId, quantity }));
  }

  private async assertMaterials(ids: string[]) {
    const count = await this.prisma.product.count({ where: { id: { in: ids }, isActive: true } });
    if (count !== ids.length) throw new BadRequestException('بعض المواد غير موجودة أو موقوفة');
  }

  // ─── production orders ────────────────────────────────────
  listOrders() {
    return this.prisma.productionOrder.findMany({
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        recipe: { select: { id: true, name: true, outputQty: true } },
        rawWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        finishedWarehouse: { select: { id: true, code: true, name: true, kind: true } },
        materials: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(id: string) {
    const row = await this.prisma.productionOrder.findUnique({
      where: { id },
      include: {
        product: true,
        recipe: { include: { lines: { include: { material: true } } } },
        rawWarehouse: true,
        finishedWarehouse: true,
        materials: { include: { product: true } },
      },
    });
    if (!row) throw new NotFoundException('أمر الإنتاج غير موجود');
    return row;
  }

  /** معاينة المواد المطلوبة والكميات المتاحة */
  async preview(data: { recipeId: string; quantity: number; rawWarehouseId?: string }) {
    const recipe = await this.getRecipe(data.recipeId);
    if (!recipe.isActive) throw new BadRequestException('الوصفة موقوفة');
    const qty = Number(data.quantity) || 0;
    if (qty <= 0) throw new BadRequestException('كمية الإنتاج لازم تكون أكبر من صفر');
    const wh = await this.resolveWarehouses(data.rawWarehouseId);
    const factor = qty / recipe.outputQty;
    const materials = [];
    for (const line of recipe.lines) {
      const need = roundMoney(line.quantity * factor);
      const bal = await this.prisma.stockBalance.findUnique({
        where: {
          warehouseId_productId: { warehouseId: wh.raw.id, productId: line.materialId },
        },
      });
      const available = bal?.quantity || 0;
      materials.push({
        materialId: line.materialId,
        sku: line.material.sku,
        name: line.material.name,
        unit: line.material.unit,
        unitCost: line.material.costPrice || 0,
        need,
        available,
        enough: available + 0.0001 >= need,
      });
    }
    const totalCost = roundMoney(materials.reduce((s, m) => s + m.need * m.unitCost, 0));
    return {
      recipe: { id: recipe.id, name: recipe.name, outputQty: recipe.outputQty },
      product: recipe.product,
      quantity: qty,
      rawWarehouse: wh.raw,
      finishedWarehouse: wh.finished,
      materials,
      totalCost,
      unitCost: qty ? roundMoney(totalCost / qty) : 0,
      canPost: materials.every((m) => m.enough),
    };
  }

  async createOrder(data: {
    recipeId: string;
    quantity: number;
    rawWarehouseId?: string;
    finishedWarehouseId?: string;
    notes?: string;
    createdById?: string;
    post?: boolean;
  }) {
    const recipe = await this.getRecipe(data.recipeId);
    if (!recipe.isActive) throw new BadRequestException('الوصفة موقوفة');
    const quantity = Number(data.quantity) || 0;
    if (quantity <= 0) throw new BadRequestException('كمية الإنتاج لازم تكون أكبر من صفر');
    const wh = await this.resolveWarehouses(data.rawWarehouseId, data.finishedWarehouseId);

    const number = await this.sequence.next('production', 'PRD');
    const order = await this.prisma.productionOrder.create({
      data: {
        number,
        recipeId: recipe.id,
        productId: recipe.productId,
        quantity,
        rawWarehouseId: wh.raw.id,
        finishedWarehouseId: wh.finished.id,
        notes: data.notes?.trim() || null,
        createdById: data.createdById || null,
        status: ProductionStatus.DRAFT,
      },
    });

    if (data.post) {
      return this.postOrder(order.id);
    }
    return this.getOrder(order.id);
  }

  async deleteOrder(id: string) {
    const order = await this.getOrder(id);
    if (order.status !== ProductionStatus.DRAFT) {
      throw new BadRequestException('فقط المسودة قابلة للحذف');
    }
    await this.prisma.productionOrder.delete({ where: { id } });
    return { ok: true };
  }

  async postOrder(id: string) {
    const order = await this.getOrder(id);
    if (order.status === ProductionStatus.POSTED) {
      throw new BadRequestException('أمر الإنتاج مرحّل مسبقاً');
    }
    await assertPeriodsOpen(this.prisma, new Date());

    const recipe = order.recipe;
    if (!recipe.lines.length) throw new BadRequestException('الوصفة بدون مواد');
    const factor = order.quantity / recipe.outputQty;

    const materialRows = recipe.lines.map((line) => ({
      productId: line.materialId,
      name: line.material.name,
      quantity: roundMoney(line.quantity * factor),
      unitCost: line.material.costPrice || 0,
    }));

    const totalCost = roundMoney(materialRows.reduce((s, m) => s + m.quantity * m.unitCost, 0));
    const unitCost = order.quantity ? roundMoney(totalCost / order.quantity) : 0;

    return this.prisma.$transaction(async (tx) => {
      for (const mat of materialRows) {
        await postStockLine(tx, {
          warehouseId: order.rawWarehouseId,
          productId: mat.productId,
          quantity: mat.quantity,
          unitCost: mat.unitCost,
          type: StockMovementType.PRODUCTION_OUT,
          reference: order.number,
          direction: 'out',
          note: `تصنيع ${order.number}`,
          productName: mat.name,
        });
      }

      await postStockLine(tx, {
        warehouseId: order.finishedWarehouseId,
        productId: order.productId,
        quantity: order.quantity,
        unitCost,
        type: StockMovementType.PRODUCTION_IN,
        reference: order.number,
        direction: 'in',
        note: `إنتاج ${order.number}`,
      });

      // تحديث تكلفة المنتج النهائي بمتوسط مرجح بسيط
      const product = await tx.product.findUnique({ where: { id: order.productId } });
      if (product) {
        const finishedBal = await tx.stockBalance.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: order.finishedWarehouseId,
              productId: order.productId,
            },
          },
        });
        const prevQty = Math.max(0, (finishedBal?.quantity || 0) - order.quantity);
        const prevCost = product.costPrice || 0;
        const blended =
          prevQty + order.quantity > 0
            ? roundMoney((prevQty * prevCost + order.quantity * unitCost) / (prevQty + order.quantity))
            : unitCost;
        await tx.product.update({ where: { id: product.id }, data: { costPrice: blended } });
      }

      await tx.productionMaterial.deleteMany({ where: { orderId: order.id } });
      await tx.productionMaterial.createMany({
        data: materialRows.map((m) => ({
          orderId: order.id,
          productId: m.productId,
          quantity: m.quantity,
          unitCost: m.unitCost,
        })),
      });

      return tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionStatus.POSTED,
          unitCost,
          totalCost,
          producedAt: new Date(),
        },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          recipe: { select: { id: true, name: true, outputQty: true } },
          rawWarehouse: { select: { id: true, code: true, name: true, kind: true } },
          finishedWarehouse: { select: { id: true, code: true, name: true, kind: true } },
          materials: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
        },
      });
    });
  }

  private async resolveWarehouses(rawId?: string, finishedId?: string) {
    const ensured = await this.ensureWarehouses();
    let raw = ensured.raw;
    let finished = ensured.finished;
    if (rawId) {
      const wh = await this.prisma.warehouse.findUnique({ where: { id: rawId } });
      if (!wh || !wh.isActive) throw new BadRequestException('مخزن الخام غير موجود');
      if (wh.kind !== WarehouseKind.RAW && wh.kind !== WarehouseKind.GENERAL) {
        throw new BadRequestException('مخزن الصرف لازم يكون خام أو عام');
      }
      raw = wh;
    }
    if (finishedId) {
      const wh = await this.prisma.warehouse.findUnique({ where: { id: finishedId } });
      if (!wh || !wh.isActive) throw new BadRequestException('مخزن التصنيع غير موجود');
      if (wh.kind !== WarehouseKind.MANUFACTURING && wh.kind !== WarehouseKind.GENERAL) {
        throw new BadRequestException('مخزن الإضافة لازم يكون تصنيع أو عام');
      }
      finished = wh;
    }
    if (raw.id === finished.id) throw new BadRequestException('مخزن الخام والتصنيع لازم يختلفا');
    return { raw, finished };
  }
}
