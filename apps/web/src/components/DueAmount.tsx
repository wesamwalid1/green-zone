import { formatMoney } from '../lib/api';
import { dueLabel, dueTone } from '../lib/due';

const moneyTone: Record<string, string> = {
  clear: 'text-emerald-700',
  green: 'text-emerald-700',
  yellow: 'text-amber-700',
  red: 'text-rose-700',
};

const badgeTone: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  yellow: 'bg-amber-100 text-amber-800',
  red: 'bg-rose-100 text-rose-700',
};

export function DueAmount({ date, remaining }: { date: string; remaining: number }) {
  if (!(remaining > 0.009)) {
    return <span className="font-bold text-emerald-700">{formatMoney(remaining)}</span>;
  }
  const tone = dueTone(date, remaining);
  const label = dueLabel(date, remaining);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`font-bold ${moneyTone[tone]}`}>{formatMoney(remaining)}</span>
      {label ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeTone[tone]}`}>{label}</span> : null}
    </span>
  );
}
