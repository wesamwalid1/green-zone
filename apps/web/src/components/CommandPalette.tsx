import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Star } from 'lucide-react';
import { api } from '../lib/api';
import { NAV_ITEMS, QUICK_ACTIONS, canAccess } from '../lib/nav';
import { useAuth } from '../lib/auth';
import { favorites, recentPages, toggleFavorite, type Bookmark } from '../lib/prefs';

type Hit = Bookmark & { group: string };

type SearchPayload = {
  products: { id: string; name: string; sku: string }[];
  customers: { id: string; name: string; code: string }[];
  suppliers: { id: string; name: string; code: string }[];
  sales: { id: string; number: string; total: number; customer: { name: string } }[];
  purchases: { id: string; number: string; total: number; supplier: { name: string } }[];
  warehouses: { id: string; name: string; code: string }[];
  tasks?: { id: string; title: string; status: string }[];
  reports?: { id: string; name: string }[];
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<Bookmark[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRemote([]);
    setActive(0);
    setSaved(favorites());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setRemote([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<SearchPayload>(`/ops/search?q=${encodeURIComponent(q)}`);
        setRemote([
          ...data.products.map((row) => ({ id: `p-${row.id}`, title: row.name, subtitle: `صنف · ${row.sku}`, to: `/products?q=${encodeURIComponent(row.sku)}`, group: 'الأصناف' })),
          ...data.customers.map((row) => ({ id: `c-${row.id}`, title: row.name, subtitle: `عميل · ${row.code}`, to: `/customers?open=${row.id}`, group: 'العملاء' })),
          ...data.suppliers.map((row) => ({ id: `s-${row.id}`, title: row.name, subtitle: `مورد · ${row.code}`, to: `/suppliers?q=${encodeURIComponent(row.name)}`, group: 'الموردين' })),
          ...data.sales.map((row) => ({ id: `sale-${row.id}`, title: row.number, subtitle: `فاتورة بيع · ${row.customer.name}`, to: `/sales?open=${row.id}`, group: 'فواتير البيع' })),
          ...data.purchases.map((row) => ({ id: `buy-${row.id}`, title: row.number, subtitle: `فاتورة شراء · ${row.supplier.name}`, to: `/purchases?open=${row.id}`, group: 'فواتير الشراء' })),
          ...data.warehouses.map((row) => ({ id: `w-${row.id}`, title: row.name, subtitle: `مخزن · ${row.code}`, to: `/warehouses?q=${encodeURIComponent(row.name)}`, group: 'المخازن' })),
          ...(data.reports || []).map((row) => ({ id: `rep-${row.id}`, title: row.name, subtitle: 'تقرير محفوظ', to: '/report-builder', group: 'التقارير' })),
        ]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const local = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = NAV_ITEMS.filter((item) => canAccess(user?.role, item.roles))
      .filter((item) => !q || `${item.label} ${item.keywords}`.toLowerCase().includes(q))
      .map((item) => ({ id: item.to, title: item.label, subtitle: 'صفحة', to: item.to, group: 'الصفحات' }));
    const actions = QUICK_ACTIONS.filter((item) => canAccess(user?.role, item.roles))
      .filter((item) => !q || item.label.includes(query.trim()))
      .map((item) => ({ id: `qa-${item.to}`, title: item.label, subtitle: 'إجراء', to: item.to, group: 'إجراءات' }));
    return [...actions, ...pages];
  }, [query, user?.role]);

  const pinned = query.trim() ? [] : [
    ...saved.map((item) => ({ ...item, group: 'المفضلة' })),
    ...recentPages().map((item) => ({ ...item, group: 'الأخيرة' })),
  ];
  const results = [...pinned, ...local, ...remote];

  useEffect(() => { setActive(0); }, [query, remote.length]);

  if (!open) return null;

  function go(to: string) {
    navigate(to);
    onClose();
  }

  const groups = results.reduce<string[]>((list, item) => (list.includes(item.group) ? list : [...list, item.group]), []);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-start justify-center bg-slate-950/45 px-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4">
          <Search size={18} className="text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في الأصناف والعملاء والفواتير والمخازن"
            className="h-14 w-full bg-transparent text-sm outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Enter' && results[active]) go(results[active].to);
            }}
          />
        </div>
        <div className="max-h-[28rem] overflow-y-auto p-2">
          {loading && <div className="px-3 py-3 text-sm text-muted">جاري البحث في السجلات...</div>}
          {!loading && results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">لا توجد نتائج</div>}
          {groups.map((group) => (
            <div key={group} className="mb-2">
              <div className="px-3 py-1 text-[11px] font-bold text-muted">{group}</div>
              {results.map((item, index) => item.group === group && (
                <div key={`${group}-${item.id}`} className={`flex items-center rounded-xl ${index === active ? 'bg-brand-50' : ''}`}>
                  <button className="min-w-0 flex-1 px-3 py-2 text-right" onMouseEnter={() => setActive(index)} onClick={() => go(item.to)}>
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="block text-xs text-muted">{item.subtitle}</span>
                  </button>
                  <button
                    className="px-3 text-amber-500"
                    title="مفضلة"
                    onClick={() => setSaved(toggleFavorite(item))}
                  >
                    <Star size={15} fill={saved.some((row) => row.id === item.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
