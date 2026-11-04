import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Search, Users, XCircle } from 'lucide-react';
import { api, formatRelative } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge, Button, Card, CardHeader, Empty, ErrorState, Input, PageHeader, Pager, StatCard, StatGrid, Table, TableSkeleton, Td, Th, type Tone,
} from '../components/ui';

type Log = {
  id: string;
  userName: string | null;
  action: string;
  method: string;
  path: string;
  status: string;
  createdAt: string;
};

const METHOD: Record<string, { label: string; tone: Tone }> = {
  POST: { label: 'إنشاء', tone: 'emerald' },
  PATCH: { label: 'تعديل', tone: 'sky' },
  PUT: { label: 'تعديل', tone: 'sky' },
  DELETE: { label: 'حذف', tone: 'rose' },
};

export function AuditPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Log[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'success' | 'failed'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total: 0, success: 0, failed: 0, users: 0 });

  async function load(next = query, nextPage = page) {
    setError('');
    try {
      if (user?.role !== 'ADMIN') {
        setRows(await api<Log[]>('/ops/activity'));
        setTotal(0);
        return;
      }
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
      if (next.trim()) params.set('q', next.trim());
      if (filter !== 'ALL') params.set('status', filter);
      const res = await api<{ items: Log[]; total: number; summary: typeof summary }>(`/ops/audit?${params}`);
      setRows(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'تعذر تحميل السجل');
    }
  }

  useEffect(() => { setPage(1); }, [query, filter, pageSize, user?.role]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(query, page).catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [query, filter, page, pageSize, user?.role]);

  const source = rows || [];
  const visible = user?.role === 'ADMIN' ? source : source.filter((row) => filter === 'ALL' || (filter === 'success' ? row.status === 'success' : row.status !== 'success'));
  const pages = Math.max(1, Math.ceil((user?.role === 'ADMIN' ? total : visible.length) / pageSize));
  const slice = user?.role === 'ADMIN' ? visible : visible.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  const shownTotal = user?.role === 'ADMIN' ? total : visible.length;
  const failed = user?.role === 'ADMIN' ? summary.failed : source.filter((row) => row.status !== 'success').length;
  const usersCount = user?.role === 'ADMIN' ? summary.users : new Set(source.map((row) => row.userName).filter(Boolean)).size;
  const successCount = user?.role === 'ADMIN' ? summary.success : source.length - failed;
  const allCount = user?.role === 'ADMIN' ? summary.total : source.length;

  return (
    <div>
      <PageHeader
        title="سجل العمليات"
        subtitle={user?.role === 'ADMIN' ? 'كل عمليات الإنشاء والتعديل والحذف مع اسم المستخدم' : 'عملياتك أنت'}
      />

      <StatGrid>
        <StatCard label="إجمالي العمليات" value={allCount} icon={Activity} tone="brand" onClick={() => { setFilter('ALL'); setPage(1); }} active={filter === 'ALL'} />
        <StatCard label="ناجحة" value={successCount} icon={CheckCircle2} tone="emerald" onClick={() => { setFilter('success'); setPage(1); }} active={filter === 'success'} />
        <StatCard label="فشلت" value={failed} icon={XCircle} tone="rose" onClick={() => { setFilter('failed'); setPage(1); }} active={filter === 'failed'} />
        <StatCard label="مستخدمون نشطون" value={usersCount} icon={Users} tone="violet" />
      </StatGrid>

      <Card>
        <CardHeader
          title="العمليات المسجلة"
          subtitle={`${shownTotal} عملية`}
          icon={Activity}
          actions={user?.role === 'ADMIN' ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); load(query, 1); }}>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input className="w-64 pr-9" placeholder="بحث بالاسم أو العملية" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Button type="submit" variant="secondary">بحث</Button>
              {query && <Button type="button" variant="ghost" onClick={() => { setQuery(''); setPage(1); }}>مسح</Button>}
            </form>
          ) : undefined}
        />
        {error ? <ErrorState text="تعذر تحميل السجل" hint={error} onRetry={() => load()} /> : !rows ? <TableSkeleton /> : visible.length === 0 ? (
          <Empty text="لا عمليات مسجلة" hint="أي حفظ أو حذف جديد سيظهر هنا" />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>المستخدم</Th><Th>العملية</Th><Th>النوع</Th><Th>المسار</Th><Th>الحالة</Th><Th>الوقت</Th></tr>
              </thead>
              <tbody>
                {slice.map((row) => {
                  const m = METHOD[row.method] || { label: row.method, tone: 'slate' as Tone };
                  const ok = row.status === 'success';
                  return (
                    <tr key={row.id} className={ok ? '' : 'row-credit'}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-extrabold text-brand-700">{(row.userName || '؟').slice(0, 1)}</span>
                          <span className="font-semibold text-slate-800">{row.userName || '—'}</span>
                        </div>
                      </Td>
                      <Td className="text-slate-700">{row.action}</Td>
                      <Td><Badge tone={m.tone}>{m.label}</Badge></Td>
                      <Td><span className="font-mono text-[11px] text-slate-500" dir="ltr">{row.method} {row.path}</span></Td>
                      <Td><Badge tone={ok ? 'emerald' : 'rose'}>{ok ? 'تمت' : 'فشلت'}</Badge></Td>
                      <Td className="whitespace-nowrap text-slate-500">{formatRelative(row.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pager page={page} pages={pages} total={shownTotal} from={shownTotal === 0 ? 0 : (page - 1) * pageSize + 1} to={Math.min(page * pageSize, shownTotal)} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
      </Card>
    </div>
  );
}
