import { Printer } from 'lucide-react';
import { balanceSide, formatDate, formatMoney, formatSignedMoney } from '../lib/api';
import { DocExportBar } from './DocExportBar';
import { loadExcel } from '../lib/excel';
import { downloadExcelBuffer } from '../lib/docExport';
import { BrandMark, Button, PrintHeader } from './ui';

export type LedgerRow = {
  date: string;
  type: string;
  ref: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
  method?: string | null;
  note?: string | null;
  invoiceTotal?: number | null;
  invoicePaid?: number | null;
  invoiceDue?: number | null;
  productName?: string | null;
  quantity?: number | null;
  weight?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  groupKey?: string | null;
  isGroupFirst?: boolean;
  isGroupLast?: boolean;
  qty?: number | null;
};

export type LedgerPayload = {
  title: string;
  partyName: string;
  partyCode?: string;
  partyKind?: 'customer' | 'supplier';
  balance: number;
  meaning?: string;
  prepaid?: number;
  totals?: { debit: number; credit: number; balance: number };
  statement: LedgerRow[];
  fileName: string;
};

/**
 * المورد: دائن (+) = سداد/مقدم · مدين (−) = شراء
 * العميل عكس المورد: دائن (−) = فاتورة بيع · مدين (+) = تحصيل
 */
function rowSides(row: LedgerRow, kind?: 'customer' | 'supplier') {
  if (kind === 'customer') {
    const daen = row.debit > 0.009 ? row.debit : 0;
    const madeen = row.credit > 0.009 ? row.credit : 0;
    return { daen, madeen, signed: madeen - daen };
  }
  const madeen = row.debit > 0.009 ? row.debit : 0;
  const daen = row.credit > 0.009 ? row.credit : 0;
  return { daen, madeen, signed: daen - madeen };
}

function displayBalance(apiBalance: number, kind?: 'customer' | 'supplier') {
  if (kind === 'customer') return -apiBalance;
  if (kind === 'supplier') return -apiBalance;
  return apiBalance;
}

function isInvoiceType(type: string) {
  return /فاتورة|شراء|بيع/.test(type) && !/مرتجع|سداد|تحصيل|مقدم|خصم/.test(type);
}

function isMoneyMove(type: string) {
  return /سداد|تحصيل|مقدم|مرتجع|خصم/.test(type);
}

function num(v?: number | null) {
  return v != null && Number.isFinite(v) ? v : null;
}

export function StatementLedger({ data }: { data: LedgerPayload }) {
  const kind = data.partyKind;
  const customerFlip = kind === 'customer';
  const weightLabel = kind === 'supplier' ? 'الوزن / المتبقي' : 'الوزن';

  const rows = data.statement.map((row) => {
    const sides = rowSides(row, kind);
    return { ...row, ...sides };
  });

  let run = 0;
  const withRun = rows.map((row) => {
    run += row.signed;
    return { ...row, signedBalance: Math.round((run + Number.EPSILON) * 100) / 100 };
  });

  const totalLine = withRun.reduce((s, r) => {
    const fromLine = num(r.lineTotal);
    if (fromLine != null) return s + fromLine;
    if (isInvoiceType(r.type) && r.isGroupFirst) return s + (r.invoiceTotal || 0);
    return s;
  }, 0);
  const totalPaid = withRun.reduce((s, r) => {
    if (r.invoicePaid != null && r.invoicePaid > 0.009) return s + r.invoicePaid;
    if (isMoneyMove(r.type) && !isInvoiceType(r.type)) return s + (r.credit || r.debit || 0);
    return s;
  }, 0);
  const totalDue = withRun.reduce((s, r) => s + (r.invoiceDue != null && r.invoiceDue > 0.009 ? r.invoiceDue : 0), 0);
  const totalDaen = withRun.reduce((s, r) => s + r.daen, 0);
  const totalMadeen = withRun.reduce((s, r) => s + r.madeen, 0);
  const signedBalance = displayBalance(data.balance, kind);
  const side = customerFlip
    ? ((signedBalance || 0) < -0.009 ? 'دائن' : (signedBalance || 0) > 0.009 ? 'مدين' : 'صفر')
    : balanceSide(signedBalance);
  const prepaid = data.prepaid ?? Math.max(0, -data.balance);

  return (
    <div className="statement-sheet">
      <div className="no-print">
        <PrintHeader
          title={data.title}
          subtitle={`${data.partyName}${data.partyCode ? ` · ${data.partyCode}` : ''}`}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-brand-800/20 bg-gradient-to-l from-brand-50 via-white to-amber-50 px-4 py-3 no-print">
        <div className="flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <div className="text-sm font-extrabold text-brand-800">اسم {customerFlip ? 'العميل' : 'المورد'}: {data.partyName}</div>
            {data.partyCode && <div className="text-xs font-bold text-slate-500" dir="ltr">{data.partyCode}</div>}
          </div>
        </div>
        <div className="text-left">
          <div className={`text-2xl font-black money-num ${signedBalance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {formatSignedMoney(signedBalance)}
          </div>
          <div className="text-xs font-bold text-slate-600">
            الرصيد · {side === 'صفر' ? 'متعادل' : side}
            {data.meaning ? ` · ${data.meaning}` : ''}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 no-print">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-bold text-slate-700">الإجمالي كام</div>
          <div className="mt-1 text-xl money-num text-slate-950">{formatMoney(totalLine || totalDaen)}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
          <div className="text-xs font-bold text-emerald-800">مدفوع كام</div>
          <div className="mt-1 text-xl money-num text-emerald-950">{formatMoney(totalPaid)}</div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
          <div className="text-xs font-bold text-rose-800">المتبقي كام</div>
          <div className="mt-1 text-xl money-num text-rose-950">{formatMoney(totalDue)}</div>
        </div>
        <div className="rounded-xl border-2 border-sky-300 bg-sky-50 px-3 py-3">
          <div className="text-xs font-bold text-sky-900">دفع مقدم متاح</div>
          <div className="mt-1 text-xl money-num text-sky-950">{formatMoney(prepaid)}</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap justify-end gap-2 no-print">
        <DocExportBar
          className="mb-0"
          onExcel={async () => {
            const ExcelJS = await loadExcel();
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('كشف حساب');
            sheet.views = [{ rightToLeft: true }];
            sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
            sheet.addRow([data.title, data.partyName]);
            sheet.addRow(['الرصيد', signedBalance, side]);
            sheet.addRow(['الإجمالي', totalLine || totalDaen, 'مدفوع', totalPaid, 'متبقي', totalDue]);
            sheet.addRow([]);
            sheet.addRow([
              'التاريخ', 'الصنف', 'البيان', weightLabel, 'العدد', 'سعر الكيلو',
              'إجمالي السعر', 'المدفوع', 'المتبقي', 'طريقة الدفع', 'الرصيد',
            ]);
            withRun.forEach((row) => {
              const paid = row.invoicePaid != null && row.invoicePaid > 0.009
                ? row.invoicePaid
                : isMoneyMove(row.type) ? (row.credit || row.debit || '') : '';
              sheet.addRow([
                formatDate(row.date),
                row.productName || '',
                row.description || row.type,
                num(row.weight) ?? '',
                num(row.quantity) ?? '',
                num(row.unitPrice) ?? '',
                num(row.lineTotal) ?? (row.isGroupFirst ? row.invoiceTotal ?? '' : ''),
                paid,
                row.invoiceDue != null && row.invoiceDue > 0.009 ? row.invoiceDue : '',
                row.method || '',
                row.signedBalance,
              ]);
            });
            sheet.addRow([]);
            sheet.addRow(['الإجمالي كام', '', '', '', '', '', totalLine || totalDaen, totalPaid, totalDue, '', signedBalance]);
            const buffer = await workbook.xlsx.writeBuffer();
            await downloadExcelBuffer(buffer as ArrayBuffer, data.fileName);
          }}
        />
        <Button
          variant="secondary"
          onClick={() => {
            window.dispatchEvent(new Event('beforeprint'));
            window.setTimeout(() => window.print(), 50);
          }}
        >
          <Printer size={14} /> طباعة
        </Button>
      </div>

      <div className="statement-table-wrap overflow-x-auto rounded-xl border-2 border-slate-800 bg-white shadow-sm">
        <table className="statement-table w-full min-w-[1180px] border-collapse text-[14px]">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">التاريخ</th>
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">الصنف</th>
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">البيان</th>
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">{weightLabel}</th>
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">العدد</th>
              <th className="border border-slate-700 px-2 py-3 text-right text-[12px] font-black">سعر الكيلو</th>
              <th className="border border-amber-600 bg-amber-400 px-2 py-3 text-right text-[12px] font-black text-slate-950">إجمالي السعر</th>
              <th className="border border-emerald-600 bg-emerald-300 px-2 py-3 text-right text-[12px] font-black text-emerald-950">المدفوع</th>
              <th className="border border-rose-500 bg-rose-200 px-2 py-3 text-right text-[12px] font-black text-rose-950">المتبقي</th>
              <th className="border border-sky-700 bg-sky-700 px-2 py-3 text-right text-[12px] font-black">طريقة الدفع</th>
              <th className="border border-slate-700 bg-slate-200 px-2 py-3 text-right text-[12px] font-black text-slate-950">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {withRun.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-muted">لا توجد حركات في الكشف</td>
              </tr>
            ) : withRun.map((row, index) => {
              const paidCell = row.invoicePaid != null && row.invoicePaid > 0.009
                ? formatMoney(row.invoicePaid)
                : isMoneyMove(row.type)
                  ? formatMoney(row.credit || row.debit)
                  : '—';
              const dueCell = row.invoiceDue != null && row.invoiceDue > 0.009
                ? formatMoney(row.invoiceDue)
                : '—';
              const lineCell = num(row.lineTotal) != null
                ? formatMoney(row.lineTotal!)
                : row.isGroupFirst && row.invoiceTotal != null
                  ? formatMoney(row.invoiceTotal)
                  : isMoneyMove(row.type)
                    ? formatMoney(row.credit || row.debit)
                    : '—';
              return (
                <tr
                  key={index}
                  className={[
                    index % 2 ? 'bg-slate-50' : 'bg-white',
                    row.isGroupLast ? 'border-b-2 border-b-slate-400' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="cell-num border border-slate-400 px-2 py-2 whitespace-nowrap font-bold text-slate-900">
                    {row.isGroupFirst !== false || !row.groupKey ? formatDate(row.date) : ''}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 font-extrabold text-slate-950">
                    {row.productName || (isMoneyMove(row.type) ? '—' : '—')}
                  </td>
                  <td className="border border-slate-400 px-2 py-2 min-w-[160px]">
                    <div className="font-extrabold text-slate-950">{row.description || row.type}</div>
                    {row.note && <div className="mt-0.5 text-[11px] font-semibold text-slate-600">{row.note}</div>}
                    <div className="mt-0.5 text-[10px] font-bold text-slate-500">{row.type} · {row.ref}</div>
                  </td>
                  <td className="cell-num border border-slate-400 px-2 py-2 text-left font-bold" dir="ltr">
                    {num(row.weight) != null ? row.weight : '—'}
                  </td>
                  <td className="cell-num border border-slate-400 px-2 py-2 text-left font-bold" dir="ltr">
                    {num(row.quantity) != null ? row.quantity : '—'}
                  </td>
                  <td className="cell-num border border-slate-400 px-2 py-2 text-left font-bold" dir="ltr">
                    {num(row.unitPrice) != null ? formatMoney(row.unitPrice!) : '—'}
                  </td>
                  <td className="cell-num border border-amber-400 bg-amber-50 px-2 py-2 text-left font-black text-slate-950" dir="ltr">
                    {lineCell}
                  </td>
                  <td className="cell-num border border-emerald-400 bg-emerald-50 px-2 py-2 text-left font-black text-emerald-950" dir="ltr">
                    {paidCell}
                  </td>
                  <td className="cell-num border border-rose-400 bg-rose-50 px-2 py-2 text-left font-black text-rose-950" dir="ltr">
                    {dueCell}
                  </td>
                  <td className="border border-sky-300 bg-sky-50 px-2 py-2 whitespace-nowrap text-sm font-extrabold text-sky-950">
                    {row.method || '—'}
                  </td>
                  <td className={`cell-num border border-slate-500 px-2 py-2 text-left text-sm font-black ${row.signedBalance < 0 ? 'text-rose-800' : 'text-emerald-900'}`} dir="ltr">
                    {row.isGroupLast !== false || !row.groupKey || Math.abs(row.signed) > 0.009
                      ? formatSignedMoney(row.signedBalance)
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 text-white">
              <td colSpan={6} className="border border-slate-700 px-3 py-3.5 text-right text-[14px] font-black">
                الإجمالي · مدفوع كام · المتبقي كام
              </td>
              <td className="cell-num border border-amber-600 bg-amber-400 px-2 py-3.5 text-left text-base font-black text-slate-950" dir="ltr">
                {formatMoney(totalLine || totalDaen)}
              </td>
              <td className="cell-num border border-emerald-600 bg-emerald-300 px-2 py-3.5 text-left text-base font-black text-emerald-950" dir="ltr">
                {formatMoney(totalPaid)}
              </td>
              <td className="cell-num border border-rose-500 bg-rose-200 px-2 py-3.5 text-left text-base font-black text-rose-950" dir="ltr">
                {formatMoney(totalDue)}
              </td>
              <td className="border border-slate-700 px-2 py-3.5">—</td>
              <td className={`cell-num border border-slate-600 bg-white px-2 py-3.5 text-left text-lg font-black ${signedBalance < 0 ? 'text-rose-800' : 'text-emerald-900'}`} dir="ltr">
                {formatSignedMoney(signedBalance)}
              </td>
            </tr>
            <tr className="bg-slate-100 text-slate-800">
              <td colSpan={11} className="border border-slate-400 px-3 py-2 text-[12px] font-bold">
                {customerFlip ? `إجمالي دائن (−): ${formatMoney(totalDaen)} · إجمالي مدين (+): ${formatMoney(totalMadeen)}`
                  : `إجمالي مدين (−): ${formatMoney(totalMadeen)} · إجمالي دائن (+): ${formatMoney(totalDaen)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
