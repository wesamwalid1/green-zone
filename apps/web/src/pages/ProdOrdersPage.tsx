import { useEffect, useMemo, useState } from 'react';
import { ClipboardPlus, Plus, Trash2 } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  NumberInput,
  PageHeader,
  PageSkeleton,
  PrintHeader,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui';

type Customer = { id: string; name: string; code: string; phone?: string | null };
type Product = { id: string; name: string; sku: string; salePrice?: number };
type Engineer = { id: string; fullName: string; jobTitle?: string | null; username: string };
type Line = {
  id?: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  specs?: string | null;
  product?: { id: string; name: string; sku: string; unit?: string };
};
type ProdOrder = {
  id: string;
  number: string;
  region?: string | null;
  address?: string | null;
  paymentMethods?: string | null;
  totalCost: number;
  paidAmount: number;
  remaining: number;
  orderDate: string;
  receiveDate?: string | null;
  notes?: string | null;
  status: string;
  customer: Customer;
  engineer?: Engineer | null;
  workOrder?: { id: string; number: string; status: string } | null;
  salesInvoice?: { id: string; number: string } | null;
  lines: Line[];
};

type LineForm = { productId: string; quantity: number | ''; unitPrice: number | ''; specs: string };

const STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكد',
  IN_RUN: 'في أمر تشغيل',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

export const PAYMENT_OPTIONS = ['خزنة رئيسية', 'انستا باي', 'محفظة', 'حساب بنكي'] as const;

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): LineForm => ({ productId: '', quantity: '', unitPrice: '', specs: '' });

function parsePayments(value?: string | null) {
  if (!value) return [] as string[];
  return value
    .split(/[·,|]/)
    .map((s) => s.trim())
    .filter((s) => (PAYMENT_OPTIONS as readonly string[]).includes(s));
}

function joinPayments(selected: string[]) {
  return selected.join(' · ');
}

export function ProdOrdersPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ProdOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<string[]>([]);
  const [form, setForm] = useState({
    customerId: '',
    region: '',
    address: '',
    totalCost: '' as number | '',
    paidAmount: '' as number | '',
    orderDate: today(),
    receiveDate: '',
    notes: '',
  });
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);

  const linesTotal = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0),
    [lines],
  );
  const totalCost = form.totalCost === '' ? linesTotal : Number(form.totalCost) || 0;
  const paidAmount = Number(form.paidAmount) || 0;
  const remaining = Math.max(0, totalCost - paidAmount);

  async function load() {
    setError('');
    try {
      const [list, cust, prod] = await Promise.all([
        api<ProdOrder[]>('/production/prod-orders'),
        api<Customer[]>('/customers'),
        api<Product[]>('/products'),
      ]);
      setRows(list);
      setCustomers(cust);
      setProducts(prod);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التحميل');
      setLoaded(true);
    }
  }

  useEffect(() => { load().catch(() => undefined); }, []);

  function resetForm() {
    setEditId(null);
    setPayments([]);
    setForm({
      customerId: '',
      region: '',
      address: '',
      totalCost: '',
      paidAmount: '',
      orderDate: today(),
      receiveDate: '',
      notes: '',
    });
    setLines([emptyLine()]);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(row: ProdOrder) {
    if (row.status === 'DELIVERED' || row.status === 'CANCELLED' || row.status === 'IN_RUN') {
      toast.error('لا يمكن تعديل هذا الأوردر');
      return;
    }
    setEditId(row.id);
    setPayments(parsePayments(row.paymentMethods));
    setForm({
      customerId: row.customer.id,
      region: row.region || '',
      address: row.address || '',
      totalCost: row.totalCost,
      paidAmount: row.paidAmount,
      orderDate: row.orderDate.slice(0, 10),
      receiveDate: row.receiveDate ? row.receiveDate.slice(0, 10) : '',
      notes: row.notes || '',
    });
    setLines(
      row.lines.length
        ? row.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            specs: l.specs || '',
          }))
        : [emptyLine()],
    );
    setOpen(true);
  }

  function togglePayment(option: string) {
    setPayments((prev) => (prev.includes(option) ? prev.filter((x) => x !== option) : [...prev, option]));
  }

  async function save() {
    if (!form.customerId) return toast.error('اختر العميل');
    if (!payments.length) return toast.error('اختر طريقة دفع واحدةً على الأقل');
    const payloadLines = lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        specs: l.specs.trim() || undefined,
      }));
    if (!payloadLines.length) return toast.error('أضف بنداً واحداً على الأقل');
    if (payloadLines.some((l) => !(l.quantity > 0))) return toast.error('تحقق من كميات البنود');
    if (paidAmount > totalCost + 0.001) return toast.error('المدفوع أكبر من التكلفة');

    setBusy(true);
    try {
      const body = {
        customerId: form.customerId,
        region: form.region.trim() || undefined,
        address: form.address.trim() || undefined,
        paymentMethods: joinPayments(payments),
        totalCost,
        paidAmount,
        orderDate: form.orderDate || undefined,
        receiveDate: form.receiveDate || undefined,
        notes: form.notes.trim() || undefined,
        lines: payloadLines,
      };
      if (editId) {
        await api(`/production/prod-orders/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('تم تحديث أوردر الإنتاج');
      } else {
        await api('/production/prod-orders', { method: 'POST', body: JSON.stringify(body) });
        toast.success('تم إنشاء أوردر الإنتاج');
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/production/prod-orders/${id}`, { method: 'DELETE' });
      toast.success('تم الحذف');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api(`/production/prod-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحديث');
    }
  }

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function exportExcel() {
    await exportTableExcel({
      fileName: `أوردرات-إنتاج-${today()}.xlsx`,
      sheetName: 'أوردرات الإنتاج',
      title: 'أوردرات الإنتاج — Green Zone',
      headers: ['الرقم', 'المهندس', 'العميل', 'المنطقة', 'العنوان', 'البنود', 'التكلفة', 'مدفوع', 'متبقي', 'طريقة الدفع', 'الاستلام', 'الحالة'],
      rows: rows.map((row) => [
        row.number,
        row.engineer?.fullName || '',
        row.customer.name,
        row.region || '',
        row.address || '',
        row.lines.map((l) => `${l.product?.name || 'صنف'} × ${l.quantity}`).join(' | '),
        row.totalCost,
        row.paidAmount,
        row.remaining,
        row.paymentMethods || '',
        row.receiveDate ? formatDate(row.receiveDate) : '',
        STATUS[row.status] || row.status,
      ]),
    });
  }

  if (!loaded) return <PageSkeleton />;
  if (error) return <ErrorState text={error} onRetry={() => load()} />;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="أوردر إنتاج"
          subtitle="اتفاق ميداني: المهندس من الحساب تلقائياً · عميل · بنود · مدفوع / متبقي"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <DocExportBar className="mb-0" onExcel={exportExcel} />
              <Button onClick={openCreate}>
                <Plus size={16} /> أوردر جديد
              </Button>
            </div>
          }
        />
      </div>

      <PrintHeader title="أوردرات الإنتاج" subtitle={`${rows.length} أوردر`} />

      <Card>
        {rows.length === 0 ? (
          <Empty text="لا أوردرات بعد" hint="أنشئ أوردر إنتاج — الأوردرات المربوطة بأمر تشغيل تظهر هناك فقط" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>المهندس</Th>
                <Th>العميل</Th>
                <Th>المنطقة</Th>
                <Th>البنود</Th>
                <Th>التكلفة</Th>
                <Th>مدفوع</Th>
                <Th>متبقي</Th>
                <Th>الدفع</Th>
                <Th>الاستلام</Th>
                <Th className="no-print">الحالة</Th>
                <Th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer" onClick={() => openEdit(row)}>
                  <Td className="font-mono text-xs font-bold" dir="ltr">{row.number}</Td>
                  <Td>{row.engineer?.fullName || '—'}</Td>
                  <Td className="font-bold">{row.customer.name}</Td>
                  <Td>
                    <div>{row.region || '—'}</div>
                    {row.address && <div className="text-xs text-muted">{row.address}</div>}
                  </Td>
                  <Td>
                    <div className="text-sm font-semibold">{row.lines.length} بند</div>
                    <div className="text-xs text-muted">
                      {row.lines.slice(0, 2).map((l) => l.product?.name || 'صنف').join(' · ')}
                      {row.lines.length > 2 ? '…' : ''}
                    </div>
                  </Td>
                  <Td>{formatMoney(row.totalCost)}</Td>
                  <Td>{formatMoney(row.paidAmount)}</Td>
                  <Td>
                    <Badge tone={row.remaining > 0 ? 'amber' : 'emerald'}>{formatMoney(row.remaining)}</Badge>
                  </Td>
                  <Td className="text-xs">{row.paymentMethods || '—'}</Td>
                  <Td>{row.receiveDate ? formatDate(row.receiveDate) : '—'}</Td>
                  <Td className="no-print">
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={row.status}
                        disabled={row.status === 'IN_RUN' || row.status === 'DELIVERED'}
                        onChange={(e) => setStatus(row.id, e.target.value)}
                        className="h-9 min-w-[140px]"
                      >
                        {Object.entries(STATUS)
                          .filter(([k]) => k !== 'IN_RUN')
                          .map(([k, v]) => (
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

      <Modal
        open={open}
        onClose={() => { setOpen(false); resetForm(); }}
        title={editId ? 'تعديل أوردر إنتاج' : 'أوردر إنتاج جديد'}
        wide
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
            <ClipboardPlus size={16} />
            المهندس يتحدد تلقائياً من الحساب المسجّل — المتبقي = التكلفة − المدفوع
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المهندس">
              <Input value={user?.fullName || '—'} readOnly />
            </Field>
            <Field label="العميل">
              <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">اختر العميل</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ''}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المنطقة">
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </Field>
            <Field label="العنوان">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ التسجيل">
              <Input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} />
            </Field>
            <Field label="تاريخ الاستلام">
              <Input type="date" value={form.receiveDate} onChange={(e) => setForm({ ...form, receiveDate: e.target.value })} />
            </Field>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold">بنود الأصناف</div>
              <Button type="button" variant="ghost" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                <Plus size={14} /> بند
              </Button>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Select
                    value={line.productId}
                    onChange={(e) => {
                      const product = products.find((p) => p.id === e.target.value);
                      updateLine(index, {
                        productId: e.target.value,
                        unitPrice: product?.salePrice ?? line.unitPrice,
                      });
                    }}
                  >
                    <option value="">الصنف</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <NumberInput value={line.quantity} onValueChange={(v) => updateLine(index, { quantity: v })} placeholder="كمية" />
                </div>
                <div className="sm:col-span-2">
                  <NumberInput value={line.unitPrice} onValueChange={(v) => updateLine(index, { unitPrice: v })} placeholder="سعر" />
                </div>
                <div className="sm:col-span-3">
                  <Input
                    value={line.specs}
                    onChange={(e) => updateLine(index, { specs: e.target.value })}
                    placeholder="حجم / مواصفات"
                  />
                </div>
                <div className="sm:col-span-1">
                  <button
                    type="button"
                    className="grid h-10 w-full place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => setLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== index)))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="text-xs text-muted">مجموع البنود: {formatMoney(linesTotal)}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="التكلفة الإجمالية">
              <NumberInput
                value={form.totalCost}
                onValueChange={(v) => setForm({ ...form, totalCost: v })}
                placeholder={String(linesTotal || '')}
              />
            </Field>
            <Field label="مدفوع">
              <NumberInput value={form.paidAmount} onValueChange={(v) => setForm({ ...form, paidAmount: v })} />
            </Field>
            <Field label="متبقي">
              <Input value={formatMoney(remaining)} readOnly />
            </Field>
          </div>
          <Field label="طرق الدفع">
            <div className="flex flex-wrap gap-2">
              {PAYMENT_OPTIONS.map((option) => {
                const active = payments.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => togglePayment(option)}
                    className={`rounded-xl px-3 py-2 text-sm font-bold ring-1 transition ${
                      active
                        ? 'bg-brand-700 text-white ring-brand-700'
                        : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="ملاحظات">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Button className="w-full" disabled={busy} onClick={save}>
            {editId ? 'حفظ التعديلات' : 'حفظ الأوردر'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
