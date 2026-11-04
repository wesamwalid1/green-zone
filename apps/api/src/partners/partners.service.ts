import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashDirection, PayMethodKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import { autoCode } from '../common/auto-code';
import { computeProfitSnapshot, money } from '../common/profit.util';

@Injectable()
export class PartnersService {
  constructor(
    private prisma: PrismaService,
    private sequence: SequenceService,
  ) {}

  list() {
    return this.prisma.partner.findMany({
      include: {
        withdrawals: { orderBy: { withdrawnAt: 'desc' }, take: 5 },
        _count: { select: { withdrawals: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        withdrawals: { orderBy: { withdrawnAt: 'desc' } },
      },
    });
    if (!partner) throw new NotFoundException('الشريك غير موجود');
    return partner;
  }

  async create(data: { code?: string; name: string; phone?: string; sharePercent?: number; notes?: string }) {
    const name = data.name.trim();
    if (name.length < 2) throw new BadRequestException('اسم الشريك حرفين على الأقل');
    const sharePercent = Math.max(0, Math.min(100, Number(data.sharePercent) || 0));
    const code = autoCode('PRT', data.code).toUpperCase();
    const exists = await this.prisma.partner.findUnique({ where: { code } });
    if (exists) throw new BadRequestException('الكود مستخدم لشريك آخر');
    return this.prisma.partner.create({
      data: {
        code,
        name,
        phone: data.phone?.trim() || null,
        sharePercent,
        notes: data.notes?.trim() || null,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{ code: string; name: string; phone: string; sharePercent: number; notes: string; isActive: boolean }>,
  ) {
    await this.get(id);
    if (data.code) {
      const code = data.code.trim().toUpperCase();
      const clash = await this.prisma.partner.findFirst({ where: { code, NOT: { id } } });
      if (clash) throw new BadRequestException('الكود مستخدم لشريك آخر');
      data.code = code;
    }
    if (data.sharePercent != null) {
      data.sharePercent = Math.max(0, Math.min(100, Number(data.sharePercent) || 0));
    }
    return this.prisma.partner.update({
      where: { id },
      data: {
        ...(data.code ? { code: data.code } : {}),
        ...(data.name != null ? { name: data.name.trim() } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.sharePercent != null ? { sharePercent: data.sharePercent } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.partnerWithdrawal.deleteMany({ where: { partnerId: id } });
    return this.prisma.partner.delete({ where: { id } });
  }

  async profitSummary(from?: string, to?: string) {
    const fromDate = from ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`) : undefined;
    const toDate = to ? new Date(`${to.slice(0, 10)}T23:59:59.999Z`) : undefined;
    const periodFilter = fromDate && toDate ? { gte: fromDate, lte: toDate } : undefined;

    const [period, lifetime, partners, periodWithdrawals, allWithdrawals] = await Promise.all([
      computeProfitSnapshot(this.prisma, from, to),
      computeProfitSnapshot(this.prisma),
      this.prisma.partner.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.partnerWithdrawal.findMany({
        where: periodFilter ? { withdrawnAt: periodFilter } : undefined,
      }),
      this.prisma.partnerWithdrawal.findMany(),
    ]);

    const totalShare = money(partners.reduce((s, p) => s + (p.sharePercent || 0), 0));
    const periodWithdrawnMap = new Map<string, number>();
    for (const w of periodWithdrawals) {
      periodWithdrawnMap.set(w.partnerId, money((periodWithdrawnMap.get(w.partnerId) || 0) + w.amount));
    }
    const lifetimeWithdrawnMap = new Map<string, number>();
    for (const w of allWithdrawals) {
      lifetimeWithdrawnMap.set(w.partnerId, money((lifetimeWithdrawnMap.get(w.partnerId) || 0) + w.amount));
    }

    // التوزيع على أساس الربح الموجب فقط (إيراد − تكلفة مباعة − مصروفات)
    const shares = partners.map((p) => {
      const pct = (p.sharePercent || 0) / 100;
      const profitShare = money(period.distributableProfit * pct);
      const withdrawn = periodWithdrawnMap.get(p.id) || 0;
      const lifetimeProfitShare = money(lifetime.distributableProfit * pct);
      const lifetimeWithdrawn = lifetimeWithdrawnMap.get(p.id) || 0;
      const lifetimeRemaining = money(lifetimeProfitShare - lifetimeWithdrawn);
      return {
        partnerId: p.id,
        code: p.code,
        name: p.name,
        phone: p.phone,
        sharePercent: p.sharePercent,
        profitShare,
        withdrawn,
        /** متبقي الفترة = حصته في أرباح الفترة − سحب الفترة */
        remaining: money(profitShare - withdrawn),
        lifetimeProfitShare,
        lifetimeWithdrawn,
        /** المتبقي المستحق الحقيقي */
        lifetimeRemaining,
      };
    });

    return {
      from: from || null,
      to: to || null,
      revenue: period.revenue,
      cogs: period.cogs,
      purchases: period.purchasesTotal,
      expenses: period.expenses,
      grossProfit: period.grossProfit,
      netProfit: period.netProfit,
      /** الربح الموجب القابل للتوزيع */
      distributableProfit: period.distributableProfit,
      lifetimeNetProfit: lifetime.netProfit,
      lifetimeDistributable: lifetime.distributableProfit,
      totalSharePercent: totalShare,
      shares,
      totalWithdrawn: money(periodWithdrawals.reduce((s, w) => s + w.amount, 0)),
      lifetimeTotalWithdrawn: money(allWithdrawals.reduce((s, w) => s + w.amount, 0)),
      formula: 'صافي الربح = إيراد البيع − تكلفة البضاعة المباعة − المصروفات',
    };
  }

  async withdraw(data: {
    partnerId: string;
    methodId: string;
    amount: number;
    notes?: string;
    withdrawnAt?: string;
  }) {
    const amount = Number(data.amount);
    if (!(amount > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    const partner = await this.get(data.partnerId);
    if (!partner.isActive) throw new BadRequestException('الشريك غير نشط');

    const method = await this.prisma.payMethod.findUnique({ where: { id: data.methodId } });
    if (!method || !method.isActive || method.kind === PayMethodKind.CHECK) {
      throw new BadRequestException('اختر طريقة دفع: خزنة رئيسية / انستا باي / محفظة / حساب بنكي');
    }
    if (!method.cashAccountId) throw new BadRequestException('طريقة الدفع غير مربوطة بحساب');

    const when = data.withdrawnAt ? new Date(data.withdrawnAt) : new Date();
    await assertPeriodsOpen(this.prisma, when);

    const number = await this.sequence.next('partner-withdrawals', 'PWD');

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.cashAccount.findUnique({ where: { id: method.cashAccountId! } });
      if (!account || account.balance < amount) {
        throw new BadRequestException('رصيد الحساب غير كافٍ');
      }
      await tx.cashAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: amount } },
      });
      const txRow = await tx.cashTransaction.create({
        data: {
          accountId: account.id,
          direction: CashDirection.OUT,
          amount,
          description: `سحب شريك ${partner.name}`,
          paymentMethod: method.id,
          reference: number,
        },
      });
      return tx.partnerWithdrawal.create({
        data: {
          number,
          partnerId: partner.id,
          amount,
          methodId: method.id,
          accountId: account.id,
          cashTxId: txRow.id,
          notes: data.notes?.trim() || null,
          withdrawnAt: when,
        },
        include: { partner: true },
      });
    });
  }

  listWithdrawals(partnerId?: string) {
    return this.prisma.partnerWithdrawal.findMany({
      where: partnerId ? { partnerId } : undefined,
      include: { partner: { select: { id: true, code: true, name: true } } },
      orderBy: { withdrawnAt: 'desc' },
      take: 300,
    });
  }
}
