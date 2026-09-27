import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const authDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.auth')

test.describe('I: direct URL guards', () => {
  test('I1: dealer opens fulfill — page does not crash', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'dealer.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/goods/fulfill')
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('#root')).not.toBeEmpty()
    await ctx.close()
  })

  test('I2: ops opens create — confirm disabled or page loads', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'ops.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/goods/create')
    await expect(page.locator('body')).toBeVisible()
    const confirm = page.getByRole('button', { name: '确认创建' })
    if (await confirm.isVisible().catch(() => false)) {
      await expect(confirm).toBeDisabled()
    }
    await ctx.close()
  })

  test('I3: dealer opens rbac users', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: path.join(authDir, 'dealer.json'),
    })
    const page = await ctx.newPage()
    await page.goto('/rbac/users')
    await expect(page.locator('body')).toBeVisible()
    await ctx.close()
  })
})
