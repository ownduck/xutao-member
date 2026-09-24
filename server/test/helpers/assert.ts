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
