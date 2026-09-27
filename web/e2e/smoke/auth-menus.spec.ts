import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginViaApi, SEED } from '../helpers/login'
import {
  expectMenuVisible,
  expandAllMenus,
  openProfileMenu,
  waitForAppReady,
} from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

test.describe('A: login / session', () => {
  test('A1: wrong password stays on login', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('邮箱').fill(SEED.admin.email)
    await page.getByPlaceholder('密码').fill('wrong-password')
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(
      page.locator('.ant-alert-error, .ant-message-error').first(),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('A3: unauthenticated redirect', async ({ page }) => {
    await page.goto('/goods/create')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    expect(page.url()).toMatch(/redirect=/)
  })

  test('A4: login redirect back to goods/create', async ({ page }) => {
    await page.goto('/goods/create')
    await expect(page).toHaveURL(/\/login/)
    await page.getByPlaceholder('邮箱').fill(SEED.dealer.email)
    await page.getByPlaceholder('密码').fill(SEED.dealer.password)
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(/\/goods\/create/, { timeout: 45_000 })
  })

  test('A5: logout clears session', async ({ page }) => {
    await loginViaApi(page, SEED.dealer.email, SEED.dealer.password)
    await waitForAppReady(page)
    await openProfileMenu(page)
    await page.getByText('退出登录').click()
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('A2/B/C: roles menus + dashboard', () => {
  test.use({ storageState: path.join(authDir, 'dealer.json') })

  test('A2/B1/C1: dealer menu + dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expectMenuVisible(
      page,
      ['创建预约', '预约订单', '历史订单', '钱包', '账户变动'],
      true,
    )
    await expectMenuVisible(
      page,
      ['履约订单', '充值审核', '扣费审核', '汇率管理', '全局配置', '管理员', '角色'],
      false,
    )
  })
})

test.describe('B2: ops menus', () => {
  test.use({ storageState: path.join(authDir, 'ops.json') })

  test('ops sidebar', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expectMenuVisible(
      page,
      [
        '履约订单',
        '历史订单',
        '钱包',
        '账户变动',
        '充值审核',
        '扣费审核',
        '汇率管理',
        '全局配置',
      ],
      true,
    )
    await expectMenuVisible(page, ['创建预约', '预约订单', '管理员', '角色'], false)
  })
})

test.describe('B3: admin menus', () => {
  test.use({ storageState: path.join(authDir, 'admin.json') })

  test('admin sidebar + debug mode', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expandAllMenus(page)
    await expect(
      page.locator('.ant-layout-sider').getByText('订单管理', { exact: true }),
    ).toBeVisible()
    await expectMenuVisible(
      page,
      [
        '创建预约',
        '预约订单',
        '履约订单',
        '历史订单',
        '钱包',
        '充值审核',
        '扣费审核',
        '汇率管理',
        '全局配置',
        '管理员',
        '角色',
      ],
      true,
    )
    await openProfileMenu(page)
    await expect(page.getByText('调试模式')).toBeVisible()
  })
})
