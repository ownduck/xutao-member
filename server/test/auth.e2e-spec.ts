import { beforeAll, describe, expect, it } from 'vitest';
import { expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, authFetch, SEED, signIn } from './helpers/auth.js';

describe('auth', () => {
  beforeAll(async () => {
    await ensureE2eApp();
  });

  it('sign-in admin/ops/dealer', async () => {
    const admin = await signIn(SEED.admin.email, SEED.admin.password);
    const ops = await signIn(SEED.ops.email, SEED.ops.password);
    const dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
    expect(admin.length).toBeGreaterThan(0);
    expect(ops.length).toBeGreaterThan(0);
    expect(dealer.length).toBeGreaterThan(0);
  });

  it('wrong password fails', async () => {
    const res = await authFetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({
        email: SEED.admin.email,
        password: 'wrong-password',
      }),
    });
    expect([400, 401, 403]).toContain(res.status);
  });

  it('sign-up disabled', async () => {
    const res = await authFetch('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        email: `nosignup_${Date.now()}@local.dev`,
        password: 'Test@123456',
        name: 'nosignup',
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('get-session with/without cookie', async () => {
    const anon = await api('/api/auth/get-session', null);
    expectStatus(anon, 200);
    const cookie = await signIn(SEED.admin.email, SEED.admin.password);
    const sess = await api('/api/auth/get-session', cookie);
    expectStatus(sess, 200);
    expect(sess.data).toBeTruthy();
  });

  it('sign-out clears session for business routes', async () => {
    const cookie = await signIn(SEED.admin.email, SEED.admin.password);
    const out = await api('/api/auth/sign-out', cookie, { method: 'POST' });
    expect([200, 204]).toContain(out.status);
    const me = await api('/api/me', cookie);
    expectStatus(me, [401, 403]);
  });
});
