export type Bookmark = { id: string; title: string; subtitle: string; to: string };

function read(key: string): Bookmark[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function favorites() {
  return read('m5azen_favorites');
}

export function recentPages() {
  return read('m5azen_recent');
}

export function toggleFavorite(item: Bookmark) {
  const items = favorites();
  const next = items.some((row) => row.id === item.id)
    ? items.filter((row) => row.id !== item.id)
    : [item, ...items].slice(0, 12);
  localStorage.setItem('m5azen_favorites', JSON.stringify(next));
  return next;
}

export function pushRecent(item: Bookmark) {
  const next = [item, ...recentPages().filter((row) => row.id !== item.id)].slice(0, 8);
  localStorage.setItem('m5azen_recent', JSON.stringify(next));
}
