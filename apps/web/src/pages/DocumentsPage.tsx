import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, ClipboardList, FileText, Plus, Printer, ShoppingBag, Trash2, XCircle } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { exportInvoiceExcel } from '../lib/docExport';
import { useConfirm, useToast } from '../lib/feedback';
import { DocExportBar } from '../components/DocExportBar';
import { DualPrintCopies } from '../components/DualPrintCopies';
import { ProductPicker } from '../components/ProductPicker';
import { productsForWarehouse } from '../lib/productWarehouse';
import {
  Button, Card, CardHeader, Empty, ErrorState, Input, Label, Modal, NumberInput, PageHeader, PrintHeader, SearchBox, Select, StatCard, StatGrid, StatusBadge,
  Table, TableSkeleton, Td, Th,
} from '../components/ui';

type Kind = 'QUOTATION' | 'SALES_ORDER' | 'PURCHASE_ORDER';
const KINDS: { id: Kind; label: string; icon: typeof FileText }[] = [
  { id: 'QUOTATION', label: 'عرض سعر', icon: FileText },
  { id: 'SALES_ORDER', label: 'أمر بيع', icon: ClipboardList },
  { id: 'PURCHASE_ORDER', label: 'أمر شراء', icon: ShoppingBag },
];

type Doc = {
  id: string;
  number: string;
  kind: Kind;
  status: string;
  total: number;
  docDate: string;
  notes?: string | null;
  discount?: number;
  taxRate?: number;
  customer?: { name: string } | null;
  supplier?: { name: string } | null;
  warehouse?: { name: string } | null;
  lines?: { id: string; quantity: number; unitPrice: number; total: number; product?: { name: string } }[];
};

type Product = { id: string; name: string; sku?: string; salePrice: number; costPrice: number; barcode?: string | null; warehouses?: { warehouseId: string }[] };
type Line = { productId: string; description: string; quantity: number | ''; unitPrice: number | '' };

const emptyLine = (): Line => ({ productId: '', description: '', quantity: 1, unitPrice: '' });

export function DocumentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [kind, setKind] = useState<Kind>('QUOTATION');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CONVERTED' | 'CANCELLED'>('ALL');
  const [form, setForm] = useState({ partyId: '', warehouseId: '', notes: '', taxRate: '' as number | '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  async function load() {
    setLoadError('');
    try {
      const [d, c, s, w, p] = await Promise.all([
        api<Doc[]>(`/documents?kind=${kind}`),
        api<{ id: string; name: string }[]>('/customers'),
        api<{ id: string; name: string }[]>('/suppliers'),
        api<{ id: string; name: string }[]>('/warehouses'),
        api<Product[]>('/products'),
      ]);
      setDocs(d);
      setCustomers(c);
      setSuppliers(s);
      setWarehouses(w);
      setProducts(p);
    } catch (e) {
      setDocs([]);
      setLoadError(e instanceof Error ? e.message : 'تعذر تحميل المستندات');
    }
  }

  useEffect(() => { setDocs(null); load(); }, [kind]);

  const isPurchase = kind === 'PURCHASE_ORDER';
  const parties = isPurchase ? suppliers : customers;
  const kindLabel = KINDS.find((k) => k.id === kind)?.label || '';

  const priceOf = (l: Line) => {
    if (l.unitPrice !== '') return l.unitPrice;
    const p = products.find((x) => x.id === l.productId);
    return p ? (isPurchase ? p.costPrice : p.salePrice) : 0;
  };
  const subtotal = lines.reduce((s, l) => s + (l.quantity === '' ? 0 : l.quantity) * priceOf(l), 0);
  const tax = Math.round(subtotal * (form.taxRate === '' ? 0 : form.taxRate) * 100) / 10000;

  const list = docs || [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((d) => (statusFilter === 'ALL' || d.status === statusFilter)
      && (!q || d.number.toLowerCase().includes(q) || (d.customer?.name || d.supplier?.name || '').toLowerCase().includes(q)));
  }, [list, search, statusFilter]);
  const openDocs = list.filter((d) => d.status === 'OPEN');
  const converted = list.filter((d) => d.status === 'CONVERTED');

  function startNew() {
    setForm({ partyId: '', warehouseId: warehouses[0]?.id || '', notes: '', taxRate: '' });
    setLines([emptyLine()]);
    setOpen(true);
  }

  async function save() {
    if (!form.partyId) return toast.error(isPurchase ? 'اختر المورد' : 'اختر العميل');
    const valid = lines.filter((l) => l.productId && l.quantity !== '' && l.quantity > 0);
    if (!valid.length) return toast.error('أضف صنفًا واحدًا على الأقل بكمية صحيحة');
    setBusy(true);
    try {
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          customerId: isPurchase ? undefined : form.partyId,
          supplierId: isPurchase ? form.partyId : undefined,
          warehouseId: form.warehouseId || undefined,
          notes: form.notes || undefined,
          taxRate: form.taxRate === '' ? 0 : form.taxRate,
          lines: valid.map((l) => ({
            productId: l.productId,
            description: l.description.trim() || undefined,
            quantity: l.quantity === '' ? 0 : l.quantity,
            unitPrice: priceOf(l),
          })),
        }),
      });
      toast.success(`تم حفظ ${kindLabel}`);
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ المستند');
    } finally {
      setBusy(false);
    }
  }

  function printQuotation(doc: Doc) {
    setPrintDoc(doc);
    window.setTimeout(() => window.print(), 300);
  }

  async function act(doc: Doc, action: 'convert' | 'cancel') {
    const ok = await confirm(action === 'convert'
      ? { title: 'تحويل لفاتورة', message: `سيتم إنشاء مسودة ${isPurchase ? 'فاتورة مشتريات' : 'فاتورة مبيعات'} من ${doc.number}. متابعة؟`, confirmLabel: 'تحويل' }
      : { title: 'إلغاء المستند', message: `هل تريد إلغاء ${doc.number}؟`, confirmLabel: 'إلغاء المستند', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/documents/${doc.id}/${action}`, { method: 'POST' });
      toast.success(action === 'convert' ? `تم التحويل لمسودة فاتورة — راجعها من صفحة ${isPurchase ? 'المشتريات' : 'المبيعات'}` : 'تم إلغاء المستند');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="عروض وأوامر"
        subtitle="عرض سعر وأمر بيع وأمر شراء، وتقدر تحولهم لمسودة فاتورة"
        actions={<Button onClick={startNew}><Plus size={16} /> {kindLabel} جديد</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {KINDS.map((item) => {
          const Icon = item.icon;
          const active = kind === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { setKind(item.id); setStatusFilter('ALL'); }}
              className={`lift flex items-center gap-3 rounded-2xl border p-4 text-right transition ${active ? 'border-transparent bg-gradient-to-br from-brand-700 to-brand-900 text-white shadow-lg' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200'}`}
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${active ? 'bg-white/15' : 'bg-brand-50 text-brand-700'}`}><Icon size={20} /></span>
              <span>
                <span className="block text-[15px] font-extrabold">{item.label}</span>
                <span className={`text-xs ${active ? 'text-white/70' : 'text-muted'}`}>{item.id === 'PURCHASE_ORDER' ? 'للموردين' : 'للعملاء'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <StatGrid cols={3}>
        <StatCard label="مستندات مفتوحة" value={openDocs.length} hint={formatMoney(openDocs.reduce((s, d) => s + d.total, 0))} icon={FileText} tone="amber" onClick={() => setStatusFilter('OPEN')} active={statusFilter === 'OPEN'} />
        <StatCard label="تم تحويلها لفواتير" value={converted.length} hint={formatMoney(converted.reduce((s, d) => s + d.total, 0))} icon={ArrowRightLeft} tone="emerald" onClick={() => setStatusFilter('CONVERTED')} active={statusFilter === 'CONVERTED'} />
        <StatCard label={`إجمالي ${kindLabel}`} value={list.length} hint={formatMoney(list.reduce((s, d) => s + d.total, 0))} icon={ClipboardList} tone="brand" onClick={() => setStatusFilter('ALL')} active={statusFilter === 'ALL'} />
      </StatGrid>

      <Card>
        <CardHeader
          title={`سجل ${kindLabel}`}
          subtitle={`${visible.length} مستند`}
          icon={KINDS.find((k) => k.id === kind)?.icon}
          actions={
            <>
              <div className="flex rounded-xl bg-slate-100 p-1">
                {([['ALL', 'الكل'], ['OPEN', 'مفتوحة'], ['CONVERTED', 'محوّلة'], ['CANCELLED', 'ملغاة']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setStatusFilter(v)} className={`h-8 rounded-lg px-3 text-xs font-bold transition ${statusFilter === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'}`}>{l}</button>
                ))}
              </div>
              <SearchBox value={search} onChange={setSearch} placeholder="بحث بالرقم أو الطرف..." />
            </>
          }
        />
        {loadError ? <ErrorState text={loadError} onRetry={load} /> : !docs ? <TableSkeleton /> : visible.length === 0 ? (
          <Empty text={list.length ? 'لا توجد نتائج مطابقة' : `لا يوجد ${kindLabel} بعد`} action={!list.length ? <Button onClick={startNew}><Plus size={16} /> إنشاء {kindLabel}</Button> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>الرقم</Th><Th>{isPurchase ? 'المورد' : 'العميل'}</Th><Th>التاريخ</Th><Th>المخزن</Th><Th>البنود</Th><Th>الإجمالي</Th><Th>الحالة</Th><Th></Th></tr></thead>
            <tbody>
              {visible.map((doc) => (
                <tr key={doc.id} className={`status-${doc.status}`}>
                  <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{doc.number}</span></Td>
                  <Td className="font-bold text-slate-900">{doc.customer?.name || doc.supplier?.name || '—'}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{formatDate(doc.docDate)}</Td>
                  <Td className="text-slate-600">{doc.warehouse?.name || <span className="text-amber-600">غير محدد</span>}</Td>
                  <Td className="text-slate-600">{doc.lines?.length ?? '—'}</Td>
                  <Td className="whitespace-nowrap font-extrabold">{formatMoney(doc.total)}</Td>
                  <Td><StatusBadge status={doc.status} /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {doc.kind === 'QUOTATION' && (
                        <Button size="sm" variant="secondary" onClick={() => printQuotation(doc)}><Printer size={14} /> طباعة</Button>
                      )}
                      {doc.status === 'OPEN' && (
                        <>
                          <Button size="sm" variant="soft" disabled={busy} onClick={() => act(doc, 'convert')}><ArrowRightLeft size={14} /> تحويل لفاتورة</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(doc, 'cancel')}><XCircle size={14} /> إلغاء</Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={`${kindLabel} جديد`} wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{isPurchase ? 'المورد' : 'العميل'}</Label>
              <Select value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
                <option value="">اختر</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>المخزن (مطلوب عند التحويل لفاتورة)</Label>
              <Select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                <option value="">اختر</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1fr_1fr_90px_120px_110px_36px] gap-2 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              <span>الصنف</span><span>البيان</span><span>الكمية</span><span>السعر</span><span>الإجمالي</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_90px_120px_110px_36px] items-center gap-2 border-t border-slate-100 px-3 py-2">
                <ProductPicker
                  products={productsForWarehouse(products, form.warehouseId, lines.map((line) => line.productId)).map((product) => ({
                    id: product.id,
                    name: product.name,
                    sku: product.sku || '',
                    barcode: product.barcode,
                  }))}
                  value={l.productId}
                  disabled={!form.warehouseId}
                  placeholder={form.warehouseId ? 'اكتب اسم الصنف' : 'اختر المخزن أولاً'}
                  onChange={(productId) => setLines(lines.map((x, j) => (j === i ? { ...x, productId, unitPrice: '' } : x)))}
                />
                <Input
                  value={l.description}
                  placeholder="بيان البند"
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                />
                <NumberInput value={l.quantity} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} />
                <NumberInput value={l.unitPrice} placeholder={l.productId ? String(priceOf(l)) : ''} onValueChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: v } : x)))} />
                <span className="text-sm font-bold tabular-nums">{formatMoney((l.quantity === '' ? 0 : l.quantity) * priceOf(l))}</span>
                <button type="button" aria-label="حذف البند" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="border-t border-slate-100 px-3 py-2">
              <Button size="sm" variant="ghost" onClick={() => setLines([...lines, emptyLine()])}><Plus size={14} /> إضافة بند</Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr]">
            <div><Label>ضريبة %</Label><NumberInput value={form.taxRate} onValueChange={(v) => setForm({ ...form, taxRate: v })} /></div>
            <div><Label>ملاحظات</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="rounded-xl bg-brand-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600"><span>الإجمالي قبل الضريبة</span><span className="tabular-nums">{formatMoney(subtotal)}</span></div>
              <div className="flex justify-between text-slate-600"><span>الضريبة</span><span className="tabular-nums">{formatMoney(tax)}</span></div>
              <div className="mt-1 flex justify-between border-t border-brand-100 pt-1 font-extrabold text-brand-800"><span>الإجمالي</span><span className="tabular-nums">{formatMoney(subtotal + tax)}</span></div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={busy}>حفظ المستند</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!printDoc} onClose={() => setPrintDoc(null)} title={`عرض سعر ${printDoc?.number || ''}`} wide>
        {printDoc && (
          <div>
            <DocExportBar
              pdfFileName={`مستند-${printDoc.number}.pdf`}
              onExcel={() => exportInvoiceExcel({
                fileName: `مستند-${printDoc.number}.xlsx`,
                title: `${KINDS.find((k) => k.id === printDoc.kind)?.label || 'مستند'} ${printDoc.number}`,
                meta: [
                  ['الطرف', printDoc.customer?.name || printDoc.supplier?.name || '—'],
                  ['المخزن', printDoc.warehouse?.name || '—'],
                  ['التاريخ', formatDate(printDoc.docDate)],
                  ['الحالة', printDoc.status],
                ],
                lines: (printDoc.lines || []).map((line) => ({
                  name: line.product?.name || '—',
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  total: line.total,
                })),
                totals: [['الإجمالي', printDoc.total]],
              })}
            />
            <DualPrintCopies dense={(printDoc.lines || []).length > 8}>
              <PrintHeader title={`${KINDS.find((k) => k.id === printDoc.kind)?.label || 'مستند'} ${printDoc.number}`} subtitle={printDoc.customer?.name || printDoc.supplier?.name || ''} />
              <div className="mb-2 text-sm text-slate-600">
                {printDoc.customer?.name || printDoc.supplier?.name || '—'} · {printDoc.warehouse?.name || 'بدون مخزن'} · {formatDate(printDoc.docDate)}
              </div>
              <Table>
                <thead>
                  <tr><Th>الصنف</Th><Th>الكمية</Th><Th>السعر</Th><Th>الإجمالي</Th></tr>
                </thead>
                <tbody>
                  {(printDoc.lines || []).map((line) => (
                    <tr key={line.id}>
                      <Td>{line.product?.name || '—'}</Td>
                      <Td>{line.quantity}</Td>
                      <Td>{formatMoney(line.unitPrice)}</Td>
                      <Td>{formatMoney(line.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-2 flex justify-between text-sm font-extrabold">
                <span>الإجمالي</span>
                <span>{formatMoney(printDoc.total)}</span>
              </div>
              {printDoc.notes && <p className="mt-2 text-xs text-slate-600">{printDoc.notes}</p>}
            </DualPrintCopies>
          </div>
        )}
      </Modal>
    </div>
  );
}
