import { test, expect } from '@playwright/test'
import { loginViaApi, SEED } from '../helpers/login'
import { openProfileMenu, waitForAppReady } from '../helpers/nav'

test.describe('A6: reset password', () => {
  test('change password then login with new password', async ({ page }) => {
    const original = SEED.dealer.password
    const next = `Dealer@${Date.now().toString().slice(-6)}`

    await loginViaApi(page, SEED.dealer.email, original)
    await waitForAppReady(page)
    await openProfileMenu(page)
    await page.getByText('重置密码').click()
    const modal = page.locator('.ant-modal').filter({ hasText: '重置密码' })
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('请输入或生成新密码').fill(next)
    await modal.getByRole('button', { name: '确认重置' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })

    await loginViaApi(page, SEED.dealer.email, next)
    await waitForAppReady(page)
    await expect(page).toHaveURL(/\/dashboard/)

    await openProfileMenu(page)
    await page.getByText('重置密码').click()
    const modal2 = page.locator('.ant-modal').filter({ hasText: '重置密码' })
    await expect(modal2).toBeVisible()
    await modal2.getByPlaceholder('请输入或生成新密码').fill(original)
    await modal2.getByRole('button', { name: '确认重置' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
  })
})
