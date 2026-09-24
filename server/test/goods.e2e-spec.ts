import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

describe('goods', () => {
  let admin = '';
  let ops = '';
  let dealer = '';
  let orderId = 0;
  let itemIds: number[] = [];

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    ops = await signIn(SEED.ops.email, SEED.ops.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
  });

  it('template + list endpoints', async () => {
    const tpl = await api('/api/goods/orders/template', dealer);
    expectOk(tpl);

    const reserve = await api('/api/goods/orders/reserve', dealer);
    expectOk(reserve);

    const fulfill = await api('/api/goods/orders/fulfill', ops);
    expectOk(fulfill);

    const history = await api('/api/goods/orders/history', admin);
    expectOk(history);
  });

  it('import order from excel', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['url', '数量'],
      ['https://www.amazon.com/dp/B0VITEST01', 2],
      ['https://www.amazon.com/dp/B0VITEST02', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, '预约');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buf)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'e2e-goods.xlsx',
    );
    form.append('dealerRemark', 'vitest-e2e');

    const { baseUrl, origin } = await ensureE2eApp();
    const importedRes = await fetch(`${baseUrl}/api/goods/orders/import`, {
      method: 'POST',
      headers: { Cookie: dealer, Origin: origin },
      body: form,
    });
    const importedText = await importedRes.text();
    expect(
      importedRes.ok,
      `import failed: ${importedRes.status} ${importedText.slice(0, 300)}`,
    ).toBe(true);
    const order = JSON.parse(importedText) as {
      id: number;
      items: Array<{ id: number }>;
    };
    orderId = order.id;
    itemIds = order.items.map((i) => i.id);
    expect(orderId).toBeGreaterThan(0);
    expect(itemIds.length).toBe(2);
  });

  it('detail / price / sync / submit-fulfill / fulfillQty', async () => {
    expect(orderId).toBeGreaterThan(0);

    const detail = await api(`/api/goods/orders/${orderId}`, dealer);
    expectOk(detail);

    const priced = await api(`/api/goods/orders/${orderId}`, dealer, {
      method: 'PUT',
      body: JSON.stringify({
        dealerRemark: 'vitest-e2e',
        items: itemIds.map((id, idx) => ({
          id,
          unitPrice: idx === 0 ? 10 : 5,
        })),
      }),
    });
    expectOk(priced, 'price');

    const syncOne = await api(
      `/api/goods/orders/${orderId}/items/${itemIds[0]}/sync-price`,
      dealer,
      { method: 'POST' },
    );
    expectStatus(syncOne, [200, 201, 503], 'sync-price');

    const syncAll = await api(`/api/goods/orders/${orderId}/sync-prices`, dealer, {
      method: 'POST',
      body: JSON.stringify({ mode: 'empty' }),
    });
    expectStatus(syncAll, [200, 201, 503], 'sync-prices');

    const submitted = await api(
      `/api/goods/orders/${orderId}/submit-fulfill`,
      dealer,
      { method: 'POST' },
    );
    expectOk(submitted, 'submit-fulfill');

    const fulfilled = await api(`/api/goods/orders/${orderId}`, ops, {
      method: 'PUT',
      body: JSON.stringify({
        items: [
          { id: itemIds[0], fulfillQty: 1 },
          { id: itemIds[1], fulfillQty: 0 },
        ],
      }),
    });
    expectOk(fulfilled, 'fulfill qty');
  });

  it('submit-complete creates deduction', async () => {
    expect(orderId).toBeGreaterThan(0);
    const completed = await api(
      `/api/goods/orders/${orderId}/submit-complete`,
      ops,
      { method: 'POST' },
    );
    expectOk(completed, 'submit-complete');
    const deduction = (
      completed.data as { deduction?: { deductionNumber?: string } }
    ).deduction;
    expect(deduction?.deductionNumber).toBeTruthy();
  });
});
