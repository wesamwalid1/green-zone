import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertOctagon, CalendarRange, ChevronLeft, ChevronRight, Inbox, RotateCcw, X } from 'lucide-react';
import { NAV_ITEMS } from '../lib/nav';

export function todayIso() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  function setFrom(value: string) {
    if (!value) return;
    onChange(value, to && value > to ? value : to);
  }
  function setTo(value: string) {
    if (!value) return;
    onChange(from && value < from ? value : from, value);
  }
  return (
    <div className="inline-flex h-12 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid place-items-center bg-brand-50 px-3 text-brand-700">
        <CalendarRange size={17} />
      </div>
      <label className="flex min-w-32 flex-col justify-center px-3">
        <span className="text-[10px] font-bold text-muted">من تاريخ</span>
        <input className="bg-transparent text-sm font-bold text-slate-800 outline-none" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <div className="my-2.5 w-px bg-slate-200" />
      <label className="flex min-w-32 flex-col justify-center px-3">
        <span className="text-[10px] font-bold text-muted">إلى تاريخ</span>
        <input className="bg-transparent text-sm font-bold text-slate-800 outline-none" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
      </label>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  const location = useLocation();
  const Icon = icon || NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.icon;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 no-print">
      <div className="flex min-w-0 items-center gap-3.5">
        {Icon && (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 text-white shadow-lg shadow-brand-900/20 ring-4 ring-brand-50">
            <Icon size={21} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[1.6rem] font-extrabold leading-tight tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,28,46,0.04),0_6px_20px_-8px_rgba(15,28,46,0.08)] ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon size={17} /></span>}
        <div className="min-w-0">
          <div className="text-base font-extrabold text-slate-900">{title}</div>
          {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  brand: { tile: 'bg-brand-50 text-brand-700', bar: 'bg-brand-600', ring: 'ring-brand-500' },
  sky: { tile: 'bg-sky-50 text-sky-600', bar: 'bg-sky-500', ring: 'ring-sky-500' },
  emerald: { tile: 'bg-emerald-50 text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-500' },
  amber: { tile: 'bg-amber-50 text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-500' },
  rose: { tile: 'bg-rose-50 text-rose-600', bar: 'bg-rose-500', ring: 'ring-rose-500' },
  violet: { tile: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500', ring: 'ring-violet-500' },
  slate: { tile: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400', ring: 'ring-slate-400' },
};
export type Tone = keyof typeof TONES;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
}) {
  const t = TONES[tone];
  const body = (
    <>
      <span className={`absolute inset-y-4 right-0 w-1 rounded-l-full ${t.bar} ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'} transition`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-muted">{label}</div>
          <div className="mt-1.5 truncate text-[1.55rem] font-black leading-tight tracking-tight text-slate-900 money-num">{value}</div>
        </div>
        {Icon && <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.tile}`}><Icon size={20} /></span>}
      </div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = `group relative block w-full overflow-hidden rounded-2xl border bg-white p-4 text-right shadow-[0_1px_2px_rgba(15,28,46,0.04),0_6px_20px_-10px_rgba(15,28,46,0.10)] transition ${active ? `border-transparent ring-2 ${t.ring}` : 'border-slate-200/80'}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} lift`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const map = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4', 5: 'sm:grid-cols-3 xl:grid-cols-5' };
  return <div className={`stagger mb-5 grid gap-3 ${map[cols]}`}>{children}</div>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'lg';
}) {
  const styles = {
    primary: 'bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-sm shadow-brand-900/20 ring-1 ring-inset ring-white/10 hover:from-brand-700 hover:to-brand-800',
    secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white shadow-sm shadow-rose-900/20 hover:bg-rose-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  };
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-sm' };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${sizes[size]} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

const CONTROL = 'w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className = '', type, onWheel, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={`h-10 ${CONTROL} ${type === 'number' ? 'no-spinner' : ''} ${className}`}
      onWheel={(e) => {
        if (type === 'number') {
          (e.target as HTMLInputElement).blur();
        }
        onWheel?.(e);
      }}
      {...props}
    />
  );
}

/** رقم بدون أسهم/سكرول — القيمة الفارغة تظهر خانة فاضية */
export function NumberInput({
  value,
  onValueChange,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number | '';
  onValueChange: (value: number | '') => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      className={`money-num tabular-nums text-[15px] font-bold ${className}`}
      value={value === '' ? '' : value}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') onValueChange('');
        else onValueChange(Number(raw));
      }}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select-control h-10 cursor-pointer ${CONTROL} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-[13px] font-semibold text-slate-700">{children}</label>;
}

export function Field({
  label,
  icon,
  error,
  hint,
  warning,
  children,
}: {
  label: string;
  icon?: ReactNode;
  error?: string;
  hint?: string;
  warning?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`flex h-10 items-center gap-2 rounded-xl border bg-white px-3 transition focus-within:ring-4 ${error ? 'border-rose-300 focus-within:ring-rose-500/10' : warning ? 'border-amber-300 focus-within:ring-amber-500/10' : 'border-slate-200 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-brand-500/10'}`}>
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <div className="min-w-0 flex-1 [&_input]:h-9 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-0 [&_input]:shadow-none [&_input]:ring-0 [&_select]:h-9 [&_select]:border-0 [&_select]:bg-transparent [&_select]:px-0 [&_select]:ring-0">
          {children}
        </div>
      </div>
      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : warning ? <p className="mt-1 text-xs font-medium text-amber-700">{warning}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  DRAFT: { label: 'مسودة', cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
  CONFIRMED: { label: 'مؤكدة', cls: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  PARTIAL: { label: 'جزئي', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  PAID: { label: 'مدفوعة', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  CANCELLED: { label: 'ملغاة', cls: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
  OPEN: { label: 'مفتوح', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  CONVERTED: { label: 'تم التحويل', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' };
  return (
    <span className={`status-${status} inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  const cls = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200', sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200', violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${cls}`}>{children}</span>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="table-shell overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="data-table min-w-full text-sm text-slate-700">{children}</table>
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-3 text-right text-xs font-bold text-slate-500 ${className}`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  colSpan,
  dir,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  return <td colSpan={colSpan} dir={dir} className={`border-t border-slate-100 px-4 py-3 align-middle ${className}`}>{children}</td>;
}

export function Empty({ text = 'لا توجد بيانات', hint, action }: { text?: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-4 py-14 text-center">
      <div className="relative mb-4 grid h-16 w-16 place-items-center">
        <span className="absolute inset-0 rounded-full bg-brand-50" />
        <span className="absolute inset-2 rounded-full bg-brand-100/70" />
        <Inbox size={22} className="relative text-brand-700" />
      </div>
      <div className="text-sm font-bold text-slate-800">{text}</div>
      {hint && <div className="mt-1 max-w-sm text-xs leading-5 text-muted">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ text = 'حدث خطأ أثناء التحميل', hint, onRetry }: { text?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="grid place-items-center px-4 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-8 ring-rose-50/50">
        <AlertOctagon size={22} />
      </div>
      <div className="text-sm font-bold text-slate-800">{text}</div>
      {hint && <div className="mt-1 max-w-sm text-xs leading-5 text-muted">{hint}</div>}
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}><RotateCcw size={13} /> إعادة المحاولة</Button>}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="skeleton h-11 rounded-none" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-t border-slate-100 px-4 py-3.5">
          <div className="skeleton h-4 flex-[2] rounded" />
          <div className="skeleton h-4 flex-1 rounded" />
          <div className="skeleton h-4 flex-1 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="skeleton h-12 w-12 rounded-2xl" />
        <div className="space-y-2">
          <div className="skeleton h-6 w-48 rounded-lg" />
          <div className="skeleton h-3 w-64 rounded" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-28 rounded-2xl" />)}
      </div>
      <TableSkeleton />
    </div>
  );
}

export function Pager({
  page,
  pages,
  total,
  from,
  to,
  onPage,
  pageSize,
  onPageSize,
}: {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
  onPage: (page: number) => void;
  pageSize?: number;
  onPageSize?: (size: number) => void;
}) {
  if (total === 0) return null;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, index) => start + index).filter((number) => number >= 1 && number <= pages);
  const btn = 'grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold transition';
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
      <span className="text-muted">
        عرض <b className="text-slate-800 tabular-nums">{from}–{to}</b> من <b className="text-slate-800 tabular-nums">{total}</b>
      </span>
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" className={`${btn} text-slate-500 hover:bg-slate-100 disabled:opacity-30`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="السابق"><ChevronRight size={16} /></button>
        {numbers.map((number) => (
          <button key={number} type="button" className={`${btn} ${number === page ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => onPage(number)}>{number}</button>
        ))}
        <button type="button" className={`${btn} text-slate-500 hover:bg-slate-100 disabled:opacity-30`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="التالي"><ChevronLeft size={16} /></button>
      </div>
      {onPageSize && (
        <label className="flex items-center gap-2 text-muted">
          صفوف
          <select className="select-control h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
            {[5, 10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  onSearch,
  placeholder = 'بحث...',
  className = 'w-56',
}: {
  value: string;
  onChange: (v: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSearch?.()}
    />
  );
}

export function BrandMark({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = size === 'lg' ? 'h-28 w-28' : size === 'sm' ? 'h-12 w-12' : 'h-[4.5rem] w-[4.5rem]';
  return (
    <div className={`brand-mark shrink-0 overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/10 ${box} ${className}`}>
      <img
        src="/green-zone-mark.png"
        alt="Green Zone"
        className="h-full w-full object-contain object-center"
        draggable={false}
      />
    </div>
  );
}

export function PrintHeader({
  title,
  subtitle,
  brand = 'Green Zone',
  brandHint = 'للأسمدة والكيماويات',
}: {
  title: string;
  subtitle?: string;
  brand?: string;
  brandHint?: string;
}) {
  return (
    <div className="print-header mb-6 flex items-center justify-between border-b-2 border-brand-800 pb-4">
      <div className="flex items-center gap-3">
        <BrandMark size="lg" />
        <div>
          <div className="brand-title text-xl font-black tracking-tight text-brand-900">{brand}</div>
          {brandHint && <div className="brand-hint text-[11px] font-bold text-slate-500">{brandHint}</div>}
          <div className="mt-1 text-base font-extrabold text-brand-800">{title}</div>
          {subtitle && <div className="text-sm font-semibold text-slate-600">{subtitle}</div>}
        </div>
      </div>
      <div className="text-left text-xs font-semibold text-slate-500" dir="ltr">
        {new Date().toLocaleString('ar-EG', { numberingSystem: 'latn' })}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div
        className={`print-sheet modal-panel flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="no-print flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-sky-400 to-brand-700" />
            <h2 className="truncate text-lg font-extrabold text-slate-900">{title}</h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
