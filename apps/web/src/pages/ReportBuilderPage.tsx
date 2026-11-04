import { useEffect, useState } from 'react';
import {
  Bookmark, Check, Copy, FileBarChart, FileSpreadsheet, Play, Printer, Save, SlidersHorizontal, Table as TableIcon, Trash2,
} from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { useConfirm, useToast } from '../lib/feedback';
import { Button, Card, CardHeader, Empty, Input, Label, PageHeader, Select, Table, Td, Th } from '../components/ui';

type Field = { key: string; label: string };
type Spec = { key: string; label: string; fields: Field[]; groups: string[]; statuses: string[] };
type Definition = {
  module: string;
  fields: string[];
  from?: string;
  to?: string;
  groupBy?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: { status?: string; activeOnly?: boolean; balanceOnly?: boolean };
};
type Preview = {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
  totalRows: number;
  truncated: boolean;
  sums: Record<string, number>;
};
type Saved = { id: string; name: string; definition: string; ownerName?: string | null; updatedAt: string };

export function ReportBuilderPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [modules, setModules] = useState<Spec[]>([]);
  const [definition, setDefinition] = useState<Definition>({ module: 'sales', fields: [] });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const spec = modules.find((item) => item.key === definition.module);

  useEffect(() => {
    api<{ modules: Spec[] }>('/work/catalog').then((data) => {
      setModules(data.modules);
      const first = data.modules[0];
      if (first) setDefinition({ module: first.key, fields: first.fields.map((field) => field.key), sortDir: 'desc' });
    }).catch((err) => setError(err instanceof Error ? err.message : 'تعذر تحميل الوحدات'));
    api<Saved[]>('/work/reports').then(setSaved).catch(() => setSaved([]));
  }, []);

  function toggleField(key: string) {
    setDefinition((current) => {
      const fields = current.fields.includes(key) ? current.fields.filter((item) => item !== key) : [...current.fields, key];
      return { ...current, fields };
    });
  }

  async function run(next = definition) {
    setBusy(true);
    setError('');
    try {
      const data = await api<Preview>('/work/reports/run', {
        method: 'POST',
        body: JSON.stringify({ definition: JSON.stringify(next) }),
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تشغيل التقرير');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      setError('اكتب اسم التقرير قبل الحفظ');
      return;
    }
    try {
      const row = await api<Saved>('/work/reports', {
        method: 'POST',
        body: JSON.stringify({ name, definition: JSON.stringify(definition) }),
      });
      setSaved((list) => [row, ...list]);
      setName('');
      toast.success('تم حفظ التقرير');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حفظ التقرير');
    }
  }

  async function openSaved(row: Saved) {
    const parsed = JSON.parse(row.definition) as Definition;
    setDefinition(parsed);
    await run(parsed);
  }

  async function duplicate(id: string) {
    try {
      const row = await api<Saved>(`/work/reports/${id}/duplicate`, { method: 'POST' });
      setSaved((list) => [row, ...list]);
      toast.success('تم نسخ التقرير');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر نسخ التقرير');
    }
  }

  async function remove(row: Saved) {
    if (!(await confirm({ title: 'حذف التقرير', message: `هل تريد حذف "${row.name}"؟`, confirmLabel: 'حذف', danger: true }))) return;
    try {
      await api(`/work/reports/${row.id}`, { method: 'DELETE' });
      setSaved((list) => list.filter((item) => item.id !== row.id));
      toast.success('تم حذف التقرير');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر حذف التقرير');
    }
  }

  async function download(format: 'csv' | 'xlsx') {
    const blob = await api<Blob>('/work/reports/export', {
      method: 'POST',
      body: JSON.stringify({ format, definition: JSON.stringify(definition) }),
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = format === 'csv' ? 'report.csv' : 'report.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title="منشئ التقارير" subtitle="اختر الوحدة والحقول والفلاتر، ثم عاين واحفظ وصدّر من البيانات المحفوظة" />
      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader title="إعداد التقرير" subtitle="الوحدة والحقول والفلاتر" icon={SlidersHorizontal} />
          <div className="space-y-3">
            <div>
              <Label>الوحدة</Label>
              <Select value={definition.module} onChange={(event) => {
                const next = modules.find((item) => item.key === event.target.value);
                setDefinition({ module: event.target.value, fields: next?.fields.map((field) => field.key) || [], sortDir: 'desc' });
                setPreview(null);
              }}>
                {modules.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </Select>
            </div>
            <div>
              <Label>الحقول</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {spec?.fields.map((field) => {
                  const on = definition.fields.includes(field.key);
                  return (
                    <button key={field.key} type="button" aria-pressed={on} onClick={() => toggleField(field.key)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {on && <Check size={12} />}{field.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {(definition.module === 'sales' || definition.module === 'purchases') && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>من</Label><Input type="date" value={definition.from || ''} onChange={(event) => setDefinition({ ...definition, from: event.target.value })} /></div>
                  <div><Label>إلى</Label><Input type="date" value={definition.to || ''} onChange={(event) => setDefinition({ ...definition, to: event.target.value })} /></div>
                </div>
                <div>
                  <Label>حالة الفاتورة</Label>
                  <Select value={definition.filters?.status || ''} onChange={(event) => setDefinition({ ...definition, filters: { ...definition.filters, status: event.target.value } })}>
                    <option value="">الكل</option>
                    {spec?.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </Select>
                </div>
              </>
            )}
            {definition.module === 'customers' && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!definition.filters?.balanceOnly} onChange={(event) => setDefinition({ ...definition, filters: { ...definition.filters, balanceOnly: event.target.checked } })} /> عليهم رصيد فقط</label>
            )}
            {(definition.module === 'customers' || definition.module === 'products') && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!definition.filters?.activeOnly} onChange={(event) => setDefinition({ ...definition, filters: { ...definition.filters, activeOnly: event.target.checked } })} /> النشطون فقط</label>
            )}
            <div>
              <Label>تجميع</Label>
              <Select value={definition.groupBy || ''} onChange={(event) => setDefinition({ ...definition, groupBy: event.target.value || undefined })}>
                <option value="">بدون تجميع</option>
                {spec?.groups.map((group) => <option key={group} value={group}>{group}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>ترتيب</Label>
                <Select value={definition.sortBy || ''} onChange={(event) => setDefinition({ ...definition, sortBy: event.target.value })}>
                  <option value="">افتراضي</option>
                  {spec?.fields.filter((field) => definition.fields.includes(field.key)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                </Select>
              </div>
              <div>
                <Label>الاتجاه</Label>
                <Select value={definition.sortDir || 'desc'} onChange={(event) => setDefinition({ ...definition, sortDir: event.target.value as 'asc' | 'desc' })}>
                  <option value="desc">تنازلي</option>
                  <option value="asc">تصاعدي</option>
                </Select>
              </div>
            </div>
            <Button className="w-full" disabled={busy} onClick={() => run()}>{busy ? 'جارٍ التوليد' : 'معاينة'}</Button>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="المعاينة"
              subtitle={preview ? `${preview.totalRows} صف` : 'شغّل المعاينة لعرض النتائج'}
              icon={TableIcon}
              actions={
                <>
                  <Button size="sm" variant="secondary" disabled={!preview} onClick={() => download('xlsx')}><FileSpreadsheet size={14} /> Excel</Button>
                  <Button size="sm" variant="secondary" disabled={!preview} onClick={() => download('csv')}>CSV</Button>
                  <Button size="sm" variant="secondary" disabled={!preview} onClick={() => window.print()}><Printer size={14} /> طباعة / PDF</Button>
                </>
              }
            />
            {!preview ? <Empty text="شغّل المعاينة لعرض الصفوف من قاعدة البيانات" /> : preview.rows.length === 0 ? <Empty text="لا صفوف مطابقة" /> : (
              <>
                {preview.truncated && <p className="mb-2 text-xs text-amber-700">عُرض أول 1000 صف فقط</p>}
                <Table>
                  <thead><tr>{preview.columns.map((column) => <Th key={column.key}>{column.label}</Th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={index}>{preview.columns.map((column) => <Td key={column.key}>{typeof row[column.key] === 'number' ? formatMoney(Number(row[column.key])) : String(row[column.key] ?? '')}</Td>)}</tr>
                    ))}
                  </tbody>
                </Table>
                {Object.keys(preview.sums).length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {Object.entries(preview.sums).map(([key, value]) => (
                      <div key={key} className="rounded-xl bg-brand-50 px-3 py-2">
                        <div className="text-xs text-brand-700">إجمالي {preview.columns.find((column) => column.key === key)?.label || key}</div>
                        <div className="font-extrabold tabular-nums text-brand-900">{formatMoney(value)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="تقارير محفوظة" subtitle={`${saved.length} تقرير`} icon={Bookmark} />
            <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
              <Input value={name} placeholder="اسم التقرير الحالي" onChange={(event) => setName(event.target.value)} />
              <Button type="submit"><Save size={15} /> حفظ</Button>
            </form>
            {saved.length === 0 ? <Empty text="لا تقارير محفوظة" /> : (
              <div className="space-y-2">
                {saved.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 transition hover:border-brand-200">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700"><FileBarChart size={16} /></span>
                      <div>
                        <div className="text-sm font-bold text-slate-800">{row.name}</div>
                        <div className="text-xs text-muted">{row.ownerName || ''} · {formatDate(row.updatedAt)}</div>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="soft" onClick={() => openSaved(row)}><Play size={13} /> تشغيل</Button>
                      <Button size="sm" variant="ghost" onClick={() => duplicate(row.id)}><Copy size={13} /> نسخ</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(row)}><Trash2 size={13} /> حذف</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
