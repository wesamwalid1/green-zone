import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Boxes, ChevronDown, Eye, EyeOff, LineChart, Lock, ReceiptText, Server, ShieldCheck, User, Wallet,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getApiBase, setApiBase } from '../lib/api';

const REMEMBER_KEY = 'm5azen.rememberUser';

const FEATURES = [
  { icon: Boxes, title: 'مخزون متعدد الفروع', text: 'أرصدة لحظية وتحويلات بين المخازن وتنبيهات حد الطلب' },
  { icon: ReceiptText, title: 'مبيعات ومشتريات', text: 'فواتير ومرتجعات ومتابعة مستحقات بمهلة سداد واضحة' },
  { icon: Wallet, title: 'خزنة وبنوك', text: 'تحصيل وسداد ومصروفات وشيكات في دفتر واحد' },
  { icon: LineChart, title: 'تقارير وتحليلات', text: 'أرباح وحركة أصناف وأداء العملاء والفروع' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const remembered = localStorage.getItem(REMEMBER_KEY) || '';
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!remembered);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [showApi, setShowApi] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      setApiBase(apiUrl);
      await login(username.trim(), password);
      if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  }

  const control = 'flex h-12 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 transition hover:border-slate-300 focus-within:border-brand-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-500/10';

  return (
    <div className="grid min-h-full bg-slate-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="relative flex min-h-full flex-col">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-800 to-brand-950 px-6 pb-16 pt-8 text-white lg:hidden">
          <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative flex items-center gap-3">
            <img src="/pro-pack-logo.png" alt="Pro Pack" className="h-16 w-16 rounded-2xl bg-[#f4f0e8] object-contain object-center shadow-lg ring-1 ring-white/30" draggable={false} />
            <div>
              <div className="text-base font-extrabold tracking-tight">Pro Pack</div>
              <div className="text-xs text-brand-200">طباعة مواد التعبئة والتغليف</div>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_70%_20%,rgba(26,48,80,0.07),transparent_45%)] lg:block" />

        <div className="relative -mt-10 flex flex-1 items-center justify-center px-4 pb-8 sm:px-8 lg:mt-0 lg:py-10">
          <div className="w-full max-w-[440px]">
            <div className="modal-panel rounded-[1.75rem] border border-slate-200/80 bg-white p-7 shadow-[0_1px_3px_rgba(15,28,46,0.06),0_24px_60px_-20px_rgba(15,28,46,0.25)] sm:p-9">
              <div className="mb-8 hidden items-center gap-3 lg:flex">
                <img src="/pro-pack-logo.png" alt="Pro Pack" className="h-[4.75rem] w-[4.75rem] rounded-2xl bg-[#f4f0e8] object-contain object-center shadow-md ring-1 ring-slate-200" draggable={false} />
                <div>
                  <div className="text-[15px] font-extrabold tracking-tight text-slate-900">Pro Pack</div>
                  <div className="text-xs font-medium text-muted">طباعة مواد التعبئة والتغليف</div>
                </div>
              </div>

              <h1 className="text-[1.7rem] font-extrabold tracking-tight text-slate-900">مرحبًا بعودتك</h1>
              <p className="mt-1.5 text-sm leading-6 text-muted">سجّل الدخول بحسابك للمتابعة إلى لوحة التحكم.</p>

              <form onSubmit={onSubmit} className="mt-7 space-y-5">
                <label className="block">
                  <span className="mb-2 block text-[13px] font-bold text-slate-700">اسم المستخدم</span>
                  <span className={control}>
                    <User size={18} className="shrink-0 text-slate-400" />
                    <input
                      className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
                      placeholder="اكتب اسم المستخدم"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoFocus={!remembered}
                      autoComplete="username"
                      dir="auto"
                      required
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-[13px] font-bold text-slate-700">كلمة المرور</span>
                  <span className={control}>
                    <Lock size={18} className="shrink-0 text-slate-400" />
                    <input
                      className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
                      placeholder="••••••••"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                      onBlur={() => setCapsLock(false)}
                      autoFocus={!!remembered}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  {capsLock && <span className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-amber-600"><AlertCircle size={13} /> زر Caps Lock مفعّل</span>}
                </label>

                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" className="h-4 w-4 rounded accent-[var(--color-brand-700)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  تذكّر اسم المستخدم على هذا الجهاز
                </label>

                {error && (
                  <div className="modal-panel flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-medium text-rose-700">
                    <AlertCircle size={17} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-brand-600 to-brand-800 text-[15px] font-bold text-white shadow-lg shadow-brand-900/25 transition hover:shadow-xl hover:brightness-110 disabled:opacity-60"
                >
                  {loading ? (
                    <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> جاري التحقق...</>
                  ) : (
                    <>تسجيل الدخول <ArrowLeft size={17} className="transition group-hover:-translate-x-1" /></>
                  )}
                </button>
              </form>

              <div className="mt-7 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setShowApi((v) => !v)} className="flex w-full items-center justify-between text-xs font-semibold text-muted transition hover:text-slate-700">
                  <span className="flex items-center gap-1.5"><Server size={13} /> إعدادات الاتصال (للديسكتوب)</span>
                  <ChevronDown size={14} className={`transition ${showApi ? 'rotate-180' : ''}`} />
                </button>
                {showApi && (
                  <div className="mt-3">
                    <input
                      className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-brand-500 focus:bg-white"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="http://192.168.1.10:3001"
                      dir="ltr"
                    />
                    <p className="mt-1.5 text-[11px] leading-5 text-muted">اتركه فارغاً عند فتح البرنامج من الرابط. يُستخدم فقط عند ربط الديسكتوب بسيرفر آخر.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between px-2 text-[11px] text-muted">
              <span className="flex items-center gap-1"><ShieldCheck size={13} className="text-emerald-600" /> الدخول محمي بصلاحيات المستخدم</span>
              <span>© {new Date().getFullYear()} Pro Pack</span>
            </div>
          </div>
        </div>
      </section>

      <section className="relative hidden p-4 lg:block">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 p-12 text-white shadow-2xl">
          <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="glow-orb pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl" />
          <div className="glow-orb pointer-events-none absolute -bottom-32 right-10 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl" style={{ animationDelay: '-6s' }} />

          <div className="relative flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white p-1.5 shadow-xl shadow-black/20">
              <img src="/pro-pack-logo.png" alt="Pro Pack" className="h-full w-full object-contain" draggable={false} />
            </span>
            <div>
              <div className="text-lg font-extrabold">Pro Pack</div>
              <div className="text-xs text-brand-200">طباعة مواد التعبئة والتغليف</div>
            </div>
          </div>

          <div className="relative my-auto py-10">
            <h2 className="max-w-lg text-[2.5rem] font-extrabold leading-[1.3] tracking-tight">
              إدارة مخزونك وحساباتك
              <span className="block bg-gradient-to-l from-sky-200 to-sky-400 bg-clip-text text-transparent">بدقة ووضوح كامل</span>
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-brand-200">
              منصة واحدة تربط المخازن والمبيعات والمشتريات والخزنة، وتعرض أرقامك لحظة بلحظة لتتخذ القرار الصحيح.
            </p>

            <ul className="mt-10 space-y-3">
              {FEATURES.map((item) => (
                <li key={item.title} className="flex max-w-md items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur-sm transition hover:bg-white/[0.08]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400/30 to-white/5 text-sky-200 ring-1 ring-white/15">
                    <item.icon size={19} />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-brand-200">{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative flex items-center gap-2 text-xs text-brand-300">
            <ShieldCheck size={14} className="text-emerald-400" />
            صلاحيات حسب الدور · سجل كامل للعمليات · نسخ احتياطي
          </div>
        </div>
      </section>
    </div>
  );
}
