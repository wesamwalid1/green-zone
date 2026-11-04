import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, Prisma, StockMovementType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export function lineAmount(quantity: number, price: number, discount = 0) {
  return quantity * price - (discount || 0);
}

export function sumLineTotals(lines: { total: number }[]) {
  return lines.reduce((sum, line) => sum + line.total, 0);
}

export function taxFromPercent(subtotal: number, discount: number, percent: number) {
  return Math.round((subtotal - discount) * (percent || 0) * 100) / 10000;
}

export function paidAmountOf(parts: { amount: number }[], fallback = 0) {
  if (!parts.length) return fallback || 0;
  return parts.reduce((sum, part) => sum + part.amount, 0);
}

export function assertPaidFits(paid: number, total: number, confirm = false, parts = 0) {
  if (paid > total + 0.009) throw new BadRequestException('المدفوع أكبر من إجمالي الفاتورة');
  if (confirm && paid > 0 && parts === 0) throw new BadRequestException('قسّم المدفوع على طرق الدفع');
}

export function statusFromPayment(total: number, paid: number, posted = true, tolerance = 0) {
  if (!posted) return InvoiceStatus.DRAFT;
  if (paid >= total - tolerance) return InvoiceStatus.PAID;
  if (paid > 0) return InvoiceStatus.PARTIAL;
  return InvoiceStatus.CONFIRMED;
}

export async function postStockLine(
  tx: Tx,
  input: {
    warehouseId: string;
    productId: string;
    quantity: number;
    unitCost: number;
    type: StockMovementType;
    reference: string;
    direction: 'in' | 'out';
    note?: string | null;
    productName?: string;
  },
) {
  if (input.direction === 'out') {
    const bal = await tx.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
    });
    if (!bal || bal.quantity < input.quantity) {
      throw new BadRequestException(input.productName ? `كمية غير كافية للصنف ${input.productName}` : 'كمية غير كافية في المخزن');
    }
    await tx.stockBalance.update({
      where: { id: bal.id },
      data: { quantity: { decrement: input.quantity } },
    });
  } else {
    await tx.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
      create: { warehouseId: input.warehouseId, productId: input.productId, quantity: input.quantity },
      update: { quantity: { increment: input.quantity } },
    });
  }
  await tx.stockMovement.create({
    data: {
      warehouseId: input.warehouseId,
      productId: input.productId,
      type: input.type,
      quantity: input.direction === 'out' ? -input.quantity : input.quantity,
      unitCost: input.unitCost,
      reference: input.reference,
      note: input.note || null,
    },
  });
}
