import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

describe('me', () => {
  let admin = '';
  let tempCookie = '';
  let tempUserId = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
  });

  it('GET /api/me fields', async () => {
    const me = await api('/api/me', admin);
    expectOk(me);
    const d = me.data as {
      isSuperAdmin?: boolean;
      permissions?: string[];
      user?: { id?: string };
      roleKeys?: string[];
    };
    expect(d.isSuperAdmin).toBe(true);
    expect(Array.isArray(d.permissions)).toBe(true);
    expect(d.user?.id).toBeTruthy();
  });

  it('GET /api/me/permissions', async () => {
    const perms = await api('/api/me/permissions', admin);
    expectOk(perms);
    expect(Array.isArray(perms.data)).toBe(true);
  });

  it('PUT /api/me/password validation + success', async () => {
    const stamp = Date.now().toString(36);
    const created = await api('/api/rbac/users', admin, {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e_pwd_${stamp}@local.dev`,
        password: 'Test@12345678',
        name: `e2e_pwd_${stamp}`,
      }),
    });
    expectOk(created, 'create temp user');
    tempUserId = (created.data as { id: string }).id;

    tempCookie = await signIn(`e2e_pwd_${stamp}@local.dev`, 'Test@12345678');
    const short = await api('/api/me/password', tempCookie, {
      method: 'PUT',
      body: JSON.stringify({ password: '12345' }),
    });
    expectStatus(short, 400, 'password too short');

    const ok = await api('/api/me/password', tempCookie, {
      method: 'PUT',
      body: JSON.stringify({ password: 'NewPass@123' }),
    });
    expectOk(ok, 'password change');

    const again = await signIn(`e2e_pwd_${stamp}@local.dev`, 'NewPass@123');
    expect(again.length).toBeGreaterThan(0);

    await api(`/api/rbac/users/${tempUserId}`, admin, { method: 'DELETE' });
  });
});
