import { useEffect, useId, useRef, useState } from 'react';
import { formatMoney } from '../lib/api';

export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = origin + (target - origin) * eased;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function CountMoney({ value }: { value: number }) {
  return <>{formatMoney(useCountUp(value))}</>;
}

export function CountNumber({ value }: { value: number }) {
  return <>{Math.round(useCountUp(value)).toLocaleString('ar-EG')}</>;
}

function smoothPath(points: [number, number][]) {
  if (!points.length) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

export function Sparkline({ values, className = 'text-brand-600' }: { values: number[]; className?: string }) {
  const id = useId().replace(/:/g, '');
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [values.length > 1 ? (i / (values.length - 1)) * w : w / 2, h - 3 - (v / max) * (h - 8)] as [number, number]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-9 w-28 ${className}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill={`url(#sp-${id})`} />}
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type Series = { key: string; label: string; color: string; values: number[] };

export function AreaChart({ labels, series, height = 240 }: { labels: string[]; series: Series[]; height?: number }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const w = 1000;
  const h = 300;
  const n = labels.length;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / step) * step;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * w : w / 2);
  const y = (v: number) => h - (v / max) * (h - 16);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="relative" dir="ltr">
      <div className="flex gap-2">
        <div className="flex flex-col justify-between pb-6 text-[10px] font-semibold text-muted" style={{ height }}>
          {[...ticks].reverse().map((t) => <span key={t}>{t >= 1000 ? `${Math.round(t / 1000).toLocaleString('ar-EG')}k` : Math.round(t).toLocaleString('ar-EG')}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="reveal-x w-full overflow-visible" style={{ height: height - 24 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`ar-${id}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <line key={t} x1="0" x2={w} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-slate-200" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) => {
              const line = smoothPath(s.values.map((v, i) => [x(i), y(v)]));
              return (
                <g key={s.key}>
                  <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill={`url(#ar-${id}-${s.key})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} stroke="currentColor" className="text-brand-300" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {hover !== null && series.map((s) => (
            <span
              key={s.key}
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${(x(hover) / w) * 100}%`, top: `${(y(s.values[hover]) / h) * (height - 24)}px`, background: s.color }}
            />
          ))}
          <div className="absolute inset-0 flex" style={{ height: height - 24 }} onMouseLeave={() => setHover(null)}>
            {labels.map((label, i) => (
              <div key={label + i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-40 -translate-x-1/2 rounded-xl border border-slate-200 bg-white/95 p-3 text-right text-xs shadow-xl backdrop-blur"
              style={{ left: `${Math.min(88, Math.max(12, (x(hover) / w) * 100))}%` }}
              dir="rtl"
            >
              <div className="mb-1.5 font-bold text-slate-800">{labels[hover]}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                  <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-bold text-slate-800">{formatMoney(s.values[hover])}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted">
            {labels.map((label, i) => (
              <span key={label + i} className={i % labelEvery === 0 || i === n - 1 ? '' : 'invisible'}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export type Slice = { label: string; value: number; color: string };

export function Donut({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = active !== null ? slices[active] : null;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-48 w-48 shrink-0">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={r} fill="none" stroke="currentColor" className="text-slate-100" strokeWidth="22" />
          {slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx="90" cy="90" r={r} fill="none" stroke={s.color}
                strokeWidth={active === i ? 28 : 22}
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[11px] text-muted">{shown ? shown.label : centerLabel}</div>
            <div className="text-lg font-extrabold text-slate-800">{shown ? `${((shown.value / total) * 100).toFixed(0)}%` : centerValue}</div>
          </div>
        </div>
      </div>
      <div className="w-full space-y-2">
        {slices.map((s, i) => (
          <div
            key={s.label}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition ${active === i ? 'bg-slate-50' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate text-slate-700">{s.label}</span>
            </span>
            <span className="shrink-0 text-xs font-bold text-slate-800">{((s.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ rows, color = 'from-brand-500 to-brand-700', format = formatMoney }: {
  rows: { label: string; value: number; hint?: string }[];
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-black ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
              <span className="truncate font-semibold text-slate-700">{row.label}</span>
            </span>
            <span className="shrink-0 font-bold text-slate-800">{format(row.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full bg-gradient-to-l ${color} transition-[width] duration-700`} style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
          </div>
          {row.hint && <div className="mt-1 text-[11px] text-muted">{row.hint}</div>}
        </div>
      ))}
    </div>
  );
}
