export type UserRole = 'ADMIN' | 'ACCOUNTANT' | 'WAREHOUSE' | 'SALES';

export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export type CashDirection = 'IN' | 'OUT';

export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT';

export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'PURCHASE_RETURN'
  | 'SALE_RETURN'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT';

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'مدير النظام',
  ACCOUNTANT: 'محاسب',
  WAREHOUSE: 'أمين مخزن',
  SALES: 'مبيعات',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكدة',
  PARTIAL: 'مدفوعة جزئياً',
  PAID: 'مدفوعة',
  CANCELLED: 'ملغاة',
};

export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'CHECK'
  | 'CARD'
  | 'INSTAPAY'
  | 'OTHER';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقدي',
  BANK_TRANSFER: 'تحويل بنكي',
  CHECK: 'شيك',
  CARD: 'بطاقة',
  INSTAPAY: 'إنستاباي',
  OTHER: 'أخرى',
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH: 'خزنة نقدية',
  BANK: 'حساب بنكي',
};

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export * from './access';

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    role: UserRole;
  };
}
