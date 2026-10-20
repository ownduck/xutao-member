// spec: specs/00-overview-and-navigation.plan.md
// seed: e2e/seed.spec.ts

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED, loginViaApi } from '../helpers/login'
import {
  expandAllMenus,
  expectMenuVisible,
  menuLink,
  openProfileMenu,
  waitForAppReady,
} from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

const adminState = path.join(authDir, 'admin.json')
const opsState = path.join(authDir, 'ops.json')
const dealerState = path.join(authDir, 'dealer.json')

const BASE_URL = 'http://localhost:5288'

/** browser.newContext() does not inherit config `use`, so pass baseURL. */
function contextFor(browser: Browser, storageState?: string) {
  return browser.newContext({ baseURL: BASE_URL, storageState })
}

function submenu(page: Page, title: string) {
  return page
    .locator('.ant-layout-sider .ant-menu-submenu')
    .filter({
      has: page.locator('.ant-menu-submenu-title', { hasText: title }),
    })
    .first()
}

/** Concurrency can produce duplicate toasts; assert on the first one. */
function message(page: Page, text: string | RegExp) {
  return page
    .locator('.ant-message-notice-title')
    .filter({ hasText: text })
    .first()
}

test.describe('1. 登录与会话', () => {
  test('1.1 未登录访问受保护路由重定向到登录页并携带 redirect', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()

    // 1. 在无登录态上下文打开 /goods/create
    await page.goto('/goods/create')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fgoods%2Fcreate$/, {
      timeout: 20_000,
    })
    await expect(page.locator('.login-card')).toBeVisible()
    await expect(page.locator('.card-title')).toHaveText('登录')
    await expect(page.locator('.card-subtitle')).toHaveText(
      '请使用管理员分配的账号登录',
    )
    await expect(page.getByPlaceholder('邮箱')).toBeVisible()
    await expect(page.getByPlaceholder('密码')).toBeVisible()
    await expect(page.getByRole('button', { name: /登\s*录/ })).toBeVisible()

    // 2. 读取地址栏 redirect 查询参数
    const redirect = new URL(page.url()).searchParams.get('redirect')
    expect(redirect).toBe('/goods/create')

    await ctx.close()
  })

  test('1.2 登录表单必填与邮箱格式校验', async ({ browser }) => {
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()

    // 1. 打开 /login，不填写内容直接点击「登录」
    await page.goto('/login')
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(
      page.locator('.ant-form-item-explain-error').filter({
        hasText: '请输入邮箱',
      }),
    ).toBeVisible()
    await expect(
      page.locator('.ant-form-item-explain-error').filter({
        hasText: '请输入密码',
      }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('.ant-layout-sider')).toHaveCount(0)

    // 2. 邮箱输入 not-an-email、密码输入 x，点击「登录」
    await page.getByPlaceholder('邮箱').fill('not-an-email')
    await page.getByPlaceholder('密码').fill('x')
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(
      page.locator('.ant-form-item-explain-error').filter({
        hasText: '邮箱格式不正确',
      }),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('.ant-layout-sider')).toHaveCount(0)

    await ctx.close()
  })

  test('1.3 错误密码登录失败', async ({ browser }) => {
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()

    // 1. 打开 /login，输入 admin@local.dev / wrong-password，点击「登录」
    await page.goto('/login')
    await page.getByPlaceholder('邮箱').fill(SEED.admin.email)
    await page.getByPlaceholder('密码').fill('wrong-password')
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(page.locator('.ant-alert-error')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('.ant-layout-sider')).toHaveCount(0)

    await ctx.close()
  })

  test('1.4 正确账号登录后进入概览并提示登录成功', async ({ browser }) => {
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()

    // 1. 打开 /login，输入 admin@local.dev / Admin@123456，点击「登录」
    await page.goto('/login')
    await page.getByPlaceholder('邮箱').fill(SEED.admin.email)
    await page.getByPlaceholder('密码').fill(SEED.admin.password)
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 })
    await expect(message(page, '登录成功')).toBeVisible({ timeout: 10_000 })
    await waitForAppReady(page)
    await expect(page.locator('.ant-layout-sider')).toBeVisible()
    await expect(page.locator('header h4')).toHaveText('概览')

    await ctx.close()
  })

  test('1.5 登录后回到 redirect 指定页面，已登录访问登录页自动跳转', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()

    // 1. 无登录态打开 /goods/create，等待跳到登录页
    await page.goto('/goods/create')
    await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(
      '/goods/create',
    )

    // 2. 使用 dealer@local.dev / Dealer@123456 登录
    await page.getByPlaceholder('邮箱').fill(SEED.dealer.email)
    await page.getByPlaceholder('密码').fill(SEED.dealer.password)
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(/\/goods\/create$/, { timeout: 45_000 })
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('创建预约')

    // 3. 退出后以 admin 登录，再直接访问 /login
    await openProfileMenu(page)
    await page.locator('.ant-dropdown').getByText('退出登录').click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
    await page.getByPlaceholder('邮箱').fill(SEED.admin.email)
    await page.getByPlaceholder('密码').fill(SEED.admin.password)
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 })
    await waitForAppReady(page)

    await page.goto('/login')
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 })
    await expect(page.locator('.login-card')).toHaveCount(0)

    await ctx.close()
  })

  test('1.6 退出登录清除会话并触发守卫', async ({ browser }) => {
    // 使用全新登录会话，避免注销 setup 生成的共享 storageState。
    const ctx = await contextFor(browser)
    const page = await ctx.newPage()
    await loginViaApi(page, SEED.dealer.email, SEED.dealer.password)
    await waitForAppReady(page)

    // 1. 以 dealer 登录进入 /dashboard，点击 Header 用户下拉后点击「退出登录」
    await openProfileMenu(page)
    await page.locator('.ant-dropdown').getByText('退出登录').click()
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/, {
      timeout: 20_000,
    })
    await expect(page.locator('.ant-layout-sider')).toHaveCount(0)
    await expect(page.locator('.ant-layout-header')).toHaveCount(0)

    // 2. 退出后直接访问 /dashboard
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/, {
      timeout: 20_000,
    })
    await expect(page.locator('.login-card')).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)

    await ctx.close()
  })

  test('1.7 未知路由重定向到概览', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 登录后访问 /not-exist/route
    await page.goto('/not-exist/route')
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('概览')

    await ctx.close()
  })
})

test.describe('2. 应用外壳与通用导航', () => {
  test('2.1 侧边栏品牌、菜单结构与 Header 标题', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 登录进入 /dashboard
    await page.goto('/dashboard')
    await waitForAppReady(page)
    const sider = page.locator('.ant-layout-sider')
    await expect(
      sider.getByRole('heading', { name: '会员管理后台' }),
    ).toBeVisible()
    await expect(sider.getByText('Admin Console')).toBeVisible()
    for (const label of ['概览', '订单管理', '财务', '站点管理', '后台权限']) {
      await expect(
        sider.getByText(label, { exact: true }).first(),
      ).toBeVisible()
    }
    await expect(page.locator('header h4')).toHaveText('概览')
    await expect(
      page.locator('.ant-layout-sider .ant-menu-item-selected'),
    ).toContainText('概览')

    // 2. 依次展开「订单管理」「财务」「站点管理」「后台权限」
    await expandAllMenus(page)
    const groups: Array<[string, string[]]> = [
      ['订单管理', ['创建预约', '预约订单', '履约订单', '历史订单']],
      ['财务', ['钱包', '账户变动', '充值审核', '扣费审核']],
      ['站点管理', ['汇率管理', '全局配置']],
      ['后台权限', ['管理员', '角色']],
    ]
    for (const [parent, children] of groups) {
      await expect(submenu(page, parent)).toHaveClass(
        /ant-menu-submenu-open/,
      )
      for (const child of children) {
        await expect(menuLink(page, child)).toBeVisible()
      }
    }

    // 3. 点击「站点管理 > 汇率管理」
    await menuLink(page, '汇率管理').click()
    await expect(page).toHaveURL(/\/site\/exchange-rates$/)
    await expect(page.locator('header h4')).toHaveText('汇率管理')
    await expect(
      page.locator('.ant-layout-sider .ant-menu-item-selected'),
    ).toContainText('汇率管理')

    await ctx.close()
  })

  test('2.2 深链接进入时父菜单自动展开且标题正确', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 直接访问 /goods/fulfill
    await page.goto('/goods/fulfill')
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('履约订单')
    await expect(submenu(page, '订单管理')).toHaveClass(
      /ant-menu-submenu-open/,
    )
    await expect(
      page.locator('.ant-layout-sider .ant-menu-item-selected'),
    ).toContainText('履约订单')

    // 2. 直接访问 /finance/recharge
    await page.goto('/finance/recharge')
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('充值审核')
    await expect(submenu(page, '财务')).toHaveClass(/ant-menu-submenu-open/)

    await ctx.close()
  })

  test('2.3 admin 可见全部菜单项', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 登录并展开全部子菜单
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expectMenuVisible(
      page,
      [
        '创建预约',
        '预约订单',
        '履约订单',
        '历史订单',
        '钱包',
        '账户变动',
        '充值审核',
        '扣费审核',
        '汇率管理',
        '全局配置',
        '管理员',
        '角色',
      ],
      true,
    )

    await ctx.close()
  })

  test('2.4 ops 仅可见运营相关菜单', async ({ browser }) => {
    const ctx = await contextFor(browser, opsState)
    const page = await ctx.newPage()

    // 1. 以 ops@local.dev / Ops@123456 登录，展开全部菜单
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
    await expectMenuVisible(
      page,
      ['创建预约', '预约订单', '管理员', '角色'],
      false,
    )

    // 「后台权限」显示为无子项的顶层菜单项（已知缺陷）
    const rbacItem = page
      .locator('.ant-layout-sider .ant-menu-item')
      .filter({ hasText: '后台权限' })
    await expect(rbacItem).toBeVisible()
    await expect(rbacItem).toHaveCount(1)
    await expect(
      page.locator('.ant-layout-sider .ant-menu-submenu').filter({
        has: page.locator('.ant-menu-submenu-title', {
          hasText: '后台权限',
        }),
      }),
    ).toHaveCount(0)
    await rbacItem.click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await ctx.close()
  })

  test('2.5 dealer 仅可见经销商相关菜单', async ({ browser }) => {
    const ctx = await contextFor(browser, dealerState)
    const page = await ctx.newPage()

    // 1. 以 dealer@local.dev / Dealer@123456 登录，展开全部菜单
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expectMenuVisible(
      page,
      ['创建预约', '预约订单', '历史订单', '钱包', '账户变动'],
      true,
    )
    await expectMenuVisible(
      page,
      [
        '履约订单',
        '充值审核',
        '扣费审核',
        '汇率管理',
        '全局配置',
        '管理员',
        '角色',
      ],
      false,
    )

    // 2. 检查「后台权限」菜单
    const rbacItem = page
      .locator('.ant-layout-sider .ant-menu-item')
      .filter({ hasText: '后台权限' })
    await expect(rbacItem).toBeVisible()
    await expect(rbacItem).toHaveCount(1)
    await expect(
      page.locator('.ant-layout-sider .ant-menu-submenu').filter({
        has: page.locator('.ant-menu-submenu-title', {
          hasText: '后台权限',
        }),
      }),
    ).toHaveCount(0)
    await rbacItem.click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await ctx.close()
  })

  test('2.6 浏览器刷新后登录态与当前页面保持', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 登录进入 /site/config 后刷新
    await page.goto('/site/config')
    await waitForAppReady(page)
    const selects = page.locator('main .ant-select')
    await expect(selects.nth(0)).toContainText('US — 美国', {
      timeout: 20_000,
    })
    await expect(selects.nth(1)).toContainText('USD — 美元')

    await page.reload()
    await waitForAppReady(page)
    await expect(page).toHaveURL(/\/site\/config$/)
    await expect(page.locator('.ant-layout-sider')).toBeVisible()
    await expect(page.locator('header h4')).toHaveText('全局配置')
    await expect(selects.nth(0)).toContainText('US — 美国', {
      timeout: 20_000,
    })
    await expect(selects.nth(1)).toContainText('USD — 美元')

    await ctx.close()
  })
})

test.describe('3. 权限守卫与直接 URL 访问', () => {
  test('3.1 dealer 直接访问履约订单列表：403 提示 + 空表', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, dealerState)
    const page = await ctx.newPage()

    // 1. 以 dealer 登录态访问 /goods/fulfill
    await page.goto('/goods/fulfill')
    await expect(message(page, 'Insufficient permission')).toBeVisible({
      timeout: 60_000,
    })
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('履约订单')
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '履约订单',
    )
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.locator('main').getByText('选择经销商')).toHaveCount(0)

    await ctx.close()
  })

  test('3.2 无权限用户直接访问管理员列表：403 提示 + 空表', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, opsState)
    const page = await ctx.newPage()

    // 1. 以 dealer 或 ops 登录态访问 /rbac/users
    await page.goto('/rbac/users')
    await expect(message(page, 'Insufficient permission')).toBeVisible({
      timeout: 60_000,
    })
    await waitForAppReady(page)
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '管理员',
    )
    const head = page.locator('main .ant-table-thead')
    await expect(head).toContainText('邮箱')
    await expect(head).toContainText('用户名')
    await expect(head).toContainText('操作')
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.getByRole('button', { name: '新建用户' })).toHaveCount(0)
    await expect(page.locator('main .ant-table-tbody button')).toHaveCount(0)

    await ctx.close()
  })

  test('3.3 ops 直接访问创建预约页：页面可见但无法创建/下载模板', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, opsState)
    const page = await ctx.newPage()

    // 1. 以 ops 登录态访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)
    await expect(page.locator('header h4')).toHaveText('创建预约')
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '创建预约',
    )
    await expect(page.locator('main .ant-alert')).toContainText(
      '上传 Amazon 商品下单 Excel',
    )
    await expect(
      page.getByRole('button', { name: /下载模板/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /选择\s*Excel/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '确认创建' }),
    ).toBeDisabled()

    // 2. 点击「下载模板」
    // 实测模板接口返回 403 后展示「下载模板失败」（非 Insufficient permission）。
    await page.getByRole('button', { name: /下载模板/ }).click()
    await expect(message(page, '下载模板失败')).toBeVisible({
      timeout: 90_000,
    })
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '创建预约',
    )

    await ctx.close()
  })

  test('3.4 dealer 直接访问充值审核页面：403 提示且无写入口', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, dealerState)
    const page = await ctx.newPage()

    // 1. 以 dealer 登录态访问 /finance/recharge
    await page.goto('/finance/recharge')
    await expect(message(page, 'Insufficient permission')).toBeVisible({
      timeout: 60_000,
    })
    await waitForAppReady(page)
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '充值审核',
    )
    await expect(page.getByRole('button', { name: '新增充值' })).toHaveCount(0)
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.getByRole('button', { name: /审\s*核/ })).toHaveCount(0)

    await ctx.close()
  })

  test('3.5 不存在/非法订单 id 显示空态而非白屏', async ({ browser }) => {
    const ctx = await contextFor(browser, dealerState)
    const page = await ctx.newPage()

    // 1. 以 dealer 访问不属于自己的订单 /goods/reserve/999999991
    // 实测接口返回 404，卡片与提示均为「订单不存在」。
    await page.goto('/goods/reserve/999999991')
    await expect(message(page, '订单不存在')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('main .ant-card-body')).toHaveText(
      '订单不存在',
    )

    // 2. 访问 /goods/reserve/not-a-number
    await page.goto('/goods/reserve/not-a-number')
    await expect(page.locator('main .ant-card-body')).toHaveText(
      '订单不存在',
    )
    await expect(page.locator('#root')).not.toBeEmpty()

    await ctx.close()
  })
})

test.describe('4. 用户下拉、调试模式与重置密码', () => {
  test('4.1 超级管理员用户下拉包含调试模式，开关可持久化', async ({
    browser,
  }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 清理可能存在的调试模式本地状态，避免影响断言。
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await page.evaluate(() =>
      localStorage.removeItem('member-admin-debug-mode'),
    )
    await page.reload()
    await waitForAppReady(page)

    // 1. 以 admin 登录后点击 Header 用户下拉
    await openProfileMenu(page)
    const dropdown = page.locator('.ant-dropdown')
    await expect(dropdown.getByText('调试模式')).toBeVisible()
    await expect(dropdown.getByRole('switch')).toBeVisible()
    await expect(dropdown.getByText('重置密码')).toBeVisible()
    await expect(dropdown.getByText('退出登录')).toBeVisible()
    await expect(dropdown.getByText('个人资料')).toHaveCount(0)

    // 2. 打开调试模式开关
    await dropdown.getByRole('switch').click()
    await expect(message(page, '调试模式已开启')).toBeVisible({
      timeout: 10_000,
    })
    expect(
      await page.evaluate(() =>
        localStorage.getItem('member-admin-debug-mode'),
      ),
    ).toBe('1')

    await page.reload()
    await waitForAppReady(page)
    await openProfileMenu(page)
    await expect(page.locator('.ant-dropdown .ant-switch')).toHaveClass(
      /ant-switch-checked/,
    )

    // 3. 再次点击开关关闭
    await page.locator('.ant-dropdown .ant-switch').click()
    await expect(message(page, '调试模式已关闭')).toBeVisible({
      timeout: 10_000,
    })
    expect(
      await page.evaluate(() =>
        localStorage.getItem('member-admin-debug-mode'),
      ),
    ).toBe('0')
    await expect(page.locator('.ant-dropdown .ant-switch')).toHaveAttribute(
      'aria-checked',
      'false',
    )

    await ctx.close()
  })

  test('4.2 非超级管理员看不到调试模式', async ({ browser }) => {
    // 1. 以 ops 登录进入 /dashboard，点击用户下拉
    const opsCtx = await contextFor(browser, opsState)
    const opsPage = await opsCtx.newPage()
    await opsPage.goto('/dashboard')
    await waitForAppReady(opsPage)
    await openProfileMenu(opsPage)
    const opsDropdown = opsPage.locator('.ant-dropdown')
    await expect(opsDropdown).toBeVisible()
    await expect(opsDropdown.getByText('调试模式')).toHaveCount(0)
    await expect(opsDropdown.getByText('重置密码')).toBeVisible()
    await expect(opsDropdown.getByText('退出登录')).toBeVisible()
    await opsCtx.close()

    // 2. 以 dealer 登录重复检查
    const dealerCtx = await contextFor(browser, dealerState)
    const dealerPage = await dealerCtx.newPage()
    await dealerPage.goto('/dashboard')
    await waitForAppReady(dealerPage)
    await openProfileMenu(dealerPage)
    const dealerDropdown = dealerPage.locator('.ant-dropdown')
    await expect(dealerDropdown).toBeVisible()
    await expect(dealerDropdown.getByText('调试模式')).toHaveCount(0)
    await expect(dealerDropdown.getByText('重置密码')).toBeVisible()
    await expect(dealerDropdown.getByText('退出登录')).toBeVisible()
    await dealerCtx.close()
  })

  test('4.3 重置本人密码弹窗的校验与取消', async ({ browser }) => {
    const ctx = await contextFor(browser, adminState)
    const page = await ctx.newPage()

    // 1. 以 admin 登录，打开用户下拉并点击「重置密码」
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await openProfileMenu(page)
    await page.locator('.ant-dropdown').getByText('重置密码').click()
    const modal = page.locator('.ant-modal').filter({ hasText: '重置密码' })
    await expect(modal).toBeVisible()
    await expect(modal.locator('.ant-modal-title')).toHaveText('重置密码')
    await expect(modal).toContainText(
      '可手动输入新密码，或生成随机密码。重置成功后将立即退出登录，请使用新密码重新登录。',
    )
    await expect(modal.locator('.ant-form-item-label')).toContainText(
      '新密码',
    )
    await expect(
      modal.getByRole('button', { name: '生成随机密码' }),
    ).toBeVisible()
    await expect(modal.getByRole('button', { name: '取 消' })).toBeVisible()
    await expect(
      modal.getByRole('button', { name: '确认重置' }),
    ).toBeVisible()
    const passwordInput = modal.getByPlaceholder('请输入或生成新密码')

    // 2. 清空新密码后点击「确认重置」
    await modal.getByRole('button', { name: '确认重置' }).click()
    await expect(
      modal
        .locator('.ant-form-item-explain-error')
        .filter({ hasText: '请输入新密码' }),
    ).toBeVisible()
    await expect(modal).toBeVisible()

    // 3. 输入 5 位密码 abc12 后点击「确认重置」
    await passwordInput.fill('abc12')
    await modal.getByRole('button', { name: '确认重置' }).click()
    await expect(
      modal
        .locator('.ant-form-item-explain-error')
        .filter({ hasText: '密码至少 6 位' }),
    ).toBeVisible()
    await expect(modal).toBeVisible()

    // 4. 点击「生成随机密码」
    await modal.getByRole('button', { name: '生成随机密码' }).click()
    await expect(passwordInput).toHaveValue(/^.{12}$/)
    await expect(passwordInput).toHaveAttribute('type', 'text')
    await expect(passwordInput).toHaveAttribute('type', 'password', {
      timeout: 8_000,
    })

    // 5. 点击「取消」，再重新打开弹窗
    await modal.getByRole('button', { name: '取 消' }).click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
    await openProfileMenu(page)
    await page.locator('.ant-dropdown').getByText('重置密码').click()
    const reopened = page.locator('.ant-modal').filter({ hasText: '重置密码' })
    await expect(reopened).toBeVisible()
    await expect(
      reopened.getByPlaceholder('请输入或生成新密码'),
    ).toHaveValue('')

    await ctx.close()
  })

  // 4.4 需要真实重置临时管理员密码并重新登录；按执行约束不提交任何真实改密操作，
  // 且 4.3 已覆盖弹窗校验与取消。故标记 fixme，待专用临时账号方案落地后启用。
  test.fixme(
    '4.4 重置本人密码成功后强制退出（使用临时管理员）',
    async () => {},
  )
})
