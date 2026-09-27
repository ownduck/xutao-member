import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditRowByRemark,
  createDeduction,
  createRecharge,
} from '../helpers/finance'
import { waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

test.describe('F: finance wallet / trade / recharge', () => {
  test('F1/F2: wallet + trade-log (dealer)', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'dealer.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/finance/wallet')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 45_000 })
    await page.goto('/finance/trade-log')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 45_000 })
    await ctx.close()
  })

  test('F3/F4: ops create recharge; self-audit disabled', async ({
    browser,
  }) => {
    const remark = `pw-self-${Date.now()}`
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const page = await ctx.newPage()
    await createRecharge(page, 1.11, remark)
    const row = page
      .locator('.ant-table-tbody tr')
      .filter({ hasText: remark })
      .first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByRole('button', { name: '审核' })).toBeDisabled()
    await ctx.close()
  })

  test('F5: admin approve recharge', async ({ browser }) => {
    const remark = `pw-approve-${Date.now()}`
    const opsCtx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const opsPage = await opsCtx.newPage()
    await createRecharge(opsPage, 1.23, remark)
    await opsCtx.close()

    const adminCtx = await browser.newContext({
      storageState: path.join(authDir, 'admin.json'),
    })
    const page = await adminCtx.newPage()
    await page.goto('/finance/recharge')
    await waitForAppReady(page)
    await auditRowByRemark(page, remark, true)
    await adminCtx.close()
  })

  test('F6: admin reject recharge', async ({ browser }) => {
    const remark = `pw-reject-${Date.now()}`
    const opsCtx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const opsPage = await opsCtx.newPage()
    await createRecharge(opsPage, 0.55, remark)
    await opsCtx.close()

    const adminCtx = await browser.newContext({
      storageState: path.join(authDir, 'admin.json'),
    })
    const page = await adminCtx.newPage()
    await page.goto('/finance/recharge')
    await waitForAppReady(page)
    await auditRowByRemark(page, remark, false)
    await adminCtx.close()
  })

  test('F7: deduction create + approve', async ({ browser }) => {
    const remark = `pw-deduct-${Date.now()}`
    const opsCtx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const opsPage = await opsCtx.newPage()
    await createDeduction(opsPage, 0.31, remark)
    await opsCtx.close()

    const adminCtx = await browser.newContext({
      storageState: path.join(authDir, 'admin.json'),
    })
    const page = await adminCtx.newPage()
    await page.goto('/finance/deduction')
    await waitForAppReady(page)
    await auditRowByRemark(page, remark, true)
    await adminCtx.close()
  })
})
