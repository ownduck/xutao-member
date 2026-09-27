export type PageQuery = {
  page?: number | string;
  pageSize?: number | string;
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export function parsePageQuery(query: PageQuery): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = Math.max(
    1,
    Number.parseInt(String(query.page ?? DEFAULT_PAGE), 10) || DEFAULT_PAGE,
  );
  const rawSize =
    Number.parseInt(String(query.pageSize ?? DEFAULT_PAGE_SIZE), 10) ||
    DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<T> {
  return { items, total, page, pageSize };
}
