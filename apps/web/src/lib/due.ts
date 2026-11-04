export const CREDIT_DAYS = 5;

export type DueTone = 'clear' | 'green' | 'yellow' | 'red';

function dayStart(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function daysUntilDue(invoiceDate: string, creditDays = CREDIT_DAYS) {
  const due = dayStart(invoiceDate);
  due.setDate(due.getDate() + creditDays);
  const today = dayStart(new Date());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function dueTone(invoiceDate: string, remaining: number): DueTone {
  if (!(remaining > 0.009)) return 'clear';
  const days = daysUntilDue(invoiceDate);
  if (days < 0) return 'red';
  if (days < CREDIT_DAYS) return 'yellow';
  return 'green';
}

function dayWord(count: number) {
  if (count === 1) return 'يوم';
  if (count === 2) return 'يومين';
  if (count >= 3 && count <= 10) return 'أيام';
  return 'يوم';
}

export function dueLabel(invoiceDate: string, remaining: number) {
  if (dueTone(invoiceDate, remaining) === 'clear') return '';
  const days = daysUntilDue(invoiceDate);
  if (days < 0) {
    const late = Math.abs(days);
    return `متأخر ${late} ${dayWord(late)}`;
  }
  if (days === 0) return 'مستحق اليوم';
  return `باقي ${days} ${dayWord(days)}`;
}

export function urgentInvoiceDate(rows: { invoiceDate: string; remaining: number }[]) {
  let best: { date: string; days: number } | null = null;
  for (const row of rows) {
    if (!(row.remaining > 0.009)) continue;
    const days = daysUntilDue(row.invoiceDate);
    if (!best || days < best.days) best = { date: row.invoiceDate, days };
  }
  return best?.date || '';
}
