import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectMenuVisible } from '../helpers/nav'

const authDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.auth')

test.describe('H: RBAC', () => {
  test.use({ storageState: path.join(authDir, 'admin.json') })

  test('H1: users list contains seed admin', async ({ page }) => {
    await page.goto('/rbac/users')
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('admin@local.dev')).toBeVisible()
  })

  test('H2: create user then delete', async ({ page }) => {
    await page.goto('/rbac/users')
    const stamp = Date.now().toString(36)
    const email = `pw_user_${stamp}@local.dev`
    await page.getByRole('button', { name: '新建用户' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新建用户' })
    await expect(modal).toBeVisible()
    await modal.getByLabel('邮箱').fill(email)
    await modal.getByLabel('用户名').fill(`pw_${stamp}`)
    await modal.getByLabel('初始密码').fill('Test@12345678')
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText(email)).toBeVisible({ timeout: 25_000 })

    const row = page.locator('.ant-table-tbody tr').filter({ hasText: email })
    await row.getByRole('button', { name: /删除/ }).click()
    await page.getByRole('button', { name: /确\s*定/ }).last().click()
    await expect(page.getByText(email)).toHaveCount(0, { timeout: 15_000 })
  })

  test('H3: create role and soft-delete', async ({ page }) => {
    await page.goto('/rbac/roles')
    const stamp = Date.now().toString(36)
    await page.getByRole('button', { name: '添加角色' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: /添加角色|修改角色/ })
    await expect(modal).toBeVisible()
    await modal.locator('input').first().fill(`PW角色${stamp}`)
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(page.getByText(`PW角色${stamp}`)).toBeVisible({ timeout: 15_000 })

    const row = page
      .locator('.ant-table-tbody tr, .ant-list-item')
      .filter({ hasText: `PW角色${stamp}` })
      .first()
    await row.getByRole('button', { name: /删除/ }).click()
    await page.getByRole('button', { name: /确\s*定/ }).last().click()
    await expect(page.getByText(`PW角色${stamp}`)).toHaveCount(0, {
      timeout: 15_000,
    })
  })
})

test.describe('H4: ops/dealer no RBAC menu', () => {
  for (const role of ['ops', 'dealer'] as const) {
    test(`${role} has no admin/role menu`, async ({ browser }) => {
      const ctx = await browser.newContext({
        storageState: path.join(authDir, `${role}.json`),
      })
      const page = await ctx.newPage()
      await page.goto('/dashboard')
      await expectMenuVisible(page, ['管理员', '角色'], false)
      await ctx.close()
    })
  }
})
