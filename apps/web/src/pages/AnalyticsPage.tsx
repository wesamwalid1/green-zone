import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadExcel } from '../lib/excel';
import { api, formatMoney, formatDate } from '../lib/api';
import {
  CalendarRange, Crown, FileSpreadsheet, LineChart, Package, Scale, ShoppingBag, ShoppingCart, TrendingDown, TrendingUp, Users,
} from 'lucide-react';
import { AreaChart, BarList } from '../components/charts';
import {
  Button, Card, CardHeader, Empty, ErrorState, Input, Modal, PageHeader, PageSkeleton, StatCard, StatGrid, StatusBadge, Table, Td, Th,
} from '../components/ui';

type Point = { label: string; sales: number; purchases: number };
type Overview = {
  sales: { total: number; count: number };
  purchases: { total: number; count: number };
  salesGrowth: number;
  purchasesGrowth: number;
  netFlow: number;
  trend: Point[];
  topProducts: { id: string; sku: string; name: string; quantity: number; amount: number }[];
  topCustomers: { id: string; name: string; total: number; count: number }[];
  recent: { id: string; number: string; total: number; status: string; invoiceDate: string; customer: { name: string } }[];
};

const presets = [
  ['today', 'اليوم'],
  ['week', 'الأسبوع'],
  ['month', 'الشهر'],
  ['year', 'السنة'],
] as const;

function Trend({ points }: { points: Point[] }) {
  if (!points.length) return <Empty text="لا توجد حركة في هذه الفترة" />;
  return (
    <AreaChart
      labels={points.map((p) => (p.label.length > 7 ? p.label.slice(5) : p.label))}
      series={[
        { key: 'sales', label: 'مبيعات', color: 'var(--color-brand-700)', values: points.map((p) => p.sales) },
        { key: 'purchases', label: 'مشتريات', color: '#0ea5e9', values: points.map((p) => p.purchases) },
      ]}
    />
  );
}

function Growth({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {Math.abs(value).toFixed(0)}%
    </span>
  );
}

type Drill = { total: number; count: number; rows: { id: string; number: string; party: string; total: number; status: string; date: string; href: string }[] };

export function AnalyticsPage() {
  const [preset, setPreset] = useState<(typeof presets)[number][0]>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [drillTitle, setDrillTitle] = useState('');

  const query = useMemo(() => {
    if (from && to) return `from=${from}&to=${to}`;
    return `preset=${preset}`;
  }, [from, preset, to]);

  useEffect(() => {
    setError('');
    api<Overview>(`/ops/overview?${query}`).then(setData).catch((err) => {
      setData(null);
      setError(err instanceof Error ? err.message : 'تعذر تحميل التحليلات');
    });
  }, [query]);

  async function openDrill(metric: 'sales' | 'purchases') {
    const rows = await api<Drill>(`/work/drill?metric=${metric}&${query}`);
    setDrillTitle(metric === 'sales' ? 'فواتير المبيعات المكوّنة للرقم' : 'فواتير المشتريات المكوّنة للرقم');
    setDrill(rows);
  }

  async function exportExcel() {
    if (!data) return;
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('الأصناف');
    sheet.columns = [
      { header: 'الصنف', key: 'name', width: 28 },
      { header: 'الكود', key: 'sku', width: 14 },
      { header: 'الكمية', key: 'quantity', width: 12 },
      { header: 'القيمة', key: 'amount', width: 14 },
    ];
    data.topProducts.forEach((row) => sheet.addRow(row));
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'analytics-products.xlsx';
    link.click();
  }

  return (
    <div>
      <PageHeader
        title="التحليلات"
        subtitle="أرقام المبيعات والمشتريات من الفواتير المحفوظة"
        actions={
          <Button variant="secondary" onClick={exportExcel} disabled={!data?.topProducts.length}><FileSpreadsheet size={16} /> تصدير Excel</Button>
        }
      />
      <Card className="mb-5 !p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {presets.map(([key, label]) => (
              <button key={key} type="button" onClick={() => { setFrom(''); setTo(''); setPreset(key); }} className={`h-9 rounded-lg px-4 text-[13px] font-bold transition ${!(from && to) && preset === key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <CalendarRange size={16} className="text-slate-400" />
            <span>من</span><Input className="!w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>إلى</span><Input className="!w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>مسح</Button>}
          </div>
          <div className="text-xs text-muted sm:self-end">الفترة المخصصة تُطبَّق عند اختيار التاريخين معًا</div>
        </div>
      </Card>
      {error && <Card><ErrorState text="تعذر تحميل التحليلات" hint={error} /></Card>}
      {!data && !error && <PageSkeleton />}
      {data && (
        <>
          <StatGrid>
            <StatCard label="المبيعات" value={formatMoney(data.sales.total)} hint={<span className="flex items-center gap-1.5"><Growth value={data.salesGrowth} /> {data.sales.count} فاتورة · اضغط للتفاصيل</span>} icon={ShoppingCart} tone="emerald" onClick={() => openDrill('sales')} />
            <StatCard label="المشتريات" value={formatMoney(data.purchases.total)} hint={<span className="flex items-center gap-1.5"><Growth value={data.purchasesGrowth} /> {data.purchases.count} فاتورة · اضغط للتفاصيل</span>} icon={ShoppingBag} tone="sky" onClick={() => openDrill('purchases')} />
            <StatCard label="صافي الحركة" value={<span className={data.netFlow >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{formatMoney(data.netFlow)}</span>} hint="المبيعات ناقص المشتريات" icon={Scale} tone={data.netFlow >= 0 ? 'emerald' : 'rose'} />
            <StatCard label="أفضل عميل" value={data.topCustomers[0]?.name || '—'} hint={data.topCustomers[0] ? `${formatMoney(data.topCustomers[0].total)} · ${data.topCustomers[0].count} فاتورة` : 'لا مبيعات في الفترة'} icon={Crown} tone="amber" />
          </StatGrid>
          <Card className="mb-4">
            <CardHeader
              title="اتجاه المبيعات والمشتريات"
              subtitle="حسب الفترة المختارة"
              icon={LineChart}
              actions={
                <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-700" /> مبيعات</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> مشتريات</span>
                </div>
              }
            />
            <Trend points={data.trend} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="أعلى الأصناف مبيعًا" subtitle="بالقيمة خلال الفترة" icon={Package} />
              {data.topProducts.length === 0 ? <Empty text="لا مبيعات أصناف في الفترة" /> : (
                <>
                  <BarList rows={data.topProducts.slice(0, 5).map((r) => ({ label: r.name, value: r.amount, hint: `${r.quantity} وحدة` }))} />
                  <div className="mt-4">
                    <Table>
                      <thead><tr><Th>#</Th><Th>الصنف</Th><Th>الكمية</Th><Th>القيمة</Th></tr></thead>
                      <tbody>
                        {data.topProducts.map((row, i) => (
                          <tr key={row.id}>
                            <Td className="w-10 text-xs font-bold text-slate-400">{i + 1}</Td>
                            <Td><div className="font-semibold text-slate-800">{row.name}</div><div className="font-mono text-[11px] text-muted" dir="ltr">{row.sku}</div></Td>
                            <Td className="tabular-nums">{row.quantity.toLocaleString('ar-EG')}</Td>
                            <Td className="whitespace-nowrap font-bold">{formatMoney(row.amount)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card>
            <Card>
              <CardHeader title="أعلى العملاء" subtitle="اضغط على الاسم لفتح ملف العميل" icon={Users} />
              {data.topCustomers.length === 0 ? <Empty text="لا عملاء في الفترة" /> : (
                <>
                  <BarList rows={data.topCustomers.slice(0, 5).map((r) => ({ label: r.name, value: r.total, hint: `${r.count} فاتورة` }))} color="from-emerald-400 to-emerald-600" />
                  <div className="mt-4">
                    <Table>
                      <thead><tr><Th>#</Th><Th>العميل</Th><Th>فواتير</Th><Th>القيمة</Th></tr></thead>
                      <tbody>
                        {data.topCustomers.map((row, i) => (
                          <tr key={row.id}>
                            <Td className="w-10 text-xs font-bold text-slate-400">{i + 1}</Td>
                            <Td><Link className="font-semibold text-slate-800 hover:text-brand-700" to={`/customers?q=${encodeURIComponent(row.name)}`}>{row.name}</Link></Td>
                            <Td className="tabular-nums">{row.count}</Td>
                            <Td className="whitespace-nowrap font-bold">{formatMoney(row.total)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
            </Card>
          </div>
        </>
      )}
      <Modal open={!!drill} onClose={() => setDrill(null)} title={drillTitle} wide>
        {drill && (
          drill.rows.length === 0 ? <Empty text="لا فواتير في الفترة" /> : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-muted">عدد الفواتير</div><div className="text-lg font-extrabold">{drill.count}</div></div>
                <div className="rounded-xl bg-brand-50 p-3"><div className="text-xs text-brand-700">الإجمالي</div><div className="text-lg font-extrabold text-brand-800">{formatMoney(drill.total)}</div></div>
              </div>
              <Table>
                <thead><tr><Th>الرقم</Th><Th>الطرف</Th><Th>التاريخ</Th><Th>الحالة</Th><Th>القيمة</Th></tr></thead>
                <tbody>
                  {drill.rows.map((row) => (
                    <tr key={row.id}>
                      <Td><Link className="font-mono text-xs font-bold text-brand-700 hover:underline" dir="ltr" to={row.href}>{row.number}</Link></Td>
                      <Td className="font-semibold">{row.party}</Td>
                      <Td className="whitespace-nowrap text-slate-500">{formatDate(row.date)}</Td>
                      <Td><StatusBadge status={row.status} /></Td>
                      <Td className="whitespace-nowrap font-bold">{formatMoney(row.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )
        )}
      </Modal>
    </div>
  );
}
