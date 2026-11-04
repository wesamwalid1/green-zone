import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Search, Wallet } from 'lucide-react';
import { api, formatMoney } from '../lib/api';
import { useToast } from '../lib/feedback';
import { StatementLedger, type LedgerRow } from '../components/StatementLedger';
import {
  BrandMark, Button, Card, Empty, Field, Input, Label, NumberInput, PageHeader, Select,
} from '../components/ui';

type Party = { id: string; code: string; name: string; balance: number; phone?: string | null };
type PayMethod = { id: string; name: string; cashAccount?: { balance: number } | null };

type StatementPayload = {
  customer?: Party;
  supplier?: Party;
  statement: LedgerRow[];
  balance: number;
  totals?: { debit: number; credit: number; balance: number };
  prepaid?: number;
  meaning?: string;
};

type Kind = 'customer' | 'supplier';

export function StatementsPage() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('customer');
  const [parties, setParties] = useState<Party[]>([]);
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [partyId, setPartyId] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<StatementPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [advance, setAdvance] = useState({ methodId: '', amount: '' as number | '', note: '' });

  useEffect(() => {
    api<PayMethod[]>('/cash/methods').then(setMethods).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPartyId('');
    setData(null);
    setQ('');
    const path = kind === 'customer' ? '/customers' : '/suppliers';
    api<Party[] | { items: Party[] }>(path)
      .then((res) => setParties(Array.isArray(res) ? res : res.items || []))
      .catch((e) => toast.error(e instanceof Error ? e.message : 'تعذر تحميل القائمة'));
  }, [kind]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return parties;
    return parties.filter((p) =>
      p.name.toLowerCase().includes(term)
      || p.code.toLowerCase().includes(term)
      || (p.phone || '').includes(term));
  }, [parties, q]);

  async function loadStatement(id = partyId) {
    if (!id) return;
    setBusy(true);
    try {
      const path = kind === 'customer' ? `/customers/${id}/statement` : `/suppliers/${id}/statement`;
      const row = await api<StatementPayload>(path);
      setData(row);
      setPartyId(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل الكشف');
    } finally {
      setBusy(false);
    }
  }

  async function saveAdvance() {
    if (!partyId) return toast.error('اختر الطرف أولًا');
    if (!advance.methodId) return toast.error('اختر طريقة الدفع');
    if (!(Number(advance.amount) > 0)) return toast.error('أدخل مبلغ الدفع المقدم');
    setBusy(true);
    try {
      if (kind === 'supplier') {
        await api('/cash/payments', {
          method: 'POST',
          body: JSON.stringify({
            supplierId: partyId,
            methodId: advance.methodId,
            amount: Number(advance.amount),
            note: advance.note.trim() || 'دفعة مقدمة',
          }),
        });
      } else {
        await api('/cash/receipts', {
          method: 'POST',
          body: JSON.stringify({
            customerId: partyId,
            methodId: advance.methodId,
            amount: Number(advance.amount),
            note: advance.note.trim() || 'تحصيل مقدم',
          }),
        });
      }
      toast.success('تم تسجيل الدفع المقدم وظهوره في الكشف');
      setAdvance({ methodId: advance.methodId, amount: '', note: '' });
      await loadStatement(partyId);
      const listPath = kind === 'customer' ? '/customers' : '/suppliers';
      const res = await api<Party[] | { items: Party[] }>(listPath);
      setParties(Array.isArray(res) ? res : res.items || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تسجيل الدفع المقدم');
    } finally {
      setBusy(false);
    }
  }

  const party = data?.customer || data?.supplier;
  const meaning = kind === 'customer'
    ? (data && data.balance > 0.009 ? 'دائن على العميل (−)' : data && data.balance < -0.009 ? 'مدين للعميل (+ مقدم)' : 'متعادل')
    : (data && data.balance > 0.009 ? 'مدين للمورد (−)' : data && data.balance < -0.009 ? 'دائن عند المورد (+ مقدم)' : 'متعادل');

  return (
    <div>
      <PageHeader
        title="كشوف حسابات"
        subtitle="اختَر عميل أو مورد · جدول دائن / مدين · دفع مقدم يظهر في الكشف"
        actions={<BrandMark size="md" />}
      />

      <div className="mb-4 grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card className="h-fit space-y-3 no-print">
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([
              ['customer', 'عميل'],
              ['supplier', 'مورد'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`flex-1 rounded-lg py-2 text-sm font-extrabold ${kind === id ? 'bg-brand-800 text-white shadow' : 'text-slate-600 hover:bg-white'}`}
                onClick={() => setKind(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <Field label="بحث بالاسم / الكود / الهاتف">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pr-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب للتصفية..." />
            </div>
          </Field>

          <Field label={kind === 'customer' ? 'العميل' : 'المورد'}>
            <Select value={partyId} onChange={(e) => loadStatement(e.target.value)}>
              <option value="">اختر الاسم</option>
              {filtered.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.code}
                </option>
              ))}
            </Select>
          </Field>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1">
            {filtered.length === 0 ? <Empty text="لا نتائج" /> : filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadStatement(p.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-sm ${partyId === p.id ? 'bg-brand-800 font-bold text-white' : 'hover:bg-slate-50'}`}
              >
                <span className="truncate font-bold">{p.name}</span>
                <span className={`shrink-0 tabular-nums text-xs ${partyId === p.id ? 'text-brand-100' : 'text-muted'}`}>{formatMoney(p.balance)}</span>
              </button>
            ))}
          </div>

          {partyId && (
            <div className="space-y-2 rounded-2xl border-2 border-sky-200 bg-sky-50/80 p-3">
              <div className="flex items-center gap-2 text-sm font-black text-sky-950">
                <Wallet size={16} /> دفع مقدم
              </div>
              <p className="text-[11px] font-semibold text-sky-800">
                يُسجَّل في الحساب فورًا ويظهر في الكشف · ويُخصم من الفواتير التالية تلقائيًا
              </p>
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={advance.methodId} onChange={(e) => setAdvance({ ...advance, methodId: e.target.value })}>
                  <option value="">خزنة / انستا باي / محفظة / بنك</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.cashAccount ? ` (${formatMoney(m.cashAccount.balance)})` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>المبلغ</Label>
                <NumberInput value={advance.amount} onValueChange={(v) => setAdvance({ ...advance, amount: v })} />
              </div>
              <div>
                <Label>ملاحظة</Label>
                <Input value={advance.note} onChange={(e) => setAdvance({ ...advance, note: e.target.value })} placeholder="اختياري" />
              </div>
              <Button className="w-full" disabled={busy} onClick={saveAdvance}>
                {busy ? 'جاري التسجيل...' : 'تسجيل دفع مقدم في الكشف'}
              </Button>
            </div>
          )}
        </Card>

        <Card className={data && party ? 'print-sheet' : ''}>
          {!data || !party ? (
            <div className="grid place-items-center py-16">
              <BrandMark size="lg" className="mb-4" />
              <Empty
                text="اختر عميل أو مورد لعرض كشف الحساب"
                hint="الجدول بنفس أسلوب الكشف التفصيلي · دائن بالموجب · مدين بالسالب · العميل عكس المورد"
              />
            </div>
          ) : (
            <StatementLedger
              data={{
                title: kind === 'customer' ? `كشف حساب عميل` : `كشف حساب مورد`,
                partyName: party.name,
                partyCode: party.code,
                partyKind: kind,
                balance: data.balance,
                meaning,
                prepaid: data.prepaid,
                totals: data.totals,
                statement: data.statement,
                fileName: `كشف-${kind === 'customer' ? 'عميل' : 'مورد'}-${party.code}.xlsx`,
              }}
            />
          )}
        </Card>
      </div>

      <div className="no-print rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600">
        <FileSpreadsheet size={14} className="mb-1 inline" /> الأرقام: <span className="text-emerald-700">موجب = دائن</span>
        {' · '}
        <span className="text-rose-700">سالب (−) = مدين</span>
        {' · '} العميل: دائن بالسالب ومدين بالموجب (عكس المورد)
        {' · '} الدفع المقدم يظهر كحركة في الكشف ويحدّث الرصيد فورًا
      </div>
    </div>
  );
}
