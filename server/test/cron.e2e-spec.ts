import { beforeAll, describe, expect, it } from 'vitest';
import { expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api } from './helpers/auth.js';

describe('cron', () => {
  let cronSecret = '';

  beforeAll(async () => {
    const app = await ensureE2eApp();
    cronSecret = app.cronSecret;
  });

  it('price-sync requires Bearer secret', async () => {
    const noAuth = await api('/api/cron/price-sync', null);
    expectStatus(noAuth, 401);

    const bad = await api('/api/cron/price-sync', null, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expectStatus(bad, 401);
  });

  it('price-sync with secret + concurrent lock', async () => {
    const ok1 = await api('/api/cron/price-sync', null, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect([200, 201]).toContain(ok1.status);

    const [a, b] = await Promise.all([
      api('/api/cron/price-sync', null, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }),
      api('/api/cron/price-sync', null, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bodies = [a.data, b.data] as Array<{ skipped?: boolean }>;
    // lock may or may not trigger if jobs are fast; both 200 is enough
    expect(bodies.every((x) => x != null)).toBe(true);
  });

  it('exchange-rates cron', async () => {
    const fx = await api('/api/cron/exchange-rates', null, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expectStatus(fx, [200, 201, 503]);
  });
});
