import { Lock, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NAV_ITEMS } from '../lib/nav';
import { useAuth } from '../lib/auth';

export function ForbiddenAccess({ pageLabel }: { pageLabel?: string }) {
  const { user } = useAuth();
  const allowed = NAV_ITEMS.find((item) => user?.access?.[item.page]?.view);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
          <Lock size={28} />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">مفيش صلاحية على الجزء ده</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {pageLabel
            ? <>شاشة <span className="font-bold text-slate-800">«{pageLabel}»</span> مش مفعّلة لحسابك.</>
            : 'الشاشة دي مش مفعّلة لحسابك.'}
          {' '}
          لو محتاج تدخل عليها، كلّم المدير عشان يضيفها من الإعدادات ← المستخدمين والصلاحيات.
        </p>
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-start text-xs leading-5 text-amber-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>حسابك: <b>{user?.fullName || user?.username}</b>. الصلاحيات بتتحدد لكل شاشة على حدة.</span>
        </div>
        {allowed && (
          <Link
            to={allowed.to}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-brand-800 px-5 text-sm font-bold text-white shadow-lg shadow-brand-900/20 transition hover:brightness-110"
          >
            الرجوع لـ {allowed.label}
          </Link>
        )}
      </div>
    </div>
  );
}
