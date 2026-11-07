import { useEffect, useState } from 'react';
import { CircleDollarSign, CreditCard, Eye, FileDown, FileSignature, FileText, Hash, Mail, MapPin, Pencil, Phone, Plus, Printer, Users, Wallet, Warehouse } from 'lucide-react';
import { exportTableExcel } from '../lib/docExport';
import { afterPaint, runSilentPdf, runSilentPrint } from '../lib/silentDoc';
import { api, formatDate, formatMoney, initialQuery } from '../lib/api';
import { urgentInvoiceDate } from '../lib/due';
import { DueAmount } from '../components/DueAmount';
import { DocExportBar } from '../components/DocExportBar';
import { SilentPrintMount } from '../components/SilentPrintMount';
import { useFeedback } from '../lib/feedback';
import { useColumns } from '../lib/columns';
import { FilterOption, IconAction, ListBar } from '../components/ListBar';
import { NotesPanel } from '../components/NotesPanel';
import { EntityWorkspace } from '../components/EntityWorkspace';
import { WarehouseMultiSelect } from '../components/WarehouseMultiSelect';
import { StatementLedger } from '../components/StatementLedger';
import {
  Badge, Button, Card, Empty, Field, Input, Label, Modal, NumberInput, PageHeader, Pager, PrintHeader, Select, StatCard, StatGrid, Table, Td, Textarea, Th, todayIso,
} from '../components/ui';

type Customer = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  balance: number;
  creditLimit?: number;
  notes?: string | null;
  priceList?: string;
  isActive?: boolean;
  warehouses?: { warehouseId: string; warehouse?: { id: string; name: string } }[];
};

type Contract = {
  id: string;
  number: string;
  contractDate: string;
  title: string;
  terms?: string | null;
  notes?: string | null;
  customer: Customer;
};

type CustomerForm = {
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  creditLimit: number | '';
  priceList: string;
  isActive: boolean;
  warehouseIds: string[];
};

const emptyCustomer: CustomerForm = {
  code: '',
  name: '',
  phone: '',
  email: '',
  address: '',
  creditLimit: '',
  priceList: 'RETAIL',
  isActive: true,
  warehouseIds: [],
};
const CUSTOMER_VIEW = 'm5azen.customersView';

type StatementPayload = {
  customer: Customer;
  statement: import('../components/StatementLedger').LedgerRow[];
  balance: number;
  totals?: { debit: number; credit: number; balance: number };
  prepaid?: number;
  meaning?: string;
};

function ContractDocument({ contract }: { contract: Contract }) {
  return (
    <div className="contract-sheet space-y-4">
      <PrintHeader
        title={contract.title}
        subtitle={`رقم ${contract.number}`}
        brand="Green Zone"
        brandHint="للأسمدة والكيماويات"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-2 border-slate-300 bg-white px-4 py-3">
          <div className="contract-field-label text-[11px] font-bold text-slate-500">تاريخ التعاقد</div>
          <div className="mt-1 text-base font-extrabold text-slate-900" dir="ltr">{formatDate(contract.contractDate)}</div>
        </div>
        <div className="rounded-xl border-2 border-slate-300 bg-white px-4 py-3">
          <div className="contract-field-label text-[11px] font-bold text-slate-500">رقم التعاقد</div>
          <div className="mt-1 text-base font-extrabold text-brand-800" dir="ltr">{contract.number}</div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-extrabold text-brand-800">بيانات العميل</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['اسم العميل', contract.customer.name],
            ['كود العميل', contract.customer.code],
            ['رقم الهاتف', contract.customer.phone || '—'],
            ['البريد الإلكتروني', contract.customer.email || '—'],
            ['العنوان', contract.customer.address || '—'],
            ['قائمة السعر', contract.customer.priceList === 'WHOLESALE' ? 'جملة' : 'قطاعي'],
            ['الرصيد الحالي', formatMoney(contract.customer.balance)],
            ['حد الائتمان', formatMoney(contract.customer.creditLimit || 0)],
            ['حالة العميل', contract.customer.isActive === false ? 'موقوف' : 'نشط'],
            ['ملاحظات العميل', contract.customer.notes || '—'],
            ['عنوان التعاقد', contract.title],
            ['ملاحظات التعاقد', contract.notes || '—'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] font-bold text-slate-500">{label}</div>
              <div className="mt-1 min-h-[1.5rem] whitespace-pre-wrap text-sm font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-300 bg-white p-4 text-sm leading-7 text-slate-800">
        <div className="mb-2 font-extrabold text-brand-800">شروط التعاقد</div>
        <div className="whitespace-pre-wrap break-words">
          {contract.terms || 'يتعهد العميل بالتعامل مع شركة Green Zone وفق الشروط المتفق عليها، والالتزام بمواعيد السداد والكميات المعتمدة، ويقر بصحة بياناته الموضحة أعلاه.'}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8 print:mt-10">
        <div className="rounded-xl border-2 border-dashed border-slate-400 bg-white p-4 text-center">
          <div className="mb-2 text-xs font-bold text-slate-500">توقيع العميل</div>
          <div className="mx-auto mb-3 flex h-20 w-full max-w-[14rem] items-end justify-center border-b-2 border-slate-500" />
          <div className="font-extrabold text-slate-900">{contract.customer.name}</div>
          <div className="mt-1 text-xs text-muted"><bdi dir="ltr">{contract.customer.phone || ''}</bdi></div>
        </div>
        <div className="rounded-xl border-2 border-dashed border-slate-400 bg-white p-4 text-center">
          <div className="mb-2 text-xs font-bold text-slate-500">توقيع المدير</div>
          <div className="mx-auto mb-3 flex h-20 w-full max-w-[14rem] items-end justify-center border-b-2 border-slate-500" />
          <div className="font-extrabold text-slate-900">مدير Green Zone</div>
          <div className="mt-1 text-xs text-muted">للأسمدة والكيماويات</div>
        </div>
      </div>
    </div>
  );
}

export function CustomersPage() {
  const [tab, setTab] = useState<'customers' | 'contracts'>('customers');
  const [items, setItems] = useState<Customer[]>([]);
  const [listPage, setListPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ debitCount: 0, activeCount: 0, totalDue: 0 });
  const [search, setSearch] = useState(initialQuery);
  const [listView, setListView] = useState<'all' | 'debit'>('all');
  const [view, setView] = useState<'table' | 'cards'>(() => (localStorage.getItem(CUSTOMER_VIEW) === 'cards' ? 'cards' : 'table'));
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  const [statement, setStatement] = useState<StatementPayload | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyCustomer);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [views, setViews] = useState<{ id: string; name: string; query: string }[]>([]);
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractSearch, setContractSearch] = useState('');
  const [contractOpen, setContractOpen] = useState(false);
  const [contractView, setContractView] = useState<Contract | null>(null);
  const [silentContract, setSilentContract] = useState<Contract | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState({
    customerId: '',
    contractDate: todayIso(),
    title: 'عقد توريد وتعامل',
    terms: '',
    customerNotes: '',
    notes: '',
  });
  const [contractSaving, setContractSaving] = useState(false);
  const [pickerCustomers, setPickerCustomers] = useState<Customer[]>([]);
  const feedback = useFeedback();

  async function load() {
    const params = new URLSearchParams({ page: String(listPage), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (listView === 'debit') params.set('balance', 'debit');
    const customers = await api<{ items: Customer[]; total: number; summary: typeof summary }>(`/customers?${params}`);
    setItems(customers.items);
    setTotal(customers.total);
    setSummary(customers.summary);
    const sales = await api<{ invoiceDate: string; total: number; paidAmount: number; customerId: string }[]>('/sales/dues').catch(() => []);
    const grouped = new Map<string, { invoiceDate: string; remaining: number }[]>();
    for (const inv of sales) {
      const rows = grouped.get(inv.customerId) || [];
      rows.push({ invoiceDate: inv.invoiceDate, remaining: inv.total - inv.paidAmount });
      grouped.set(inv.customerId, rows);
    }
    const dates: Record<string, string> = {};
    grouped.forEach((rows, id) => {
      const date = urgentInvoiceDate(rows);
      if (date) dates[id] = date;
    });
    setDueDates(dates);
  }

  function customerBalance(row: Customer) {
    const date = dueDates[row.id];
    if (row.balance > 0.009 && date) return <DueAmount date={date} remaining={row.balance} />;
    return <span className="font-extrabold">{formatMoney(row.balance)}</span>;
  }

  useEffect(() => {
    api<{ id: string; name: string; query: string }[]>('/work/views?module=customers').then(setViews).catch(() => setViews([]));
    api<{ id: string; name: string }[]>('/warehouses').then(setWarehouses).catch(() => setWarehouses([]));
  }, []);
  useEffect(() => { setListPage(1); }, [search, listView, pageSize]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [listPage, pageSize, search, listView]);

  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) showStatement(open);
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageFrom = total === 0 ? 0 : (Math.min(listPage, pageCount) - 1) * pageSize + 1;
  const pageTo = Math.min(Math.min(listPage, pageCount) * pageSize, total);
  const customerColumns = useColumns('m5azen.cols.customers', [
    { id: 'balance', label: 'الرصيد' },
    { id: 'phone', label: 'الهاتف' },
    { id: 'address', label: 'العنوان' },
    { id: 'name', label: 'الاسم' },
    { id: 'code', label: 'الكود' },
  ]);
  const formErrors = {
    code: form.code.trim() && items.some((row) => row.id !== editingId && row.code.toLowerCase() === form.code.trim().toLowerCase()) ? 'الكود مستخدم لعميل آخر' : '',
    name: form.name.trim().length < 2 ? 'اسم العميل حرفين على الأقل' : '',
  };
  const debitCount = summary.debitCount;
  const activeCount = summary.activeCount;
  const totalDue = summary.totalDue;

  function openCreate() {
    setEditingId(null);
    setForm(emptyCustomer);
    setOpen(true);
  }

  function openEdit(row: Customer) {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      creditLimit: row.creditLimit ?? '',
      priceList: row.priceList || 'RETAIL',
      isActive: row.isActive !== false,
      warehouseIds: (row.warehouses || []).map((row) => row.warehouseId),
    });
    setOpen(true);
  }

  async function save() {
    if (formErrors.code || formErrors.name) return;
    setSaving(true);
    try {
      const body = {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim(),
        creditLimit: form.creditLimit === '' ? 0 : Number(form.creditLimit) || 0,
        priceList: form.priceList,
        warehouseIds: form.warehouseIds,
        ...(editingId ? { isActive: form.isActive } : {}),
      };
      await api(editingId ? `/customers/${editingId}` : '/customers', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      feedback.success(editingId ? 'تم تعديل العميل' : 'تم إضافة العميل');
      setOpen(false);
      if (!editingId && listPage !== 1) {
        setListPage(1);
      } else {
        await load();
      }
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'تعذر حفظ العميل');
    } finally {
      setSaving(false);
    }
  }

  async function exportRows() {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (listView === 'debit') params.set('balance', 'debit');
    const rows = await api<Customer[]>(`/customers${params.toString() ? `?${params}` : ''}`);
    await exportTableExcel({
      fileName: 'customers.xlsx',
      sheetName: 'العملاء',
      title: 'سجل العملاء — Green Zone',
      headers: ['الكود', 'الاسم', 'الهاتف', 'العنوان', 'الرصيد', 'الحالة'],
      rows: rows.map((row) => [row.code, row.name, row.phone || '', row.address || '', row.balance, row.isActive === false ? 'موقوف' : 'نشط']),
    });
  }

  async function showStatement(id: string) {
    const data = await api<StatementPayload>(`/customers/${id}/statement`);
    setStatement(data);
    setStmtOpen(true);
  }

  async function loadContracts() {
    const params = new URLSearchParams();
    if (contractSearch.trim()) params.set('search', contractSearch.trim());
    const rows = await api<Contract[]>(`/customers/contracts/list${params.toString() ? `?${params}` : ''}`);
    setContracts(rows);
  }

  useEffect(() => {
    if (tab !== 'contracts') return;
    const timer = window.setTimeout(() => { loadContracts().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [tab, contractSearch]);

  async function openNewContract(customerId = '') {
    let list = items;
    try {
      const rows = await api<Customer[]>('/customers');
      list = Array.isArray(rows) ? rows : items;
      setPickerCustomers(list);
    } catch {
      setPickerCustomers(items);
      list = items;
    }
    const selected = customerId ? list.find((c) => c.id === customerId) : undefined;
    setContractForm({
      customerId,
      contractDate: todayIso(),
      title: 'عقد توريد وتعامل',
      terms: '',
      customerNotes: selected?.notes || '',
      notes: '',
    });
    setContractOpen(true);
  }

  function onContractCustomerChange(customerId: string) {
    const selected = (pickerCustomers.length ? pickerCustomers : items).find((c) => c.id === customerId);
    setContractForm((prev) => ({
      ...prev,
      customerId,
      customerNotes: selected?.notes || '',
    }));
  }

  async function saveContract() {
    if (!contractForm.customerId) {
      feedback.error('اختر العميل');
      return;
    }
    setContractSaving(true);
    try {
      await api(`/customers/${contractForm.customerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: contractForm.customerNotes.trim() }),
      });
      const created = await api<Contract>('/customers/contracts', {
        method: 'POST',
        body: JSON.stringify({
          customerId: contractForm.customerId,
          contractDate: contractForm.contractDate,
          title: contractForm.title.trim() || 'عقد توريد وتعامل',
          terms: contractForm.terms.trim() || undefined,
          notes: contractForm.notes.trim() || undefined,
        }),
      });
      feedback.success('تم إنشاء التعاقد');
      setContractOpen(false);
      await loadContracts();
      await load().catch(() => undefined);
      setContractView({
        ...created,
        customer: {
          ...created.customer,
          notes: contractForm.customerNotes.trim() || null,
        },
      });
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'تعذر حفظ التعاقد');
    } finally {
      setContractSaving(false);
    }
  }

  async function exportContractsExcel() {
    await exportTableExcel({
      fileName: 'contracts.xlsx',
      sheetName: 'التعاقدات',
      title: 'سجل التعاقدات — Green Zone',
      headers: ['الرقم', 'التاريخ', 'العميل', 'الهاتف', 'الكود', 'العنوان', 'العنوان التعاقدي'],
      rows: contracts.map((row) => [
        row.number,
        formatDate(row.contractDate),
        row.customer.name,
        row.customer.phone || '',
        row.customer.code,
        row.customer.address || '',
        row.title,
      ]),
    });
  }

  async function viewContract(row: Contract) {
    setContractView(row);
  }

  async function printContract(row: Contract) {
    setSilentContract(row);
    await afterPaint();
    runSilentPrint(() => setSilentContract(null));
  }

  async function pdfContract(row: Contract) {
    if (pdfBusyId) return;
    setPdfBusyId(row.id);
    setSilentContract(row);
    await afterPaint();
    try {
      await runSilentPdf(`تعاقد-${row.number}.pdf`, () => setSilentContract(null));
    } catch (err) {
      feedback.error(err instanceof Error ? err.message : 'تعذر تنزيل PDF');
      setSilentContract(null);
    } finally {
      setPdfBusyId(null);
    }
  }

  async function bulk(isActive: boolean) {
    const result = await api<{ updated: number }>('/customers/bulk', { method: 'POST', body: JSON.stringify({ ids: selected, isActive }) });
    feedback.success(`تم تحديث ${result.updated} عميل`);
    setSelected([]);
    await load();
  }

  async function saveView() {
    const name = await feedback.prompt({ title: 'حفظ العرض', message: 'اسم يظهر لك عند فتح العملاء', defaultValue: listView === 'debit' ? 'عليهم رصيد' : 'عرض العملاء' });
    if (!name) return;
    const row = await api<{ id: string; name: string; query: string }>('/work/views', {
      method: 'POST',
      body: JSON.stringify({ module: 'customers', name, query: JSON.stringify({ search, listView }) }),
    });
    setViews((list) => [row, ...list]);
  }

  function applyView(query: string) {
    const parsed = JSON.parse(query) as { search?: string; listView?: 'all' | 'debit' | 'limit' };
    setSearch(parsed.search || '');
    setListView(parsed.listView === 'debit' ? 'debit' : 'all');
  }

  return (
    <div>
      <PageHeader
        title="العملاء"
        subtitle="بيانات العملاء وكشوف الحساب والتعاقدات"
        actions={
          <>
            {tab === 'customers' ? (
              <>
                <Button onClick={openCreate}><Plus size={16} /> عميل جديد</Button>
                {selected.length > 0 && (
                  <>
                    <Button variant="secondary" onClick={() => bulk(false)}>إيقاف المحدد</Button>
                    <Button variant="secondary" onClick={() => bulk(true)}>تنشيط المحدد</Button>
                  </>
                )}
                <Button variant="secondary" onClick={saveView}>حفظ العرض</Button>
              </>
            ) : (
              <Button onClick={() => openNewContract()}><Plus size={16} /> تعاقد جديد</Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex w-fit max-w-full flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm no-print">
        <button
          type="button"
          onClick={() => setTab('customers')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition ${tab === 'customers' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          العملاء
        </button>
        <button
          type="button"
          onClick={() => setTab('contracts')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition ${tab === 'contracts' ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <FileSignature size={15} /> تعاقدات
        </button>
      </div>

      {tab === 'customers' && (
      <>
      <StatGrid>
        <StatCard label="إجمالي العملاء" value={items.length} hint={`${activeCount} نشط · ${items.length - activeCount} موقوف`} icon={Users} tone="brand" active={listView === 'all'} onClick={() => setListView('all')} />
        <StatCard label="إجمالي المستحقات" value={formatMoney(totalDue)} hint="مبالغ مستحقة على العملاء" icon={Wallet} tone="emerald" />
        <StatCard label="عليهم رصيد" value={debitCount} hint="اضغط لعرضهم فقط" icon={CircleDollarSign} tone="amber" active={listView === 'debit'} onClick={() => setListView('debit')} />
      </StatGrid>

      <Card>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder="بحث بالكود أو الاسم أو الهاتف"
          view={view}
          onView={(mode) => { setView(mode); localStorage.setItem(CUSTOMER_VIEW, mode); }}
          onExport={exportRows}
          columns={customerColumns.columns}
          onToggleColumn={customerColumns.toggle}
          filterActive={listView !== 'all'}
          filter={(
            <div className="space-y-1">
              <div className="mb-2 text-xs font-bold text-muted">تصفية العملاء</div>
              {([['all', 'الكل'], ['debit', 'عليهم رصيد']] as const).map(([key, label]) => (
                <FilterOption key={key} active={listView === key} onClick={() => setListView(key)}>{label}</FilterOption>
              ))}
            </div>
          )}
        />
        {views.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {views.map((saved) => (
              <Button key={saved.id} variant="ghost" onClick={() => applyView(saved.query)}>{saved.name}</Button>
            ))}
          </div>
        )}
        {items.length === 0 ? <Empty text="لا يوجد عملاء مطابقون" hint="غيّر البحث أو التصفية" /> : view === 'cards' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((row) => (
                <div key={row.id} className="lift rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-sm font-extrabold text-white">{row.name.trim()[0]}</span>
                      <div className="min-w-0">
                        <div className="truncate text-base font-extrabold">{row.name}</div>
                        <div className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.code}</div>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${row.isActive === false ? 'bg-slate-200 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-sm text-muted"><Phone size={13} /><bdi dir="ltr">{row.phone || 'بدون هاتف'}</bdi></div>
                  <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
                    <div>
                      <div className="text-xs text-muted">الرصيد</div>
                      {customerBalance(row)}
                    </div>
                    <div className="flex gap-1">
                      <IconAction label="تعديل" onClick={() => openEdit(row)}><Pencil size={14} /></IconAction>
                      <IconAction label="تعاقد" onClick={() => openNewContract(row.id)}><FileSignature size={14} /></IconAction>
                      <IconAction label="كشف حساب" onClick={() => showStatement(row.id)}><FileText size={14} /></IconAction>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Pager page={listPage} pages={pageCount} total={total} from={pageFrom} to={pageTo} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
          </>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {customerColumns.visible('balance') && <Th>الرصيد</Th>}
                  {customerColumns.visible('phone') && <Th>الهاتف</Th>}
                  {customerColumns.visible('address') && <Th>العنوان</Th>}
                  {customerColumns.visible('name') && <Th>الاسم</Th>}
                  {customerColumns.visible('code') && <Th>الكود</Th>}
                  <Th></Th>
                  <Th>الإجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className={row.balance > 0 ? 'row-debit' : row.balance < 0 ? 'row-credit' : ''}>
                    {customerColumns.visible('balance') && <Td>{customerBalance(row)}</Td>}
                    {customerColumns.visible('phone') && <Td><bdi dir="ltr" className="font-medium text-slate-600">{row.phone || '—'}</bdi></Td>}
                    {customerColumns.visible('address') && <Td className="max-w-xs truncate text-muted">{row.address || '—'}</Td>}
                    {customerColumns.visible('name') && (
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-extrabold text-brand-700">{row.name.trim()[0]}</span>
                          <div className="min-w-0">
                            <div className="truncate font-bold text-slate-800">{row.name}</div>
                            <div className="text-[11px] text-muted">{row.priceList === 'WHOLESALE' ? 'عميل جملة' : 'عميل قطاعي'}</div>
                          </div>
                          {row.isActive === false && <Badge tone="slate">موقوف</Badge>}
                        </div>
                      </Td>
                    )}
                    {customerColumns.visible('code') && <Td><span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700" dir="ltr">{row.code}</span></Td>}
                    <Td><input type="checkbox" checked={selected.includes(row.id)} onChange={() => setSelected((ids) => ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id])} /></Td>
                    <Td>
                      <div className="flex gap-1">
                        <IconAction label="تعديل" onClick={() => openEdit(row)}><Pencil size={14} /></IconAction>
                        <IconAction label="تعاقد" onClick={() => openNewContract(row.id)}><FileSignature size={14} /></IconAction>
                        <IconAction label="كشف حساب" onClick={() => showStatement(row.id)}><FileText size={14} /></IconAction>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={listPage} pages={pageCount} total={total} from={pageFrom} to={pageTo} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
          </>
        )}
      </Card>
      </>
      )}

      {tab === 'contracts' && (
        <Card>
          <ListBar
            search={contractSearch}
            onSearch={setContractSearch}
            placeholder="بحث برقم التعاقد أو اسم العميل أو الهاتف"
            onExport={exportContractsExcel}
          />
          {contracts.length === 0 ? (
            <Empty text="لا توجد تعاقدات" hint="أنشئ تعاقدًا جديدًا من زر تعاقد جديد" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>رقم التعاقد</Th>
                  <Th>التاريخ</Th>
                  <Th>العميل</Th>
                  <Th>الهاتف</Th>
                  <Th>العنوان</Th>
                  <Th>الإجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((row) => (
                  <tr key={row.id}>
                    <Td><span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.number}</span></Td>
                    <Td>{formatDate(row.contractDate)}</Td>
                    <Td>
                      <div className="font-bold">{row.customer.name}</div>
                      <div className="font-mono text-[11px] text-muted" dir="ltr">{row.customer.code}</div>
                    </Td>
                    <Td><bdi dir="ltr">{row.customer.phone || '—'}</bdi></Td>
                    <Td className="max-w-xs truncate text-muted">{row.customer.address || '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <IconAction label="عرض التعاقد" onClick={() => void viewContract(row)}><Eye size={14} /></IconAction>
                        <IconAction label="طباعة" onClick={() => void printContract(row)}><Printer size={14} /></IconAction>
                        <IconAction
                          label={pdfBusyId === row.id ? 'جاري التنزيل…' : 'تنزيل PDF'}
                          onClick={() => void pdfContract(row)}
                        >
                          <FileDown size={14} className={pdfBusyId === row.id ? 'animate-pulse' : undefined} />
                        </IconAction>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? 'تعديل عميل' : 'عميل جديد'}>
        <div className="space-y-3">
          <Field label="كود العميل (اختياري)" icon={<Hash size={16} />} error={formErrors.code} hint="لو فاضي يتولّد تلقائيًا">
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="اختياري" />
          </Field>
          <Field label="اسم العميل" icon={<Users size={16} />} error={formErrors.name}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="رقم الهاتف" icon={<Phone size={16} />} warning={form.phone && items.some((row) => row.id !== editingId && row.phone === form.phone.trim()) ? 'في عميل بنفس رقم الهاتف' : undefined}>
            <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label="البريد الإلكتروني" icon={<Mail size={16} />}>
            <Input type="email" dir="ltr" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="العنوان" icon={<MapPin size={16} />}>
            <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </Field>
          <Field label="حد الائتمان" icon={<CreditCard size={16} />} hint="الحد الأقصى للمديونية المسموح بها">
            <NumberInput value={form.creditLimit} onValueChange={(creditLimit) => setForm({ ...form, creditLimit })} min={0} step="0.01" placeholder="0" />
          </Field>
          <Field label="قائمة السعر">
            <Select value={form.priceList} onChange={(event) => setForm({ ...form, priceList: event.target.value })}>
              <option value="RETAIL">قطاعي</option>
              <option value="WHOLESALE">جملة</option>
            </Select>
          </Field>
          <div>
            <Label>
              <span className="inline-flex items-center gap-1.5"><Warehouse size={15} className="text-slate-400" /> المخازن</span>
            </Label>
            <WarehouseMultiSelect
              warehouses={warehouses}
              value={form.warehouseIds}
              onChange={(warehouseIds) => setForm({ ...form, warehouseIds })}
              hint="العميل يظهر ليوزر المخازن دي فقط. لو مفيش اختيار يظهر للكل"
            />
          </div>
          {editingId && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              العميل نشط
            </label>
          )}
          <Button className="w-full" disabled={saving || !!formErrors.code || !!formErrors.name} onClick={save}>{editingId ? 'حفظ التعديلات' : 'حفظ العميل'}</Button>
        </div>
      </Modal>

      <Modal open={stmtOpen} onClose={() => setStmtOpen(false)} title={`كشف حساب — ${statement?.customer.name || ''}`} wide>
        {statement && (
          <div>
            <StatementLedger
              data={{
                title: `كشف حساب عميل: ${statement.customer.name}`,
                partyName: statement.customer.name,
                partyCode: statement.customer.code,
                partyKind: 'customer',
                balance: statement.balance,
                meaning: statement.meaning,
                prepaid: statement.prepaid,
                totals: statement.totals,
                statement: statement.statement,
                fileName: `كشف-${statement.customer.code}.xlsx`,
              }}
            />
            <div className="mt-4 no-print">
              <NotesPanel entityType="customer" entityId={statement.customer.id} />
              <EntityWorkspace entityType="customer" entityId={statement.customer.id} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={contractOpen} onClose={() => setContractOpen(false)} title="تعاقد جديد">
        <div className="space-y-3">
          <Field label="العميل">
            <Select value={contractForm.customerId} onChange={(e) => onContractCustomerChange(e.target.value)}>
              <option value="">اختر العميل</option>
              {(pickerCustomers.length ? pickerCustomers : items).map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="تاريخ التعاقد">
            <Input type="date" value={contractForm.contractDate} onChange={(e) => setContractForm({ ...contractForm, contractDate: e.target.value })} />
          </Field>
          <Field label="عنوان التعاقد">
            <Input value={contractForm.title} onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })} />
          </Field>
          <div>
            <Label>الشروط (اختياري)</Label>
            <Textarea
              rows={10}
              className="min-h-[14rem] whitespace-pre-wrap"
              value={contractForm.terms}
              onChange={(e) => setContractForm({ ...contractForm, terms: e.target.value })}
              placeholder="اكتب شروط التعاقد سطرًا بسطر — يُستخدم النص الافتراضي لو فاضي"
            />
          </div>
          <div>
            <Label>ملاحظات العميل</Label>
            <Textarea
              rows={3}
              className="min-h-[5rem] whitespace-pre-wrap"
              value={contractForm.customerNotes}
              onChange={(e) => setContractForm({ ...contractForm, customerNotes: e.target.value })}
              placeholder="تُحفظ على بيانات العميل وتظهر في التعاقد"
            />
          </div>
          <div>
            <Label>ملاحظات التعاقد</Label>
            <Textarea
              rows={3}
              className="min-h-[5rem] whitespace-pre-wrap"
              value={contractForm.notes}
              onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })}
              placeholder="ملاحظات خاصة بهذا التعاقد فقط"
            />
          </div>
          <Button className="w-full" disabled={contractSaving || !contractForm.customerId} onClick={saveContract}>
            حفظ وطباعة التعاقد
          </Button>
        </div>
      </Modal>

      <Modal open={!!contractView} onClose={() => setContractView(null)} title={`تعاقد ${contractView?.number || ''}`} wide>
        {contractView && (
          <div>
            <div className="mb-4 overflow-hidden rounded-2xl bg-brand-900 px-5 py-4 text-white no-print">
              <div className="text-xs text-brand-200">تعاقد Green Zone</div>
              <div className="text-2xl font-extrabold">{contractView.number}</div>
              <div className="mt-1 text-sm text-brand-100">{contractView.customer.name} · {formatDate(contractView.contractDate)}</div>
            </div>
            <DocExportBar pdfFileName={`تعاقد-${contractView.number}.pdf`} />
            <ContractDocument contract={contractView} />
          </div>
        )}
      </Modal>

      {silentContract && (
        <SilentPrintMount>
          <ContractDocument contract={silentContract} />
        </SilentPrintMount>
      )}
    </div>
  );
}
