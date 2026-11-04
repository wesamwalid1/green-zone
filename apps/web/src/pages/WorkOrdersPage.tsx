import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { exportTableExcel } from '../lib/docExport';
import { useToast } from '../lib/feedback';
import { DocExportBar } from '../components/DocExportBar';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  PageSkeleton,
  PrintHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui';

type ProdOrder = {
  id: string;
  number: string;
  totalCost: number;
  paidAmount: number;
  remaining: number;
  status: string;
  region?: string | null;
  customer: { id: string; name: string; code: string };
  engineer?: { id: string; fullName: string } | null;
  lines: Array<{ quantity: number; product?: { name: string } | null }>;
};

type WorkOrder = {
  id: string;
  number: string;
  orderDate: string;
  status: string;
  notes?: string | null;
  createdBy?: { fullName: string } | null;
  orders: ProdOrder[];
  summary: {
    orderCount: number;
    lineCount: number;
    totalCost: number;
    paidAmount: number;
    remaining: number;
    customers: Array<{ id: string; name: string }>;
  };
};

const STATUS: Record<string, string> = {
  OPEN: 'مفتوح',
  IN_PROGRESS: 'جارٍ',
  DONE: 'منجز / مُسلَّم',
  CANCELLED: 'ملغى',
};

export function WorkOrdersPage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [available, setAvailable] = useState<ProdOrder[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WorkOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  async function load() {
    setError('');
    try {
      const [list, avail] = await Promise.all([
        api<WorkOrder[]>('/production/work-orders'),
        api<ProdOrder[]>('/production/prod-orders/available'),
      ]);
      setRows(list);
      setAvailable(avail);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التحميل');
      setLoaded(true);
    }
  }

  useEffect(() => { load().catch(() => undefined); }, []);

  const selectedSummary = useMemo(() => {
    const picked = available.filter((o) => selected.includes(o.id));
    const totalCost = picked.reduce((s, o) => s + (o.totalCost || 0), 0);
    const paidAmount = picked.reduce((s, o) => s + (o.paidAmount || 0), 0);
    return {
      count: picked.length,
      totalCost,
      paidAmount,
      remaining: Math.max(0, totalCost - paidAmount),
      customers: [...new Set(picked.map((o) => o.customer.name))],
    };
  }, [available, selected]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function create() {
    if (!selected.length) return toast.error('اختر أوردرات للتجميع');
    setBusy(true);
    try {
      await api('/production/work-orders', {
        method: 'POST',
        body: JSON.stringify({ orderIds: selected, notes: notes.trim() || undefined }),
      });
      toast.success('تم إنشاء أمر التشغيل');
      setOpen(false);
      setSelected([]);
      setNotes('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    const confirmDone =
      status === 'DONE'
        ? window.confirm('إقفال أمر التشغيل سيُسلّم الأوردرات ويُنشئ فواتير مبيعات وتحصيل من المدفوع. متابعة؟')
        : true;
    if (!confirmDone) return;
    setBusy(true);
    try {
      const updated = await api<WorkOrder>(`/production/work-orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast.success(status === 'DONE' ? 'تم التسليم وإنشاء الفواتير' : 'تم تحديث الحالة');
      setDetail(updated);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحديث');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/production/work-orders/${id}`, { method: 'DELETE' });
      toast.success('تم الحذف');
      if (detail?.id === id) setDetail(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  async function detachOrder(workOrderId: string, orderId: string) {
    try {
      const updated = await api<WorkOrder>(`/production/work-orders/${workOrderId}/orders/${orderId}`, {
        method: 'DELETE',
      });
      setDetail(updated);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر فك الأوردر');
    }
  }

  async function exportExcel() {
    const today = new Date().toISOString().slice(0, 10);
    await exportTableExcel({
      fileName: `أوامر-تشغيل-${today}.xlsx`,
      sheetName: 'أوامر التشغيل',
      title: 'أوامر التشغيل — Green Zone',
      headers: ['الرقم', 'التاريخ', 'عدد الأوردرات', 'العملاء', 'التكلفة', 'مدفوع', 'متبقي', 'الحالة', 'ملاحظات'],
      rows: rows.map((row) => [
        row.number,
        formatDate(row.orderDate),
        row.summary.orderCount,
        row.summary.customers.map((c) => c.name).join(' | '),
        row.summary.totalCost,
        row.summary.paidAmount,
        row.summary.remaining,
        STATUS[row.status] || row.status,
        row.notes || '',
      ]),
    });
  }

  if (!loaded) return <PageSkeleton />;
  if (error) return <ErrorState text={error} onRetry={() => load()} />;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="أمر تشغيل"
          subtitle="تجميع عدة أوردرات إنتاج في دفعة تشغيل واحدة — التسليم يُنشئ فاتورة وتحصيل تلقائياً"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <DocExportBar className="mb-0" onExcel={exportExcel} />
              <Button onClick={() => setOpen(true)}>
                <Plus size={16} /> أمر تشغيل جديد
              </Button>
            </div>
          }
        />
      </div>

      <PrintHeader title="أوامر التشغيل" subtitle={`${rows.length} أمر`} />

      <Card>
        {rows.length === 0 ? (
          <Empty text="لا أوامر تشغيل بعد" hint="اختر أوردرات إنتاج مؤكدة وجمّعها في أمر واحد" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>التاريخ</Th>
                <Th>الأوردرات</Th>
                <Th>العملاء</Th>
                <Th>التكلفة</Th>
                <Th>مدفوع</Th>
                <Th>متبقي</Th>
                <Th className="no-print">الحالة</Th>
                <Th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer" onClick={() => setDetail(row)}>
                  <Td className="font-mono text-xs font-bold" dir="ltr">{row.number}</Td>
                  <Td>{formatDate(row.orderDate)}</Td>
                  <Td>{row.summary.orderCount} أوردر · {row.summary.lineCount} بند</Td>
                  <Td>
                    <div className="text-sm font-semibold">{row.summary.customers.map((c) => c.name).join(' · ') || '—'}</div>
                  </Td>
                  <Td>{formatMoney(row.summary.totalCost)}</Td>
                  <Td>{formatMoney(row.summary.paidAmount)}</Td>
                  <Td>
                    <Badge tone={row.summary.remaining > 0 ? 'amber' : 'emerald'}>
                      {formatMoney(row.summary.remaining)}
                    </Badge>
                  </Td>
                  <Td className="no-print">
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={row.status}
                        disabled={row.status === 'DONE' || row.status === 'CANCELLED' || busy}
                        onChange={(e) => setStatus(row.id, e.target.value)}
                        className="h-9 min-w-[150px]"
                      >
                        {Object.entries(STATUS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </Select>
                    </div>
                  </Td>
                  <Td className="no-print">
                    <div onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="أمر تشغيل جديد" wide>
        <div className="space-y-3">
          <Field label="ملاحظات">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </Field>
          {available.length === 0 ? (
            <Empty text="لا أوردرات متاحة للتجميع" hint="أكّد أوردرات إنتاج غير مربوطة بأمر تشغيل" />
          ) : (
            <div className="max-h-80 space-y-2 overflow-auto rounded-xl border border-slate-200 p-2">
              {available.map((order) => {
                const checked = selected.includes(order.id);
                return (
                  <label
                    key={order.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 ${checked ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(order.id)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold" dir="ltr">{order.number}</span>
                        <span className="font-bold">{order.customer.name}</span>
                        {order.engineer && <span className="text-xs text-muted">{order.engineer.fullName}</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {order.lines.map((l) => `${l.product?.name || 'صنف'} × ${l.quantity}`).join(' · ')}
                      </div>
                      <div className="mt-1 text-xs">
                        تكلفة {formatMoney(order.totalCost)} · مدفوع {formatMoney(order.paidAmount)} · متبقي {formatMoney(order.remaining)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {selectedSummary.count > 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              {selectedSummary.count} أوردر · عملاء: {selectedSummary.customers.join(' · ')} · تكلفة {formatMoney(selectedSummary.totalCost)} · متبقي {formatMoney(selectedSummary.remaining)}
            </div>
          )}
          <Button className="w-full" disabled={busy || !selected.length} onClick={create}>
            إنشاء أمر التشغيل
          </Button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `أمر تشغيل ${detail.number}` : ''} wide>
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={detail.status === 'DONE' ? 'emerald' : detail.status === 'CANCELLED' ? 'rose' : 'brand'}>
                {STATUS[detail.status] || detail.status}
              </Badge>
              <span className="text-muted">{formatDate(detail.orderDate)}</span>
              {detail.createdBy && <span className="text-muted">بواسطة {detail.createdBy.fullName}</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-4 text-sm">
              <div className="rounded-xl bg-slate-50 px-3 py-2">أوردرات: <b>{detail.summary.orderCount}</b></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">تكلفة: <b>{formatMoney(detail.summary.totalCost)}</b></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">مدفوع: <b>{formatMoney(detail.summary.paidAmount)}</b></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">متبقي: <b>{formatMoney(detail.summary.remaining)}</b></div>
            </div>
            {detail.notes && <div className="text-sm text-muted">{detail.notes}</div>}
            <Table>
              <thead>
                <tr>
                  <Th>أوردر</Th>
                  <Th>عميل</Th>
                  <Th>بنود</Th>
                  <Th>مدفوع / متبقي</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((order) => (
                  <tr key={order.id}>
                    <Td className="font-mono text-xs font-bold" dir="ltr">{order.number}</Td>
                    <Td>
                      <div className="font-bold">{order.customer.name}</div>
                      {order.region && <div className="text-xs text-muted">{order.region}</div>}
                    </Td>
                    <Td className="text-xs">
                      {order.lines.map((l) => `${l.product?.name || 'صنف'} × ${l.quantity}`).join(' · ')}
                    </Td>
                    <Td>
                      {formatMoney(order.paidAmount)} / {formatMoney(order.remaining)}
                    </Td>
                    <Td>
                      {detail.status !== 'DONE' && detail.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          className="text-xs text-rose-600 hover:underline"
                          onClick={() => detachOrder(detail.id, order.id)}
                        >
                          فك
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {detail.status !== 'DONE' && detail.status !== 'CANCELLED' && (
              <Button className="w-full" disabled={busy} onClick={() => setStatus(detail.id, 'DONE')}>
                <CheckCircle2 size={16} /> تسليم وإقفال (فاتورة + تحصيل)
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
