import { useEffect, useState } from 'react';
import { Handshake, Plus, Trash2, Wallet } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useAccess } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import {
  Badge, Button, Card, Empty, Field, Input, Label, Modal, NumberInput, PageHeader, Select, StatCard, StatGrid, Table, Td, Th, todayIso,
} from '../components/ui';

type Partner = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  sharePercent: number;
  notes?: string | null;
  isActive: boolean;
  _count?: { withdrawals: number };
};

type PayMethod = { id: string; name: string; cashAccount?: { balance: number } | null };

type ProfitShare = {
  partnerId: string;
  code: string;
  name: string;
  phone?: string | null;
  sharePercent: number;
  profitShare: number;
  withdrawn: number;
  remaining: number;
  lifetimeProfitShare: number;
  lifetimeWithdrawn: number;
  lifetimeRemaining: number;
};

type ProfitSummary = {
  from: string | null;
  to: string | null;
  revenue: number;
  cogs?: number;
  purchases: number;
  expenses: number;
  grossProfit?: number;
  netProfit: number;
  distributableProfit?: number;
  lifetimeDistributable?: number;
  totalSharePercent: number;
  shares: ProfitShare[];
  totalWithdrawn: number;
  lifetimeTotalWithdrawn?: number;
  formula?: string;
};

type Withdrawal = {
  id: string;
  number: string;
  amount: number;
  withdrawnAt: string;
  notes?: string | null;
  partner: { id: string; code: string; name: string };
};

export function PartnersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAccess();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [to, setTo] = useState(todayIso());
  const [open, setOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [withdrawForm, setWithdrawForm] = useState({
    partnerId: '',
    methodId: '',
    amount: '' as number | '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    const params = new URLSearchParams({ from, to });
    const [p, m, profitRow, w] = await Promise.all([
      api<Partner[]>('/partners'),
      api<PayMethod[]>('/cash/methods'),
      api<ProfitSummary>(`/partners/profit?${params}`),
      api<Withdrawal[]>('/partners/withdrawals'),
    ]);
    setPartners(p);
    setMethods(m);
    setProfit(profitRow);
    setWithdrawals(w);
  }

  useEffect(() => {
    load().catch((e) => toast.error(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, [from, to]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', phone: '', notes: '' });
    setOpen(true);
  }

  function openEdit(row: Partner) {
    setEditing(row);
    setForm({
      name: row.name,
      phone: row.phone || '',
      notes: row.notes || '',
    });
    setOpen(true);
  }

  async function savePartner() {
    if (!form.name.trim()) return toast.error('أدخل اسم الشريك');
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        sharePercent: 0,
        notes: form.notes.trim() || undefined,
      };
      if (editing) await api(`/partners/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/partners', { method: 'POST', body: JSON.stringify(body) });
      toast.success(editing ? 'تم تعديل الشريك' : 'تمت إضافة الشريك');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function removePartner(row: Partner) {
    const ok = await confirm({
      title: 'حذف شريك',
      message: `حذف ${row.name} وكل سحوباته؟`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/partners/${row.id}`, { method: 'DELETE' });
      toast.success('تم الحذف');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  async function saveWithdraw() {
    if (!withdrawForm.partnerId) return toast.error('اختر الشريك');
    if (!withdrawForm.methodId) return toast.error('اختر طريقة الدفع');
    if (!(Number(withdrawForm.amount) > 0)) return toast.error('أدخل المبلغ');
    setBusy(true);
    try {
      await api('/partners/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          partnerId: withdrawForm.partnerId,
          methodId: withdrawForm.methodId,
          amount: Number(withdrawForm.amount),
          notes: withdrawForm.notes.trim() || undefined,
        }),
      });
      toast.success('تم تسجيل السحب وخصمه من الخزنة');
      setWithdrawOpen(false);
      setWithdrawForm({ partnerId: '', methodId: '', amount: '', notes: '' });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر السحب');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="الشركاء"
        subtitle="إدارة الشركاء والسحب من الخزنة / انستا باي / محفظة / بنك"
        actions={(
          <>
            {can('partners', 'withdraw') && (
              <Button variant="secondary" onClick={() => setWithdrawOpen(true)}><Wallet size={16} /> سحب شريك</Button>
            )}
            {can('partners', 'create') && (
              <Button onClick={openCreate}><Plus size={16} /> شريك جديد</Button>
            )}
          </>
        )}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="من"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      {profit && (
        <StatGrid>
          <StatCard label="الإيراد" value={formatMoney(profit.revenue)} hint="مبيعات بعد المرتجعات" icon={Handshake} tone="emerald" />
          <StatCard label="تكلفة البضاعة" value={formatMoney(profit.cogs ?? 0)} hint="تكلفة ما تم بيعه فقط" tone="amber" />
          <StatCard label="المصروفات" value={formatMoney(profit.expenses)} tone="rose" />
          <StatCard label="سحوبات الفترة" value={formatMoney(profit.totalWithdrawn)} tone="sky" />
        </StatGrid>
      )}

      <Card className="mb-4">
        <h3 className="mb-3 font-extrabold">قائمة الشركاء</h3>
        {!partners.length ? <Empty text="لا يوجد شركاء" hint="أضف شريكًا جديدًا" /> : (
          <Table>
            <thead>
              <tr>
                <Th>الكود</Th>
                <Th>الاسم</Th>
                <Th>الهاتف</Th>
                <Th>الحالة</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {partners.map((row) => (
                <tr key={row.id}>
                  <Td className="font-mono text-xs" dir="ltr">{row.code}</Td>
                  <Td className="font-bold">{row.name}</Td>
                  <Td>{row.phone || '—'}</Td>
                  <Td><Badge tone={row.isActive ? 'emerald' : 'slate'}>{row.isActive ? 'نشط' : 'موقوف'}</Badge></Td>
                  <Td>
                    <div className="flex gap-1">
                      {can('partners', 'edit') && <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>تعديل</Button>}
                      {can('partners', 'delete') && (
                        <Button size="sm" variant="danger" onClick={() => removePartner(row)}><Trash2 size={14} /></Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <h3 className="mb-3 font-extrabold">سجل السحوبات</h3>
        {!withdrawals.length ? <Empty text="لا سحوبات بعد" /> : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>الشريك</Th>
                <Th>المبلغ</Th>
                <Th>التاريخ</Th>
                <Th>ملاحظة</Th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((row) => (
                <tr key={row.id}>
                  <Td className="font-mono text-xs" dir="ltr">{row.number}</Td>
                  <Td className="font-bold">{row.partner.name}</Td>
                  <Td className="font-extrabold text-rose-600">{formatMoney(row.amount)}</Td>
                  <Td>{formatDate(row.withdrawnAt)}</Td>
                  <Td className="text-muted">{row.notes || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل شريك' : 'شريك جديد'}>
        <div className="space-y-3">
          <Field label="الاسم"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="رقم الهاتف"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label="ملاحظات"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={async (e) => {
                  await api(`/partners/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: e.target.checked }) });
                  setEditing({ ...editing, isActive: e.target.checked });
                  await load();
                }}
              />
              نشط
            </label>
          )}
          <Button className="w-full" disabled={busy} onClick={savePartner}>{busy ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </div>
      </Modal>

      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="سحب شريك">
        <div className="space-y-3">
          <div>
            <Label>الشريك</Label>
            <Select value={withdrawForm.partnerId} onChange={(e) => setWithdrawForm({ ...withdrawForm, partnerId: e.target.value })}>
              <option value="">اختر</option>
              {partners.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>من حساب</Label>
            <Select value={withdrawForm.methodId} onChange={(e) => setWithdrawForm({ ...withdrawForm, methodId: e.target.value })}>
              <option value="">خزنة / انستا باي / محفظة / بنك</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.cashAccount ? ` (${formatMoney(m.cashAccount.balance)})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <Field label="المبلغ">
            <NumberInput value={withdrawForm.amount} onValueChange={(v) => setWithdrawForm({ ...withdrawForm, amount: v })} />
          </Field>
          <Field label="ملاحظة">
            <Input value={withdrawForm.notes} onChange={(e) => setWithdrawForm({ ...withdrawForm, notes: e.target.value })} />
          </Field>
          <Button className="w-full" disabled={busy} onClick={saveWithdraw}>تأكيد السحب</Button>
        </div>
      </Modal>
    </div>
  );
}
