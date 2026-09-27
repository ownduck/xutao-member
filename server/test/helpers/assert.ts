import { expect } from 'vitest';
import type { ApiResult } from './auth.js';

export function expectStatus(
  res: ApiResult,
  want: number | number[],
  label?: string,
) {
  const ok = Array.isArray(want) ? want.includes(res.status) : res.status === want;
  expect(
    ok,
    `${label ?? 'status'}: expected ${JSON.stringify(want)} got ${res.status} body=${String(res.text).slice(0, 300)}`,
  ).toBe(true);
}

export function expectOk(res: ApiResult, label?: string) {
  expectStatus(res, [200, 201], label);
}

/** List endpoints that use server-side pagination. */
export function expectPageResult(
  res: ApiResult,
  label?: string,
): {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
} {
  expectOk(res, label);
  const body = res.data as {
    items?: unknown;
    total?: unknown;
    page?: unknown;
    pageSize?: unknown;
  };
  expect(Array.isArray(body?.items), `${label ?? 'page'}: items array`).toBe(
    true,
  );
  expect(typeof body?.total, `${label ?? 'page'}: total number`).toBe('number');
  expect(typeof body?.page, `${label ?? 'page'}: page number`).toBe('number');
  expect(typeof body?.pageSize, `${label ?? 'page'}: pageSize number`).toBe(
    'number',
  );
  return body as {
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
  };
}
