import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Columns3, Download, LayoutGrid, Search, SlidersHorizontal, Table2, X } from 'lucide-react';

type Column = { id: string; label: string; visible: boolean };

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const toolBtn = 'grid h-10 w-10 place-items-center rounded-xl border transition';
const toolIdle = 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800';
const toolActive = 'border-brand-700 bg-brand-700 text-white shadow-sm';

export function ListBar({
  search,
  onSearch,
  placeholder = 'بحث...',
  view,
  onView,
  onExport,
  columns,
  onToggleColumn,
  filter,
  filterActive,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  view?: 'table' | 'cards';
  onView?: (view: 'table' | 'cards') => void;
  onExport?: () => void;
  columns?: Column[];
  onToggleColumn?: (id: string) => void;
  filter?: ReactNode;
  filterActive?: boolean;
}) {
  const cols = usePopover();
  const filters = usePopover();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[15rem] flex-1">
        <Search size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 pr-10 pl-9 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
        />
        {search && (
          <button type="button" onClick={() => onSearch('')} className="absolute left-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="مسح البحث">
            <X size={14} />
          </button>
        )}
      </label>
      {filter && (
        <div className="relative" ref={filters.ref}>
          <button
            type="button"
            aria-label="تصفية"
            title="تصفية"
            className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${filterActive ? toolActive : toolIdle}`}
            onClick={() => filters.setOpen((value) => !value)}
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">تصفية</span>
            {filterActive && <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />}
          </button>
          {filters.open && (
            <div className="modal-panel absolute start-0 z-30 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
              {filter}
            </div>
          )}
        </div>
      )}
      <div className="ms-auto flex items-center gap-2">
        {onView && (
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              aria-label="عرض جدول"
              title="جدول"
              className={`grid h-8 w-8 place-items-center rounded-lg transition ${view === 'table' ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
              onClick={() => onView('table')}
            >
              <Table2 size={15} />
            </button>
            <button
              type="button"
              aria-label="عرض بطاقات"
              title="بطاقات"
              className={`grid h-8 w-8 place-items-center rounded-lg transition ${view === 'cards' ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
              onClick={() => onView('cards')}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        )}
        {columns && onToggleColumn && (
          <div className="relative" ref={cols.ref}>
            <button type="button" aria-label="الأعمدة" title="الأعمدة الظاهرة" className={`${toolBtn} ${cols.open ? toolActive : toolIdle}`} onClick={() => cols.setOpen((value) => !value)}>
              <Columns3 size={16} />
            </button>
            {cols.open && (
              <div className="modal-panel absolute left-0 z-30 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
                <div className="mb-2 px-1 text-xs font-bold text-muted">الأعمدة الظاهرة</div>
                {columns.map((column) => (
                  <label key={column.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand-700)]" checked={column.visible} onChange={() => onToggleColumn(column.id)} />
                    {column.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {onExport && (
          <button type="button" title="تصدير Excel" className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100" onClick={onExport}>
            <Download size={15} />
            <span className="hidden sm:inline">Excel</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-right text-sm transition ${active ? 'bg-brand-50 font-bold text-brand-800' : 'text-slate-600 hover:bg-slate-50'}`} onClick={onClick}>
      {children}
      {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
    </button>
  );
}

export function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition ${danger ? 'border-transparent text-rose-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-brand-700 hover:shadow-sm'}`}
    >
      {children}
    </button>
  );
}
