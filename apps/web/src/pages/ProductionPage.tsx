import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Check, Factory, Plus, Printer, SkipForward, Trash2, Warehouse,
} from 'lucide-react';
import { api, formatDate, formatMoney } from '../lib/api';
import { triggerPdfSave, triggerPrint } from '../lib/docExport';
import { useAccess } from '../lib/auth';
import { useConfirm, useToast } from '../lib/feedback';
import { DocExportBar } from '../components/DocExportBar';
import { ProductPicker } from '../components/ProductPicker';
import { DualPrintCopies } from '../components/DualPrintCopies';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  Input,
  Label,
  Modal,
  NumberInput,
  PageHeader,
  PageSkeleton,
  PrintHeader,
  StatCard,
  StatGrid,
  Table,
  Td,
  Th,
} from '../components/ui';

type StageKind = 'PRINTING' | 'LAMINATION' | 'SLITTER' | 'CORE' | 'DETAILING';
type JobStatus = 'OPEN' | 'PRINTING' | 'LAMINATION' | 'SLITTER' | 'CORE' | 'DETAILING' | 'READY' | 'DONE' | 'CANCELLED';

type Product = { id: string; sku: string; name: string; unit?: string | null; costPrice?: number };
type RawStock = { warehouse: { id: string; name: string }; items: { productId: string; quantity: number; product: Product }[] };

type CostLine = { costTypeId?: string | null; label: string; amount: number };
type MatLine = { productId: string; quantity: number; unitCost?: number; product?: Product };

type Stage = {
  kind: StageKind;
  skipped: boolean;
  qtyAfter?: number | null;
  weightBefore?: number | null;
  weightAfter?: number | null;
  wasteQty: number;
  increaseQty?: number;
  pricePerKg?: number | null;
  coreCount?: number | null;
  coreUnitWeight?: number | null;
  bagCount?: number | null;
  bagUnitWeight?: number | null;
  netQty?: number | null;
  notes?: string | null;
  completedAt?: string | null;
  costs: CostLine[];
  materials: (MatLine & { product: Product })[];
};

type Report = {
  issuedCost: number;
  stagesCost: number;
  grandTotal: number;
  totalWaste: number;
  totalIncrease?: number;
  firstWeight?: number | null;
  finalWeight?: number | null;
  costPerKg?: number | null;
  netWeightLoss?: number | null;
  weightFlow?: { stage: string; in: number | null; out: number | null; waste: number; increase?: number; lossPct: number | null }[];
  stageReports: {
    kind: StageKind;
    label: string;
    skipped: boolean;
    completed: boolean;
    qtyAfter: number | null;
    weightBefore: number | null;
    weightAfter: number | null;
    carriedFrom?: number | null;
    wasteQty: number;
    increaseQty?: number;
    pricePerKg?: number | null;
    coreCount?: number | null;
    coreUnitWeight?: number | null;
    coreTotal?: number | null;
    bagCount?: number | null;
    bagUnitWeight?: number | null;
    netQty?: number | null;
    lossPct?: number | null;
    notes?: string | null;
    costs: CostLine[];
    costsTotal: number;
    materials: (MatLine & { product: Product })[];
    materialsTotal: number;
    stageTotal: number;
  }[];
  allCosts: (CostLine & { stage: string; kind?: string })[];
  allWaste: { stage: string; wasteQty: number; increaseQty?: number; skipped: boolean; lossPct?: number | null; weightBefore?: number | null; weightAfter?: number | null }[];
  allMaterials: { stage: string; name: string; sku: string; quantity: number; unitCost: number; total: number }[];
  transfer?: { qty: number | null; salePrice: number | null; unitCost: number | null; totalCost: number | null };
};

type Job = {
  id: string;
  number: string;
  status: JobStatus;
  title?: string | null;
  notes?: string | null;
  createdAt: string;
  transferQty?: number | null;
  salePrice?: number | null;
  unitCost?: number | null;
  rawWarehouse: { id: string; name: string };
  finishedWarehouse: { id: string; name: string };
  finishedProduct?: Product | null;
  issues: { productId: string; quantity: number; unitCost: number; product: Product }[];
  stages: Stage[];
  report: Report;
  stageLabels: Record<StageKind, string>;
  incomingWeight?: number | null;
  issuedWeight?: number | null;
  currentKind?: StageKind | null;
};

type JobListItem = {
  id: string;
  number: string;
  status: JobStatus;
  title?: string | null;
  createdAt: string;
  finishedProduct?: { name: string } | null;
  issues: { product: { name: string } }[];
  stages: { kind: StageKind; skipped: boolean; completedAt?: string | null; wasteQty: number }[];
};

const STAGE_ORDER: StageKind[] = ['PRINTING', 'LAMINATION', 'SLITTER', 'CORE', 'DETAILING'];
const STATUS_LABEL: Record<JobStatus, string> = {
  OPEN: 'مسودة',
  PRINTING: 'طباعة',
  LAMINATION: 'تبطين',
  SLITTER: 'سلتير',
  CORE: 'حساب الكور',
  DETAILING: 'تفصيل',
  READY: 'جاهز لأمر التصنيع',
  DONE: 'تم أمر التصنيع',
  CANCELLED: 'ملغى',
};

type DraftMat = { productId: string; quantity: number | '' };
const emptyMat = (): DraftMat => ({ productId: '', quantity: '' });

type StageForm = {
  weightBefore: number | '';
  weightAfter: number | '';
  wasteQty: number | '';
  increaseQty: number | '';
  pricePerKg: number | '';
  coreCount: number | '';
  coreUnitWeight: number | '';
  bagCount: number | '';
  bagUnitWeight: number | '';
  netQty: number | '';
  notes: string;
  materials: DraftMat[];
};

function num(v: number | '' | null | undefined) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function diffWasteIncrease(before: number | null, after: number | null) {
  if (before == null || after == null) return { wasteQty: 0, increaseQty: 0 };
  const d = round2(after - before);
  if (d >= 0) return { wasteQty: 0, increaseQty: d };
  return { wasteQty: Math.abs(d), increaseQty: 0 };
}

export function ProductionPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { see } = useAccess();
  const showCost = see('production', 'cost');

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [rawStock, setRawStock] = useState<RawStock | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [boxLines, setBoxLines] = useState<{ productId: string; quantity: number | '' }[]>([{ productId: '', quantity: '' }]);

  const [stageForm, setStageForm] = useState<StageForm>({
    weightBefore: '',
    weightAfter: '',
    wasteQty: '',
    increaseQty: '',
    pricePerKg: '',
    coreCount: '',
    coreUnitWeight: '',
    bagCount: '',
    bagUnitWeight: '',
    netQty: '',
    notes: '',
    materials: [emptyMat()],
  });

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    productName: '',
    quantity: '' as number | '',
    salePrice: '' as number | '',
  });

  async function loadList() {
    setLoadError('');
    try {
      await api('/production/warehouses/ensure', { method: 'POST' }).catch(() => null);
      const [j, stock] = await Promise.all([
        api<JobListItem[]>('/production/mfg/jobs'),
        api<RawStock>('/production/mfg/raw-stock'),
      ]);
      setJobs(j);
      setRawStock(stock);
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'تعذر التحميل');
      setLoaded(true);
    }
  }

  function prefillStage(row: Job): StageForm {
    const incoming = row.incomingWeight ?? row.issuedWeight ?? null;
    const current = row.stages.find((s) => s.kind === row.currentKind);
    const weightBefore =
      current?.weightBefore != null
        ? current.weightBefore
        : incoming != null
          ? incoming
          : '';
    return {
      weightBefore: weightBefore as number | '',
      weightAfter: '',
      wasteQty: '',
      increaseQty: '',
      pricePerKg: '',
      coreCount: '',
      coreUnitWeight: '',
      bagCount: '',
      bagUnitWeight: '',
      netQty: '',
      notes: '',
      materials: [emptyMat()],
    };
  }

  async function openJob(id: string) {
    const row = await api<Job>(`/production/mfg/jobs/${id}`);
    setJob(row);
    setStageForm(prefillStage(row));
  }

  useEffect(() => { loadList().catch(() => undefined); }, []);

  const currentKind = useMemo(() => {
    if (!job) return null;
    if (job.status === 'PRINTING') return 'PRINTING' as StageKind;
    if (job.status === 'LAMINATION') return 'LAMINATION' as StageKind;
    if (job.status === 'SLITTER') return 'SLITTER' as StageKind;
    if (job.status === 'CORE') return 'CORE' as StageKind;
    if (job.status === 'DETAILING') return 'DETAILING' as StageKind;
    return null;
  }, [job]);

  const products = useMemo(
    () => (rawStock?.items || []).map((row) => row.product),
    [rawStock],
  );

  function availableOf(productId: string) {
    return rawStock?.items.find((row) => row.productId === productId)?.quantity || 0;
  }

  const materialsWeight = useMemo(
    () => stageForm.materials.reduce((s, m) => s + (Number(m.quantity) || 0), 0),
    [stageForm.materials],
  );

  const weightBeforeNum = num(stageForm.weightBefore);
  const currentTotalWeight =
    currentKind === 'LAMINATION' && weightBeforeNum != null
      ? round2(weightBeforeNum + materialsWeight)
      : weightBeforeNum;

  const coreTotal =
    num(stageForm.coreCount) != null && num(stageForm.coreUnitWeight) != null
      ? round2(Number(stageForm.coreCount) * Number(stageForm.coreUnitWeight))
      : null;

  const bagNet =
    num(stageForm.bagCount) != null && num(stageForm.bagUnitWeight) != null
      ? round2(Number(stageForm.bagCount) * Number(stageForm.bagUnitWeight))
      : null;

  const printCostTotal =
    currentKind === 'PRINTING' && num(stageForm.pricePerKg) != null && (num(stageForm.weightAfter) ?? weightBeforeNum) != null
      ? round2((num(stageForm.weightAfter) ?? weightBeforeNum)! * Number(stageForm.pricePerKg))
      : null;

  const detailingCostTotal =
    currentKind === 'DETAILING' && num(stageForm.pricePerKg) != null && bagNet != null
      ? round2(bagNet * Number(stageForm.pricePerKg))
      : null;

  function applyAfterWeight(after: number | '', base: number | null) {
    const afterN = num(after);
    const { wasteQty, increaseQty } = diffWasteIncrease(base, afterN);
    setStageForm((prev) => ({
      ...prev,
      weightAfter: after,
      wasteQty: afterN == null ? '' : wasteQty,
      increaseQty: afterN == null ? '' : increaseQty,
    }));
  }

  function setMaterials(materials: DraftMat[]) {
    setStageForm((prev) => {
      const matsWeight = materials.reduce((s, m) => s + (Number(m.quantity) || 0), 0);
      const before = num(prev.weightBefore);
      const base = before != null ? round2(before + matsWeight) : null;
      const after = num(prev.weightAfter);
      const diff = diffWasteIncrease(base, after);
      return {
        ...prev,
        materials,
        wasteQty: after == null ? prev.wasteQty : diff.wasteQty,
        increaseQty: after == null ? prev.increaseQty : diff.increaseQty,
      };
    });
  }

  function patchCore(patch: Partial<StageForm>) {
    setStageForm((prev) => {
      const next = { ...prev, ...patch };
      const before = num(next.weightBefore);
      const count = num(next.coreCount);
      const unit = num(next.coreUnitWeight);
      if (before != null && count != null && unit != null) {
        const total = round2(count * unit);
        next.weightAfter = round2(before + total);
        next.increaseQty = total;
        next.wasteQty = 0;
      }
      return next;
    });
  }

  function patchBags(patch: Partial<StageForm>) {
    setStageForm((prev) => {
      const next = { ...prev, ...patch };
      const before = num(next.weightBefore);
      const count = num(next.bagCount);
      const unit = num(next.bagUnitWeight);
      if (count != null && unit != null) {
        const net = round2(count * unit);
        next.netQty = net;
        next.weightAfter = net;
        if (before != null) {
          next.wasteQty = Math.max(0, round2(before - net));
          next.increaseQty = 0;
        }
      }
      return next;
    });
  }

  async function createJob() {
    const issues = boxLines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (!issues.length) {
      toast.error('اختر خامات وكميات للصرف');
      return;
    }
    setBusy(true);
    try {
      const created = await api<Job>('/production/mfg/jobs', {
        method: 'POST',
        body: JSON.stringify({ title: createTitle.trim() || undefined, notes: createNotes.trim() || undefined, issues }),
      });
      toast.success('تم صرف الخامات وبدأت مرحلة الطباعة');
      setCreateOpen(false);
      setCreateTitle('');
      setCreateNotes('');
      setBoxLines([{ productId: '', quantity: '' }]);
      await loadList();
      setJob(created);
      setStageForm(prefillStage(created));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إنشاء الأمر');
    } finally {
      setBusy(false);
    }
  }

  async function completeCurrent(skip = false) {
    if (!job || !currentKind) return;

    const costs: { label: string; amount: number }[] = [];
    if (!skip && currentKind === 'PRINTING' && printCostTotal != null && printCostTotal !== 0) {
      costs.push({ label: 'طباعة', amount: printCostTotal });
    }
    if (!skip && currentKind === 'DETAILING' && detailingCostTotal != null && detailingCostTotal !== 0) {
      costs.push({ label: 'تفصيل', amount: detailingCostTotal });
    }

    const materials = currentKind === 'LAMINATION'
      ? stageForm.materials
        .filter((m) => m.productId && Number(m.quantity) > 0)
        .map((m) => ({ productId: m.productId, quantity: Number(m.quantity) }))
      : [];

    const ok = await confirm({
      title: skip ? 'تخطي التفصيل' : `إتمام مرحلة ${job.stageLabels[currentKind]}`,
      message: skip
        ? 'هتتخطي مرحلة التفصيل وتنتقل مباشرة لأمر التصنيع؟'
        : 'هيتسجّل الأوزان والهالك/الزيادة والتكاليف.',
      confirmLabel: skip ? 'تخطي' : 'المرحلة التالية',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const updated = await api<Job>(`/production/mfg/jobs/${job.id}/stages/${currentKind}`, {
        method: 'POST',
        body: JSON.stringify({
          skip,
          weightBefore: stageForm.weightBefore === '' ? undefined : Number(stageForm.weightBefore),
          weightAfter: stageForm.weightAfter === '' ? undefined : Number(stageForm.weightAfter),
          wasteQty: stageForm.wasteQty === '' ? 0 : Number(stageForm.wasteQty),
          increaseQty: stageForm.increaseQty === '' ? 0 : Number(stageForm.increaseQty),
          pricePerKg: stageForm.pricePerKg === '' ? undefined : Number(stageForm.pricePerKg),
          coreCount: stageForm.coreCount === '' ? undefined : Number(stageForm.coreCount),
          coreUnitWeight: stageForm.coreUnitWeight === '' ? undefined : Number(stageForm.coreUnitWeight),
          bagCount: stageForm.bagCount === '' ? undefined : Number(stageForm.bagCount),
          bagUnitWeight: stageForm.bagUnitWeight === '' ? undefined : Number(stageForm.bagUnitWeight),
          netQty: stageForm.netQty === '' ? (bagNet ?? undefined) : Number(stageForm.netQty),
          qtyAfter: bagNet ?? undefined,
          notes: stageForm.notes.trim() || undefined,
          costs: skip ? [] : costs,
          materials: skip ? [] : materials,
        }),
      });
      toast.success(skip ? 'تم تخطي التفصيل' : 'تم حفظ المرحلة');
      setJob(updated);
      setStageForm(prefillStage(updated));
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر حفظ المرحلة');
    } finally {
      setBusy(false);
    }
  }

  async function doTransfer() {
    if (!job) return;
    const quantity = Number(transferForm.quantity);
    const salePrice = Number(transferForm.salePrice);
    if (!(quantity > 0)) {
      toast.error('أدخل كمية / وزن المنتج في أمر التصنيع');
      return;
    }
    setBusy(true);
    try {
      const updated = await api<Job>(`/production/mfg/jobs/${job.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          quantity,
          salePrice: salePrice || 0,
          productName: transferForm.productName.trim() || job.title || undefined,
        }),
      });
      toast.success('تم إنشاء أمر التصنيع وإضافة المنتج');
      setTransferOpen(false);
      setJob(updated);
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحويل');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <PageSkeleton />;
  if (loadError) return <ErrorState text={loadError} onRetry={() => loadList()} />;

  const transferCostPerKg =
    job?.report.costPerKg
    ?? (job && transferForm.quantity && Number(transferForm.quantity) > 0
      ? round2(job.report.grandTotal / Number(transferForm.quantity))
      : null);

  return (
    <div>
      <PageHeader
        title="مراحل التصنيع"
        subtitle="صرف خام → طباعة → تبطين → سلتير → حساب الكور → تفصيل → أمر تصنيع"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> أمر تصنيع جديد
          </Button>
        }
      />

      <StatGrid>
        <StatCard label="أوامر مفتوحة" value={jobs.filter((j) => !['DONE', 'CANCELLED'].includes(j.status)).length} icon={Factory} tone="brand" />
        <StatCard label="جاهزة لأمر التصنيع" value={jobs.filter((j) => j.status === 'READY').length} icon={Warehouse} tone="amber" />
        <StatCard label="تم أمر التصنيع" value={jobs.filter((j) => j.status === 'DONE').length} icon={Check} tone="emerald" />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card>
          <h3 className="mb-3 text-sm font-extrabold">أوامر التصنيع</h3>
          {jobs.length === 0 ? (
            <Empty text="لا أوامر بعد" hint="ابدأ بصرف خامات في بوكس تصنيع" />
          ) : (
            <div className="space-y-2">
              {jobs.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openJob(row.id).catch((e) => toast.error(e instanceof Error ? e.message : 'تعذر الفتح'))}
                  className={`w-full rounded-xl border px-3 py-3 text-right transition ${job?.id === row.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-brand-700" dir="ltr">{row.number}</span>
                    <Badge tone={row.status === 'DONE' ? 'emerald' : row.status === 'READY' ? 'amber' : 'brand'}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-sm font-bold">{row.title || row.issues.map((i) => i.product.name).join(' · ')}</div>
                  <div className="mt-1 text-[11px] text-muted">{formatDate(row.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {!job ? (
          <Card>
            <Empty text="اختر أمر تصنيع" hint="أو أنشئ أمرًا جديدًا بصرف خامات من مخزن الخام" />
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-bold text-brand-700" dir="ltr">{job.number}</div>
                  <h2 className="text-xl font-extrabold">{job.title || 'أمر تصنيع'}</h2>
                  <div className="mt-1 text-sm text-muted">
                    {job.rawWarehouse.name} → {job.finishedWarehouse.name}
                  </div>
                </div>
                <Badge tone={job.status === 'DONE' ? 'emerald' : job.status === 'READY' ? 'amber' : 'brand'}>
                  {STATUS_LABEL[job.status]}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {STAGE_ORDER.map((kind, index) => {
                  const stage = job.stages.find((s) => s.kind === kind);
                  const active = currentKind === kind;
                  const done = !!stage?.completedAt;
                  return (
                    <div
                      key={kind}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                        done ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : active ? 'border-brand-600 bg-brand-50 text-brand-800'
                            : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {index + 1}. {job.stageLabels[kind] || STATUS_LABEL[kind]}
                      {stage?.skipped ? ' (تخطى)' : done ? ' ✓' : active ? ' ←' : ''}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-extrabold">بوكس الخامات المصروفة</h3>
              <Table>
                <thead>
                  <tr><Th>الخامة</Th><Th>الكمية / الوزن</Th>{showCost && <Th>التكلفة</Th>}</tr>
                </thead>
                <tbody>
                  {job.issues.map((line) => (
                    <tr key={line.productId}>
                      <Td className="font-bold">{line.product.name}</Td>
                      <Td>{line.quantity} {line.product.unit || ''}</Td>
                      {showCost && <Td>{formatMoney(line.quantity * line.unitCost)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {(job.issuedWeight != null || job.incomingWeight != null) && (
                <div className="mt-2 text-sm font-bold text-brand-800">
                  إجمالي وزن الصرف: {job.issuedWeight ?? job.issues.reduce((s, i) => s + i.quantity, 0)}
                </div>
              )}
            </Card>

            {currentKind && (
              <Card>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-extrabold">مرحلة {job.stageLabels[currentKind]}</h3>
                  <div className="no-print flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => triggerPrint()}>
                      <Printer size={14} /> طباعة نموذج المرحلة
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void triggerPdfSave(`مرحلة-${job.stageLabels[currentKind]}-${job.number}.pdf`)}>
                      تنزيل PDF
                    </Button>
                  </div>
                </div>
                <p className="mb-4 text-sm text-muted">
                  الأوزان بالكيلو (ك). الوزن قبل يأتي تلقائيًا من المرحلة السابقة. تقدر تطبع النموذج فاضي بدون إدخال بيانات.
                </p>

                {currentKind === 'LAMINATION' && (
                  <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <Label>مواد الخام (تزيد على الوزن الحالي)</Label>
                    <p className="mb-2 text-xs text-muted">هتنقص من مخزن الخام عند إتمام المرحلة وتُضاف لإجمالي الوزن الحالي</p>
                    <div className="space-y-2">
                      {stageForm.materials.map((mat, index) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
                          <ProductPicker
                            products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
                            value={mat.productId}
                            onChange={(productId) => setMaterials(
                              stageForm.materials.map((m, i) => (i === index ? { ...m, productId } : m)),
                            )}
                            placeholder="اختر خامة"
                          />
                          <div>
                            <NumberInput
                              value={mat.quantity}
                              onValueChange={(v) => setMaterials(
                                stageForm.materials.map((m, i) => (i === index ? { ...m, quantity: v } : m)),
                              )}
                            />
                            {mat.productId && (
                              <div className="mt-1 text-[11px] text-muted">المتاح: {availableOf(mat.productId)}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            onClick={() => setMaterials(
                              stageForm.materials.length === 1 ? [emptyMat()] : stageForm.materials.filter((_, i) => i !== index),
                            )}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <Button type="button" size="sm" variant="ghost" onClick={() => setMaterials([...stageForm.materials, emptyMat()])}>
                        <Plus size={14} /> مادة
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg bg-white px-3 py-2 text-sm">الوزن قبل: <b>{weightBeforeNum ?? '—'}</b></div>
                      <div className="rounded-lg bg-white px-3 py-2 text-sm">وزن المواد: <b>{materialsWeight}</b></div>
                      <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-bold text-brand-900">إجمالي الوزن الحالي: {currentTotalWeight ?? '—'}</div>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="الوزن قبل (ك)">
                    <NumberInput
                      value={stageForm.weightBefore}
                      onValueChange={(v) => {
                        if (currentKind === 'CORE') patchCore({ weightBefore: v });
                        else if (currentKind === 'DETAILING') patchBags({ weightBefore: v });
                        else {
                          setStageForm((prev) => ({ ...prev, weightBefore: v }));
                          const base = currentKind === 'LAMINATION'
                            ? (num(v) != null ? round2(Number(v) + materialsWeight) : null)
                            : num(v);
                          if (num(stageForm.weightAfter) != null) applyAfterWeight(stageForm.weightAfter, base);
                        }
                      }}
                      readOnly={currentKind !== 'PRINTING'}
                    />
                  </Field>

                  {currentKind !== 'CORE' && currentKind !== 'DETAILING' && (
                    <Field label="الوزن بعد (ك)">
                      <NumberInput
                        value={stageForm.weightAfter}
                        onValueChange={(v) => applyAfterWeight(v, currentTotalWeight)}
                      />
                    </Field>
                  )}

                  {currentKind !== 'CORE' && (
                    <>
                      <Field label="الهالك (ك)">
                        <NumberInput value={stageForm.wasteQty} onValueChange={() => undefined} readOnly />
                      </Field>
                      <Field label="الزيادة (ك)">
                        <NumberInput value={stageForm.increaseQty} onValueChange={() => undefined} readOnly />
                      </Field>
                    </>
                  )}
                </div>

                {/* نموذج طباعة للمرحلة الحالية — يظهر فاضي حتى بدون بيانات */}
                <div className="print-only mt-4 hidden print:block">
                  <PrintHeader title={`نموذج مرحلة ${job.stageLabels[currentKind]}`} subtitle={`${job.number} · ${job.title || ''}`} />
                  <div className="mb-2 text-sm">{STATUS_LABEL[job.status]} · {formatDate(job.createdAt)} · الوحدة: ك</div>
                  <Table>
                    <thead>
                      <tr>
                        <Th>البند</Th>
                        <Th>القيمة (ك)</Th>
                        <Th>ملاحظات</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><Td>الوزن قبل</Td><Td>{stageForm.weightBefore === '' ? '............' : stageForm.weightBefore}</Td><Td /></tr>
                      <tr><Td>الوزن بعد</Td><Td>{stageForm.weightAfter === '' ? '............' : stageForm.weightAfter}</Td><Td /></tr>
                      <tr><Td>الهالك</Td><Td>{stageForm.wasteQty === '' ? '............' : stageForm.wasteQty}</Td><Td /></tr>
                      <tr><Td>الزيادة</Td><Td>{stageForm.increaseQty === '' ? '............' : stageForm.increaseQty}</Td><Td /></tr>
                      <tr><Td>ملاحظات</Td><Td colSpan={2}>{stageForm.notes.trim() || '................................'}</Td></tr>
                    </tbody>
                  </Table>
                </div>

                {currentKind === 'PRINTING' && showCost && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Field label="سعر الكيلو (طباعة)">
                      <NumberInput
                        value={stageForm.pricePerKg}
                        onValueChange={(v) => setStageForm({ ...stageForm, pricePerKg: v })}
                      />
                    </Field>
                    <Field label="إجمالي تكلفة الطباعة">
                      <Input value={printCostTotal != null ? String(printCostTotal) : ''} readOnly />
                    </Field>
                    <div className="flex items-end text-xs text-muted pb-2">
                      يُحسب: (الوزن بعد أو قبل) × سعر الكيلو
                    </div>
                  </div>
                )}

                {currentKind === 'CORE' && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="العدد">
                      <NumberInput value={stageForm.coreCount} onValueChange={(v) => patchCore({ coreCount: v })} />
                    </Field>
                    <Field label="وزن الكور">
                      <NumberInput value={stageForm.coreUnitWeight} onValueChange={(v) => patchCore({ coreUnitWeight: v })} />
                    </Field>
                    <Field label="إجمالي وزن الكور">
                      <Input value={coreTotal != null ? String(coreTotal) : ''} readOnly />
                    </Field>
                    <Field label="الوزن بعد (قبل + كور)">
                      <NumberInput value={stageForm.weightAfter} onValueChange={() => undefined} readOnly />
                    </Field>
                  </div>
                )}

                {currentKind === 'DETAILING' && (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="عدد الشكاير">
                        <NumberInput value={stageForm.bagCount} onValueChange={(v) => patchBags({ bagCount: v })} />
                      </Field>
                      <Field label="وزن الشكارة">
                        <NumberInput value={stageForm.bagUnitWeight} onValueChange={(v) => patchBags({ bagUnitWeight: v })} />
                      </Field>
                      <Field label="الصافي">
                        <Input value={bagNet != null ? String(bagNet) : ''} readOnly />
                      </Field>
                      <Field label="الوزن بعد / الصافي">
                        <NumberInput value={stageForm.weightAfter} onValueChange={() => undefined} readOnly />
                      </Field>
                    </div>
                    {showCost && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="سعر الكيلو (تفصيل)">
                          <NumberInput
                            value={stageForm.pricePerKg}
                            onValueChange={(v) => setStageForm({ ...stageForm, pricePerKg: v })}
                          />
                        </Field>
                        <Field label="إجمالي تكلفة التفصيل">
                          <Input value={detailingCostTotal != null ? String(detailingCostTotal) : ''} readOnly />
                        </Field>
                        <div className="flex items-end text-xs text-muted pb-2">
                          الصافي × سعر الكيلو · الهالك = الوزن قبل − الصافي
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Field label="ملاحظات المرحلة">
                  <Input value={stageForm.notes} onChange={(e) => setStageForm({ ...stageForm, notes: e.target.value })} />
                </Field>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => completeCurrent(false)}>
                    المرحلة التالية <ArrowRight size={16} />
                  </Button>
                  {currentKind === 'DETAILING' && (
                    <Button variant="secondary" disabled={busy} onClick={() => completeCurrent(true)}>
                      <SkipForward size={16} /> تخطي التفصيل
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {job.status === 'READY' && (
              <Card className="border-amber-200 bg-amber-50/50">
                <h3 className="text-lg font-extrabold text-amber-900">جاهز لأمر التصنيع</h3>
                <p className="mt-1 text-sm text-amber-800">راجع التكاليف بالأسفل ثم أدخل سعر البيع لإتمام أمر التصنيع.</p>
                {showCost && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
                    <div className="rounded-lg bg-white px-3 py-2">إجمالي التكاليف: <b>{formatMoney(job.report.grandTotal)}</b></div>
                    <div className="rounded-lg bg-white px-3 py-2">الوزن النهائي: <b>{job.report.finalWeight ?? '—'}</b></div>
                    <div className="rounded-lg bg-white px-3 py-2">تكلفة الكيلو: <b>{job.report.costPerKg != null ? formatMoney(job.report.costPerKg) : '—'}</b></div>
                  </div>
                )}
                <Button className="mt-3" onClick={() => {
                  setTransferForm({
                    productName: job.title || '',
                    quantity: job.report.finalWeight ?? '',
                    salePrice: '',
                  });
                  setTransferOpen(true);
                }}
                >
                  <Warehouse size={16} /> أمر تصنيع — سعر البيع
                </Button>
              </Card>
            )}

            {job.status === 'DONE' && job.finishedProduct && (
              <Card className="border-emerald-200 bg-emerald-50/40">
                <h3 className="font-extrabold text-emerald-900">تم أمر التصنيع</h3>
                <p className="mt-1 text-sm">
                  المنتج: <strong>{job.finishedProduct.name}</strong>
                  {' · '}
                  الكمية: <strong>{job.transferQty}</strong>
                  {showCost && (
                    <>
                      {' · '}تكلفة الكيلو: <strong>{formatMoney(job.unitCost || job.report.costPerKg || 0)}</strong>
                      {' · '}سعر البيع: <strong>{formatMoney(job.salePrice || 0)}</strong>
                    </>
                  )}
                </p>
              </Card>
            )}

            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 no-print">
                <h3 className="text-base font-extrabold">تقرير التكاليف والأوزان</h3>
                <DocExportBar className="mb-0" pdfFileName={`تقرير-تصنيع-${job.number}.pdf`} />
              </div>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {showCost && <StatCard label="تكلفة الخامات" value={formatMoney(job.report.issuedCost)} tone="brand" />}
                {showCost && <StatCard label="تكاليف المراحل" value={formatMoney(job.report.stagesCost)} tone="amber" />}
                <StatCard label="إجمالي الهالك" value={job.report.totalWaste} tone="rose" />
                <StatCard
                  label="الوزن النهائي"
                  value={job.report.finalWeight ?? '—'}
                  hint={job.report.firstWeight != null ? `من ${job.report.firstWeight}` : undefined}
                  tone="emerald"
                />
              </div>
              {showCost && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-brand-900 px-4 py-3 text-white">
                    <div className="text-xs text-brand-200">إجمالي تكلفة التصنيع</div>
                    <div className="text-2xl font-extrabold">{formatMoney(job.report.grandTotal)}</div>
                  </div>
                  <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
                    <div className="text-xs text-brand-700">تكلفة / سعر الكيلو</div>
                    <div className="text-2xl font-extrabold text-brand-900">
                      {job.report.costPerKg != null ? formatMoney(job.report.costPerKg) : '—'}
                    </div>
                    <div className="mt-1 text-xs text-muted">إجمالي التكلفة ÷ الوزن النهائي</div>
                  </div>
                </div>
              )}

              {showCost && job.report.allCosts.length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-2 text-sm font-extrabold">تفصيل كل التكاليف</h4>
                  <Table>
                    <thead>
                      <tr><Th>المرحلة</Th><Th>البند</Th><Th>المبلغ</Th></tr>
                    </thead>
                    <tbody>
                      {job.report.allCosts.map((row, i) => (
                        <tr key={i}>
                          <Td>{row.stage}</Td>
                          <Td className="font-bold">{row.label}</Td>
                          <Td>{formatMoney(row.amount)}</Td>
                        </tr>
                      ))}
                      <tr>
                        <Td colSpan={2} className="font-extrabold">الإجمالي</Td>
                        <Td className="font-extrabold">{formatMoney(job.report.grandTotal)}</Td>
                      </tr>
                    </tbody>
                  </Table>
                </div>
              )}

              {(job.report.weightFlow?.length || 0) > 0 && (
                <div className="mb-4">
                  <h4 className="mb-2 text-sm font-extrabold">تسلسل الأوزان بين المراحل</h4>
                  <Table>
                    <thead>
                      <tr>
                        <Th>المرحلة</Th>
                        <Th>وزن داخل</Th>
                        <Th>هالك</Th>
                        <Th>زيادة</Th>
                        <Th>وزن خارج</Th>
                        <Th>نسبة الهالك</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.report.weightFlow!.map((row) => (
                        <tr key={row.stage}>
                          <Td className="font-bold">{row.stage}</Td>
                          <Td>{row.in ?? '—'}</Td>
                          <Td className="text-rose-700">{row.waste}</Td>
                          <Td className="text-emerald-700">{row.increase ?? 0}</Td>
                          <Td className="font-extrabold text-emerald-700">{row.out ?? '—'}</Td>
                          <Td>{row.lossPct != null ? `${row.lossPct}%` : '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}

              <div className="space-y-4">
                {job.report.stageReports.map((stage) => (
                  <div key={stage.kind} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-extrabold">{stage.label}</div>
                      <Badge tone={stage.skipped ? 'slate' : stage.completed ? 'emerald' : 'amber'}>
                        {stage.skipped ? 'تم التخطي' : stage.completed ? 'مكتملة' : 'لم تبدأ'}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                      <div>وزن قبل: <b>{stage.weightBefore ?? '—'} ك</b></div>
                      <div>هالك: <b className="text-rose-700">{stage.completed ? stage.wasteQty : '—'}{stage.completed ? ' ك' : ''}</b></div>
                      <div>زيادة: <b className="text-emerald-700">{stage.completed ? (stage.increaseQty ?? 0) : '—'}{stage.completed ? ' ك' : ''}</b></div>
                      <div>وزن بعد: <b className="text-emerald-700">{stage.weightAfter ?? '—'} ك</b></div>
                      {stage.coreTotal != null && <div>وزن الكور: <b>{stage.coreTotal} ك</b></div>}
                      {stage.netQty != null && <div>صافي: <b>{stage.netQty} ك</b></div>}
                      {stage.pricePerKg != null && showCost && <div>سعر الكيلو: <b>{formatMoney(stage.pricePerKg)}</b></div>}
                    </div>
                    {!!stage.costs.length && (
                      <div className="mt-2 text-sm">
                        <div className="font-bold text-slate-600">تكاليف ({showCost ? formatMoney(stage.costsTotal) : '—'})</div>
                        {stage.costs.map((c, i) => (
                          <div key={i} className="flex justify-between"><span>{c.label}</span><span>{showCost ? formatMoney(c.amount) : '—'}</span></div>
                        ))}
                      </div>
                    )}
                    {!!stage.materials.length && (
                      <div className="mt-2 text-sm">
                        <div className="font-bold text-slate-600">مواد مستخدمة ({showCost ? formatMoney(stage.materialsTotal) : '—'})</div>
                        {stage.materials.map((m, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{m.product.name} × {m.quantity}</span>
                            {showCost && <span>{formatMoney(m.quantity * (m.unitCost || 0))}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {stage.completed && !stage.skipped && showCost && (
                      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm font-extrabold">
                        <span>إجمالي المرحلة</span>
                        <span>{formatMoney(stage.stageTotal)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="print-only mt-6 hidden print:block">
                <DualPrintCopies dense>
                  <PrintHeader title={`تقرير تصنيع ${job.number}`} subtitle={job.title || job.rawWarehouse.name} />
                  <div className="mb-2 text-sm">
                    {STATUS_LABEL[job.status]} · {formatDate(job.createdAt)}
                    {job.finishedProduct ? ` · ${job.finishedProduct.name}` : ''}
                  </div>
                  <Table>
                    <thead>
                      <tr><Th>المرحلة</Th><Th>داخل (ك)</Th><Th>هالك (ك)</Th><Th>زيادة (ك)</Th><Th>خارج (ك)</Th>{showCost && <Th>تكلفة</Th>}</tr>
                    </thead>
                    <tbody>
                      {job.report.stageReports.map((s) => (
                        <tr key={s.kind}>
                          <Td>{s.label}{s.skipped ? ' (تخطى)' : s.completed ? '' : ' (فارغ)'}</Td>
                          <Td>{s.weightBefore ?? '............'}</Td>
                          <Td>{s.completed ? s.wasteQty : '............'}</Td>
                          <Td>{s.completed ? (s.increaseQty ?? 0) : '............'}</Td>
                          <Td>{s.weightAfter ?? '............'}</Td>
                          {showCost && <Td>{s.completed ? formatMoney(s.stageTotal) : '............'}</Td>}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="mt-2 space-y-0.5 text-sm">
                    <div className="flex justify-between"><span>هالك كلي</span><span>{job.report.totalWaste}</span></div>
                    {job.report.finalWeight != null && <div className="flex justify-between"><span>وزن نهائي</span><span>{job.report.finalWeight}</span></div>}
                    {showCost && <div className="flex justify-between font-bold"><span>إجمالي التكلفة</span><span>{formatMoney(job.report.grandTotal)}</span></div>}
                    {showCost && job.report.costPerKg != null && <div className="flex justify-between font-bold"><span>تكلفة الكيلو</span><span>{formatMoney(job.report.costPerKg)}</span></div>}
                  </div>
                </DualPrintCopies>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="أمر تصنيع — صرف خامات" wide>
        <div className="space-y-3">
          <Field label="عنوان الأمر (اختياري)">
            <Input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="مثال: تشغيلية فيلم طباعة" />
          </Field>
          <Field label="ملاحظات">
            <Input value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} />
          </Field>
          <div>
            <Label>خامات من {rawStock?.warehouse.name || 'مخزن الخام'}</Label>
            <p className="mb-2 text-xs text-muted">بمجرد الحفظ تُصرف الكميات من المخزن الخام وتبدأ الطباعة — الكمية هنا هي الوزن قبل الطباعة</p>
            <div className="space-y-2">
              {boxLines.map((line, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
                  <ProductPicker
                    products={products.map((p) => ({ id: p.id, name: `${p.name} (متاح ${availableOf(p.id)})`, sku: p.sku }))}
                    value={line.productId}
                    onChange={(productId) => setBoxLines(boxLines.map((l, i) => (i === index ? { ...l, productId } : l)))}
                    placeholder="اختر خامة"
                  />
                  <NumberInput
                    value={line.quantity}
                    onValueChange={(v) => setBoxLines(boxLines.map((l, i) => (i === index ? { ...l, quantity: v } : l)))}
                  />
                  <button
                    type="button"
                    className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => setBoxLines(boxLines.length === 1 ? [{ productId: '', quantity: '' }] : boxLines.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setBoxLines([...boxLines, { productId: '', quantity: '' }])}>
                <Plus size={14} /> خامة
              </Button>
            </div>
          </div>
          <Button className="w-full" disabled={busy} onClick={createJob}>صرف وبدء الطباعة</Button>
        </div>
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="أمر تصنيع — تكلفة الكيلو وسعر البيع">
        <div className="space-y-3">
          <p className="text-sm text-muted">الوزن النهائي وتكلفة الكيلو محسوبان من المراحل — أضف سعر البيع لإتمام أمر التصنيع.</p>
          <Field label="اسم المنتج">
            <Input value={transferForm.productName} onChange={(e) => setTransferForm({ ...transferForm, productName: e.target.value })} />
          </Field>
          <Field label="الوزن / الكمية النهائية">
            <NumberInput value={transferForm.quantity} onValueChange={(v) => setTransferForm({ ...transferForm, quantity: v })} />
          </Field>
          {showCost && job && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                إجمالي التكاليف: <strong>{formatMoney(job.report.grandTotal)}</strong>
              </div>
              <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
                تكلفة سعر الكيلو: <strong>{transferCostPerKg != null ? formatMoney(transferCostPerKg) : '—'}</strong>
              </div>
            </div>
          )}
          <Field label="سعر البيع (للكيلو / للوحدة)">
            <NumberInput value={transferForm.salePrice} onValueChange={(v) => setTransferForm({ ...transferForm, salePrice: v })} />
          </Field>
          <Button className="w-full" disabled={busy} onClick={doTransfer}>تأكيد أمر التصنيع</Button>
        </div>
      </Modal>
    </div>
  );
}
