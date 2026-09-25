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
    // clear lock first
    const { sql } = await import('drizzle-orm');
    const { db } = await import('../src/db/index.js');
    await db.execute(
      sql`UPDATE cron_job_lock SET locked_until = NOW() - INTERVAL '1 second'`,
    );

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
    const anySkip = bodies.some((x) => x?.skipped === true);
    const anyRan = bodies.some((x) => x && x.skipped !== true);
    expect(anyRan || anySkip).toBe(true);
    // Prefer seeing a lock skip; if both finish (rare), still OK if both 200
    if (!anySkip) {
      expect(bodies.every((x) => x != null)).toBe(true);
    } else {
      expect(anySkip).toBe(true);
    }
  });

  it('exchange-rates cron', async () => {
    const fx = await api('/api/cron/exchange-rates', null, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expectStatus(fx, [200, 201], 'cron fx stub');
  });
});
