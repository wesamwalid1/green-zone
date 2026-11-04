import { useState } from 'react';

export type ColumnDef = { id: string; label: string };

export function useColumns(storageKey: string, definitions: ColumnDef[]) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved.filter((id) => definitions.some((column) => column.id === id)) : [];
    } catch {
      return [];
    }
  });

  function toggle(id: string) {
    setHidden((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      if (next.length >= definitions.length) return current;
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  return {
    visible: (id: string) => !hidden.includes(id),
    toggle,
    columns: definitions.map((column) => ({ ...column, visible: !hidden.includes(column.id) })),
  };
}
