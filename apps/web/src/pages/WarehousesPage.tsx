import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, CheckCircle2, Hash, MapPin, PackageCheck, Pencil, Plus, Trash2, Warehouse } from 'lucide-react';
import { exportTableExcel } from '../lib/docExport';
import { api, initialQuery } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useColumns } from '../lib/columns';
import { useConfirm, useToast } from '../lib/feedback';
import { usePagedList } from '../lib/paging';
import { FilterOption, IconAction, ListBar } from '../components/ListBar';
import {
  Badge, Button, Card, Empty, Field, Input, Modal, NumberInput, PageHeader, Pager, Select, StatCard, StatGrid, Table, Td, Th,
} from '../components/ui';

type WarehouseKind = 'GENERAL' | 'RAW' | 'MANUFACTURING';

type WarehouseSection = { id?: string; code?: string; name: string };

type Warehouse = {
  id: string;
  code: string;
  name: string;
  kind?: WarehouseKind;
  location?: string | null;
  description?: string | null;
  isActive: boolean;
  itemCount?: number;
  quantity?: number;
  sectionCount?: number;
  sections?: WarehouseSection[];
};

type FormState = {
  code: string;
  name: string;
  kind: WarehouseKind;
  location: string;
  description: string;
  isActive: boolean;
  sectionCount: number | '';
  sections: WarehouseSection[];
};

const KIND_LABELS: Record<WarehouseKind, string> = {
  GENERAL: 'عام',
  RAW: 'خام',
  MANUFACTURING: 'تصنيع',
};

const emptyForm: FormState = {
  code: '',
  name: '',
  kind: 'GENERAL',
  location: '',
  description: '',
  isActive: true,
  sectionCount: '',
  sections: [],
};
const VIEW_KEY = 'm5azen.warehousesView';
const MAX_WAREHOUSES = 3;
const MAX_SECTIONS = 20;
const WAREHOUSE_LIMIT_MESSAGE =
  'النسخة الحالية تدعم حتى 3 مخازن فقط. لإضافة مخزن إضافي، يُرجى التواصل معنا لتفعيل التوسعة.';

function resizeSections(count: number, current: WarehouseSection[]): WarehouseSection[] {
  const nextCount = Math.max(0, Math.min(MAX_SECTIONS, count));
  const next = current.slice(0, nextCount).map((row) => ({ ...row }));
  while (next.length < nextCount) {
    next.push({ name: `جزء ${next.length + 1}` });
  }
  return next;
}

function issues(form: FormState, items: Warehouse[], currentId?: string) {
  const errors: Partial<Record<'code' | 'name', string>> = {};
  const code = form.code.trim();
  const name = form.name.trim();
  if (code && items.some((row) => row.id !== currentId && row.code.toLowerCase() === code.toLowerCase())) errors.code = 'الكود مستخدم لمخزن آخر';
  if (name.length < 2) errors.name = 'اسم المخزن حرفين على الأقل';
  return errors;
}

export function WarehousesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState(initialQuery);
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [stockedOnly, setStockedOnly] = useState(false);
  const [view, setView] = useState<'table' | 'cards'>(() => (localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'));
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const columns = useColumns('m5azen.cols.warehouses', [
    { id: 'code', label: 'الكود' },
    { id: 'name', label: 'الاسم' },
    { id: 'location', label: 'الموقع' },
    { id: 'description', label: 'الوصف' },
    { id: 'items', label: 'الأصناف' },
    { id: 'qty', label: 'الكمية' },
    { id: 'status', label: 'الحالة' },
  ]);

  async function load() {
    setItems(await api<Warehouse[]>('/warehouses'));
  }

  useEffect(() => {
    load().catch((err) => toast.error(err instanceof Error ? err.message : 'تعذر تحميل المخازن'));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (status === 'active' && !row.isActive) return false;
      if (status === 'inactive' && row.isActive) return false;
      if (stockedOnly && !(row.quantity || 0)) return false;
      if (!q) return true;
      return [row.code, row.name, row.location || '', row.description || ''].some((value) => value.toLowerCase().includes(q));
    });
  }, [items, search, status, stockedOnly]);

  const pager = usePagedList(filtered, `${search}:${status}:${stockedOnly}`);
  const formErrors = issues(form, items, editingId || undefined);
  const activeCount = items.filter((row) => row.isActive).length;
  const stockedCount = items.filter((row) => (row.quantity || 0) > 0).length;
  const totalQty = items.reduce((sum, row) => sum + (row.quantity || 0), 0);
  const maxQty = Math.max(1, ...items.map((row) => row.quantity || 0));

  function openStock(row: Warehouse) {
    navigate(`/stock?warehouse=${encodeURIComponent(row.id)}`);
  }

  const atWarehouseLimit = items.length >= MAX_WAREHOUSES;

  function openCreate() {
    if (atWarehouseLimit) {
      toast.error(WAREHOUSE_LIMIT_MESSAGE);
      return;
    }
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row: Warehouse) {
    const sections = (row.sections || []).map((section) => ({
      id: section.id,
      code: section.code,
      name: section.name,
    }));
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      kind: row.kind || 'GENERAL',
      location: row.location || '',
      description: row.description || '',
      isActive: row.isActive,
      sectionCount: sections.length || '',
      sections,
    });
    setOpen(true);
  }

  async function save() {
    if (Object.keys(formErrors).length) return;
    const sectionCount = form.sectionCount === '' ? 0 : Number(form.sectionCount);
    if (sectionCount > 0) {
      const empty = form.sections.slice(0, sectionCount).find((section) => !section.name.trim());
      if (empty) {
        toast.error('سمِّ كل أجزاء المخزن قبل الحفظ');
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        kind: form.kind,
        location: form.location.trim(),
        description: form.description.trim(),
        sections: form.sections
          .slice(0, sectionCount)
          .map((section, index) => ({
            id: section.id,
            code: section.code || `P${index + 1}`,
            name: section.name.trim(),
          })),
        ...(editingId ? { isActive: form.isActive } : {}),
      };
      await api(editingId ? `/warehouses/${editingId}` : '/warehouses', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      toast.success(editingId ? 'تم تعديل المخزن' : 'تم إضافة المخزن');
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ المخزن');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Warehouse) {
    const ok = await confirm({
      title: 'حذف المخزن',
      message: `حذف ${row.name}؟ الحذف يتوقف لو المخزن فيه رصيد.`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/warehouses/${row.id}`, { method: 'DELETE' });
      toast.success('تم حذف المخزن');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حذف المخزن');
    }
  }

  async function exportRows() {
    await exportTableExcel({
      fileName: 'warehouses.xlsx',
      sheetName: 'المخازن',
      title: 'سجل المخازن — Green Zone',
      headers: ['الكود', 'الاسم', 'الموقع', 'الوصف', 'الأصناف', 'الكمية', 'الحالة'],
      rows: filtered.map((row) => [
        row.code, row.name, row.location || '', row.description || '', row.itemCount || 0, row.quantity || 0, row.isActive ? 'نشط' : 'متوقف',
      ]),
    });
  }

  return (
    <div>
      <PageHeader
        title="المخازن"
        subtitle={`أماكن التخزين — حتى ${MAX_WAREHOUSES} مخازن في النسخة الحالية (${items.length}/${MAX_WAREHOUSES})`}
        actions={
          atWarehouseLimit ? (
            <Button type="button" variant="secondary" onClick={openCreate}>تم الوصول لحد 3 مخازن</Button>
          ) : (
            <Button onClick={openCreate}><Plus size={16} /> مخزن جديد</Button>
          )
        }
      />

      {atWarehouseLimit && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          وصلت للحد الأقصى ({MAX_WAREHOUSES} مخازن). لو محتاج مخزن إضافي، تواصل معنا عشان نفعّل التوسعة.
        </div>
      )}

      <StatGrid>
        <StatCard label="إجمالي المخازن" value={items.length} hint="كل الفروع ونقاط التخزين" icon={Warehouse} tone="brand" active={status === 'all' && !stockedOnly} onClick={() => { setStatus('all'); setStockedOnly(false); }} />
        <StatCard label="مخازن نشطة" value={activeCount} hint={`${items.length - activeCount} متوقف`} icon={CheckCircle2} tone="emerald" active={status === 'active'} onClick={() => setStatus('active')} />
        <StatCard label="فيها رصيد" value={stockedCount} hint="اضغط لعرضها فقط" icon={PackageCheck} tone="sky" active={stockedOnly} onClick={() => setStockedOnly((value) => !value)} />
        <StatCard label="إجمالي الوحدات" value={totalQty.toLocaleString('ar-EG')} hint="مجموع الكميات في كل المخازن" icon={Boxes} tone="violet" />
      </StatGrid>

      <Card>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder="بحث بالكود أو الاسم أو الموقع"
          view={view}
          onView={(mode) => { setView(mode); localStorage.setItem(VIEW_KEY, mode); }}
          onExport={exportRows}
          columns={columns.columns}
          onToggleColumn={columns.toggle}
          filterActive={status !== 'all' || stockedOnly}
          filter={(
            <div className="space-y-1">
              <div className="mb-2 text-xs font-bold text-muted">حالة المخزن</div>
              {([['all', 'الكل'], ['active', 'نشط'], ['inactive', 'متوقف']] as const).map(([key, label]) => (
                <FilterOption key={key} active={status === key} onClick={() => setStatus(key)}>{label}</FilterOption>
              ))}
              <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-2 text-sm">
                <input type="checkbox" checked={stockedOnly} onChange={(event) => setStockedOnly(event.target.checked)} />
                فيها رصيد فقط
              </label>
            </div>
          )}
        />

        {filtered.length === 0 ? <Empty text="لا توجد مخازن مطابقة" hint="غيّر البحث أو حالة المخزن" /> : view === 'cards' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {pager.slice.map((row) => (
                <div key={row.id} className="lift cursor-pointer rounded-2xl border border-slate-200 bg-white p-4" onClick={() => openStock(row)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 text-white"><Warehouse size={19} /></span>
                      <div className="min-w-0">
                        <div className="truncate text-base font-extrabold">{row.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.code}</span>
                          <Badge tone={row.kind === 'RAW' ? 'amber' : row.kind === 'MANUFACTURING' ? 'sky' : 'slate'}>
                            {KIND_LABELS[row.kind || 'GENERAL']}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <Badge tone={row.isActive ? 'emerald' : 'slate'}>{row.isActive ? 'نشط' : 'متوقف'}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-sm text-muted"><MapPin size={13} />{row.location || 'بدون عنوان'}</div>
                  <div className="mt-1 text-xs font-semibold text-brand-700">
                    {(row.sectionCount || row.sections?.length || 0) > 0
                      ? `مقسوم لـ ${row.sectionCount || row.sections?.length} أجزاء`
                      : 'بدون تقسيم داخلي'}
                  </div>
                  {row.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{row.description}</p>}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-l from-sky-400 to-brand-600" style={{ width: `${Math.max(3, ((row.quantity || 0) / maxQty) * 100)}%` }} />
                  </div>
                  <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
                    <div>
                      <div className="text-xs text-muted">الرصيد</div>
                      <div className="font-extrabold tabular-nums">{(row.quantity || 0).toLocaleString('ar-EG')} <span className="text-xs font-medium text-muted">وحدة · {row.itemCount || 0} صنف</span></div>
                    </div>
                    <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                      <IconAction label="تعديل" onClick={() => openEdit(row)}><Pencil size={14} /></IconAction>
                      {user?.role === 'ADMIN' && <IconAction label="حذف" danger onClick={() => remove(row)}><Trash2 size={14} /></IconAction>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Pager page={pager.page} pages={pager.pages} total={pager.total} from={pager.from} to={pager.to} pageSize={pager.pageSize} onPageSize={pager.setPageSize} onPage={pager.setPage} />
          </>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {columns.visible('status') && <Th>الحالة</Th>}
                  {columns.visible('qty') && <Th>الكمية</Th>}
                  {columns.visible('items') && <Th>الأصناف</Th>}
                  {columns.visible('description') && <Th>الوصف</Th>}
                  {columns.visible('location') && <Th>الموقع</Th>}
                  {columns.visible('name') && <Th>الاسم</Th>}
                  {columns.visible('code') && <Th>الكود</Th>}
                  <Th>الإجراءات</Th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map((row) => (
                  <tr key={row.id} className="cursor-pointer" onClick={() => openStock(row)}>
                    {columns.visible('status') && (
                      <Td><Badge tone={row.isActive ? 'emerald' : 'slate'}>{row.isActive ? 'نشط' : 'متوقف'}</Badge></Td>
                    )}
                    {columns.visible('qty') && (
                      <Td>
                        <div className="min-w-[7rem]">
                          <div className="font-extrabold text-slate-900">{(row.quantity || 0).toLocaleString('ar-EG')}</div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-gradient-to-l from-sky-400 to-brand-600" style={{ width: `${Math.max(3, ((row.quantity || 0) / maxQty) * 100)}%` }} />
                          </div>
                        </div>
                      </Td>
                    )}
                    {columns.visible('items') && <Td className="font-semibold">{row.itemCount || 0}</Td>}
                    {columns.visible('description') && <Td className="max-w-xs truncate text-muted">{row.description || '—'}</Td>}
                    {columns.visible('location') && <Td><span className="inline-flex items-center gap-1.5 text-slate-600"><MapPin size={13} className="text-slate-400" />{row.location || '—'}</span></Td>}
                    {columns.visible('name') && (
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Warehouse size={15} /></span>
                          <div>
                            <div className="font-bold text-slate-800">{row.name}</div>
                            <Badge tone={row.kind === 'RAW' ? 'amber' : row.kind === 'MANUFACTURING' ? 'sky' : 'slate'}>
                              {KIND_LABELS[row.kind || 'GENERAL']}
                            </Badge>
                          </div>
                        </div>
                      </Td>
                    )}
                    {columns.visible('code') && <Td><span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700" dir="ltr">{row.code}</span></Td>}
                    <Td>
                      <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                        <IconAction label="تعديل" onClick={() => openEdit(row)}><Pencil size={14} /></IconAction>
                        {user?.role === 'ADMIN' && <IconAction label="حذف" danger onClick={() => remove(row)}><Trash2 size={14} /></IconAction>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager page={pager.page} pages={pager.pages} total={pager.total} from={pager.from} to={pager.to} pageSize={pager.pageSize} onPageSize={pager.setPageSize} onPage={pager.setPage} />
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? 'تعديل مخزن' : 'مخزن جديد'}>
        <div className="space-y-3">
          <Field label="كود المخزن (اختياري)" icon={<Hash size={16} />} error={formErrors.code} hint="لو فاضي يتولّد تلقائيًا">
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          </Field>
          <Field label="اسم المخزن" icon={<Warehouse size={16} />} error={formErrors.name}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="نوع المخزن" hint="خام للمواد المشتراة · تصنيع للمنتجات الجاهزة">
            <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as WarehouseKind })}>
              <option value="GENERAL">عام</option>
              <option value="RAW">خام</option>
              <option value="MANUFACTURING">تصنيع</option>
            </Select>
          </Field>
          <Field label="العنوان / الموقع الجغرافي" icon={<MapPin size={16} />} hint="المدينة أو العنوان داخل الشركة">
            <Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </Field>
          <Field label="الوصف">
            <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Field
            label="تقسيم المخزن لأجزاء (اختياري)"
            hint="اكتب رقم زي 3. لو سيبته فاضي مفيش أجزاء"
          >
            <NumberInput
              value={form.sectionCount}
              min={0}
              max={MAX_SECTIONS}
              placeholder="مثال: 3"
              onValueChange={(value) => {
                const sectionCount = value === '' ? '' : Math.max(0, Math.min(MAX_SECTIONS, Math.floor(Number(value) || 0)));
                const count = sectionCount === '' ? 0 : sectionCount;
                setForm({
                  ...form,
                  sectionCount,
                  sections: resizeSections(count, form.sections),
                });
              }}
            />
          </Field>
          {(form.sectionCount === '' ? 0 : Number(form.sectionCount)) > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="text-xs font-bold text-slate-600">أسماء الأجزاء</div>
              {form.sections.slice(0, Number(form.sectionCount) || 0).map((section, index) => (
                <div key={section.id || index} className="grid grid-cols-[auto_1fr] items-center gap-2">
                  <span className="text-xs font-bold text-muted">جزء {index + 1}</span>
                  <Input
                    value={section.name}
                    onChange={(event) => {
                      const sections = form.sections.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, name: event.target.value } : row,
                      );
                      setForm({ ...form, sections });
                    }}
                    placeholder={`اسم الجزء ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          )}
          {editingId && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              المخزن نشط
            </label>
          )}
          <Button className="w-full" disabled={saving || Object.keys(formErrors).length > 0} onClick={save}>
            {editingId ? 'حفظ التعديلات' : 'حفظ المخزن'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
