import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
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
  await expect(page.getByText(/已解析/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '确认创建' }).click()
  try {
    await expect(page).toHaveURL(/\/goods\/reserve\/\d+/, { timeout: 60_000 })
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
  await page.goto(`/goods/reserve/${orderId}`)
  await waitForAppReady(page)
  await expect(page.getByText(/订单\s/)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-testid^="unit-price-"]').first()).toBeVisible(
    { timeout: 30_000 },
  )
  // Wait for initial load() to finish so it won't overwrite draft fills
  await expect(page.getByRole('button', { name: /保\s*存/ })).toBeEnabled({
    timeout: 30_000,
  })
  await page.waitForLoadState('networkidle').catch(() => undefined)
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
  await page.getByRole('button', { name: /保\s*存/ }).click()
  await expect(page.getByText('已保存')).toBeVisible({ timeout: 30_000 })
}

export async function submitFulfill(page: Page) {
  await page.getByRole('button', { name: '提交履约' }).click()
  const dialog = page.locator('.ant-modal-confirm').filter({ hasText: '提交履约' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: /确\s*定|OK/i }).click()
  // onOk runs save + submit + reload — allow slow API
  await expect(page.getByText('已提交履约')).toBeVisible({ timeout: 60_000 })
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('.ant-tag', { hasText: '待履约' })).toBeVisible({
    timeout: 30_000,
  })
}
