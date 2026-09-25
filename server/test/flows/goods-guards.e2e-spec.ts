import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from '../helpers/assert.js';
import { ensureE2eApp } from '../helpers/app.js';
import { api, SEED, signIn } from '../helpers/auth.js';
import {
  importGoodsOrder,
  importGoodsOrderRaw,
  priceOrder,
  type GoodsOrder,
} from '../helpers/goods.js';

describe('flow: goods guards', () => {
  let ops = '';
  let dealer = '';
  let admin = '';

  beforeAll(async () => {
    await ensureE2eApp();
    ops = await signIn(SEED.ops.email, SEED.ops.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
    admin = await signIn(SEED.admin.email, SEED.admin.password);
  });

  it('E3: import empty / missing url / bad qty → 400', async () => {
    const noFile = await importGoodsOrderRaw(dealer, null);
    expectStatus(noFile, 400, 'no file');

    const missingUrl = await importGoodsOrder(dealer, [
      ['', 1] as unknown as [string, number],
    ]);
    expect(missingUrl.status).toBe(400);

    const badQty = await importGoodsOrder(dealer, [
      ['https://www.amazon.com/dp/B0BADQTY', 0],
    ]);
    expect(badQty.status).toBe(400);
  });

  it('E4: non-dealer import → 403', async () => {
    const res = await importGoodsOrder(ops, [
      ['https://www.amazon.com/dp/B0OPSIMPORT', 1],
    ]);
    expect(res.status).toBe(403);
  });

  it('E6: submit-fulfill without full prices → 400', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(dealer, [
      [`https://www.amazon.com/dp/B0NOPRICE${stamp}A`, 1],
      [`https://www.amazon.com/dp/B0NOPRICE${stamp}B`, 1],
    ]);
    const order = imported.order!;

    // only price first line
    const partialPrice = await api(`/api/goods/orders/${order.id}`, dealer, {
      method: 'PUT',
      body: JSON.stringify({
        items: [{ id: order.items[0].id, unitPrice: 10 }],
      }),
    });
    expectOk(partialPrice);

    const bad = await api(
      `/api/goods/orders/${order.id}/submit-fulfill`,
      dealer,
      { method: 'POST' },
    );
    expectStatus(bad, 400);
  });

  it('E13: dealer cannot access others order; ops cannot list reserve', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(dealer, [
      [`https://www.amazon.com/dp/B0OTHER${stamp}`, 1],
    ]);
    const orderId = imported.order!.id;

    const opsReserve = await api('/api/goods/orders/reserve', ops);
    expectStatus(opsReserve, [401, 403], 'ops reserve');

    const dealerFulfill = await api('/api/goods/orders/fulfill', dealer);
    expectStatus(dealerFulfill, [401, 403], 'dealer fulfill');

    // second dealer user
    const email = `e2e_dealer2_${stamp}@local.dev`;
    const created = await api('/api/rbac/users', admin, {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'Test@12345678',
        name: `dealer2_${stamp}`,
      }),
    });
    expectOk(created);
    const userId = (created.data as { id: string }).id;
    const roles = await api('/api/rbac/roles', admin);
    const dealerRole = (
      roles.data as Array<{ roleId: number; key?: string }>
    ).find((r) => r.key === 'dealer');
    expect(dealerRole).toBeTruthy();
    expectOk(
      await api(`/api/rbac/users/${userId}/roles`, admin, {
        method: 'PUT',
        body: JSON.stringify({ roleIds: [dealerRole!.roleId] }),
      }),
    );

    const dealer2 = await signIn(email, 'Test@12345678');
    const foreign = await api(`/api/goods/orders/${orderId}`, dealer2);
    expectStatus(foreign, [403, 404], 'other dealer order');

    await api(`/api/rbac/users/${userId}`, admin, { method: 'DELETE' });
  });

  it('E13b: dealer detail of nonexistent → 404', async () => {
    const missing = await api('/api/goods/orders/999999991', dealer);
    expectStatus(missing, [403, 404]);
  });

  it('E14: sync-price blocked after submit-fulfill', async () => {
    const stamp = Date.now().toString(36);
    const imported = await importGoodsOrder(dealer, [
      [`https://www.amazon.com/dp/B0SYNC${stamp}`, 1],
    ]);
    const order = imported.order!;
    expectOk(await priceOrder(dealer, order, [12]));

    const syncWhileReserving = await api(
      `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
      dealer,
      { method: 'POST' },
    );
    // stubbed Bright Data → 503, or success if somehow priced
    expectStatus(syncWhileReserving, [200, 201, 503], 'sync reserving');

    expectOk(
      await api(`/api/goods/orders/${order.id}/submit-fulfill`, dealer, {
        method: 'POST',
      }),
    );

    const syncAfter = await api(
      `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
      dealer,
      { method: 'POST' },
    );
    expectStatus(syncAfter, 400, 'sync after submit');
  });
});
