import { useMemo, useState } from 'react';
import { PAGES, templateFor, normalizeAccess, type AccessMap, type PageId } from '@m5azen/shared';
import { Button } from './ui';

const PRESETS = [
  { id: 'ADMIN', label: 'كل الصلاحيات' },
  { id: 'ACCOUNTANT', label: 'محاسب' },
  { id: 'SALES', label: 'مبيعات' },
  { id: 'WAREHOUSE', label: 'مخزن' },
];

export function UserAccess({
  role,
  value,
  onSave,
  busy,
}: {
  role: string;
  value: string | null;
  onSave: (access: AccessMap) => Promise<void>;
  busy?: boolean;
}) {
  const initial = useMemo(() => (value ? normalizeAccess(JSON.parse(value), role) : templateFor(role)), [role, value]);
  const [access, setAccess] = useState<AccessMap>(initial);
  const [open, setOpen] = useState<PageId | null>('sales');
  const groups = [...new Set(PAGES.map((page) => page.group))];

  function setView(page: PageId, view: boolean) {
    setAccess((current) => {
      const def = PAGES.find((item) => item.id === page)!;
      return {
        ...current,
        [page]: view
          ? { view: true, actions: def.actions.map((action) => action.id), fields: def.fields.map((field) => field.id) }
          : { view: false, actions: [], fields: [] },
      };
    });
  }

  function toggle(page: PageId, kind: 'actions' | 'fields', id: string) {
    setAccess((current) => {
      const grant = current[page];
      const list = grant[kind].includes(id) ? grant[kind].filter((item) => item !== id) : [...grant[kind], id];
      return { ...current, [page]: { ...grant, [kind]: list } };
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button key={preset.id} type="button" variant="secondary" onClick={() => setAccess(templateFor(preset.id))}>{preset.label}</Button>
        ))}
      </div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group}>
            <div className="mb-1 text-xs font-bold text-slate-500">{group}</div>
            <div className="space-y-1">
              {PAGES.filter((page) => page.group === group).map((page) => {
                const grant = access[page.id];
                const expanded = open === page.id && grant.view;
                return (
                  <div key={page.id} className="rounded-lg border border-slate-100">
                    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
                      <span className="font-semibold text-slate-800">{page.label}</span>
                      <input type="checkbox" checked={grant.view} onChange={(event) => { setView(page.id, event.target.checked); setOpen(page.id); }} />
                    </label>
                    {grant.view && (page.actions.length > 0 || page.fields.length > 0) && (
                      <button type="button" className="px-3 pb-2 text-xs font-bold text-brand-700" onClick={() => setOpen(expanded ? null : page.id)}>
                        {expanded ? 'إخفاء التفاصيل' : 'يعمل إيه ويشوف إيه'}
                      </button>
                    )}
                    {expanded && (
                      <div className="grid gap-3 border-t border-slate-100 px-3 py-2 sm:grid-cols-2">
                        {page.actions.length > 0 && (
                          <div>
                            <div className="mb-1 text-xs font-bold text-slate-500">يعمل</div>
                            <div className="flex flex-wrap gap-2">
                              {page.actions.map((action) => (
                                <label key={action.id} className="flex items-center gap-1 text-sm">
                                  <input type="checkbox" checked={grant.actions.includes(action.id)} onChange={() => toggle(page.id, 'actions', action.id)} />
                                  {action.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        {page.fields.length > 0 && (
                          <div>
                            <div className="mb-1 text-xs font-bold text-slate-500">يشوف</div>
                            <div className="flex flex-wrap gap-2">
                              {page.fields.map((field) => (
                                <label key={field.id} className="flex items-center gap-1 text-sm">
                                  <input type="checkbox" checked={grant.fields.includes(field.id)} onChange={() => toggle(page.id, 'fields', field.id)} />
                                  {field.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" className="mt-3" disabled={busy} onClick={() => onSave(access)}>حفظ الصلاحيات</Button>
    </div>
  );
}
