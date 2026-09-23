import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = 'http://localhost:3000';
const root = process.cwd();

async function signIn(email: string, password: string) {
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
      ? raw
          .split(',')
          .map((c) => c.split(';')[0].trim())
          .join('; ')
      : '';
  if (!res.ok) throw new Error(`sign-in ${email}: ${await res.text()}`);
  return cookies;
}

async function api(
  path: string,
  cookie: string,
  init: RequestInit = {},
) {
  const headers: Record<string, string> = {
    Cookie: cookie,
    Origin: 'http://localhost:5288',
    ...(init.headers as Record<string, string>),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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
  const dealerCookie = await signIn('dealer@local.dev', 'Dealer@123456');
  const opsCookie = await signIn('ops@local.dev', 'Ops@123456');
  const adminCookie = await signIn('admin@local.dev', 'Admin@123456');

  const me = await api('/api/me', dealerCookie);
  console.log('dealer-me', JSON.stringify({
    isDealer: (me.data as { isDealer?: boolean }).isDealer,
    roleKeys: (me.data as { roleKeys?: string[] }).roleKeys,
  }));

  // build excel
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['url', '数量'],
    ['https://www.amazon.com/dp/B0TEST001', 2],
    ['https://www.amazon.com/dp/B0TEST002', 3],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '预约');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const xlsxPath = join(root, 'e2e-goods.xlsx');
  writeFileSync(xlsxPath, buf);

  const form = new FormData();
  form.append(
    'file',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'e2e-goods.xlsx',
  );
  form.append('dealerRemark', 'e2e-remark');

  const imported = await fetch(`${BASE}/api/goods/orders/import`, {
    method: 'POST',
    headers: { Cookie: dealerCookie, Origin: 'http://localhost:5288' },
    body: form,
  });
  const importedText = await imported.text();
  console.log('import', imported.status, importedText.slice(0, 300));
  if (!imported.ok) throw new Error('import failed');
  const order = JSON.parse(importedText) as {
    id: number;
    items: Array<{ id: number }>;
    currencyCode: string;
  };

  const priced = await api(`/api/goods/orders/${order.id}`, dealerCookie, {
    method: 'PUT',
    body: JSON.stringify({
      dealerRemark: 'e2e-remark',
      items: order.items.map((it, idx) => ({
        id: it.id,
        unitPrice: idx === 0 ? 10 : 20,
      })),
    }),
  });
  console.log('priced', priced.status, (priced.data as { status?: string }).status);

  const submitted = await api(
    `/api/goods/orders/${order.id}/submit-fulfill`,
    dealerCookie,
    { method: 'POST' },
  );
  console.log(
    'submit-fulfill',
    submitted.status,
    (submitted.data as { status?: string }).status,
  );

  // partial fulfill: only first item
  const fulfilled = await api(`/api/goods/orders/${order.id}`, opsCookie, {
    method: 'PUT',
    body: JSON.stringify({
      items: [
        { id: order.items[0].id, fulfillQty: 2 },
        { id: order.items[1].id, fulfillQty: 0 },
      ],
    }),
  });
  console.log(
    'fulfill-save',
    fulfilled.status,
    (fulfilled.data as { status?: string }).status,
  );
  if ((fulfilled.data as { status?: string }).status !== 'partial_fulfill') {
    throw new Error('expected partial_fulfill');
  }

  const walletsBefore = await api('/api/finance/wallet/list', dealerCookie);
  const balBefore = Number(
    (walletsBefore.data as Array<{ balance: string }>)[0]?.balance ?? 0,
  );
  console.log('balance-before', balBefore);

  const completed = await api(
    `/api/goods/orders/${order.id}/submit-complete`,
    opsCookie,
    { method: 'POST' },
  );
  console.log('complete', completed.status);
  const deduction = (
    completed.data as {
      deduction: { deductionNumber: string; amount: string; amountBase: string };
      order: { status: string };
    }
  ).deduction;
  console.log('deduction', JSON.stringify(deduction));
  // 10 * 2 = 20 in order currency (USD by default)
  if (Number(deduction.amount) !== 20) {
    throw new Error(`expected amount 20 got ${deduction.amount}`);
  }

  const verified = await api('/api/finance/deduction/verify', adminCookie, {
    method: 'PUT',
    body: JSON.stringify({
      deductionNumber: deduction.deductionNumber,
      verify: true,
      verifyRemark: 'e2e',
    }),
  });
  console.log('verify', verified.status);

  const walletsAfter = await api('/api/finance/wallet/list', dealerCookie);
  const balAfter = Number(
    (walletsAfter.data as Array<{ balance: string }>)[0]?.balance ?? 0,
  );
  console.log('balance-after', balAfter, 'delta', balAfter - balBefore);
  if (Math.abs(balAfter - (balBefore - Number(deduction.amountBase))) > 0.01) {
    throw new Error('balance not deducted correctly');
  }

  try {
    unlinkSync(xlsxPath);
  } catch {
    /* ignore */
  }
  console.log('GOODS_E2E_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
