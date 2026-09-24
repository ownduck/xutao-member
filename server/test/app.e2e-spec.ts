import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api } from './helpers/auth.js';

describe('app', () => {
  beforeAll(async () => {
    await ensureE2eApp();
  });

  afterAll(async () => {
    /* keep shared app for sibling files */
  });

  it('GET /api/health', async () => {
    const res = await api('/api/health', null);
    expectStatus(res, 200);
    expect(res.data).toMatchObject({ ok: true });
  });

  it('anonymous protected route → 401/403', async () => {
    const res = await api('/api/rbac/users', null);
    expectStatus(res, [401, 403]);
  });
});
