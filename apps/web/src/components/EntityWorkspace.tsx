import { useEffect, useState } from 'react';
import { api, formatDate, getApiBase } from '../lib/api';
import { Button, Empty } from './ui';

type FileRow = { id: string; fileName: string; size: number; createdAt: string; uploadedByName?: string | null };
type Snapshot = {
  notes: { id: string; body: string }[];
  tasks?: { id: string; title: string; status: string }[];
  attachments: FileRow[];
  flags?: { priceRisk?: boolean };
  invoices?: { id: string; number: string; total: number; status: string; invoiceDate: string }[];
};

export function EntityWorkspace({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setData(await api<Snapshot>(`/work/360?entityType=${entityType}&entityId=${entityId}`));
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'تعذر تحميل ملف السجل'));
  }, [entityType, entityId]);

  async function upload(file: File) {
    const body = new FormData();
    body.append('file', file);
    body.append('entityType', entityType);
    body.append('entityId', entityId);
    const token = localStorage.getItem('m5azen_token');
    const res = await fetch(`${getApiBase()}/api/work/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ message: 'فشل الرفع' }));
      throw new Error(Array.isArray(payload.message) ? payload.message.join(', ') : payload.message);
    }
    await load();
  }

  async function remove(id: string) {
    await api(`/work/attachments/${id}`, { method: 'DELETE' });
    await load();
  }

  if (error) return <Empty text={error} />;
  if (!data) return <p className="text-sm text-muted">جارٍ تحميل الملف...</p>;

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      {data.flags?.priceRisk && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          سعر بيع هذا الصنف أقل من تكلفته.
        </div>
      )}
      {data.invoices && (
        <div>
          <div className="mb-1 text-sm font-bold">آخر الفواتير</div>
          {data.invoices.length === 0 ? <p className="text-xs text-muted">لا فواتير</p> : data.invoices.map((row) => (
            <div key={row.id} className="flex justify-between text-sm"><span>{row.number} · {row.status}</span><span>{formatDate(row.invoiceDate)}</span></div>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-bold">مرفقات</span>
          <label className="cursor-pointer text-xs font-semibold text-brand-700">
            رفع
            <input className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              upload(file).catch((err) => setError(err instanceof Error ? err.message : 'فشل الرفع'));
              event.target.value = '';
            }} />
          </label>
        </div>
        {data.attachments.length === 0 ? <p className="text-xs text-muted">لا مرفقات</p> : data.attachments.map((file) => (
          <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
            <a className="font-semibold text-brand-700" href={`${getApiBase()}/api/work/attachments/${file.id}/file`} onClick={async (event) => {
              event.preventDefault();
              const blob = await api<Blob>(`/work/attachments/${file.id}/file`);
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = file.fileName;
              link.click();
              URL.revokeObjectURL(url);
            }}>{file.fileName}</a>
            <Button variant="ghost" onClick={() => remove(file.id)}>حذف</Button>
          </div>
        ))}
      </div>
      {data.notes.length > 0 && <p className="text-xs text-muted">{data.notes.length} ملاحظة داخلية</p>}
    </div>
  );
}
