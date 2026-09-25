import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from '../helpers/assert.js';
import { ensureE2eApp } from '../helpers/app.js';
import { api, SEED, signIn } from '../helpers/auth.js';
import {
  importGoodsOrder,
  priceOrder,
  type GoodsOrder,
} from '../helpers/goods.js';

describe('flow: goods order wallet path', () => {
  let admin = '';
  let ops = '';
  let dealer = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    ops = await signIn(SEED.ops.email, SEED.ops.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
  });

  it('E5–E7/E9: price→pending_fulfill→partial→complete→verify→balance', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(
      dealer,
      [
        [`https://www.amazon.com/dp/B0FLOW${stamp}A`, 2],
        [`https://www.amazon.com/dp/B0FLOW${stamp}B`, 3],
      ],
      'flow-wallet',
    );
    expect(imported.status).toBeLessThan(400);
    const order = imported.order!;
    expect(order.id).toBeGreaterThan(0);

    const priced = await priceOrder(dealer, order, [10, 20]);
    expectOk(priced, 'price');
    const pricedBody = priced.data as GoodsOrder;
    expect(pricedBody.priceStatus).toBe(1);
    expect(pricedBody.status).toBe('reserving');

    const submitted = await api(
      `/api/goods/orders/${order.id}/submit-fulfill`,
      dealer,
      { method: 'POST' },
    );
    expectOk(submitted, 'submit-fulfill');
    expect((submitted.data as GoodsOrder).status).toBe('pending_fulfill');

    const partial = await api(`/api/goods/orders/${order.id}`, ops, {
      method: 'PUT',
      body: JSON.stringify({
        items: [
          { id: order.items[0].id, fulfillQty: 2 },
          { id: order.items[1].id, fulfillQty: 0 },
        ],
      }),
    });
    expectOk(partial, 'partial fulfill');
    expect((partial.data as GoodsOrder).status).toBe('partial_fulfill');

    const walletsBefore = await api('/api/finance/wallet/list', dealer);
    expectOk(walletsBefore);
    const balBefore = Number(
      (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );

    const completed = await api(
      `/api/goods/orders/${order.id}/submit-complete`,
      ops,
      { method: 'POST' },
    );
    expectOk(completed, 'submit-complete');
    const payload = completed.data as {
      order: { status: string };
      deduction: {
        deductionNumber: string;
        amount: string;
        amountBase: string;
      };
    };
    expect(payload.order.status).toBe('completed');
    expect(Number(payload.deduction.amount)).toBe(20);

    const verified = await api('/api/finance/deduction/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        deductionNumber: payload.deduction.deductionNumber,
        verify: true,
        verifyRemark: 'flow-e2e',
      }),
    });
    expectOk(verified, 'deduction verify');

    const walletsAfter = await api('/api/finance/wallet/list', dealer);
    const balAfter = Number(
      (walletsAfter.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );
    expect(Math.abs(balAfter - (balBefore - Number(payload.deduction.amountBase)))).toBeLessThan(
      0.02,
    );

    // E11: completed 后再 PUT / submit
    const putDone = await api(`/api/goods/orders/${order.id}`, ops, {
      method: 'PUT',
      body: JSON.stringify({
        items: [{ id: order.items[0].id, fulfillQty: 1 }],
      }),
    });
    expectStatus(putDone, 400, 'completed PUT');

    const againComplete = await api(
      `/api/goods/orders/${order.id}/submit-complete`,
      ops,
      { method: 'POST' },
    );
    expectStatus(againComplete, 400, 'E12 duplicate complete');
  });

  it('E8: full fulfill → fulfilled', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(dealer, [
      [`https://www.amazon.com/dp/B0FULL${stamp}`, 2],
    ]);
    expect(imported.status).toBeLessThan(400);
    const order = imported.order!;

    expectOk(await priceOrder(dealer, order, [5]));
    const submitted = await api(
      `/api/goods/orders/${order.id}/submit-fulfill`,
      dealer,
      { method: 'POST' },
    );
    expectOk(submitted);
    expect((submitted.data as GoodsOrder).status).toBe('pending_fulfill');

    const full = await api(`/api/goods/orders/${order.id}`, ops, {
      method: 'PUT',
      body: JSON.stringify({
        items: [{ id: order.items[0].id, fulfillQty: 2 }],
      }),
    });
    expectOk(full);
    expect((full.data as GoodsOrder).status).toBe('fulfilled');
  });

  it('E10: pending_fulfill without fulfillQty → submit-complete 400', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(dealer, [
      [`https://www.amazon.com/dp/B0PEND${stamp}`, 1],
    ]);
    const order = imported.order!;
    expectOk(await priceOrder(dealer, order, [8]));
    expectOk(
      await api(`/api/goods/orders/${order.id}/submit-fulfill`, dealer, {
        method: 'POST',
      }),
    );

    const bad = await api(
      `/api/goods/orders/${order.id}/submit-complete`,
      ops,
      { method: 'POST' },
    );
    expectStatus(bad, 400);
  });
});
