import { useEffect, useState } from 'react';
import { ClipboardPlus, Plus, Trash2 } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useToast } from '../lib/feedback';
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
  Select,
  Table,
  Td,
  Th,
} from '../components/ui';

type Customer = { id: string; name: string; code: string; phone?: string | null };
type Product = { id: string; name: string; sku: string };
type ProdOrder = {
  id: string;
  number: string;
  description: string;
  quantity: number;
  unitPrice: number;
  orderDate: string;
  deliveryDate?: string | null;
  notes?: string | null;
  status: string;
  customer: Customer;
  product?: Product | null;
};

const STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  CONFIRMED: 'مؤكد',
  IN_PRODUCTION: 'قيد التصنيع',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

const today = () => new Date().toISOString().slice(0, 10);

export function ProdOrdersPage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ProdOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    description: '',
    quantity: '' as number | '',
    unitPrice: '' as number | '',
    orderDate: today(),
    deliveryDate: '',
    notes: '',
    productId: '',
  });

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

  async function save() {
    if (!form.customerId) return toast.error('اختر العميل');
    if (!form.description.trim()) return toast.error('اكتب البيان');
    if (!(Number(form.quantity) > 0)) return toast.error('أدخل الكمية');
    setBusy(true);
    try {
      await api('/production/prod-orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          description: form.description.trim(),
          quantity: Number(form.quantity),
          unitPrice: form.unitPrice === '' ? 0 : Number(form.unitPrice),
          orderDate: form.orderDate || undefined,
          deliveryDate: form.deliveryDate || undefined,
          notes: form.notes.trim() || undefined,
          productId: form.productId || undefined,
        }),
      });
      toast.success('تم إنشاء أوردر الإنتاج');
      setOpen(false);
      setForm({
        customerId: '', description: '', quantity: '', unitPrice: '',
        orderDate: today(), deliveryDate: '', notes: '', productId: '',
      });
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

  if (!loaded) return <PageSkeleton />;
  if (error) return <ErrorState text={error} onRetry={() => load()} />;

  return (
    <div>
      <PageHeader
        title="أوردر إنتاج"
        subtitle="طلب تشغيل من العميل: البيان · الكمية · تاريخ الطلب · تاريخ الاستلام"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> أوردر جديد
          </Button>
        }
      />

      <Card>
        {rows.length === 0 ? (
          <Empty text="لا أوردرات بعد" hint="أنشئ أوردر إنتاج باختيار العميل والبيان والكمية" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>العميل</Th>
                <Th>البيان</Th>
                <Th>الكمية</Th>
                <Th>السعر</Th>
                <Th>تاريخ الطلب</Th>
                <Th>تاريخ الاستلام</Th>
                <Th>الحالة</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="font-mono text-xs font-bold" dir="ltr">{row.number}</Td>
                  <Td className="font-bold">{row.customer.name}</Td>
                  <Td>
                    <div className="font-semibold">{row.description}</div>
                    {row.notes && <div className="text-xs text-muted">{row.notes}</div>}
                    {row.product && <div className="text-xs text-muted">صنف: {row.product.name}</div>}
                  </Td>
                  <Td>{row.quantity}</Td>
                  <Td>{row.unitPrice ? formatMoney(row.unitPrice) : '—'}</Td>
                  <Td>{formatDate(row.orderDate)}</Td>
                  <Td>{row.deliveryDate ? formatDate(row.deliveryDate) : '—'}</Td>
                  <Td>
                    <Select
                      value={row.status}
                      onChange={(e) => setStatus(row.id, e.target.value)}
                      className="h-9 min-w-[140px]"
                    >
                      {Object.entries(STATUS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <button
                      type="button"
                      className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => remove(row.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="أوردر إنتاج جديد" wide>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
            <ClipboardPlus size={16} />
            تاريخ الطلب يتملّى تلقائيًا — عدّله لو احتجت
          </div>
          <Field label="العميل">
            <Select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">اختر العميل</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="البيان">
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="مثال: طباعة أكياس 50 كجم — 3 ألوان"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الكمية">
              <NumberInput value={form.quantity} onValueChange={(v) => setForm({ ...form, quantity: v })} />
            </Field>
            <Field label="السعر المتوقع (اختياري)">
              <NumberInput value={form.unitPrice} onValueChange={(v) => setForm({ ...form, unitPrice: v })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ الطلب">
              <Input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} />
            </Field>
            <Field label="تاريخ الاستلام">
              <Input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
            </Field>
          </div>
          <Field label="صنف مرتبط (اختياري)">
            <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">بدون</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="ملاحظات">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Button className="w-full" disabled={busy} onClick={save}>حفظ الأوردر</Button>
        </div>
      </Modal>
    </div>
  );
}
