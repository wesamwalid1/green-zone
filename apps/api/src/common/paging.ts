export type PageArgs = { page: number; pageSize: number; skip: number; take: number };

export function readPage(query?: { page?: string | number; pageSize?: string | number }): PageArgs | null {
  if (query?.page == null || query.page === '') return null;
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, page: PageArgs, extra?: Record<string, unknown>) {
  return { items, total, page: page.page, pageSize: page.pageSize, ...extra };
}
