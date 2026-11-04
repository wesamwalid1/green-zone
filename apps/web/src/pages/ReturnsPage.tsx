import { useEffect, useState } from 'react';
import { CalendarDays, Eye, PackageOpen, Plus, Redo2, Undo2 } from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useToast } from '../lib/feedback';
import {
  Badge, Button, Card, CardHeader, Empty, Input, Label, Modal, NumberInput, PageHeader, Pager, SearchBox, Select, StatCard, StatGrid, Table, Td, Th,
} from '../components/ui';

type Party = { id: string; name: string };

type SalesLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  returnedQty: number;
  remainingQty: number;
  unitPrice: number;
  selected: boolean;
  returnQty: number | '';
};

type PurchaseLine = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  returnedQty: number;
  remainingQty: number;
  unitCost: number;
  selected: boolean;
  returnQty: number | '';
};

type SalesInvoiceGroup = {
  id: string;
  number: string;
  invoiceDate: string;
  warehouseId: string;
  warehouseName: string;
  total: number;
  lines: SalesLine[];
};

type PurchaseInvoiceGroup = {
  id: string;
  number: string;
  invoiceDate: string;
  warehouseId: string;
  warehouseName: string;
  total: number;
  lines: PurchaseLine[];
};

type SalesReturn = {
  id: string; number: string; returnDate: string; total: number;
  customer: { name: string }; warehouse: { name: string };
  salesInvoice: { number: string } | null;
  lines: { quantity: number; unitPrice: number; total: number; product: { name: string } }[];
};

type PurchaseReturn = {
  id: string; number: string; returnDate: string; total: number;
  supplier: { name: string }; warehouse: { name: string };
  purchaseInvoice: { number: string } | null;
  lines: { quantity: number; unitCost: number; total: number; product: { name: string } }[];
};

type SalesApiInvoice = {
  id: string;
  number: string;
  invoiceDate: string;
  warehouseId: string;
  warehouseName: string;
  total: number;
  lines: {
    productId: string; sku: string; name: string; unit: string;
    quantity: number; returnedQty: number; remainingQty: number; unitPrice: number;
  }[];
};

type PurchaseApiInvoice = {
  id: string;
  number: string;
  invoiceDate: string;
  warehouseId: string;
  warehouseName: string;
  total: number;
  lines: {
    productId: string; sku: string; name: string; unit: string;
    quantity: number; returnedQty: number; remainingQty: number; unitCost: number;
  }[];
};

export function ReturnsPage() {
  const [tab, setTab] = useState<'sales' | 'purchases'>('sales');
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Party[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [salesTotal, setSalesTotal] = useState(0);
  const [purchaseTotal, setPurchaseTotal] = useState(0);
  const [salesSummary, setSalesSummary] = useState({ count: 0, amount: 0, monthCount: 0, monthAmount: 0 });
  const [purchaseSummary, setPurchaseSummary] = useState({ count: 0, amount: 0 });
  const [detail, setDetail] = useState<SalesReturn | PurchaseReturn | null>(null);
  const toast = useToast();

  const [salesForm, setSalesForm] = useState({
    customerId: '', warehouseId: '', notes: '',
  });
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '', warehouseId: '', notes: '',
  });
  const [salesInvoices, setSalesInvoices] = useState<SalesInvoiceGroup[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoiceGroup[]>([]);

  async function load() {
    const params = new URLSearchParams({ page: String(listPage), pageSize: String(pageSize) });
    if (search.trim()) params.set('q', search.trim());
    const [sr, pr, c, s, w] = await Promise.all([
      api<{ items: SalesReturn[]; total: number; summary: typeof salesSummary }>(`/returns/sales?${params}`),
      api<{ items: PurchaseReturn[]; total: number; summary: typeof purchaseSummary }>(`/returns/purchases?${params}`),
      api<Party[]>('/customers'),
      api<Party[]>('/suppliers'),
      api<Party[]>('/warehouses'),
    ]);
    setSalesReturns(sr.items);
    setPurchaseReturns(pr.items);
    setSalesTotal(sr.total);
    setPurchaseTotal(pr.total);
    setSalesSummary(sr.summary);
    setPurchaseSummary(pr.summary);
    setCustomers(c);
    setSuppliers(s);
    setWarehouses(w);
  }

  useEffect(() => { setListPage(1); }, [search, pageSize, tab]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [listPage, pageSize, search]);

  const filteredSales = salesReturns;
  const filteredPurchases = purchaseReturns;
  const listTotal = tab === 'sales' ? salesTotal : purchaseTotal;
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize));
  const pageFrom = listTotal === 0 ? 0 : (Math.min(listPage, pageCount) - 1) * pageSize + 1;
  const pageTo = Math.min(Math.min(listPage, pageCount) * pageSize, listTotal);

  async function loadSalesReturnable(customerId: string) {
    if (!customerId) {
      setSalesInvoices([]);
      return;
    }
    setLoadingItems(true);
    setError('');
    try {
      const res = await api<{ invoices: SalesApiInvoice[] }>(`/returns/sales/returnable/${customerId}`);
      setSalesInvoices(
        res.invoices.map((inv) => ({
          ...inv,
          lines: inv.lines.map((line) => ({ ...line, selected: false, returnQty: '' })),
        })),
      );
      if (res.invoices[0]?.warehouseId) {
        setSalesForm((f) => ({ ...f, warehouseId: f.warehouseId || res.invoices[0].warehouseId }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الأصناف');
      setSalesInvoices([]);
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadPurchaseReturnable(supplierId: string) {
    if (!supplierId) {
      setPurchaseInvoices([]);
      return;
    }
    setLoadingItems(true);
    setError('');
    try {
      const res = await api<{ invoices: PurchaseApiInvoice[] }>(`/returns/purchases/returnable/${supplierId}`);
      setPurchaseInvoices(
        res.invoices.map((inv) => ({
          ...inv,
          lines: inv.lines.map((line) => ({ ...line, selected: false, returnQty: '' })),
        })),
      );
      if (res.invoices[0]?.warehouseId) {
        setPurchaseForm((f) => ({ ...f, warehouseId: f.warehouseId || res.invoices[0].warehouseId }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الأصناف');
      setPurchaseInvoices([]);
    } finally {
      setLoadingItems(false);
    }
  }

  function openModal() {
    setError('');
    setSalesForm({ customerId: '', warehouseId: '', notes: '' });
    setPurchaseForm({ supplierId: '', warehouseId: '', notes: '' });
    setSalesInvoices([]);
    setPurchaseInvoices([]);
    setOpen(true);
  }

  async function save() {
    setError('');
    try {
      if (tab === 'sales') {
        const chosen = salesInvoices.flatMap((inv) =>
          inv.lines
            .filter((line) => line.selected && line.returnQty !== '' && Number(line.returnQty) > 0)
            .map((line) => ({ inv, line })),
        );
        if (!salesForm.customerId) {
          setError('اختر العميل');
          return;
        }
        if (!chosen.length) {
          setError('حدد أصنافاً وكمية الإرجاع من الفواتير');
          return;
        }
        for (const { line } of chosen) {
          const qty = Number(line.returnQty || 0);
          if (qty > line.remainingQty) {
            setError(`الكمية المرتجعة للصنف ${line.name} أكبر من المتاح (${line.remainingQty})`);
            return;
          }
        }
        const byInvoice = new Map<string, typeof chosen>();
        for (const row of chosen) {
          const list = byInvoice.get(row.inv.id) || [];
          list.push(row);
          byInvoice.set(row.inv.id, list);
        }
        for (const [invoiceId, rows] of byInvoice) {
          await api('/returns/sales', {
            method: 'POST',
            body: JSON.stringify({
              customerId: salesForm.customerId,
              warehouseId: salesForm.warehouseId || rows[0].inv.warehouseId,
              salesInvoiceId: invoiceId,
              notes: salesForm.notes || undefined,
              lines: rows.map(({ line }) => ({
                productId: line.productId,
                quantity: Number(line.returnQty),
                unitPrice: line.unitPrice,
              })),
            }),
          });
        }
      } else {
        const chosen = purchaseInvoices.flatMap((inv) =>
          inv.lines
            .filter((line) => line.selected && line.returnQty !== '' && Number(line.returnQty) > 0)
            .map((line) => ({ inv, line })),
        );
        if (!purchaseForm.supplierId) {
          setError('اختر المورد');
          return;
        }
        if (!chosen.length) {
          setError('حدد أصنافاً وكمية الإرجاع من الفواتير');
          return;
        }
        for (const { line } of chosen) {
          const qty = Number(line.returnQty || 0);
          if (qty > line.remainingQty) {
            setError(`الكمية المرتجعة للصنف ${line.name} أكبر من المتاح (${line.remainingQty})`);
            return;
          }
        }
        const byInvoice = new Map<string, typeof chosen>();
        for (const row of chosen) {
          const list = byInvoice.get(row.inv.id) || [];
          list.push(row);
          byInvoice.set(row.inv.id, list);
        }
        for (const [invoiceId, rows] of byInvoice) {
          await api('/returns/purchases', {
            method: 'POST',
            body: JSON.stringify({
              supplierId: purchaseForm.supplierId,
              warehouseId: purchaseForm.warehouseId || rows[0].inv.warehouseId,
              purchaseInvoiceId: invoiceId,
              notes: purchaseForm.notes || undefined,
              lines: rows.map(({ line }) => ({
                productId: line.productId,
                quantity: Number(line.returnQty),
                unitCost: line.unitCost,
              })),
            }),
          });
        }
      }
      setOpen(false);
      toast.success(tab === 'sales' ? 'تم حفظ مرتجع البيع' : 'تم حفظ مرتجع الشراء');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل حفظ المرتجع');
    }
  }

  return (
    <div>
      <PageHeader
        title="المرتجعات"
        subtitle="مرتجع بيع ومرتجع شراء من الأصناف السابق التعامل عليها"
        actions={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="بحث مرتجع..." />
            <Button onClick={openModal}>
              <Plus size={16} /> {tab === 'sales' ? 'مرتجع بيع' : 'مرتجع شراء'}
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard label="مرتجعات البيع" value={formatMoney(salesSummary.amount)} hint={`${salesSummary.count} مرتجع من العملاء`} icon={Undo2} tone="rose" onClick={() => setTab('sales')} active={tab === 'sales'} />
        <StatCard label="مرتجعات الشراء" value={formatMoney(purchaseSummary.amount)} hint={`${purchaseSummary.count} مرتجع للموردين`} icon={Redo2} tone="sky" onClick={() => setTab('purchases')} active={tab === 'purchases'} />
        <StatCard label="مرتجعات بيع هذا الشهر" value={formatMoney(salesSummary.monthAmount)} hint={`${salesSummary.monthCount} مرتجع`} icon={CalendarDays} tone="amber" />
        <StatCard label="وحدات مرتجعة" value={[...salesReturns, ...purchaseReturns].reduce((s, r) => s + r.lines.reduce((x, l) => x + l.quantity, 0), 0).toLocaleString('ar-EG')} hint="بيع + شراء" icon={PackageOpen} tone="violet" />
      </StatGrid>

      <div className="mb-4 flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm no-print">
        {([['sales', 'مرتجعات البيع', salesSummary.count], ['purchases', 'مرتجعات الشراء', purchaseSummary.count]] as const).map(([id, label, count]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-bold transition ${tab === id ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {label}
            <span className={`rounded-md px-1.5 text-[11px] tabular-nums ${tab === id ? 'bg-white/20' : 'bg-slate-100'}`}>{count}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={tab === 'sales' ? 'سجل مرتجعات البيع' : 'سجل مرتجعات الشراء'}
          subtitle={`${listTotal} مرتجع`}
          icon={tab === 'sales' ? Undo2 : Redo2}
        />
        {(tab === 'sales' ? filteredSales.length : filteredPurchases.length) === 0 ? (
          <Empty
            text={listTotal ? 'لا توجد نتائج مطابقة' : 'لا توجد مرتجعات بعد'}
            action={<Button onClick={openModal}><Plus size={16} /> {tab === 'sales' ? 'مرتجع بيع' : 'مرتجع شراء'}</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th>
                <Th>{tab === 'sales' ? 'العميل' : 'المورد'}</Th>
                <Th>{tab === 'sales' ? 'فاتورة البيع' : 'فاتورة الشراء'}</Th>
                <Th>المخزن</Th>
                <Th>الأصناف</Th>
                <Th>التاريخ</Th>
                <Th>الإجمالي</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {(tab === 'sales' ? filteredSales : filteredPurchases).map((r) => {
                const party = 'customer' in r ? r.customer.name : r.supplier.name;
                const inv = 'salesInvoice' in r ? r.salesInvoice?.number : r.purchaseInvoice?.number;
                return (
                  <tr key={r.id} className={tab === 'sales' ? 'row-credit' : 'row-debit'}>
                    <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{r.number}</span></Td>
                    <Td className="font-bold text-slate-900">{party}</Td>
                    <Td><span className="font-mono text-xs text-slate-500" dir="ltr">{inv || '—'}</span></Td>
                    <Td className="text-slate-600">{r.warehouse.name}</Td>
                    <Td><Badge tone="slate">{r.lines.length} صنف · {r.lines.reduce((s, l) => s + l.quantity, 0)} وحدة</Badge></Td>
                    <Td className="whitespace-nowrap text-slate-500">{formatDate(r.returnDate)}</Td>
                    <Td className={`whitespace-nowrap font-extrabold ${tab === 'sales' ? 'text-rose-600' : 'text-sky-700'}`}>{formatMoney(r.total)}</Td>
                    <Td>
                      <button type="button" onClick={() => setDetail(r)} aria-label="عرض التفاصيل" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-brand-50 hover:text-brand-700">
                        <Eye size={16} />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={listPage} pages={pageCount} total={listTotal} from={pageFrom} to={pageTo} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `تفاصيل المرتجع ${detail.number}` : ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-muted">{'customer' in detail ? 'العميل' : 'المورد'}</div><div className="font-bold">{'customer' in detail ? detail.customer.name : detail.supplier.name}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-muted">الفاتورة الأصلية</div><div className="font-mono text-sm font-bold" dir="ltr">{('salesInvoice' in detail ? detail.salesInvoice?.number : detail.purchaseInvoice?.number) || '—'}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-muted">المخزن · التاريخ</div><div className="font-bold">{detail.warehouse.name} · {formatDate(detail.returnDate)}</div></div>
              <div className="rounded-xl bg-brand-50 p-3"><div className="text-xs text-brand-700">الإجمالي</div><div className="text-lg font-extrabold text-brand-800">{formatMoney(detail.total)}</div></div>
            </div>
            <Table>
              <thead><tr><Th>الصنف</Th><Th>الكمية</Th><Th>{'customer' in detail ? 'سعر البيع' : 'التكلفة'}</Th><Th>الإجمالي</Th></tr></thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <Td className="font-semibold">{l.product.name}</Td>
                    <Td className="tabular-nums">{l.quantity}</Td>
                    <Td className="tabular-nums">{formatMoney('unitPrice' in l ? l.unitPrice : l.unitCost)}</Td>
                    <Td className="font-bold tabular-nums">{formatMoney(l.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={tab === 'sales' ? 'مرتجع بيع' : 'مرتجع شراء'} wide>
        {tab === 'sales' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>العميل</Label>
                <Select
                  value={salesForm.customerId}
                  onChange={(e) => {
                    const customerId = e.target.value;
                    setSalesForm({ ...salesForm, customerId });
                    loadSalesReturnable(customerId);
                  }}
                >
                  <option value="">اختر العميل</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>المخزن المستلم للمرتجع</Label>
                <Select value={salesForm.warehouseId} onChange={(e) => setSalesForm({ ...salesForm, warehouseId: e.target.value })}>
                  <option value="">اختر المخزن</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
            </div>

            {loadingItems && <div className="text-sm text-muted">جاري تحميل أصناف العميل...</div>}

            {!loadingItems && salesForm.customerId && salesInvoices.length === 0 && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                لا توجد فواتير قابلة للإرجاع لهذا العميل
              </div>
            )}

            {salesInvoices.map((inv) => (
              <div key={inv.id} className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-brand-900">فاتورة {inv.number}</div>
                    <div className="text-xs text-muted">{formatDate(inv.invoiceDate)} · {inv.warehouseName}</div>
                  </div>
                  <div className="text-sm font-semibold">{formatMoney(inv.total)}</div>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th></Th>
                      <Th>الصنف</Th>
                      <Th>مباع</Th>
                      <Th>مرتجع</Th>
                      <Th>متاح</Th>
                      <Th>السعر</Th>
                      <Th>كمية الإرجاع</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((line) => (
                      <tr key={line.productId} className={line.selected ? 'bg-white' : ''}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={line.selected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSalesInvoices((prev) => prev.map((row) => row.id !== inv.id ? row : {
                                ...row,
                                lines: row.lines.map((item) => item.productId !== line.productId ? item : {
                                  ...item,
                                  selected: checked,
                                  returnQty: checked ? (item.returnQty === '' ? item.remainingQty : item.returnQty) : '',
                                }),
                              }));
                            }}
                          />
                        </Td>
                        <Td>
                          <div className="font-semibold">{line.name}</div>
                          <div className="font-mono text-xs text-muted">{line.sku}</div>
                        </Td>
                        <Td>{line.quantity}</Td>
                        <Td>{line.returnedQty}</Td>
                        <Td className="font-bold text-brand-700">{line.remainingQty}</Td>
                        <Td>{formatMoney(line.unitPrice)}</Td>
                        <Td>
                          <NumberInput
                            className="w-24"
                            value={line.returnQty}
                            onValueChange={(v) => {
                              setSalesInvoices((prev) => prev.map((row) => row.id !== inv.id ? row : {
                                ...row,
                                lines: row.lines.map((item) => item.productId !== line.productId ? item : {
                                  ...item, selected: true, returnQty: v,
                                }),
                              }));
                            }}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}

            <div>
              <Label>ملاحظات</Label>
              <Input value={salesForm.notes} onChange={(e) => setSalesForm({ ...salesForm, notes: e.target.value })} />
            </div>
            {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <Button className="w-full" onClick={save}>حفظ المرتجع</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>المورد</Label>
                <Select
                  value={purchaseForm.supplierId}
                  onChange={(e) => {
                    const supplierId = e.target.value;
                    setPurchaseForm({ ...purchaseForm, supplierId });
                    loadPurchaseReturnable(supplierId);
                  }}
                >
                  <option value="">اختر المورد</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>المخزن الخارج منه المرتجع</Label>
                <Select value={purchaseForm.warehouseId} onChange={(e) => setPurchaseForm({ ...purchaseForm, warehouseId: e.target.value })}>
                  <option value="">اختر المخزن</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
            </div>

            {loadingItems && <div className="text-sm text-muted">جاري تحميل أصناف المورد...</div>}

            {!loadingItems && purchaseForm.supplierId && purchaseInvoices.length === 0 && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                لا توجد فواتير قابلة للإرجاع من هذا المورد
              </div>
            )}

            {purchaseInvoices.map((inv) => (
              <div key={inv.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-amber-950">فاتورة {inv.number}</div>
                    <div className="text-xs text-muted">{formatDate(inv.invoiceDate)} · {inv.warehouseName}</div>
                  </div>
                  <div className="text-sm font-semibold">{formatMoney(inv.total)}</div>
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th></Th>
                      <Th>الصنف</Th>
                      <Th>مشترى</Th>
                      <Th>مرتجع</Th>
                      <Th>متاح</Th>
                      <Th>التكلفة</Th>
                      <Th>كمية الإرجاع</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((line) => (
                      <tr key={line.productId} className={line.selected ? 'bg-white' : ''}>
                        <Td>
                          <input
                            type="checkbox"
                            checked={line.selected}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setPurchaseInvoices((prev) => prev.map((row) => row.id !== inv.id ? row : {
                                ...row,
                                lines: row.lines.map((item) => item.productId !== line.productId ? item : {
                                  ...item,
                                  selected: checked,
                                  returnQty: checked ? (item.returnQty === '' ? item.remainingQty : item.returnQty) : '',
                                }),
                              }));
                            }}
                          />
                        </Td>
                        <Td>
                          <div className="font-semibold">{line.name}</div>
                          <div className="font-mono text-xs text-muted">{line.sku}</div>
                        </Td>
                        <Td>{line.quantity}</Td>
                        <Td>{line.returnedQty}</Td>
                        <Td className="font-bold text-brand-700">{line.remainingQty}</Td>
                        <Td>{formatMoney(line.unitCost)}</Td>
                        <Td>
                          <NumberInput
                            className="w-24"
                            value={line.returnQty}
                            onValueChange={(v) => {
                              setPurchaseInvoices((prev) => prev.map((row) => row.id !== inv.id ? row : {
                                ...row,
                                lines: row.lines.map((item) => item.productId !== line.productId ? item : {
                                  ...item, selected: true, returnQty: v,
                                }),
                              }));
                            }}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}

            <div>
              <Label>ملاحظات</Label>
              <Input value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} />
            </div>
            {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <Button className="w-full" onClick={save}>حفظ المرتجع</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
