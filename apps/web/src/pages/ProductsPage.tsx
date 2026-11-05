import { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Boxes, Coins, Columns3, Package, Pencil, Plus, Tag, Trash2, TrendingDown, TriangleAlert, Upload, Warehouse } from 'lucide-react';
import { exportTableExcel } from '../lib/docExport';
import { api, formatMoney, getApiBase, initialQuery, productImageUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import { ListBar, IconAction } from '../components/ListBar';
import { useColumns } from '../lib/columns';
import { WarehouseMultiSelect } from '../components/WarehouseMultiSelect';
import {
  Badge, Button, Card, Empty, Field, Input, Label, Modal, NumberInput, PageHeader, Pager, Select, StatCard, StatGrid, Table, Td, Th,
} from '../components/ui';

function ProductThumb({ product, size = 'md' }: { product: { id: string; name: string; imageFile?: string | null }; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-xl' : 'h-10 w-10 rounded-lg';
  if (product.imageFile) {
    return <img src={productImageUrl(product.id, product.imageFile)} alt="" loading="lazy" className={`${box} shrink-0 border border-slate-200 bg-white object-cover`} />;
  }
  return (
    <span className={`${box} grid shrink-0 place-items-center bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600`}>
      <Package size={size === 'lg' ? 20 : 16} />
    </span>
  );
}

type CustomField = {
  id: string;
  name: string;
  label: string;
  fieldType: string;
  options?: string | null;
  isRequired: boolean;
};

type TradeUnit = { id?: string; name: string; factor: number };
type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  costPrice: number;
  salePrice: number;
  wholesalePrice?: number;
  minStock: number;
  barcode?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  packUnit?: string | null;
  packSize?: number;
  packWeight?: number | null;
  imageFile?: string | null;
  fieldValues: { fieldId: string; value: string; field: CustomField }[];
  stockBalances: { quantity: number; warehouse: { name: string } }[];
  warehouses?: { warehouseId: string; warehouse?: { id: string; name: string } }[];
  category?: { id: string; name: string } | null;
  tradeUnits?: TradeUnit[];
};

const DRAFT_KEY = 'm5azen.productDraft';
const VIEW_KEY = 'm5azen.productsView';

const emptyCreate = {
  sku: '',
  name: '',
  unit: 'كيلو',
  salePrice: '' as number | '',
  wholesalePrice: '' as number | '',
  minStock: '' as number | '',
  barcode: '',
  brand: '',
  categoryId: '',
  packUnit: '',
  packSize: '' as number | '',
  packWeight: '' as number | '',
  warehouseIds: [] as string[],
  tradeUnits: [] as { name: string; factor: number | '' }[],
};

type ProductForm = typeof emptyCreate;

function productIssues(form: ProductForm, items: Product[], ignoreId?: string, _costPrice = 0) {
  const errors: Partial<Record<'sku' | 'name' | 'barcode' | 'unit', string>> = {};
  const warnings: Record<string, string> = {};
  const sku = form.sku.trim();
  const name = form.name.trim();
  const barcode = form.barcode.trim();
  if (!sku) errors.sku = 'كود الصنف مطلوب';
  else if (items.some((item) => item.id !== ignoreId && item.sku.toLowerCase() === sku.toLowerCase())) errors.sku = 'هذا الكود مستخدم لصنف آخر';
  if (name.length < 2) errors.name = 'اكتب اسمًا من حرفين على الأقل';
  if (!form.unit.trim()) errors.unit = 'اختَر وحدة القياس';
  if (barcode && items.some((item) => item.id !== ignoreId && item.barcode && item.barcode === barcode)) errors.barcode = 'هذا الباركود مسجل لصنف آخر';
  return { errors, warnings };
}

const STEPS = ['بيانات الصنف', 'حقول إضافية'];

function ProductFormWizard({
  form,
  setForm,
  issues,
  units,
  categories,
  warehouses,
  fields,
  fieldValues,
  setFieldValues,
  costPrice,
  onAddCategory,
  onAddUnit,
  onSubmit,
  submitLabel,
}: {
  form: ProductForm;
  setForm: (form: ProductForm) => void;
  issues: ReturnType<typeof productIssues>;
  units: string[];
  categories: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  fields: CustomField[];
  fieldValues: Record<string, string>;
  setFieldValues: (values: Record<string, string>) => void;
  costPrice?: number;
  onAddCategory: (name: string) => Promise<string>;
  onAddUnit: (name: string) => Promise<string>;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const [step, setStep] = useState(0);
  const [categoryName, setCategoryName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [addingUnit, setAddingUnit] = useState(false);
  const blocked = step === 0 && !!(issues.errors.sku || issues.errors.name || issues.errors.barcode || issues.errors.unit);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`rounded-xl px-2 py-2 text-xs font-bold ${index === step ? 'bg-brand-600 text-white' : index < step ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-500'}`}
            onClick={() => {
              if (index > step && blocked) return;
              setStep(index);
            }}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>
      {step === 0 && (
        <div className="space-y-3">
          <Field label="كود الصنف" icon={<Tag size={16} />} error={issues.errors.sku} hint="إجباري ومش يتكرر">
            <Input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="مثال: GZ-001" required />
          </Field>
          <Field label="اسم الصنف" icon={<Package size={16} />} error={issues.errors.name}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="وحدة القياس" icon={<Boxes size={16} />} error={issues.errors.unit} hint="اختَر من القائمة أو أضف وحدة جديدة">
            <Select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}>
              {units.length === 0 && <option value={form.unit || 'كيلو'}>{form.unit || 'كيلو'}</option>}
              {units.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Input value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="وحدة قياس جديدة" />
            <Button
              type="button"
              variant="secondary"
              disabled={addingUnit || !unitName.trim()}
              onClick={async () => {
                if (!unitName.trim()) return;
                setAddingUnit(true);
                try {
                  const name = await onAddUnit(unitName.trim());
                  setForm({ ...form, unit: name });
                  setUnitName('');
                } finally {
                  setAddingUnit(false);
                }
              }}
            >
              <Plus size={16} /> إضافة وحدة
            </Button>
          </div>
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold">وحدات التحويل</div>
                <div className="text-[11px] text-muted">مثال: شيكارة = 50 {form.unit || 'كيلو'} — اختياري حسب المورد</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setForm({ ...form, tradeUnits: [...form.tradeUnits, { name: '', factor: '' }] })}
              >
                <Plus size={14} /> وحدة
              </Button>
            </div>
            {form.tradeUnits.length === 0 ? (
              <div className="text-xs text-muted">لو المورد بيبيع بالكجم مباشرة، سيّب القائمة فاضية.</div>
            ) : (
              form.tradeUnits.map((row, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Select
                      value={row.name}
                      onChange={(event) => {
                        const next = form.tradeUnits.map((item, i) => (i === index ? { ...item, name: event.target.value } : item));
                        setForm({ ...form, tradeUnits: next });
                      }}
                    >
                      <option value="">وحدة التعامل</option>
                      {units.filter((u) => u !== form.unit).map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                      {row.name && !units.includes(row.name) && <option value={row.name}>{row.name}</option>}
                    </Select>
                  </div>
                  <div className="sm:col-span-5">
                    <NumberInput
                      value={row.factor}
                      onValueChange={(value) => {
                        const next = form.tradeUnits.map((item, i) => (i === index ? { ...item, factor: value } : item));
                        setForm({ ...form, tradeUnits: next });
                      }}
                      placeholder={`كم ${form.unit || 'كيلو'}؟`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      className="grid h-10 w-full place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => setForm({ ...form, tradeUnits: form.tradeUnits.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <Field label="الباركود" icon={<Barcode size={16} />} error={issues.errors.barcode}>
            <Input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
          </Field>
          <Field label="التصنيف" icon={<Warehouse size={16} />}>
            <Select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
              <option value="">بدون</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="تصنيف جديد" />
            <Button type="button" variant="secondary" onClick={async () => {
              if (!categoryName.trim()) return;
              const id = await onAddCategory(categoryName.trim());
              setForm({ ...form, categoryId: id });
              setCategoryName('');
            }}>إضافة</Button>
          </div>
          <div>
            <Label>
              <span className="inline-flex items-center gap-1.5"><Warehouse size={15} className="text-slate-400" /> المخازن</span>
            </Label>
            <WarehouseMultiSelect
              warehouses={warehouses}
              value={form.warehouseIds}
              onChange={(warehouseIds) => setForm({ ...form, warehouseIds })}
              hint="اختار مخزن أو أكتر. لو مفيش اختيار، الصنف يبقى لكل المخازن"
            />
          </div>
          {costPrice !== undefined && costPrice > 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="text-muted">سعر التكلفة من آخر شراء</div>
              <div className="font-bold">{formatMoney(costPrice)}</div>
            </div>
          )}
        </div>
      )}
      {step === 1 && (
        fields.length === 0 ? <Empty text="لا حقول إضافية" hint="تقدر تضيفها من إدارة الحقول، والخطوة دي اختيارية" /> : (
          <div className="space-y-3">
            {fields.map((field) => (
              <Field key={field.id} label={field.label}>
                {field.fieldType === 'SELECT' ? (
                  <Select value={fieldValues[field.id] || ''} onChange={(event) => setFieldValues({ ...fieldValues, [field.id]: event.target.value })}>
                    <option value="">—</option>
                    {(field.options || '').split(',').map((option) => option.trim()).filter(Boolean).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    type={field.fieldType === 'NUMBER' ? 'number' : field.fieldType === 'DATE' ? 'date' : 'text'}
                    value={fieldValues[field.id] || ''}
                    onChange={(event) => setFieldValues({ ...fieldValues, [field.id]: event.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        )
      )}
      <div className="mt-4 flex gap-2">
        {step > 0 && <Button type="button" variant="secondary" onClick={() => setStep((current) => current - 1)}>السابق</Button>}
        {step < 1 ? (
          <Button type="button" className="flex-1" disabled={blocked} onClick={() => setStep((current) => current + 1)}>التالي</Button>
        ) : (
          <Button type="button" className="flex-1" onClick={onSubmit}>{submitLabel}</Button>
        )}
      </div>
    </div>
  );
}

export function ProductsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const canImport = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE';
  const [items, setItems] = useState<Product[]>([]);
  const [listPage, setListPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, low: 0, noBarcode: 0, loss: 0, stockValue: 0, units: 0, brands: [] as string[], unitNames: [] as string[] });
  const [fields, setFields] = useState<CustomField[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [measureUnits, setMeasureUnits] = useState<string[]>(['كيلو']);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState(initialQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [createFieldValues, setCreateFieldValues] = useState<Record<string, string>>({});
  const [editForm, setEditForm] = useState({ ...emptyCreate });
  const [editFieldValues, setEditFieldValues] = useState<Record<string, string>>({});
  const [fieldForm, setFieldForm] = useState({
    name: '',
    label: '',
    fieldType: 'TEXT',
    options: '',
  });
  const [listFilter, setListFilter] = useState<'all' | 'low' | 'barcode' | 'loss'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(() => (localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'));

  async function load() {
    const params = new URLSearchParams({ page: String(listPage), pageSize: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    if (listFilter !== 'all') params.set('filter', listFilter);
    const [products, defs, cats, unitRows, wh] = await Promise.all([
      api<{ items: Product[]; total: number; summary: typeof stats }>(`/products?${params}`),
      api<CustomField[]>('/products/fields'),
      api<{ id: string; name: string }[]>('/products/categories'),
      api<{ id: string; name: string }[]>('/products/units'),
      api<{ id: string; name: string }[]>('/warehouses'),
    ]);
    setItems(products.items);
    setTotal(products.total);
    setStats(products.summary);
    setFields(defs);
    setCategories(cats);
    setMeasureUnits(unitRows.map((row) => row.name));
    setWarehouses(wh);
  }

  useEffect(() => { setListPage(1); }, [search, listFilter, pageSize]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(timer);
  }, [listPage, pageSize, search, listFilter]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageFrom = total === 0 ? 0 : (Math.min(listPage, pageCount) - 1) * pageSize + 1;
  const pageTo = Math.min(Math.min(listPage, pageCount) * pageSize, total);
  const productColumns = useColumns('m5azen.cols.products', [
    { id: 'sku', label: 'الكود' },
    { id: 'barcode', label: 'الباركود' },
    { id: 'name', label: 'الاسم' },
    { id: 'category', label: 'القسم' },
    { id: 'cost', label: 'سعر الشراء' },
    { id: 'margin', label: 'نسبة الربح' },
    { id: 'qty', label: 'الرصيد' },
    ...fields.slice(0, 3).map((field) => ({ id: `field-${field.id}`, label: field.label })),
  ]);
  const units = useMemo(() => {
    const set = new Set(measureUnits);
    for (const name of stats.unitNames || []) if (name) set.add(name);
    if (createForm.unit) set.add(createForm.unit);
    if (editForm.unit) set.add(editForm.unit);
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [measureUnits, stats.unitNames, createForm.unit, editForm.unit]);

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: createForm, fields: createFieldValues }));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [createOpen, createForm, createFieldValues]);

  async function exportProducts() {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (listFilter !== 'all') params.set('filter', listFilter);
    const rows = await api<Product[]>(`/products${params.toString() ? `?${params}` : ''}`);
    await exportTableExcel({
      fileName: 'products.xlsx',
      sheetName: 'الأصناف',
      title: 'سجل الأصناف — Green Zone',
      headers: ['الكود', 'الاسم', 'الوحدة', 'الرصيد (ك)'],
      rows: rows.map((product) => [
        product.sku,
        product.name,
        product.unit || 'كيلو',
        product.stockBalances.reduce((sum, row) => sum + row.quantity, 0),
      ]),
    });
  }

  function fieldPayload(values: Record<string, string>) {
    return fields
      .map((f) => ({ fieldId: f.id, value: (values[f.id] || '').trim() }))
      .filter((fv) => fv.value);
  }

  async function uploadProductImage(id: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    const token = localStorage.getItem('m5azen_token');
    const response = await fetch(`${getApiBase()}/api/products/${id}/image`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as { message?: string }));
      throw new Error(payload.message || 'تعذر رفع الصورة');
    }
    return response.json() as Promise<{ imageFile?: string }>;
  }

  async function saveCreate() {
    const problems = productIssues(createForm, items).errors;
    if (problems.sku || problems.name || problems.barcode || problems.unit) {
      toast.error(problems.sku || problems.unit || 'راجع الحقول المظللة قبل الحفظ');
      return;
    }
    try {
      const created = await api<{ id: string }>('/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: createForm.sku.trim(),
          name: createForm.name.trim(),
          unit: createForm.unit.trim() || 'كيلو',
          costPrice: 0,
          salePrice: 0,
          wholesalePrice: 0,
          minStock: 0,
          barcode: createForm.barcode.trim(),
          brand: createForm.brand,
          categoryId: createForm.categoryId || undefined,
          packUnit: null,
          packSize: 1,
          packWeight: null,
          warehouseIds: createForm.warehouseIds,
          tradeUnits: createForm.tradeUnits
            .filter((row) => row.name.trim() && Number(row.factor) > 0)
            .map((row) => ({ name: row.name.trim(), factor: Number(row.factor) })),
          fieldValues: fieldPayload(createFieldValues),
        }),
      });
      if (pendingImage) await uploadProductImage(created.id, pendingImage);
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      setCreateFieldValues({});
      setPendingImage(null);
      localStorage.removeItem(DRAFT_KEY);
      toast.success('تم حفظ الصنف');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ الصنف');
    }
  }

  function openEdit(p: Product) {
    setEditing(p);
    setEditForm({
      sku: p.sku,
      name: p.name,
      unit: p.unit || 'كيلو',
      salePrice: '',
      wholesalePrice: '',
      minStock: '',
      barcode: p.barcode || '',
      brand: p.brand || '',
      categoryId: p.categoryId || '',
      packUnit: '',
      packSize: '',
      packWeight: '',
      warehouseIds: (p.warehouses || []).map((row) => row.warehouseId),
      tradeUnits: (p.tradeUnits || []).map((row) => ({ name: row.name, factor: row.factor })),
    });
    const map: Record<string, string> = {};
    for (const fv of p.fieldValues) map[fv.fieldId] = fv.value;
    setEditFieldValues(map);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editing) return;
    const problems = productIssues(editForm, items, editing.id, editing.costPrice).errors;
    if (problems.sku || problems.name || problems.barcode || problems.unit) {
      toast.error(problems.sku || problems.unit || 'راجع الحقول المظللة قبل الحفظ');
      return;
    }
    try {
      await api(`/products/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sku: editForm.sku.trim(),
          name: editForm.name.trim(),
          unit: editForm.unit.trim() || 'كيلو',
          barcode: editForm.barcode.trim(),
          brand: editForm.brand,
          categoryId: editForm.categoryId || null,
          packUnit: null,
          packSize: 1,
          packWeight: null,
          warehouseIds: editForm.warehouseIds,
          tradeUnits: editForm.tradeUnits
            .filter((row) => row.name.trim() && Number(row.factor) > 0)
            .map((row) => ({ name: row.name.trim(), factor: Number(row.factor) })),
          fieldValues: fieldPayload(editFieldValues),
        }),
      });
      setEditOpen(false);
      setEditing(null);
      toast.success('تم تحديث الصنف');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث الصنف');
    }
  }

  async function saveFieldDef() {
    await api('/products/fields', {
      method: 'POST',
      body: JSON.stringify(fieldForm),
    });
    setFieldForm({ name: '', label: '', fieldType: 'TEXT', options: '' });
    load();
  }

  async function deleteFieldDef(id: string) {
    const ok = await confirm({ title: 'حذف الحقل', message: 'حذف الحقل من كل الأصناف؟', confirmLabel: 'حذف', danger: true });
    if (!ok) return;
    await api(`/products/fields/${id}`, { method: 'DELETE' });
    toast.success('تم حذف الحقل');
    load();
  }

  function openCreate() {
    const raw = localStorage.getItem(DRAFT_KEY);
    let restored = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { form?: ProductForm; fields?: Record<string, string> };
        if (parsed.form && (parsed.form.sku || parsed.form.name || parsed.form.barcode)) {
          setCreateForm({ ...emptyCreate, ...parsed.form });
          setCreateFieldValues(parsed.fields || {});
          restored = true;
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    if (!restored) {
      setCreateForm(emptyCreate);
      setCreateFieldValues({});
    } else toast.info('تم استرجاع المسودة المحفوظة تلقائيًا');
    setCreateOpen(true);
  }

  async function importProducts(file: File) {
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const token = localStorage.getItem('m5azen_token');
      const response = await fetch(`${getApiBase()}/api/products/import-file`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const payload = await response.json().catch(() => ({} as { message?: string | string[]; created?: number; failed?: number; errors?: { message: string }[] }));
      if (!response.ok) {
        const message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
        throw new Error(message || 'تعذر استيراد الملف');
      }
      const created = payload.created || 0;
      const failed = payload.failed || 0;
      if (!created) throw new Error(payload.errors?.[0]?.message || 'لم يُحفظ أي صنف');
      toast.success(failed ? `تم تسجيل ${created} صنف، وتعذر ${failed}` : `تم تسجيل ${created} صنف`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر استيراد الملف');
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function addCategory(name: string) {
    const cat = await api<{ id: string; name: string }>('/products/categories', { method: 'POST', body: JSON.stringify({ name }) });
    setCategories((prev) => (prev.some((row) => row.id === cat.id) ? prev : [...prev, cat]));
    toast.success('تمت إضافة التصنيف');
    return cat.id;
  }

  async function addUnit(name: string) {
    const unit = await api<{ id: string; name: string }>('/products/units', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    setMeasureUnits((prev) => (prev.includes(unit.name) ? prev : [...prev, unit.name]));
    toast.success('تمت إضافة وحدة القياس');
    return unit.name;
  }

  return (
    <div>
      <PageHeader
        title="إضافة أصناف"
        subtitle="أدخل الصنف على خطوات، والجدول يتصفى فورًا"
        actions={
          <>
            {canImport && (
              <>
                <input
                  ref={importRef}
                  className="hidden"
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.docx,.pdf,application/pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importProducts(file);
                  }}
                />
                <Button variant="secondary" disabled={importing} onClick={() => importRef.current?.click()}>
                  <Upload size={16} /> {importing ? 'جاري الاستيراد...' : 'استيراد'}
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={() => setFieldsOpen(true)}><Columns3 size={16} /> إدارة الحقول</Button>
            <Button onClick={openCreate}><Plus size={16} /> إضافة صنف</Button>
          </>
        }
      />
      <StatGrid cols={5}>
        <StatCard label="إجمالي الأصناف" value={stats.total} hint={`${stats.units.toLocaleString('ar-EG')} وحدة في المخازن`} icon={Package} tone="brand" active={listFilter === 'all'} onClick={() => setListFilter('all')} />
        <StatCard label="قيمة المخزون بالتكلفة" value={formatMoney(stats.stockValue)} hint="سعر الشراء × الرصيد" icon={Coins} tone="emerald" />
        <StatCard label="تحت حد الطلب" value={stats.low} hint="تحتاج إعادة شراء" icon={TriangleAlert} tone="amber" active={listFilter === 'low'} onClick={() => setListFilter('low')} />
        <StatCard label="بدون باركود" value={stats.noBarcode} hint="أضف باركود لتسريع البيع" icon={Barcode} tone="sky" active={listFilter === 'barcode'} onClick={() => setListFilter('barcode')} />
        <StatCard label="سعر أقل من التكلفة" value={stats.loss} hint="مراجعة التسعير" icon={TrendingDown} tone="rose" active={listFilter === 'loss'} onClick={() => setListFilter('loss')} />
      </StatGrid>
      <Card>
        <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-slate-100/80 p-1 sm:w-fit">
          {([['all', 'الكل', stats.total], ['low', 'نقص مخزون', stats.low], ['barcode', 'بدون باركود', stats.noBarcode], ['loss', 'سعر خاسر', stats.loss]] as const).map(([key, label, count]) => (
            <button key={key} type="button" onClick={() => setListFilter(key)} className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-bold transition ${listFilter === key ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>
              {label}
              <span className={`rounded-md px-1.5 text-[11px] tabular-nums ${listFilter === key ? 'bg-brand-50 text-brand-700' : 'bg-white/70 text-slate-500'}`}>{count}</span>
            </button>
          ))}
        </div>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder="بحث بالاسم، الكود، الباركود..."
          view={viewMode}
          onView={(mode) => { setViewMode(mode); localStorage.setItem(VIEW_KEY, mode); }}
          onExport={exportProducts}
          columns={productColumns.columns}
          onToggleColumn={productColumns.toggle}
        />
        {items.length === 0 ? <Empty text="لا أصناف مطابقة" hint="غيّر البحث أو الفلتر" /> : viewMode === 'cards' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((product) => {
                const qty = product.stockBalances.reduce((sum, row) => sum + row.quantity, 0);
                const low = product.minStock > 0 && qty <= product.minStock;
                return (
                  <button key={product.id} type="button" className="lift overflow-hidden rounded-2xl border border-slate-200 bg-white text-right" onClick={() => openEdit(product)}>
                    <div className="flex items-center gap-3 p-4">
                      <ProductThumb product={product} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] font-bold text-brand-700" dir="ltr">{product.sku}</div>
                        <div className="mt-0.5 line-clamp-2 font-bold leading-6 text-slate-900">{product.name}</div>
                        <div className="text-xs text-muted">{product.category?.name || product.brand || 'بدون تصنيف'}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-sm">
                      <span className="text-xs font-bold text-muted">{product.unit || 'كيلو'}</span>
                      <Badge tone={low ? 'rose' : 'emerald'}>{qty.toLocaleString('ar-EG')} ك</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
            <Pager page={listPage} pages={pageCount} total={total} from={pageFrom} to={pageTo} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
          </>
        ) : (
          <>
          <Table>
            <thead>
              <tr>
                <Th>الإجراءات</Th>
                {productColumns.visible('sku') && <Th>الكود</Th>}
                {productColumns.visible('barcode') && <Th>الباركود</Th>}
                {productColumns.visible('name') && <Th>الاسم</Th>}
                {productColumns.visible('category') && <Th>القسم</Th>}
                {productColumns.visible('cost') && <Th>سعر الشراء</Th>}
                {productColumns.visible('margin') && <Th>نسبة الربح</Th>}
                {fields.slice(0, 3).map((field) => productColumns.visible(`field-${field.id}`) && <Th key={field.id}>{field.label}</Th>)}
                {productColumns.visible('qty') && <Th>الرصيد</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const qty = p.stockBalances.reduce((s, b) => s + b.quantity, 0);
                const low = p.minStock > 0 && qty <= p.minStock;
                const valueMap = Object.fromEntries(p.fieldValues.map((fv) => [fv.fieldId, fv.value]));
                const margin = p.costPrice > 0 ? `${Math.round(((p.salePrice - p.costPrice) / p.costPrice) * 100)}%` : '—';
                return (
                  <tr key={p.id}>
                    <Td>
                      <IconAction label="تعديل" onClick={() => openEdit(p)}><Pencil size={14} /></IconAction>
                    </Td>
                    {productColumns.visible('sku') && <Td><span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700" dir="ltr">{p.sku}</span></Td>}
                    {productColumns.visible('barcode') && <Td><span className="font-mono text-xs text-slate-500" dir="ltr">{p.barcode || '—'}</span></Td>}
                    {productColumns.visible('name') && (
                      <Td>
                        <div className="flex min-w-[14rem] items-center gap-3">
                          <ProductThumb product={p} />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-slate-900">{p.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold">
                              <span className={`h-1.5 w-1.5 rounded-full ${low ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                              <span className={low ? 'text-rose-600' : 'text-emerald-700'}>{low ? 'تحت حد الطلب' : 'متوفر'}</span>
                              <span className="text-muted">· {p.brand || p.unit}</span>
                            </div>
                          </div>
                        </div>
                      </Td>
                    )}
                    {productColumns.visible('category') && <Td>{p.category?.name ? <Badge tone="brand">{p.category.name}</Badge> : <span className="text-muted">{p.brand || '—'}</span>}</Td>}
                    {productColumns.visible('cost') && <Td className="whitespace-nowrap text-slate-600">{formatMoney(p.costPrice)}</Td>}
                    {productColumns.visible('margin') && <Td><Badge tone={p.costPrice > 0 && p.salePrice < p.costPrice ? 'rose' : 'emerald'}>{margin}</Badge></Td>}
                    {fields.slice(0, 3).map((field) => productColumns.visible(`field-${field.id}`) && (
                      <Td key={field.id}>{valueMap[field.id] || '—'}</Td>
                    ))}
                    {productColumns.visible('qty') && (
                      <Td>
                        <div className="min-w-[6rem]">
                          <div className={`font-extrabold ${low ? 'text-rose-700' : 'text-slate-900'}`}>{qty.toLocaleString('ar-EG')} <span className="text-xs font-semibold text-muted">{p.unit}</span></div>
                          {p.minStock > 0 && (
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full ${low ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.max(6, (qty / (p.minStock * 3)) * 100))}%` }} />
                            </div>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pager page={listPage} pages={pageCount} total={total} from={pageFrom} to={pageTo} pageSize={pageSize} onPageSize={setPageSize} onPage={setListPage} />
          </>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setPendingImage(null); }} title="صنف جديد" wide>
        <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm">
          <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPendingImage(event.target.files?.[0] || null)} />
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-xs text-muted">
            {pendingImage ? <img src={URL.createObjectURL(pendingImage)} alt="" className="h-full w-full object-cover" /> : 'صورة'}
          </span>
          <span>{pendingImage ? pendingImage.name : 'أضف صورة للصنف، وتظهر في نقطة البيع'}</span>
        </label>
        <ProductFormWizard
          form={createForm}
          setForm={setCreateForm}
          issues={productIssues(createForm, items)}
          units={units}
          categories={categories}
          warehouses={warehouses}
          fields={fields}
          fieldValues={createFieldValues}
          setFieldValues={setCreateFieldValues}
          onAddCategory={addCategory}
          onAddUnit={addUnit}
          onSubmit={saveCreate}
          submitLabel="حفظ الصنف"
        />
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="تعديل صنف" wide>
        {editing && (
          <>
          <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm">
            <input
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || !editing) return;
                try {
                  const saved = await uploadProductImage(editing.id, file);
                  setEditing({ ...editing, imageFile: saved.imageFile || editing.imageFile });
                  toast.success('تم حفظ صورة الصنف');
                  load();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'تعذر رفع الصورة');
                }
              }}
            />
            <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-xs text-muted">
              {editing.imageFile ? <img src={productImageUrl(editing.id, editing.imageFile)} alt="" className="h-full w-full object-cover" /> : 'صورة'}
            </span>
            <span>غيّر صورة الصنف لتظهر في نقطة البيع</span>
          </label>
          <ProductFormWizard
            key={editing.id}
            form={editForm}
            setForm={setEditForm}
            issues={productIssues(editForm, items, editing.id, editing.costPrice)}
            units={units}
            categories={categories}
            warehouses={warehouses}
            fields={fields}
            fieldValues={editFieldValues}
            setFieldValues={setEditFieldValues}
            costPrice={editing.costPrice}
            onAddCategory={async (name) => {
              const id = await addCategory(name);
              setEditForm((current) => ({ ...current, categoryId: id }));
              return id;
            }}
            onAddUnit={async (name) => {
              const unit = await addUnit(name);
              setEditForm((current) => ({ ...current, unit }));
              return unit;
            }}
            onSubmit={saveEdit}
            submitLabel="حفظ التعديلات"
          />
          </>
        )}
      </Modal>

      <Modal open={fieldsOpen} onClose={() => setFieldsOpen(false)} title="إدارة حقول الأصناف" wide>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            حقول عامة اختيارية لكل الأصناف. الصنف اللي مش محتاج حقل معيّن يسيبه فاضي.
            بيانات التشغيلة والصلاحية تُدخل في فاتورة الشراء وليست هنا.
          </p>
          {fields.length === 0 ? <Empty text="لا توجد حقول بعد" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>الاسم الداخلي</Th>
                  <Th>العنوان</Th>
                  <Th>النوع</Th>
                  <Th>خيارات</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <Td className="font-mono text-xs">{f.name}</Td>
                    <Td>{f.label}</Td>
                    <Td>{f.fieldType}</Td>
                    <Td>{f.options || '—'}</Td>
                    <Td>
                      <button type="button" className="text-xs text-rose-600" onClick={() => deleteFieldDef(f.id)}>حذف</button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
            <div>
              <Label>الاسم الداخلي (إنجليزي)</Label>
              <Input value={fieldForm.name} onChange={(e) => setFieldForm({ ...fieldForm, name: e.target.value })} placeholder="brand" />
            </div>
            <div>
              <Label>العنوان الظاهر</Label>
              <Input value={fieldForm.label} onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })} placeholder="الماركة" />
            </div>
            <div>
              <Label>النوع</Label>
              <Select value={fieldForm.fieldType} onChange={(e) => setFieldForm({ ...fieldForm, fieldType: e.target.value })}>
                <option value="TEXT">نص</option>
                <option value="NUMBER">رقم</option>
                <option value="DATE">تاريخ</option>
                <option value="SELECT">قائمة</option>
              </Select>
            </div>
            {fieldForm.fieldType === 'SELECT' && (
              <div>
                <Label>الخيارات (مفصولة بفاصلة)</Label>
                <Input value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button onClick={saveFieldDef}>إضافة حقل</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
