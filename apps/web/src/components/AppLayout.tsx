import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronLeft, LogOut, Menu, Moon, Search, Sun, X, Zap } from 'lucide-react';
import { api, formatRelative } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { NAV_GROUPS, NAV_ITEMS, QUICK_ACTIONS, ROLE_LABELS, canAccess } from '../lib/nav';
import { pushRecent } from '../lib/prefs';
import { CommandPalette } from './CommandPalette';
import { PageSkeleton } from './ui';
import { Suspense } from 'react';

type Notice = {
  id: string;
  title: string;
  body: string;
  category: string;
  severity: string;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  const current = NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));
  const allowed = (page?: string, roles?: Parameters<typeof canAccess>[1]) => {
    if (user?.access && page) return !!user.access[page]?.view;
    return canAccess(user?.role, roles);
  };
  const actions = QUICK_ACTIONS.filter((item) => allowed(item.page, item.roles));
  const unreadCount = unread;

  useEffect(() => {
    setNavOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
    setNoticeOpen(false);
    if (current) pushRecent({ id: current.to, title: current.label, subtitle: 'صفحة', to: current.to });
    document.title = current ? `${current.label} · Pro Pack` : 'Pro Pack — نظام إدارة المخازن';
  }, [location.pathname, current]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNotices() {
      try {
        const data = await api<{ items: Notice[]; unread: number }>('/ops/notifications');
        if (cancelled) return;
        setNotices(data.items);
        setUnread(data.unread);
      } catch {
        if (!cancelled) setNotices([]);
      }
    }
    loadNotices();
    const timer = window.setInterval(loadNotices, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function markAllRead() {
    const data = await api<{ items: Notice[]; unread: number }>('/ops/notifications/read', { method: 'POST', body: '{}' });
    setNotices(data.items);
    setUnread(data.unread);
  }

  async function openNotice(item: Notice) {
    const data = await api<{ items: Notice[]; unread: number }>('/ops/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ ids: [item.id] }),
    });
    setNotices(data.items);
    setUnread(data.unread);
    if (item.href) navigate(item.href);
  }

  const crumbs = useMemo(() => {
    if (!current || current.to === '/') return [{ label: 'لوحة التحكم' }];
    return [{ label: 'لوحة التحكم', to: '/' }, { label: current.label }];
  }, [current]);

  return (
    <div className="flex min-h-full bg-surface text-ink">
      {navOpen && <button className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setNavOpen(false)} aria-label="إغلاق القائمة" />}
      <aside className={`no-print fixed inset-y-0 right-0 z-40 flex w-[272px] shrink-0 translate-x-full flex-col overflow-hidden border-s border-white/10 bg-gradient-to-b from-brand-800 via-brand-900 to-brand-950 text-white shadow-2xl transition lg:sticky lg:top-0 lg:bottom-auto lg:h-screen lg:translate-x-0 ${navOpen ? '!translate-x-0' : ''}`}>
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="pointer-events-none absolute -top-24 -left-20 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <img src="/pro-pack-logo.png" alt="Pro Pack" className="h-16 w-16 rounded-2xl bg-[#f4f0e8] object-contain object-center shadow-lg shadow-black/25 ring-1 ring-white/30" draggable={false} />
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold leading-tight tracking-tight">Pro Pack</div>
              <div className="truncate text-[11px] text-brand-200">طباعة مواد التعبئة والتغليف</div>
            </div>
          </div>
          <button className="rounded-lg p-1 text-brand-100 hover:bg-white/10 lg:hidden" onClick={() => setNavOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <nav className="relative flex-1 space-y-4 overflow-y-auto px-3 py-4 [scrollbar-width:thin]">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => allowed(item.page, item.roles));
            if (!items.length) return null;
            return (
            <div key={group.label}>
              <div className="mb-1 px-3 text-[11px] font-semibold text-brand-300">{group.label}</div>
              <div className="space-y-1">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive ? 'bg-white text-brand-800 shadow-lg shadow-black/20' : 'text-brand-100 hover:bg-white/10 hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute inset-y-2 -right-3 w-1 rounded-l-full bg-sky-300" />}
                        <span className={`grid h-7 w-7 place-items-center rounded-lg transition ${isActive ? 'bg-brand-700 text-white' : 'bg-white/5 group-hover:bg-white/15'}`}>
                          <item.icon size={16} />
                        </span>
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
            );
          })}
        </nav>
        <div className="relative border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.07] p-2.5 ring-1 ring-white/10">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-brand-600 text-xs font-bold">{initials(user?.fullName || 'م')}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold">{user?.fullName}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-brand-200">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
                متصل · {ROLE_LABELS[user?.role || ''] || user?.role}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-l from-transparent via-brand-400/50 to-transparent" />
          <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
            <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="القائمة">
              <Menu size={18} />
            </button>
            <div className="hidden min-w-0 items-center gap-1 text-sm text-muted sm:flex">
              {crumbs.map((crumb, index) => (
                <span key={crumb.label} className="flex items-center gap-1">
                  {index > 0 && <ChevronLeft size={14} />}
                  <span className={index === crumbs.length - 1 ? 'font-semibold text-slate-800' : ''}>{crumb.label}</span>
                </span>
              ))}
            </div>
            <button
              onClick={() => setSearchOpen(true)}
              className="ms-auto flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 hover:bg-white sm:max-w-md"
            >
              <Search size={16} />
              <span className="truncate">بحث عام</span>
              <kbd className="ms-auto hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] sm:inline">Ctrl K</kbd>
            </button>

            <div className="relative">
              <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={() => setQuickOpen((value) => !value)} title="إجراءات سريعة" aria-label="إجراءات سريعة">
                <Zap size={18} />
              </button>
              {quickOpen && (
                <div className="absolute end-0 top-12 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  {actions.map((item) => (
                    <NavLink key={item.to} to={item.to} className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>

            <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={toggle} title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} aria-label="تبديل المظهر">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div className="relative">
              <button className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={() => setNoticeOpen((value) => !value)} aria-label="الإشعارات">
                <Bell size={18} />
                {unreadCount > 0 && <span className="absolute top-1 end-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{unreadCount}</span>}
              </button>
              {noticeOpen && (
                <div className="absolute end-0 top-12 w-[min(100vw-2rem,22rem)] rounded-2xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div className="text-sm font-bold">مركز الإشعارات</div>
                    <button className="text-xs font-semibold text-brand-700" onClick={markAllRead}>تعليم الكل كمقروء</button>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-2">
                    {notices.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">لا توجد إشعارات حالياً</div>}
                    {notices.map((item) => (
                      <button key={item.id} onClick={() => openNotice(item)} className={`mb-1 w-full rounded-xl px-3 py-2 text-right ${item.readAt ? 'opacity-60' : 'bg-slate-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-semibold ${item.severity === 'danger' ? 'text-rose-700' : item.severity === 'warning' ? 'text-amber-700' : 'text-slate-800'}`}>{item.title}</span>
                          <span className="text-[11px] text-muted">{formatRelative(item.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">{item.body}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button className="flex items-center gap-2 rounded-xl py-1 pe-2 ps-1 hover:bg-slate-100" onClick={() => setUserOpen((value) => !value)}>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-xs font-bold text-white">{initials(user?.fullName || 'م')}</span>
                <span className="hidden text-right sm:block">
                  <span className="block text-sm font-semibold leading-4 text-slate-800">{user?.fullName}</span>
                  <span className="text-[11px] text-muted">{ROLE_LABELS[user?.role || ''] || user?.role}</span>
                </span>
              </button>
              {userOpen && (
                <div className="absolute end-0 top-12 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="px-3 py-2 text-xs text-muted">{user?.username}</div>
                  <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">
                    <LogOut size={15} />
                    تسجيل الخروج
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="page-enter mx-auto max-w-7xl p-4 sm:p-6">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
