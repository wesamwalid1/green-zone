import { useEffect, type ReactNode } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { formatMoney } from '../lib/api';
import { Label } from './ui';

export function InvoiceEditor({
  open,
  title,
  subtitle,
  icon,
  total,
  onClose,
  children,
  side,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  icon: ReactNode;
  total: number;
  onClose: () => void;
  children: ReactNode;
  side: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-100">
      <div className="flex items-center justify-between gap-3 bg-brand-950 px-5 py-3 text-white">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10">{icon}</span>
          <div>
            <div className="text-lg font-extrabold">{title}</div>
            <div className="text-xs text-brand-100">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-left">
            <div className="text-[11px] text-brand-200">الإجمالي</div>
            <div className="text-xl font-extrabold">{formatMoney(total)}</div>
          </div>
          <button type="button" aria-label="إغلاق" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_23rem] lg:overflow-hidden">
        <div className="min-h-0 space-y-4 lg:overflow-y-auto lg:pe-1">{children}</div>
        <div className="flex min-h-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:overflow-y-auto">{side}</div>
      </div>
    </div>
  );
}

export function EditorSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
          <span className="h-4 w-1 rounded-full bg-brand-700" />
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AddLineButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white hover:bg-brand-800">
      <Plus size={14} /> إضافة بند
    </button>
  );
}

export function LineCard({
  index,
  total,
  invalid,
  onRemove,
  canRemove,
  children,
}: {
  index: number;
  total: number;
  invalid?: boolean;
  onRemove: () => void;
  canRemove: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-3 ${invalid ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/70'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-brand-700 px-2 text-xs font-extrabold text-white">{index + 1}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold text-slate-900">{formatMoney(total)}</span>
          <button type="button" aria-label="حذف البند" title="حذف البند" disabled={!canRemove} onClick={onRemove} className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-30">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

export function PriceHint({ label, value }: { label: string; value?: number | null }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex h-10 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-sm font-bold tabular-nums text-slate-700">
        {value == null ? '—' : formatMoney(value)}
      </div>
    </div>
  );
}

export function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'border-t border-white/10 pt-2 text-base font-extrabold text-white' : 'text-brand-100'}`}>
      <span>{label}</span>
      <span className={strong ? 'text-xl' : 'text-white'}>{value}</span>
    </div>
  );
}

export function EditorErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
      {errors.map((error) => <li key={error}>• {error}</li>)}
    </ul>
  );
}
