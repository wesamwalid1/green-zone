/** يحوّل كمية وحدة الفاتورة إلى كمية مخزون + يحسب الإجمالي على وحدة الفاتورة */
export function resolveTradeQty(input: {
  quantity?: number | null;
  unitFactor?: number | null;
  netWeight?: number | null;
  invoiceUnit?: string | null;
  baseUnit?: string | null;
}) {
  const qty = Number(input.quantity) || 0;
  const weight = input.netWeight != null ? Number(input.netWeight) || 0 : 0;

  // توافق قديم: الوزن الصافي يتحكم في المخزون والإجمالي
  if (weight > 0) {
    return {
      invoiceQty: qty > 0 ? qty : weight,
      stockQty: weight,
      unitFactor: 1,
      invoiceUnit: input.invoiceUnit?.trim() || input.baseUnit?.trim() || null,
      legacyWeight: true as const,
    };
  }

  const factor = Number(input.unitFactor) > 0 ? Number(input.unitFactor) : 1;
  return {
    invoiceQty: qty,
    stockQty: qty * factor,
    unitFactor: factor,
    invoiceUnit: input.invoiceUnit?.trim() || input.baseUnit?.trim() || null,
    legacyWeight: false as const,
  };
}

/** تكلفة/سعر وحدة المخزون من سعر وحدة الفاتورة */
export function baseUnitPrice(invoiceUnitPrice: number, factor: number) {
  const f = factor > 0 ? factor : 1;
  return invoiceUnitPrice / f;
}
