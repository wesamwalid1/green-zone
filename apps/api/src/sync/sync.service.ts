import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SyncOp } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { hostname } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { isSyncEntity, SYNC_ENTITY_TYPES, type SyncEntityType } from './entities';
import { isSyncSkipped, runWithoutSyncRecording } from './sync-context';

type ChangeDto = {
  id?: string;
  entityType: string;
  entityId: string;
  op: 'UPSERT' | 'DELETE';
  payload: string;
  version: number;
  deviceKey: string;
  createdAt: string;
};

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly log = new Logger(SyncService.name);
  private deviceKey = 'local';

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    this.deviceKey = await this.ensureDeviceKey();
  }

  getDeviceKey() {
    return this.deviceKey;
  }

  private async ensureDeviceKey() {
    const existing = await this.prisma.syncState.findUnique({ where: { id: 'default' } });
    if (existing?.deviceKey && existing.deviceKey !== 'local') return existing.deviceKey;
    const key = `dev-${createHash('sha1').update(`${hostname()}-${randomUUID()}`).digest('hex').slice(0, 16)}`;
    await this.prisma.syncState.upsert({
      where: { id: 'default' },
      create: { id: 'default', deviceKey: key },
      update: { deviceKey: key },
    });
    await this.prisma.syncDevice.upsert({
      where: { deviceKey: key },
      create: { deviceKey: key, label: hostname() || 'Green Zone PC' },
      update: { lastSeenAt: new Date() },
    });
    return key;
  }

  /** يجمع التغييرات منذ آخر مزامنة في الـ outbox (بديل middleware Prisma 6) */
  async enqueueRecentChanges() {
    if (isSyncSkipped()) return { enqueued: 0 };
    const state = await this.prisma.syncState.findUnique({ where: { id: 'default' } });
    const since = state?.lastSyncAt || new Date(0);
    let enqueued = 0;
    const bump = async (type: SyncEntityType, id: string, row?: unknown) => {
      await this.recordChange(type, id, 'UPSERT', row);
      enqueued += 1;
    };

    for (const row of await this.prisma.customer.findMany({ where: { updatedAt: { gt: since } } })) {
      await bump('Customer', row.id, row);
    }
    for (const row of await this.prisma.supplier.findMany({ where: { updatedAt: { gt: since } } })) {
      await bump('Supplier', row.id, row);
    }
    for (const row of await this.prisma.product.findMany({
      where: { updatedAt: { gt: since } },
      include: { tradeUnits: true },
    })) {
      await bump('Product', row.id, row);
    }
    for (const row of await this.prisma.stockBalance.findMany({ where: { updatedAt: { gt: since } } })) {
      await bump('StockBalance', row.id, row);
    }
    for (const row of await this.prisma.salesInvoice.findMany({
      where: { updatedAt: { gt: since } },
      include: { lines: true },
    })) {
      await bump('SalesInvoice', row.id, row);
    }
    for (const row of await this.prisma.purchaseInvoice.findMany({
      where: { updatedAt: { gt: since } },
      include: { lines: true },
    })) {
      await bump('PurchaseInvoice', row.id, row);
    }
    for (const row of await this.prisma.expense.findMany({ where: { createdAt: { gt: since } } })) {
      await bump('Expense', row.id, row);
    }
    for (const row of await this.prisma.cashAccount.findMany({ where: { updatedAt: { gt: since } } })) {
      await bump('CashAccount', row.id, row);
    }
    return { enqueued };
  }

  async recordChange(entityType: SyncEntityType, entityId: string, op: 'UPSERT' | 'DELETE', payloadObj?: unknown) {
    if (isSyncSkipped()) return;
    let payload = '{}';
    if (op === 'UPSERT') {
      const data = payloadObj ?? (await this.loadEntityPayload(entityType, entityId));
      if (!data) return;
      payload = JSON.stringify(data);
    }
    const last = await this.prisma.syncChange.findFirst({
      where: { entityType, entityId },
      orderBy: { version: 'desc' },
    });
    await this.prisma.syncChange.deleteMany({
      where: { entityType, entityId, deviceKey: this.deviceKey, pushedAt: null },
    });
    await this.prisma.syncChange.create({
      data: {
        entityType,
        entityId,
        op: op === 'DELETE' ? SyncOp.DELETE : SyncOp.UPSERT,
        payload,
        version: (last?.version || 0) + 1,
        deviceKey: this.deviceKey,
      },
    });
  }

  private async loadEntityPayload(entityType: SyncEntityType, entityId: string): Promise<unknown | null> {
    switch (entityType) {
      case 'Customer':
        return this.prisma.customer.findUnique({ where: { id: entityId } });
      case 'Supplier':
        return this.prisma.supplier.findUnique({ where: { id: entityId } });
      case 'Product':
        return this.prisma.product.findUnique({
          where: { id: entityId },
          include: { tradeUnits: true },
        });
      case 'StockBalance':
        return this.prisma.stockBalance.findUnique({ where: { id: entityId } });
      case 'SalesInvoice':
        return this.prisma.salesInvoice.findUnique({
          where: { id: entityId },
          include: { lines: true },
        });
      case 'PurchaseInvoice':
        return this.prisma.purchaseInvoice.findUnique({
          where: { id: entityId },
          include: { lines: true },
        });
      case 'Expense':
        return this.prisma.expense.findUnique({ where: { id: entityId } });
      case 'CashAccount':
        return this.prisma.cashAccount.findUnique({ where: { id: entityId } });
      default:
        return null;
    }
  }

  async status() {
    const state = await this.prisma.syncState.findUnique({ where: { id: 'default' } });
    const pending = await this.prisma.syncChange.count({ where: { pushedAt: null } });
    const conflicts = await this.prisma.syncConflict.count({ where: { resolvedAt: null } });
    const cloudUrl = state?.cloudUrl || process.env.SYNC_CLOUD_URL || '';
    let online = false;
    if (cloudUrl) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(`${cloudUrl.replace(/\/$/, '')}/api/health`, { signal: ctrl.signal });
        clearTimeout(t);
        online = res.ok;
      } catch {
        online = false;
      }
    }
    return {
      mode: process.env.SYNC_MODE || 'desktop',
      phase: process.env.SYNC_PHASE || '1',
      deviceKey: this.deviceKey,
      cloudUrl,
      online,
      pendingChanges: pending,
      openConflicts: conflicts,
      lastSyncAt: state?.lastSyncAt || null,
      lastError: state?.lastError || null,
      lastPullCursor: state?.lastPullCursor || '',
      entities: SYNC_ENTITY_TYPES,
    };
  }

  async configure(data: { cloudUrl?: string; cloudToken?: string; label?: string }) {
    const cloudUrl = (data.cloudUrl || '').trim().replace(/\/$/, '');
    await this.prisma.syncState.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        deviceKey: this.deviceKey,
        cloudUrl,
        cloudToken: data.cloudToken || '',
      },
      update: {
        cloudUrl,
        ...(data.cloudToken !== undefined ? { cloudToken: data.cloudToken } : {}),
        lastError: null,
      },
    });
    if (data.label) {
      await this.prisma.syncDevice.update({
        where: { deviceKey: this.deviceKey },
        data: { label: data.label },
      });
    }
    return this.status();
  }

  /** يستقبل الطرف السحابي تغييرات من ديسكتوب */
  async acceptPush(body: { deviceKey: string; changes: ChangeDto[] }) {
    if (!body.deviceKey) throw new BadRequestException('deviceKey مطلوب');
    await this.prisma.syncDevice.upsert({
      where: { deviceKey: body.deviceKey },
      create: { deviceKey: body.deviceKey, label: body.deviceKey, lastPushAt: new Date(), lastSeenAt: new Date() },
      update: { lastPushAt: new Date(), lastSeenAt: new Date() },
    });

    const applied: string[] = [];
    const conflicts: string[] = [];
    for (const change of body.changes || []) {
      if (!isSyncEntity(change.entityType)) continue;
      const result = await this.applyRemoteChange(change);
      if (result === 'applied') applied.push(change.id || `${change.entityType}:${change.entityId}`);
      if (result === 'conflict') conflicts.push(change.id || `${change.entityType}:${change.entityId}`);
    }
    return { ok: true, applied: applied.length, conflicts: conflicts.length };
  }

  /** يسحب الديسكتوب تغييرات من السحابة بعد cursor */
  async exportChanges(cursor: string | undefined, limit = 200, excludeDevice?: string) {
    const where: { createdAt?: { gt: Date }; deviceKey?: { not: string } } = {};
    if (cursor) {
      const t = new Date(cursor);
      if (!Number.isNaN(t.getTime())) where.createdAt = { gt: t };
    }
    if (excludeDevice) where.deviceKey = { not: excludeDevice };
    const rows = await this.prisma.syncChange.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 500),
    });
    const nextCursor = rows.length ? rows[rows.length - 1].createdAt.toISOString() : cursor || '';
    return {
      changes: rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        op: row.op as 'UPSERT' | 'DELETE',
        payload: row.payload,
        version: row.version,
        deviceKey: row.deviceKey,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  private async applyRemoteChange(change: ChangeDto): Promise<'applied' | 'conflict' | 'skipped'> {
    if (!isSyncEntity(change.entityType)) return 'skipped';
    return runWithoutSyncRecording(async () => {
      const local = await this.loadEntityPayload(change.entityType as SyncEntityType, change.entityId);
      if (change.op === 'DELETE') {
        await this.deleteEntity(change.entityType as SyncEntityType, change.entityId);
        await this.prisma.syncChange.create({
          data: {
            entityType: change.entityType,
            entityId: change.entityId,
            op: SyncOp.DELETE,
            payload: '{}',
            version: change.version,
            deviceKey: change.deviceKey,
            pushedAt: new Date(),
          },
        });
        return 'applied';
      }

      let remote: Record<string, unknown>;
      try {
        remote = JSON.parse(change.payload) as Record<string, unknown>;
      } catch {
        return 'skipped';
      }

      if (local && typeof local === 'object' && 'updatedAt' in local && remote.updatedAt) {
        const localTs = new Date(String((local as { updatedAt: Date }).updatedAt)).getTime();
        const remoteTs = new Date(String(remote.updatedAt)).getTime();
        if (localTs > remoteTs) {
          await this.prisma.syncConflict.create({
            data: {
              entityType: change.entityType,
              entityId: change.entityId,
              localPayload: JSON.stringify(local),
              remotePayload: change.payload,
              resolution: 'LOCAL_KEPT',
              note: 'آخر كتابة محلية أحدث — تم الإبقاء على المحلي (مرحلة 1)',
            },
          });
          return 'conflict';
        }
      }

      await this.upsertEntity(change.entityType as SyncEntityType, remote);
      await this.prisma.syncChange.create({
        data: {
          entityType: change.entityType,
          entityId: change.entityId,
          op: SyncOp.UPSERT,
          payload: change.payload,
          version: change.version,
          deviceKey: change.deviceKey,
          pushedAt: new Date(),
        },
      });
      return 'applied';
    });
  }

  private async deleteEntity(entityType: SyncEntityType, entityId: string) {
    try {
      switch (entityType) {
        case 'Customer':
          await this.prisma.customer.delete({ where: { id: entityId } });
          break;
        case 'Supplier':
          await this.prisma.supplier.delete({ where: { id: entityId } });
          break;
        case 'Product':
          await this.prisma.product.update({ where: { id: entityId }, data: { isActive: false } });
          break;
        case 'StockBalance':
          await this.prisma.stockBalance.delete({ where: { id: entityId } });
          break;
        case 'SalesInvoice':
          await this.prisma.salesInvoice.update({ where: { id: entityId }, data: { status: 'CANCELLED' } });
          break;
        case 'PurchaseInvoice':
          await this.prisma.purchaseInvoice.update({ where: { id: entityId }, data: { status: 'CANCELLED' } });
          break;
        case 'Expense':
          await this.prisma.expense.delete({ where: { id: entityId } });
          break;
        case 'CashAccount':
          await this.prisma.cashAccount.update({ where: { id: entityId }, data: { isActive: false } }).catch(() => undefined);
          break;
        default:
          break;
      }
    } catch {
      /* قد يكون محذوفًا بالفعل */
    }
  }

  private async upsertEntity(entityType: SyncEntityType, raw: Record<string, unknown>) {
    const id = String(raw.id || '');
    if (!id) return;

    switch (entityType) {
      case 'Customer': {
        const { id: _i, createdAt, updatedAt, ...data } = raw as Record<string, unknown>;
        await this.prisma.customer.upsert({
          where: { id },
          create: { ...(data as object), id } as never,
          update: data as never,
        });
        break;
      }
      case 'Supplier': {
        const { id: _i, createdAt, updatedAt, ...data } = raw as Record<string, unknown>;
        await this.prisma.supplier.upsert({
          where: { id },
          create: { ...(data as object), id } as never,
          update: data as never,
        });
        break;
      }
      case 'Product': {
        const { id: _i, createdAt, updatedAt, tradeUnits, category, ...data } = raw as Record<string, unknown> & {
          tradeUnits?: { name: string; factor: number; sortOrder?: number }[];
        };
        await this.prisma.product.upsert({
          where: { id },
          create: { ...(data as object), id } as never,
          update: data as never,
        });
        if (Array.isArray(tradeUnits)) {
          await this.prisma.productTradeUnit.deleteMany({ where: { productId: id } });
          for (const unit of tradeUnits) {
            await this.prisma.productTradeUnit.create({
              data: {
                productId: id,
                name: unit.name,
                factor: Number(unit.factor) || 1,
                sortOrder: unit.sortOrder || 0,
              },
            });
          }
        }
        break;
      }
      case 'StockBalance': {
        const warehouseId = String(raw.warehouseId || '');
        const productId = String(raw.productId || '');
        const quantity = Number(raw.quantity) || 0;
        if (!warehouseId || !productId) return;
        await this.prisma.stockBalance.upsert({
          where: { warehouseId_productId: { warehouseId, productId } },
          create: { id, warehouseId, productId, quantity },
          update: { quantity },
        });
        break;
      }
      case 'SalesInvoice': {
        const { lines, customer, warehouse, shift, createdBy, receipts, returns, prodOrders, ...data } = raw as Record<string, unknown> & {
          lines?: Record<string, unknown>[];
        };
        const { id: _i, createdAt, updatedAt, ...fields } = data;
        await this.prisma.salesInvoice.upsert({
          where: { id },
          create: { ...(fields as object), id } as never,
          update: fields as never,
        });
        if (Array.isArray(lines)) {
          await this.prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
          for (const line of lines) {
            const { invoice, product, ...lineData } = line;
            await this.prisma.salesInvoiceLine.create({
              data: { ...(lineData as object), invoiceId: id } as never,
            });
          }
        }
        void customer;
        void warehouse;
        void shift;
        void createdBy;
        void receipts;
        void returns;
        void prodOrders;
        break;
      }
      case 'PurchaseInvoice': {
        const { lines, supplier, warehouse, createdBy, payments, returns, ...data } = raw as Record<string, unknown> & {
          lines?: Record<string, unknown>[];
        };
        const { id: _i, createdAt, updatedAt, ...fields } = data;
        await this.prisma.purchaseInvoice.upsert({
          where: { id },
          create: { ...(fields as object), id } as never,
          update: fields as never,
        });
        if (Array.isArray(lines)) {
          await this.prisma.purchaseInvoiceLine.deleteMany({ where: { invoiceId: id } });
          for (const line of lines) {
            const { invoice, product, ...lineData } = line;
            await this.prisma.purchaseInvoiceLine.create({
              data: { ...(lineData as object), invoiceId: id } as never,
            });
          }
        }
        void supplier;
        void warehouse;
        void createdBy;
        void payments;
        void returns;
        break;
      }
      case 'Expense': {
        const { id: _i, createdAt, category, account, shift, ...data } = raw as Record<string, unknown>;
        await this.prisma.expense.upsert({
          where: { id },
          create: { ...(data as object), id } as never,
          update: data as never,
        });
        void category;
        void account;
        void shift;
        break;
      }
      case 'CashAccount': {
        const { id: _i, createdAt, updatedAt, ...data } = raw as Record<string, unknown>;
        await this.prisma.cashAccount.upsert({
          where: { id },
          create: { ...(data as object), id } as never,
          update: data as never,
        });
        break;
      }
      default:
        break;
    }
  }

  /** دورة مزامنة من جهاز الديسكتوب نحو السحابة */
  async runCycle() {
    const state = await this.prisma.syncState.findUnique({ where: { id: 'default' } });
    const cloudUrl = (state?.cloudUrl || process.env.SYNC_CLOUD_URL || '').replace(/\/$/, '');
    if (!cloudUrl) {
      throw new BadRequestException('اضبط رابط السيرفر السحابي أولًا من إعدادات المزامنة');
    }

    await this.enqueueRecentChanges();

    const pending = await this.prisma.syncChange.findMany({
      where: { pushedAt: null, deviceKey: this.deviceKey },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const syncKey = state?.cloudToken || process.env.SYNC_API_KEY || '';
    if (syncKey) headers['x-sync-key'] = syncKey;

    let pushResult = { applied: 0, conflicts: 0 };
    if (pending.length) {
      const res = await fetch(`${cloudUrl}/api/sync/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          deviceKey: this.deviceKey,
          changes: pending.map((row) => ({
            id: row.id,
            entityType: row.entityType,
            entityId: row.entityId,
            op: row.op,
            payload: row.payload,
            version: row.version,
            deviceKey: row.deviceKey,
            createdAt: row.createdAt.toISOString(),
          })),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        await this.prisma.syncState.update({
          where: { id: 'default' },
          data: { lastError: `فشل الدفع: ${res.status} ${text.slice(0, 200)}` },
        });
        throw new BadRequestException(`فشل دفع التغييرات للسحابة (${res.status})`);
      }
      pushResult = (await res.json()) as { applied: number; conflicts: number };
      await this.prisma.syncChange.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { pushedAt: new Date() },
      });
    }

    const cursor = state?.lastPullCursor || '';
    const pullRes = await fetch(
      `${cloudUrl}/api/sync/pull?cursor=${encodeURIComponent(cursor)}&excludeDevice=${encodeURIComponent(this.deviceKey)}`,
      { headers },
    );
    if (!pullRes.ok) {
      const text = await pullRes.text();
      await this.prisma.syncState.update({
        where: { id: 'default' },
        data: { lastError: `فشل السحب: ${pullRes.status} ${text.slice(0, 200)}` },
      });
      throw new BadRequestException(`فشل سحب التغييرات من السحابة (${pullRes.status})`);
    }
    const pullBody = (await pullRes.json()) as { changes: ChangeDto[]; nextCursor: string };
    let pulled = 0;
    let conflicts = 0;
    for (const change of pullBody.changes || []) {
      const result = await this.applyRemoteChange(change);
      if (result === 'applied') pulled += 1;
      if (result === 'conflict') conflicts += 1;
    }

    await this.prisma.syncState.update({
      where: { id: 'default' },
      data: {
        lastPullCursor: pullBody.nextCursor || cursor,
        lastSyncAt: new Date(),
        lastError: null,
      },
    });
    await this.prisma.syncDevice.update({
      where: { deviceKey: this.deviceKey },
      data: { lastPullAt: new Date(), lastPushAt: new Date(), lastSeenAt: new Date() },
    });

    return {
      pushed: pending.length,
      pushApplied: pushResult.applied,
      pulled,
      conflicts: conflicts + (pushResult.conflicts || 0),
      nextCursor: pullBody.nextCursor,
    };
  }

  async bootstrapFromCloud() {
    const state = await this.prisma.syncState.findUnique({ where: { id: 'default' } });
    const cloudUrl = (state?.cloudUrl || process.env.SYNC_CLOUD_URL || '').replace(/\/$/, '');
    if (!cloudUrl) throw new BadRequestException('اضبط رابط السيرفر السحابي أولًا');

    const headers: Record<string, string> = {};
    const syncKey = state?.cloudToken || process.env.SYNC_API_KEY || '';
    if (syncKey) headers['x-sync-key'] = syncKey;

    let cursor = '';
    let total = 0;
    for (let i = 0; i < 50; i += 1) {
      const res = await fetch(
        `${cloudUrl}/api/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=200`,
        { headers },
      );
      if (!res.ok) throw new BadRequestException(`فشل التحميل الأولي (${res.status})`);
      const body = (await res.json()) as { changes: ChangeDto[]; nextCursor: string };
      if (!body.changes?.length) break;
      for (const change of body.changes) {
        await this.applyRemoteChange(change);
        total += 1;
      }
      cursor = body.nextCursor || cursor;
      if (body.changes.length < 200) break;
    }
    await this.prisma.syncState.update({
      where: { id: 'default' },
      data: { lastPullCursor: cursor, lastSyncAt: new Date(), lastError: null },
    });
    return { imported: total, cursor };
  }

  async listConflicts() {
    return this.prisma.syncConflict.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async resolveConflict(id: string) {
    return this.prisma.syncConflict.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  /** يبني outbox أولي لكل الكيانات الحالية (أول مزامنة من جهاز فيه بيانات) */
  async seedOutbox() {
    let count = 0;
    for (const type of SYNC_ENTITY_TYPES) {
      const ids = await this.listEntityIds(type);
      for (const id of ids) {
        await this.recordChange(type, id, 'UPSERT');
        count += 1;
      }
    }
    return { enqueued: count };
  }

  private async listEntityIds(type: SyncEntityType): Promise<string[]> {
    switch (type) {
      case 'Customer':
        return (await this.prisma.customer.findMany({ select: { id: true } })).map((r) => r.id);
      case 'Supplier':
        return (await this.prisma.supplier.findMany({ select: { id: true } })).map((r) => r.id);
      case 'Product':
        return (await this.prisma.product.findMany({ select: { id: true } })).map((r) => r.id);
      case 'StockBalance':
        return (await this.prisma.stockBalance.findMany({ select: { id: true } })).map((r) => r.id);
      case 'SalesInvoice':
        return (await this.prisma.salesInvoice.findMany({ select: { id: true } })).map((r) => r.id);
      case 'PurchaseInvoice':
        return (await this.prisma.purchaseInvoice.findMany({ select: { id: true } })).map((r) => r.id);
      case 'Expense':
        return (await this.prisma.expense.findMany({ select: { id: true } })).map((r) => r.id);
      case 'CashAccount':
        return (await this.prisma.cashAccount.findMany({ select: { id: true } })).map((r) => r.id);
      default:
        return [];
    }
  }
}
