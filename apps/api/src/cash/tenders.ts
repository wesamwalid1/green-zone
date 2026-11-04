import { BadRequestException } from '@nestjs/common';
import { CashDirection, CheckDirection, PayMethodKind, Prisma } from '@prisma/client';

export type TenderInput = { id?: string; methodId: string; amount: number; referenceNo?: string };
type Tx = Prisma.TransactionClient;

export function normalizeTenders(parts?: TenderInput[] | null): TenderInput[] {
  return (parts || [])
    .filter((part) => part?.methodId && Number(part.amount) > 0)
    .map((part) => ({
      id: part.id || undefined,
      methodId: part.methodId,
      amount: Math.round(Number(part.amount) * 100) / 100,
      referenceNo: part.referenceNo?.trim() || undefined,
    }));
}

export function sumTenders(parts: TenderInput[]) {
  return Math.round(parts.reduce((sum, part) => sum + part.amount, 0) * 100) / 100;
}

async function methodOf(tx: Tx, id: string) {
  const method = await tx.payMethod.findUnique({ where: { id } });
  if (!method || !method.isActive) throw new BadRequestException('طريقة الدفع غير موجودة أو متوقفة');
  if (method.kind === PayMethodKind.IMMEDIATE && !method.cashAccountId) {
    throw new BadRequestException(`طريقة ${method.name} غير مربوطة بحساب`);
  }
  return method;
}

export async function postCustomerTenders(tx: Tx, opts: {
  parts: TenderInput[];
  customerId: string;
  salesInvoiceId?: string;
  invoiceNumber?: string;
  shiftId?: string | null;
  createdById?: string;
  receiptNumbers: string[];
}) {
  for (let i = 0; i < opts.parts.length; i++) {
    const part = opts.parts[i];
    const method = await methodOf(tx, part.methodId);
    const number = opts.receiptNumbers[i];
    const label = opts.invoiceNumber ? `فاتورة ${opts.invoiceNumber}` : method.name;
    if (method.kind === PayMethodKind.CHECK) {
      const receipt = await tx.receipt.create({
        data: {
          number,
          customerId: opts.customerId,
          salesInvoiceId: opts.salesInvoiceId,
          amount: part.amount,
          paymentMethod: method.id,
          shiftId: opts.shiftId || null,
          referenceNo: part.referenceNo,
          note: `شيك معلّق — ${label}. يدخل الحساب عند التحصيل`,
        },
      });
      await tx.bankCheck.create({
        data: {
          direction: CheckDirection.IN,
          checkNumber: part.referenceNo || number,
          bankName: 'شيك',
          amount: part.amount,
          dueDate: new Date(),
          customerId: opts.customerId,
          salesInvoiceId: opts.salesInvoiceId,
          methodId: method.id,
          receiptId: receipt.id,
          notes: label,
        },
      });
      continue;
    }
    await tx.cashAccount.update({
      where: { id: method.cashAccountId! },
      data: { balance: { increment: part.amount } },
    });
    await tx.cashTransaction.create({
      data: {
        accountId: method.cashAccountId!,
        direction: CashDirection.IN,
        amount: part.amount,
        description: `تحصيل ${label} (${method.name})`,
        paymentMethod: method.id,
        reference: number,
        createdById: opts.createdById,
      },
    });
    await tx.receipt.create({
      data: {
        number,
        customerId: opts.customerId,
        cashAccountId: method.cashAccountId,
        salesInvoiceId: opts.salesInvoiceId,
        amount: part.amount,
        paymentMethod: method.id,
        shiftId: opts.shiftId || null,
        referenceNo: part.referenceNo,
        note: `تحصيل ${label} (${method.name})`,
      },
    });
  }
}

export async function postSupplierTenders(tx: Tx, opts: {
  parts: TenderInput[];
  supplierId: string;
  purchaseInvoiceId?: string;
  invoiceNumber?: string;
  createdById?: string;
  paymentNumbers: string[];
}) {
  for (let i = 0; i < opts.parts.length; i++) {
    const part = opts.parts[i];
    const method = await methodOf(tx, part.methodId);
    const number = opts.paymentNumbers[i];
    const label = opts.invoiceNumber ? `فاتورة ${opts.invoiceNumber}` : method.name;
    if (method.kind === PayMethodKind.CHECK) {
      const payment = await tx.payment.create({
        data: {
          number,
          supplierId: opts.supplierId,
          purchaseInvoiceId: opts.purchaseInvoiceId,
          amount: part.amount,
          paymentMethod: method.id,
          referenceNo: part.referenceNo,
          note: `شيك معلّق — ${label}. يخرج من الحساب عند الصرف`,
        },
      });
      await tx.bankCheck.create({
        data: {
          direction: CheckDirection.OUT,
          checkNumber: part.referenceNo || number,
          bankName: 'شيك',
          amount: part.amount,
          dueDate: new Date(),
          supplierId: opts.supplierId,
          purchaseInvoiceId: opts.purchaseInvoiceId,
          methodId: method.id,
          paymentId: payment.id,
          notes: label,
        },
      });
      continue;
    }
    await tx.cashAccount.update({
      where: { id: method.cashAccountId! },
      data: { balance: { decrement: part.amount } },
    });
    await tx.cashTransaction.create({
      data: {
        accountId: method.cashAccountId!,
        direction: CashDirection.OUT,
        amount: part.amount,
        description: `سداد ${label} (${method.name})`,
        paymentMethod: method.id,
        reference: number,
        createdById: opts.createdById,
      },
    });
    await tx.payment.create({
      data: {
        number,
        supplierId: opts.supplierId,
        cashAccountId: method.cashAccountId,
        purchaseInvoiceId: opts.purchaseInvoiceId,
        amount: part.amount,
        paymentMethod: method.id,
        referenceNo: part.referenceNo,
        note: `سداد ${label} (${method.name})`,
      },
    });
  }
}

type MoneyRow = { id: string; number: string; amount: number; cashAccountId: string | null; paymentMethod: string; referenceNo?: string | null };

async function adjustAccount(tx: Tx, accountId: string, delta: number, reference: string) {
  if (Math.abs(delta) < 0.009) return;
  await tx.cashAccount.update({ where: { id: accountId }, data: { balance: { increment: delta } } });
  const row = await tx.cashTransaction.findFirst({ where: { reference, accountId } });
  if (row) await tx.cashTransaction.update({ where: { id: row.id }, data: { amount: row.amount + delta } });
}

export async function reverseOneSaleReceipt(tx: Tx, receipt: MoneyRow) {
  if (receipt.cashAccountId) {
    await tx.cashAccount.update({ where: { id: receipt.cashAccountId }, data: { balance: { decrement: receipt.amount } } });
    await tx.cashTransaction.deleteMany({ where: { reference: receipt.number, accountId: receipt.cashAccountId } });
  }
  const checks = await tx.bankCheck.findMany({ where: { receiptId: receipt.id } });
  for (const check of checks) {
    if (check.status === 'CLEARED' && check.accountId) {
      await tx.cashAccount.update({ where: { id: check.accountId }, data: { balance: { decrement: check.amount } } });
      await tx.cashTransaction.deleteMany({ where: { reference: check.checkNumber, accountId: check.accountId } });
    }
    await tx.bankCheck.delete({ where: { id: check.id } });
  }
  await tx.receipt.delete({ where: { id: receipt.id } });
}

export async function reverseOnePurchasePayment(tx: Tx, payment: MoneyRow) {
  if (payment.cashAccountId) {
    await tx.cashAccount.update({ where: { id: payment.cashAccountId }, data: { balance: { increment: payment.amount } } });
    await tx.cashTransaction.deleteMany({ where: { reference: payment.number, accountId: payment.cashAccountId } });
  }
  const checks = await tx.bankCheck.findMany({ where: { paymentId: payment.id } });
  for (const check of checks) {
    if (check.status === 'CLEARED' && check.accountId) {
      await tx.cashAccount.update({ where: { id: check.accountId }, data: { balance: { increment: check.amount } } });
      await tx.cashTransaction.deleteMany({ where: { reference: check.checkNumber, accountId: check.accountId } });
    }
    await tx.bankCheck.delete({ where: { id: check.id } });
  }
  await tx.payment.delete({ where: { id: payment.id } });
}

export async function syncSaleTenders(tx: Tx, opts: {
  existing: MoneyRow[];
  parts: TenderInput[];
  customerId: string;
  salesInvoiceId: string;
  invoiceNumber: string;
  shiftId?: string | null;
  newNumbers: string[];
}) {
  let cursor = 0;
  const nextNumber = () => {
    const number = opts.newNumbers[cursor];
    cursor += 1;
    if (!number) throw new BadRequestException('تعذر ترقيم التحصيل');
    return number;
  };
  const kept = new Set(opts.parts.map((part) => part.id).filter((id): id is string => !!id));
  for (const receipt of opts.existing) {
    if (!kept.has(receipt.id)) await reverseOneSaleReceipt(tx, receipt);
  }
  for (const part of opts.parts) {
    const receipt = part.id ? opts.existing.find((row) => row.id === part.id) : undefined;
    if (!receipt) {
      await postCustomerTenders(tx, {
        parts: [part],
        customerId: opts.customerId,
        salesInvoiceId: opts.salesInvoiceId,
        invoiceNumber: opts.invoiceNumber,
        shiftId: opts.shiftId,
        receiptNumbers: [nextNumber()],
      });
      continue;
    }
    if (receipt.paymentMethod !== part.methodId) {
      await reverseOneSaleReceipt(tx, receipt);
      await postCustomerTenders(tx, {
        parts: [part],
        customerId: opts.customerId,
        salesInvoiceId: opts.salesInvoiceId,
        invoiceNumber: opts.invoiceNumber,
        shiftId: opts.shiftId,
        receiptNumbers: [nextNumber()],
      });
      continue;
    }
    const delta = Math.round((part.amount - receipt.amount) * 100) / 100;
    if (receipt.cashAccountId) await adjustAccount(tx, receipt.cashAccountId, delta, receipt.number);
    const check = await tx.bankCheck.findFirst({ where: { receiptId: receipt.id } });
    if (check) {
      if (check.status === 'CLEARED' && check.accountId) await adjustAccount(tx, check.accountId, delta, check.checkNumber);
      if (Math.abs(delta) >= 0.009) await tx.bankCheck.update({ where: { id: check.id }, data: { amount: part.amount } });
    }
    if (Math.abs(delta) >= 0.009 || (part.referenceNo || '') !== (receipt.referenceNo || '')) {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { amount: part.amount, referenceNo: part.referenceNo || null },
      });
    }
  }
  const rows = await tx.receipt.findMany({ where: { salesInvoiceId: opts.salesInvoiceId } });
  return Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
}

export async function syncPurchaseTenders(tx: Tx, opts: {
  existing: MoneyRow[];
  parts: TenderInput[];
  supplierId: string;
  purchaseInvoiceId: string;
  invoiceNumber: string;
  newNumbers: string[];
}) {
  let cursor = 0;
  const nextNumber = () => {
    const number = opts.newNumbers[cursor];
    cursor += 1;
    if (!number) throw new BadRequestException('تعذر ترقيم السداد');
    return number;
  };
  const kept = new Set(opts.parts.map((part) => part.id).filter((id): id is string => !!id));
  for (const payment of opts.existing) {
    if (!kept.has(payment.id)) await reverseOnePurchasePayment(tx, payment);
  }
  for (const part of opts.parts) {
    const payment = part.id ? opts.existing.find((row) => row.id === part.id) : undefined;
    if (!payment) {
      await postSupplierTenders(tx, {
        parts: [part],
        supplierId: opts.supplierId,
        purchaseInvoiceId: opts.purchaseInvoiceId,
        invoiceNumber: opts.invoiceNumber,
        paymentNumbers: [nextNumber()],
      });
      continue;
    }
    if (payment.paymentMethod !== part.methodId) {
      await reverseOnePurchasePayment(tx, payment);
      await postSupplierTenders(tx, {
        parts: [part],
        supplierId: opts.supplierId,
        purchaseInvoiceId: opts.purchaseInvoiceId,
        invoiceNumber: opts.invoiceNumber,
        paymentNumbers: [nextNumber()],
      });
      continue;
    }
    const delta = Math.round((part.amount - payment.amount) * 100) / 100;
    if (payment.cashAccountId) await adjustAccount(tx, payment.cashAccountId, -delta, payment.number);
    const check = await tx.bankCheck.findFirst({ where: { paymentId: payment.id } });
    if (check) {
      if (check.status === 'CLEARED' && check.accountId) await adjustAccount(tx, check.accountId, -delta, check.checkNumber);
      if (Math.abs(delta) >= 0.009) await tx.bankCheck.update({ where: { id: check.id }, data: { amount: part.amount } });
    }
    if (Math.abs(delta) >= 0.009 || (part.referenceNo || '') !== (payment.referenceNo || '')) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { amount: part.amount, referenceNo: part.referenceNo || null },
      });
    }
  }
  const rows = await tx.payment.findMany({ where: { purchaseInvoiceId: opts.purchaseInvoiceId } });
  return Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
}

export async function reverseSaleMoney(tx: Tx, salesInvoiceId: string, receipts: { number: string; amount: number; cashAccountId: string | null }[]) {
  for (const receipt of receipts) {
    if (!receipt.cashAccountId) continue;
    await tx.cashAccount.update({
      where: { id: receipt.cashAccountId },
      data: { balance: { decrement: receipt.amount } },
    });
    await tx.cashTransaction.deleteMany({
      where: { reference: receipt.number, accountId: receipt.cashAccountId },
    });
  }
  const checks = await tx.bankCheck.findMany({ where: { salesInvoiceId } });
  for (const check of checks) {
    if (check.status === 'CLEARED' && check.accountId) {
      await tx.cashAccount.update({
        where: { id: check.accountId },
        data: { balance: { decrement: check.amount } },
      });
      await tx.cashTransaction.deleteMany({
        where: { reference: check.checkNumber, accountId: check.accountId },
      });
    }
  }
  await tx.bankCheck.deleteMany({ where: { salesInvoiceId } });
  await tx.receipt.deleteMany({ where: { salesInvoiceId } });
}

export async function reversePurchaseMoney(tx: Tx, purchaseInvoiceId: string, payments: { number: string; amount: number; cashAccountId: string | null }[]) {
  for (const payment of payments) {
    if (!payment.cashAccountId) continue;
    await tx.cashAccount.update({
      where: { id: payment.cashAccountId },
      data: { balance: { increment: payment.amount } },
    });
    await tx.cashTransaction.deleteMany({
      where: { reference: payment.number, accountId: payment.cashAccountId },
    });
  }
  const checks = await tx.bankCheck.findMany({ where: { purchaseInvoiceId } });
  for (const check of checks) {
    if (check.status === 'CLEARED' && check.accountId) {
      await tx.cashAccount.update({
        where: { id: check.accountId },
        data: { balance: { increment: check.amount } },
      });
      await tx.cashTransaction.deleteMany({
        where: { reference: check.checkNumber, accountId: check.accountId },
      });
    }
  }
  await tx.bankCheck.deleteMany({ where: { purchaseInvoiceId } });
  await tx.payment.deleteMany({ where: { purchaseInvoiceId } });
}
