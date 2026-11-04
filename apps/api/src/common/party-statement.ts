export type StatementRow = {
  date: Date;
  type: string;
  ref: string;
  description: string;
  debit: number;
  credit: number;
  method?: string | null;
  note?: string | null;
  invoiceTotal?: number | null;
  invoicePaid?: number | null;
  invoiceDue?: number | null;
  /** صنف السطر (فاتورة بيع/شراء) */
  productName?: string | null;
  quantity?: number | null;
  /** الوزن / الوزن المتبقي حسب السياق */
  weight?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  /** تجميع أسطر نفس الفاتورة في الواجهة */
  groupKey?: string | null;
  isGroupFirst?: boolean;
  isGroupLast?: boolean;
};

export function withRunningBalance(rows: StatementRow[]) {
  const sorted = [...rows].sort((a, b) => {
    const t = a.date.getTime() - b.date.getTime();
    if (t !== 0) return t;
    return a.ref.localeCompare(b.ref);
  });
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const statement = sorted.map((r) => {
    running += r.debit - r.credit;
    totalDebit += r.debit;
    totalCredit += r.credit;
    return { ...r, balance: Math.round((running + Number.EPSILON) * 100) / 100 };
  });
  return {
    statement,
    totals: {
      debit: Math.round((totalDebit + Number.EPSILON) * 100) / 100,
      credit: Math.round((totalCredit + Number.EPSILON) * 100) / 100,
      balance: Math.round((running + Number.EPSILON) * 100) / 100,
    },
  };
}

export function money(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
