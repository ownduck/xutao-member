import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page, Request, Response } from '@playwright/test'
import { expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { waitForAppReady } from './nav'

export function buildGoodsXlsxPath(
  rows: Array<[string, number]>,
  filename = 'pw-goods.xlsx',
): string {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['url', '数量'], ...rows])
  XLSX.utils.book_append_sheet(wb, ws, '预约')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const filePath = join(tmpdir(), `${Date.now()}-${filename}`)
  writeFileSync(filePath, buf)
  return filePath
}

export async function createReserveOrder(
  page: Page,
  rows: Array<[string, number]>,
) {
  const filePath = buildGoodsXlsxPath(rows)
  await page.goto('/goods/create')
  await waitForAppReady(page)
  await page.setInputFiles('input[type="file"]', filePath)
  // 解析依赖后端 import 接口，开发环境下实测可达 10s+。
  await expect(page.getByText(/已解析/)).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '确认创建' }).click()
  try {
    await expect(page).toHaveURL(/\/goods\/reserve\/\d+/, { timeout: 90_000 })
  } catch (err) {
    const toast = page.locator('.ant-message').last()
    const msg = (await toast.textContent().catch(() => '')) || ''
    throw new Error(
      `createReserveOrder stuck on ${page.url()}; toast=${msg}; ${String(err)}`,
    )
  }
  const m = page.url().match(/\/goods\/reserve\/(\d+)/)
  return Number(m?.[1])
}

export async function openReserveDetail(page: Page, orderId: number) {
  const isOrderGet = (request: Request) =>
    request.method() === 'GET' &&
    new URL(request.url()).pathname === `/api/goods/orders/${orderId}`
  const pending = new Set<Request>()
  let seen = 0
  const onRequest = (request: Request) => {
    if (!isOrderGet(request)) return
    seen += 1
    pending.add(request)
  }
  const onDone = (request: Request) => {
    if (isOrderGet(request)) pending.delete(request)
  }
  const onResponse = (response: Response) => onDone(response.request())
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onDone)
  try {
    await page.goto(`/goods/reserve/${orderId}`)
    await waitForAppReady(page)
    await expect(page.getByText(/订单\s/)).toBeVisible({ timeout: 90_000 })
    await expect(
      page.locator('[data-testid^="unit-price-"]').first(),
    ).toBeVisible({ timeout: 60_000 })
    // Wait for initial load() to finish so it won't overwrite draft fills.
    await expect(page.getByRole('button', { name: /保\s*存/ })).toBeEnabled({
      timeout: 60_000,
    })
    // React StrictMode 下 load() 会请求两次；等全部在途请求结束，
    // 避免延后返回的响应覆盖紧接着写入的草稿。
    await expect
      .poll(() => seen, { timeout: 120_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => pending.size, { timeout: 120_000 })
      .toBe(0)
  } finally {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onDone)
  }
}

async function applyUnitPrices(page: Page, prices: number[]) {
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          typeof (window as unknown as { __pwFillUnitPrices?: unknown })
            .__pwFillUnitPrices === 'function',
      ),
    )
    .toBe(true)

  await page.evaluate((ps) => {
    ;(
      window as unknown as { __pwFillUnitPrices: (p: number[]) => void }
    ).__pwFillUnitPrices(ps)
  }, prices)

  await expect
    .poll(async () => {
      const v = await page
        .locator('[data-testid^="unit-price-"] input')
        .first()
        .inputValue()
      return Number(v)
    })
    .toBe(prices[0]!)
}

/**
 * Fill unit prices via page hook, then click 保存.
 */
export async function fillUnitPricesAndSave(page: Page, prices: number[]) {
  await applyUnitPrices(page, prices)
  // Re-apply immediately before save in case a late load() raced
  await applyUnitPrices(page, prices)
  const response = page.waitForResponse(
    (r) =>
      /^\/api\/goods\/orders\/\d+$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'PUT',
    { timeout: 120_000 },
  )
  await page.getByRole('button', { name: /保\s*存/ }).click()
  const result = await response
  expect(result.status()).toBe(200)
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 90_000 })
}

export async function submitFulfill(page: Page) {
  await page.getByRole('button', { name: '提交履约' }).click()
  const dialog = page.locator('.ant-modal-confirm').filter({ hasText: '提交履约' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: /确\s*定|OK/i }).click()
  // onOk 串行执行 保存(PUT+GET) -> 提交(POST+GET)，后端慢时整条链路可达 30s+。
  await expect(page.getByText('已提交履约')).toBeVisible({ timeout: 120_000 })
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  await expect(page.locator('.ant-tag', { hasText: '待履约' })).toBeVisible({
    timeout: 60_000,
  })
}

/** Cancel from reserve list row; confirms modal. */
export async function cancelReserveOrderFromList(page: Page, orderId: number) {
  await page.goto('/goods/reserve')
  await waitForAppReady(page)
  const row = page.locator('.ant-table-tbody tr').filter({
    has: page.locator(`a[href="/goods/reserve/${orderId}"]`),
  })
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.getByRole('button', { name: '取消' }).click()
  const dialog = page.locator('.ant-modal-confirm').filter({ hasText: '取消订单' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: /确认取消/ }).click()
  await expect(page.getByText('订单已取消')).toBeVisible({ timeout: 90_000 })
  await expect(row.locator('.ant-tag', { hasText: '已取消' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(row.getByRole('button', { name: '取消' })).toHaveCount(0)
}
