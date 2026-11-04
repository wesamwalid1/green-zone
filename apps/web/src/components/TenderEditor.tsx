import { Label, NumberInput, Select } from './ui';

export type PayMethodOption = { id: string; name: string; kind?: 'IMMEDIATE' | 'CHECK' };
export type TenderPart = { id?: string; methodId: string; amount: number | '' };

/** طرق الدفع: خزنة رئيسية · انستا باي · محفظة · حساب بنكي */
export function TenderEditor({
  methods,
  parts,
  onChange,
}: {
  methods: PayMethodOption[];
  parts: TenderPart[];
  onChange: (parts: TenderPart[]) => void;
}) {
  const activeMethods = methods.filter((method) => method.kind !== 'CHECK');
  const fallback = activeMethods[0]?.id || '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>المدفوع</Label>
        <button
          type="button"
          className="text-xs font-bold text-brand-700"
          onClick={() => onChange([...parts, { methodId: fallback, amount: '' }])}
        >
          + جزء
        </button>
      </div>
      {parts.map((part, index) => (
        <div key={index} className="grid grid-cols-[1fr_1.3fr_auto] gap-2">
          <NumberInput
            value={part.amount}
            onValueChange={(amount) => onChange(parts.map((row, i) => (i === index ? { ...row, amount } : row)))}
            placeholder="المبلغ"
          />
          <Select
            value={part.methodId}
            onChange={(e) => onChange(parts.map((row, i) => (i === index ? { ...row, methodId: e.target.value } : row)))}
          >
            <option value="">طريقة الدفع</option>
            {activeMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="rounded-xl px-2 text-lg font-bold text-rose-600"
            onClick={() => onChange(parts.filter((_, i) => i !== index))}
            aria-label="حذف"
          >
            ×
          </button>
        </div>
      ))}
      {parts.length === 0 && (
        <div className="text-xs text-slate-500">بدون مدفوع = آجل، والمتبقي = الإجمالي.</div>
      )}
    </div>
  );
}
