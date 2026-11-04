import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Boxes, CalendarDays, Clock3, Landmark, PackageX,
  ShoppingBag, ShoppingCart, Sparkles, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { api, formatDate, formatMoney, formatRelative } from '../lib/api';
import { useAuth } from '../lib/auth';
import { QUICK_ACTIONS, canAccess } from '../lib/nav';
import { Card, DateRangeFilter, Empty, PageSkeleton, StatusBadge, todayIso } from '../components/ui';
import { AreaChart, BarList, CountMoney, CountNumber, Donut, Sparkline } from '../components/charts';

type Dash = {
  salesToday: { total: number; count: number };
  purchasesToday: { total: number; count: number };
  cashBalance: number;
  cashAccounts?: { id: string; code: string; name: string; balance: number; accountType?: string }[];
  payMethods?: { id: string; name: string; kind: string }[];
  lowStock: { name: string; quantity: number; minStock: number; warehouseName: string }[];
  recentSales: { id: string; number: string; total: number; status: string; invoiceDate: string; customer: { name: string }; createdBy?: { fullName: string } | null }[];
  recentPurchases: { id: string; number: string; total: number; status: string; invoiceDate: string; supplier: { name: string }; createdBy?: { fullName: string } | null }[];
  customersCount: number;
  suppliersCount: number;
  salesMonth?: { total: number; count: number };
  salesPrevMonth?: { total: number; count: number };
  purchasesMonth?: { total: number; count: number };
  purchasesPrevMonth?: { total: number; count: number };
  productCount?: number;
  warehouseCount?: number;
  receivables?: { count: number; amount: number };
  payables?: { count: number; amount: number };
};

type Insight = {
  labels: string[];
  salesSeries: number[];
  purchaseSeries: number[];
  countSeries: number[];
  monthRevenue: number;
  monthProfit: number;
  monthCount: number;
  revenue30: number;
  purchases30: number;
  topProducts: { label: string; value: number; hint: string }[];
  topCustomers: { label: string; value: number; hint: string }[];
  branches: { label: string; value: number }[];
  slices: { label: string; value: number; color: string }[];
  aging: { red: { count: number; amount: number }; yellow: { count: number; amount: number }; green: { count: number; amount: number } };
};

function growth(current = 0, previous = 0) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

const BRANCH_COLORS = ['#1e3a5f', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e'];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [overview, setOverview] = useState<{ sales: { total: number; count: number }; purchases: { total: number; count: number } } | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const role = user?.role || '';
  const finance = role === 'ADMIN' || role === 'ACCOUNTANT';
  const warehouse = role === 'ADMIN' || role === 'WAREHOUSE';

  useEffect(() => {
    api<Dash>('/dashboard').then(setData).catch((err) => setError(err instanceof Error ? err.message : 'تعذر تحميل اللوحة'));
    api<Insight>('/dashboard/insight').then(setInsight).catch(() => setInsight(null));
  }, []);

  useEffect(() => {
    api<NonNullable<typeof overview>>(`/ops/overview?from=${from}&to=${to}`).then(setOverview).catch(() => setOverview(null));
  }, [from, to]);

  const activity = useMemo(() => {
    if (!data) return [];
    return [
      ...data.recentSales.map((row) => ({
        id: `s-${row.id}`, kind: 'sale' as const, title: `فاتورة مبيعات ${row.number}`, detail: row.customer.name,
        actor: row.createdBy?.fullName, at: row.invoiceDate, amount: row.total, status: row.status, to: '/sales',
      })),
      ...data.recentPurchases.map((row) => ({
        id: `p-${row.id}`, kind: 'purchase' as const, title: `فاتورة مشتريات ${row.number}`, detail: row.supplier.name,
        actor: row.createdBy?.fullName, at: row.invoiceDate, amount: row.total, status: row.status, to: '/purchases',
      })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [data]);

  if (error) return <Card><Empty text="تعذر تحميل لوحة التحكم" hint={error} /></Card>;
  if (!data || !insight) return <PageSkeleton />;

  const salesGrowth = growth(data.salesMonth?.total, data.salesPrevMonth?.total);
  const purchaseGrowth = growth(data.purchasesMonth?.total, data.purchasesPrevMonth?.total);
  const actions = QUICK_ACTIONS.filter((item) => (user?.access ? !!user.access[item.page]?.view : canAccess(role, item.roles)));
  const sameDay = from === to;
  const isToday = sameDay && from === todayIso();
  const salesTotal = overview?.sales.total ?? data.salesToday.total;
  const purchaseTotal = overview?.purchases.total ?? data.purchasesToday.total;
  const salesCount = overview?.sales.count ?? data.salesToday.count;
  const purchaseCount = overview?.purchases.count ?? data.purchasesToday.count;
  const periodHint = isToday ? 'اليوم' : sameDay ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  const margin = insight.monthRevenue ? (insight.monthProfit / insight.monthRevenue) * 100 : 0;
  const avgInvoice = insight.monthCount ? insight.monthRevenue / insight.monthCount : 0;
  const spark14 = (values: number[]) => values.slice(-14);

  const stats = [
    { label: isToday ? 'مبيعات اليوم' : 'مبيعات الفترة', value: salesTotal, money: true, sub: `${salesCount} فاتورة · ${periodHint}`, icon: ShoppingCart, chip: 'from-brand-500 to-brand-800', spark: spark14(insight.salesSeries), sparkColor: 'text-brand-600', to: '/sales' },
    { label: isToday ? 'مشتريات اليوم' : 'مشتريات الفترة', value: purchaseTotal, money: true, sub: `${purchaseCount} فاتورة · ${periodHint}`, icon: ShoppingBag, chip: 'from-sky-400 to-sky-700', spark: spark14(insight.purchaseSeries), sparkColor: 'text-sky-500', to: '/purchases' },
    finance
      ? { label: 'رصيد طرق الدفع', value: data.cashBalance, money: true, sub: `${data.cashAccounts?.length || 0} طريقة فورية`, icon: Wallet, chip: 'from-amber-400 to-amber-600', spark: [], sparkColor: '', to: '/cash' }
      : { label: 'الأصناف', value: data.productCount ?? 0, money: false, sub: `${data.warehouseCount ?? 0} مخزن`, icon: Boxes, chip: 'from-amber-400 to-amber-600', spark: [], sparkColor: '', to: '/products' },
    { label: 'العملاء', value: data.customersCount, money: false, sub: `${data.suppliersCount} مورد نشط · فواتير يومية`, icon: Users, chip: 'from-violet-400 to-violet-700', spark: spark14(insight.countSeries), sparkColor: 'text-violet-500', to: '/customers' },
  ];

  const overdue = insight.aging.red.count;
  const today = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-6 text-white shadow-[0_24px_60px_-24px_rgba(15,28,46,0.7)] sm:p-7">
        <div className="hero-grid pointer-events-none absolute inset-0" />
        <div className="glow-orb pointer-events-none absolute -top-24 left-10 h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" />
        <div className="glow-orb pointer-events-none absolute -bottom-32 right-1/3 h-72 w-72 rounded-full bg-brand-400/30 blur-3xl [animation-delay:-7s]" />

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-brand-100 backdrop-blur">
              <CalendarDays size={13} /> {today}
            </div>
            <h1 className="mt-3 text-2xl font-black sm:text-3xl">{greeting()}، {user?.fullName || ''} <Sparkles className="inline text-amber-300" size={22} /></h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-brand-100">
              {overdue > 0 ? `عندك ${overdue} فاتورة متأخرة السداد` : 'كل الفواتير في مواعيدها'}
              {' · '}
              {data.lowStock.length > 0 ? `${data.lowStock.length} صنف تحت حد الطلب` : 'المخزون في الحدود الآمنة'}
            </p>
          </div>
          <div className="text-ink">
            <DateRangeFilter from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} />
          </div>
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-brand-100">مبيعات الشهر <TrendingUp size={15} /></div>
            <div className="mt-2 text-2xl font-black tracking-tight"><CountMoney value={data.salesMonth?.total || 0} /></div>
            <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${salesGrowth >= 0 ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}>
              {salesGrowth >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {Math.abs(salesGrowth).toFixed(0)}% عن الشهر السابق
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-brand-100">مجمل الربح هذا الشهر <Banknote size={15} /></div>
            <div className="mt-2 text-2xl font-black tracking-tight"><CountMoney value={insight.monthProfit} /></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-l from-emerald-300 to-sky-300 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, margin))}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-brand-200">هامش {margin.toFixed(1)}% من المبيعات</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-brand-100">متوسط الفاتورة <ShoppingCart size={15} /></div>
            <div className="mt-2 text-2xl font-black tracking-tight"><CountMoney value={avgInvoice} /></div>
            <div className="mt-1 text-[11px] text-brand-200">{insight.monthCount.toLocaleString('ar-EG')} فاتورة مبيعات هذا الشهر</div>
          </div>
        </div>

        {actions.length > 0 && (
          <div className="relative mt-5 flex flex-wrap gap-2">
            {actions.map((item) => (
              <Link key={item.to} to={item.to} className="rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur transition hover:-translate-y-px hover:bg-white hover:text-brand-800">
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Link key={item.label} to={item.to} className="lift group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,28,46,0.04),0_8px_24px_rgba(15,28,46,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${item.chip} text-white shadow-lg shadow-slate-900/10`}>
                <item.icon size={19} />
              </div>
              {item.spark.length > 0 && <Sparkline values={item.spark} className={item.sparkColor} />}
            </div>
            <div className="mt-4 text-sm text-muted">{item.label}</div>
            <div className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900">
              {item.money ? <CountMoney value={item.value} /> : <CountNumber value={item.value} />}
            </div>
            <div className="mt-1 text-xs text-muted">{item.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-base font-extrabold">حركة المبيعات والمشتريات</div>
              <div className="mt-0.5 text-xs text-muted">آخر 30 يوم · مرّر على الرسم لعرض تفاصيل كل يوم</div>
            </div>
            <div className="flex gap-2 text-xs">
              <div className="rounded-xl bg-brand-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full bg-brand-700" />مبيعات</div>
                <div className="mt-0.5 text-sm font-extrabold text-brand-800">{formatMoney(insight.revenue30)}</div>
              </div>
              <div className="rounded-xl bg-sky-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full bg-sky-500" />مشتريات</div>
                <div className="mt-0.5 text-sm font-extrabold text-sky-800">{formatMoney(insight.purchases30)}</div>
              </div>
            </div>
          </div>
          {insight.revenue30 + insight.purchases30 > 0 ? (
            <AreaChart
              labels={insight.labels}
              series={[
                { key: 'sales', label: 'مبيعات', color: 'var(--color-brand-700)', values: insight.salesSeries },
                { key: 'purchases', label: 'مشتريات', color: '#0ea5e9', values: insight.purchaseSeries },
              ]}
            />
          ) : <Empty text="لا توجد حركة في آخر 30 يوم" />}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-muted">مشتريات الشهر</span>
              <span className="flex items-center gap-2 font-bold">
                {formatMoney(data.purchasesMonth?.total || 0)}
                <span className={`inline-flex items-center text-[11px] ${purchaseGrowth <= 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {purchaseGrowth >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(purchaseGrowth).toFixed(0)}%
                </span>
              </span>
            </div>
            {finance ? (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-muted">ذمم الموردين</span>
                <span className="font-bold">{formatMoney(data.payables?.amount || 0)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-muted">الموردين</span>
                <span className="font-bold">{data.suppliersCount}</span>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-4">
            <div className="text-base font-extrabold">المبيعات حسب التصنيف</div>
            <div className="mt-0.5 text-xs text-muted">آخر 30 يوم</div>
          </div>
          {insight.slices.length ? (
            <Donut slices={insight.slices} centerLabel="إجمالي" centerValue={`${Math.round(insight.revenue30 / 1000).toLocaleString('ar-EG')} ألف`} />
          ) : <Empty text="لا توجد مبيعات بعد" />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-base font-extrabold">الأصناف الأكثر مبيعاً</div>
              <div className="mt-0.5 text-xs text-muted">حسب قيمة المبيعات · 30 يوم</div>
            </div>
            <Link to="/products" className="text-xs font-bold text-brand-700">كل الأصناف</Link>
          </div>
          {insight.topProducts.length ? <BarList rows={insight.topProducts} /> : <Empty text="لا توجد مبيعات بعد" />}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-base font-extrabold">أفضل العملاء</div>
              <div className="mt-0.5 text-xs text-muted">حسب حجم التعامل · 30 يوم</div>
            </div>
            <Link to="/customers" className="text-xs font-bold text-brand-700">كل العملاء</Link>
          </div>
          {insight.topCustomers.length ? <BarList rows={insight.topCustomers} color="from-violet-400 to-violet-700" /> : <Empty text="لا يوجد عملاء بعد" />}
        </Card>

        <Card>
          <div className="mb-4">
            <div className="text-base font-extrabold">مستحقات العملاء</div>
            <div className="mt-0.5 text-xs text-muted">مهلة السداد 5 أيام من تاريخ الفاتورة</div>
          </div>
          <div className="space-y-2.5">
            {([
              ['red', 'متأخرة السداد', 'bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500'],
              ['yellow', 'أقل من 5 أيام', 'bg-amber-50 text-amber-700 ring-amber-200', 'bg-amber-500'],
              ['green', 'باقي 5 أيام', 'bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500'],
            ] as const).map(([tone, label, box, dot]) => (
              <Link key={tone} to="/sales" className={`flex items-center justify-between rounded-xl px-3.5 py-3 ring-1 transition hover:-translate-y-px ${box}`}>
                <span className="flex items-center gap-2 text-sm font-bold"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{label}</span>
                <span className="text-left">
                  <span className="block text-sm font-extrabold">{formatMoney(insight.aging[tone].amount)}</span>
                  <span className="block text-[11px] opacity-80">{insight.aging[tone].count} فاتورة</span>
                </span>
              </Link>
            ))}
          </div>
          {insight.branches.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-3 text-sm font-bold">المبيعات حسب الفرع</div>
              <div className="space-y-2">
                {insight.branches.map((b, i) => (
                  <div key={b.label} className="flex items-center gap-3 text-xs">
                    <span className="w-28 shrink-0 truncate font-semibold text-slate-700">{b.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${(b.value / Math.max(1, insight.branches[0].value)) * 100}%`, background: BRANCH_COLORS[i % BRANCH_COLORS.length] }} />
                    </div>
                    <span className="w-24 shrink-0 text-left font-bold text-slate-800">{formatMoney(b.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {finance && (data.cashAccounts?.length || 0) > 0 && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-extrabold">طرق الدفع</div>
              <Link to="/cash" className="text-xs font-bold text-brand-700">الخزنة</Link>
            </div>
            <div className="space-y-3">
              {data.cashAccounts!.map((acc) => {
                const bank = acc.accountType === 'BANK';
                const wallet = acc.accountType === 'WALLET';
                const tone = bank
                  ? 'bg-gradient-to-br from-brand-600 to-brand-950'
                  : wallet
                    ? 'bg-gradient-to-br from-sky-500 to-indigo-800'
                    : 'bg-gradient-to-br from-emerald-500 to-teal-800';
                return (
                  <div key={acc.id} className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-lg ${tone}`}>
                    <div className="pointer-events-none absolute -left-8 -top-8 h-24 w-24 rounded-full bg-white/10" />
                    <div className="pointer-events-none absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-white/5" />
                    <div className="relative flex items-center justify-between text-xs text-white/80">
                      <span className="flex items-center gap-1.5">{bank ? <Landmark size={14} /> : <Wallet size={14} />}{acc.name}</span>
                      <span className="font-mono tracking-widest" dir="ltr">{acc.code}</span>
                    </div>
                    <div className="relative mt-3 text-xl font-black tracking-tight">{formatMoney(acc.balance)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {(warehouse || finance || role === 'SALES') && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-extrabold"><AlertTriangle size={18} className="text-amber-500" /> يحتاج إعادة طلب</div>
              <Link to="/stock" className="text-xs font-bold text-brand-700">المخزون</Link>
            </div>
            {data.lowStock.length === 0 ? <Empty text="لا توجد تنبيهات مخزون" hint="كل الأصناف أعلى من حد إعادة الطلب" /> : (
              <div className="space-y-2.5">
                {data.lowStock.slice(0, 7).map((row, index) => {
                  const pct = row.minStock ? Math.min(100, (row.quantity / row.minStock) * 100) : 0;
                  return (
                    <div key={`${row.name}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 font-semibold">
                          <PackageX size={15} className={row.quantity <= 0 ? 'shrink-0 text-rose-600' : 'shrink-0 text-amber-600'} />
                          <span className="truncate">{row.name}</span>
                        </span>
                        <span className={`shrink-0 font-extrabold ${row.quantity <= 0 ? 'text-rose-700' : 'text-amber-700'}`}>{row.quantity} / {row.minStock}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${pct < 40 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted">{row.warehouseName}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-extrabold">آخر النشاطات</div>
            <Clock3 size={16} className="text-muted" />
          </div>
          {activity.length === 0 ? <Empty text="لا توجد عمليات حديثة" /> : (
            <ol className="relative space-y-4 before:absolute before:inset-y-1 before:right-[15px] before:w-px before:bg-slate-200">
              {activity.slice(0, 7).map((item) => (
                <li key={item.id} className="relative flex gap-3">
                  <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-4 ring-white ${item.kind === 'sale' ? 'bg-brand-700 text-white' : 'bg-sky-500 text-white'}`}>
                    {item.kind === 'sale' ? <ShoppingCart size={14} /> : <ShoppingBag size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={item.to} className="text-sm font-bold hover:text-brand-700">{item.title}</Link>
                      <StatusBadge status={item.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {item.detail}{item.actor ? ` · ${item.actor}` : ''} · {formatRelative(item.at)}
                    </div>
                    <div className="mt-0.5 text-sm font-extrabold text-slate-800">{formatMoney(item.amount)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
