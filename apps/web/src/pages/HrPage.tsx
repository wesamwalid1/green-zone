import { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CalendarDays,
  ClipboardList,
  Download,
  Percent,
  Plus,
  Printer,
  Trash2,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { api, formatDate, formatMoney, getApiBase } from '../lib/api';
import { useAccess } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import {
  Badge,
  Button,
  Card,
  DateRangeFilter,
  Empty,
  ErrorState,
  Field,
  Input,
  Modal,
  NumberInput,
  PageHeader,
  PageSkeleton,
  PrintHeader,
  Select,
  StatCard,
  StatGrid,
  Table,
  Td,
  Th,
  todayIso,
} from '../components/ui';

type Tab = 'employees' | 'attendance' | 'leaves' | 'movements' | 'payroll' | 'approval' | 'commissions' | 'settings';

type Employee = {
  id: string;
  code: string;
  name: string;
  salary: number;
  commissionPercent: number;
  phone?: string | null;
  hireDate?: string | null;
  isActive: boolean;
  userId?: string | null;
  user?: { id: string; fullName: string; username: string } | null;
};

type LinkableUser = { id: string; fullName: string; username: string; linked: boolean };
type PayMethod = { id: string; name: string; kind: string };
type Holiday = { id: string; date: string; name: string };
type Leave = { id: string; fromDate: string; toDate: string; kind: string; notes?: string | null; employee: { id: string; code: string; name: string } };
type Movement = { id: string; kind: string; amount: number; movementDate: string; notes?: string | null; payrollRunId?: string | null; employee: { id: string; code: string; name: string } };
type Attendance = {
  id: string;
  workDate: string;
  status: string;
  lateMinutes: number;
  permissionMinutes: number;
  overtimeMinutes?: number;
  punchIn?: string | null;
  punchOut?: string | null;
  employee: { id: string; code: string; name: string };
};
type PayrollLine = {
  id?: string;
  employeeId: string;
  code?: string;
  name?: string;
  employee?: { id: string; code: string; name: string };
  salary?: number;
  presentDays: number;
  paidLeaveDays: number;
  permissionDays: number;
  absentDays: number;
  unpaidLeaveDays?: number;
  daily: number;
  hourlyRate?: number;
  overtimeHours?: number;
  overtimePay?: number;
  lateHours?: number;
  earned: number;
  bonuses: number;
  deductions: number;
  advances: number;
  latePenalty: number;
  permissionDeduct: number;
  salaryNet: number;
  salesTotal: number;
  commissionRate: number;
  commissionDue: number;
  net: number;
};
type PayrollRun = {
  id: string;
  number: string;
  fromDate: string;
  toDate: string;
  status: string;
  totalNet: number;
  methodId?: string | null;
  notes?: string | null;
  lines: PayrollLine[];
};
type CommissionRow = {
  employeeId: string;
  name: string;
  code: string;
  commissionPercent: number;
  salesTotal: number;
  commissionEarned: number;
  commissionPaid: number;
  commissionRemaining: number;
};
type HrSettings = {
  daysPerMonth: number;
  hoursPerDay: number;
  weekendDays: number[];
  lateGraceMinutes: number;
  latePenaltyPerMinute: number;
  permissionDeductPerHour: number;
  workStartHour: number;
  workStartMinute: number;
  overtimeMultiplier: number;
  absenceMultiplier: number;
  unpaidLeaveDeduct: boolean;
  lateByHourlyRate: boolean;
};

const MOVEMENT_LABELS: Record<string, string> = {
  BONUS: 'مكافأة',
  DEDUCTION: 'خصم',
  ADVANCE: 'سلفة',
  LATE: 'تأخير',
  PERMISSION: 'إذن',
};

const ATT_LABELS: Record<string, string> = {
  PRESENT: 'حضور',
  ABSENT: 'غياب',
  LATE: 'تأخير',
  PERMISSION: 'إذن',
  HOLIDAY: 'إجازة رسمية',
  LEAVE: 'إجازة',
};

const emptyEmp = { code: '', name: '', userId: '', salary: 0 as number | '', commissionPercent: 0 as number | '', phone: '', hireDate: '', isActive: true };

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function lineName(line: PayrollLine) {
  return line.employee?.name || line.name || '—';
}

function lineCode(line: PayrollLine) {
  return line.employee?.code || line.code || '—';
}

export function HrPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can, see } = useAccess();
  const showSalary = see('hr', 'salary');
  const showAmounts = see('hr', 'amounts');

  const [tab, setTab] = useState<Tab>('employees');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<LinkableUser[]>([]);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [settings, setSettings] = useState<HrSettings | null>(null);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [empSales, setEmpSales] = useState<{ name: string; code: string; salesTotal: number; fromHr: boolean }[]>([]);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayIso);
  const [methodId, setMethodId] = useState('');
  const [calcPreview, setCalcPreview] = useState<{ lines: PayrollLine[]; totalNet: number; formula: string } | null>(null);
  const [printRun, setPrintRun] = useState<PayrollRun | null>(null);

  const [empOpen, setEmpOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [empForm, setEmpForm] = useState(emptyEmp);

  const [leaveForm, setLeaveForm] = useState({ employeeId: '', fromDate: todayIso(), toDate: todayIso(), kind: 'PAID', notes: '' });
  const [movForm, setMovForm] = useState({ employeeId: '', kind: 'BONUS', amount: '' as number | '', movementDate: todayIso(), notes: '' });
  const [attForm, setAttForm] = useState({
    employeeId: '',
    workDate: todayIso(),
    status: 'PRESENT',
    punchIn: '09:00',
    punchOut: '17:00',
    lateMinutes: '' as number | '',
    permissionMinutes: 0 as number | '',
    overtimeMinutes: '' as number | '',
    notes: '',
  });
  const [holidayForm, setHolidayForm] = useState({ date: todayIso(), name: '' });
  const [settingsForm, setSettingsForm] = useState<HrSettings | null>(null);
  const [printEmployeeLine, setPrintEmployeeLine] = useState<{ run: PayrollRun; line: PayrollLine } | null>(null);
  const [approvePrint, setApprovePrint] = useState<PayrollRun | null>(null);

  function combineDateTime(date: string, time: string) {
    if (!date || !time) return null;
    return `${date}T${time}:00`;
  }

  function workHoursFromTimes(punchIn: string, punchOut: string) {
    if (!punchIn || !punchOut) return null;
    const [ih, im] = punchIn.split(':').map(Number);
    const [oh, om] = punchOut.split(':').map(Number);
    const mins = (oh * 60 + om) - (ih * 60 + im);
    if (!Number.isFinite(mins) || mins < 0) return null;
    return Math.round((mins / 60) * 100) / 100;
  }

  const attWorkHours = workHoursFromTimes(attForm.punchIn, attForm.punchOut);

  async function loadCore() {
    setLoadError('');
    try {
      const [emps, linkable, meth, hol, set] = await Promise.all([
        api<Employee[]>('/hr/employees'),
        api<LinkableUser[]>('/hr/linkable-users'),
        api<PayMethod[]>('/cash/methods'),
        api<Holiday[]>('/hr/holidays'),
        api<HrSettings>('/hr/settings'),
      ]);
      setEmployees(emps);
      setUsers(linkable);
      setMethods(meth.filter((m) => m.kind === 'IMMEDIATE'));
      setHolidays(hol);
      setSettings(set);
      setSettingsForm(set);
      if (!methodId && meth.find((m) => m.kind === 'IMMEDIATE')) {
        setMethodId(meth.find((m) => m.kind === 'IMMEDIATE')!.id);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الموارد البشرية');
    } finally {
      setLoaded(true);
    }
  }

  async function loadTab() {
    try {
      if (tab === 'leaves') setLeaves(await api<Leave[]>('/hr/leaves'));
      if (tab === 'movements') setMovements(await api<Movement[]>(`/hr/movements?from=${from}&to=${to}`));
      if (tab === 'attendance') setAttendance(await api<Attendance[]>(`/hr/attendance?from=${from}&to=${to}`));
      if (tab === 'payroll' || tab === 'approval') setRuns(await api<PayrollRun[]>('/hr/payroll/runs'));
      if (tab === 'commissions') {
        const [c, s] = await Promise.all([
          api<{ rows: CommissionRow[] }>(`/hr/commissions?from=${from}&to=${to}`),
          api<{ rows: { name: string; code: string; salesTotal: number; fromHr: boolean }[] }>(`/hr/employee-sales?from=${from}&to=${to}`),
        ]);
        setCommissions(c.rows);
        setEmpSales(s.rows);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  }

  useEffect(() => { loadCore(); }, []);
  useEffect(() => { if (loaded) loadTab(); }, [tab, from, to, loaded]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await loadCore();
      await loadTab();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ العملية');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const activeCount = useMemo(() => employees.filter((e) => e.isActive).length, [employees]);
  const draftRuns = useMemo(() => runs.filter((r) => r.status === 'DRAFT').length, [runs]);
  const commissionDueTotal = useMemo(
    () => commissions.reduce((s, r) => s + r.commissionRemaining, 0),
    [commissions],
  );

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'employees', label: 'الموظفون', icon: Users },
    { id: 'attendance', label: 'الحضور', icon: CalendarDays },
    { id: 'leaves', label: 'الإجازات', icon: ClipboardList },
    { id: 'movements', label: 'الحركات', icon: Wallet },
    { id: 'payroll', label: 'كشوف المرتبات', icon: Calculator },
    { id: 'approval', label: 'اعتماد المرتبات', icon: ClipboardList },
    { id: 'commissions', label: 'العمولات', icon: Percent },
    { id: 'settings', label: 'الإعدادات', icon: UserCog },
  ];

  function openCreateEmp() {
    setEditingId(null);
    setEmpForm(emptyEmp);
    setEmpOpen(true);
  }

  function openEditEmp(row: Employee) {
    setEditingId(row.id);
    setEmpForm({
      code: row.code,
      name: row.name,
      userId: row.userId || '',
      salary: row.salary,
      commissionPercent: row.commissionPercent,
      phone: row.phone || '',
      hireDate: row.hireDate ? String(row.hireDate).slice(0, 10) : '',
      isActive: row.isActive,
    });
    setEmpOpen(true);
  }

  async function saveEmployee() {
    const body = {
      code: empForm.code.trim(),
      name: empForm.name.trim(),
      userId: empForm.userId || null,
      salary: Number(empForm.salary) || 0,
      commissionPercent: Number(empForm.commissionPercent) || 0,
      phone: empForm.phone || undefined,
      hireDate: empForm.hireDate || undefined,
      isActive: empForm.isActive,
    };
    const ok = await run(
      () => (editingId
        ? api(`/hr/employees/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/hr/employees', { method: 'POST', body: JSON.stringify(body) })),
      editingId ? 'تم تحديث الموظف' : 'تم إضافة الموظف',
    );
    if (ok) setEmpOpen(false);
  }

  async function calcPayroll() {
    setBusy(true);
    try {
      const res = await api<{ lines: PayrollLine[]; totalNet: number; formula: string }>('/hr/payroll/calc', {
        method: 'POST',
        body: JSON.stringify({ from, to }),
      });
      setCalcPreview(res);
      toast.success('تم حساب الكشف');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحساب');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const ok = await run(
      () => api('/hr/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({ from, to, methodId: methodId || undefined, notes: '' }),
      }),
      'تم حفظ مسودة الكشف',
    );
    if (ok) {
      setCalcPreview(null);
      setTab('payroll');
    }
  }

  async function postRun(runRow: PayrollRun) {
    const okConfirm = await confirm({
      title: 'ترحيل كشف المرتبات',
      message: `سيتم خصم ${formatMoney(runRow.totalNet)} من الخزنة كمصروف رواتب واحد (راتب + عمولة). المتابعة؟`,
      confirmLabel: 'ترحيل وصرف',
    });
    if (!okConfirm) return;
    await run(
      () => api(`/hr/payroll/runs/${runRow.id}/post`, {
        method: 'POST',
        body: JSON.stringify({ methodId: methodId || runRow.methodId || undefined }),
      }),
      'تم ترحيل الكشف وصرف المرتبات والعمولات',
    );
  }

  async function deleteRun(runRow: PayrollRun) {
    if (runRow.status !== 'DRAFT') return;
    const okConfirm = await confirm({ title: 'حذف المسودة', message: 'سيتم فك ربط الحركات. متابعة؟', danger: true });
    if (!okConfirm) return;
    await run(() => api(`/hr/payroll/runs/${runRow.id}`, { method: 'DELETE' }), 'تم حذف المسودة');
  }

  async function exportCommissions() {
    try {
      const token = localStorage.getItem('m5azen_token');
      const res = await fetch(`${getApiBase()}/api/hr/commissions/excel?from=${from}&to=${to}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('تعذر التصدير');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'commissions.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التصدير');
    }
  }

  function doPrint(runRow: PayrollRun) {
    setPrintEmployeeLine(null);
    setApprovePrint(null);
    setPrintRun(runRow);
    setTimeout(() => window.print(), 250);
  }

  function printEmployeeReport(runRow: PayrollRun, line: PayrollLine) {
    setPrintRun(null);
    setApprovePrint(null);
    setPrintEmployeeLine({ run: runRow, line });
    setTimeout(() => window.print(), 250);
  }

  function printApproval(runRow: PayrollRun) {
    setPrintRun(null);
    setPrintEmployeeLine(null);
    setApprovePrint(runRow);
    setTimeout(() => window.print(), 250);
  }

  if (!loaded) {
    return (
      <div>
        <PageHeader title="الموارد البشرية" subtitle="موظفون · حضور · مرتبات · عمولات" />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="الموارد البشرية"
        subtitle="موظف (+ ربط مستخدم ونسبة عمولة) → حضور/إجازات/حركات → احسب كشف → مسودة → ترحيل (خزنة/مصروف واحد)"
      />
      {loadError && <Card className="mb-4"><ErrorState text={loadError} onRetry={loadCore} /></Card>}

      <StatGrid>
        <StatCard label="موظفون نشطون" value={String(activeCount)} icon={Users} tone="brand" onClick={() => setTab('employees')} active={tab === 'employees'} />
        <StatCard label="مسودات مرتبات" value={String(draftRuns)} icon={Calculator} tone="amber" onClick={() => setTab('payroll')} active={tab === 'payroll'} />
        <StatCard label="عمولة متبقية" value={formatMoney(commissionDueTotal)} icon={Percent} tone="emerald" onClick={() => setTab('commissions')} active={tab === 'commissions'} />
      </StatGrid>

      <div className="mb-4 flex w-fit max-w-full flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm no-print">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-bold transition ${tab === t.id ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {(tab === 'attendance' || tab === 'movements' || tab === 'payroll' || tab === 'approval' || tab === 'commissions') && (
        <div className="mb-4 flex flex-wrap items-center gap-3 no-print">
          <DateRangeFilter from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
          {(tab === 'payroll' || tab === 'approval') && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={methodId} onChange={(e) => setMethodId(e.target.value)} className="min-w-44">
                <option value="">طريقة الدفع (فوري)</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              {can('hr', 'create') && (
                <>
                  <Button disabled={busy} onClick={calcPayroll}><Calculator size={14} /> احسب المرتب تلقائي</Button>
                  {calcPreview && <Button disabled={busy} onClick={saveDraft}>حفظ مسودة للاعتماد</Button>}
                </>
              )}
            </div>
          )}
          {tab === 'commissions' && can('hr', 'export') && (
            <Button variant="secondary" onClick={exportCommissions}><Download size={14} /> تصدير Excel</Button>
          )}
        </div>
      )}

      {tab === 'employees' && (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-2 no-print">
            <h2 className="text-base font-extrabold text-slate-900">الموظفون</h2>
            {can('hr', 'create') && <Button onClick={openCreateEmp}><Plus size={14} /> موظف جديد</Button>}
          </div>
          {!employees.length ? <Empty text="لا يوجد موظفون بعد" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>الكود</Th>
                  <Th>الاسم</Th>
                  <Th>المستخدم</Th>
                  {showSalary && <Th>الراتب</Th>}
                  <Th>عمولة %</Th>
                  <Th>الحالة</Th>
                  <Th className="no-print"></Th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <tr key={row.id}>
                    <Td className="font-mono text-xs font-bold"><span dir="ltr">{row.code}</span></Td>
                    <Td className="font-bold">{row.name}</Td>
                    <Td>{row.user?.fullName || '—'}</Td>
                    {showSalary && <Td>{formatMoney(row.salary)}</Td>}
                    <Td>{row.commissionPercent}%</Td>
                    <Td><Badge tone={row.isActive ? 'emerald' : 'slate'}>{row.isActive ? 'نشط' : 'موقوف'}</Badge></Td>
                    <Td className="no-print">
                      <div className="flex gap-1">
                        {can('hr', 'edit') && <Button size="sm" variant="secondary" onClick={() => openEditEmp(row)}>تعديل</Button>}
                        {can('hr', 'delete') && (
                          <Button size="sm" variant="danger" onClick={async () => {
                            if (!(await confirm({ title: 'حذف موظف', message: row.name, danger: true }))) return;
                            await run(() => api(`/hr/employees/${row.id}`, { method: 'DELETE' }), 'تم الحذف');
                          }}><Trash2 size={14} /></Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'attendance' && (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          {can('hr', 'create') && (
            <Card className="no-print h-fit">
              <h3 className="mb-1 font-extrabold">تسجيل حضور يومي</h3>
              <p className="mb-3 text-xs text-muted">أدخل موعد الحضور والانصراف وساعات العمل تتحسب تلقائيًا · الإضافي يتحسب من الساعات الزائدة</p>
              <div className="space-y-3">
                <Field label="الموظف">
                  <Select value={attForm.employeeId} onChange={(e) => setAttForm({ ...attForm, employeeId: e.target.value })}>
                    <option value="">اختر</option>
                    {employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.code} — {e.name}</option>)}
                  </Select>
                </Field>
                <Field label="التاريخ"><Input type="date" value={attForm.workDate} onChange={(e) => setAttForm({ ...attForm, workDate: e.target.value })} /></Field>
                <Field label="الحالة">
                  <Select value={attForm.status} onChange={(e) => setAttForm({ ...attForm, status: e.target.value })}>
                    {Object.entries(ATT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="موعد الحضور">
                    <Input type="time" value={attForm.punchIn} onChange={(e) => setAttForm({ ...attForm, punchIn: e.target.value })} />
                  </Field>
                  <Field label="موعد الانصراف">
                    <Input type="time" value={attForm.punchOut} onChange={(e) => setAttForm({ ...attForm, punchOut: e.target.value })} />
                  </Field>
                </div>
                <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-bold text-brand-900">
                  ساعات العمل: {attWorkHours != null ? `${attWorkHours} ساعة` : '—'}
                  {settings && attWorkHours != null && attWorkHours > settings.hoursPerDay
                    ? ` · إضافي تقريبي ${Math.round((attWorkHours - settings.hoursPerDay) * 60)} د`
                    : ''}
                </div>
                <Field label="دقائق تأخير (اختياري — يتحسب من الحضور لو فاضي)">
                  <NumberInput value={attForm.lateMinutes} onValueChange={(v) => setAttForm({ ...attForm, lateMinutes: v })} />
                </Field>
                <Field label="دقائق إذن"><NumberInput value={attForm.permissionMinutes} onValueChange={(v) => setAttForm({ ...attForm, permissionMinutes: v })} /></Field>
                <Field label="دقائق إضافي (اختياري — يتحسب من الساعات لو فاضي)">
                  <NumberInput value={attForm.overtimeMinutes} onValueChange={(v) => setAttForm({ ...attForm, overtimeMinutes: v })} />
                </Field>
                <Field label="ملاحظات"><Input value={attForm.notes} onChange={(e) => setAttForm({ ...attForm, notes: e.target.value })} /></Field>
                <Button disabled={busy || !attForm.employeeId} className="w-full" onClick={() => run(
                  () => api('/hr/attendance', { method: 'POST', body: JSON.stringify({
                    employeeId: attForm.employeeId,
                    workDate: attForm.workDate,
                    status: attForm.status,
                    punchIn: combineDateTime(attForm.workDate, attForm.punchIn),
                    punchOut: combineDateTime(attForm.workDate, attForm.punchOut),
                    lateMinutes: attForm.lateMinutes === '' ? undefined : Number(attForm.lateMinutes) || 0,
                    permissionMinutes: Number(attForm.permissionMinutes) || 0,
                    overtimeMinutes: attForm.overtimeMinutes === '' ? undefined : Number(attForm.overtimeMinutes) || 0,
                    notes: attForm.notes || undefined,
                  }) }),
                  'تم حفظ الحضور',
                )}>حفظ الحضور</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={busy || !attForm.employeeId} onClick={() => run(
                    () => api('/hr/attendance/punch-in', { method: 'POST', body: JSON.stringify({ employeeId: attForm.employeeId }) }),
                    'تم تسجيل الحضور الآن',
                  )}>حضور الآن</Button>
                  <Button variant="secondary" disabled={busy || !attForm.employeeId} onClick={() => run(
                    () => api('/hr/attendance/punch-out', { method: 'POST', body: JSON.stringify({ employeeId: attForm.employeeId }) }),
                    'تم تسجيل الانصراف الآن',
                  )}>انصراف الآن</Button>
                </div>
              </div>
            </Card>
          )}
          <Card>
            {!attendance.length ? <Empty text="لا سجلات حضور في الفترة" hint="سجّل الحضور والانصراف لكل موظف عشان المرتب يتحسب صح" /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>التاريخ</Th>
                    <Th>الموظف</Th>
                    <Th>الحالة</Th>
                    <Th>حضور</Th>
                    <Th>انصراف</Th>
                    <Th>ساعات</Th>
                    <Th>تأخير</Th>
                    <Th>إذن</Th>
                    <Th>إضافي</Th>
                    <Th className="no-print"></Th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((row) => {
                    const inT = row.punchIn ? new Date(row.punchIn).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                    const outT = row.punchOut ? new Date(row.punchOut).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                    let hours = '—';
                    if (row.punchIn && row.punchOut) {
                      const mins = Math.max(0, Math.round((new Date(row.punchOut).getTime() - new Date(row.punchIn).getTime()) / 60000));
                      hours = `${Math.round((mins / 60) * 100) / 100}`;
                    }
                    return (
                      <tr key={row.id}>
                        <Td>{formatDate(row.workDate)}</Td>
                        <Td className="font-bold">{row.employee.name}</Td>
                        <Td><Badge>{ATT_LABELS[row.status] || row.status}</Badge></Td>
                        <Td className="font-mono text-xs" dir="ltr">{inT}</Td>
                        <Td className="font-mono text-xs" dir="ltr">{outT}</Td>
                        <Td>{hours}</Td>
                        <Td>{row.lateMinutes} د</Td>
                        <Td>{row.permissionMinutes} د</Td>
                        <Td>{row.overtimeMinutes || 0} د</Td>
                        <Td className="no-print">
                          {can('hr', 'delete') && (
                            <Button size="sm" variant="danger" onClick={() => run(() => api(`/hr/attendance/${row.id}`, { method: 'DELETE' }), 'تم الحذف')}><Trash2 size={14} /></Button>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'leaves' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {can('hr', 'create') && (
            <Card className="no-print h-fit">
              <h3 className="mb-3 font-extrabold">إجازة جديدة</h3>
              <div className="space-y-3">
                <Field label="الموظف">
                  <Select value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}>
                    <option value="">اختر</option>
                    {employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </Field>
                <Field label="من"><Input type="date" value={leaveForm.fromDate} onChange={(e) => setLeaveForm({ ...leaveForm, fromDate: e.target.value })} /></Field>
                <Field label="إلى"><Input type="date" value={leaveForm.toDate} onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })} /></Field>
                <Field label="النوع">
                  <Select value={leaveForm.kind} onChange={(e) => setLeaveForm({ ...leaveForm, kind: e.target.value })}>
                    <option value="PAID">مدفوعة</option>
                    <option value="UNPAID">بدون راتب</option>
                  </Select>
                </Field>
                <Button disabled={busy || !leaveForm.employeeId} className="w-full" onClick={() => run(
                  () => api('/hr/leaves', { method: 'POST', body: JSON.stringify(leaveForm) }),
                  'تم تسجيل الإجازة',
                )}>حفظ</Button>
              </div>
            </Card>
          )}
          <Card>
            {!leaves.length ? <Empty text="لا إجازات" /> : (
              <Table>
                <thead><tr><Th>الموظف</Th><Th>من</Th><Th>إلى</Th><Th>النوع</Th><Th className="no-print"></Th></tr></thead>
                <tbody>
                  {leaves.map((row) => (
                    <tr key={row.id}>
                      <Td>{row.employee.name}</Td>
                      <Td>{formatDate(row.fromDate)}</Td>
                      <Td>{formatDate(row.toDate)}</Td>
                      <Td><Badge tone={row.kind === 'PAID' ? 'emerald' : 'amber'}>{row.kind === 'PAID' ? 'مدفوعة' : 'بدون راتب'}</Badge></Td>
                      <Td className="no-print">
                        {can('hr', 'delete') && (
                          <Button size="sm" variant="danger" onClick={() => run(() => api(`/hr/leaves/${row.id}`, { method: 'DELETE' }), 'تم الحذف')}><Trash2 size={14} /></Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'movements' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {can('hr', 'create') && (
            <Card className="no-print h-fit">
              <h3 className="mb-3 font-extrabold">حركة راتب</h3>
              <p className="mb-3 text-xs text-muted">السلفة تنقص الصافي ولا تخصم من الخزنة إلا ضمن ترحيل الكشف.</p>
              <div className="space-y-3">
                <Field label="الموظف">
                  <Select value={movForm.employeeId} onChange={(e) => setMovForm({ ...movForm, employeeId: e.target.value })}>
                    <option value="">اختر</option>
                    {employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </Select>
                </Field>
                <Field label="النوع">
                  <Select value={movForm.kind} onChange={(e) => setMovForm({ ...movForm, kind: e.target.value })}>
                    {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="المبلغ"><NumberInput value={movForm.amount} onValueChange={(v) => setMovForm({ ...movForm, amount: v })} /></Field>
                <Field label="التاريخ"><Input type="date" value={movForm.movementDate} onChange={(e) => setMovForm({ ...movForm, movementDate: e.target.value })} /></Field>
                <Field label="ملاحظات"><Input value={movForm.notes} onChange={(e) => setMovForm({ ...movForm, notes: e.target.value })} /></Field>
                <Button disabled={busy || !movForm.employeeId} className="w-full" onClick={() => run(
                  () => api('/hr/movements', { method: 'POST', body: JSON.stringify({ ...movForm, amount: Number(movForm.amount) || 0 }) }),
                  'تم تسجيل الحركة',
                )}>حفظ</Button>
              </div>
            </Card>
          )}
          <Card>
            {!movements.length ? <Empty text="لا حركات في الفترة" /> : (
              <Table>
                <thead><tr><Th>التاريخ</Th><Th>الموظف</Th><Th>النوع</Th>{showAmounts && <Th>المبلغ</Th>}<Th>التسوية</Th><Th className="no-print"></Th></tr></thead>
                <tbody>
                  {movements.map((row) => (
                    <tr key={row.id}>
                      <Td>{formatDate(row.movementDate)}</Td>
                      <Td>{row.employee.name}</Td>
                      <Td>{MOVEMENT_LABELS[row.kind] || row.kind}</Td>
                      {showAmounts && <Td>{formatMoney(row.amount)}</Td>}
                      <Td><Badge tone={row.payrollRunId ? 'emerald' : 'amber'}>{row.payrollRunId ? 'ضمن كشف' : 'مفتوحة'}</Badge></Td>
                      <Td className="no-print">
                        {can('hr', 'delete') && !row.payrollRunId && (
                          <Button size="sm" variant="danger" onClick={() => run(() => api(`/hr/movements/${row.id}`, { method: 'DELETE' }), 'تم الحذف')}><Trash2 size={14} /></Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'payroll' && (
        <div className="space-y-4">
          <Card className="border-sky-200 bg-sky-50/40">
            <h3 className="font-extrabold text-sky-950">حساب المرتب التلقائي</h3>
            <p className="mt-1 text-sm text-sky-900">
              المرتب يتحسب من: أيام الحضور + ساعات العمل + الإضافي − الغياب − الإجازات غير المدفوعة − التأخير − الإذن − السلف − الخصم + المكافآت.
              سجّل الحضور والإجازات والحركات ثم اضغط «احسب المرتب تلقائي».
            </p>
          </Card>
          {calcPreview && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-extrabold text-slate-900">معاينة الحساب</h3>
                  <p className="text-xs text-muted">{calcPreview.formula}</p>
                </div>
                {showAmounts && <div className="text-lg font-black text-brand-800">الإجمالي: {formatMoney(calcPreview.totalNet)}</div>}
              </div>
              <PayrollTable lines={calcPreview.lines} showSalary={showSalary} showAmounts={showAmounts} detailed />
            </Card>
          )}
          <Card>
            <h3 className="mb-3 font-extrabold">الكشوف المحفوظة</h3>
            {!runs.length ? <Empty text="لا كشوف بعد — احسب ثم احفظ مسودة" /> : (
              <div className="space-y-4">
                {runs.map((runRow) => (
                  <div key={runRow.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-black text-brand-800" dir="ltr">{runRow.number}</span>
                        <Badge tone={runRow.status === 'POSTED' ? 'emerald' : 'amber'}>{runRow.status === 'POSTED' ? 'مرحّل' : 'مسودة'}</Badge>
                        <span className="text-sm text-muted">{formatDate(runRow.fromDate)} ← {formatDate(runRow.toDate)}</span>
                        {showAmounts && <span className="font-extrabold">{formatMoney(runRow.totalNet)}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 no-print">
                        <Button size="sm" variant="secondary" onClick={() => doPrint(runRow)}><Printer size={14} /> طباعة</Button>
                        {runRow.status === 'DRAFT' && can('hr', 'delete') && (
                          <Button size="sm" variant="danger" onClick={() => deleteRun(runRow)}><Trash2 size={14} /></Button>
                        )}
                      </div>
                    </div>
                    <PayrollTable lines={runRow.lines} showSalary={showSalary} showAmounts={showAmounts} detailed />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'approval' && (
        <div className="space-y-4">
          <Card className="border-emerald-200 bg-emerald-50/50">
            <h3 className="font-extrabold text-emerald-950">اعتماد وصرف المرتبات</h3>
            <p className="mt-1 text-sm text-emerald-900">
              راجع حساب كل موظف · اطبع تقرير فردي أو كشف الاعتماد بتوقيع المسؤول · ثم اعتمد وصرف من الخزنة.
            </p>
          </Card>
          {calcPreview && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold">معاينة قبل الحفظ</h3>
                {can('hr', 'create') && <Button disabled={busy} onClick={saveDraft}>حفظ مسودة للاعتماد</Button>}
              </div>
              <PayrollTable lines={calcPreview.lines} showSalary={showSalary} showAmounts={showAmounts} detailed />
            </Card>
          )}
          {!runs.length ? <Card><Empty text="لا مسودات للاعتماد" hint="من تبويب كشوف المرتبات: احسب ثم احفظ مسودة" /></Card> : (
            runs.map((runRow) => (
              <Card key={runRow.id} className={runRow.status === 'DRAFT' ? 'border-amber-300' : 'border-emerald-200'}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-black text-brand-800" dir="ltr">{runRow.number}</span>
                      <Badge tone={runRow.status === 'POSTED' ? 'emerald' : 'amber'}>{runRow.status === 'POSTED' ? 'معتمد ومصروف' : 'بانتظار الاعتماد'}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted">{formatDate(runRow.fromDate)} ← {formatDate(runRow.toDate)}</div>
                    {showAmounts && <div className="mt-1 text-xl font-black text-brand-900">إجمالي الصرف: {formatMoney(runRow.totalNet)}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2 no-print">
                    <Button variant="secondary" onClick={() => printApproval(runRow)}>
                      <Printer size={14} /> طباعة الاعتماد + توقيع
                    </Button>
                    {runRow.status === 'DRAFT' && can('hr', 'post') && (
                      <Button disabled={busy} onClick={() => postRun(runRow)}>اعتماد وصرف المرتبات</Button>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {runRow.lines.map((line, i) => (
                    <div key={line.id || `${line.employeeId}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-extrabold text-slate-900">{lineName(line)}</div>
                          <div className="text-xs font-mono text-muted" dir="ltr">{lineCode(line)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {showAmounts && <div className="text-lg font-black text-emerald-800">{formatMoney(line.net)}</div>}
                          <Button size="sm" variant="secondary" className="no-print" onClick={() => printEmployeeReport(runRow, line)}>
                            <Printer size={13} /> تقرير الموظف
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">حضور: <b>{line.presentDays}</b> يوم</div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">إجازة: <b>{line.paidLeaveDays}</b> · غياب: <b>{line.absentDays}</b></div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">إضافي: <b>{line.overtimeHours ?? 0}</b> س · {showAmounts ? formatMoney(line.overtimePay || 0) : '—'}</div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">إذن: <b>{line.permissionDays}</b> يوم</div>
                        {showAmounts && (
                          <>
                            <div className="rounded-lg bg-emerald-50 px-3 py-2">مستحق: <b>{formatMoney(line.earned)}</b></div>
                            <div className="rounded-lg bg-sky-50 px-3 py-2">مكافآت: <b>{formatMoney(line.bonuses)}</b></div>
                            <div className="rounded-lg bg-rose-50 px-3 py-2">سلف: <b>{formatMoney(line.advances)}</b> · خصم: <b>{formatMoney(line.deductions)}</b></div>
                            <div className="rounded-lg bg-amber-50 px-3 py-2">تأخير/إذن: <b>{formatMoney((line.latePenalty || 0) + (line.permissionDeduct || 0))}</b></div>
                            <div className="rounded-lg bg-brand-50 px-3 py-2 sm:col-span-2">صافي الراتب: <b>{formatMoney(line.salaryNet)}</b> · عمولة: <b>{formatMoney(line.commissionDue)}</b></div>
                            <div className="rounded-lg bg-brand-900 px-3 py-2 text-white sm:col-span-2">الصافي للصرف: <b>{formatMoney(line.net)}</b></div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'commissions' && (
        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold">تقرير العمولات</h3>
                <p className="text-xs text-muted">الصرف فقط عبر ترحيل المرتبات — لا يوجد صرف منفصل</p>
              </div>
            </div>
            {!commissions.length ? <Empty text="لا بيانات" /> : (
              <Table>
                <thead>
                  <tr>
                    <Th>الكود</Th><Th>الاسم</Th><Th>%</Th>
                    {showAmounts && <><Th>مبيعات</Th><Th>مستحق</Th><Th>مدفوع</Th><Th>متبقي</Th></>}
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((row) => (
                    <tr key={row.employeeId}>
                      <Td className="font-mono text-xs"><span dir="ltr">{row.code}</span></Td>
                      <Td className="font-bold">{row.name}</Td>
                      <Td>{row.commissionPercent}%</Td>
                      {showAmounts && (
                        <>
                          <Td>{formatMoney(row.salesTotal)}</Td>
                          <Td>{formatMoney(row.commissionEarned)}</Td>
                          <Td>{formatMoney(row.commissionPaid)}</Td>
                          <Td className="font-extrabold text-brand-800">{formatMoney(row.commissionRemaining)}</Td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 font-extrabold">مبيعات الموظفين (حسب منشئ الفاتورة)</h3>
            {!empSales.length ? <Empty text="لا مبيعات في الفترة" /> : (
              <Table>
                <thead><tr><Th>الاسم</Th><Th>الكود</Th>{showAmounts && <Th>المبيعات</Th>}<Th>مصدر الاسم</Th></tr></thead>
                <tbody>
                  {empSales.map((row, i) => (
                    <tr key={`${row.code}-${i}`}>
                      <Td className="font-bold">{row.name}</Td>
                      <Td className="font-mono text-xs"><span dir="ltr">{row.code}</span></Td>
                      {showAmounts && <Td>{formatMoney(row.salesTotal)}</Td>}
                      <Td><Badge tone={row.fromHr ? 'emerald' : 'slate'}>{row.fromHr ? 'موظف HR' : 'مستخدم النظام'}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'settings' && settingsForm && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 font-extrabold">إعدادات الحضور والراتب بالساعة</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="أيام الشهر"><NumberInput value={settingsForm.daysPerMonth} onValueChange={(v) => setSettingsForm({ ...settingsForm, daysPerMonth: Number(v) || 30 })} /></Field>
              <Field label="ساعات العمل / يوم"><NumberInput value={settingsForm.hoursPerDay ?? 8} onValueChange={(v) => setSettingsForm({ ...settingsForm, hoursPerDay: Number(v) || 8 })} /></Field>
              <Field label="مضاعف الإضافي (ساعة بساعتين = 2)"><NumberInput value={settingsForm.overtimeMultiplier ?? 2} onValueChange={(v) => setSettingsForm({ ...settingsForm, overtimeMultiplier: Number(v) || 2 })} /></Field>
              <Field label="مضاعف الغياب">
                <Select value={String(settingsForm.absenceMultiplier ?? 1)} onChange={(e) => setSettingsForm({ ...settingsForm, absenceMultiplier: Number(e.target.value) })}>
                  <option value="1">يوم بيوم</option>
                  <option value="2">يوم بيومين</option>
                </Select>
              </Field>
              <Field label="الإجازة غير المدفوعة">
                <Select value={settingsForm.unpaidLeaveDeduct === false ? '0' : '1'} onChange={(e) => setSettingsForm({ ...settingsForm, unpaidLeaveDeduct: e.target.value === '1' })}>
                  <option value="1">خصم يوم بيوم</option>
                  <option value="0">بدون خصم</option>
                </Select>
              </Field>
              <Field label="التأخير">
                <Select value={settingsForm.lateByHourlyRate === false ? '0' : '1'} onChange={(e) => setSettingsForm({ ...settingsForm, lateByHourlyRate: e.target.value === '1' })}>
                  <option value="1">تجميع الشهر × سعر الساعة</option>
                  <option value="0">غرامة ثابتة / دقيقة</option>
                </Select>
              </Field>
              <Field label="سماح التأخير (دقيقة)"><NumberInput value={settingsForm.lateGraceMinutes} onValueChange={(v) => setSettingsForm({ ...settingsForm, lateGraceMinutes: Number(v) || 0 })} /></Field>
              <Field label="غرامة التأخير / دقيقة (إن لم يُحسب بالساعة)"><NumberInput value={settingsForm.latePenaltyPerMinute} onValueChange={(v) => setSettingsForm({ ...settingsForm, latePenaltyPerMinute: Number(v) || 0 })} /></Field>
              <Field label="خصم الإذن / ساعة"><NumberInput value={settingsForm.permissionDeductPerHour} onValueChange={(v) => setSettingsForm({ ...settingsForm, permissionDeductPerHour: Number(v) || 0 })} /></Field>
              <Field label="ساعة بدء العمل"><NumberInput value={settingsForm.workStartHour} onValueChange={(v) => setSettingsForm({ ...settingsForm, workStartHour: Number(v) || 0 })} /></Field>
            </div>
            <p className="mt-3 text-xs text-muted">سعر الساعة = الراتب ÷ (أيام الشهر × ساعات اليوم). التأخير يتجمّع على الشهر ويُخصم بسعر الساعة.</p>
            {can('hr', 'edit') && (
              <Button className="mt-4" disabled={busy} onClick={() => run(
                () => api('/hr/settings', { method: 'PATCH', body: JSON.stringify(settingsForm) }),
                'تم حفظ الإعدادات',
              )}>حفظ الإعدادات</Button>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 font-extrabold">إجازات رسمية</h3>
            {can('hr', 'create') && (
              <div className="mb-4 flex flex-wrap gap-2 no-print">
                <Input type="date" value={holidayForm.date} onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })} />
                <Input placeholder="اسم الإجازة" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} />
                <Button disabled={busy || !holidayForm.name.trim()} onClick={() => run(
                  () => api('/hr/holidays', { method: 'POST', body: JSON.stringify(holidayForm) }),
                  'تمت الإضافة',
                ).then((ok) => { if (ok) setHolidayForm({ date: todayIso(), name: '' }); })}>إضافة</Button>
              </div>
            )}
            {!holidays.length ? <Empty text="لا إجازات رسمية" /> : (
              <Table>
                <thead><tr><Th>التاريخ</Th><Th>الاسم</Th><Th className="no-print"></Th></tr></thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id}>
                      <Td>{formatDate(h.date)}</Td>
                      <Td>{h.name}</Td>
                      <Td className="no-print">
                        {can('hr', 'delete') && (
                          <Button size="sm" variant="danger" onClick={() => run(() => api(`/hr/holidays/${h.id}`, { method: 'DELETE' }), 'تم الحذف')}><Trash2 size={14} /></Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {settings && (
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                الصيغة: الصافي = (مستحق الراتب + مكافآت − خصومات − سلف − تأخير − إذن) + عمولة المبيعات المستحقة.
                مستحق الراتب = اليومية × (حضور + إجازة مدفوعة + إذن). يوم عمل بلا حضور = غياب. الإذن ليس غياباً.
              </p>
            )}
          </Card>
        </div>
      )}

      <Modal open={empOpen} onClose={() => setEmpOpen(false)} title={editingId ? 'تعديل موظف' : 'موظف جديد'} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الكود (اختياري)"><Input value={empForm.code} onChange={(e) => setEmpForm({ ...empForm, code: e.target.value })} placeholder="اختياري" /></Field>
          <Field label="الاسم"><Input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} /></Field>
          <Field label="ربط مستخدم (للمبيعات/العمولة)">
            <Select value={empForm.userId} onChange={(e) => setEmpForm({ ...empForm, userId: e.target.value })}>
              <option value="">بدون ربط</option>
              {users.filter((u) => !u.linked || u.id === empForm.userId).map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
              ))}
            </Select>
          </Field>
          <Field label="الهاتف"><Input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} /></Field>
          {showSalary && (
            <Field label="الراتب الشهري"><NumberInput value={empForm.salary} onValueChange={(v) => setEmpForm({ ...empForm, salary: v })} /></Field>
          )}
          <Field label="نسبة العمولة %"><NumberInput value={empForm.commissionPercent} onValueChange={(v) => setEmpForm({ ...empForm, commissionPercent: v })} /></Field>
          <Field label="تاريخ التعيين"><Input type="date" value={empForm.hireDate} onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })} /></Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={empForm.isActive} onChange={(e) => setEmpForm({ ...empForm, isActive: e.target.checked })} />
              نشط
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEmpOpen(false)}>إلغاء</Button>
          <Button disabled={busy || !empForm.name.trim()} onClick={saveEmployee}>حفظ</Button>
        </div>
      </Modal>

      {printRun && (
        <div className="print-only fixed inset-0 z-50 bg-white p-6 text-black">
          <PrintHeader title={`كشف مرتبات ${printRun.number}`} subtitle={`${formatDate(printRun.fromDate)} ← ${formatDate(printRun.toDate)} · ${printRun.status === 'POSTED' ? 'مرحّل' : 'مسودة'}`} />
          <p className="mb-3 text-sm text-slate-600">الصافي = (مستحق الراتب + مكافآت − خصومات − سلف − تأخير − إذن + إضافي) + عمولة</p>
          <PayrollTable lines={printRun.lines} showSalary showAmounts detailed />
          <div className="mt-4 text-left text-lg font-black">الإجمالي: {formatMoney(printRun.totalNet)}</div>
        </div>
      )}

      {printEmployeeLine && (
        <div className="print-only fixed inset-0 z-50 bg-white p-6 text-black">
          <PrintHeader
            title={`تقرير راتب — ${lineName(printEmployeeLine.line)}`}
            subtitle={`${printEmployeeLine.run.number} · ${formatDate(printEmployeeLine.run.fromDate)} ← ${formatDate(printEmployeeLine.run.toDate)}`}
          />
          <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>الكود: <b dir="ltr">{lineCode(printEmployeeLine.line)}</b></div>
            <div>الراتب الأساسي: <b>{formatMoney(printEmployeeLine.line.salary || 0)}</b></div>
            <div>أيام الحضور: <b>{printEmployeeLine.line.presentDays}</b></div>
            <div>أيام الإجازة المدفوعة: <b>{printEmployeeLine.line.paidLeaveDays}</b></div>
            <div>أيام الغياب: <b>{printEmployeeLine.line.absentDays}</b></div>
            <div>أيام الإذن: <b>{printEmployeeLine.line.permissionDays}</b></div>
            <div>ساعات الإضافي: <b>{printEmployeeLine.line.overtimeHours ?? 0}</b> · قيمة: <b>{formatMoney(printEmployeeLine.line.overtimePay || 0)}</b></div>
            <div>مستحق الفترة: <b>{formatMoney(printEmployeeLine.line.earned)}</b></div>
            <div>مكافآت: <b>{formatMoney(printEmployeeLine.line.bonuses)}</b></div>
            <div>سلف: <b>{formatMoney(printEmployeeLine.line.advances)}</b></div>
            <div>خصومات: <b>{formatMoney(printEmployeeLine.line.deductions)}</b></div>
            <div>تأخير + إذن: <b>{formatMoney((printEmployeeLine.line.latePenalty || 0) + (printEmployeeLine.line.permissionDeduct || 0))}</b></div>
            <div>صافي الراتب: <b>{formatMoney(printEmployeeLine.line.salaryNet)}</b></div>
            <div>عمولة: <b>{formatMoney(printEmployeeLine.line.commissionDue)}</b></div>
          </div>
          <div className="rounded-xl border-2 border-black px-4 py-3 text-xl font-black">
            الصافي للصرف: {formatMoney(printEmployeeLine.line.net)}
          </div>
          <div className="mt-16 grid grid-cols-2 gap-10 text-sm">
            <div className="text-center">
              <div className="mb-16 border-b border-black" />
              <div className="font-bold">توقيع الموظف</div>
            </div>
            <div className="text-center">
              <div className="mb-16 border-b border-black" />
              <div className="font-bold">توقيع المسؤول للصرف</div>
            </div>
          </div>
        </div>
      )}

      {approvePrint && (
        <div className="print-only fixed inset-0 z-50 bg-white p-6 text-black">
          <PrintHeader
            title={`اعتماد صرف مرتبات — ${approvePrint.number}`}
            subtitle={`${formatDate(approvePrint.fromDate)} ← ${formatDate(approvePrint.toDate)}`}
          />
          <p className="mb-3 text-sm">كشف اعتماد المرتبات للمراجعة والتوقيع قبل الصرف</p>
          <PayrollTable lines={approvePrint.lines} showSalary showAmounts detailed />
          <div className="mt-3 text-left text-lg font-black">إجمالي الاعتماد: {formatMoney(approvePrint.totalNet)}</div>
          <div className="mt-14 grid grid-cols-3 gap-8 text-sm">
            <div className="text-center">
              <div className="mb-16 border-b border-black" />
              <div className="font-bold">إعداد الموارد البشرية</div>
            </div>
            <div className="text-center">
              <div className="mb-16 border-b border-black" />
              <div className="font-bold">مراجعة الحسابات</div>
            </div>
            <div className="text-center">
              <div className="mb-16 border-b border-black" />
              <div className="font-bold">اعتماد المسؤول للصرف</div>
            </div>
          </div>
          <p className="mt-8 text-xs text-slate-600">تم اعتماد صرف المرتبات المذكورة أعلاه بتاريخ ................ / ................ / ................</p>
        </div>
      )}
    </div>
  );
}

function PayrollTable({
  lines,
  showSalary,
  showAmounts,
  detailed = false,
}: {
  lines: PayrollLine[];
  showSalary: boolean;
  showAmounts: boolean;
  detailed?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>الكود</Th>
            <Th>الموظف</Th>
            <Th>حضور</Th>
            <Th>إجازة</Th>
            <Th>إذن</Th>
            <Th>غياب</Th>
            {detailed && <Th>إضافي (س)</Th>}
            {showSalary && <Th>يومية</Th>}
            {showAmounts && (
              <>
                {detailed && (
                  <>
                    <Th>مستحق</Th>
                    <Th>إضافي</Th>
                    <Th>مكافآت</Th>
                    <Th>سلف</Th>
                    <Th>خصم</Th>
                  </>
                )}
                {!detailed && <Th>مستحق</Th>}
                <Th>صافي راتب</Th>
                <Th>عمولة</Th>
                <Th>الصافي</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.id || `${line.employeeId}-${i}`}>
              <Td className="font-mono text-xs"><span dir="ltr">{lineCode(line)}</span></Td>
              <Td className="font-bold">{lineName(line)}</Td>
              <Td>{line.presentDays}</Td>
              <Td>{line.paidLeaveDays}</Td>
              <Td>{line.permissionDays}</Td>
              <Td>{line.absentDays}</Td>
              {detailed && <Td>{line.overtimeHours ?? 0}</Td>}
              {showSalary && <Td>{formatMoney(line.daily)}</Td>}
              {showAmounts && (
                <>
                  {detailed && (
                    <>
                      <Td>{formatMoney(line.earned)}</Td>
                      <Td>{formatMoney(line.overtimePay || 0)}</Td>
                      <Td>{formatMoney(line.bonuses)}</Td>
                      <Td>{formatMoney(line.advances)}</Td>
                      <Td>{formatMoney(line.deductions + line.latePenalty + line.permissionDeduct)}</Td>
                    </>
                  )}
                  {!detailed && <Td>{formatMoney(line.earned)}</Td>}
                  <Td>{formatMoney(line.salaryNet)}</Td>
                  <Td>{formatMoney(line.commissionDue)}</Td>
                  <Td className="font-extrabold text-brand-800">{formatMoney(line.net)}</Td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
