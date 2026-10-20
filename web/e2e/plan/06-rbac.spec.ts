// spec: specs/06-rbac.plan.md
// seed: e2e/seed.spec.ts

import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED, loginViaApi } from '../helpers/login'
import { expandAllMenus, menuLink, waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)
const adminState = path.join(authDir, 'admin.json')
const dealerState = path.join(authDir, 'dealer.json')
const BASE_URL = 'http://localhost:5288'

const PASSWORD = 'PwTest@123'
const NEW_PASSWORD = 'PwNew@1234'

/**
 * 本机后端响应 3–40s，部分链路 90–120s。APIRequestContext 默认超时较短，
 * 这里统一放宽；涉及创建/分配权限的用例再单独放宽用例总时长。
 */
const API_TIMEOUT = 120_000
const TEST_TIMEOUT = 420_000

type RbacRole = {
  roleId: number
  name: string
  key?: string | null
  description?: string | null
  createTime?: string
  updateTime?: string
}

type RbacUser = {
  id: string
  name: string
  email: string
  realname?: string | null
  isSuperAdmin?: boolean
  createdAt?: string
  roles?: Array<{ roleId: number; name: string; key?: string | null }>
}

type RbacPermission = {
  permissionId: number
  parentPermissionId?: number | null
  code: string
  name: string
  children?: RbacPermission[]
}

type RolePermissions = {
  permissionIds: number[]
  readOnlyPermissionIds: number[]
}

type RechargeList = {
  items: Array<{ id: number; isVerify: number }>
  total: number
}

const OPS_PERMISSION_CODES = [
  'finance',
  'wallet',
  'trade_log',
  'recharge',
  'deduction',
  'site',
  'exchange_rate',
  'site_config',
  'goods',
  'goods_fulfill_order',
  'goods_history_order',
]

/** browser.newContext() does not inherit config `use`, so pass baseURL. */
function contextFor(browser: Browser, storageState?: string) {
  return browser.newContext({
    baseURL: BASE_URL,
    ...(storageState ? { storageState } : {}),
  })
}

/** 所在 suite 设置了 storageState 时，手动创建的匿名上下文必须显式清空登录态。 */
function anonContext(browser: Browser) {
  return browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  })
}

/**
 * 无任何业务权限的用户侧边栏没有 .ant-menu-submenu，
 * helpers/nav.waitForAppReady 会因为等不到子菜单而超时；这里只等待外壳与首个菜单项。
 */
async function waitForShell(page: Page) {
  await expect(page.locator('.ant-layout-sider')).toBeVisible({
    timeout: 120_000,
  })
  await expect(page.locator('.ant-spin-spinning'))
    .toHaveCount(0, { timeout: 120_000 })
    .catch(() => undefined)
  await expect(page.locator('.ant-layout-header')).toBeVisible({
    timeout: 120_000,
  })
  await expect(
    page.locator('.ant-layout-sider .ant-menu-item').first(),
  ).toBeVisible({ timeout: 120_000 })
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

function tableRows(page: Page) {
  return page.locator('main .ant-table-tbody tr.ant-table-row')
}

function cell(row: Locator, index: number) {
  return row.locator(`td:nth-child(${index})`)
}

function userRow(page: Page, email: string) {
  return tableRows(page).filter({ hasText: email }).first()
}

function roleRow(page: Page, name: string) {
  return tableRows(page).filter({ hasText: name }).first()
}

function titledModal(page: Page, title: string | RegExp) {
  return page
    .locator('.ant-modal')
    .filter({ has: page.locator('.ant-modal-title', { hasText: title }) })
    .last()
}

function permissionModal(page: Page) {
  return titledModal(page, /^设置权限 — /)
}

/** Tree 节点标题形如「钱包 (wallet)」，按权限码唯一匹配。 */
function treeNode(modal: Locator, code: string) {
  return modal
    .locator('.ant-tree-treenode')
    .filter({ hasText: new RegExp(`\\(${code}\\)$`) })
    .first()
}

/** 已选权限级别区域每行文本形如「钱包wallet」。 */
function levelRow(modal: Locator, code: string) {
  return modal
    .locator('.ant-space-item')
    .filter({ hasText: code })
    .first()
}

function uniqueStamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 慢环境下的 API 调用：显式 120s 超时；网络抖动或 5xx 时有限重试。
 * 4xx（如 409 邮箱已存在）不重试，避免掩盖真实业务错误。
 */
async function callApi(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  options: { data?: unknown; label?: string; retries?: number } = {},
) {
  const {
    data,
    label = `${method.toUpperCase()} ${url}`,
    retries = 2,
  } = options
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await request[method](url, { data, timeout: API_TIMEOUT })
      if (res.status() >= 500 && attempt < retries) {
        lastError = new Error(
          `${label}: HTTP ${res.status()} ${await res.text().catch(() => '')}`,
        )
        continue
      }
      return res
    } catch (error) {
      lastError = error
      if (attempt === retries) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 断言 API 成功，并在失败信息中带上响应体，便于定位 5xx/4xx 根因。 */
async function expectApiOk(res: APIResponse, label: string) {
  const body = res.ok() ? '' : await res.text().catch(() => '')
  expect(res.ok(), `${label}: HTTP ${res.status()} ${body}`).toBeTruthy()
}

async function listRoles(request: APIRequestContext) {
  const res = await callApi(request, 'get', '/api/rbac/roles', {
    label: '列出角色',
  })
  await expectApiOk(res, '列出角色')
  return (await res.json()) as RbacRole[]
}

async function listUsers(request: APIRequestContext) {
  const res = await callApi(request, 'get', '/api/rbac/users', {
    label: '列出用户',
  })
  await expectApiOk(res, '列出用户')
  return (await res.json()) as RbacUser[]
}

async function listPermissions(request: APIRequestContext) {
  const res = await callApi(request, 'get', '/api/rbac/permissions', {
    label: '列出权限',
  })
  await expectApiOk(res, '列出权限')
  return (await res.json()) as RbacPermission[]
}

async function createRole(
  request: APIRequestContext,
  input: { name: string; key?: string; description?: string },
) {
  const res = await callApi(request, 'post', '/api/rbac/roles', {
    data: input,
    label: `创建角色 ${input.name}`,
  })
  await expectApiOk(res, `创建角色 ${input.name}`)
  return (await res.json()) as RbacRole
}

async function setRolePermissions(
  request: APIRequestContext,
  roleId: number,
  permissionIds: number[],
  readOnlyPermissionIds: number[],
) {
  const res = await callApi(
    request,
    'put',
    `/api/rbac/roles/${roleId}/permissions`,
    {
      data: { permissionIds, readOnlyPermissionIds },
      label: `保存角色 ${roleId} 权限`,
    },
  )
  await expectApiOk(res, `保存角色 ${roleId} 权限`)
}

async function getRolePermissions(
  request: APIRequestContext,
  roleId: number,
) {
  const res = await callApi(
    request,
    'get',
    `/api/rbac/roles/${roleId}/permissions`,
    { label: `读取角色 ${roleId} 权限` },
  )
  await expectApiOk(res, `读取角色 ${roleId} 权限`)
  return (await res.json()) as RolePermissions
}

async function createUser(
  request: APIRequestContext,
  input: {
    email: string
    name: string
    realname?: string
    roleIds?: number[]
  },
) {
  const res = await callApi(request, 'post', '/api/rbac/users', {
    data: { password: PASSWORD, ...input },
    label: `创建用户 ${input.email}`,
  })
  await expectApiOk(res, `创建用户 ${input.email}`)
  return (await res.json()) as RbacUser
}

async function deleteUserQuietly(
  request: APIRequestContext,
  userId?: string,
) {
  if (!userId) return
  await request
    .delete(`/api/rbac/users/${userId}`, { timeout: API_TIMEOUT })
    .catch(() => undefined)
}

async function deleteRoleQuietly(
  request: APIRequestContext,
  roleId?: number,
) {
  if (!roleId) return
  await request
    .delete(`/api/rbac/roles/${roleId}`, { timeout: API_TIMEOUT })
    .catch(() => undefined)
}

function permissionIdByCode(
  perms: RbacPermission[],
  code: string,
) {
  const found = perms.find((p) => p.code === code)
  expect(found, `permission code ${code}`).toBeTruthy()
  return found!.permissionId
}

function leafCodes(perms: RbacPermission[]) {
  const parentIds = new Set(
    perms
      .map((p) => p.parentPermissionId)
      .filter((id): id is number => typeof id === 'number'),
  )
  return perms
    .filter((p) => !parentIds.has(p.permissionId))
    .map((p) => p.code)
}

function unionIds(config: RolePermissions) {
  return [...new Set([...config.permissionIds, ...config.readOnlyPermissionIds])]
}

/** 打开指定角色的设置权限弹窗，并等待权限接口返回，避免读到上一个角色的勾选状态。 */
async function openPermissions(page: Page, roleName: string) {
  const row = roleRow(page, roleName)
  await expect(row).toBeVisible({ timeout: 120_000 })
  const loaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /\/api\/rbac\/roles\/\d+\/permissions$/.test(
        new URL(r.url()).pathname,
      ),
    { timeout: 120_000 },
  )
  await row.getByRole('button', { name: '设置权限' }).click()
  await loaded
  const modal = permissionModal(page)
  await expect(modal).toBeVisible({ timeout: 60_000 })
  return modal
}

test.describe('1. 管理员列表与用户管理', () => {
  test.use({ storageState: adminState })

  test('1.1 管理员列表结构与超级管理员保护', async ({ page }) => {
    // 1. 以 admin 访问 /rbac/users
    await page.goto('/rbac/users')
    await waitForAppReady(page)

    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '管理员',
    )
    await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible()
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '邮箱',
      '用户名',
      '姓名',
      '角色',
      '创建时间',
      '操作',
    ])

    const adminRow = userRow(page, SEED.admin.email)
    await expect(adminRow).toBeVisible({ timeout: 60_000 })
    await expect(cell(adminRow, 4)).toContainText('超级管理员')
    await expect(cell(adminRow, 4).locator('.ant-tag')).toHaveClass(
      /ant-tag-red/,
    )
    await expect(cell(adminRow, 6)).toHaveText('—')
    await expect(adminRow.getByRole('button')).toHaveCount(0)

    // 2. 检查页面能力：无搜索/状态筛选/启用禁用，分页每页 20 条
    await expect(page.locator('main .ant-input')).toHaveCount(0)
    await expect(page.locator('main .ant-select')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /启用|禁用|搜索/ }),
    ).toHaveCount(0)
    await expect(page.locator('main .ant-pagination')).toBeVisible()
    await expect(page.locator('main .ant-pagination-item')).toHaveCount(1)
  })

  test('1.2 新建用户必填与格式校验', async ({ page }) => {
    await page.goto('/rbac/users')
    await waitForAppReady(page)

    // 1. 点击「新建用户」，直接点「确 定」
    await page.getByRole('button', { name: '新建用户' }).click()
    const modal = titledModal(page, '新建用户')
    await expect(modal.locator('.ant-modal-title')).toHaveText('新建用户')
    await modal.getByRole('button', { name: /确\s*定/ }).click()

    for (const text of ['请输入邮箱', '请输入用户名', '请输入密码']) {
      await expect(
        modal.locator('.ant-form-item-explain-error').filter({ hasText: text }),
      ).toBeVisible({ timeout: 15_000 })
    }
    await expect(modal).toBeVisible()

    // 2. 邮箱填 not-an-email
    await modal.getByLabel('邮箱', { exact: true }).fill('not-an-email')
    await expect(
      modal
        .locator('.ant-form-item-explain-error')
        .filter({ hasText: '邮箱格式不正确' }),
    ).toBeVisible({ timeout: 15_000 })

    // 3. 密码填 1234567
    await modal.getByLabel('初始密码', { exact: true }).fill('1234567')
    await expect(
      modal
        .locator('.ant-form-item-explain-error')
        .filter({ hasText: '至少 8 位' }),
    ).toBeVisible({ timeout: 15_000 })

    await modal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })
  })

  test('1.3 创建测试用户成功并默认无角色', async ({
    page,
    browser,
  }) => {
    const stamp = uniqueStamp()
    const email = `pw-rbac-${stamp}@local.dev`
    const name = `pwuser${stamp}`
    const realname = `PW姓名${stamp}`
    const userCtx = await anonContext(browser)
    let userId: string | undefined

    try {
      // 1. 填写唯一邮箱、用户名、姓名、密码 PwTest@123，确定
      await page.goto('/rbac/users')
      await waitForAppReady(page)
      await page.getByRole('button', { name: '新建用户' }).click()
      const modal = titledModal(page, '新建用户')
      await modal.getByLabel('邮箱', { exact: true }).fill(email)
      await modal.getByLabel('用户名', { exact: true }).fill(name)
      await modal.getByLabel('姓名', { exact: true }).fill(realname)
      await modal.getByLabel('初始密码', { exact: true }).fill(PASSWORD)
      await modal.getByRole('button', { name: /确\s*定/ }).click()

      await expect(message(page, '用户已创建')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })

      const row = userRow(page, email)
      await expect(row).toBeVisible({ timeout: 60_000 })
      await expect(cell(row, 3)).toHaveText(realname)
      await expect(cell(row, 4)).toHaveText('—')

      userId = (await listUsers(page.request)).find((u) => u.email === email)?.id

      // 2. 用新用户登录：登录成功进入 /dashboard，侧边栏无业务菜单
      const userPage = await userCtx.newPage()
      await loginViaApi(userPage, email, PASSWORD)
      await waitForShell(userPage)
      await expect(userPage.locator('.ant-layout-sider .ant-menu-item')).toHaveText([
        '概览',
        '后台权限',
      ])
      await expect(
        userPage.locator('.ant-layout-sider .ant-menu-submenu'),
      ).toHaveCount(0)
      await expect(menuLink(userPage, '管理员')).toHaveCount(0)
      await expect(menuLink(userPage, '角色')).toHaveCount(0)

      // 实际可见「概览」与无子项的「后台权限」顶层项；记录空菜单缺陷
      const emptyParent = userPage
        .locator('.ant-layout-sider .ant-menu-item')
        .filter({ hasText: '后台权限' })
      await expect(emptyParent).toHaveCount(1)
      await expect(emptyParent.locator('a')).toHaveCount(0)
      await emptyParent.click()
      await expect(userPage).toHaveURL(/\/dashboard$/)

      test.info().annotations.push({
        type: 'defect',
        description:
          '无任何业务权限的用户侧边栏仍显示无子项的「后台权限」顶层菜单项（rbac 父菜单没有 permission，子项被过滤后父项被保留），点击无导航反应',
      })
    } finally {
      await userCtx.close()
      await deleteUserQuietly(page.request, userId)
    }
  })

  test('1.4 重复邮箱创建失败', async ({ page }) => {
    await page.goto('/rbac/users')
    await waitForAppReady(page)
    await expect(userRow(page, SEED.admin.email)).toBeVisible({
      timeout: 60_000,
    })
    const before = await tableRows(page).count()
    const stamp = uniqueStamp()

    // 1. 新建用户，邮箱填 dealer@local.dev
    await page.getByRole('button', { name: '新建用户' }).click()
    const modal = titledModal(page, '新建用户')
    await modal.getByLabel('邮箱', { exact: true }).fill(SEED.dealer.email)
    await modal.getByLabel('用户名', { exact: true }).fill(`pwdup${stamp}`)
    await modal.getByLabel('初始密码', { exact: true }).fill(PASSWORD)
    await modal.getByRole('button', { name: /确\s*定/ }).click()

    await expect(message(page, 'User already exists')).toBeVisible({
      timeout: 30_000,
    })
    await expect(modal).toBeVisible()
    await expect(tableRows(page)).toHaveCount(before)

    await modal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })
  })

  test('1.5 修改用户与邮箱占用校验', async ({ page }) => {
    const stamp = uniqueStamp()
    const email = `pw-rbac-${stamp}@local.dev`
    const name = `pwedit${stamp}`
    const realname = `PW原姓名${stamp}`
    const nextRealname = `PW姓名${stamp}`
    let userId: string | undefined

    try {
      const created = await createUser(page.request, {
        email,
        name,
        realname,
      })
      userId = created.id

      await page.goto('/rbac/users')
      await waitForAppReady(page)
      const row = userRow(page, email)
      await expect(row).toBeVisible({ timeout: 60_000 })
      await expect(cell(row, 3)).toHaveText(realname)

      // 1. 对测试用户点击「修改」
      await row.getByRole('button', { name: '修改' }).click()
      const modal = titledModal(page, `修改用户 — ${name}`)
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText(
        `修改用户 — ${name}`,
      )
      await expect(modal.getByLabel('用户名', { exact: true })).toHaveValue(
        name,
      )
      await expect(modal.getByLabel('邮件地址', { exact: true })).toHaveValue(
        email,
      )
      await expect(modal.getByLabel('姓名', { exact: true })).toHaveValue(
        realname,
      )

      // 2. 修改姓名为 PW姓名<stamp> 并确定
      await modal.getByLabel('姓名', { exact: true }).fill(nextRealname)
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '修改成功')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(cell(userRow(page, email), 3)).toHaveText(nextRealname, {
        timeout: 30_000,
      })

      // 3. 再次修改，邮箱改为 dealer@local.dev：提示已被占用且不保存
      await userRow(page, email).getByRole('button', { name: '修改' }).click()
      const again = titledModal(page, `修改用户 — ${name}`)
      await expect(again).toBeVisible()
      await again.getByLabel('邮件地址', { exact: true }).fill(
        SEED.dealer.email,
      )
      await again.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '邮箱已被占用')).toBeVisible({
        timeout: 30_000,
      })
      await expect(again).toBeVisible()
      await again.getByRole('button', { name: /取\s*消/ }).click()
      await expect(again).toBeHidden({ timeout: 15_000 })

      const stored = (await listUsers(page.request)).find(
        (u) => u.id === userId,
      )
      expect(stored?.email).toBe(email)
      expect(stored?.realname).toBe(nextRealname)
    } finally {
      await deleteUserQuietly(page.request, userId)
    }
  })

  test('1.6 重置测试用户密码', async ({ page, browser }) => {
    const stamp = uniqueStamp()
    const email = `pw-rbac-${stamp}@local.dev`
    const name = `pwpwd${stamp}`
    let userId: string | undefined
    const userCtx = await anonContext(browser)

    try {
      const created = await createUser(page.request, { email, name })
      userId = created.id

      await page.goto('/rbac/users')
      await waitForAppReady(page)
      const row = userRow(page, email)
      await expect(row).toBeVisible({ timeout: 60_000 })
      await row.getByRole('button', { name: '重置密码' }).click()
      const modal = titledModal(page, `重置密码 — ${name}`)
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText(
        `重置密码 — ${name}`,
      )
      await expect(modal.locator('input[disabled]').first()).toHaveValue(name)

      // 1. 点击「重置密码」，输入 7 位密码
      await modal.getByLabel('新密码').fill('1234567')
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      // 实际实现会先弹出二次确认，确认后才执行校验并提示「至少 8 位」
      const firstConfirm = page.locator('.ant-modal-confirm')
      await expect(firstConfirm).toBeVisible({ timeout: 15_000 })
      await expect(firstConfirm.locator('.ant-modal-confirm-title')).toHaveText(
        '确认重置该管理员密码？',
      )
      await firstConfirm.getByRole('button', { name: /确\s*定/ }).click()
      await expect(firstConfirm).toBeHidden({ timeout: 15_000 })
      await expect(
        modal
          .locator('.ant-form-item-explain-error')
          .filter({ hasText: '至少 8 位' }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(modal).toBeVisible()
      await expect(message(page, '重置密码成功')).toHaveCount(0)
      test.info().annotations.push({
        type: 'deviation',
        description:
          '计划 1.6 期望 7 位密码时不进入二次确认；实际实现点击「确定」先弹出「确认重置该管理员密码？」，确认后才校验并提示「至少 8 位」',
      })

      // 2. 输入 PwNew@1234，点击「确 定」：出现二次确认
      await modal.getByLabel('新密码').fill(NEW_PASSWORD)
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      const confirm = page.locator('.ant-modal-confirm')
      await expect(confirm).toBeVisible({ timeout: 15_000 })
      await expect(confirm.locator('.ant-modal-confirm-title')).toHaveText(
        '确认重置该管理员密码？',
      )

      // 3. 确认：提示「重置密码成功」，弹窗关闭
      await confirm.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '重置密码成功')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })

      // 4. 用新密码登录测试用户
      const userPage = await userCtx.newPage()
      await loginViaApi(userPage, email, NEW_PASSWORD)
      await waitForShell(userPage)
    } finally {
      await userCtx.close()
      await deleteUserQuietly(page.request, userId)
    }
  })

  test('1.7 分配角色与更新提示', async ({ page }) => {
    const stamp = uniqueStamp()
    const email = `pw-rbac-${stamp}@local.dev`
    const name = `pwrole${stamp}`
    let userId: string | undefined

    try {
      const created = await createUser(page.request, { email, name })
      userId = created.id

      await page.goto('/rbac/users')
      await waitForAppReady(page)
      const row = userRow(page, email)
      await expect(row).toBeVisible({ timeout: 60_000 })

      // 1. 点击测试用户「分配角色」
      await row.getByRole('button', { name: '分配角色' }).click()
      const modal = titledModal(page, `分配角色 — ${email}`)
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText(
        `分配角色 — ${email}`,
      )
      await expect(modal.getByText('选择角色', { exact: true })).toBeVisible()

      await modal.locator('.ant-select').click()
      const dropdown = page
        .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
        .last()
      await expect(dropdown).toBeVisible({ timeout: 15_000 })
      const options = dropdown.locator('.ant-select-item-option')
      for (const roleName of ['只读角色', '经销商', '运营专员']) {
        await expect(
          options.filter({ hasText: roleName }),
        ).toHaveCount(1)
      }

      // 2. 选择「运营专员」并确定
      await options.filter({ hasText: '运营专员' }).click()
      await modal.locator('.ant-modal-title').click()
      await expect(dropdown).toBeHidden({ timeout: 15_000 })
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '角色已更新')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(cell(userRow(page, email), 4)).toContainText('运营专员', {
        timeout: 30_000,
      })

      // 3. 重新打开，取消全部选择并确定
      await userRow(page, email)
        .getByRole('button', { name: '分配角色' })
        .click()
      const again = titledModal(page, `分配角色 — ${email}`)
      await expect(again).toBeVisible()
      const remove = again.locator('.ant-select-selection-item-remove')
      await expect(remove).toHaveCount(1)
      await remove.first().click()
      await expect(again.locator('.ant-select-selection-item')).toHaveCount(0)
      await again.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '角色已更新')).toBeVisible({
        timeout: 30_000,
      })
      await expect(again).toBeHidden({ timeout: 15_000 })
      await expect(cell(userRow(page, email), 4)).toHaveText('—', {
        timeout: 30_000,
      })
    } finally {
      await deleteUserQuietly(page.request, userId)
    }
  })

  test('1.8 删除专用测试用户', async ({ page }) => {
    const stamp = uniqueStamp()
    const email = `pw-rbac-${stamp}@local.dev`
    const name = `pwdel${stamp}`
    let userId: string | undefined

    try {
      const created = await createUser(page.request, { email, name })
      userId = created.id

      await page.goto('/rbac/users')
      await waitForAppReady(page)
      const row = userRow(page, email)
      await expect(row).toBeVisible({ timeout: 60_000 })

      // 1. 创建仅用于删除的测试用户，点击「删除」
      await row.getByRole('button', { name: '删除' }).click()
      const confirm = page.locator('.ant-modal-confirm')
      await expect(confirm).toBeVisible()
      await expect(confirm.locator('.ant-modal-confirm-title')).toHaveText(
        '确认删除该用户？',
      )
      await expect(confirm).toContainText(email)

      // 2. 取消：用户仍存在
      await confirm.getByRole('button', { name: /取\s*消/ }).click()
      await expect(confirm).toBeHidden({ timeout: 15_000 })
      await expect(row).toBeVisible()

      // 3. 再次删除并确认
      await row.getByRole('button', { name: '删除' }).click()
      const again = page.locator('.ant-modal-confirm')
      await expect(again).toBeVisible()
      await again.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '已删除')).toBeVisible({ timeout: 30_000 })
      await expect(userRow(page, email)).toHaveCount(0, {
        timeout: 30_000,
      })
      userId = undefined
    } finally {
      await deleteUserQuietly(page.request, userId)
    }
  })

  test('1.9 无权限用户访问管理员页面', async ({ browser }) => {
    const dealerCtx = await contextFor(browser, dealerState)
    const dealerPage = await dealerCtx.newPage()
    try {
      // 1. 以 dealer 访问 /rbac/users
      await dealerPage.goto('/rbac/users')
      await expect(
        message(dealerPage, 'Insufficient permission'),
      ).toBeVisible({ timeout: 60_000 })
      await waitForAppReady(dealerPage)

      await expect(dealerPage.locator('main .ant-card-head-title')).toHaveText(
        '管理员',
      )
      await expect(
        dealerPage.getByRole('button', { name: '新建用户' }),
      ).toHaveCount(0)
      await expect(tableRows(dealerPage)).toHaveCount(0)
      await expect(dealerPage.locator('main .ant-empty')).toBeVisible({
        timeout: 60_000,
      })
      for (const name of ['修改', '重置密码', '分配角色', '删除']) {
        await expect(
          dealerPage.getByRole('button', { name }),
        ).toHaveCount(0)
      }
      await expect(dealerPage.locator('#root')).not.toBeEmpty()
    } finally {
      await dealerCtx.close()
    }
  })
})

test.describe('2. 角色管理', () => {
  test.use({ storageState: adminState })

  test('2.1 角色列表结构', async ({ page }) => {
    // 1. 以 admin 访问 /rbac/roles
    await page.goto('/rbac/roles')
    await waitForAppReady(page)

    await expect(page.locator('main .ant-card-head-title')).toHaveText('角色')
    await expect(page.getByRole('button', { name: '添加角色' })).toBeVisible()
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '角色名',
      'Key',
      '描述',
      '创建时间',
      '操作',
    ])
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)

    const readOnly = roleRow(page, '只读角色')
    await expect(readOnly).toBeVisible({ timeout: 60_000 })
    await expect(cell(readOnly, 2)).toHaveText('—')

    const dealer = roleRow(page, '经销商')
    await expect(dealer).toBeVisible()
    await expect(cell(dealer, 2)).toHaveText('dealer')

    const ops = roleRow(page, '运营专员')
    await expect(ops).toBeVisible()
    await expect(cell(ops, 2)).toHaveText('ops')

    for (const row of [readOnly, dealer, ops]) {
      await expect(row.getByRole('button', { name: '设置权限' })).toBeVisible()
      await expect(row.getByRole('button', { name: '修改' })).toBeVisible()
      await expect(row.getByRole('button', { name: '删除' })).toBeVisible()
    }
  })

  test('2.2 添加角色必填与成功', async ({ page }) => {
    const stamp = uniqueStamp()
    const name = `PW角色${stamp}`
    let roleId: number | undefined

    try {
      await page.goto('/rbac/roles')
      await waitForAppReady(page)

      // 1. 点击「添加角色」，直接确定
      await page.getByRole('button', { name: '添加角色' }).click()
      const modal = titledModal(page, '添加角色')
      await expect(modal.locator('.ant-modal-title')).toHaveText('添加角色')
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(
        modal
          .locator('.ant-form-item-explain-error')
          .filter({ hasText: '请输入角色名' }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(modal).toBeVisible()

      // 2. 填角色名、描述，Key 留空，确定
      await modal.getByLabel('角色名', { exact: true }).fill(name)
      await modal.getByLabel('描述', { exact: true }).fill('plan-test')
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '角色已创建')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })

      const row = roleRow(page, name)
      await expect(row).toBeVisible({ timeout: 60_000 })
      await expect(cell(row, 2)).toHaveText(`pw${stamp}`)
      await expect(cell(row, 3)).toHaveText('plan-test')

      const roles = await listRoles(page.request)
      roleId = roles.find((r) => r.name === name)?.roleId

      // 3. 刷新页面，角色仍存在
      await page.reload()
      await waitForAppReady(page)
      await expect(roleRow(page, name)).toBeVisible({ timeout: 60_000 })
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('2.3 自定义 Key 创建角色', async ({ page }) => {
    const stamp = uniqueStamp()
    const name = `PW自定义Key${stamp}`
    const key = `pw_role_${stamp}`
    let roleId: number | undefined

    try {
      await page.goto('/rbac/roles')
      await waitForAppReady(page)

      // 1. 新建角色，Key 填 pw_role_<stamp>
      await page.getByRole('button', { name: '添加角色' }).click()
      const modal = titledModal(page, '添加角色')
      await modal.getByLabel('角色名', { exact: true }).fill(name)
      await modal.getByLabel('Key', { exact: true }).fill(key)
      await modal.getByRole('button', { name: /确\s*定/ }).click()

      await expect(message(page, '角色已创建')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })
      const row = roleRow(page, name)
      await expect(row).toBeVisible({ timeout: 60_000 })
      await expect(cell(row, 2)).toHaveText(key)

      const roles = await listRoles(page.request)
      roleId = roles.find((r) => r.name === name)?.roleId
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('2.4 修改角色', async ({ page }) => {
    const stamp = uniqueStamp()
    const name = `PW修改角色${stamp}`
    const key = `pw_edit_${stamp}`
    const before = `before-${stamp}`
    const after = `updated-${stamp}`
    let roleId: number | undefined

    try {
      const created = await createRole(page.request, {
        name,
        key,
        description: before,
      })
      roleId = created.roleId

      await page.goto('/rbac/roles')
      await waitForAppReady(page)
      const row = roleRow(page, name)
      await expect(row).toBeVisible({ timeout: 60_000 })

      // 1. 对测试角色点击「修改」
      await row.getByRole('button', { name: '修改' }).click()
      const modal = titledModal(page, '修改角色')
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText('修改角色')
      await expect(modal.getByLabel('角色名', { exact: true })).toHaveValue(
        name,
      )
      await expect(modal.getByLabel('Key', { exact: true })).toHaveValue(key)
      await expect(modal.getByLabel('描述', { exact: true })).toHaveValue(
        before,
      )

      // 2. 修改描述并确定
      await modal.getByLabel('描述', { exact: true }).fill(after)
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '角色已更新')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(cell(roleRow(page, name), 3)).toHaveText(after, {
        timeout: 30_000,
      })
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('2.5 删除角色确认与效果', async ({ page }) => {
    const stamp = uniqueStamp()
    const roleName = `PW删除角色${stamp}`
    const email = `pw-rbac-del-${stamp}@local.dev`
    let roleId: number | undefined
    let userId: string | undefined

    try {
      const role = await createRole(page.request, { name: roleName })
      roleId = role.roleId
      const user = await createUser(page.request, {
        email,
        name: `pwroledel${stamp}`,
        roleIds: [role.roleId],
      })
      userId = user.id

      await page.goto('/rbac/roles')
      await waitForAppReady(page)
      const row = roleRow(page, roleName)
      await expect(row).toBeVisible({ timeout: 60_000 })

      // 1. 点击「删除」：确认框内容为角色名
      await row.getByRole('button', { name: '删除' }).click()
      const confirm = page.locator('.ant-modal-confirm')
      await expect(confirm).toBeVisible()
      await expect(confirm.locator('.ant-modal-confirm-title')).toHaveText(
        '确认删除该角色？',
      )
      await expect(confirm).toContainText(roleName)

      // 2. 取消后角色仍存在；再次删除并确认
      await confirm.getByRole('button', { name: /取\s*消/ }).click()
      await expect(confirm).toBeHidden({ timeout: 15_000 })
      await expect(row).toBeVisible()

      await row.getByRole('button', { name: '删除' }).click()
      const again = page.locator('.ant-modal-confirm')
      await expect(again).toBeVisible()
      await again.getByRole('button', { name: /确\s*定/ }).click()
      await expect(message(page, '已删除')).toBeVisible({ timeout: 30_000 })
      await expect(roleRow(page, roleName)).toHaveCount(0, {
        timeout: 30_000,
      })

      // 3. 原持有该角色的测试用户角色列不再包含该角色
      await page.goto('/rbac/users')
      await waitForAppReady(page)
      const userRowLocator = userRow(page, email)
      await expect(userRowLocator).toBeVisible({ timeout: 60_000 })
      await expect(cell(userRowLocator, 4)).toHaveText('—')
    } finally {
      await deleteUserQuietly(page.request, userId)
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('2.6 只读权限用户看到角色页', async ({ browser }) => {
    const stamp = uniqueStamp()
    const roleName = `PW只读角色${stamp}`
    const email = `pw-rbac-ro-${stamp}@local.dev`
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const userCtx = await anonContext(browser)
    let roleId: number | undefined
    let userId: string | undefined

    try {
      const perms = await listPermissions(adminPage.request)
      const roleConfigId = permissionIdByCode(perms, 'role_config')
      const role = await createRole(adminPage.request, { name: roleName })
      roleId = role.roleId
      await setRolePermissions(adminPage.request, roleId, [], [roleConfigId])
      const user = await createUser(adminPage.request, {
        email,
        name: `pwro${stamp}`,
        roleIds: [roleId],
      })
      userId = user.id

      const page = await userCtx.newPage()
      await loginViaApi(page, email, PASSWORD)
      await page.goto('/rbac/roles')
      await waitForShell(page)

      // 1. 以仅 role_config:ro 的测试用户访问 /rbac/roles
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '角色',
      )
      await expect(
        page.getByRole('button', { name: '添加角色' }),
      ).toHaveCount(0)
      await expect(tableRows(page).first()).toBeVisible({ timeout: 60_000 })

      for (const row of await tableRows(page).all()) {
        await expect(
          row.getByRole('button', { name: '设置权限' }),
        ).toBeVisible()
        await expect(row.getByRole('button', { name: '修改' })).toHaveCount(0)
        await expect(row.getByRole('button', { name: '删除' })).toHaveCount(0)
      }
    } finally {
      await userCtx.close()
      await deleteUserQuietly(adminPage.request, userId)
      await deleteRoleQuietly(adminPage.request, roleId)
      await adminCtx.close()
    }
  })
})

test.describe('3. 权限树与读写级别', () => {
  test.use({ storageState: adminState })

  test('3.1 权限弹窗结构与回显（回归）', async ({ page }) => {
    const perms = await listPermissions(page.request)
    const roles = await listRoles(page.request)
    const ops = roles.find((r) => r.name === '运营专员')
    expect(ops, 'seed role 运营专员').toBeTruthy()

    const expectedIds = OPS_PERMISSION_CODES.map((code) =>
      permissionIdByCode(perms, code),
    )
    const idByCode = new Map(perms.map((p) => [p.code, p.permissionId]))
    const before = await getRolePermissions(page.request, ops!.roleId)

    await page.goto('/rbac/roles')
    await waitForAppReady(page)

    // 1. 对「运营专员」点击「设置权限」，只观察不保存
    const modal = await openPermissions(page, '运营专员')
    await expect(modal.locator('.ant-modal-title')).toHaveText(
      '设置权限 — 运营专员',
    )
    await expect(treeNode(modal, 'wallet').locator('.ant-tree-checkbox')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 30_000 },
    )
    await expect(treeNode(modal, 'wallet').locator('.ant-tree-title')).toHaveText(
      '钱包 (wallet)',
    )
    await expect(
      treeNode(modal, 'recharge').locator('.ant-tree-title'),
    ).toHaveText('充值审核 (recharge)')

    // Tree 默认展开全部父子节点（忽略 AntD 渲染的空占位节点）
    await expect(
      modal.locator('.ant-tree-treenode:has(.ant-tree-title)'),
    ).toHaveCount(perms.length, { timeout: 30_000 })

    // 已有权限被勾选，显示已选权限读写级别区域
    const checkedCount = await modal
      .locator('.ant-tree-checkbox-checked')
      .count()
    expect(checkedCount).toBeGreaterThan(0)
    await expect(
      modal.getByText('已选权限读写级别（默认读写；可改为只读）'),
    ).toBeVisible()

    // 2. 读取 GET /api/rbac/roles/3/permissions 并对比弹窗
    const config = await getRolePermissions(page.request, ops!.roleId)
    expect(Array.isArray(config.permissionIds)).toBe(true)
    expect(Array.isArray(config.readOnlyPermissionIds)).toBe(true)
    expect(config.permissionIds.length).toBe(11)
    expect([...config.permissionIds].sort((a, b) => a - b)).toEqual(
      [...expectedIds].sort((a, b) => a - b),
    )
    expect(config.readOnlyPermissionIds).toEqual([])

    const leaves = leafCodes(perms)
    const union = unionIds(config)
    const expectedLeafCodes = leaves.filter((code) =>
      union.includes(idByCode.get(code) ?? -1),
    )
    await expect(modal.locator('.ant-space-item')).toHaveCount(
      expectedLeafCodes.length,
    )
    for (const row of await modal.locator('.ant-space-item').all()) {
      await expect(row.getByText('读写', { exact: true })).toBeVisible()
      await expect(row.getByText('只读', { exact: true })).toBeVisible()
    }

    const uiCheckedLeaves: string[] = []
    for (const code of leaves) {
      const checkbox = treeNode(modal, code).locator('.ant-tree-checkbox')
      if ((await checkbox.getAttribute('aria-checked')) === 'true') {
        uiCheckedLeaves.push(code)
      }
    }
    for (const code of expectedLeafCodes) {
      expect(uiCheckedLeaves, `leaf ${code} should be checked`).toContain(code)
    }
    const extras = uiCheckedLeaves
      .filter((code) => !expectedLeafCodes.includes(code))
      .sort()
    expect(extras).toEqual([
      'goods_reserve_create',
      'goods_reserve_order',
    ])
    test.info().annotations.push({
      type: 'deviation',
      description: `父级权限被勾选时 AntD 级联显示其全部子节点：弹窗显示 ${checkedCount} 个勾选节点、${expectedLeafCodes.length} 行读写级别，而接口 permissionIds 为 11 项（不含 goods_reserve_create/goods_reserve_order）；计划「弹窗勾选叶子集合与接口并集一致」不成立，属于级联展示差异`,
    })

    // 3. 点击「取 消」关闭弹窗，角色权限未变化
    await modal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })
    expect(await getRolePermissions(page.request, ops!.roleId)).toEqual(before)
  })

  test('3.2 专用测试角色保存只读级别并通过 API 校验', async ({ page }) => {
    const stamp = uniqueStamp()
    const roleName = `PW只读级别${stamp}`
    let roleId: number | undefined

    try {
      const role = await createRole(page.request, {
        name: roleName,
        description: 'plan-3.2',
      })
      roleId = role.roleId
      const perms = await listPermissions(page.request)
      const walletId = permissionIdByCode(perms, 'wallet')

      await page.goto('/rbac/roles')
      await waitForAppReady(page)

      // 1. 新建专用测试角色并点击「设置权限」：初始无勾选
      const modal = await openPermissions(page, roleName)
      await expect(
        treeNode(modal, 'wallet').locator('.ant-tree-checkbox'),
      ).toHaveAttribute('aria-checked', 'false')
      await expect(
        modal.getByText('已选权限读写级别（默认读写；可改为只读）'),
      ).toHaveCount(0)
      await expect(modal.locator('.ant-space-item')).toHaveCount(0)

      // 2. 仅勾选 wallet 叶子，将级别切换「只读」，点击「确 定」
      await treeNode(modal, 'wallet').locator('.ant-tree-checkbox').click()
      await expect(
        treeNode(modal, 'wallet').locator('.ant-tree-checkbox'),
      ).toHaveAttribute('aria-checked', 'true')
      await expect(modal.locator('.ant-space-item')).toHaveCount(1)
      const walletLevel = levelRow(modal, 'wallet')
      await walletLevel.getByText('只读', { exact: true }).click()
      await expect(
        walletLevel.getByRole('radio', { name: '只读' }),
      ).toBeChecked()

      const saveResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/rbac/roles/${roleId}/permissions`) &&
          r.request().method() === 'PUT',
        { timeout: 30_000 },
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      expect((await saveResponse).status()).toBe(200)
      await expect(message(page, '权限已保存')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })

      // 3. 调用 GET 校验：wallet 在只读数组，读写数组为空
      const saved = await getRolePermissions(page.request, roleId)
      expect(saved.permissionIds).toEqual([])
      expect(saved.readOnlyPermissionIds).toEqual([walletId])

      // 4. 重新打开：wallet 勾选且级别显示只读；只观察后取消
      const reopened = await openPermissions(page, roleName)
      await expect(
        treeNode(reopened, 'wallet').locator('.ant-tree-checkbox'),
      ).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 })
      await expect(reopened.locator('.ant-space-item')).toHaveCount(1)
      await expect(
        levelRow(reopened, 'wallet').getByRole('radio', { name: '只读' }),
      ).toBeChecked()
      await reopened.getByRole('button', { name: /取\s*消/ }).click()
      await expect(reopened).toBeHidden({ timeout: 15_000 })
      expect(await getRolePermissions(page.request, roleId)).toEqual(saved)
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('3.3 父子联动取消勾选并保存', async ({ page }) => {
    const stamp = uniqueStamp()
    const roleName = `PW父子联动${stamp}`
    let roleId: number | undefined

    try {
      const role = await createRole(page.request, { name: roleName })
      roleId = role.roleId
      const perms = await listPermissions(page.request)
      const walletId = permissionIdByCode(perms, 'wallet')
      const tradeLogId = permissionIdByCode(perms, 'trade_log')
      const rechargeId = permissionIdByCode(perms, 'recharge')
      const deductionId = permissionIdByCode(perms, 'deduction')

      await page.goto('/rbac/roles')
      await waitForAppReady(page)
      const modal = await openPermissions(page, roleName)

      // 1. 勾选父节点「财务」，再取消其中一个叶子 recharge
      const financeCheckbox = treeNode(modal, 'finance').locator(
        '.ant-tree-checkbox',
      )
      await financeCheckbox.click()
      await expect(financeCheckbox).toHaveAttribute('aria-checked', 'true')
      for (const code of ['wallet', 'trade_log', 'recharge', 'deduction']) {
        await expect(
          treeNode(modal, code).locator('.ant-tree-checkbox'),
        ).toHaveAttribute('aria-checked', 'true')
      }
      await expect(modal.locator('.ant-space-item')).toHaveCount(4)

      const rechargeCheckbox = treeNode(modal, 'recharge').locator(
        '.ant-tree-checkbox',
      )
      await rechargeCheckbox.click()
      await expect(rechargeCheckbox).toHaveAttribute('aria-checked', 'false')
      for (const code of ['wallet', 'trade_log', 'deduction']) {
        await expect(
          treeNode(modal, code).locator('.ant-tree-checkbox'),
        ).toHaveAttribute('aria-checked', 'true')
      }
      await expect(financeCheckbox).toHaveClass(
        /ant-tree-checkbox-indeterminate/,
      )
      await expect(modal.locator('.ant-space-item')).toHaveCount(3)
      expect(await levelRow(modal, 'recharge').count()).toBe(0)

      // 2. 保存并通过 API 校验
      const saveResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/rbac/roles/${roleId}/permissions`) &&
          r.request().method() === 'PUT',
        { timeout: 30_000 },
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      expect((await saveResponse).status()).toBe(200)
      await expect(message(page, '权限已保存')).toBeVisible({
        timeout: 30_000,
      })
      await expect(modal).toBeHidden({ timeout: 15_000 })

      const saved = await getRolePermissions(page.request, roleId)
      expect(saved.readOnlyPermissionIds).toEqual([])
      expect(saved.permissionIds).toEqual(
        expect.arrayContaining([walletId, tradeLogId, deductionId]),
      )
      expect(saved.permissionIds).not.toContain(rechargeId)
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })

  test('3.4 只读角色可打开权限树但不可保存', async ({ browser }) => {
    // 创建角色/用户 + 登录 + 权限弹窗在慢环境下可能超过 3 分钟。
    test.setTimeout(TEST_TIMEOUT)
    const stamp = uniqueStamp()
    const roleName = `PW只读权限${stamp}`
    const email = `pw-rbac-ro-${stamp}@local.dev`
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const userCtx = await anonContext(browser)
    let roleId: number | undefined
    let userId: string | undefined

    try {
      const perms = await listPermissions(adminPage.request)
      const roleConfigId = permissionIdByCode(perms, 'role_config')
      const role = await createRole(adminPage.request, { name: roleName })
      roleId = role.roleId
      await setRolePermissions(adminPage.request, roleId, [], [roleConfigId])
      const user = await createUser(adminPage.request, {
        email,
        name: `pwrorole${stamp}`,
        roleIds: [roleId],
      })
      userId = user.id

      const page = await userCtx.newPage()
      await loginViaApi(page, email, PASSWORD)
      await page.goto('/rbac/roles', { timeout: API_TIMEOUT })
      await waitForShell(page)
      await expect(tableRows(page).first()).toBeVisible({
        timeout: 120_000,
      })

      // 1. 以仅 role_config:ro 的测试用户打开「设置权限」
      const modal = await openPermissions(page, roleName)
      const ok = modal.getByRole('button', { name: /确\s*定/ })
      await expect(ok).toBeDisabled()

      // 2. 尝试勾选节点：Tree 未设置 disabled，仍可勾选（疑似缺陷）
      const walletCheckbox = treeNode(modal, 'wallet').locator(
        '.ant-tree-checkbox',
      )
      await expect(walletCheckbox).toBeEnabled()
      await walletCheckbox.click()
      await expect(walletCheckbox).toHaveAttribute('aria-checked', 'true')
      const walletLevel = levelRow(modal, 'wallet')
      await expect(walletLevel).toBeVisible()
      await expect(
        walletLevel.getByRole('radio', { name: '读写' }),
      ).toBeDisabled()
      await expect(
        walletLevel.getByRole('radio', { name: '只读' }),
      ).toBeDisabled()
      await expect(ok).toBeDisabled()
      test.info().annotations.push({
        type: 'defect',
        description:
          '只读角色（role_config:ro）打开设置权限弹窗后，确定按钮与级别单选已禁用，但 Tree 本身未禁用，仍可勾选节点；本次只勾选后取消，未保存',
      })

      // 无论是否可勾选，均无法保存：取消且接口数据未变
      await modal.getByRole('button', { name: /取\s*消/ }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      expect(await getRolePermissions(adminPage.request, roleId)).toEqual({
        permissionIds: [],
        readOnlyPermissionIds: [roleConfigId],
      })
    } finally {
      await userCtx.close()
      await deleteUserQuietly(adminPage.request, userId)
      await deleteRoleQuietly(adminPage.request, roleId)
      await adminCtx.close()
    }
  })

  test('3.5 权限保存失败提示', async ({ page }) => {
    const stamp = uniqueStamp()
    const roleName = `PW保存失败${stamp}`
    let roleId: number | undefined

    try {
      const role = await createRole(page.request, { name: roleName })
      roleId = role.roleId

      await page.goto('/rbac/roles')
      await waitForAppReady(page)
      const modal = await openPermissions(page, roleName)

      // 1. 拦截 PUT 返回 500，保存权限
      await page.route(
        `**/api/rbac/roles/${roleId}/permissions`,
        async (route) => {
          if (route.request().method() !== 'PUT') {
            await route.continue()
            return
          }
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              message: '保存权限失败（服务端 500）',
              statusCode: 500,
            }),
          })
        },
      )

      try {
        await treeNode(modal, 'wallet').locator('.ant-tree-checkbox').click()
        await expect(
          treeNode(modal, 'wallet').locator('.ant-tree-checkbox'),
        ).toHaveAttribute('aria-checked', 'true')
        const ok = modal.getByRole('button', { name: /确\s*定/ })
        await ok.click()
        await expect(
          message(page, '保存权限失败（服务端 500）'),
        ).toBeVisible({ timeout: 30_000 })
        await expect(modal).toBeVisible()
        await expect(ok).toBeEnabled({ timeout: 30_000 })
        await expect(ok).not.toHaveClass(/ant-btn-loading/, {
          timeout: 30_000,
        })

        // 权限未改变
        expect(await getRolePermissions(page.request, roleId)).toEqual({
          permissionIds: [],
          readOnlyPermissionIds: [],
        })
      } finally {
        await page.unroute(`**/api/rbac/roles/${roleId}/permissions`)
      }

      await modal.getByRole('button', { name: /取\s*消/ }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      expect(await getRolePermissions(page.request, roleId)).toEqual({
        permissionIds: [],
        readOnlyPermissionIds: [],
      })
    } finally {
      await deleteRoleQuietly(page.request, roleId)
    }
  })
})

test.describe('4. 权限联动与路由行为', () => {
  test('4.1 只读钱包角色登录后的菜单过滤', async ({ browser }) => {
    // 创建角色/用户 + 两次页面加载与列表请求，慢环境下远超默认 60s。
    test.setTimeout(TEST_TIMEOUT)
    const stamp = uniqueStamp()
    const roleName = `PW钱包只读${stamp}`
    const email = `pw-rbac-wallet-${stamp}@local.dev`
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const userCtx = await anonContext(browser)
    let roleId: number | undefined
    let userId: string | undefined

    try {
      // 1. 创建角色 A 仅授予 wallet:ro；创建用户 U 并分配角色 A；以 U 登录
      const perms = await listPermissions(adminPage.request)
      const walletId = permissionIdByCode(perms, 'wallet')
      const role = await createRole(adminPage.request, { name: roleName })
      roleId = role.roleId
      await setRolePermissions(adminPage.request, roleId, [], [walletId])
      const user = await createUser(adminPage.request, {
        email,
        name: `pwwallet${stamp}`,
        roleIds: [roleId],
      })
      userId = user.id

      const page = await userCtx.newPage()
      await loginViaApi(page, email, PASSWORD)
      await waitForShell(page)
      await expandAllMenus(page)

      await expect(menuLink(page, '概览')).toBeVisible()
      await expect(menuLink(page, '钱包')).toBeVisible()
      await expect(submenu(page, '财务')).toBeVisible()
      await expect(submenu(page, '订单管理')).toHaveCount(0)
      await expect(submenu(page, '站点管理')).toHaveCount(0)
      for (const name of ['账户变动', '充值审核', '扣费审核', '管理员', '角色']) {
        await expect(menuLink(page, name)).toHaveCount(0)
      }

      // 实际还会显示无子项的「后台权限」顶层项（缺陷）
      const emptyParent = page
        .locator('.ant-layout-sider .ant-menu-item')
        .filter({ hasText: '后台权限' })
      await expect(emptyParent).toHaveCount(1)
      await expect(submenu(page, '后台权限')).toHaveCount(0)
      test.info().annotations.push({
        type: 'defect',
        description:
          '仅有 wallet:ro 的用户侧边栏仍显示无子项的「后台权限」顶层菜单项：rbac 父菜单没有 permission，子项全部被过滤后父项被保留',
      })

      // 2. 进入 /finance/wallet：页面可加载，无经销商筛选与查询，接口不返回 403
      const walletResponse = page.waitForResponse(
        (r) => r.url().includes('/api/finance/wallet/list'),
        { timeout: API_TIMEOUT },
      )
      await page.goto('/finance/wallet', { timeout: API_TIMEOUT })
      expect((await walletResponse).status()).toBe(200)
      await waitForShell(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '钱包',
        { timeout: 120_000 },
      )
      await expect(page.locator('main .ant-select')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /查\s*询/ })).toHaveCount(0)
      await expect(message(page, 'Insufficient permission')).toHaveCount(0)

      // 3. 直接访问 /finance/recharge：页面骨架渲染，无「新增充值」，403 提示
      await page.goto('/finance/recharge', { timeout: API_TIMEOUT })
      await expect(message(page, 'Insufficient permission')).toBeVisible({
        timeout: 120_000,
      })
      await waitForShell(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '充值审核',
        { timeout: 120_000 },
      )
      await expect(
        page.getByRole('button', { name: '新增充值' }),
      ).toHaveCount(0)
      await expect(page.locator('main .ant-empty')).toBeVisible({
        timeout: 120_000,
      })
      await expect(page.getByRole('button', { name: '审核' })).toHaveCount(0)
      await expect(page.locator('#root')).not.toBeEmpty()
    } finally {
      await userCtx.close()
      await deleteUserQuietly(adminPage.request, userId)
      await deleteRoleQuietly(adminPage.request, roleId)
      await adminCtx.close()
    }
  })

  test('4.2 空父菜单显示（已知缺陷复现）', async ({ browser }) => {
    const stamp = uniqueStamp()
    const roleName = `PW空权限${stamp}`
    const email = `pw-rbac-empty-${stamp}@local.dev`
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const userCtx = await anonContext(browser)
    let roleId: number | undefined
    let userId: string | undefined

    try {
      // 1. 创建不授予任何权限的角色 B，分配给用户 U2 并登录
      const role = await createRole(adminPage.request, { name: roleName })
      roleId = role.roleId
      const user = await createUser(adminPage.request, {
        email,
        name: `pwempty${stamp}`,
        roleIds: [roleId],
      })
      userId = user.id

      const page = await userCtx.newPage()
      await loginViaApi(page, email, PASSWORD)
      await waitForShell(page)

      // 产品预期：侧边栏不应出现任何分组；实际仍有无子项的「后台权限」
      await expect(page.locator('.ant-layout-sider .ant-menu-submenu')).toHaveCount(
        0,
      )
      await expect(page.locator('.ant-layout-sider .ant-menu-item')).toHaveText([
        '概览',
        '后台权限',
      ])

      // 2. 点击「后台权限」：无子项、无导航反应
      const emptyParent = page
        .locator('.ant-layout-sider .ant-menu-item')
        .filter({ hasText: '后台权限' })
      await expect(emptyParent).toHaveCount(1)
      await expect(emptyParent.locator('a')).toHaveCount(0)
      await expect(
        emptyParent.locator('.ant-menu-submenu'),
      ).toHaveCount(0)
      await emptyParent.click()
      await expect(page).toHaveURL(/\/dashboard$/)

      test.info().annotations.push({
        type: 'defect',
        description:
          '无任何权限的角色登录后，侧边栏仍显示「概览」与无子项的「后台权限」顶层菜单项，点击无导航反应；filterMenus 在子项全部被过滤后仍保留父项并去掉 children',
      })
    } finally {
      await userCtx.close()
      await deleteUserQuietly(adminPage.request, userId)
      await deleteRoleQuietly(adminPage.request, roleId)
      await adminCtx.close()
    }
  })

  test('4.3 增加权限后菜单生效', async ({ browser }) => {
    // 多次保存权限 + 刷新 + 列表请求，慢环境下远超默认 60s。
    test.setTimeout(TEST_TIMEOUT)
    const stamp = uniqueStamp()
    const roleName = `PW充值联动${stamp}`
    const email = `pw-rbac-recharge-${stamp}@local.dev`
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const userCtx = await anonContext(browser)
    let roleId: number | undefined
    let userId: string | undefined

    try {
      const perms = await listPermissions(adminPage.request)
      const walletId = permissionIdByCode(perms, 'wallet')
      const rechargeId = permissionIdByCode(perms, 'recharge')
      const role = await createRole(adminPage.request, { name: roleName })
      roleId = role.roleId
      await setRolePermissions(adminPage.request, roleId, [], [walletId])
      const user = await createUser(adminPage.request, {
        email,
        name: `pwrecharge${stamp}`,
        roleIds: [roleId],
      })
      userId = user.id

      const page = await userCtx.newPage()
      await loginViaApi(page, email, PASSWORD)
      await waitForShell(page)
      await expandAllMenus(page)
      await expect(menuLink(page, '充值审核')).toHaveCount(0)

      // 1. 给角色 A 增加 recharge:rw，用户刷新后侧边栏出现充值审核
      await setRolePermissions(
        adminPage.request,
        roleId,
        [rechargeId],
        [walletId],
      )
      await page.reload({ timeout: API_TIMEOUT })
      await waitForShell(page)
      await expandAllMenus(page)
      await expect(menuLink(page, '充值审核')).toBeVisible({
        timeout: 120_000,
      })

      const pendingRes = await callApi(
        adminPage.request,
        'get',
        '/api/finance/recharge/list?page=1&pageSize=20',
        { label: '读取待审核充值列表' },
      )
      await expectApiOk(pendingRes, '读取待审核充值列表')
      const pendingList = (await pendingRes.json()) as RechargeList
      const pendingCount = pendingList.items.filter(
        (item) => item.isVerify === 0,
      ).length

      await menuLink(page, '充值审核').click()
      await expect(page).toHaveURL(/\/finance\/recharge$/, {
        timeout: 60_000,
      })
      await waitForShell(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '充值审核',
        { timeout: 120_000 },
      )
      await expect(
        page.getByRole('button', { name: '新增充值' }),
      ).toBeVisible()
      if (pendingCount > 0) {
        await expect(
          page.getByRole('button', { name: '审核' }).first(),
        ).toBeVisible({ timeout: 120_000 })
      } else {
        test.info().annotations.push({
          type: 'deviation',
          description:
            '当前环境没有待审核充值单，无法验证「审核」按钮的可见性；其余菜单与新增入口已断言',
        })
      }

      // 2. 移除 recharge 后刷新：菜单消失，已有页面再次请求 403
      await setRolePermissions(adminPage.request, roleId, [], [walletId])
      const afterRemove = await getRolePermissions(
        adminPage.request,
        roleId,
      )
      expect(afterRemove.permissionIds).not.toContain(rechargeId)
      expect(afterRemove.readOnlyPermissionIds).toEqual([walletId])

      const forbidden = page.waitForResponse(
        (r) =>
          r.url().includes('/api/finance/recharge/list') &&
          r.request().method() === 'GET',
        { timeout: API_TIMEOUT },
      )
      await page.getByRole('button', { name: /查\s*询/ }).click()
      expect((await forbidden).status()).toBe(403)
      await expect(message(page, 'Insufficient permission')).toBeVisible({
        timeout: 120_000,
      })

      await page.reload({ timeout: API_TIMEOUT })
      await waitForShell(page)
      await expandAllMenus(page)
      await expect(menuLink(page, '充值审核')).toHaveCount(0)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '充值审核',
        { timeout: 120_000 },
      )
      await expect(message(page, 'Insufficient permission')).toBeVisible({
        timeout: 120_000,
      })
      await expect(
        page.getByRole('button', { name: '新增充值' }),
      ).toHaveCount(0)
      await expect(page.locator('main .ant-empty')).toBeVisible({
        timeout: 120_000,
      })
    } finally {
      await userCtx.close()
      await deleteUserQuietly(adminPage.request, userId)
      await deleteRoleQuietly(adminPage.request, roleId)
      await adminCtx.close()
    }
  })

  test('4.4 路由级权限守卫观察', async ({ browser }) => {
    const dealerCtx = await contextFor(browser, dealerState)
    const page = await dealerCtx.newPage()
    try {
      // 1. 以无 site_config 权限用户直接访问 /site/config
      await page.goto('/site/config')
      await expect(message(page, 'Insufficient permission')).toBeVisible({
        timeout: 60_000,
      })
      await waitForAppReady(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '全局配置',
        { timeout: 60_000 },
      )
      await expect(page.locator('main .ant-select')).toHaveCount(2, {
        timeout: 60_000,
      })
      for (const select of await page.locator('main .ant-select').all()) {
        await expect(select.getByRole('combobox')).toBeDisabled()
      }
      await expect(
        page.getByRole('button', { name: /保\s*存/ }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /重\s*置/ }),
      ).toHaveCount(0)
      await expect(page.locator('main .ant-select-content-has-value')).toHaveCount(
        0,
      )
      await expect(page.locator('#root')).not.toBeEmpty()

      // 2. 以无 goods_fulfill_order 权限用户访问 /goods/fulfill
      await page.goto('/goods/fulfill')
      await expect(message(page, 'Insufficient permission')).toBeVisible({
        timeout: 60_000,
      })
      await waitForAppReady(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '履约订单',
        { timeout: 60_000 },
      )
      await expect(page.locator('main .ant-empty')).toBeVisible({
        timeout: 60_000,
      })
      await expect(page.getByRole('link', { name: '查看' })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /编\s*辑/ }),
      ).toHaveCount(0)
      await expect(page.getByRole('link', { name: /编\s*辑/ })).toHaveCount(0)

      test.info().annotations.push({
        type: 'defect',
        description:
          '无权限用户直接输入 URL 时缺少路由级预校验：页面先渲染骨架与空表，接口 403 后仅弹出英文全局提示 Insufficient permission，而不是跳转 403/首页',
      })
    } finally {
      await dealerCtx.close()
    }
  })

  test('4.5 未登录访问 RBAC 页面', async ({ browser }) => {
    // 显式传入空 storageState，确保上下文为未登录态。
    const ctx = await anonContext(browser)
    const page = await ctx.newPage()
    try {
      // 1. 清除 cookie 后访问 /rbac/users
      await page.goto('/rbac/users')
      await expect(page).toHaveURL(
        /\/login\?redirect=%2Frbac%2Fusers$/,
        { timeout: 30_000 },
      )
      await expect(page.locator('.login-card')).toBeVisible({
        timeout: 30_000,
      })

      // 2. 登录后自动回到 /rbac/users，admin 可见全部功能
      await page.getByPlaceholder('邮箱').fill(SEED.admin.email)
      await page.getByPlaceholder('密码').fill(SEED.admin.password)
      await page.getByRole('button', { name: /登\s*录/ }).click()
      await expect(page).toHaveURL(/\/rbac\/users$/, { timeout: 45_000 })
      await waitForAppReady(page)

      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '管理员',
      )
      await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible()
      const adminRow = userRow(page, SEED.admin.email)
      await expect(adminRow).toBeVisible({ timeout: 60_000 })
      await expect(cell(adminRow, 4)).toContainText('超级管理员')
      await expect(cell(adminRow, 6)).toHaveText('—')
    } finally {
      await ctx.close()
    }
  })
})
