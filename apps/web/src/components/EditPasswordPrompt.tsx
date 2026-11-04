import { useEffect, useState } from 'react';
import { api, setEditToken } from '../lib/api';
import { Button, Input, Label } from './ui';

export function EditPasswordPrompt() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ask = () => {
      setValue('');
      setError('');
      setOpen(true);
    };
    window.addEventListener('m5azen-edit-password-ask', ask);
    return () => window.removeEventListener('m5azen-edit-password-ask', ask);
  }, []);

  function cancel() {
    setOpen(false);
    window.dispatchEvent(new Event('m5azen-edit-password-cancel'));
  }

  async function submit() {
    setBusy(true);
    try {
      const result = await api<{ token: string }>('/settings/edit-unlock', {
        method: 'POST',
        body: JSON.stringify({ password: value }),
      });
      if (result.token) setEditToken(result.token);
      setOpen(false);
      setValue('');
      window.dispatchEvent(new Event('m5azen-edit-password'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'كلمة السر غير صحيحة');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/40 p-4">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="text-lg font-extrabold text-slate-900">كلمة سر التعديل</div>
        <p className="mt-1 text-sm text-slate-500">التعديل محتاج كلمة السر اللي اتحددت من الإعدادات.</p>
        <div className="mt-4">
          <Label>كلمة السر</Label>
          <Input type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" dir="ltr" autoFocus />
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancel}>إلغاء</Button>
          <Button type="submit" disabled={busy || !value}>تأكيد التعديل</Button>
        </div>
      </form>
    </div>
  );
}
