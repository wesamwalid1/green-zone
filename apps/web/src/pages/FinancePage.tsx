import { useEffect, useState } from 'react';
import { CalendarClock, FileCheck2, Plus, Receipt, Scale, Tags } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useConfirm, useToast } from '../lib/feedback';
import { BarList } from '../components/charts';
import {
  Badge, Button, Card, CardHeader, Empty, ErrorState, Input, Label, NumberInput, PageHeader, PageSkeleton, Pager, Select, StatCard, StatGrid, Table, Td, Th,
  type Tone,
} from '../components/ui';

type Tab = 'expenses' | 'checks';

type Expense = { id: string; amount: number; expenseDate: string; notes?: string | null; category: { name: string }; account: { name: string } };
type Check = { id: string; direction: string; checkNumber: string; bankName: string; amount: number; dueDate: string; status: string; customer?: { name: string } | null; supplier?: { name: string } | null };
const CHECK_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'قيد الانتظار', tone: 'amber' },
  CLEARED: { label: 'تم التحصيل / الصرف', tone: 'emerald' },
  BOUNCED: { label: 'مرتد', tone: 'rose' },
  CANCELLED: { label: 'ملغي', tone: 'slate' },
};

const num = (v: number | '') => (v === '' ? 0 : v);

export function FinancePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('expenses');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<{ id: string; name: string; kind: 'IMMEDIATE' | 'CHECK' }[]>([]);
  const [settleMethod, setSettleMethod] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [catName, setCatName] = useState('');
  const [expense, setExpense] = useState({ categoryId: '', methodId: '', amount: '' as number | '', notes: '' });
  const [checkForm, setCheckForm] = useState({ direction: 'IN', checkNumber: '', bankName: '', amount: '' as number | '', dueDate: '' });
  const [checkFilter, setCheckFilter] = useState<'ALL' | 'PENDING' | 'IN' | 'OUT'>('ALL');
  const [listPage, setListPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expenseTotalCount, setExpenseTotalCount] = useState(0);
  const [checkTotal, setCheckTotal] = useState(0);
  const [expenseSummary, setExpenseSummary] = useState<{ totalAmount: number; monthAmount: number; byCategory: { label: string; value: number }[] }>({ totalAmount: 0, monthAmount: 0, byCategory: [] });
  const [checkSummary, setCheckSummary] = useState({ total: 0, pendingIn: 0, pendingInCount: 0, pendingOut: 0, pendingOutCount: 0 });

  async function load() {
    setLoadError('');
    try {
      const params = new URLSearchParams({ page: String(listPage), pageSize: String(pageSize) });
      const checkParams = new URLSearchParams(params);
      if (checkFilter === 'PENDING') checkParams.set('status', 'PENDING');
      if (checkFilter === 'IN' || checkFilter === 'OUT') checkParams.set('direction', checkFilter);
      const [a, cats, ex, ch] = await Promise.all([
        api<{ id: string; name: string; kind: 'IMMEDIATE' | 'CHECK' }[]>('/cash/methods'),
        api<{ id: string; name: string }[]>('/finance/expense-categories'),
        api<{ items: Expense[]; total: number; summary: typeof expenseSummary }>(`/finance/expenses?${params}`),
        api<{ items: Check[]; total: number; summary: typeof checkSummary }>(`/finance/checks?${checkParams}`),
      ]);
      setMethods(a);
      setCategories(cats);
      setExpenses(ex.items);
      setChecks(ch.items);
      setExpenseTotalCount(ex.total);
      setCheckTotal(ch.total);
      setExpenseSummary(ex.summary);
      setCheckSummary(ch.summary);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'تعذر تحميل البيانات المالية');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => { setListPage(1); }, [tab, checkFilter, pageSize]);
  useEffect(() => { load(); }, [listPage, pageSize, tab, checkFilter]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ العملية');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const expenseTotal = expenseSummary.totalAmount;
  const expenseMonth = expenseSummary.monthAmount;
  const pendingIn = checkSummary.pendingIn;
  const pendingOut = checkSummary.pendingOut;
  const byCategory = expenseSummary.byCategory;
  const visibleChecks = checks;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'expenses', label: 'المصروفات', count: expenseTotalCount },
    { id: 'checks', label: 'الشيكات', count: checkSummary.total },
  ];

  if (!loaded) return <div><PageHeader title="المالية" subtitle="مصروفات مصنفة ودفتر شيكات" /><PageSkeleton /></div>;

  return (
    <div>
      <PageHeader title="المالية" subtitle="مصروفات مصنفة ودفتر شيكات" />
      {loadError && <Card className="mb-4"><ErrorState text={loadError} onRetry={load} /></Card>}

      <StatGrid>
        <StatCard label="مصروفات الشهر" value={formatMoney(expenseMonth)} hint={`الإجمالي المسجل ${formatMoney(expenseTotal)}`} icon={Receipt} tone="amber" onClick={() => setTab('expenses')} active={tab === 'expenses'} />
        <StatCard label="شيكات واردة معلقة" value={formatMoney(pendingIn)} hint={`${checkSummary.pendingInCount} شيك`} icon={FileCheck2} tone="emerald" onClick={() => { setTab('checks'); setCheckFilter('IN'); }} />
        <StatCard label="شيكات صادرة معلقة" value={formatMoney(pendingOut)} hint={`${checkSummary.pendingOutCount} شيك`} icon={CalendarClock} tone="rose" onClick={() => { setTab('checks'); setCheckFilter('OUT'); }} />
      </StatGrid>

      <div className="mb-4 flex w-fit max-w-full flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-bold transition ${tab === t.id ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t.label}
            <span className={`rounded-md px-1.5 text-[11px] tabular-nums ${tab === t.id ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'expenses' && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="تسجيل مصروف" subtitle="يُخصم من طريقة الدفع فورًا" icon={Plus} />
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!expense.categoryId || !expense.methodId) return toast.error('اختر البند وطريقة الدفع');
                  if (num(expense.amount) <= 0) return toast.error('أدخل مبلغًا أكبر من صفر');
                  const ok = await run(() => api('/finance/expenses', { method: 'POST', body: JSON.stringify({ categoryId: expense.categoryId, methodId: expense.methodId, amount: num(expense.amount), notes: expense.notes || undefined }) }), 'تم تسجيل المصروف');
                  if (ok) setExpense({ ...expense, amount: '', notes: '' });
                }}
              >
                <div>
                  <Label>البند</Label>
                  <Select value={expense.categoryId} onChange={(e) => setExpense({ ...expense, categoryId: e.target.value })}>
                    <option value="">اختر</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>طريقة الدفع</Label>
                  <Select value={expense.methodId} onChange={(e) => setExpense({ ...expense, methodId: e.target.value })}>
                    <option value="">اختر</option>
                    {methods.filter((method) => method.kind === 'IMMEDIATE').map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                  </Select>
                </div>
                <div><Label>المبلغ</Label><NumberInput value={expense.amount} onValueChange={(v) => setExpense({ ...expense, amount: v })} /></div>
                <div><Label>ملاحظة</Label><Input value={expense.notes} onChange={(e) => setExpense({ ...expense, notes: e.target.value })} placeholder="اختياري" /></div>
                <Button type="submit" className="w-full" disabled={busy}>تسجيل المصروف</Button>
              </form>
            </Card>
            <Card>
              <CardHeader title="بنود المصروفات" subtitle={`${categories.length} بند`} icon={Tags} />
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!catName.trim()) return toast.error('اكتب اسم البند');
                  const ok = await run(() => api('/finance/expense-categories', { method: 'POST', body: JSON.stringify({ name: catName.trim() }) }), 'تمت إضافة البند');
                  if (ok) setCatName('');
                }}
              >
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="بند مصروف جديد" />
                <Button type="submit" variant="secondary" disabled={busy}>إضافة</Button>
              </form>
              {categories.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {categories.map((c) => <Badge key={c.id} tone="slate">{c.name}</Badge>)}
                </div>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            {byCategory.length > 0 && (
              <Card>
                <CardHeader title="توزيع المصروفات حسب البند" subtitle={`الإجمالي ${formatMoney(expenseTotal)}`} icon={Scale} />
                <BarList rows={byCategory} color="from-amber-400 to-amber-600" />
              </Card>
            )}
            <Card>
              <CardHeader title="سجل المصروفات" subtitle={`${expenseTotalCount} مصروف`} icon={Receipt} />
              {expenses.length === 0 ? <Empty text="لا توجد مصروفات مسجلة" hint="سجّل أول مصروف من النموذج" /> : (
                <Table>
                  <thead><tr><Th>التاريخ</Th><Th>البند</Th><Th>الخزنة</Th><Th>ملاحظة</Th><Th>المبلغ</Th></tr></thead>
                  <tbody>
                    {expenses.map((row) => (
                      <tr key={row.id} className="row-credit">
                        <Td className="whitespace-nowrap text-slate-500">{formatDate(row.expenseDate)}</Td>
                        <Td><Badge tone="amber">{row.category.name}</Badge></Td>
                        <Td className="text-slate-600">{row.account.name}</Td>
                        <Td className="max-w-xs truncate text-muted">{row.notes || '—'}</Td>
                        <Td className="whitespace-nowrap font-extrabold text-rose-600">{formatMoney(row.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <Pager page={listPage} pages={Math.max(1, Math.ceil(expenseTotalCount / pageSize))} total={expenseTotalCount} from={expenseTotalCount === 0 ? 0 : (listPage - 1) * pageSize + 1} to={Math.min(listPage * pageSize, expenseTotalCount)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'checks' && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card>
            <CardHeader title="تسجيل شيك" subtitle="وارد من عميل أو صادر لمورد" icon={Plus} />
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!checkForm.checkNumber.trim() || !checkForm.bankName.trim()) return toast.error('أدخل رقم الشيك واسم البنك');
                if (num(checkForm.amount) <= 0) return toast.error('أدخل مبلغًا أكبر من صفر');
                if (!checkForm.dueDate) return toast.error('حدد تاريخ الاستحقاق');
                const ok = await run(() => api('/finance/checks', { method: 'POST', body: JSON.stringify({ ...checkForm, amount: num(checkForm.amount) }) }), 'تم تسجيل الشيك');
                if (ok) setCheckForm({ ...checkForm, checkNumber: '', bankName: '', amount: '', dueDate: '' });
              }}
            >
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                {[['IN', 'شيك وارد'], ['OUT', 'شيك صادر']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setCheckForm({ ...checkForm, direction: v })} className={`h-9 rounded-lg text-[13px] font-bold transition ${checkForm.direction === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'}`}>{l}</button>
                ))}
              </div>
              <div><Label>رقم الشيك</Label><Input value={checkForm.checkNumber} onChange={(e) => setCheckForm({ ...checkForm, checkNumber: e.target.value })} dir="ltr" /></div>
              <div><Label>البنك</Label><Input value={checkForm.bankName} onChange={(e) => setCheckForm({ ...checkForm, bankName: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>المبلغ</Label><NumberInput value={checkForm.amount} onValueChange={(v) => setCheckForm({ ...checkForm, amount: v })} /></div>
                <div><Label>الاستحقاق</Label><Input type="date" value={checkForm.dueDate} onChange={(e) => setCheckForm({ ...checkForm, dueDate: e.target.value })} /></div>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>تسجيل الشيك</Button>
            </form>
          </Card>
          <Card>
            <CardHeader
              title="دفتر الشيكات"
              subtitle={`${checkTotal} شيك`}
              icon={FileCheck2}
              actions={
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {([['ALL', 'الكل'], ['PENDING', 'معلقة'], ['IN', 'واردة'], ['OUT', 'صادرة']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setCheckFilter(v)} className={`h-8 rounded-lg px-3 text-xs font-bold transition ${checkFilter === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'}`}>{l}</button>
                  ))}
                </div>
              }
            />
            {checkTotal === 0 ? <Empty text="لا توجد شيكات" /> : (
              <Table>
                <thead><tr><Th>الشيك</Th><Th>الطرف</Th><Th>البنك</Th><Th>الاستحقاق</Th><Th>المبلغ</Th><Th>الحالة</Th><Th></Th></tr></thead>
                <tbody>
                  {visibleChecks.map((row) => {
                    const st = CHECK_STATUS[row.status] || { label: row.status, tone: 'slate' as Tone };
                    const overdue = row.status === 'PENDING' && new Date(row.dueDate).getTime() < Date.now();
                    return (
                      <tr key={row.id} className={row.direction === 'IN' ? 'row-debit' : 'row-credit'}>
                        <Td>
                          <div className="font-mono text-xs font-bold text-slate-800" dir="ltr">{row.checkNumber}</div>
                          <div className="mt-0.5"><Badge tone={row.direction === 'IN' ? 'emerald' : 'rose'}>{row.direction === 'IN' ? 'وارد' : 'صادر'}</Badge></div>
                        </Td>
                        <Td className="font-semibold text-slate-700">{row.customer?.name || row.supplier?.name || '—'}</Td>
                        <Td className="text-slate-600">{row.bankName}</Td>
                        <Td className={`whitespace-nowrap ${overdue ? 'font-bold text-rose-600' : 'text-slate-500'}`}>{formatDate(row.dueDate)}{overdue && <div className="text-[11px]">مستحق</div>}</Td>
                        <Td className="whitespace-nowrap font-extrabold">{formatMoney(row.amount)}</Td>
                        <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                        <Td>
                          {row.status === 'PENDING' && (
                            <div className="flex items-center gap-1.5">
                              <Select value={settleMethod[row.id] || ''} onChange={(e) => setSettleMethod({ ...settleMethod, [row.id]: e.target.value })}>
                                <option value="">طريقة التحصيل</option>
                                {methods.filter((method) => method.kind === 'IMMEDIATE').map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                              </Select>
                              <Button size="sm" variant="soft" disabled={busy} onClick={() => {
                                const methodId = settleMethod[row.id];
                                if (!methodId) return toast.error('اختر طريقة الدفع اللي هيدخل عليها الشيك');
                                return run(() => api(`/finance/checks/${row.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: 'CLEARED', methodId }),
                                }), row.direction === 'IN' ? 'تم تحصيل الشيك' : 'تم صرف الشيك');
                              }}>{row.direction === 'IN' ? 'تحصيل' : 'صرف'}</Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                                if (!(await confirm({ title: 'تسجيل شيك مرتد', message: `هل تريد تسجيل الشيك ${row.checkNumber} كمرتد؟`, confirmLabel: 'مرتد', danger: true }))) return;
                                await run(() => api(`/finance/checks/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'BOUNCED' }) }), 'تم تسجيل الشيك كمرتد');
                              }}>مرتد</Button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            <Pager page={listPage} pages={Math.max(1, Math.ceil(checkTotal / pageSize))} total={checkTotal} from={checkTotal === 0 ? 0 : (listPage - 1) * pageSize + 1} to={Math.min(listPage * pageSize, checkTotal)} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
          </Card>
        </div>
      )}
    </div>
  );
}
