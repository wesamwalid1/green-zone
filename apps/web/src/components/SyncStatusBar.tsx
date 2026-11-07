import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Settings2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/feedback';
import { Button, Input, Label, Modal } from './ui';

type SyncStatus = {
  mode: string;
  phase: string;
  deviceKey: string;
  cloudUrl: string;
  online: boolean;
  pendingChanges: number;
  openConflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

export function SyncStatusBar() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudToken, setCloudToken] = useState('');

  async function load() {
    try {
      const data = await api<SyncStatus>('/sync/status');
      setStatus(data);
      setCloudUrl(data.cloudUrl || '');
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status?.cloudUrl || !status.online) return;
    if (!(user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT')) return;
    const timer = window.setInterval(() => {
      void api('/sync/run', { method: 'POST', body: '{}' })
        .then(() => load())
        .catch(() => undefined);
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [status?.cloudUrl, status?.online, user?.role]);

  if (!status) return null;

  const isAdmin = user?.role === 'ADMIN';

  async function runSync() {
    setBusy(true);
    try {
      const result = await api<{ pushed: number; pulled: number; conflicts: number }>('/sync/run', { method: 'POST', body: '{}' });
      toast.success(`تمت المزامنة · دفع ${result.pushed} · سحب ${result.pulled}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت المزامنة');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    setBusy(true);
    try {
      await api('/sync/configure', {
        method: 'POST',
        body: JSON.stringify({ cloudUrl: cloudUrl.trim(), cloudToken: cloudToken.trim() || undefined }),
      });
      toast.success('تم حفظ إعدادات المزامنة');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    setBusy(true);
    try {
      const result = await api<{ imported: number }>('/sync/bootstrap', { method: 'POST', body: '{}' });
      toast.success(`تم التحميل الأولي: ${result.imported} تغيير`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحميل الأولي');
    } finally {
      setBusy(false);
    }
  }

  const tone = status.online
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status.cloudUrl
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-600';

  return (
    <>
      <div className={`no-print flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${tone}`}>
        {status.online ? <Cloud size={14} /> : <CloudOff size={14} />}
        <span>
          {status.online ? 'متصل بالسحابة' : status.cloudUrl ? 'غير متصل — العمل أوفلاين' : 'مزامنة غير مضبوطة'}
        </span>
        {status.pendingChanges > 0 && (
          <span className="rounded-md bg-white/80 px-1.5 py-0.5 tabular-nums">{status.pendingChanges} بانتظار الرفع</span>
        )}
        {status.openConflicts > 0 && (
          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-700">{status.openConflicts} تعارض</span>
        )}
        {(user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT') && (
          <button
            type="button"
            disabled={busy || !status.cloudUrl}
            onClick={() => void runSync()}
            className="inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 hover:bg-white disabled:opacity-50"
            title="مزامنة الآن"
          >
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
            مزامنة
          </button>
        )}
        {isAdmin && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 hover:bg-white" title="إعدادات المزامنة">
            <Settings2 size={12} />
            إعداد
          </button>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="إعدادات المزامنة مع السحابة">
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted">
            المرحلة {status.phase}: جهاز ديسكتوب أساسي يكتب أوفلاين ويتزامن عند رجوع النت. الويب أونلاين فقط.
          </p>
          <div>
            <Label>رابط السيرفر السحابي</Label>
            <Input
              dir="ltr"
              placeholder="https://greenzone.example.com"
              value={cloudUrl}
              onChange={(e) => setCloudUrl(e.target.value)}
            />
          </div>
          <div>
            <Label>مفتاح المزامنة (SYNC_API_KEY)</Label>
            <Input
              dir="ltr"
              type="password"
              placeholder="اختياري إن كان مضبوطًا على السيرفر"
              value={cloudToken}
              onChange={(e) => setCloudToken(e.target.value)}
            />
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600" dir="ltr">
            device: {status.deviceKey}
          </div>
          {status.lastError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{status.lastError}</div>}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" disabled={busy || !cloudUrl.trim()} onClick={() => void bootstrap()}>
              تحميل أولي من السحابة
            </Button>
            <Button type="button" disabled={busy} onClick={() => void saveConfig()}>
              حفظ
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
