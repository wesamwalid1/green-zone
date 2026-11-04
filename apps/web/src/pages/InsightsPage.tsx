import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, AlertTriangle, ChevronLeft, Copy, PackageSearch, ShoppingBag, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, formatDate } from '../lib/api';
import { DueAmount } from '../components/DueAmount';
import { Badge, Card, CardHeader, Empty, ErrorState, PageHeader, PageSkeleton, StatCard, StatGrid } from '../components/ui';

type Insights = {
  lowStock: { id: string; name: string; quantity: number; minStock: number; warehouseName: string }[];
  reorder: { id: string; name: string; warehouseName: string; suggestedQty: number }[];
  expiring: { id: string; product: string; invoice: string; expiryDate: string; expired: boolean }[];
  overdue: { id: string; number: string; customerName: string; remaining: number; invoiceDate: string }[];
  duplicateProducts: { name: string; count: number }[];
  duplicateCustomers: { phone: string; count: number }[];
};

function Block({ title, subtitle, icon, count, children }: { title: string; subtitle?: string; icon: LucideIcon; count: number; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} actions={<Badge tone={count ? 'amber' : 'emerald'}>{count ? `${count} تنبيه` : 'سليم'}</Badge>} />
      <div className="max-h-[360px] space-y-2 overflow-y-auto">{children}</div>
    </Card>
  );
}

export function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');

  function load() {
    setError('');
    setData(null);
    api<Insights>('/ops/insights').then(setData).catch((err) => setError(err instanceof Error ? err.message : 'تعذر التحميل'));
  }

  useEffect(load, []);

  const header = <PageHeader title="التنبيهات الذكية" subtitle="مخزون، صلاحية، تحصيل، وتكرار بيانات من السجلات الحالية" />;
  if (error) return <div>{header}<Card><ErrorState text="تعذر تحميل التنبيهات" hint={error} onRetry={load} /></Card></div>;
  if (!data) return <div>{header}<PageSkeleton /></div>;

  const duplicates = data.duplicateProducts.length + data.duplicateCustomers.length;

  return (
    <div>
      {header}
      <StatGrid>
        <StatCard label="تحت حد الطلب" value={data.lowStock.length} hint={`${data.reorder.length} توصية شراء`} icon={PackageSearch} tone={data.lowStock.length ? 'amber' : 'emerald'} />
        <StatCard label="فواتير متأخرة التحصيل" value={data.overdue.length} hint="أكثر من 14 يومًا" icon={AlertTriangle} tone={data.overdue.length ? 'rose' : 'emerald'} />
        <StatCard label="صلاحية قريبة أو منتهية" value={data.expiring.length} hint={`${data.expiring.filter((e) => e.expired).length} منتهية`} icon={AlarmClock} tone={data.expiring.length ? 'violet' : 'emerald'} />
        <StatCard label="بيانات مكررة" value={duplicates} hint="أصناف وعملاء" icon={Copy} tone={duplicates ? 'sky' : 'emerald'} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="تحت حد الطلب" subtitle="الكمية الحالية مقابل الحد الأدنى" icon={PackageSearch} count={data.lowStock.length}>
          {data.lowStock.length === 0 ? <Empty text="لا يوجد نقص مخزون" /> : data.lowStock.map((row) => {
            const pct = row.minStock > 0 ? Math.min(100, Math.max(0, (row.quantity / row.minStock) * 100)) : 0;
            return (
              <Link key={`${row.id}-${row.warehouseName}`} to={`/products?q=${encodeURIComponent(row.name)}`} className="block rounded-xl border border-slate-100 px-3 py-2.5 text-sm transition hover:border-amber-200 hover:bg-amber-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{row.name} <span className="text-xs font-normal text-muted">· {row.warehouseName}</span></span>
                  <span className={`font-extrabold tabular-nums ${row.quantity <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>{row.quantity} / {row.minStock}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${row.quantity <= 0 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
              </Link>
            );
          })}
        </Block>
        <Block title="اقتراح إعادة الطلب" subtitle="كميات مقترحة للشراء" icon={ShoppingBag} count={data.reorder.length}>
          {data.reorder.length === 0 ? <Empty text="لا توجد توصيات شراء" /> : data.reorder.map((row) => (
            <div key={`${row.id}-${row.warehouseName}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 text-sm">
              <span className="font-semibold text-slate-800">{row.name} <span className="text-xs font-normal text-muted">· {row.warehouseName}</span></span>
              <span className="flex items-center gap-2">
                <Badge tone="brand">اطلب {row.suggestedQty}</Badge>
                <Link to="/purchases" className="text-xs font-bold text-brand-700 hover:underline">فاتورة شراء</Link>
              </span>
            </div>
          ))}
        </Block>
        <Block title="صلاحية قريبة أو منتهية" subtitle="من تواريخ الصلاحية في فواتير الشراء" icon={AlarmClock} count={data.expiring.length}>
          {data.expiring.length === 0 ? <Empty text="لا تواريخ صلاحية قريبة" hint="تظهر عند تسجيل تاريخ صلاحية في فاتورة الشراء" /> : data.expiring.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm">
              <div>
                <div className="font-semibold text-slate-800">{row.product}</div>
                <div className="text-xs text-muted"><span className="font-mono" dir="ltr">{row.invoice}</span> · {formatDate(row.expiryDate)}</div>
              </div>
              <Badge tone={row.expired ? 'rose' : 'amber'}>{row.expired ? 'منتهية' : 'قريبة'}</Badge>
            </div>
          ))}
        </Block>
        <Block title="فواتير بيع متأخرة" subtitle="أكثر من 14 يومًا بدون سداد كامل" icon={AlertTriangle} count={data.overdue.length}>
          {data.overdue.length === 0 ? <Empty text="لا فواتير متأخرة" /> : data.overdue.map((row) => (
            <Link key={row.id} to={`/sales?open=${row.id}`} className="group flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2.5 text-sm transition hover:bg-rose-50">
              <span><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.number}</span> · <span className="font-semibold">{row.customerName}</span></span>
              <span className="flex items-center gap-1">
                <DueAmount date={row.invoiceDate} remaining={row.remaining} />
                <ChevronLeft size={15} className="text-slate-400 transition group-hover:-translate-x-0.5" />
              </span>
            </Link>
          ))}
        </Block>
        <Block title="أصناف بنفس الاسم" subtitle="راجعها لتوحيد السجلات" icon={Copy} count={data.duplicateProducts.length}>
          {data.duplicateProducts.length === 0 ? <Empty text="لا تكرار في أسماء الأصناف" /> : data.duplicateProducts.map((row) => (
            <Link key={row.name} to={`/products?q=${encodeURIComponent(row.name)}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 text-sm transition hover:border-brand-200">
              <span className="font-semibold">{row.name}</span><Badge tone="sky">{row.count} سجلات</Badge>
            </Link>
          ))}
        </Block>
        <Block title="عملاء بنفس الهاتف" subtitle="احتمال تسجيل العميل أكثر من مرة" icon={Users} count={data.duplicateCustomers.length}>
          {data.duplicateCustomers.length === 0 ? <Empty text="لا تكرار في أرقام العملاء" /> : data.duplicateCustomers.map((row) => (
            <Link key={row.phone} to={`/customers?q=${encodeURIComponent(row.phone)}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 text-sm transition hover:border-brand-200">
              <span className="font-mono font-semibold" dir="ltr">{row.phone}</span><Badge tone="sky">{row.count} عملاء</Badge>
            </Link>
          ))}
        </Block>
      </div>
    </div>
  );
}
