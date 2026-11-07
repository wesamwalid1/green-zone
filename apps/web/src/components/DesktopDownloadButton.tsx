import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, getApiBase } from '../lib/api';
import { useToast } from '../lib/feedback';

type DesktopInfo = {
  available: boolean;
  hint?: string;
  message?: string;
};

export function DesktopDownloadButton({
  className = '',
  variant = 'header',
}: {
  className?: string;
  variant?: 'header' | 'login';
}) {
  const toast = useToast();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const href = `${getApiBase() || ''}/api/desktop/download`;

  useEffect(() => {
    let cancelled = false;
    api<DesktopInfo>('/desktop/info')
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo({ available: false, hint: 'تعذر التحقق من ملف التثبيت' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onClick(e: React.MouseEvent) {
    if (info && !info.available) {
      e.preventDefault();
      toast.error(info.hint || 'ملف تثبيت سطح المكتب غير متوفر بعد. ابني المثبّت من المشروع أولًا.');
    }
  }

  if (variant === 'login') {
    return (
      <a
        href={href}
        onClick={onClick}
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-bold text-brand-800 transition hover:bg-brand-100 ${className}`}
      >
        <Download size={16} />
        تحميل نسخة سطح المكتب (ويندوز)
      </a>
    );
  }

  return (
    <a
      href={href}
      onClick={onClick}
      title={info?.available === false ? info.hint : 'للتثبيت على الجهاز والعمل بدون إنترنت'}
      className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 ${className}`}
    >
      <Download size={14} />
      <span className="hidden sm:inline">تحميل الديسكتوب</span>
    </a>
  );
}
