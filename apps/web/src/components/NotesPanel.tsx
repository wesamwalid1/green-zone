import { useEffect, useState } from 'react';
import { api, formatRelative } from '../lib/api';
import { Button, Input } from './ui';

type Note = { id: string; body: string; userName?: string | null; createdAt: string };

export function NotesPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');

  async function load() {
    setNotes(await api<Note[]>(`/notes?entityType=${entityType}&entityId=${entityId}`));
  }

  useEffect(() => { load(); }, [entityType, entityId]);

  async function add() {
    if (!text.trim()) return;
    await api('/notes', { method: 'POST', body: JSON.stringify({ entityType, entityId, body: text }) });
    setText('');
    load();
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4 no-print">
      <div className="mb-2 font-bold">ملاحظات داخلية</div>
      <div className="mb-3 flex gap-2">
        <Input value={text} placeholder="ملاحظة على هذا السجل" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && add()} />
        <Button onClick={add}>إضافة</Button>
      </div>
      <div className="space-y-2">
        {notes.map((note) => (
          <div key={note.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <div>{note.body}</div>
            <div className="mt-1 text-xs text-muted">{note.userName || 'مستخدم'} · {formatRelative(note.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
