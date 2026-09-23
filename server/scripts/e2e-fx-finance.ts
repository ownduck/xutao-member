import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const root = process.cwd();

async function signIn(email: string, password: string, cookieFile: string) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5288',
    },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = res.headers.get('set-cookie');
  const cookies = setCookie.length
    ? setCookie.map((c) => c.split(';')[0]).join('; ')
    : raw
      ? raw.split(',').map((c) => c.split(';')[0].trim()).join('; ')
      : '';
  writeFileSync(cookieFile, cookies, 'utf8');
  if (!res.ok) {
    throw new Error(`sign-in failed ${email}: ${await res.text()}`);
  }
  return cookies;
}

function cookieHeader(file: string) {
  return readFileSync(file, 'utf8').trim();
}

async function api(
  path: string,
  cookieFile: string,
  init: RequestInit = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(cookieFile),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  const opsCookie = join(root, 'ops.cookie');
  const adminCookie = join(root, 'admin.cookie');

  await signIn('ops@local.dev', 'Ops@123456', opsCookie);
  await signIn('admin@local.dev', 'Admin@123456', adminCookie);

  const ratesBefore = await api('/api/site/exchange-rates', opsCookie);
  console.log('rates-before', JSON.stringify(ratesBefore.data));

  const sync = await api('/api/site/exchange-rates/sync', opsCookie, {
    method: 'POST',
  });
  console.log('sync', sync.status, JSON.stringify(sync.data));

  const ratesAfter = await api('/api/site/exchange-rates', opsCookie);
  console.log('rates-after', JSON.stringify(ratesAfter.data));

  const dealers = await api('/api/finance/dealers', opsCookie);
  const dealerId = (dealers.data as Array<{ id: string }>)[0]?.id;
  if (!dealerId) throw new Error('no dealer');
  console.log('dealerId', dealerId);

  const walletsBefore = await api(
    `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
    adminCookie,
  );
  const balBefore = Number(
    (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
  );
  console.log('balance-before', balBefore);

  const created = await api('/api/finance/recharge', opsCookie, {
    method: 'POST',
    body: JSON.stringify({
      userId: dealerId,
      amount: 100,
      currencyCode: 'CNY',
      remark: 'e2e-cny',
    }),
  });
  console.log('created', created.status, JSON.stringify(created.data));
  if (created.status >= 400) throw new Error('create failed');

  const row = created.data as {
    rechargeNumber: string;
    amount: string;
    amountBase: string;
    currencyCode: string;
  };
  const expectedBase = Number(row.amountBase);
  console.log('amount', row.amount, 'amountBase', row.amountBase, 'currency', row.currencyCode);

  const verified = await api('/api/finance/recharge/verify', adminCookie, {
    method: 'PUT',
    body: JSON.stringify({
      rechargeNumber: row.rechargeNumber,
      verify: true,
      verifyRemark: 'e2e-ok',
    }),
  });
  console.log('verified', verified.status, JSON.stringify(verified.data));
  if (verified.status >= 400) throw new Error('verify failed');

  const walletsAfter = await api(
    `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
    adminCookie,
  );
  const wallet = (walletsAfter.data as Array<{
    balance: string;
    currencyCode: string;
  }>)[0];
  const balAfter = Number(wallet.balance);
  console.log('wallet', JSON.stringify(wallet));
  console.log('balance-after', balAfter, 'delta', balAfter - balBefore);

  if (wallet.currencyCode !== 'USD') {
    throw new Error(`wallet currency expected USD got ${wallet.currencyCode}`);
  }
  if (Math.abs(balAfter - balBefore - expectedBase) > 0.001) {
    throw new Error(
      `balance delta mismatch: expected ${expectedBase}, got ${balAfter - balBefore}`,
    );
  }

  const settings = await api('/api/site/settings', adminCookie, {
    method: 'PUT',
    body: JSON.stringify({
      defaultCountryCode: 'CN',
      defaultCurrencyCode: 'CNY',
    }),
  });
  console.log('settings-updated', JSON.stringify(settings.data));

  const walletsAgain = await api(
    `/api/finance/wallet/list?userId=${encodeURIComponent(dealerId)}`,
    adminCookie,
  );
  const wallet2 = (walletsAgain.data as Array<{ currencyCode: string }>)[0];
  if (wallet2.currencyCode !== 'USD') {
    throw new Error('wallet currency changed after default currency update');
  }
  console.log('wallet-currency-unchanged', wallet2.currencyCode);

  // restore default
  await api('/api/site/settings', adminCookie, {
    method: 'PUT',
    body: JSON.stringify({
      defaultCountryCode: 'US',
      defaultCurrencyCode: 'USD',
    }),
  });

  for (const f of [opsCookie, adminCookie]) {
    try {
      unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  console.log('E2E_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
