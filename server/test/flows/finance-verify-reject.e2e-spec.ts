import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from '../helpers/assert.js';
import { ensureE2eApp } from '../helpers/app.js';
import { api, SEED, signIn } from '../helpers/auth.js';

describe('flow: finance verify reject', () => {
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
    dealerId = (dealers.data as Array<{ id: string }>)[0]?.id ?? '';
  });

  it('D5: recharge verify false → balance unchanged, isVerify=2', async () => {
    const walletsBefore = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const balBefore = Number(
      (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );

    const created = await api('/api/finance/recharge', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 3.5,
        currencyCode: 'USD',
        remark: 'reject-rc',
      }),
    });
    expectOk(created);
    const rcNo = (created.data as { rechargeNumber: string }).rechargeNumber;

    const rejected = await api('/api/finance/recharge/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        rechargeNumber: rcNo,
        verify: false,
        verifyRemark: 'nope',
      }),
    });
    expectOk(rejected);
    const row = rejected.data as { isVerify?: number };
    expect(Number(row.isVerify)).toBe(2);

    const walletsAfter = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const balAfter = Number(
      (walletsAfter.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );
    expect(Math.abs(balAfter - balBefore)).toBeLessThan(0.01);

    const again = await api('/api/finance/recharge/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        rechargeNumber: rcNo,
        verify: true,
        verifyRemark: 'again',
      }),
    });
    expectStatus(again, 400);
  });

  it('D6: deduction reject → balance unchanged', async () => {
    const walletsBefore = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const balBefore = Number(
      (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );

    const created = await api('/api/finance/deduction', ops, {
      method: 'POST',
      body: JSON.stringify({
        userId: dealerId,
        amount: 0.25,
        currencyCode: 'USD',
        remark: 'reject-dc',
      }),
    });
    expectOk(created);
    const dcNo = (created.data as { deductionNumber: string }).deductionNumber;

    const rejected = await api('/api/finance/deduction/verify', admin, {
      method: 'PUT',
      body: JSON.stringify({
        deductionNumber: dcNo,
        verify: false,
        verifyRemark: 'nope',
      }),
    });
    expectOk(rejected);

    const walletsAfter = await api(
      `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
      admin,
    );
    const balAfter = Number(
      (walletsAfter.data as Array<{ balance: string }>)[0]?.balance ?? 0,
    );
    expect(Math.abs(balAfter - balBefore)).toBeLessThan(0.01);
  });

  it('D8: dealer cannot view other wallet detail', async () => {
    const wallets = await api('/api/finance/wallet/list', admin);
    expectOk(wallets);
    const other = (wallets.data as Array<{ id: number; userId: string }>).find(
      (w) => w.userId !== dealerId,
    );
    const walletId = other?.id ?? 999999001;
    const detail = await api(
      `/api/finance/wallet/detail?walletId=${walletId}`,
      dealer,
    );
    expectStatus(detail, [403, 404]);
  });
});
