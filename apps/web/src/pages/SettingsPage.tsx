import { useEffect, useMemo, useState } from 'react';
import { Building2, DatabaseBackup, FileArchive, Lock, Pencil, Save, Server, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { PAGES, accessFromPages, normalizeAccess, parseAccess, type AccessMap, type PageId } from '@m5azen/shared';
import { api, formatRelative, getApiBase, setApiBase, setSettingsToken } from '../lib/api';
import { ROLE_LABELS } from '../lib/nav';
import { useAuth } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { ScreenPermissionsPicker } from '../components/UserAccess';
import { Badge, Button, Card, CardHeader, Empty, Input, Label, PageHeader, Table, Td, Th, type Tone } from '../components/ui';

const ROLE_TONE: Record<string, Tone> = { ADMIN: 'brand', ACCOUNTANT: 'violet', WAREHOUSE: 'amber', SALES: 'emerald' };

type PeriodRow = { year: number; month: number; label: string; closed: boolean; closedAt: string | null; closedBy: string };
type PeriodLog = { id: string; label: string; action: 'CLOSE' | 'REOPEN'; reason: string; userName: string; createdAt: string };
type SettingsUser = {
  id: string;
  username: string;
  fullName: string;
  jobTitle?: string | null;
  role: string;
  isActive: boolean;
  loginLocked?: boolean;
  failedLoginCount?: number;
  online?: boolean;
  lastSeenAt?: string | null;
  lastLoginAt?: string | null;
  lastAppearanceAt?: string | null;
  permissions: string | null;
};

function pageIdsFromPermissions(permissions: string | null, role: string): PageId[] {
  const access = permissions ? normalizeAccess(JSON.parse(permissions), role) : parseAccess(null, role);
  return PAGES.filter((page) => access[page.id]?.view).map((page) => page.id);
}

function pageLabels(permissions: string | null, role: string): string {
  const ids = pageIdsFromPermissions(permissions, role);
  if (role === 'ADMIN' && (!permissions || ids.length === PAGES.length)) return 'كل الشاشات';
  if (!ids.length) return 'بدون صلاحيات';
  if (ids.length <= 3) return ids.map((id) => PAGES.find((page) => page.id === id)?.label || id).join(' · ');
  return `${ids.length} شاشة`;
}

export function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'ADMIN';
  const [companyName, setCompanyName] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [commercialRegister, setCommercialRegister] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [users, setUsers] = useState<SettingsUser[]>([]);
  const [userForm, setUserForm] = useState({ username: '', password: '', fullName: '', jobTitle: '', pages: [] as PageId[] });
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ username: '', fullName: '', jobTitle: '', password: '', pages: [] as PageId[], isActive: true });
  const [backups, setBackups] = useState<string[]>([]);
  const [editingLook, setEditingLook] = useState(false);
  const [busy, setBusy] = useState<'' | 'settings' | 'backup' | 'user' | 'period'>('');
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [periodLog, setPeriodLog] = useState<PeriodLog[]>([]);
  const [reopenKey, setReopenKey] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const editingUser = useMemo(() => users.find((row) => row.id === editUserId) || null, [users, editUserId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ token: string }>('/settings/unlock', { method: 'POST', body: '{}' });
        if (!cancelled) setSettingsToken(res.token || 'open');
      } catch {
        if (!cancelled) setSettingsToken('open');
      }
      if (cancelled) return;
      api<Record<string, string>>('/settings').then((s) => {
        setCompanyName(s.companyName || '');
        setTaxNumber(s.taxNumber || '');
        setCommercialRegister(s.commercialRegister || '');
        setCompanyAddress(s.companyAddress || '');
      }).catch(() => undefined);
      if (isAdmin) {
        api<SettingsUser[]>('/users').then(setUsers).catch(() => setUsers([]));
        api<{ periods: PeriodRow[]; log: PeriodLog[] }>('/settings/periods').then((res) => {
          setPeriods(res.periods);
          setPeriodLog(res.log);
        }).catch(() => undefined);
      }
      api<string[]>('/settings/backups').then(setBackups).catch(() => setBackups([]));
    })();
    return () => { cancelled = true; };
  }, [user?.role, isAdmin]);

  // تحديث حالة الاتصال كل 20 ثانية أثناء فتح الإعدادات
  useEffect(() => {
    if (!isAdmin) return;
    const refresh = () => {
      api<SettingsUser[]>('/users').then(setUsers).catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(timer);
  }, [isAdmin]);

  async function closePeriod(row: PeriodRow) {
    const ok = await confirm({
      title: `قفل ${row.label}`,
      message: 'فواتير ومصروفات ومخزون الشهر ده هتقف لحد ما يتفتح تاني بسبب.',
      confirmLabel: 'قفل الشهر',
      danger: true,
    });
    if (!ok) return;
    setBusy('period');
    try {
      const res = await api<{ periods: PeriodRow[]; log: PeriodLog[] }>('/settings/periods/close', {
        method: 'POST',
        body: JSON.stringify({ year: row.year, month: row.month }),
      });
      setPeriods(res.periods);
      setPeriodLog(res.log);
      toast.success(`تم قفل ${row.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر قفل الشهر');
    } finally {
      setBusy('');
    }
  }

  async function reopenPeriod(row: PeriodRow) {
    if (reopenReason.trim().length < 3) {
      toast.error('اكتب سبب فتح الشهر');
      return;
    }
    setBusy('period');
    try {
      const res = await api<{ periods: PeriodRow[]; log: PeriodLog[] }>('/settings/periods/reopen', {
        method: 'POST',
        body: JSON.stringify({ year: row.year, month: row.month, reason: reopenReason.trim() }),
      });
      setPeriods(res.periods);
      setPeriodLog(res.log);
      setReopenKey('');
      setReopenReason('');
      toast.success(`تم فتح ${row.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر فتح الشهر');
    } finally {
      setBusy('');
    }
  }

  async function saveSettings() {
    setApiBase(apiUrl);
    if (!isAdmin) {
      toast.success('تم حفظ عنوان السيرفر على هذا الجهاز');
      return;
    }
    setBusy('settings');
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({ data: { companyName, apiUrl, taxNumber, commercialRegister, companyAddress } }),
      });
      toast.success('تم حفظ الإعدادات');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ الإعدادات');
    } finally {
      setBusy('');
    }
  }

  async function backup() {
    setBusy('backup');
    try {
      const res = await api<{ ok: boolean; fileName?: string; snapshot?: unknown; message?: string }>('/settings/backup', { method: 'POST' });
      if (res.ok && res.snapshot && res.fileName) {
        const blob = new Blob([JSON.stringify(res.snapshot)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = res.fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        toast.success(`تم تنزيل النسخة: ${res.fileName}`);
        setBackups(await api<string[]>('/settings/backups'));
      } else {
        toast.error(res.message || 'فشل النسخ');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'فشل النسخ');
    } finally {
      setBusy('');
    }
  }

  async function addUser() {
    if (!userForm.username.trim() || !userForm.password || !userForm.fullName.trim()) {
      toast.error('أدخل اسم الدخول والاسم وكلمة السر');
      return;
    }
    if (!userForm.pages.length) {
      toast.error('اختَر شاشة واحدة على الأقل من الصلاحيات المسموحة');
      return;
    }
    setBusy('user');
    try {
      const permissions: AccessMap = accessFromPages(userForm.pages);
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: userForm.username.trim(),
          password: userForm.password,
          fullName: userForm.fullName.trim(),
          jobTitle: userForm.jobTitle.trim() || undefined,
          role: 'SALES',
          permissions,
        }),
      });
      setUserForm({ username: '', password: '', fullName: '', jobTitle: '', pages: [] });
      setUsers(await api('/users'));
      toast.success('تمت إضافة المستخدم');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إضافة المستخدم');
    } finally {
      setBusy('');
    }
  }

  function openEditUser(row: SettingsUser) {
    setEditUserId(row.id);
    setEditForm({
      username: row.username,
      fullName: row.fullName,
      jobTitle: row.jobTitle || '',
      password: '',
      pages: pageIdsFromPermissions(row.permissions, row.role),
      isActive: row.isActive,
    });
  }

  async function saveEditUser() {
    if (!editingUser) return;
    if (!editForm.username.trim()) {
      toast.error('اسم الدخول مطلوب');
      return;
    }
    if (!editForm.fullName.trim()) {
      toast.error('الاسم مطلوب');
      return;
    }
    if (editForm.password.trim() && editForm.password.trim().length < 4) {
      toast.error('كلمة السر الجديدة لازم تكون 4 حروف على الأقل');
      return;
    }
    if (editingUser.role !== 'ADMIN' && !editForm.pages.length) {
      toast.error('اختَر شاشة واحدة على الأقل من الصلاحيات المسموحة');
      return;
    }
    setBusy('user');
    try {
      const body: Record<string, unknown> = {
        username: editForm.username.trim(),
        fullName: editForm.fullName.trim(),
        jobTitle: editForm.jobTitle.trim(),
        isActive: editForm.isActive,
      };
      if (editForm.password.trim()) body.password = editForm.password.trim();
      if (editingUser.role !== 'ADMIN') body.permissions = accessFromPages(editForm.pages);
      await api(`/users/${editingUser.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setUsers(await api('/users'));
      setEditUserId(null);
      toast.success(editForm.password.trim() ? 'تم حفظ البيانات وتغيير كلمة السر' : 'تم حفظ بيانات المستخدم');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ المستخدم');
    } finally {
      setBusy('');
    }
  }

  async function unlockUserLogin(row: SettingsUser) {
    const ok = await confirm({
      title: 'فك قفل الدخول',
      message: `هتفتح محاولات الدخول لحساب «${row.fullName}» وتصفّر المحاولات الفاشلة.`,
      confirmLabel: 'فك القفل',
    });
    if (!ok) return;
    setBusy('user');
    try {
      await api(`/users/${row.id}`, { method: 'PATCH', body: JSON.stringify({ unlockLogin: true }) });
      setUsers(await api('/users'));
      toast.success('تم فك قفل الدخول');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر فك القفل');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      {!editingLook && <PageHeader title="الإعدادات" subtitle="إعدادات واجهة النظام والمظهر العام، وبيانات الشركة والنسخ الاحتياطي" />}
      <AppearanceSettings onEditing={setEditingLook} />
      {editingLook ? null : (<>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="بيانات الشركة" subtitle="تظهر في رأس الفواتير والتقارير المطبوعة" icon={Building2} />
          <div className="space-y-3">
            <div>
              <Label>اسم الشركة</Label>
              <Input value={companyName} readOnly={!isAdmin} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>الرقم الضريبي</Label>
                <Input value={taxNumber} readOnly={!isAdmin} onChange={(e) => setTaxNumber(e.target.value)} dir="ltr" />
              </div>
              <div>
                <Label>السجل التجاري</Label>
                <Input value={commercialRegister} readOnly={!isAdmin} onChange={(e) => setCommercialRegister(e.target.value)} dir="ltr" />
              </div>
            </div>
            <div>
              <Label>عنوان الفاتورة</Label>
              <Input value={companyAddress} readOnly={!isAdmin} onChange={(e) => setCompanyAddress(e.target.value)} />
            </div>
            <div className="rounded-xl border border-dashed border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-slate-700"><Server size={15} className="text-brand-600" /> عنوان الـ API المحلي</div>
              <Input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="اتركه فارغاً لاستخدام نفس السيرفر"
                dir="ltr"
              />
              <p className="mt-1.5 text-xs text-muted">
                اتركه فارغاً عند الفتح من رابط البرنامج. للديسكتوب فقط: ضع IP جهاز السيرفر
              </p>
            </div>
            <Button onClick={saveSettings} disabled={busy === 'settings'}><Save size={16} /> {isAdmin ? 'حفظ الإعدادات' : 'حفظ عنوان السيرفر'}</Button>
          </div>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader title="النسخ الاحتياطي" subtitle="تنزيل ملف JSON بكل البيانات، أو استرجاعه بعد التأكيد" icon={DatabaseBackup} />
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-gradient-to-l from-amber-50 to-white p-4 ring-1 ring-amber-100">
              <div className="text-sm">
                <div className="font-bold text-slate-800">{backups.length} نسخة محفوظة</div>
                <div className="text-xs text-muted">{backups[0] ? `آخر نسخة: ${backups[0]}` : 'لم يتم إنشاء نسخ بعد'}</div>
              </div>
              <div className="flex gap-2">
              <Button onClick={backup} disabled={busy === 'backup'}><DatabaseBackup size={16} /> تنزيل نسخة</Button>
              <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                استرجاع
                <input type="file" accept="application/json,.json" className="hidden" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  const ok = await confirm({ title: 'استرجاع النسخة', message: 'الاسترجاع يستبدل البيانات الحالية بالنسخة المختارة.', confirmLabel: 'استرجاع', danger: true });
                  if (!ok) return;
                  setBusy('backup');
                  try {
                    await api('/settings/restore', { method: 'POST', body: await file.text() });
                    toast.success('تم استرجاع النسخة');
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'تعذر الاسترجاع');
                  } finally {
                    setBusy('');
                  }
                }} />
              </label>
            </div>
            </div>
            {backups.length === 0 ? <Empty text="لا توجد نسخ بعد" /> : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {backups.map((b) => (
                  <li key={b} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                    <FileArchive size={15} className="shrink-0 text-amber-600" />
                    <span className="truncate font-mono text-xs text-slate-600" dir="ltr">{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {isAdmin && (
        <Card className="mt-4">
          <CardHeader title="الفترات المحاسبية" subtitle="قفل شهر بيمنع تعديل مستنداته. الفتح يتسجل بالسبب" icon={Lock} />
          {periods.length === 0 ? <Empty text="لا توجد فترات" /> : (
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {periods.map((row) => {
                const key = `${row.year}-${row.month}`;
                return (
                  <li key={key} className="rounded-xl border border-slate-100 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-800">{row.label}</div>
                        <div className="text-xs text-slate-500">
                          {row.closed ? `مقفول${row.closedBy ? ` بواسطة ${row.closedBy}` : ''}` : 'مفتوح'}
                        </div>
                      </div>
                      {row.closed ? (
                        <Button type="button" variant="secondary" disabled={busy === 'period'} onClick={() => { setReopenKey(key); setReopenReason(''); }}>فتح</Button>
                      ) : (
                        <Button type="button" variant="danger" disabled={busy === 'period'} onClick={() => closePeriod(row)}>قفل</Button>
                      )}
                    </div>
                    {row.closed && reopenKey === key && (
                      <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); reopenPeriod(row); }}>
                        <div className="min-w-56 flex-1">
                          <Label>سبب الفتح</Label>
                          <Input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
                        </div>
                        <Button type="submit" disabled={busy === 'period'}>تأكيد الفتح</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {periodLog.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-bold text-slate-700">سجل القفل والفتح</div>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
                {periodLog.map((row) => (
                  <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">
                    <span className="font-bold text-slate-800">{row.action === 'CLOSE' ? 'قفل' : 'فتح'} {row.label}</span>
                    {' — '}{row.userName}
                    {row.reason ? ` — ${row.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {isAdmin && (
        <Card className="mt-4">
          <CardHeader title="المستخدمين والصلاحيات" subtitle={`${users.length} مستخدم`} icon={Users} />
          <form
            className="mb-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
            onSubmit={(e) => { e.preventDefault(); addUser(); }}
          >
            <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-slate-700">
              <UserPlus size={15} className="text-brand-600" /> مستخدم جديد
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>اسم الدخول</Label>
                <Input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} dir="ltr" autoComplete="off" />
              </div>
              <div>
                <Label>الاسم</Label>
                <Input value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} />
              </div>
              <div>
                <Label>المسمى الوظيفي</Label>
                <Input
                  value={userForm.jobTitle}
                  onChange={(e) => setUserForm({ ...userForm, jobTitle: e.target.value })}
                  placeholder="مثال: أمين مخزن"
                />
              </div>
              <div>
                <Label>كلمة السر</Label>
                <Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" />
              </div>
            </div>
            <div className="mt-3">
              <ScreenPermissionsPicker
                value={userForm.pages}
                onChange={(pages) => setUserForm({ ...userForm, pages })}
              />
            </div>
            <Button type="submit" className="mt-3" disabled={busy === 'user'}>
              <UserPlus size={16} /> إنشاء المستخدم
            </Button>
          </form>

          {users.length === 0 ? <Empty text="لا يوجد مستخدمون" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>المستخدم</Th>
                  <Th>المسمى الوظيفي</Th>
                  <Th>اسم الدخول</Th>
                  <Th>الاتصال</Th>
                  <Th>الصلاحيات</Th>
                  <Th>الحالة</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-extrabold text-white">
                          {u.fullName.slice(0, 1)}
                          <span
                            className={`absolute -bottom-0.5 -start-0.5 h-3 w-3 rounded-full ring-2 ring-white ${u.online ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            title={u.online ? 'متصل' : 'غير متصل'}
                          />
                        </span>
                        <div>
                          <div className="font-bold text-slate-900">{u.fullName}</div>
                          {u.role === 'ADMIN' && (
                            <Badge tone={ROLE_TONE.ADMIN}>{ROLE_LABELS.ADMIN}</Badge>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td><span className="text-xs text-slate-600">{u.jobTitle || '—'}</span></Td>
                    <Td><span className="font-mono text-xs text-slate-600" dir="ltr">{u.username}</span></Td>
                    <Td>
                      {u.online ? (
                        <div>
                          <Badge tone="emerald">أونلاين</Badge>
                          <div className="mt-1 text-[11px] text-emerald-700">متصل الآن</div>
                        </div>
                      ) : (
                        <div>
                          <Badge tone="slate">أوفلاين</Badge>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {u.lastAppearanceAt
                              ? `آخر ظهور ${formatRelative(u.lastAppearanceAt)}`
                              : 'لم يسجّل دخول بعد'}
                          </div>
                        </div>
                      )}
                    </Td>
                    <Td><span className="text-xs text-slate-600">{pageLabels(u.permissions, u.role)}</span></Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={u.isActive ? 'emerald' : 'rose'}>{u.isActive ? 'نشط' : 'موقوف'}</Badge>
                        {u.loginLocked && <Badge tone="rose">دخول مقفول</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {u.loginLocked && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy === 'user'}
                            onClick={() => unlockUserLogin(u)}
                          >
                            <Lock size={14} /> فك القفل
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => (editUserId === u.id ? setEditUserId(null) : openEditUser(u))}
                        >
                          <Pencil size={14} /> تعديل
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {editingUser && (
            <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[13px] font-bold text-slate-800">تعديل المستخدم</div>
                <button type="button" className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => setEditUserId(null)}>
                  إغلاق
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label>اسم الدخول</Label>
                  <Input
                    value={editForm.username}
                    onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                    dir="ltr"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label>الاسم</Label>
                  <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
                </div>
                <div>
                  <Label>المسمى الوظيفي</Label>
                  <Input
                    value={editForm.jobTitle}
                    onChange={(e) => setEditForm({ ...editForm, jobTitle: e.target.value })}
                    placeholder="مثال: أمين مخزن"
                  />
                </div>
                <div>
                  <Label>كلمة السر الجديدة</Label>
                  <Input
                    type="password"
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    placeholder="اتركها فارغة لو مش هتتغير"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-brand-700)]"
                      checked={editForm.isActive}
                      onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                      disabled={editingUser.id === user?.id}
                    />
                    الحساب نشط
                  </label>
                </div>
              </div>
              {editingUser.loginLocked && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                  <span>الدخول مقفول بعد محاولات فاشلة. المدير لازم يفك القفل قبل ما الحساب يقدر يدخل تاني.</span>
                  <Button type="button" variant="secondary" disabled={busy === 'user'} onClick={() => unlockUserLogin(editingUser)}>
                    <Lock size={14} /> فك قفل الدخول
                  </Button>
                </div>
              )}
              {editingUser.role === 'ADMIN' ? (
                <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                  حساب المدير عنده صلاحية على كل الشاشات تلقائياً.
                </p>
              ) : (
                <div className="mt-3">
                  <ScreenPermissionsPicker
                    value={editForm.pages}
                    onChange={(pages) => setEditForm({ ...editForm, pages })}
                  />
                </div>
              )}
              <Button type="button" className="mt-3" disabled={busy === 'user'} onClick={saveEditUser}>
                <Save size={16} /> حفظ التعديلات
              </Button>
            </div>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            اختَر الشاشات المسموحة للمستخدم. أي شاشة مش متعلّمة هتبقى مقفولة. بعد الدخول هيفتح على أول شاشة مسموحة عنده (ولوحة التحكم لو كانت من ضمن صلاحياته). تقدر تعدّل الاسم واسم الدخول وكلمة السر والصلاحيات من زر تعديل.
          </p>
        </Card>
      )}
      </>)}
    </div>
  );
}
