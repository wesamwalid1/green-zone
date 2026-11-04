import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MfgJobStatus, MfgStageKind, Prisma, StockMovementType, WarehouseKind } from '@prisma/client';
import { autoCode } from '../common/auto-code';
import { postStockLine } from '../common/invoice-post';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriodsOpen } from '../settings/period-lock';

const STAGE_FLOW: MfgStageKind[] = [
  MfgStageKind.PRINTING,
  MfgStageKind.LAMINATION,
  MfgStageKind.SLITTER,
  MfgStageKind.CORE,
  MfgStageKind.DETAILING,
];

const STAGE_LABEL: Record<MfgStageKind, string> = {
  PRINTING: 'طباعة',
  LAMINATION: 'تبطين',
  SLITTER: 'سلتير',
  CORE: 'حساب الكور',
  DETAILING: 'تفصيل',
};

const DEFAULT_COST_TYPES = ['حبر', 'عمالة', 'كهرباء', 'صيانة', 'نقل', 'مواد مساعدة', 'أخرى'];

function money(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** الوزن الخارج من المرحلة = بعد، أو قبل − الهالك */
function outgoingWeight(stage?: {
  weightBefore?: number | null;
  weightAfter?: number | null;
  wasteQty?: number | null;
  skipped?: boolean;
} | null): number | null {
  if (!stage || stage.skipped) return null;
  if (stage.weightAfter != null && Number.isFinite(stage.weightAfter)) return Number(stage.weightAfter);
  if (stage.weightBefore != null && Number.isFinite(stage.weightBefore)) {
    return Math.max(0, Number(stage.weightBefore) - (Number(stage.wasteQty) || 0));
  }
  return null;
}

function jobInclude() {
  return {
    rawWarehouse: { select: { id: true, name: true, code: true } },
    finishedWarehouse: { select: { id: true, name: true, code: true } },
    finishedProduct: { select: { id: true, sku: true, name: true, salePrice: true, unit: true } },
    issues: {
      include: { product: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } } },
      orderBy: { product: { name: 'asc' as const } },
    },
    stages: {
      include: {
        costs: { include: { costType: true }, orderBy: { label: 'asc' as const } },
        materials: {
          include: { product: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } } },
        },
      },
      orderBy: { sortOrder: 'asc' as const },
    },
  } satisfies Prisma.MfgJobInclude;
}

@Injectable()
export class MfgService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  async onModuleInit() {
    await this.seedCostTypes().catch(() => undefined);
  }

  async seedCostTypes() {
    for (const name of DEFAULT_COST_TYPES) {
      await this.prisma.mfgCostType.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }
  }

  async ensureWarehouses() {
    const raw = await this.prisma.warehouse.upsert({
      where: { code: 'RAW' },
      create: {
        code: 'RAW',
        name: 'مخزن خام',
        kind: WarehouseKind.RAW,
        description: 'مواد خام للتصنيع',
      },
      update: { kind: WarehouseKind.RAW, isActive: true },
    });
    const finished = await this.prisma.warehouse.upsert({
      where: { code: 'MFG' },
      create: {
        code: 'MFG',
        name: 'مخزن تصنيع',
        kind: WarehouseKind.MANUFACTURING,
        description: 'منتجات بعد التصنيع',
      },
      update: { kind: WarehouseKind.MANUFACTURING, isActive: true },
    });
    return { raw, finished };
  }

  listCostTypes() {
    return this.prisma.mfgCostType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCostType(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new BadRequestException('اسم نوع التكلفة قصير');
    return this.prisma.mfgCostType.upsert({
      where: { name: trimmed },
      create: { name: trimmed },
      update: { isActive: true },
    });
  }

  async rawStock() {
    const { raw } = await this.ensureWarehouses();
    const balances = await this.prisma.stockBalance.findMany({
      where: { warehouseId: raw.id, quantity: { gt: 0 } },
      include: { product: { select: { id: true, sku: true, name: true, unit: true, costPrice: true, isActive: true } } },
      orderBy: { product: { name: 'asc' } },
    });
    return {
      warehouse: raw,
      items: balances
        .filter((row) => row.product.isActive !== false)
        .map((row) => ({
          productId: row.productId,
          quantity: row.quantity,
          product: row.product,
        })),
    };
  }

  listJobs() {
    return this.prisma.mfgJob.findMany({
      include: {
        rawWarehouse: { select: { id: true, name: true } },
        finishedWarehouse: { select: { id: true, name: true } },
        finishedProduct: { select: { id: true, name: true, sku: true } },
        issues: { include: { product: { select: { name: true } } } },
        stages: { select: { kind: true, skipped: true, completedAt: true, wasteQty: true } },
        _count: { select: { issues: true, stages: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** يضمن وجود كل المراحل (بما فيها الكور للأوامر القديمة) */
  private async ensureStageRows(jobId: string, stages: { id: string; kind: MfgStageKind; completedAt: Date | null }[], status: MfgJobStatus) {
    const existing = new Set(stages.map((s) => s.kind));
    const pastCore =
      status === MfgJobStatus.DETAILING ||
      status === MfgJobStatus.READY ||
      status === MfgJobStatus.DONE;
    for (let i = 0; i < STAGE_FLOW.length; i++) {
      const kind = STAGE_FLOW[i];
      if (existing.has(kind)) continue;
      await this.prisma.mfgStage.create({
        data: {
          jobId,
          kind,
          sortOrder: i + 1,
          skipped: kind === MfgStageKind.CORE && pastCore,
          completedAt: kind === MfgStageKind.CORE && pastCore ? new Date() : null,
          notes: kind === MfgStageKind.CORE && pastCore ? 'أُضيفت تلقائيًا لأمر سابق' : null,
        },
      });
    }
  }

  async getJob(id: string) {
    let job = await this.prisma.mfgJob.findUnique({
      where: { id },
      include: jobInclude(),
    });
    if (!job) throw new NotFoundException('أمر التصنيع غير موجود');
    await this.ensureStageRows(job.id, job.stages, job.status);
    if (job.stages.length < STAGE_FLOW.length) {
      job = await this.prisma.mfgJob.findUnique({
        where: { id },
        include: jobInclude(),
      });
      if (!job) throw new NotFoundException('أمر التصنيع غير موجود');
    }

    const currentKind = this.kindForStatus(job.status);
    let incomingWeight: number | null = null;
    if (currentKind) {
      const idx = STAGE_FLOW.indexOf(currentKind);
      if (idx > 0) {
        const prev = job.stages.find((s) => s.kind === STAGE_FLOW[idx - 1]);
        incomingWeight = outgoingWeight(prev);
      }
      const current = job.stages.find((s) => s.kind === currentKind);
      if (incomingWeight == null && current?.weightBefore != null) {
        incomingWeight = current.weightBefore;
      }
      if (incomingWeight == null && currentKind === MfgStageKind.PRINTING) {
        incomingWeight = money(job.issues.reduce((s, i) => s + i.quantity, 0)) || null;
      }
    }
    return {
      ...job,
      report: this.buildReport(job),
      stageLabels: STAGE_LABEL,
      incomingWeight,
      currentKind,
      issuedWeight: money(job.issues.reduce((s, i) => s + i.quantity, 0)),
    };
  }

  async createJob(data: {
    title?: string;
    notes?: string;
    createdById?: string;
    issues: { productId: string; quantity: number }[];
  }) {
    const issues = (data.issues || [])
      .map((row) => ({ productId: row.productId, quantity: Number(row.quantity) || 0 }))
      .filter((row) => row.productId && row.quantity > 0);
    if (!issues.length) throw new BadRequestException('اختر خامات وكميات للصرف إلى بوكس التصنيع');

    const { raw, finished } = await this.ensureWarehouses();
    await assertPeriodsOpen(this.prisma, new Date());
    const number = await this.sequence.next('mfg_job', 'MFG');

    const products = await this.prisma.product.findMany({
      where: { id: { in: issues.map((i) => i.productId) } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const created = await this.prisma.$transaction(async (tx) => {
      for (const line of issues) {
        const product = byId.get(line.productId);
        if (!product) throw new BadRequestException('صنف خام غير موجود');
        await postStockLine(tx, {
          warehouseId: raw.id,
          productId: line.productId,
          quantity: line.quantity,
          unitCost: product.costPrice || 0,
          type: StockMovementType.PRODUCTION_OUT,
          reference: number,
          direction: 'out',
          note: 'صرف خامات لأمر تصنيع',
          productName: product.name,
        });
      }

      return tx.mfgJob.create({
        data: {
          number,
          status: MfgJobStatus.PRINTING,
          title: data.title?.trim() || `تصنيع ${number}`,
          notes: data.notes?.trim() || null,
          rawWarehouseId: raw.id,
          finishedWarehouseId: finished.id,
          createdById: data.createdById || null,
          issues: {
            create: issues.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitCost: byId.get(line.productId)?.costPrice || 0,
            })),
          },
          stages: {
            create: STAGE_FLOW.map((kind, index) => ({
              kind,
              sortOrder: index + 1,
              weightBefore:
                kind === MfgStageKind.PRINTING
                  ? money(issues.reduce((s, i) => s + i.quantity, 0))
                  : null,
            })),
          },
        },
        select: { id: true },
      });
    });
    return this.getJob(created.id);
  }

  async completeStage(
    jobId: string,
    kind: MfgStageKind,
    data: {
      skip?: boolean;
      qtyAfter?: number;
      weightBefore?: number;
      weightAfter?: number;
      wasteQty?: number;
      increaseQty?: number;
      pricePerKg?: number;
      coreCount?: number;
      coreUnitWeight?: number;
      bagCount?: number;
      bagUnitWeight?: number;
      netQty?: number;
      notes?: string;
      costs?: { costTypeId?: string; label?: string; amount: number }[];
      materials?: { productId: string; quantity: number }[];
    },
  ) {
    await this.getJob(jobId); // ensure stages exist
    const job = await this.prisma.mfgJob.findUnique({
      where: { id: jobId },
      include: { stages: true, issues: true },
    });
    if (!job) throw new NotFoundException('أمر التصنيع غير موجود');
    if (job.status === MfgJobStatus.DONE || job.status === MfgJobStatus.CANCELLED) {
      throw new BadRequestException('الأمر مغلق');
    }
    if (job.status !== this.statusForKind(kind)) {
      const current = this.kindForStatus(job.status);
      throw new BadRequestException(
        current ? `المرحلة الحالية هي «${STAGE_LABEL[current]}»` : 'لا يمكن تعديل هذه المرحلة الآن',
      );
    }

    const stage = job.stages.find((s) => s.kind === kind);
    if (!stage) throw new BadRequestException('المرحلة غير موجودة');
    if (stage.completedAt) throw new BadRequestException('المرحلة مكتملة مسبقًا');

    await assertPeriodsOpen(this.prisma, new Date());

    if (data.skip) {
      if (kind !== MfgStageKind.DETAILING) throw new BadRequestException('يمكن تخطي مرحلة التفصيل فقط');
      await this.prisma.mfgStage.update({
        where: { id: stage.id },
        data: { skipped: true, completedAt: new Date(), notes: data.notes?.trim() || 'تم التخطي' },
      });
      await this.prisma.mfgJob.update({ where: { id: jobId }, data: { status: MfgJobStatus.READY } });
      return this.getJob(jobId);
    }

    const costs = (data.costs || [])
      .map((c) => ({
        costTypeId: c.costTypeId || null,
        label: (c.label || '').trim(),
        amount: Number(c.amount) || 0,
      }))
      .filter((c) => c.label && c.amount !== 0);

    for (const cost of costs) {
      if (cost.costTypeId && !cost.label) {
        const type = await this.prisma.mfgCostType.findUnique({ where: { id: cost.costTypeId } });
        cost.label = type?.name || 'تكلفة';
      }
      if (!cost.costTypeId && cost.label) {
        const upserted = await this.createCostType(cost.label);
        cost.costTypeId = upserted.id;
      }
    }

    const materials = (data.materials || [])
      .map((m) => ({ productId: m.productId, quantity: Number(m.quantity) || 0 }))
      .filter((m) => m.productId && m.quantity > 0);

    if (kind === MfgStageKind.PRINTING && materials.length) {
      throw new BadRequestException('مرحلة الطباعة لا تصرف مواد إضافية — المواد في بداية الأمر فقط');
    }
    if (kind === MfgStageKind.CORE && materials.length) {
      throw new BadRequestException('مرحلة حساب الكور لا تصرف مواد خام');
    }

    const productRows = materials.length
      ? await this.prisma.product.findMany({ where: { id: { in: materials.map((m) => m.productId) } } })
      : [];
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const stageIndex = STAGE_FLOW.indexOf(kind);
    let weightBefore =
      data.weightBefore != null && data.weightBefore !== undefined
        ? Number(data.weightBefore)
        : null;
    if (weightBefore == null && stageIndex > 0) {
      const prev = job.stages.find((s) => s.kind === STAGE_FLOW[stageIndex - 1]);
      weightBefore = outgoingWeight(prev);
    }
    if (weightBefore == null && kind === MfgStageKind.PRINTING) {
      weightBefore = money(job.issues.reduce((s, i) => s + i.quantity, 0));
    }

    const coreCount = data.coreCount != null ? Number(data.coreCount) : null;
    const coreUnitWeight = data.coreUnitWeight != null ? Number(data.coreUnitWeight) : null;
    const bagCount = data.bagCount != null ? Number(data.bagCount) : null;
    const bagUnitWeight = data.bagUnitWeight != null ? Number(data.bagUnitWeight) : null;
    let netQty = data.netQty != null ? Number(data.netQty) : null;
    if (netQty == null && bagCount != null && bagUnitWeight != null) {
      netQty = money(bagCount * bagUnitWeight);
    }

    let weightAfter =
      data.weightAfter != null && data.weightAfter !== undefined
        ? Number(data.weightAfter)
        : null;

    if (kind === MfgStageKind.CORE && weightAfter == null && weightBefore != null) {
      const coreTotal =
        coreCount != null && coreUnitWeight != null ? money(coreCount * coreUnitWeight) : 0;
      weightAfter = money(weightBefore + coreTotal);
    }

    if (kind === MfgStageKind.DETAILING && weightAfter == null && netQty != null) {
      weightAfter = netQty;
    }

    const materialsWeight = money(materials.reduce((s, m) => s + m.quantity, 0));
    const baseForDiff =
      kind === MfgStageKind.LAMINATION && weightBefore != null
        ? money(weightBefore + materialsWeight)
        : weightBefore;

    let wasteQty = Number(data.wasteQty) || 0;
    let increaseQty = Number(data.increaseQty) || 0;
    if (weightAfter != null && baseForDiff != null) {
      const diff = money(weightAfter - baseForDiff);
      if (diff >= 0) {
        increaseQty = diff;
        wasteQty = 0;
      } else {
        wasteQty = Math.abs(diff);
        increaseQty = 0;
      }
    } else if (kind === MfgStageKind.DETAILING && weightBefore != null && netQty != null) {
      wasteQty = Math.max(0, money(weightBefore - netQty));
      increaseQty = 0;
      if (weightAfter == null) weightAfter = netQty;
    } else if (weightAfter == null && weightBefore != null) {
      weightAfter = Math.max(0, weightBefore - wasteQty);
    }

    const pricePerKg = data.pricePerKg != null ? Number(data.pricePerKg) : null;

    await this.prisma.$transaction(async (tx) => {
      for (const mat of materials) {
        const product = productMap.get(mat.productId);
        if (!product) throw new BadRequestException('مادة مستخدمة غير موجودة');
        await postStockLine(tx, {
          warehouseId: job.rawWarehouseId,
          productId: mat.productId,
          quantity: mat.quantity,
          unitCost: product.costPrice || 0,
          type: StockMovementType.PRODUCTION_OUT,
          reference: job.number,
          direction: 'out',
          note: `مواد مرحلة ${STAGE_LABEL[kind]}`,
          productName: product.name,
        });
      }

      await tx.mfgStageCost.deleteMany({ where: { stageId: stage.id } });
      await tx.mfgStageMaterial.deleteMany({ where: { stageId: stage.id } });

      await tx.mfgStage.update({
        where: { id: stage.id },
        data: {
          skipped: false,
          qtyAfter: data.qtyAfter != null ? Number(data.qtyAfter) : netQty,
          weightBefore,
          weightAfter,
          wasteQty,
          increaseQty,
          pricePerKg,
          coreCount,
          coreUnitWeight,
          bagCount,
          bagUnitWeight,
          netQty,
          notes: data.notes?.trim() || null,
          completedAt: new Date(),
          costs: {
            create: costs.map((c) => ({
              costTypeId: c.costTypeId,
              label: c.label,
              amount: money(c.amount),
            })),
          },
          materials: {
            create: materials.map((m) => ({
              productId: m.productId,
              quantity: m.quantity,
              unitCost: productMap.get(m.productId)?.costPrice || 0,
            })),
          },
        },
      });

      const nextStatus = this.nextStatusAfter(kind);
      const nextKind = this.kindForStatus(nextStatus);
      if (nextKind && weightAfter != null) {
        let nextStage = job.stages.find((s) => s.kind === nextKind);
        if (!nextStage) {
          nextStage = await tx.mfgStage.create({
            data: {
              jobId,
              kind: nextKind,
              sortOrder: STAGE_FLOW.indexOf(nextKind) + 1,
              weightBefore: weightAfter,
            },
          });
        } else if (!nextStage.completedAt) {
          await tx.mfgStage.update({
            where: { id: nextStage.id },
            data: { weightBefore: weightAfter },
          });
        }
      }
      await tx.mfgJob.update({ where: { id: jobId }, data: { status: nextStatus } });
    });

    return this.getJob(jobId);
  }

  async transfer(
    jobId: string,
    data: {
      quantity: number;
      salePrice: number;
      productName?: string;
      productId?: string;
      sku?: string;
      unit?: string;
    },
  ) {
    const job = await this.getJob(jobId);
    if (job.status !== MfgJobStatus.READY) {
      throw new BadRequestException('أكمل كل المراحل أولًا قبل التحويل لمخزن التصنيع');
    }

    const quantity = Number(data.quantity);
    const salePrice = Number(data.salePrice);
    if (!(quantity > 0)) throw new BadRequestException('أدخل كمية المنتج النهائي');
    if (salePrice < 0) throw new BadRequestException('سعر البيع غير صالح');

    await assertPeriodsOpen(this.prisma, new Date());
    const report = job.report;
    const unitCost =
      report.costPerKg != null && quantity > 0 && report.finalWeight != null && Math.abs(quantity - report.finalWeight) < 0.0001
        ? report.costPerKg
        : quantity > 0
          ? money(report.grandTotal / quantity)
          : 0;

    return this.prisma.$transaction(async (tx) => {
      let productId = data.productId;
      if (!productId) {
        const name = (data.productName || job.title || `منتج ${job.number}`).trim();
        if (name.length < 2) throw new BadRequestException('اسم المنتج النهائي مطلوب');
        const created = await tx.product.create({
          data: {
            sku: autoCode('MFG', data.sku),
            name,
            unit: data.unit?.trim() || 'كيلو',
            costPrice: unitCost,
            salePrice,
            packUnit: 'بكرة',
          },
        });
        productId = created.id;
      } else {
        await tx.product.update({
          where: { id: productId },
          data: { costPrice: unitCost, salePrice },
        });
      }

      await postStockLine(tx, {
        warehouseId: job.finishedWarehouseId,
        productId,
        quantity,
        unitCost,
        type: StockMovementType.PRODUCTION_IN,
        reference: job.number,
        direction: 'in',
        note: 'تحويل من مراحل التصنيع إلى مخزن التصنيع',
      });

      const updated = await tx.mfgJob.update({
        where: { id: jobId },
        data: {
          status: MfgJobStatus.DONE,
          finishedProductId: productId,
          transferQty: quantity,
          salePrice,
          unitCost,
          totalCost: money(report.grandTotal),
          transferredAt: new Date(),
        },
        include: jobInclude(),
      });
      return { ...updated, report: this.buildReport(updated), stageLabels: STAGE_LABEL };
    });
  }

  private statusForKind(kind: MfgStageKind): MfgJobStatus {
    switch (kind) {
      case MfgStageKind.PRINTING:
        return MfgJobStatus.PRINTING;
      case MfgStageKind.LAMINATION:
        return MfgJobStatus.LAMINATION;
      case MfgStageKind.SLITTER:
        return MfgJobStatus.SLITTER;
      case MfgStageKind.CORE:
        return MfgJobStatus.CORE;
      case MfgStageKind.DETAILING:
        return MfgJobStatus.DETAILING;
      default:
        return MfgJobStatus.OPEN;
    }
  }

  private kindForStatus(status: MfgJobStatus): MfgStageKind | null {
    switch (status) {
      case MfgJobStatus.PRINTING:
        return MfgStageKind.PRINTING;
      case MfgJobStatus.LAMINATION:
        return MfgStageKind.LAMINATION;
      case MfgJobStatus.SLITTER:
        return MfgStageKind.SLITTER;
      case MfgJobStatus.CORE:
        return MfgStageKind.CORE;
      case MfgJobStatus.DETAILING:
        return MfgStageKind.DETAILING;
      default:
        return null;
    }
  }

  private nextStatusAfter(kind: MfgStageKind): MfgJobStatus {
    switch (kind) {
      case MfgStageKind.PRINTING:
        return MfgJobStatus.LAMINATION;
      case MfgStageKind.LAMINATION:
        return MfgJobStatus.SLITTER;
      case MfgStageKind.SLITTER:
        return MfgJobStatus.CORE;
      case MfgStageKind.CORE:
        return MfgJobStatus.DETAILING;
      case MfgStageKind.DETAILING:
        return MfgJobStatus.READY;
      default:
        return MfgJobStatus.READY;
    }
  }

  buildReport(job: {
    issues: { quantity: number; unitCost: number; product: { name: string; sku: string; unit?: string | null } }[];
    stages: {
      kind: MfgStageKind;
      skipped: boolean;
      qtyAfter: number | null;
      weightBefore: number | null;
      weightAfter: number | null;
      wasteQty: number;
      increaseQty?: number;
      pricePerKg?: number | null;
      coreCount?: number | null;
      coreUnitWeight?: number | null;
      bagCount?: number | null;
      bagUnitWeight?: number | null;
      netQty?: number | null;
      notes: string | null;
      completedAt: Date | null;
      costs: { label: string; amount: number }[];
      materials: { quantity: number; unitCost: number; product: { name: string; sku: string } }[];
    }[];
    transferQty?: number | null;
    salePrice?: number | null;
    unitCost?: number;
    totalCost?: number;
  }) {
    const issuedCost = money(job.issues.reduce((s, i) => s + i.quantity * i.unitCost, 0));
    const stageReports = STAGE_FLOW.map((kind, index) => {
      const stage = job.stages.find((s) => s.kind === kind);
      const costsTotal = money((stage?.costs || []).reduce((s, c) => s + c.amount, 0));
      const materialsTotal = money((stage?.materials || []).reduce((s, m) => s + m.quantity * m.unitCost, 0));
      const weightBefore = stage?.weightBefore ?? null;
      const weightAfter = stage?.weightAfter ?? outgoingWeight(stage);
      const wasteQty = stage?.wasteQty || 0;
      const increaseQty = stage?.increaseQty || 0;
      const carriedFrom =
        index > 0
          ? outgoingWeight(job.stages.find((s) => s.kind === STAGE_FLOW[index - 1]))
          : null;
      const lossPct =
        weightBefore != null && weightBefore > 0
          ? money((wasteQty / weightBefore) * 100)
          : null;
      const coreTotal =
        stage?.coreCount != null && stage?.coreUnitWeight != null
          ? money(stage.coreCount * stage.coreUnitWeight)
          : null;
      return {
        kind,
        label: STAGE_LABEL[kind],
        skipped: !!stage?.skipped,
        completed: !!stage?.completedAt,
        qtyAfter: stage?.qtyAfter ?? null,
        weightBefore,
        weightAfter,
        carriedFrom,
        wasteQty,
        increaseQty,
        pricePerKg: stage?.pricePerKg ?? null,
        coreCount: stage?.coreCount ?? null,
        coreUnitWeight: stage?.coreUnitWeight ?? null,
        coreTotal,
        bagCount: stage?.bagCount ?? null,
        bagUnitWeight: stage?.bagUnitWeight ?? null,
        netQty: stage?.netQty ?? null,
        lossPct,
        notes: stage?.notes || null,
        costs: stage?.costs || [],
        costsTotal,
        materials: stage?.materials || [],
        materialsTotal,
        stageTotal: money(costsTotal + materialsTotal),
        completedAt: stage?.completedAt || null,
      };
    });

    const allCosts = stageReports.flatMap((s) => [
      ...s.costs.map((c) => ({ ...c, stage: s.label, kind: 'cost' as const })),
      ...(s.materialsTotal
        ? [{ label: `مواد ${s.label}`, amount: s.materialsTotal, stage: s.label, kind: 'material' as const }]
        : []),
    ]);
    if (issuedCost) {
      allCosts.unshift({ label: 'خامات ابتدائية', amount: issuedCost, stage: 'صرف ابتدائي', kind: 'material' });
    }
    const allWaste = stageReports.map((s) => ({
      stage: s.label,
      wasteQty: s.wasteQty,
      increaseQty: s.increaseQty,
      lossPct: s.lossPct,
      skipped: s.skipped,
      weightBefore: s.weightBefore,
      weightAfter: s.weightAfter,
    }));
    const allMaterials = [
      ...job.issues.map((i) => ({
        stage: 'صرف ابتدائي (بوكس)',
        name: i.product.name,
        sku: i.product.sku,
        quantity: i.quantity,
        unitCost: i.unitCost,
        total: money(i.quantity * i.unitCost),
      })),
      ...stageReports.flatMap((s) =>
        s.materials.map((m) => ({
          stage: s.label,
          name: m.product.name,
          sku: m.product.sku,
          quantity: m.quantity,
          unitCost: m.unitCost,
          total: money(m.quantity * m.unitCost),
        })),
      ),
    ];

    const stagesCost = money(stageReports.reduce((s, r) => s + r.stageTotal, 0));
    const grandTotal = money(issuedCost + stagesCost);
    const totalWaste = money(stageReports.reduce((s, r) => s + (r.wasteQty || 0), 0));
    const totalIncrease = money(stageReports.reduce((s, r) => s + (r.increaseQty || 0), 0));
    const firstWeight = stageReports.find((s) => s.weightBefore != null)?.weightBefore ?? null;
    const lastCompleted = [...stageReports].reverse().find((s) => s.completed && !s.skipped);
    const finalWeight = lastCompleted?.weightAfter ?? lastCompleted?.netQty ?? null;
    const costPerKg =
      finalWeight != null && finalWeight > 0 ? money(grandTotal / finalWeight) : null;
    const weightFlow = stageReports
      .filter((s) => s.completed && !s.skipped)
      .map((s) => ({
        stage: s.label,
        in: s.weightBefore,
        out: s.weightAfter,
        waste: s.wasteQty,
        increase: s.increaseQty,
        lossPct: s.lossPct,
      }));

    return {
      issuedCost,
      stagesCost,
      grandTotal,
      totalWaste,
      totalIncrease,
      firstWeight,
      finalWeight,
      costPerKg,
      netWeightLoss:
        firstWeight != null && finalWeight != null ? money(firstWeight - finalWeight) : null,
      weightFlow,
      stageReports,
      allCosts,
      allWaste,
      allMaterials,
      transfer: {
        qty: job.transferQty ?? null,
        salePrice: job.salePrice ?? null,
        unitCost: job.unitCost ?? null,
        totalCost: job.totalCost ?? null,
      },
    };
  }
}
