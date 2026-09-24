import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

describe('finance', () => {
  let admin = '';
  let ops = '';
  let dealer = '';
  let dealerId = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    ops = await signIn(SEED.ops.email, SEED.ops.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);

    const dealers = await api('/api/finance/dealers', admin);
    expectOk(dealers);
    dealerId = (dealers.data as Array<{ id: string }>)[0]?.id ?? '';
    expect(dealerId).toBeTruthy();
  });

  it('dealers / wallet / trade log', async () => {
    const wallets = await api('/api/finance/wallet/list', admin);
    expectOk(wallets);
    const w0 = (wallets.data as Array<{ id: number }>)?.[0];
    expect(w0).toBeTruthy();

    const detail = await api(
      `/api/finance/wallet/detail?walletId=${w0!.id}`,
      admin,
    );
    expectOk(detail);

    const logs = await api('/api/finance/trade/log', admin);
    expectOk(logs);
  });

  it('dealer denied recharge/deduction create', async () => {
    const denyRc = await api('/api/finance/recharge', dealer, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 1,
        currencyCode: 'USD',
      }),
    });
    expectStatus(denyRc, 403);

    const denyDc = await api('/api/finance/deduction', dealer, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 1,
        currencyCode: 'USD',
      }),
    });
    expectStatus(denyDc, 403);
  });

  it('recharge create + self-verify deny + admin approve', async () => {
    const rc = await api('/api/finance/recharge', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 1.23,
        currencyCode: 'USD',
        remark: 'e2e-vitest',
      }),
    });
    expectOk(rc, 'recharge create');
    const rcNo = (rc.data as { rechargeNumber: string }).rechargeNumber;
    expect(rcNo).toBeTruthy();

    const self = await api('/api/finance/recharge/verify', ops, {
      method: 'PUT',
      body: JSON.stringify({
        rechargeNumber: rcNo,
        verify: true,
        verifyRemark: 'self',
      }),
    });
    expectStatus(self, 403, 'self verify deny');

    const ok = await api('/api/finance/recharge/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        rechargeNumber: rcNo,
        verify: true,
        verifyRemark: 'e2e',
      }),
    });
    expectOk(ok, 'recharge approve');

    const listRc = await api('/api/finance/recharge/list', admin);
    expectOk(listRc);
  });

  it('deduction create + self-verify deny + approve; insufficient → 400', async () => {
    const dc = await api('/api/finance/deduction', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 0.5,
        currencyCode: 'USD',
        remark: 'e2e-deduct',
      }),
    });
    expectOk(dc, 'deduction create');
    const dcNo = (dc.data as { deductionNumber: string }).deductionNumber;

    const self = await api('/api/finance/deduction/verify', ops, {
      method: 'PUT',
      body: JSON.stringify({
        deductionNumber: dcNo,
        verify: true,
        verifyRemark: 'self',
      }),
    });
    expectStatus(self, 403, 'deduction self deny');

    const ok = await api('/api/finance/deduction/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        deductionNumber: dcNo,
        verify: true,
        verifyRemark: 'e2e',
      }),
    });
    expectOk(ok, 'deduction approve');

    const listDc = await api('/api/finance/deduction/list', admin);
    expectOk(listDc);

    const huge = await api('/api/finance/deduction', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 999999999,
        currencyCode: 'USD',
        remark: 'too-big',
      }),
    });
    // may fail at create or at verify — accept either
    if ([200, 201].includes(huge.status)) {
      const n = (huge.data as { deductionNumber: string }).deductionNumber;
      const v = await api('/api/finance/deduction/verify', admin, {
        method: 'PUT',
        body: JSON.stringify({
          deductionNumber: n,
          verify: true,
          verifyRemark: 'expect-fail',
        }),
      });
      expectStatus(v, 400, 'insufficient on verify');
    } else {
      expectStatus(huge, 400, 'insufficient on create');
    }
  });
});
