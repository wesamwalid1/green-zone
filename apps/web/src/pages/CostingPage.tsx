import { useMemo, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';
import { formatMoney } from '../lib/api';
import { Button, Card, Field, NumberInput, PageHeader } from '../components/ui';

const COST_FIELDS = [
  { key: 'printing', label: 'طباعة' },
  { key: 'lamination', label: 'تبطين' },
  { key: 'slitter', label: 'سليدر' },
  { key: 'detailing', label: 'تفصيل' },
  { key: 'glue', label: 'صمغ' },
  { key: 'waste', label: 'هالك' },
  { key: 'expenses', label: 'مصروفات' },
] as const;

type CostKey = (typeof COST_FIELDS)[number]['key'];

type FormState = {
  weight: number | '';
  pricePerKg: number | '';
  costs: Record<CostKey, number | ''>;
  profitPct: number | '';
};

const emptyCosts = (): Record<CostKey, number | ''> =>
  Object.fromEntries(COST_FIELDS.map((f) => [f.key, '' as number | ''])) as Record<CostKey, number | ''>;

function n(v: number | '') {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function CostingPage() {
  const [form, setForm] = useState<FormState>({
    weight: '',
    pricePerKg: '',
    costs: emptyCosts(),
    profitPct: '',
  });

  const calc = useMemo(() => {
    const weight = n(form.weight);
    const pricePerKg = n(form.pricePerKg);
    const material = weight * pricePerKg;
    const costBreakdown = COST_FIELDS.map((f) => ({
      ...f,
      amount: n(form.costs[f.key]),
    }));
    const extra = costBreakdown.reduce((s, c) => s + c.amount, 0);
    const costTotal = material + extra;
    const costPerKg = weight > 0 ? costTotal / weight : 0;
    const profitPct = n(form.profitPct);
    const profitAmount = costTotal * (profitPct / 100);
    const sellTotal = costTotal + profitAmount;
    const sellPerKg = weight > 0 ? sellTotal / weight : 0;
    return { weight, pricePerKg, material, costBreakdown, extra, costTotal, costPerKg, profitPct, profitAmount, sellTotal, sellPerKg };
  }, [form]);

  function reset() {
    setForm({ weight: '', pricePerKg: '', costs: emptyCosts(), profitPct: '' });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="حاسبة تكلفة المنتج"
        subtitle="أدخل الوزن وسعر الكيلو والتكاليف، ثم نسبة الربح لمعرفة سعر البيع"
        icon={Calculator}
        actions={(
          <Button variant="secondary" onClick={reset}>
            <RotateCcw size={14} /> تفريغ
          </Button>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الوزن (كجم)">
              <NumberInput
                value={form.weight}
                onValueChange={(weight) => setForm((f) => ({ ...f, weight }))}
                placeholder="مثال: 100"
              />
            </Field>
            <Field label="سعر الكيلو">
              <NumberInput
                value={form.pricePerKg}
                onValueChange={(pricePerKg) => setForm((f) => ({ ...f, pricePerKg }))}
                placeholder="مثال: 45"
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 text-sm font-extrabold text-slate-800">التكاليف الإضافية</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {COST_FIELDS.map((field) => (
                <Field key={field.key} label={field.label}>
                  <NumberInput
                    value={form.costs[field.key]}
                    onValueChange={(amount) => setForm((f) => ({
                      ...f,
                      costs: { ...f.costs, [field.key]: amount },
                    }))}
                    placeholder="0"
                  />
                </Field>
              ))}
            </div>
          </div>

          <Field label="نسبة الربح %">
            <NumberInput
              value={form.profitPct}
              onValueChange={(profitPct) => setForm((f) => ({ ...f, profitPct }))}
              placeholder="مثال: 20"
            />
          </Field>
        </Card>

        <div className="space-y-3">
          <Card className="border-2 border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-600">تكلفة الخامة (وزن × سعر الكيلو)</div>
            <div className="mt-1 text-2xl font-black money-num text-slate-950">{formatMoney(calc.material)}</div>
          </Card>

          <Card className="border-2 border-amber-300 bg-amber-50">
            <div className="text-xs font-bold text-amber-900">إجمالي التكاليف الإضافية</div>
            <div className="mt-1 text-2xl font-black money-num text-amber-950">{formatMoney(calc.extra)}</div>
            <ul className="mt-3 space-y-1 text-xs font-semibold text-amber-950/80">
              {calc.costBreakdown.filter((c) => c.amount > 0).map((c) => (
                <li key={c.key} className="flex justify-between gap-2">
                  <span>{c.label}</span>
                  <span className="money-num" dir="ltr">{formatMoney(c.amount)}</span>
                </li>
              ))}
              {calc.extra <= 0 && <li className="text-amber-800/70">لم تُضف تكاليف بعد</li>}
            </ul>
          </Card>

          <Card className="border-2 border-rose-300 bg-rose-50">
            <div className="text-xs font-bold text-rose-900">سعر التكلفة</div>
            <div className="mt-1 text-3xl font-black money-num text-rose-950">{formatMoney(calc.costTotal)}</div>
            <div className="mt-1 text-sm font-bold text-rose-800">
              للكيلو: <span className="money-num" dir="ltr">{formatMoney(calc.costPerKg)}</span>
            </div>
          </Card>

          <Card className="border-2 border-emerald-400 bg-emerald-50">
            <div className="text-xs font-bold text-emerald-900">هبيع بكام (بعد نسبة الربح {calc.profitPct || 0}%)</div>
            <div className="mt-1 text-3xl font-black money-num text-emerald-950">{formatMoney(calc.sellTotal)}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-emerald-900">
              <span>الربح: <span className="money-num" dir="ltr">{formatMoney(calc.profitAmount)}</span></span>
              <span>سعر بيع الكيلو: <span className="money-num" dir="ltr">{formatMoney(calc.sellPerKg)}</span></span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
