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

type Order = {
  id: number;
  status: string;
  priceStatus: number;
  currencyCode: string;
  items: Array<{
    id: number;
    amazonUrl: string;
    reserveQty: number;
    unitPrice?: string | null;
  }>;
};

async function main() {
  const dealerCookie = await signIn('dealer@local.dev', 'Dealer@123456');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['url', '数量'],
    ['https://www.amazon.com/dp/B0HG9P3CJT', 2],
    ['https://www.amazon.com/dp/B0TESTPRICE2', 1],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '预约');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const xlsxPath = join(root, 'e2e-price.xlsx');
  writeFileSync(xlsxPath, buf);

  const form = new FormData();
  form.append(
    'file',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'e2e-price.xlsx',
  );
  form.append('dealerRemark', 'price-sync-e2e');

  const imported = await fetch(`${BASE}/api/goods/orders/import`, {
    method: 'POST',
    headers: { Cookie: dealerCookie, Origin: 'http://localhost:5288' },
    body: form,
  });
  const importedText = await imported.text();
  console.log('import', imported.status);
  if (!imported.ok) throw new Error(`import failed: ${importedText}`);
  const order = JSON.parse(importedText) as Order;
  if (order.priceStatus !== 0) {
    throw new Error(`expected priceStatus 0 got ${order.priceStatus}`);
  }
  console.log('order', order.id, 'priceStatus', order.priceStatus);

  // change reserveQty
  const qtyUpdated = await api(`/api/goods/orders/${order.id}`, dealerCookie, {
    method: 'PUT',
    body: JSON.stringify({
      items: [
        { id: order.items[0].id, reserveQty: 5 },
        { id: order.items[1].id, reserveQty: 2 },
      ],
    }),
  });
  if (qtyUpdated.status < 200 || qtyUpdated.status >= 300) {
    throw new Error(`qty update failed: ${JSON.stringify(qtyUpdated.data)}`);
  }
  const afterQty = qtyUpdated.data as Order;
  const q0 = afterQty.items.find((i) => i.id === order.items[0].id)?.reserveQty;
  if (q0 !== 5) throw new Error(`expected reserveQty 5 got ${q0}`);
  console.log('reserveQty-ok', q0);

  // sync single item (Bright Data — may take up to 120s)
  console.log('sync-item start...');
  const synced = await api(
    `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
    dealerCookie,
    { method: 'POST' },
  );
  console.log('sync-item', synced.status, JSON.stringify(synced.data).slice(0, 400));
  if (synced.status < 200 || synced.status >= 300) {
    throw new Error(`sync-item failed: ${JSON.stringify(synced.data)}`);
  }
  const syncBody = synced.data as {
    unitPrice: number;
    usdPrice: number;
    currencyCode: string;
  };
  if (!(syncBody.unitPrice > 0) || !(syncBody.usdPrice > 0)) {
    throw new Error('sync returned invalid price');
  }

  // persist synced + manual second line
  const saved = await api(`/api/goods/orders/${order.id}`, dealerCookie, {
    method: 'PUT',
    body: JSON.stringify({
      items: [
        {
          id: order.items[0].id,
          unitPrice: syncBody.unitPrice,
          reserveQty: 5,
        },
        {
          id: order.items[1].id,
          unitPrice: 9.99,
          reserveQty: 2,
        },
      ],
    }),
  });
  if (saved.status < 200 || saved.status >= 300) {
    throw new Error(`save failed: ${JSON.stringify(saved.data)}`);
  }
  const savedOrder = saved.data as Order;
  if (savedOrder.priceStatus !== 1) {
    throw new Error(`expected priceStatus 1 got ${savedOrder.priceStatus}`);
  }
  console.log('priceStatus-ok', savedOrder.priceStatus);

  const submitted = await api(
    `/api/goods/orders/${order.id}/submit-fulfill`,
    dealerCookie,
    { method: 'POST' },
  );
  console.log(
    'submit-fulfill',
    submitted.status,
    (submitted.data as Order).status,
  );
  if (submitted.status < 200 || submitted.status >= 300) {
    throw new Error(`submit failed: ${JSON.stringify(submitted.data)}`);
  }
  if ((submitted.data as Order).status !== 'pending_fulfill') {
    throw new Error('expected pending_fulfill');
  }

  // sync should be rejected after submit
  const blocked = await api(
    `/api/goods/orders/${order.id}/items/${order.items[0].id}/sync-price`,
    dealerCookie,
    { method: 'POST' },
  );
  console.log('sync-after-submit', blocked.status);
  if (blocked.status === 200) {
    throw new Error('sync should be blocked after fulfill submit');
  }

  try {
    unlinkSync(xlsxPath);
  } catch {
    /* ignore */
  }
  console.log('PRICE_SYNC_E2E_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
