// spec: specs/01-dashboard.plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

const adminState = path.join(authDir, 'admin.json')
const opsState = path.join(authDir, 'ops.json')
const dealerState = path.join(authDir, 'dealer.json')

type MockMeUser = {
  realname: string | null
  name: string
  email: string
}

function meResponse(user: MockMeUser) {
  return {
    user: {
      id: 'mock-dashboard-user',
      image: null,
      isSuperAdmin: true,
      ...user,
    },
    permissions: [],
    isSuperAdmin: true,
    roles: [],
    roleKeys: ['super_admin'],
    isDealer: false,
    isOps: true,
  }
}

test.describe('1. 概览页内容', () => {
  test('1.1 超级管理员概览文案与结构', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: adminState })
    const page = await ctx.newPage()

    // 1. 以 admin 登录后访问 /dashboard
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(
      page
        .locator('.ant-layout-header')
        .getByRole('heading', { level: 4, name: '概览' }),
    ).toBeVisible()
    const selectedMenu = page.locator(
      '.ant-layout-sider .ant-menu-item-selected',
    )
    await expect(selectedMenu).toHaveCount(1)
    await expect(selectedMenu).toContainText('概览')

    // 2. 查看主内容区域
    const content = page.locator('.ant-layout-content')
    await expect(content.locator('.ant-card')).toHaveCount(1)
    await expect(content.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，超级管理员',
    )
    await expect(content.locator('.ant-typography-secondary')).toHaveText(
      '你是超级管理员，可管理全部后台权限。',
    )

    // 3. 检查是否包含统计、图表或快捷入口
    await expect(content.locator('.ant-statistic')).toHaveCount(0)
    await expect(content.locator('canvas')).toHaveCount(0)
    await expect(content.locator('svg')).toHaveCount(0)
    await expect(content.locator('.ant-card-extra')).toHaveCount(0)
    await expect(content.locator('button')).toHaveCount(0)

    await ctx.close()
  })

  test('1.2 运营账号概览文案', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: opsState })
    const page = await ctx.newPage()

    // 1. 使用 ops 登录态访问 /dashboard
    await page.goto('/dashboard')
    await waitForAppReady(page)
    const content = page.locator('.ant-layout-content')
    await expect(content.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，运营专员',
    )
    await expect(
      page.locator('.ant-layout-header .ant-dropdown-trigger .ant-typography'),
    ).toHaveText('运营专员')
    await expect(content.locator('.ant-typography-secondary')).toHaveText(
      '请从左侧菜单进入已授权的功能模块。',
    )
    await expect(content.locator('.ant-card')).not.toContainText('超级管理员')

    await ctx.close()
  })

  test('1.3 经销商账号概览文案', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: dealerState })
    const page = await ctx.newPage()

    // 1. 使用 dealer 登录态访问 /dashboard
    await page.goto('/dashboard')
    await waitForAppReady(page)
    const content = page.locator('.ant-layout-content')
    await expect(content.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，示例经销商',
    )
    await expect(
      page.locator('.ant-layout-header .ant-dropdown-trigger .ant-typography'),
    ).toHaveText('示例经销商')
    await expect(content.locator('.ant-typography-secondary')).toHaveText(
      '请从左侧菜单进入已授权的功能模块。',
    )
    await expect(content.locator('.ant-card')).not.toContainText('超级管理员')

    await ctx.close()
  })

  test('1.4 根路径与未知路径均落到概览', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: adminState })
    const page = await ctx.newPage()

    // 1. 以 admin 登录访问 /
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
    await waitForAppReady(page)
    await expect(page.locator('.ant-layout-content .ant-card')).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，超级管理员',
    )

    // 2. 访问 /dashboard/unknown
    await page.goto('/dashboard/unknown')
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
    await waitForAppReady(page)
    await expect(page.locator('.ant-layout-content .ant-card')).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，超级管理员',
    )

    await ctx.close()
  })
})

test.describe('2. 加载态与异常态', () => {
  test('2.1 冷启动等待权限加载时显示全屏 Spin 且不闪回登录页', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: adminState })
    const page = await ctx.newPage()

    await page.route('**/api/me', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      // 延迟权限接口返回，构造冷启动加载态。
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })

    // 1. 首次访问 /dashboard，/api/me 被延迟 2 秒
    await page.goto('/dashboard', { waitUntil: 'commit' })
    const spin = page.locator('.ant-spin-spinning')
    await expect(spin).toBeVisible({ timeout: 15_000 })
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('.login-card')).toHaveCount(0)

    // 2. 等待 /api/me 返回
    await expect(spin).toHaveCount(0, { timeout: 30_000 })
    await waitForAppReady(page)
    await expect(page.locator('.ant-layout-content .ant-card')).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(
      '欢迎，超级管理员',
    )

    await ctx.close()
  })

  test('2.2 会话失效后访问概览被守卫拦截', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: adminState })
    const page = await ctx.newPage()

    // 1. 清除认证 cookie 后访问 /dashboard
    await ctx.clearCookies()
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/, {
      timeout: 20_000,
    })
    await expect(page.locator('.login-card')).toBeVisible()
    await expect(page.locator('.ant-layout-content .ant-card')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)

    await ctx.close()
  })

  test('2.3 欢迎名称回退顺序', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: adminState })
    const page = await ctx.newPage()

    // 通过 mock /api/me 构造 realname/name/email 为空的账号。
    let mockUser: MockMeUser = {
      realname: '',
      name: '回退名称',
      email: 'fallback@local.dev',
    }
    await page.route('**/api/me', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(meResponse(mockUser)),
      })
    })

    const heading = page.getByRole('heading', { level: 3 })
    const profile = page.locator(
      '.ant-layout-header .ant-dropdown-trigger .ant-typography',
    )

    // 1. realname 为空时使用 name
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expect(heading).toHaveText('欢迎，回退名称')
    await expect(profile).toHaveText('回退名称')

    // 2. name 也为空时回退到邮箱
    mockUser = { realname: null, name: '', email: 'fallback@local.dev' }
    await page.reload()
    await waitForAppReady(page)
    await expect(heading).toHaveText('欢迎，fallback@local.dev')
    await expect(profile).toHaveText('fallback@local.dev')

    // 3. 所有字段均为空时显示「管理员」
    mockUser = { realname: '', name: '', email: '' }
    await page.reload()
    await waitForAppReady(page)
    await expect(heading).toHaveText('欢迎，管理员')
    await expect(profile).toHaveText('管理员')

    await ctx.close()
  })
})
