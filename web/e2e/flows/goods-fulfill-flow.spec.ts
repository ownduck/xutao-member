import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditRowByRemark, createRecharge } from '../helpers/finance'
import {
  createReserveOrder,
  fillUnitPricesAndSave,
  openReserveDetail,
  submitFulfill,
} from '../helpers/goods'
import { waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

test.describe.serial('E2–E6: fulfill complete + deduction UI', () => {
  let orderId = 0

  test('dealer creates priced pending fulfill', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'dealer.json'),
    })
    const page = await ctx.newPage()
    const stamp = Date.now().toString(36)
    orderId = await createReserveOrder(page, [
      [`https://www.amazon.com/dp/B0E6${stamp}A`, 2],
      [`https://www.amazon.com/dp/B0E6${stamp}B`, 3],
    ])
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 20])
    await submitFulfill(page)
    await ctx.close()
  })

  test('E2: ops partial fulfill', async ({ browser }) => {
    expect(orderId).toBeGreaterThan(0)
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const page = await ctx.newPage()
    await page.goto(`/goods/fulfill/${orderId}`)
    await waitForAppReady(page)
    await expect(page.locator('.ant-tag', { hasText: '待履约' })).toBeVisible({
      timeout: 60_000,
    })

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __pwSetFulfillQtys?: unknown })
              .__pwSetFulfillQtys === 'function',
        ),
      )
      .toBe(true)

    await page.evaluate(() => {
      ;(
        window as unknown as { __pwSetFulfillQtys: (q: number[]) => void }
      ).__pwSetFulfillQtys([2, 0])
    })

    await page.getByRole('button', { name: /保\s*存/ }).click()
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.ant-tag', { hasText: '部分履约' })).toBeVisible({
      timeout: 30_000,
    })
    await ctx.close()
  })

  test('E4: ops submit complete', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const page = await ctx.newPage()
    await page.goto(`/goods/fulfill/${orderId}`)
    await waitForAppReady(page)
    await page.getByRole('button', { name: '提交完成' }).click()
    const dialog = page.locator('.ant-modal-confirm').filter({
      hasText: /提交完成|部分履约/,
    })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog
      .getByRole('button', { name: /确认部分履约完成|确认提交|确\s*定|OK/i })
      .click()
    await expect(page).toHaveURL(/\/goods\/history\//, { timeout: 90_000 })
    await expect(page.getByText('已完成')).toBeVisible({ timeout: 30_000 })
    await ctx.close()
  })

  test('E5: history list shows order', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/goods/history')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table-tbody')).toBeVisible({
      timeout: 45_000,
    })
    await page.goto(`/goods/history/${orderId}`)
    await waitForAppReady(page)
    await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
    await ctx.close()
  })

  test('E6: admin approve deduction', async ({ browser }) => {
    // Fund dealer wallet first — approve fails with 余额不足 otherwise
    const fundRemark = `pw-e6-fund-${Date.now()}`
    const opsCtx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const opsPage = await opsCtx.newPage()
    await createRecharge(opsPage, 200, fundRemark)
    await opsCtx.close()

    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'admin.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/finance/recharge')
    await waitForAppReady(page)
    await auditRowByRemark(page, fundRemark, true)

    await page.goto('/finance/deduction')
    await waitForAppReady(page)
    await page.getByRole('button', { name: /查\s*询/ }).click()
    const row = page
      .locator('.ant-table-tbody tr')
      .filter({ hasText: '待审核' })
      .filter({ has: page.getByRole('button', { name: '审核' }) })
      .first()
    await expect(row).toBeVisible({ timeout: 45_000 })
    await row.getByRole('button', { name: '审核' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '审核扣费' })
    await expect(modal).toBeVisible({ timeout: 15_000 })
    await modal.locator('.ant-radio-wrapper').filter({ hasText: '通过' }).click()
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText('审核完成')).toBeVisible({ timeout: 45_000 })
    await ctx.close()
  })
})
