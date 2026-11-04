import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckDirection, CheckStatus, PayMethodKind, ShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import { pageResult, readPage } from '../common/paging';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async openShift(data: { userId: string; cashAccountId: string; openingCash: number; notes?: string }) {
    const existing = await this.prisma.cashierShift.findFirst({
      where: { userId: data.userId, status: ShiftStatus.OPEN },
    });
    if (existing) throw new BadRequestException('عندك وردية مفتوحة بالفعل. قفلها أو كمّل البيع من غيرها');
    return this.prisma.cashierShift.create({
      data: {
        userId: data.userId,
        cashAccountId: data.cashAccountId,
        openingCash: data.openingCash || 0,
        notes: data.notes,
      },
      include: { account: true, user: { select: { fullName: true } } },
    });
  }

  currentShift(userId: string) {
    return this.prisma.cashierShift.findFirst({
      where: { userId, status: ShiftStatus.OPEN },
      include: { account: true },
    });
  }

  listShifts() {
    return this.prisma.cashierShift.findMany({
      include: { account: true, user: { select: { fullName: true } } },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });
  }

  async closeShift(id: string, data: { closingCash: number; notes?: string }) {
    const shift = await this.prisma.cashierShift.findUnique({ where: { id } });
    if (!shift || shift.status !== ShiftStatus.OPEN) throw new BadRequestException('الوردية مش مفتوحة');
    const [receipts, expenses] = await Promise.all([
      this.prisma.receipt.findMany({ where: { shiftId: id, cashAccountId: shift.cashAccountId } }),
      this.prisma.expense.findMany({ where: { shiftId: id, accountId: shift.cashAccountId } }),
    ]);
    const cashIn = receipts.reduce((s, r) => s + r.amount, 0);
    const cashOut = expenses.reduce((s, e) => s + e.amount, 0);
    const expectedCash = shift.openingCash + cashIn - cashOut;
    const difference = Math.round((data.closingCash - expectedCash) * 100) / 100;
    return this.prisma.cashierShift.update({
      where: { id },
      data: {
        status: ShiftStatus.CLOSED,
        closingCash: data.closingCash,
        expectedCash,
        difference,
        notes: data.notes ?? shift.notes,
        closedAt: new Date(),
      },
      include: { account: true, user: { select: { fullName: true } } },
    });
  }

  listExpenseCategories() {
    return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createExpenseCategory(name: string) {
    return this.prisma.expenseCategory.create({ data: { name: name.trim() } });
  }

  async listExpenses(query?: { page?: string; pageSize?: string }) {
    const page = readPage(query);
    if (!page) {
      return this.prisma.expense.findMany({ include: { category: true, account: true }, orderBy: { expenseDate: 'desc' } });
    }
    const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const [total, items, all] = await Promise.all([
      this.prisma.expense.count(),
      this.prisma.expense.findMany({ include: { category: true, account: true }, orderBy: { expenseDate: 'desc' }, skip: page.skip, take: page.take }),
      this.prisma.expense.findMany({ select: { amount: true, expenseDate: true, category: { select: { name: true } } } }),
    ]);
    const byCategory = new Map<string, number>();
    let totalAmount = 0;
    let monthAmount = 0;
    for (const row of all) {
      totalAmount += row.amount;
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).format(row.expenseDate).slice(0, 7);
      if (key === monthKey) monthAmount += row.amount;
      byCategory.set(row.category.name, (byCategory.get(row.category.name) || 0) + row.amount);
    }
    return pageResult(items, total, page, {
      summary: {
        totalAmount,
        monthAmount,
        byCategory: [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      },
    });
  }

  async createExpense(data: {
    categoryId: string;
    accountId?: string;
    methodId?: string;
    amount: number;
    expenseDate?: string;
    paymentMethod?: string;
    notes?: string;
    shiftId?: string | null;
  }) {
    if (data.amount <= 0) throw new BadRequestException('المبلغ لازم يكون أكبر من صفر');
    await assertPeriodsOpen(this.prisma, data.expenseDate || new Date());
    let accountId = data.accountId || '';
    let paymentMethod = data.methodId || data.paymentMethod || '';
    if (data.methodId) {
      const method = await this.prisma.payMethod.findUnique({ where: { id: data.methodId } });
      if (!method || method.kind !== PayMethodKind.IMMEDIATE || !method.cashAccountId) {
        throw new BadRequestException('المصروف يخصم من طريقة دفع فورية');
      }
      accountId = method.cashAccountId;
      paymentMethod = method.id;
    }
    const account = await this.prisma.cashAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('حساب طريقة الدفع غير موجود');
    return this.prisma.$transaction(async (tx) => {
      await tx.cashAccount.update({
        where: { id: accountId },
        data: { balance: { decrement: data.amount } },
      });
      const category = await tx.expenseCategory.findUnique({ where: { id: data.categoryId } });
      await tx.cashTransaction.create({
        data: {
          accountId,
          direction: 'OUT',
          amount: data.amount,
          description: `مصروف${category ? `: ${category.name}` : ''}${data.notes ? ` - ${data.notes}` : ''}`,
          paymentMethod,
        },
      });
      return tx.expense.create({
        data: {
          categoryId: data.categoryId,
          accountId,
          amount: data.amount,
          expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
          paymentMethod,
          notes: data.notes,
          shiftId: data.shiftId || null,
        },
        include: { category: true, account: true },
      });
    });
  }

  async listChecks(query?: { page?: string; pageSize?: string; status?: string; direction?: string }) {
    const page = readPage(query);
    const where = {
      ...(query?.status ? { status: query.status as never } : {}),
      ...(query?.direction ? { direction: query.direction as never } : {}),
    };
    if (!page) {
      return this.prisma.bankCheck.findMany({ where, include: { customer: true, supplier: true, account: true }, orderBy: { dueDate: 'asc' } });
    }
    const [total, items, all] = await Promise.all([
      this.prisma.bankCheck.count({ where }),
      this.prisma.bankCheck.findMany({ where, include: { customer: true, supplier: true, account: true }, orderBy: { dueDate: 'asc' }, skip: page.skip, take: page.take }),
      this.prisma.bankCheck.findMany({ select: { status: true, direction: true, amount: true } }),
    ]);
    const pending = all.filter((row) => row.status === 'PENDING');
    return pageResult(items, total, page, {
      summary: {
        total: all.length,
        pendingIn: pending.filter((row) => row.direction === 'IN').reduce((sum, row) => sum + row.amount, 0),
        pendingInCount: pending.filter((row) => row.direction === 'IN').length,
        pendingOut: pending.filter((row) => row.direction !== 'IN').reduce((sum, row) => sum + row.amount, 0),
        pendingOutCount: pending.filter((row) => row.direction !== 'IN').length,
      },
    });
  }

  async createCheck(data: {
    direction: CheckDirection;
    checkNumber: string;
    bankName: string;
    amount: number;
    issueDate?: string;
    dueDate: string;
    customerId?: string;
    supplierId?: string;
    notes?: string;
  }) {
    if (data.amount <= 0) throw new BadRequestException('مبلغ الشيك لازم يكون أكبر من صفر');
    await assertPeriodsOpen(this.prisma, data.issueDate || new Date());
    return this.prisma.bankCheck.create({
      data: {
        direction: data.direction,
        checkNumber: data.checkNumber,
        bankName: data.bankName,
        amount: data.amount,
        issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
        dueDate: new Date(data.dueDate),
        customerId: data.customerId || null,
        supplierId: data.supplierId || null,
        notes: data.notes,
      },
      include: { customer: true, supplier: true },
    });
  }

  async setCheckStatus(id: string, status: CheckStatus, methodOrAccountId?: string) {
    const check = await this.prisma.bankCheck.findUnique({ where: { id } });
    if (!check) throw new NotFoundException('الشيك غير موجود');
    if (check.status === status) return check;
    await assertPeriodsOpen(this.prisma, new Date());
    if (status === CheckStatus.BOUNCED && check.salesInvoiceId) {
      const inv = await this.prisma.salesInvoice.findUnique({ where: { id: check.salesInvoiceId }, select: { invoiceDate: true } });
      if (inv) await assertPeriodsOpen(this.prisma, inv.invoiceDate);
    }
    if (status === CheckStatus.BOUNCED && check.purchaseInvoiceId) {
      const inv = await this.prisma.purchaseInvoice.findUnique({ where: { id: check.purchaseInvoiceId }, select: { invoiceDate: true } });
      if (inv) await assertPeriodsOpen(this.prisma, inv.invoiceDate);
    }

    let targetAccount = check.accountId || undefined;
    let settledMethodId = '';
    if (methodOrAccountId) {
      const method = await this.prisma.payMethod.findUnique({ where: { id: methodOrAccountId } });
      if (method?.kind === PayMethodKind.IMMEDIATE && method.cashAccountId) {
        targetAccount = method.cashAccountId;
        settledMethodId = method.id;
      } else {
        const byAccount = await this.prisma.payMethod.findUnique({ where: { cashAccountId: methodOrAccountId } });
        if (byAccount?.cashAccountId) {
          targetAccount = byAccount.cashAccountId;
          settledMethodId = byAccount.id;
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const wasCleared = check.status === CheckStatus.CLEARED;
      const willClear = status === CheckStatus.CLEARED;
      if (willClear) {
        if (!targetAccount) throw new BadRequestException('اختر طريقة الدفع اللي هيدخل عليها الشيك');
        const sign = check.direction === CheckDirection.IN ? 1 : -1;
        await tx.cashAccount.update({
          where: { id: targetAccount },
          data: { balance: { increment: sign * check.amount } },
        });
        await tx.cashTransaction.create({
          data: {
            accountId: targetAccount,
            direction: sign > 0 ? 'IN' : 'OUT',
            amount: check.amount,
            description: `شيك ${check.checkNumber} - ${check.bankName}`,
            paymentMethod: settledMethodId,
            reference: check.checkNumber,
          },
        });
      } else if (wasCleared && check.accountId) {
        const sign = check.direction === CheckDirection.IN ? -1 : 1;
        await tx.cashAccount.update({
          where: { id: check.accountId },
          data: { balance: { increment: sign * check.amount } },
        });
        await tx.cashTransaction.deleteMany({
          where: { reference: check.checkNumber, accountId: check.accountId },
        });
      }
      if (status === CheckStatus.BOUNCED && check.salesInvoiceId && check.customerId) {
        await tx.customer.update({ where: { id: check.customerId }, data: { balance: { increment: check.amount } } });
        const inv = await tx.salesInvoice.findUnique({ where: { id: check.salesInvoiceId } });
        if (inv) {
          const paid = Math.max(0, Math.round((inv.paidAmount - check.amount) * 100) / 100);
          await tx.salesInvoice.update({
            where: { id: inv.id },
            data: { paidAmount: paid, status: paid <= 0 ? 'CONFIRMED' : paid + 0.001 >= inv.total ? 'PAID' : 'PARTIAL' },
          });
        }
        if (check.receiptId) await tx.receipt.deleteMany({ where: { id: check.receiptId } });
      }
      if (status === CheckStatus.BOUNCED && check.purchaseInvoiceId && check.supplierId) {
        await tx.supplier.update({ where: { id: check.supplierId }, data: { balance: { increment: check.amount } } });
        const inv = await tx.purchaseInvoice.findUnique({ where: { id: check.purchaseInvoiceId } });
        if (inv) {
          const paid = Math.max(0, Math.round((inv.paidAmount - check.amount) * 100) / 100);
          await tx.purchaseInvoice.update({
            where: { id: inv.id },
            data: { paidAmount: paid, status: paid <= 0 ? 'CONFIRMED' : paid + 0.001 >= inv.total ? 'PAID' : 'PARTIAL' },
          });
        }
        if (check.paymentId) await tx.payment.deleteMany({ where: { id: check.paymentId } });
      }
      return tx.bankCheck.update({
        where: { id },
        data: { status, accountId: willClear ? targetAccount : check.accountId },
        include: { customer: true, supplier: true, account: true },
      });
    });
  }
}
