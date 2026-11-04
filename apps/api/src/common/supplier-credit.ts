import { InvoiceStatus, Prisma } from '@prisma/client';
import { statusFromPayment } from './invoice-post';
import { money } from './party-statement';

type Tx = Prisma.TransactionClient;

/**
 * يخصم الرصيد المقدم (balance السالب) من مستحق فاتورة شراء جديدة،
 * ويسجّل دفعة تسوية بدون حركة خزنة (النقد خرج وقت الدفعة المقدمة).
 */
export async function applySupplierPrepaid(
  tx: Tx,
  input: {
    supplierId: string;
    purchaseInvoiceId: string;
    invoiceNumber: string;
    invoiceTotal: number;
    alreadyPaid: number;
    nextPaymentNumber: () => Promise<string>;
  },
) {
  const due = money(Math.max(0, input.invoiceTotal - input.alreadyPaid));
  if (due <= 0.009) {
    return { applied: 0, paidAmount: input.alreadyPaid, status: statusFromPayment(input.invoiceTotal, input.alreadyPaid) };
  }

  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) return { applied: 0, paidAmount: input.alreadyPaid, status: statusFromPayment(input.invoiceTotal, input.alreadyPaid) };

  const prepaid = money(Math.max(0, -supplier.balance));
  const applied = money(Math.min(due, prepaid));
  const netDue = money(due - applied);

  await tx.supplier.update({
    where: { id: input.supplierId },
    data: { balance: { increment: netDue } },
  });

  const paidAmount = money(input.alreadyPaid + applied);
  const status = statusFromPayment(input.invoiceTotal, paidAmount);

  if (applied > 0.009) {
    const number = await input.nextPaymentNumber();
    await tx.payment.create({
      data: {
        number,
        supplierId: input.supplierId,
        purchaseInvoiceId: input.purchaseInvoiceId,
        amount: applied,
        paymentMethod: 'PREPAID',
        cashAccountId: null,
        note: `تسوية من دفعة مقدمة على فاتورة ${input.invoiceNumber}`,
      },
    });
    await tx.purchaseInvoice.update({
      where: { id: input.purchaseInvoiceId },
      data: { paidAmount, status },
    });
  }

  return { applied, paidAmount, status, netDue };
}

export async function bumpSupplierDueWithoutPrepaid(
  tx: Tx,
  supplierId: string,
  due: number,
) {
  if (due <= 0.009) return;
  await tx.supplier.update({
    where: { id: supplierId },
    data: { balance: { increment: due } },
  });
}
