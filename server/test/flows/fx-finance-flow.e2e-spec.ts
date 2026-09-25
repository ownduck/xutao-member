import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from '../helpers/assert.js';
import { ensureE2eApp } from '../helpers/app.js';
import { api, SEED, signIn } from '../helpers/auth.js';

describe('flow: fx + finance', () => {
  let admin = '';
  let ops = '';
  let dealerId = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    ops = await signIn(SEED.ops.email, SEED.ops.password);
    await signIn(SEED.dealer.email, SEED.dealer.password);

    const dealers = await api('/api/finance/dealers', admin);
    expectOk(dealers);
    dealerId = (dealers.data as Array<{ id: string }>)[0]?.id ?? '';
    expect(dealerId).toBeTruthy();
  });

  it('C4: CNY recharge → amountBase → wallet USD delta', async () => {
    const sync = await api('/api/site/exchange-rates/sync', admin, {
      method: 'POST',
    });
    expectStatus(sync, [200, 201], 'fx sync stub');

    const walletsBefore = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    expectOk(walletsBefore);
    const balBefore = Number(
      (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );

    const created = await api('/api/finance/recharge', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 100,
        currencyCode: 'CNY',
        remark: 'flow-cny',
      }),
    });
    expectOk(created, 'cny recharge');
    const row = created.data as {
      rechargeNumber: string;
      amountBase: string;
      currencyCode: string;
    };
    expect(row.currencyCode).toBe('CNY');
    const expectedBase = Number(row.amountBase);
    expect(expectedBase).toBeGreaterThan(0);

    const verified = await api('/api/finance/recharge/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        rechargeNumber: row.rechargeNumber,
        verify: true,
        verifyRemark: 'flow-ok',
      }),
    });
    expectOk(verified);

    const walletsAfter = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const wallet = (walletsAfter.data as Array<{
      balance: string;
      currencyCode: string;
    }>)[0];
    expect(wallet.currencyCode).toBe('USD');
    expect(
      Math.abs(Number(wallet.balance) - balBefore - expectedBase),
    ).toBeLessThan(0.02);
  });

  it('C5: default currency change does not alter existing wallet currency', async () => {
    const put = await api('/api/site/settings', admin, {
      method: 'PUT',
      body: JSON.stringify({
        defaultCountryCode: 'CN',
        defaultCurrencyCode: 'CNY',
      }),
    });
    expectOk(put);

    const wallets = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const wallet = (wallets.data as Array<{ currencyCode: string }>)[0];
    expect(wallet.currencyCode).toBe('USD');

    await api('/api/site/settings', admin, {
      method: 'PUT',
      body: JSON.stringify({
        defaultCountryCode: 'US',
        defaultCurrencyCode: 'USD',
      }),
    });
  });
});
