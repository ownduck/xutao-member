import { config } from 'dotenv';
config({ path: '.env' });

import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from '../helpers/assert.js';
import { ensureE2eApp } from '../helpers/app.js';
import { api, SEED, signIn } from '../helpers/auth.js';
import {
  importGoodsOrder,
  type GoodsOrder,
} from '../helpers/goods.js';

const hasBrightData = Boolean(process.env.BRIGHTDATA_API_TOKEN?.trim());
const runLive =
  hasBrightData && process.env.E2E_LIVE_BRIGHTDATA === '1';

describe.skipIf(!runLive)('flow: goods price sync live', () => {
  let dealer = '';

  beforeAll(async () => {
    const app = await ensureE2eApp();
    app.enableLiveBrightData();
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
  }, 120_000);

  it(
    'E15: sync-price fills unitPrice; blocked after submit-fulfill',
    async () => {
      const imported = await importGoodsOrder(
        dealer,
        [
          ['https://www.amazon.com/dp/B0HG9P3CJT', 2],
          ['https://www.amazon.com/dp/B0TESTPRICE2', 1],
        ],
        'price-sync-live',
      );
      expect(imported.status).toBeLessThan(400);
      const order = imported.order!;
      expect(order.priceStatus).toBe(0);

      const qty = await api(`/api/goods/orders/${order.id}`, dealer, {
        method: 'PUT',
        body: JSON.stringify({
          items: [
            { id: order.items[0].id, reserveQty: 5 },
            { id: order.items[1].id, reserveQty: 2 },
          ],
        }),
      });
      expectOk(qty);

      const syncOne = await api(
        `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
        dealer,
        { method: 'POST' },
      );
      expectOk(syncOne, 'live sync-price');
      const syncBody = syncOne.data as {
        unitPrice?: number;
        usdPrice?: number;
        ok?: boolean;
      };
      expect(Number(syncBody.unitPrice ?? syncBody.usdPrice)).toBeGreaterThan(0);

      const save = await api(`/api/goods/orders/${order.id}`, dealer, {
        method: 'PUT',
        body: JSON.stringify({
          items: [
            {
              id: order.items[0].id,
              unitPrice: Number(syncBody.unitPrice),
            },
            { id: order.items[1].id, unitPrice: 9.99 },
          ],
        }),
      });
      expectOk(save);
      expect((save.data as GoodsOrder).priceStatus).toBe(1);

      const submitted = await api(
        `/api/goods/orders/${order.id}/submit-fulfill`,
        dealer,
        { method: 'POST' },
      );
      expectOk(submitted);
      expect((submitted.data as GoodsOrder).status).toBe('pending_fulfill');

      const blocked = await api(
        `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
        dealer,
        { method: 'POST' },
      );
      expect(blocked.status).toBeGreaterThanOrEqual(400);

      const app = await ensureE2eApp();
      app.disableLiveBrightData();
    },
    180_000,
  );
});

// Keep describe registered when skipped so Vitest counts it.
describe.runIf(!runLive)('flow: goods price sync live (skipped)', () => {
  it('E15 skipped unless BRIGHTDATA_API_TOKEN + E2E_LIVE_BRIGHTDATA=1', () => {
    expect(runLive).toBe(false);
  });
});
