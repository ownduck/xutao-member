import * as XLSX from 'xlsx';
import { ensureE2eApp } from './app.js';
import { api, type ApiResult } from './auth.js';

export type GoodsOrder = {
  id: number;
  status: string;
  priceStatus: number;
  currencyCode?: string;
  items: Array<{
    id: number;
    amazonUrl?: string;
    reserveQty?: number;
    unitPrice?: string | null;
    fulfillQty?: number | null;
  }>;
};

export function buildGoodsXlsx(
  rows: Array<[string, number | string]>,
): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['url', '数量'], ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, '预约');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function importGoodsOrder(
  cookie: string,
  rows: Array<[string, number | string]>,
  dealerRemark = 'vitest-flow',
): Promise<{ status: number; order: GoodsOrder | null; text: string }> {
  const buf = buildGoodsXlsx(rows);
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buf)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'e2e-goods.xlsx',
  );
  form.append('dealerRemark', dealerRemark);

  const { baseUrl, origin } = await ensureE2eApp();
  const res = await fetch(`${baseUrl}/api/goods/orders/import`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  const text = await res.text();
  let order: GoodsOrder | null = null;
  try {
    order = text ? (JSON.parse(text) as GoodsOrder) : null;
  } catch {
    /* keep */
  }
  return { status: res.status, order, text };
}

export async function importGoodsOrderRaw(
  cookie: string,
  file: Blob | null,
  dealerRemark = 'vitest-flow',
): Promise<ApiResult> {
  const form = new FormData();
  if (file) {
    form.append('file', file, 'e2e-goods.xlsx');
  }
  form.append('dealerRemark', dealerRemark);
  const { baseUrl, origin } = await ensureE2eApp();
  const res = await fetch(`${baseUrl}/api/goods/orders/import`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep */
  }
  return { status: res.status, data, text };
}

export async function priceOrder(
  cookie: string,
  order: GoodsOrder,
  prices: number[],
): Promise<ApiResult> {
  return api(`/api/goods/orders/${order.id}`, cookie, {
    method: 'PUT',
    body: JSON.stringify({
      items: order.items.map((it, idx) => ({
        id: it.id,
        unitPrice: prices[idx] ?? prices[0] ?? 10,
      })),
    }),
  });
}
