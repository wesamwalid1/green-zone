/** كيانات المرحلة 1 للمزامنة — كاتب أوفلاين أساسي لكل فرع */
export const SYNC_ENTITY_TYPES = [
  'Customer',
  'Supplier',
  'Product',
  'StockBalance',
  'SalesInvoice',
  'PurchaseInvoice',
  'Expense',
  'CashAccount',
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export function isSyncEntity(model?: string | null): model is SyncEntityType {
  return !!model && (SYNC_ENTITY_TYPES as readonly string[]).includes(model);
}
