// spec: specs/04-finance.plan.md
// seed: e2e/seed.spec.ts

import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditRowByRemark,
  createDeduction,
  createRecharge,
} from '../helpers/finance'
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
const adminState = path.join(authDir, 'admin.json')
const opsState = path.join(authDir, 'ops.json')
const dealerState = path.join(authDir, 'dealer.json')
const BASE_URL = 'http://localhost:5288'
// 该环境后端在开发/长跑状态下很慢：列表 20-40s，保存后刷新 30-40s，
// 个别链路可达 90-120s。所有显式等待统一使用该余量。
const SLOW = 120_000
const TEST_TIMEOUT = 300_000

type PageResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

type DealerOption = {
  id: string
  name: string
  email: string
  realname?: string | null
}

type MeResponse = {
  user: {
    id: string
    name: string
    email: string
    realname?: string | null
    isSuperAdmin?: boolean
  }
}

type WalletRecord = {
  id: number
  userId: string
  walletCode: string
  currencyCode?: string
  balance: string
  lastTradeTime?: string | null
  user?: DealerOption | null
}

type TradeLogRecord = {
  id: number
  tradeNumber: string
  userId: string
  userName?: string
  direction: string
  currencyCode?: string
  amount: string
  amountBase?: string
  balance: string
  orderNumber?: string | null
  info?: string | null
  createTime?: string
}

type RechargeRecord = {
  id: number
  rechargeNumber: string
  userId: string
  userName?: string | null
  currencyCode?: string
  amount: string
  amountBase?: string
  remark?: string | null
  isVerify: number
  createAdminId?: string
  createAdminName?: string | null
  verifyAdminName?: string | null
  verifyRemark?: string | null
  verifyTime?: string | null
  createTime?: string
}

type DeductionRecord = {
  id: number
  deductionNumber: string
  userId: string
  userName?: string | null
  currencyCode?: string
  amount: string
  amountBase?: string
  orderId?: number | null
  orderNumber?: string | null
  remark?: string | null
  isVerify: number
  createAdminId?: string
  createAdminName?: string | null
  verifyAdminName?: string | null
  verifyRemark?: string | null
  verifyTime?: string | null
  createTime?: string
}

type GoodsOrderDetail = {
  id: number
  orderNumber: string
  status: string
  currencyCode?: string
  deductionId?: number | null
  items: Array<{
    id: number
    amazonUrl: string
    reserveQty: number
    fulfillQty: number
    unitPrice?: string | number
  }>
}

type ExchangeRatesConfig = {
  baseCurrencyCode: string
  rates: Array<{ currencyCode: string; rateToBase: number }>
}

type ApiResult = { status: number; message: string; body: unknown }

function contextFor(browser: Browser, storageState: string) {
  return browser.newContext({ baseURL: BASE_URL, storageState })
}

function message(page: Page, text: string | RegExp) {
  return page.locator('.ant-message-notice-title').filter({ hasText: text }).first()
}

function tableRows(page: Page) {
  return page.locator('main .ant-table-tbody tr.ant-table-row')
}

function cell(row: Locator, index: number) {
  return row.locator(`td:nth-child(${index})`)
}

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function formatMoney(value: number | string, code = 'USD') {
  return `${code} ${Number(value).toFixed(2)}`
}

function money2(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)
}

function bodyMessage(body: unknown) {
  if (body && typeof body === 'object' && 'message' in body) {
    const value = (body as { message: unknown }).message
    return Array.isArray(value) ? value.join('; ') : String(value)
  }
  return ''
}

function listResponse(
  page: Page,
  endpoint: string,
  params: string[] = [],
  timeout = SLOW,
) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      r.url().includes(endpoint) &&
      params.every((p) => r.url().includes(p)),
    { timeout },
  )
}

async function waitForListSettled(page: Page) {
  await expect(page.locator('main .ant-table')).toBeVisible({
    timeout: SLOW,
  })
  await expect
    .poll(
      async () => {
        if ((await page.locator('main .ant-spin-spinning').count()) > 0) {
          return 'loading'
        }
        const count = await tableRows(page).count()
        const empty = await page.locator('main .ant-empty').count()
        return count > 0 || empty > 0 ? 'done' : 'pending'
      },
      { timeout: SLOW },
    )
    .toBe('done')
}

async function openFinancePage(page: Page, url: string) {
  await page.goto(url, { timeout: SLOW })
  await waitForAppReady(page)
  await waitForListSettled(page)
}

async function clickQuery(
  page: Page,
  endpoint: string,
  params: string[] = [],
) {
  const response = listResponse(page, endpoint, params)
  await page.getByRole('button', { name: /查\s*询/ }).click()
  return response
}

async function openSelect(page: Page, select: Locator) {
  await select.click()
  const dropdown = page.locator(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  )
  await expect(dropdown).toBeVisible({ timeout: 15_000 })
  return dropdown
}

async function pickDealerInFilter(
  page: Page,
  dealer: DealerOption,
  endpoint: string,
  index = 0,
) {
  const encoded = encodeURIComponent(dealer.id)
  const response = listResponse(page, endpoint, [`userId=${encoded}`])
  const dropdown = await openSelect(
    page,
    page.locator('main .ant-select').nth(index),
  )
  const option = dropdown
    .locator('.ant-select-item-option')
    .filter({ hasText: dealer.email })
    .first()
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
  return response
}

async function pickFilterOption(
  page: Page,
  index: number,
  label: string,
  endpoint: string,
  param: string,
) {
  const response = listResponse(page, endpoint, [param])
  const dropdown = await openSelect(
    page,
    page.locator('main .ant-select').nth(index),
  )
  await dropdown
    .locator('.ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click()
  return response
}

async function clearFilter(page: Page, index: number, endpoint: string) {
  const select = page.locator('main .ant-select').nth(index)
  await select.hover()
  const clear = select.locator('.ant-select-clear')
  await expect(clear).toBeVisible({ timeout: 10_000 })
  const response = listResponse(page, endpoint)
  await clear.click()
  return response
}

async function findRow(
  page: Page,
  endpoint: string,
  text: string,
  params: string[] = [],
) {
  const response = listResponse(page, endpoint, params)
  await page.getByRole('button', { name: /查\s*询/ }).click()
  await response
  const row = tableRows(page).filter({ hasText: text }).first()
  await expect(row).toBeVisible({ timeout: 60_000 })
  return row
}

async function listDealers(page: Page) {
  const response = await page.request.get('/api/finance/dealers', {
    timeout: SLOW,
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as DealerOption[]
}

async function needDealer(page: Page) {
  const list = await listDealers(page)
  const dealer =
    list.find((item) => item.email === 'dealer@local.dev') ?? list[0]
  if (!dealer) {
    test.skip(true, '当前环境无经销商数据，无法验证该场景')
  }
  return dealer!
}

async function getMe(page: Page) {
  const response = await page.request.get('/api/me', { timeout: SLOW })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as MeResponse
}

async function walletFor(page: Page, userId: string) {
  const response = await page.request.get(
    `/api/finance/wallet/list?userId=${encodeURIComponent(userId)}`,
    { timeout: SLOW },
  )
  expect(response.ok()).toBeTruthy()
  const list = (await response.json()) as WalletRecord[]
  const wallet = list.find((item) => item.userId === userId)
  expect(wallet).toBeTruthy()
  return wallet!
}

async function rechargePage(page: Page, pageNo = 1) {
  const response = await page.request.get(
    `/api/finance/recharge/list?page=${pageNo}&pageSize=100`,
    { timeout: SLOW },
  )
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as PageResult<RechargeRecord>
}

async function deductionPage(page: Page, pageNo = 1) {
  const response = await page.request.get(
    `/api/finance/deduction/list?page=${pageNo}&pageSize=100`,
    { timeout: SLOW },
  )
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as PageResult<DeductionRecord>
}

async function tradeLogPage(page: Page, userId?: string, pageNo = 1) {
  const query = new URLSearchParams({
    page: String(pageNo),
    pageSize: '100',
  })
  if (userId) query.set('userId', userId)
  const response = await page.request.get(
    `/api/finance/trade/log?${query.toString()}`,
    { timeout: SLOW },
  )
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as PageResult<TradeLogRecord>
}

async function createRechargeApi(
  page: Page,
  userId: string,
  amount: number,
  remark: string,
  currencyCode = 'USD',
) {
  const response = await page.request.post('/api/finance/recharge', {
    data: { userId, amount, currencyCode, remark },
    timeout: SLOW,
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as RechargeRecord
}

async function createDeductionApi(
  page: Page,
  userId: string,
  amount: number,
  remark: string,
  currencyCode = 'USD',
) {
  const response = await page.request.post('/api/finance/deduction', {
    data: { userId, amount, currencyCode, remark },
    timeout: SLOW,
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as DeductionRecord
}

async function verifyRechargeApi(
  page: Page,
  rechargeNumber: string,
  verify: boolean,
  verifyRemark?: string,
): Promise<ApiResult> {
  const response = await page.request.put('/api/finance/recharge/verify', {
    data: { rechargeNumber, verify, verifyRemark },
    timeout: SLOW,
  })
  const body = await response.json()
  return { status: response.status(), message: bodyMessage(body), body }
}

async function verifyDeductionApi(
  page: Page,
  deductionNumber: string,
  verify: boolean,
  verifyRemark?: string,
): Promise<ApiResult> {
  const response = await page.request.put('/api/finance/deduction/verify', {
    data: { deductionNumber, verify, verifyRemark },
    timeout: SLOW,
  })
  const body = await response.json()
  return { status: response.status(), message: bodyMessage(body), body }
}

async function rechargeByRemark(page: Page, remark: string) {
  const result = await rechargePage(page)
  const found = result.items.find((item) => item.remark === remark)
  expect(found).toBeTruthy()
  return found!
}

async function deductionByRemark(page: Page, remark: string) {
  const result = await deductionPage(page)
  const found = result.items.find((item) => item.remark === remark)
  expect(found).toBeTruthy()
  return found!
}

async function pickDealerInModal(
  page: Page,
  modal: Locator,
  dealer: DealerOption,
) {
  const item = modal.locator('.ant-form-item').filter({ hasText: '经销商' })
  const dropdown = await openSelect(page, item.locator('.ant-select'))
  const option = dropdown
    .locator('.ant-select-item-option')
    .filter({ hasText: dealer.email })
    .first()
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
  await expect(dropdown)
    .toBeHidden({ timeout: 5_000 })
    .catch(() => undefined)
}

async function pickCurrencyInModal(
  page: Page,
  modal: Locator,
  code: string,
) {
  const item = modal.locator('.ant-form-item').filter({ hasText: '币种' })
  const dropdown = await openSelect(page, item.locator('.ant-select'))
  await dropdown
    .locator('.ant-select-item-option')
    .filter({ hasText: code })
    .first()
    .click()
  await expect(dropdown)
    .toBeHidden({ timeout: 5_000 })
    .catch(() => undefined)
}

async function fillAmount(page: Page, scope: Locator, value: number) {
  const input = scope.locator('.ant-input-number-input').first()
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(String(value), { delay: 20 })
  await input.blur()
}

async function openAuditModal(
  page: Page,
  endpoint: string,
  text: string,
  title: string,
) {
  const row = await findRow(page, endpoint, text)
  await row.getByRole('button', { name: /审\s*核/ }).click()
  const modal = page.locator('.ant-modal').filter({ hasText: title })
  await expect(modal).toBeVisible({ timeout: 15_000 })
  return modal
}

function uniqueUrl(tag: string) {
  const id = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
  return `https://www.amazon.com/dp/${tag}-${id}`
}

async function getOrder(page: Page, orderId: number) {
  const response = await page.request.get(`/api/goods/orders/${orderId}`, {
    timeout: SLOW,
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as GoodsOrderDetail
}

async function openFulfillDetail(page: Page, orderId: number) {
  await page.goto(`/goods/fulfill/${orderId}`)
  await waitForAppReady(page)
  await expect(page.locator('main .ant-card-head-title')).toContainText(
    '订单 ',
    { timeout: 60_000 },
  )
  await expect(
    page.locator('main .ant-descriptions-item-label').first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(tableRows(page).first()).toBeVisible({ timeout: 60_000 })
}

async function applyFulfillQtys(page: Page, qtys: number[]) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __pwSetFulfillQtys?: unknown })
              .__pwSetFulfillQtys === 'function',
        ),
      { timeout: 15_000 },
    )
    .toBe(true)

  await page.evaluate((values) => {
    ;(
      window as unknown as { __pwSetFulfillQtys: (q: number[]) => void }
    ).__pwSetFulfillQtys(values)
  }, qtys)

  await expect
    .poll(
      () =>
        page
          .locator('main .ant-table-tbody input.ant-input-number-input')
          .evaluateAll((els) =>
            els.map((el) => Number((el as HTMLInputElement).value)),
          ),
      { timeout: 15_000 },
    )
    .toEqual(qtys)
}

async function setFulfillQtysAndSave(
  page: Page,
  orderId: number,
  qtys: number[],
) {
  await applyFulfillQtys(page, qtys)
  await applyFulfillQtys(page, qtys)
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/goods/orders/${orderId}`) &&
      r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: /保\s*存/ }).click()
  const result = await response
  expect(result.status()).toBe(200)
  await expect(message(page, '已保存')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('main button.ant-btn-loading')).toHaveCount(0, {
    timeout: 30_000,
  })
}

async function createPendingOrder(
  browser: Browser,
  rows: Array<[string, number]>,
  prices: number[],
) {
  const context = await contextFor(browser, dealerState)
  const page = await context.newPage()
  try {
    const orderId = await createReserveOrder(page, rows)
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, prices)
    await submitFulfill(page)
    return await getOrder(page, orderId)
  } finally {
    await context.close()
  }
}

async function completeOrder(page: Page, orderId: number) {
  await openFulfillDetail(page, orderId)
  const order = await getOrder(page, orderId)
  const qtys = order.items.map((item) => item.reserveQty)
  await setFulfillQtysAndSave(page, orderId, qtys)
  await expect(
    page
      .locator('main .ant-card-head-title .ant-tag')
      .filter({ hasText: '已履约' }),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '提交完成' }).click()
  const dialog = page
    .locator('.ant-modal-confirm')
    .filter({ hasText: '提交完成并生成扣费' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  const response = page.waitForResponse(
    (r) =>
      r
        .url()
        .includes(`/api/goods/orders/${orderId}/submit-complete`) &&
      r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: '确认提交' }).click()
  expect((await response).status()).toBe(201)
  await expect(message(page, '已完成，扣费单已生成')).toBeVisible({
    timeout: 60_000,
  })
}

async function createOrderDeduction(browser: Browser, opsPage: Page) {
  const order = await createPendingOrder(
    browser,
    [
      [uniqueUrl('FINDED1'), 2],
      [uniqueUrl('FINDED2'), 3],
    ],
    [10, 5],
  )
  await completeOrder(opsPage, order.id)
  await expect
    .poll(
      async () => {
        const result = await deductionPage(opsPage)
        return result.items.some((item) => item.orderId === order.id)
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  const result = await deductionPage(opsPage)
  const deduction = result.items.find((item) => item.orderId === order.id)
  expect(deduction).toBeTruthy()
  return { order, deduction: deduction! }
}

test.describe('1. 钱包与账户变动', () => {
  test.use({ storageState: adminState })

  test('1.1 钱包列表结构与管理员筛选', async ({ page }) => {
    // 1. 以 admin 登录访问 /finance/wallet
    await openFinancePage(page, '/finance/wallet')

    // 卡片标题、经销商下拉占位与查询按钮
    await expect(page.locator('main .ant-card-head-title')).toHaveText('钱包')
    await expect(page.locator('main .ant-select')).toHaveCount(1)
    await expect(
      page.locator('main .ant-select .ant-select-placeholder'),
    ).toHaveText('选择经销商')
    await expect(
      page.getByRole('button', { name: /查\s*询/ }),
    ).toBeVisible()

    // 表格列：钱包编号、经销商、币种、余额、最近交易、操作
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '钱包编号',
      '经销商',
      '币种',
      '余额',
      '最近交易',
      '操作',
    ])

    // 余额为 USD n.nn，每行操作列有「变动明细」
    const walletRows = tableRows(page)
    await expect(walletRows.first()).toBeVisible({ timeout: 45_000 })
    const count = await walletRows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const row = walletRows.nth(i)
      await expect(cell(row, 3)).toHaveText('USD')
      await expect(cell(row, 4)).toHaveText(/^USD \d+\.\d{2}$/)
      await expect(
        cell(row, 6).getByRole('button', { name: '变动明细' }),
      ).toBeVisible()
    }
  })

  test('1.2 经销商只能查看自己的钱包且无筛选', async ({ browser }) => {
    const context = await contextFor(browser, dealerState)
    const dealerPage = await context.newPage()
    try {
      // 1. 以 dealer 登录访问 /finance/wallet
      await openFinancePage(dealerPage, '/finance/wallet')
      const current = await getMe(dealerPage)
      const dealerName = current.user.realname || current.user.name

      // 不显示经销商筛选下拉与查询按钮
      await expect(dealerPage.locator('main .ant-select')).toHaveCount(0)
      await expect(
        dealerPage.getByRole('button', { name: /查\s*询/ }),
      ).toHaveCount(0)

      // 表格仅包含当前经销商的钱包，币种为 USD
      const walletRows = tableRows(dealerPage)
      await expect(walletRows.first()).toBeVisible({ timeout: 45_000 })
      const count = await walletRows.count()
      expect(count).toBeGreaterThan(0)
      for (let i = 0; i < count; i++) {
        const row = walletRows.nth(i)
        await expect(cell(row, 2)).toHaveText(dealerName)
        await expect(cell(row, 3)).toHaveText('USD')
        await expect(cell(row, 4)).toHaveText(/^USD \d+\.\d{2}$/)
      }
    } finally {
      await context.close()
    }
  })

  test('1.3 变动明细跳转并预选经销商', async ({ page }) => {
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const label = `${dealerName} (${dealer.email})`

    // 1. 在钱包中定位 dealer 行，点击「变动明细」
    await openFinancePage(page, '/finance/wallet')
    const row = tableRows(page).filter({ hasText: dealerName }).first()
    await expect(row).toBeVisible({ timeout: 45_000 })
    await row.getByRole('button', { name: '变动明细' }).click()

    // URL 为 /finance/trade-log?userId=<dealerId>
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/finance/trade-log' &&
        url.searchParams.get('userId') === dealer.id,
    )
    await waitForAppReady(page)
    await waitForListSettled(page)

    // 账户变动页经销商下拉已预选该经销商
    const selected = page
      .locator('main .ant-select .ant-select-content')
      .first()
    await expect(selected).toHaveAttribute('title', label)

    // 流水列表只显示该经销商记录
    const logs = tableRows(page)
    const count = await logs.count()
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(cell(logs.nth(i), 2)).toHaveText(dealerName)
      }
    } else {
      await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    }
  })

  test('1.4 钱包空态与加载态', async ({ page }) => {
    // 1. 选择无钱包数据的经销商（mock 返回空数组）
    await openFinancePage(page, '/finance/wallet')
    await page.route('**/api/finance/wallet/list*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
    })
    const emptyResponse = listResponse(page, '/api/finance/wallet/list')
    await page.getByRole('button', { name: /查\s*询/ }).click()
    await emptyResponse

    // 表格显示「暂无数据」，页面不报错
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(
      page.locator('.ant-message-notice-title').filter({ hasText: /失败|错误/ }),
    ).toHaveCount(0)

    // 2. 刷新页面观察加载：延迟 mock 以观察加载遮罩出现与消失
    await page.unroute('**/api/finance/wallet/list*')
    await page.route('**/api/finance/wallet/list*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
    })
    await page.reload()
    await expect(page.locator('main .ant-spin-spinning')).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('main .ant-spin-spinning')).toHaveCount(0, {
      timeout: 30_000,
    })
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
  })

  test('1.5 账户变动列表结构与方向筛选', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const balance = Number((await walletFor(page, dealer.id)).balance)
    if (balance < 0.02) {
      test.skip(true, '经销商余额不足 0.02，无法准备收支流水')
      return
    }

    // 准备本次测试的收入与支出流水（仅操作新建测试单据）
    const income = await createRechargeApi(
      page,
      dealer.id,
      0.01,
      `pw-fin-income-${stamp()}`,
    )
    expect(
      (await verifyRechargeApi(page, income.rechargeNumber, true)).status,
    ).toBe(200)
    const expense = await createDeductionApi(
      page,
      dealer.id,
      0.01,
      `pw-fin-expense-${stamp()}`,
    )
    expect(
      (await verifyDeductionApi(page, expense.deductionNumber, true)).status,
    ).toBe(200)

    // 1. 以 admin 访问 /finance/trade-log
    await openFinancePage(page, '/finance/trade-log')

    // 卡片标题、筛选区与列结构
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '账户变动',
    )
    await expect(page.locator('main .ant-select')).toHaveCount(2)
    await expect(
      page.locator('main .ant-select').nth(0).locator('.ant-select-placeholder'),
    ).toHaveText('选择经销商')
    await expect(
      page.locator('main .ant-select').nth(1).locator('.ant-select-placeholder'),
    ).toHaveText('方向')
    await expect(
      page.getByRole('button', { name: /查\s*询/ }),
    ).toBeVisible()
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '流水号',
      '用户',
      '方向',
      '币种',
      '原币金额',
      '折算 USD',
      '余额(USD)',
      '关联单号',
      '说明',
      '时间',
    ])
    await expect(page.getByRole('button', { name: '导出' })).toHaveCount(0)
    await expect(page.locator('main .ant-picker')).toHaveCount(0)

    // 2. 选择方向「收入」并查询
    await pickFilterOption(
      page,
      1,
      '收入',
      '/api/finance/trade/log',
      'direction=in',
    )
    await expect(page.locator('.ant-pagination-item-active')).toHaveText('1')
    const incomeTexts = await tableRows(page)
      .locator('td:nth-child(3)')
      .allTextContents()
    expect(incomeTexts.length).toBeGreaterThan(0)
    for (const text of incomeTexts) {
      expect(text).toContain('收入')
    }

    // 3. 选择方向「支出」并查询
    await pickFilterOption(
      page,
      1,
      '支出',
      '/api/finance/trade/log',
      'direction=out',
    )
    const expenseTexts = await tableRows(page)
      .locator('td:nth-child(3)')
      .allTextContents()
    expect(expenseTexts.length).toBeGreaterThan(0)
    for (const text of expenseTexts) {
      expect(text).toContain('支出')
    }

    // 4. 清除方向：收入与支出均可能出现
    const select = page.locator('main .ant-select').nth(1)
    await select.hover()
    const clearResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/finance/trade/log') &&
        r.request().method() === 'GET' &&
        !r.url().includes('direction='),
      { timeout: SLOW },
    )
    await select.locator('.ant-select-clear').click()
    await clearResponse
    await expect(
      page.locator('main .ant-select').nth(1).locator('.ant-select-placeholder'),
    ).toHaveText('方向')
    const cleared = await tableRows(page)
      .locator('td:nth-child(3)')
      .allTextContents()
    expect(cleared.some((text) => text.includes('收入'))).toBeTruthy()
    expect(cleared.some((text) => text.includes('支出'))).toBeTruthy()
  })

  test('1.6 账户变动分页与无结果', async ({ page }) => {
    await openFinancePage(page, '/finance/trade-log')

    // 1. 当流水超过 20 条时切到第 2 页
    const total = (await tradeLogPage(page)).total
    if (total > 20) {
      const pager2 = page.locator('.ant-pagination-item-2')
      await expect(pager2).toBeVisible({ timeout: 30_000 })
      const request2 = page.waitForRequest(
        (r) =>
          r.url().includes('/api/finance/trade/log') &&
          /[?&]page=2(&|$)/.test(r.url()),
      )
      await pager2.click()
      const request = await request2

      // 请求 page=2&pageSize=20，每页最多 20 条，页码 2 高亮
      expect(request.url()).toContain('pageSize=20')
      await expect(page.locator('.ant-pagination-item-active')).toHaveText('2')
      await expect(tableRows(page).first()).toBeVisible({ timeout: 45_000 })
      const count = await tableRows(page).count()
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(20)
    } else {
      test.info().annotations.push({
        type: 'coverage',
        description: '当前环境流水不超过 20 条，未执行第 2 页分页断言',
      })
    }

    // 2. 选择一个无流水的经销商（mock 空结果）
    await page.route('**/api/finance/trade/log*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }),
      })
    })
    const dealer = await needDealer(page)
    await pickDealerInFilter(page, dealer, '/api/finance/trade/log', 0)

    // 显示「暂无数据」，页面无报错
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)
    await expect(
      page.locator('.ant-message-notice-title').filter({ hasText: /失败|错误/ }),
    ).toHaveCount(0)
  })

  test('1.7 经销商财务权限边界', async ({ browser }) => {
    test.setTimeout(300_000)
    const context = await contextFor(browser, dealerState)
    const dealerPage = await context.newPage()
    try {
      const current = await getMe(dealerPage)
      const dealerName = current.user.realname || current.user.name

      // 1. 以 dealer 访问 /finance/trade-log：只看自己的流水，无经销商筛选
      await openFinancePage(dealerPage, '/finance/trade-log')
      await expect(
        dealerPage.locator('main .ant-card-head-title'),
      ).toHaveText('账户变动')
      await expect(dealerPage.locator('main .ant-select')).toHaveCount(1)
      await expect(
        dealerPage
          .locator('main .ant-select .ant-select-placeholder')
          .first(),
      ).toHaveText('方向')
      await expect(
        dealerPage.getByRole('button', { name: /查\s*询/ }),
      ).toBeVisible()
      const logs = tableRows(dealerPage)
      const count = await logs.count()
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          await expect(cell(logs.nth(i), 2)).toHaveText(dealerName)
        }
      } else {
        await expect(dealerPage.locator('main .ant-empty')).toContainText(
          '暂无数据',
        )
      }

      // 2. 以 dealer 直接访问 /finance/recharge
      await dealerPage.goto('/finance/recharge')
      await expect(
        message(dealerPage, 'Insufficient permission'),
      ).toBeVisible({ timeout: 60_000 })
      await waitForAppReady(dealerPage)
      await waitForListSettled(dealerPage)
      await expectMenuVisible(dealerPage, ['充值审核'], false)
      await expect(
        dealerPage.locator('main .ant-card-head-title'),
      ).toHaveText('充值审核')
      await expect(
        dealerPage.getByRole('button', { name: '新增充值' }),
      ).toHaveCount(0)
      await expect(dealerPage.locator('main .ant-empty')).toContainText(
        '暂无数据',
      )
      await expect(dealerPage.locator('main .ant-table-tbody button')).toHaveCount(
        0,
      )

      // 3. 以 dealer 直接访问 /finance/deduction
      await dealerPage.goto('/finance/deduction')
      await expect(
        message(dealerPage, 'Insufficient permission'),
      ).toBeVisible({ timeout: 60_000 })
      await waitForAppReady(dealerPage)
      await waitForListSettled(dealerPage)
      await expectMenuVisible(dealerPage, ['扣费审核'], false)
      await expect(
        dealerPage.locator('main .ant-card-head-title'),
      ).toHaveText('扣费审核')
      await expect(
        dealerPage.getByRole('button', { name: '新增扣费' }),
      ).toHaveCount(0)
      await expect(dealerPage.locator('main .ant-empty')).toContainText(
        '暂无数据',
      )
      await expect(dealerPage.locator('main .ant-table-tbody button')).toHaveCount(
        0,
      )
    } finally {
      await context.close()
    }
  })
})

test.describe('2. 充值审核', () => {
  test.use({ storageState: opsState })

  test('2.1 充值列表结构与筛选', async ({ page, browser }) => {
    test.setTimeout(TEST_TIMEOUT)
    const dealer = await needDealer(page)
    const pendingRemark = `pw-fin-list-pending-${stamp()}`
    const approvedRemark = `pw-fin-list-approved-${stamp()}`
    await createRechargeApi(page, dealer.id, 0.01, pendingRemark)
    const approved = await createRechargeApi(
      page,
      dealer.id,
      0.01,
      approvedRemark,
    )
    const adminContext = await contextFor(browser, adminState)
    try {
      const adminPage = await adminContext.newPage()
      expect(
        (await verifyRechargeApi(adminPage, approved.rechargeNumber, true))
          .status,
      ).toBe(200)
    } finally {
      await adminContext.close()
    }

    // 1. 以 ops 访问 /finance/recharge
    await openFinancePage(page, '/finance/recharge')

    // 卡片标题、新增按钮、筛选区与查询按钮
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '充值审核',
    )
    await expect(
      page.getByRole('button', { name: '新增充值' }),
    ).toBeVisible()
    await expect(page.locator('main .ant-select')).toHaveCount(2)
    await expect(
      page.locator('main .ant-select').nth(0).locator('.ant-select-placeholder'),
    ).toHaveText('选择经销商')
    await expect(
      page.locator('main .ant-select').nth(1).locator('.ant-select-placeholder'),
    ).toHaveText('审核状态')
    await expect(
      page.getByRole('button', { name: /查\s*询/ }),
    ).toBeVisible()

    // 表格列
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '单号',
      '经销商',
      '币种',
      '原币金额',
      '折算 USD',
      '备注',
      '提交人',
      '状态',
      '审核人',
      '审核时间',
      '提交时间',
      '操作',
    ])

    // 待审核行显示「审 核」，已审核行操作列为「—」
    const pendingRow = await findRow(
      page,
      '/api/finance/recharge/list',
      pendingRemark,
    )
    await expect(cell(pendingRow, 8)).toContainText('待审核')
    await expect(
      pendingRow.getByRole('button', { name: /审\s*核/ }),
    ).toBeVisible()
    const approvedRow = await findRow(
      page,
      '/api/finance/recharge/list',
      approvedRemark,
    )
    await expect(cell(approvedRow, 8)).toContainText('已通过')
    await expect(cell(approvedRow, 12)).toHaveText('—')
  })

  test('2.2 新增充值必填校验', async ({ page }) => {
    const dealer = await needDealer(page)
    await openFinancePage(page, '/finance/recharge')
    await page.getByRole('button', { name: '新增充值' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新增充值' })
    await expect(modal).toBeVisible()

    // 1. 直接点击「确 定」：提示请选择经销商/请输入金额，弹窗不关闭
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(modal.getByText('请选择经销商')).toBeVisible()
    await expect(modal.getByText('请输入金额')).toBeVisible()
    await expect(modal).toBeVisible()

    // 2. InputNumber 最小值 0.01；负数失焦后被校正
    const amount = modal.locator('.ant-input-number-input').first()
    await expect(amount).toHaveAttribute('aria-valuemin', '0.01')
    await amount.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('-5', { delay: 20 })
    await page.keyboard.press('Tab')
    await expect(amount).toHaveValue('0.01')

    // 若绕过前端直接提交 <=0，服务端报「金额必须大于 0」
    for (const value of [0, -1]) {
      const response = await page.request.post('/api/finance/recharge', {
        data: {
          userId: dealer.id,
          amount: value,
          currencyCode: 'USD',
          remark: `pw-fin-invalid-${stamp()}`,
        },
      })
      expect(response.status()).toBe(400)
      expect(bodyMessage(await response.json())).toBe('金额必须大于 0')
    }

    await modal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(modal).toBeHidden()
  })

  test('2.3 新增充值成功进入待审核', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT)
    const dealer = await needDealer(page)
    const current = await getMe(page)
    const remark = `pw-fin-recharge-${stamp()}`

    // 1. 选择 dealer、币种 USD、金额 10、备注，点击「确 定」
    await openFinancePage(page, '/finance/recharge')
    await page.getByRole('button', { name: '新增充值' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新增充值' })
    await expect(modal).toBeVisible()
    await pickDealerInModal(page, modal, dealer)
    await expect(
      modal.locator('.ant-select').nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', 'USD — 美元')
    await fillAmount(page, modal, 10)
    await modal.locator('textarea').first().fill(remark)
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/finance/recharge') &&
        r.request().method() === 'POST',
    )
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    expect((await response).status()).toBe(201)

    // 出现「已提交，等待审核」，弹窗关闭，列表刷新
    await expect(message(page, '已提交，等待审核')).toBeVisible()
    await expect(modal).toBeHidden()

    // 新记录状态「待审核」，原币与折算金额、提交人正确
    const row = await findRow(page, '/api/finance/recharge/list', remark)
    await expect(cell(row, 8)).toContainText('待审核')
    await expect(cell(row, 4)).toHaveText('USD 10.00')
    await expect(cell(row, 5)).toHaveText('USD 10.00')
    await expect(cell(row, 7)).toHaveText(
      current.user.realname || current.user.name,
    )
  })

  test('2.4 审核弹窗先取消不改变数据', async ({ page, browser }) => {
    test.setTimeout(TEST_TIMEOUT)
    const current = await getMe(page)
    const remark = `pw-fin-cancel-${stamp()}`
    await createRecharge(page, 10, remark)
    const record = await rechargeByRemark(page, remark)

    // 非超管不能自审：由 admin 打开审核弹窗并取消。
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/recharge')

      // 1. 对新建待审核充值点击「审 核」，检查弹窗后点击「取 消」
      const modal = await openAuditModal(
        adminPage,
        '/api/finance/recharge/list',
        remark,
        '审核充值',
      )
      await expect(modal).toContainText(`经销商：${record.userName}`)
      await expect(modal).toContainText('原币：USD 10.00')
      await expect(modal).toContainText('入账 USD：USD 10.00')
      await expect(modal).toContainText(
        `提交人：${current.user.realname || current.user.name}`,
      )
      await expect(modal).toContainText(`备注：${remark}`)
      await expect(modal.getByRole('radio', { name: '通过' })).toBeChecked()
      await modal.getByRole('button', { name: /取\s*消/ }).click()
      await expect(modal).toBeHidden()
    } finally {
      await adminContext.close()
    }

    // 该单仍为「待审核」且仍显示「审 核」
    const after = await findRow(page, '/api/finance/recharge/list', remark)
    await expect(cell(after, 8)).toContainText('待审核')
    await expect(after.getByRole('button', { name: /审\s*核/ })).toBeVisible()
  })

  test('2.5 审核通过后余额与流水正确', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const remark = `pw-fin-approve-${stamp()}`

    // 1. 记录余额 B；由 ops 新建充值 10 USD，再由 admin 审核通过
    await createRecharge(page, 10, remark)
    const record = await rechargeByRemark(page, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    const expected = money2(balanceBefore + 10)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/recharge')
      await auditRowByRemark(adminPage, remark, true)
      const audited = await findRow(
        adminPage,
        '/api/finance/recharge/list',
        remark,
      )
      await expect(cell(audited, 8)).toContainText('已通过')
      await expect(cell(audited, 9)).not.toHaveText('—')
      await expect(cell(audited, 10)).not.toHaveText('—')
      await expect(cell(audited, 12)).toHaveText('—')
    } finally {
      await adminContext.close()
    }

    // 2. 钱包余额为 B + 10.00
    await openFinancePage(page, '/finance/wallet')
    await pickDealerInFilter(page, dealer, '/api/finance/wallet/list', 0)
    const walletRow = await findRow(
      page,
      '/api/finance/wallet/list',
      dealerName,
    )
    await expect(cell(walletRow, 4)).toHaveText(formatMoney(expected))
    await expect(cell(walletRow, 5)).not.toHaveText('—')

    // 3. 账户变动新增收入流水，金额与关联单号正确
    await openFinancePage(page, '/finance/trade-log')
    await pickDealerInFilter(page, dealer, '/api/finance/trade/log', 0)
    const logRow = await findRow(
      page,
      '/api/finance/trade/log',
      record.rechargeNumber,
    )
    await expect(cell(logRow, 3)).toContainText('收入')
    await expect(cell(logRow, 5)).toHaveText('USD 10.00')
    await expect(cell(logRow, 6)).toHaveText('USD 10.00')
    await expect(cell(logRow, 7)).toHaveText(formatMoney(expected))
    await expect(cell(logRow, 8)).toHaveText(record.rechargeNumber)
    await expect(cell(logRow, 9)).toContainText('人工充值入账')
  })

  test('2.6 审核拒绝不影响余额', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const remark = `pw-fin-reject-${stamp()}`
    const rejectRemark = `pw-reject-${stamp()}`

    // 1. 记录余额 B；新建充值 5 USD，admin 拒绝并填写审核备注
    await createRecharge(page, 5, remark)
    const record = await rechargeByRemark(page, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/recharge')
      const modal = await openAuditModal(
        adminPage,
        '/api/finance/recharge/list',
        remark,
        '审核充值',
      )
      await modal.getByText('拒绝', { exact: true }).click()
      await modal.locator('textarea').fill(rejectRemark)
      const response = adminPage.waitForResponse(
        (r) =>
          r.url().includes('/api/finance/recharge/verify') &&
          r.request().method() === 'PUT',
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      expect((await response).status()).toBe(200)
      await expect(message(adminPage, '审核完成')).toBeVisible()
      const rejected = await findRow(
        adminPage,
        '/api/finance/recharge/list',
        remark,
      )
      await expect(cell(rejected, 8)).toContainText('已拒绝')
    } finally {
      await adminContext.close()
    }

    // 审核备注在接口中可查
    const updated = await rechargeByRemark(page, remark)
    expect(updated.isVerify).toBe(2)
    expect(updated.verifyRemark).toBe(rejectRemark)

    // 2. 余额仍为 B，没有新增对应收入流水
    const walletRecord = await walletFor(page, dealer.id)
    expect(money2(Number(walletRecord.balance))).toBe(money2(balanceBefore))
    const logs = await tradeLogPage(page, dealer.id)
    expect(
      logs.items.some((item) => item.orderNumber === record.rechargeNumber),
    ).toBeFalsy()

    await openFinancePage(page, '/finance/wallet')
    await pickDealerInFilter(page, dealer, '/api/finance/wallet/list', 0)
    const walletRow = await findRow(
      page,
      '/api/finance/wallet/list',
      dealerName,
    )
    await expect(cell(walletRow, 4)).toHaveText(formatMoney(balanceBefore))

    await openFinancePage(page, '/finance/trade-log')
    await pickDealerInFilter(page, dealer, '/api/finance/trade/log', 0)
    await clickQuery(page, '/api/finance/trade/log')
    await expect(
      tableRows(page).filter({ hasText: record.rechargeNumber }),
    ).toHaveCount(0)
  })

  test('2.7 非超管不能审核自己提交的充值单', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const remark = `pw-fin-self-${stamp()}`
    await createRecharge(page, 1, remark)
    const record = await rechargeByRemark(page, remark)

    // 1. 找到自己提交的待审核记录，审核按钮 disabled
    const row = await findRow(page, '/api/finance/recharge/list', remark)
    await expect(cell(row, 8)).toContainText('待审核')
    await expect(row.getByRole('button', { name: /审\s*核/ })).toBeDisabled()

    // 2. 通过接口直接审核：403「不能审核自己提交的充值单」，单据仍待审核
    const forbidden = await verifyRechargeApi(page, record.rechargeNumber, true)
    expect(forbidden.status).toBe(403)
    expect(forbidden.message).toBe('不能审核自己提交的充值单')
    expect((await rechargeByRemark(page, remark)).isVerify).toBe(0)

    // 3. 以 admin（超管）审核同一单据
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/recharge')
      const adminRow = await findRow(
        adminPage,
        '/api/finance/recharge/list',
        remark,
      )
      await expect(
        adminRow.getByRole('button', { name: /审\s*核/ }),
      ).toBeEnabled()
      await auditRowByRemark(adminPage, remark, true)
      const approved = await findRow(
        adminPage,
        '/api/finance/recharge/list',
        remark,
      )
      await expect(cell(approved, 8)).toContainText('已通过')
    } finally {
      await adminContext.close()
    }
  })

  test('2.8 已审核单据不可重复审核', async ({ page, browser }) => {
    const dealer = await needDealer(page)
    const remark = `pw-fin-duplicate-${stamp()}`
    const created = await createRechargeApi(page, dealer.id, 1, remark)
    const before = Number((await walletFor(page, dealer.id)).balance)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      // 1. 先通过测试单据，再重复发送审核请求
      const first = await verifyRechargeApi(
        adminPage,
        created.rechargeNumber,
        true,
      )
      expect(first.status).toBe(200)
      const afterFirst = Number((await walletFor(page, dealer.id)).balance)
      expect(money2(afterFirst)).toBe(money2(before + 1))
      const second = await verifyRechargeApi(
        adminPage,
        created.rechargeNumber,
        true,
      )

      // 2. 返回 400「该单已审核」，余额不重复变动
      expect(second.status).toBe(400)
      expect(second.message).toBe('该单已审核')
      const afterSecond = Number((await walletFor(page, dealer.id)).balance)
      expect(money2(afterSecond)).toBe(money2(afterFirst))
    } finally {
      await adminContext.close()
    }
  })

  test('2.9 非 USD 币种按汇率折算入账', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const ratesResponse = await page.request.get('/api/site/exchange-rates', {
      timeout: SLOW,
    })
    expect(ratesResponse.ok()).toBeTruthy()
    const config = (await ratesResponse.json()) as ExchangeRatesConfig
    const usdRate =
      config.rates.find((item) => item.currencyCode === 'USD')?.rateToBase ?? 1
    const eurRate = config.rates.find(
      (item) => item.currencyCode === 'EUR',
    )?.rateToBase
    if (!eurRate) {
      test.skip(true, '当前环境未配置 EUR 汇率，无法验证折算')
      return
    }
    const expectedBase =
      Math.round(((10 * eurRate) / usdRate + Number.EPSILON) * 100) / 100
    const remark = `pw-fin-eur-${stamp()}`

    // 1. 新建 EUR 10 的充值并审核通过
    await openFinancePage(page, '/finance/recharge')
    await page.getByRole('button', { name: '新增充值' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新增充值' })
    await expect(modal).toBeVisible()
    await pickDealerInModal(page, modal, dealer)
    await pickCurrencyInModal(page, modal, 'EUR')
    await expect(
      modal.locator('.ant-select').nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', 'EUR — 欧元')
    await fillAmount(page, modal, 10)
    await modal.locator('textarea').first().fill(remark)
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(message(page, '已提交，等待审核')).toBeVisible()

    // 列表原币金额为 EUR 10.00，折算 USD 等于当前汇率换算结果
    const record = await rechargeByRemark(page, remark)
    expect(record.currencyCode).toBe('EUR')
    expect(Number(record.amount)).toBe(10)
    expect(Number(record.amountBase)).toBeCloseTo(expectedBase, 2)
    const row = await findRow(page, '/api/finance/recharge/list', remark)
    await expect(cell(row, 3)).toHaveText('EUR')
    await expect(cell(row, 4)).toHaveText('EUR 10.00')
    await expect(cell(row, 5)).toHaveText(formatMoney(expectedBase))

    // 钱包余额增加对应 USD 金额
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/recharge')
      await auditRowByRemark(adminPage, remark, true)
    } finally {
      await adminContext.close()
    }
    const balanceAfter = Number((await walletFor(page, dealer.id)).balance)
    expect(money2(balanceAfter)).toBe(money2(balanceBefore + expectedBase))

    // 2. 在隔离环境模拟缺少 EUR 汇率：仅 mock 接口，不修改真实汇率配置
    const missingRemark = `pw-fin-eur-missing-${stamp()}`
    await page.route('**/api/finance/recharge', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '缺少 EUR 相对 USD 的汇率',
          error: 'Bad Request',
          statusCode: 400,
        }),
      })
    })
    await openFinancePage(page, '/finance/recharge')
    await page.getByRole('button', { name: '新增充值' }).click()
    const missingModal = page
      .locator('.ant-modal')
      .filter({ hasText: '新增充值' })
    await expect(missingModal).toBeVisible()
    await pickDealerInModal(page, missingModal, dealer)
    await pickCurrencyInModal(page, missingModal, 'EUR')
    await fillAmount(page, missingModal, 10)
    await missingModal.locator('textarea').first().fill(missingRemark)
    await missingModal.getByRole('button', { name: /确\s*定/ }).click()

    // 提交报错「缺少汇率」，弹窗保持打开，不产生充值单
    await expect(
      message(page, '缺少 EUR 相对 USD 的汇率'),
    ).toBeVisible()
    await expect(missingModal).toBeVisible()
    const all = await rechargePage(page)
    expect(all.items.some((item) => item.remark === missingRemark)).toBeFalsy()
    await missingModal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(missingModal).toBeHidden()
    await page.unroute('**/api/finance/recharge')
  })

  test('2.10 充值筛选与分页', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const pendingRemark = `pw-fin-filter-pending-${stamp()}`
    const approvedRemark = `pw-fin-filter-approved-${stamp()}`
    await createRechargeApi(page, dealer.id, 0.5, pendingRemark)
    const approved = await createRechargeApi(
      page,
      dealer.id,
      0.5,
      approvedRemark,
    )
    const adminContext = await contextFor(browser, adminState)
    try {
      const adminPage = await adminContext.newPage()
      expect(
        (await verifyRechargeApi(adminPage, approved.rechargeNumber, true))
          .status,
      ).toBe(200)
    } finally {
      await adminContext.close()
    }

    // 1. 按审核状态「待审核」查询
    await openFinancePage(page, '/finance/recharge')
    await pickFilterOption(
      page,
      1,
      '待审核',
      '/api/finance/recharge/list',
      'isVerify=0',
    )
    await expect(page.locator('.ant-pagination-item-active')).toHaveText('1')
    const pendingTexts = await tableRows(page)
      .locator('td:nth-child(8)')
      .allTextContents()
    expect(pendingTexts.length).toBeGreaterThan(0)
    for (const text of pendingTexts) {
      expect(text).toContain('待审核')
    }
    await expect(
      tableRows(page).filter({ hasText: pendingRemark }),
    ).toHaveCount(1)

    // 2. 按经销商 + 已通过组合查询
    await pickDealerInFilter(page, dealer, '/api/finance/recharge/list', 0)
    await pickFilterOption(
      page,
      1,
      '已通过',
      '/api/finance/recharge/list',
      'isVerify=1',
    )
    const comboRows = tableRows(page)
    await expect(comboRows.first()).toBeVisible({ timeout: 45_000 })
    const comboCount = await comboRows.count()
    expect(comboCount).toBeGreaterThan(0)
    for (let i = 0; i < comboCount; i++) {
      await expect(cell(comboRows.nth(i), 2)).toHaveText(dealerName)
      await expect(cell(comboRows.nth(i), 8)).toContainText('已通过')
    }
    await expect(
      comboRows.filter({ hasText: approvedRemark }),
    ).toHaveCount(1)

    // 3. 清除筛选后，超过 20 条时翻页
    await clearFilter(page, 1, '/api/finance/recharge/list')
    await clearFilter(page, 0, '/api/finance/recharge/list')
    const total = (await rechargePage(page)).total
    if (total > 20) {
      const pager2 = page.locator('.ant-pagination-item-2')
      await expect(pager2).toBeVisible({ timeout: 30_000 })
      const request2 = page.waitForRequest(
        (r) =>
          r.url().includes('/api/finance/recharge/list') &&
          /[?&]page=2(&|$)/.test(r.url()),
      )
      await pager2.click()
      expect((await request2).url()).toContain('pageSize=20')
      await expect(page.locator('.ant-pagination-item-active')).toHaveText('2')
      await expect(tableRows(page).first()).toBeVisible({ timeout: 45_000 })
      const count = await tableRows(page).count()
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(20)
    } else {
      test.info().annotations.push({
        type: 'coverage',
        description: '当前环境充值单不超过 20 条，未执行第 2 页分页断言',
      })
    }
  })
})

test.describe('3. 扣费审核', () => {
  test.use({ storageState: opsState })

  test('3.1 扣费列表结构与关联订单', async ({ page }) => {
    const dealer = await needDealer(page)
    const remark = `pw-ded-structure-${stamp()}`
    await createDeductionApi(page, dealer.id, 0.5, remark)

    // 1. 以 ops 访问 /finance/deduction
    await openFinancePage(page, '/finance/deduction')

    // 卡片标题、新增按钮、仅经销商筛选与查询按钮
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '扣费审核',
    )
    await expect(
      page.getByRole('button', { name: '新增扣费' }),
    ).toBeVisible()
    await expect(page.locator('main .ant-select')).toHaveCount(1)
    await expect(
      page.locator('main .ant-select .ant-select-placeholder'),
    ).toHaveText('选择经销商')
    await expect(page.getByText('审核状态')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /查\s*询/ }),
    ).toBeVisible()

    // 表格列
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '单号',
      '经销商',
      '币种',
      '原币金额',
      '折算 USD',
      '关联订单',
      '备注',
      '提交人',
      '状态',
      '审核人',
      '时间',
      '操作',
    ])

    // 由订单生成的扣费单「关联订单」为可点击订单号
    const orderLinks = page.locator(
      'main .ant-table-tbody a[href^="/goods/history/"]',
    )
    if ((await orderLinks.count()) > 0) {
      const link = orderLinks.first()
      await expect(link).toHaveText(/^GO/)
      await expect(link).toHaveAttribute('href', /^\/goods\/history\/\d+$/)
      await expect(link).toHaveAttribute('target', '_blank')
    }

    // 新建测试单据为待审核，操作列显示「审 核」
    const row = await findRow(page, '/api/finance/deduction/list', remark)
    await expect(cell(row, 9)).toContainText('待审核')
    await expect(
      row.getByRole('button', { name: /审\s*核/ }),
    ).toBeVisible()
  })

  test('3.2 新增扣费必填校验与成功进入待审核', async ({ page }) => {
    const dealer = await needDealer(page)
    await openFinancePage(page, '/finance/deduction')

    // 1. 点击「新增扣费」，不填直接确定
    await page.getByRole('button', { name: '新增扣费' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新增扣费' })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(modal.getByText('请选择经销商')).toBeVisible()
    await expect(modal.getByText('请输入金额')).toBeVisible()

    // 2. 选择 dealer、USD、金额 3.50、备注，确定
    const remark = `pw-ded-${stamp()}`
    await pickDealerInModal(page, modal, dealer)
    await expect(
      modal.locator('.ant-select').nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', 'USD — 美元')
    await fillAmount(page, modal, 3.5)
    await modal.locator('textarea').first().fill(remark)
    await modal.getByRole('button', { name: /确\s*定/ }).click()

    // 提示已提交，新记录待审核，操作列显示审核
    await expect(message(page, '已提交，等待审核')).toBeVisible()
    await expect(modal).toBeHidden()
    const row = await findRow(page, '/api/finance/deduction/list', remark)
    await expect(cell(row, 9)).toContainText('待审核')
    await expect(cell(row, 4)).toHaveText('USD 3.50')
    await expect(cell(row, 5)).toHaveText('USD 3.50')
    await expect(
      row.getByRole('button', { name: /审\s*核/ }),
    ).toBeVisible()
  })

  test('3.3 审核通过扣减余额并写支出流水', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const remark = `pw-ded-approve-${stamp()}`

    // 1. 记录余额 B；由 ops 新建扣费 3.50 USD，admin 审核通过
    await createDeduction(page, 3.5, remark)
    const record = await deductionByRemark(page, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    if (balanceBefore < 3.5) {
      test.skip(true, '经销商余额不足 3.50，无法验证扣费通过')
      return
    }
    const expected = money2(balanceBefore - 3.5)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/deduction')
      await auditRowByRemark(adminPage, remark, true)
      const audited = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        remark,
      )
      await expect(cell(audited, 9)).toContainText('已通过')
      await expect(cell(audited, 10)).not.toHaveText('—')
    } finally {
      await adminContext.close()
    }

    // 2. 钱包余额为 B - 3.50
    await openFinancePage(page, '/finance/wallet')
    await pickDealerInFilter(page, dealer, '/api/finance/wallet/list', 0)
    const walletRow = await findRow(
      page,
      '/api/finance/wallet/list',
      dealerName,
    )
    await expect(cell(walletRow, 4)).toHaveText(formatMoney(expected))

    // 3. 账户变动新增「支出」流水，关联扣费单号
    await openFinancePage(page, '/finance/trade-log')
    await pickDealerInFilter(page, dealer, '/api/finance/trade/log', 0)
    const logRow = await findRow(
      page,
      '/api/finance/trade/log',
      record.deductionNumber,
    )
    await expect(cell(logRow, 3)).toContainText('支出')
    await expect(cell(logRow, 5)).toHaveText('USD 3.50')
    await expect(cell(logRow, 6)).toHaveText('USD 3.50')
    await expect(cell(logRow, 7)).toHaveText(formatMoney(expected))
    await expect(cell(logRow, 8)).toHaveText(record.deductionNumber)
    await expect(cell(logRow, 9)).toContainText('扣费出账')
  })

  test('3.4 余额不足时扣费审核失败', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const remark = `pw-ded-nofunds-${stamp()}`

    // 1. 新建远大于余额的测试扣费，admin 审核通过
    await createDeduction(page, 999999, remark)
    const record = await deductionByRemark(page, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/deduction')
      const modal = await openAuditModal(
        adminPage,
        '/api/finance/deduction/list',
        remark,
        '审核扣费',
      )
      await expect(modal.getByRole('radio', { name: '通过' })).toBeChecked()
      const response = adminPage.waitForResponse(
        (r) =>
          r.url().includes('/api/finance/deduction/verify') &&
          r.request().method() === 'PUT',
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      const failed = await response

      // 出现「余额不足」，弹窗保持打开
      expect(failed.status()).toBe(400)
      expect(bodyMessage(await failed.json())).toBe('余额不足')
      await expect(message(adminPage, '余额不足')).toBeVisible()
      await expect(modal).toBeVisible()
      await modal.getByRole('button', { name: /取\s*消/ }).click()
      await expect(modal).toBeHidden()
    } finally {
      await adminContext.close()
    }

    // 状态仍为待审核，钱包余额未变化，无支出流水
    const still = await deductionByRemark(page, remark)
    expect(still.isVerify).toBe(0)
    const walletRecord = await walletFor(page, dealer.id)
    expect(money2(Number(walletRecord.balance))).toBe(money2(balanceBefore))
    const logs = await tradeLogPage(page, dealer.id)
    expect(
      logs.items.some((item) => item.orderNumber === record.deductionNumber),
    ).toBeFalsy()
  })

  test('3.5 审核拒绝不扣款', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const remark = `pw-ded-reject-${stamp()}`
    const rejectRemark = `pw-ded-reject-reason-${stamp()}`

    // 1. 记录余额 B，新建扣费 2 USD，admin 拒绝
    await createDeduction(page, 2, remark)
    const record = await deductionByRemark(page, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      await openFinancePage(adminPage, '/finance/deduction')
      const modal = await openAuditModal(
        adminPage,
        '/api/finance/deduction/list',
        remark,
        '审核扣费',
      )
      await modal.getByText('拒绝', { exact: true }).click()
      await modal.locator('textarea').fill(rejectRemark)
      const response = adminPage.waitForResponse(
        (r) =>
          r.url().includes('/api/finance/deduction/verify') &&
          r.request().method() === 'PUT',
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      expect((await response).status()).toBe(200)
      await expect(message(adminPage, '审核完成')).toBeVisible()
      const rejected = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        remark,
      )
      await expect(cell(rejected, 9)).toContainText('已拒绝')
    } finally {
      await adminContext.close()
    }

    // 2. 状态已拒绝，余额仍为 B，无支出流水，审核备注可查
    const updated = await deductionByRemark(page, remark)
    expect(updated.isVerify).toBe(2)
    expect(updated.verifyRemark).toBe(rejectRemark)
    const walletRecord = await walletFor(page, dealer.id)
    expect(money2(Number(walletRecord.balance))).toBe(money2(balanceBefore))
    const logs = await tradeLogPage(page, dealer.id)
    expect(
      logs.items.some((item) => item.orderNumber === record.deductionNumber),
    ).toBeFalsy()
  })

  test('3.6 非超管不能审核自己的扣费单', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT)
    const dealer = await needDealer(page)
    const remark = `pw-ded-self-${stamp()}`

    // 1. 以 ops 新建扣费，找到自己提交的待审核行，审核按钮 disabled
    await createDeduction(page, 1, remark)
    const record = await deductionByRemark(page, remark)
    const row = await findRow(page, '/api/finance/deduction/list', remark)
    await expect(cell(row, 9)).toContainText('待审核')
    await expect(row.getByRole('button', { name: /审\s*核/ })).toBeDisabled()

    // 2. 直接调用审核接口：403「不能审核自己提交的扣费单」
    const forbidden = await verifyDeductionApi(
      page,
      record.deductionNumber,
      true,
    )
    expect(forbidden.status).toBe(403)
    expect(forbidden.message).toBe('不能审核自己提交的扣费单')
    expect((await deductionByRemark(page, remark)).isVerify).toBe(0)
  })

  test('3.7 订单自动扣费单展示订单明细', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const { order, deduction } = await createOrderDeduction(browser, page)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      // 1. 找到订单生成的待审核扣费单并点击「审 核」
      await openFinancePage(adminPage, '/finance/deduction')
      const row = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        deduction.deductionNumber,
      )
      await expect(cell(row, 9)).toContainText('待审核')
      await expect(
        row.locator(`a[href="/goods/history/${order.id}"]`),
      ).toHaveText(order.orderNumber)
      await row.getByRole('button', { name: /审\s*核/ }).click()
      const modal = adminPage.locator('.ant-modal').filter({ hasText: '审核扣费' })
      await expect(modal).toBeVisible({ timeout: 15_000 })

      // 弹窗标题与经销商、原币、扣减 USD、提交人、备注
      await expect(modal).toContainText('经销商：')
      await expect(modal).toContainText('原币：USD 35.00')
      await expect(modal).toContainText('扣减 USD：USD 35.00')
      await expect(modal).toContainText('提交人：')
      await expect(modal).toContainText(
        `备注：预约订单 ${order.orderNumber} 履约扣费`,
      )

      // 关联订单链接：新标签打开 /goods/history/<orderId>
      const orderLink = modal.locator(`a[href="/goods/history/${order.id}"]`)
      await expect(orderLink).toBeVisible()
      await expect(orderLink).toHaveText(order.orderNumber)
      await expect(orderLink).toHaveAttribute('target', '_blank')
      const [popup] = await Promise.all([
        adminPage.waitForEvent('popup'),
        orderLink.click(),
      ])
      await expect(popup).toHaveURL(
        new RegExp(`/goods/history/${order.id}$`),
      )
      await popup.close()

      // 列出履约数量 > 0 的商品：URL × 数量 @ 单价
      const items = modal.locator('li')
      await expect(items).toHaveCount(2)
      await expect(items.nth(0)).toContainText('× 2 @ USD 10.00')
      await expect(items.nth(1)).toContainText('× 3 @ USD 5.00')

      // 2. 点击「取 消」：弹窗关闭，单据保持待审核
      await modal.getByRole('button', { name: /取\s*消/ }).click()
      await expect(modal).toBeHidden()
      const after = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        deduction.deductionNumber,
      )
      await expect(cell(after, 9)).toContainText('待审核')
    } finally {
      await adminContext.close()
    }
  })

  test('3.8 订单扣费单审核通过', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const { order, deduction } = await createOrderDeduction(browser, page)
    const amount = Number(deduction.amountBase)
    const balanceBefore = Number((await walletFor(page, deduction.userId)).balance)
    if (balanceBefore < amount) {
      test.skip(true, `经销商余额 ${balanceBefore} 不足以通过订单扣费 ${amount}`)
      return
    }
    const expected = money2(balanceBefore - amount)
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      // 1. 由 admin 通过该订单扣费单
      await openFinancePage(adminPage, '/finance/deduction')
      const row = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        deduction.deductionNumber,
      )
      await expect(
        row.locator(`a[href="/goods/history/${order.id}"]`),
      ).toHaveText(order.orderNumber)
      await row.getByRole('button', { name: /审\s*核/ }).click()
      const modal = adminPage.locator('.ant-modal').filter({ hasText: '审核扣费' })
      await expect(modal).toBeVisible({ timeout: 15_000 })
      await expect(modal.getByRole('radio', { name: '通过' })).toBeChecked()
      const response = adminPage.waitForResponse(
        (r) =>
          r.url().includes('/api/finance/deduction/verify') &&
          r.request().method() === 'PUT',
      )
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      expect((await response).status()).toBe(200)
      await expect(message(adminPage, '审核完成')).toBeVisible()
      const approved = await findRow(
        adminPage,
        '/api/finance/deduction/list',
        deduction.deductionNumber,
      )
      await expect(cell(approved, 9)).toContainText('已通过')

      // 钱包余额减少对应金额
      const balanceAfter = Number((await walletFor(adminPage, deduction.userId)).balance)
      expect(money2(balanceAfter)).toBe(money2(Number(expected)))

      // 账户变动新增支出流水（实际关联号为扣费单号）
      const logs = await tradeLogPage(adminPage, deduction.userId)
      const log = logs.items.find(
        (item) => item.orderNumber === deduction.deductionNumber,
      )
      expect(log).toBeTruthy()
      expect(log!.direction).toBe('out')
      expect(Number(log!.amountBase)).toBeCloseTo(amount, 2)
      expect(money2(Number(log!.balance))).toBe(money2(Number(expected)))
      expect(log!.info).toContain('扣费出账')
    } finally {
      await adminContext.close()
    }
  })

  test('3.9 重复审核与不存在单据', async ({ page, browser }) => {
    const dealer = await needDealer(page)
    const remark = `pw-ded-duplicate-${stamp()}`
    const created = await createDeductionApi(page, dealer.id, 1, remark)
    const balanceBefore = Number((await walletFor(page, dealer.id)).balance)
    if (balanceBefore < 1) {
      test.skip(true, '经销商余额不足 1.00，无法验证扣费审核')
      return
    }
    const adminContext = await contextFor(browser, adminState)
    const adminPage = await adminContext.newPage()
    try {
      // 1. 先通过测试扣费单，再次发送审核请求
      const first = await verifyDeductionApi(
        adminPage,
        created.deductionNumber,
        true,
      )
      expect(first.status).toBe(200)
      const afterFirst = Number((await walletFor(page, dealer.id)).balance)
      expect(money2(afterFirst)).toBe(money2(balanceBefore - 1))
      const second = await verifyDeductionApi(
        adminPage,
        created.deductionNumber,
        true,
      )
      expect(second.status).toBe(400)
      expect(second.message).toBe('该单已审核')
      const afterSecond = Number((await walletFor(page, dealer.id)).balance)
      expect(money2(afterSecond)).toBe(money2(afterFirst))

      // 2. 调用不存在的扣费单号：404「扣费单不存在」
      const missing = await verifyDeductionApi(
        adminPage,
        `DD-NOT-EXIST-${stamp()}`,
        true,
      )
      expect(missing.status).toBe(404)
      expect(missing.message).toBe('扣费单不存在')
    } finally {
      await adminContext.close()
    }
  })

  test('3.10 扣费分页与筛选', async ({ page }) => {
    test.setTimeout(300_000)
    const dealer = await needDealer(page)
    const dealerName = dealer.realname || dealer.name
    const remark = `pw-ded-filter-${stamp()}`
    await createDeductionApi(page, dealer.id, 0.5, remark)

    // 1. 按经销商筛选：只显示该经销商扣费单
    await openFinancePage(page, '/finance/deduction')
    await pickDealerInFilter(page, dealer, '/api/finance/deduction/list', 0)
    const filtered = tableRows(page)
    await expect(filtered.first()).toBeVisible({ timeout: 45_000 })
    const filteredCount = await filtered.count()
    expect(filteredCount).toBeGreaterThan(0)
    for (let i = 0; i < filteredCount; i++) {
      await expect(cell(filtered.nth(i), 2)).toHaveText(dealerName)
    }
    await expect(filtered.filter({ hasText: remark })).toHaveCount(1)

    // 2. 清除筛选，超过 20 条时翻页
    await clearFilter(page, 0, '/api/finance/deduction/list')
    const total = (await deductionPage(page)).total
    if (total > 20) {
      const pager2 = page.locator('.ant-pagination-item-2')
      await expect(pager2).toBeVisible({ timeout: 30_000 })
      const request2 = page.waitForRequest(
        (r) =>
          r.url().includes('/api/finance/deduction/list') &&
          /[?&]page=2(&|$)/.test(r.url()),
      )
      await pager2.click()
      expect((await request2).url()).toContain('pageSize=20')
      await expect(page.locator('.ant-pagination-item-active')).toHaveText('2')
      await expect(tableRows(page).first()).toBeVisible({ timeout: 45_000 })
      const count = await tableRows(page).count()
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(20)
    } else {
      test.info().annotations.push({
        type: 'coverage',
        description: '当前环境扣费单不超过 20 条，未执行第 2 页分页断言',
      })
    }

    // 3. 选择无数据经销商（mock 空结果）：显示「暂无数据」
    await page.route('**/api/finance/deduction/list*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }),
      })
    })
    await pickDealerInFilter(page, dealer, '/api/finance/deduction/list', 0)
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)
  })
})
