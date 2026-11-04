import { useMemo, useState } from 'react';
import {
  PAGES,
  accessFromPages,
  normalizeAccess,
  parseAccess,
  type AccessMap,
  type PageId,
} from '@m5azen/shared';
import { Button } from './ui';

function pagesFromAccess(access: AccessMap): PageId[] {
  return PAGES.filter((page) => access[page.id]?.view).map((page) => page.id);
}

export function ScreenPermissionsPicker({
  value,
  onChange,
}: {
  value: PageId[];
  onChange: (pages: PageId[]) => void;
}) {
  const groups = useMemo(() => [...new Set(PAGES.map((page) => page.group))], []);
  const selected = new Set(value);

  function toggle(page: PageId) {
    if (selected.has(page)) onChange(value.filter((id) => id !== page));
    else onChange([...value, page]);
  }

  function selectAll() {
    onChange(PAGES.map((page) => page.id));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-slate-700">
          الصلاحيات المسموحة
          <span className="ms-2 font-medium text-slate-500">({value.length} من {PAGES.length})</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="text-xs font-bold text-brand-700 hover:underline" onClick={selectAll}>
            تحديد الكل
          </button>
          <button type="button" className="text-xs font-bold text-slate-500 hover:underline" onClick={clearAll}>
            إلغاء الكل
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {PAGES.filter((page) => page.group === group).map((page) => {
                const checked = selected.has(page.id);
                return (
                  <label
                    key={page.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${
                      checked
                        ? 'border-brand-300 bg-brand-50 font-bold text-brand-900'
                        : 'border-slate-100 bg-slate-50/60 font-medium text-slate-700 hover:border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-brand-700)]"
                      checked={checked}
                      onChange={() => toggle(page.id)}
                    />
                    {page.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">
        الشاشات غير المحددة هتبقى مقفولة للمستخدم، وهيظهر له رسالة إنه مفيش صلاحية على الجزء ده.
      </p>
    </div>
  );
}

/** Edit existing user permissions (used from the users table). */
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
  const initialPages = useMemo(
    () => pagesFromAccess(value ? normalizeAccess(JSON.parse(value), role) : parseAccess(null, role)),
    [role, value],
  );
  const [pages, setPages] = useState<PageId[]>(initialPages);

  return (
    <div className="mt-3 space-y-3">
      <ScreenPermissionsPicker value={pages} onChange={setPages} />
      <Button type="button" disabled={busy} onClick={() => onSave(accessFromPages(pages))}>
        حفظ الصلاحيات
      </Button>
    </div>
  );
}

export { accessFromPages, pagesFromAccess };
