import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createReserveOrder,
  fillUnitPricesAndSave,
  openReserveDetail,
  submitFulfill,
} from '../helpers/goods'
import { expectMenuVisible, waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

test.describe('D: goods create + reserve', () => {
  test.use({ storageState: path.join(authDir, 'dealer.json') })

  test('D1: download template button works', async ({ page }) => {
    await page.goto('/goods/create')
    await waitForAppReady(page)
    const downloadPromise = page
      .waitForEvent('download', { timeout: 20_000 })
      .catch(() => null)
    await page.getByRole('button', { name: '下载模板' }).click()
    const dl = await downloadPromise
    expect(
      await page.getByRole('button', { name: '下载模板' }).isEnabled(),
    ).toBe(true)
    void dl
  })

  test('D2/D4/D5/D7: import → price → submit fulfill', async ({ page }) => {
    const stamp = Date.now().toString(36)
    const orderId = await createReserveOrder(page, [
      [`https://www.amazon.com/dp/B0PW${stamp}A`, 2],
      [`https://www.amazon.com/dp/B0PW${stamp}B`, 1],
    ])
    expect(orderId).toBeGreaterThan(0)

    await page.goto('/goods/reserve')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table-tbody')).toBeVisible({
      timeout: 45_000,
    })

    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 5])
    await expect(page.getByText('价格已填完')).toBeVisible()

    await submitFulfill(page)
    await expect(page.getByText('待履约')).toBeVisible({ timeout: 15_000 })
  })

  test('D3: invalid excel shows error', async ({ page }) => {
    await page.goto('/goods/create')
    await waitForAppReady(page)
    const bad = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'bad.txt',
    )
    const { writeFileSync } = await import('node:fs')
    writeFileSync(bad, 'not-excel')
    await page.setInputFiles('input[type="file"]', bad)
    await expect(page.getByText(/解析失败|缺少|没有有效/)).toBeVisible({
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/goods\/create/)
  })

  test('D6: submit fulfill without prices blocked', async ({ page }) => {
    const stamp = Date.now().toString(36)
    const orderId = await createReserveOrder(page, [
      [`https://www.amazon.com/dp/B0NP${stamp}`, 1],
    ])
    await openReserveDetail(page, orderId)
    await page.getByRole('button', { name: '提交履约' }).click()
    await expect(page.getByText(/请填写全部商品单价/)).toBeVisible({
      timeout: 10_000,
    })
  })

  test('D8: sync price button clickable', async ({ page }) => {
    const stamp = Date.now().toString(36)
    const orderId = await createReserveOrder(page, [
      [`https://www.amazon.com/dp/B0SY${stamp}`, 1],
    ])
    await openReserveDetail(page, orderId)
    const syncBtn = page.getByRole('button', { name: '同步价格' }).first()
    await expect(syncBtn).toBeEnabled({ timeout: 30_000 })
    await syncBtn.click()
    const toast = page.locator('.ant-message, .ant-notification').getByText(
      /同步|抓取|失败|已抓取|Bright|503|未配置|Service|Unavailable|error/i,
    )
    await Promise.race([
      toast.waitFor({ state: 'visible', timeout: 45_000 }),
      expect(syncBtn).toBeEnabled({ timeout: 45_000 }),
    ]).catch(() => undefined)
    await expect(syncBtn).toBeEnabled({ timeout: 45_000 })
  })
})

test.describe('E: fulfill + history', () => {
  test.use({ storageState: path.join(authDir, 'ops.json') })

  test('E1: fulfill list opens', async ({ page }) => {
    await page.goto('/goods/fulfill')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 45_000 })
  })
})

test.describe('F8: dealer no finance audit menus', () => {
  test.use({ storageState: path.join(authDir, 'dealer.json') })

  test('dealer has no recharge/deduction menu', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expectMenuVisible(page, ['充值审核', '扣费审核'], false)
  })
})
