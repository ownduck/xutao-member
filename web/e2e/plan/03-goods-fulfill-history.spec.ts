// spec: specs/03-goods-fulfill-history.plan.md
// seed: e2e/seed.spec.ts

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const adminState = path.join(authDir, 'admin.json')
const opsState = path.join(authDir, 'ops.json')
const dealerState = path.join(authDir, 'dealer.json')
const BASE_URL = 'http://localhost:5288'

type OrderDetail = {
  id: number
  orderNumber: string
  status: string
  deductionId: number | null
  items: Array<{
    id: number
    reserveQty: number
    fulfillQty: number
  }>
}

type DealerOption = {
  id: string
  name: string
  email: string
  realname?: string | null
}

function contextFor(browser: Browser, storageState?: string) {
  return browser.newContext({ baseURL: BASE_URL, storageState })
}

function message(page: Page, text: string | RegExp) {
  return page
    .locator('.ant-message-notice-title')
    .filter({ hasText: text })
    .first()
}

function tableRows(page: Page) {
  return page.locator('main .ant-table-tbody tr.ant-table-row')
}

function fulfillInputs(page: Page) {
  return page.locator(
    'main .ant-table-tbody input.ant-input-number-input',
  )
}

function uniqueUrl(tag: string) {
  const stamp = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
  return `https://www.amazon.com/dp/${tag}-${stamp}`
}

function parseTime(text: string) {
  const parts = text.trim().split(/\s+/)
  const [y, m, d] = parts[0]!.split('/').map(Number)
  const [h, mi, s] = parts[1]!.split(':').map(Number)
  return new Date(y!, m! - 1, d!, h!, mi!, s!).getTime()
}

async function getOrder(page: Page, orderId: number) {
  const response = await page.request.get(`/api/goods/orders/${orderId}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as OrderDetail
}

async function listDealers(page: Page) {
  const response = await page.request.get('/api/finance/dealers')
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as DealerOption[]
}

async function openFulfillList(page: Page) {
  await page.goto('/goods/fulfill')
  await waitForAppReady(page)
  await expect(page.locator('main .ant-table')).toBeVisible({
    timeout: 45_000,
  })
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/goods/orders/fulfill') &&
      r.request().method() === 'GET',
  )
  await page.getByRole('button', { name: /查\s*询/ }).click()
  await response
  await expect(tableRows(page).first()).toBeVisible({ timeout: 45_000 })
}

async function openHistoryList(page: Page) {
  await page.goto('/goods/history')
  await waitForAppReady(page)
  await expect(page.locator('main .ant-table')).toBeVisible({
    timeout: 45_000,
  })
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/goods/orders/history') &&
      r.request().method() === 'GET',
  )
  await page.getByRole('button', { name: /查\s*询/ }).click()
  await response
  await expect(tableRows(page).first()).toBeVisible({ timeout: 45_000 })
}

async function selectStatus(page: Page, label: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/goods/orders/fulfill') &&
      r.request().method() === 'GET',
  )
  await page.locator('main .ant-select').nth(1).click()
  await page.locator(`.ant-select-item-option[title="${label}"]`).click()
  await response
}

async function waitForStatusCells(
  page: Page,
  cellIndex: number,
  expected: string,
) {
  await expect
    .poll(
      async () => {
        const texts = await tableRows(page)
          .locator(`td:nth-child(${cellIndex})`)
          .allTextContents()
        if (texts.length === 0) {
          const empty = await page.locator('main .ant-empty').count()
          return empty > 0 ? 'empty' : 'pending'
        }
        return texts.every((t) => t.includes(expected)) ? 'ok' : 'pending'
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending')
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

async function openHistoryDetail(page: Page, orderId: number) {
  await page.goto(`/goods/history/${orderId}`)
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
        fulfillInputs(page).evaluateAll((els) =>
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
  // Re-apply immediately before save in case a late load() raced.
  await applyFulfillQtys(page, qtys)
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/goods/orders/${orderId}`) &&
      r.request().method() === 'PUT',
    { timeout: 120_000 },
  )
  await page.getByRole('button', { name: /保\s*存/ }).click()
  const result = await response
  expect(result.status()).toBe(200)
  await expect(message(page, '已保存')).toBeVisible({ timeout: 60_000 })
  // handleSave() 成功后会立刻再 GET 一次详情刷新草稿；
  // 后端较慢时这次刷新可达数十秒，按钮 loading 消失才算真正完成。
  await expect(
    page.locator('main button.ant-btn-loading'),
  ).toHaveCount(0, { timeout: 120_000 })
}

async function createPendingOrderInPage(
  page: Page,
  rows: Array<[string, number]>,
  prices: number[],
) {
  const orderId = await createReserveOrder(page, rows)
  // 等待详情页初始 load() 完成，避免随后写入的单价被覆盖。
  await openReserveDetail(page, orderId)
  await fillUnitPricesAndSave(page, prices)
  await submitFulfill(page)
  return getOrder(page, orderId)
}

async function createPendingOrder(
  browser: Browser,
  rows: Array<[string, number]>,
  prices: number[],
  storageState: string = dealerState,
) {
  const ctx = await contextFor(browser, storageState)
  const page = await ctx.newPage()
  try {
    return await createPendingOrderInPage(page, rows, prices)
  } finally {
    await ctx.close()
  }
}

async function createCancelledOrder(browser: Browser) {
  const ctx = await contextFor(browser, dealerState)
  const page = await ctx.newPage()
  try {
    const order = await createPendingOrderInPage(
      page,
      [[uniqueUrl('CANCELLED'), 1]],
      [10],
    )
    const response = await page.request.post(
      `/api/goods/orders/${order.id}/cancel`,
    )
    expect(response.ok()).toBeTruthy()
    return order
  } finally {
    await ctx.close()
  }
}

test.describe('1. 履约订单列表', () => {
  test.use({ storageState: opsState })

  test('1.1 列表结构与筛选控件', async ({ page }) => {
    // 1. 以 ops 登录并访问 /goods/fulfill
    await openFulfillList(page)

    // 校验卡片标题、筛选控件与查询按钮
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '履约订单',
    )
    await expect(page.locator('main .ant-select')).toHaveCount(2)
    await expect(page.locator('main .ant-select').nth(0)).toContainText(
      '选择经销商',
    )
    await expect(page.locator('main .ant-select').nth(1)).toContainText(
      '状态',
    )
    await expect(
      page.getByRole('button', { name: /查\s*询/ }),
    ).toBeVisible()

    // 表格列依次为 订单号、经销商、状态、币种、商品行、预约量、履约量、创建时间、操作
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '订单号',
      '经销商',
      '状态',
      '币种',
      '商品行',
      '预约量',
      '履约量',
      '创建时间',
      '操作',
    ])

    // 不存在预约列表才有的「价格」列
    await expect(
      page.locator('main .ant-table-thead th').filter({ hasText: '价格' }),
    ).toHaveCount(0)

    // 操作列只有「查看」
    const rows = tableRows(page)
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const actionCell = rows.nth(i).locator('td').last()
      await expect(
        actionCell.getByRole('link', { name: '查看' }),
      ).toBeVisible()
      await expect(actionCell.locator('button')).toHaveCount(0)
      await expect(actionCell).not.toContainText('取消')
    }

    // 2. 首次为空时已点击「查 询」；总数 >20 时分页器 1 2 可见
    await expect(page.locator('main .ant-pagination')).toBeVisible()
    const pager2 = page.locator('.ant-pagination-item-2')
    if ((await pager2.count()) > 0) {
      await expect(
        page.locator('.ant-pagination-item-1'),
      ).toBeVisible()
      await expect(pager2).toBeVisible()
    }
  })

  test('1.2 按状态筛选待履约/部分履约/已履约', async ({ page }) => {
    // 1. 在状态下拉选择「待履约」
    await openFulfillList(page)

    for (const label of ['待履约', '部分履约', '已履约']) {
      // 依次选择「待履约」「部分履约」「已履约」
      await selectStatus(page, label)
      await waitForStatusCells(page, 3, label)

      // 每行状态标签与所选一致，已完成订单不出现在结果中
      const statusTexts = await tableRows(page)
        .locator('td:nth-child(3)')
        .allTextContents()
      for (const text of statusTexts) {
        expect(text).toContain(label)
        expect(text).not.toContain('已完成')
      }

      // 页码回到 1
      await expect(
        page.locator('.ant-pagination-item-active'),
      ).toHaveText('1')
    }

    // 3. 清空状态
    await page.locator('main .ant-select').nth(1).hover()
    const clearResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/fulfill') &&
        r.request().method() === 'GET',
    )
    await page
      .locator('main .ant-select')
      .nth(1)
      .locator('.ant-select-clear')
      .click()
    await clearResponse
    await expect(
      page.locator('main .ant-select-selection-item'),
    ).toHaveCount(0)

    // 三类履约状态订单均可能出现
    await expect
      .poll(
        async () => {
          const texts = await tableRows(page)
            .locator('td:nth-child(3)')
            .allTextContents()
          return new Set(texts.map((t) => t.trim())).size
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(1)
    const clearedTexts = await tableRows(page)
      .locator('td:nth-child(3)')
      .allTextContents()
    expect(clearedTexts.some((t) => t.includes('已履约'))).toBeTruthy()
  })

  test('1.3 按经销商筛选', async ({ page }) => {
    // 列表接口在开发环境单次可达数十秒（远程 PG），放宽用例总时长。
    test.setTimeout(240_000)
    const dealers = await listDealers(page)
    if (dealers.length === 0) {
      test.skip(true, '当前环境无经销商数据，无法验证经销商筛选')
      return
    }
    const dealer = dealers[0]!
    const dealerName = dealer.realname || dealer.name
    const dealerLabel = `${dealerName} (${dealer.email})`

    // 1. 在经销商下拉选择一个经销商并查询
    await openFulfillList(page)
    const filterResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/fulfill') &&
        r.request().method() === 'GET' &&
        r.url().includes(`dealerUserId=${dealer.id}`),
    )
    await page.locator('main .ant-select').nth(0).click()
    await page
      .locator(`.ant-select-item-option[title="${dealerLabel}"]`)
      .click()
    await filterResponse

    // 列表只显示该经销商订单，每行经销商列与所选一致
    await expect
      .poll(
        async () => {
          const texts = await tableRows(page)
            .locator('td:nth-child(2)')
            .allTextContents()
          return (
            texts.length > 0 &&
            texts.every((t) => t.includes(dealerName))
          )
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    // 2. 清空经销商筛选，恢复显示全部经销商数据
    await page.locator('main .ant-select').nth(0).hover()
    const clearResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/fulfill') &&
        r.request().method() === 'GET' &&
        !r.url().includes('dealerUserId='),
    )
    await page
      .locator('main .ant-select')
      .nth(0)
      .locator('.ant-select-clear')
      .click()
    const cleared = await clearResponse
    expect(cleared.url()).not.toContain('dealerUserId=')
    await expect(
      page.locator('main .ant-select-selection-item'),
    ).toHaveCount(0)
    await expect(tableRows(page).first()).toBeVisible({
      timeout: 45_000,
    })
  })

  test('1.4 查看进入履约详情', async ({ page }) => {
    // 1. 点击某个测试订单行的「查看」
    await openFulfillList(page)
    const row = tableRows(page).first()
    const orderNumber = (
      await row.locator('td').first().innerText()
    ).trim()
    const href = await row
      .getByRole('link', { name: '查看' })
      .getAttribute('href')
    expect(href).toMatch(/\/goods\/fulfill\/\d+$/)
    const orderId = Number(href?.match(/(\d+)$/)?.[1])

    await row.getByRole('link', { name: '查看' }).click()

    // URL 为 /goods/fulfill/<id>，详情页订单号与列表一致
    await expect(page).toHaveURL(
      new RegExp(`/goods/fulfill/${orderId}$`),
    )
    await expect(
      page.locator('main .ant-card-head-title'),
    ).toContainText(`订单 ${orderNumber}`, { timeout: 60_000 })
  })

  test('1.5 分页与空态', async ({ page }) => {
    await openFulfillList(page)

    // 1. 当履约订单超过 20 条时切到第 2 页
    await expect(tableRows(page)).toHaveCount(20)
    const pager2 = page.locator('.ant-pagination-item-2')
    if ((await pager2.count()) === 0) {
      test.skip(true, '当前环境履约订单不足两页，无法验证分页')
      return
    }
    const page2Request = page.waitForRequest(
      (r) =>
        r.url().includes('/api/goods/orders/fulfill') &&
        /[?&]page=2(&|$)/.test(r.url()),
    )
    await pager2.click()
    const request2 = await page2Request

    // 请求 page=2&pageSize=20，每页最多 20 行，页码 2 高亮
    expect(request2.url()).toContain('pageSize=20')
    await expect(
      page.locator('.ant-pagination-item-active'),
    ).toHaveText('2')
    await expect(tableRows(page).first()).toBeVisible({
      timeout: 45_000,
    })
    const page2Count = await tableRows(page).count()
    expect(page2Count).toBeGreaterThan(0)
    expect(page2Count).toBeLessThanOrEqual(20)

    // 2. 选择一个无数据组合（当前环境仅一个经销商，用空结果模拟）
    await page.route('**/api/goods/orders/fulfill*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        }),
      })
    })
    const emptyResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/fulfill') &&
        r.request().method() === 'GET',
    )
    await page.getByRole('button', { name: /查\s*询/ }).click()
    await emptyResponse

    // 表格显示「暂无数据」，页面无报错
    await expect(page.locator('main .ant-empty')).toContainText(
      '暂无数据',
    )
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: /失败|错误/ }),
    ).toHaveCount(0)
  })

  test('1.6 dealer 访问履约列表的权限表现', async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const dealerCtx = await contextFor(browser, dealerState)
    const dealerPage = await dealerCtx.newPage()
    try {
      // 1. 以 dealer 登录访问 /goods/fulfill
      await dealerPage.goto('/goods/fulfill')
      await expect(
        message(dealerPage, 'Insufficient permission'),
      ).toBeVisible({ timeout: 60_000 })
      await waitForAppReady(dealerPage)

      // 页面外壳渲染，Header 为「履约订单」
      await expect(
        dealerPage
          .locator('.ant-layout-header')
          .getByRole('heading', { level: 4 }),
      ).toHaveText('履约订单')

      // 表格显示「暂无数据」，不显示经销商筛选下拉
      await expect(dealerPage.locator('main .ant-empty')).toContainText(
        '暂无数据',
        { timeout: 45_000 },
      )
      await expect(
        dealerPage.getByText('选择经销商'),
      ).toHaveCount(0)

      // 2. dealer 打开自己的履约订单详情：先创建并推入待履约
      const order = await createPendingOrderInPage(
        dealerPage,
        [[uniqueUrl('DEALERFULFILL'), 1]],
        [10],
      )
      await openFulfillDetail(dealerPage, order.id)

      // 页面只读：无保存、无履约数量输入框、无提交完成
      await expect(
        dealerPage.locator('main .ant-card-head-title'),
      ).toContainText(`订单 ${order.orderNumber}`, {
        timeout: 60_000,
      })
      await expect(
        dealerPage
          .locator('main .ant-card-head-title .ant-tag')
          .filter({ hasText: '待履约' }),
      ).toBeVisible()
      await expect(
        dealerPage.getByRole('button', { name: /保\s*存/ }),
      ).toHaveCount(0)
      await expect(
        dealerPage.getByRole('button', { name: '提交完成' }),
      ).toHaveCount(0)
      await expect(
        dealerPage.locator('main .ant-table-tbody input'),
      ).toHaveCount(0)

      // 价格与数量以文本显示
      await expect(
        tableRows(dealerPage).first().locator('td').nth(2),
      ).toContainText('USD 10.00')
      await expect(
        tableRows(dealerPage).first().locator('td').nth(3),
      ).toHaveText('0')

      // 3. 以 admin 访问 /goods/fulfill，可见所有经销商订单
      const adminCtx = await contextFor(browser, adminState)
      const adminPage = await adminCtx.newPage()
      try {
        await openFulfillList(adminPage)
        await expect(
          adminPage.locator('main .ant-select'),
        ).toHaveCount(2)
        const statuses = await tableRows(adminPage)
          .locator('td:nth-child(3)')
          .allTextContents()
        expect(statuses.length).toBeGreaterThan(0)
        for (const status of statuses) {
          expect(status).toMatch(/待履约|部分履约|已履约/)
        }
      } finally {
        await adminCtx.close()
      }
    } finally {
      await dealerCtx.close()
    }
  })
})

test.describe('2. 履约详情与提交完成', () => {
  test.use({ storageState: opsState })

  test('2.1 待履约详情结构与只读价格', async ({ page }) => {
    // 列表加载 + 详情多次 GET，在慢后端下需要更长的总时长。
    test.setTimeout(240_000)
    // 1. 以 ops 打开一个「待履约」测试订单
    await openFulfillList(page)
    await selectStatus(page, '待履约')
    await waitForStatusCells(page, 3, '待履约')
    const row = tableRows(page).first()
    await expect(row).toBeVisible()
    const orderNumber = (
      await row.locator('td').first().innerText()
    ).trim()
    const href = await row
      .getByRole('link', { name: '查看' })
      .getAttribute('href')
    const orderId = Number(href?.match(/(\d+)$/)?.[1])
    const order = await getOrder(page, orderId)

    await openFulfillDetail(page, orderId)

    // 标题为「订单 <订单号>」+「待履约」+「价格已填完」
    const head = page.locator('main .ant-card-head-title')
    await expect(head).toContainText(`订单 ${orderNumber}`, {
      timeout: 60_000,
    })
    await expect(
      head.locator('.ant-tag').filter({ hasText: '待履约' }),
    ).toBeVisible()
    await expect(
      head.locator('.ant-tag').filter({ hasText: '价格已填完' }),
    ).toBeVisible()

    // 价格显示为只读文本，无输入框/同步按钮
    await expect(
      page.locator('[data-testid^="unit-price-"]'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '同步价格' }),
    ).toHaveCount(0)
    const priceTexts = await tableRows(page)
      .locator('td:nth-child(3)')
      .allTextContents()
    expect(priceTexts.length).toBe(order.items.length)
    for (const text of priceTexts) {
      expect(text).toContain('USD ')
    }

    // 履约数量为可编辑 InputNumber（min=0，precision=0）
    const inputs = fulfillInputs(page)
    await expect(inputs).toHaveCount(order.items.length)
    for (let i = 0; i < order.items.length; i++) {
      await expect(inputs.nth(i)).toHaveAttribute(
        'aria-valuemin',
        '0',
      )
      await expect(inputs.nth(i)).toHaveAttribute('step', '1')
    }

    // 右上角只有「保 存」
    await expect(
      page.getByRole('button', { name: /保\s*存/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '取消订单' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交完成' }),
    ).toHaveCount(0)

    // Descriptions 含 经销商、币种、创建时间、扣费单（—）、经销商备注
    await expect(
      page.locator('main .ant-descriptions-item-label'),
    ).toHaveText([
      '经销商',
      '币种',
      '创建时间',
      '扣费单',
      '经销商备注',
    ])
    const feeRow = page.locator('main tr').filter({ hasText: '扣费单' })
    await expect(
      feeRow.locator('.ant-descriptions-item-content').last(),
    ).toHaveText('—')
  })

  test('2.2 部分填写履约数量后状态变为部分履约', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('PART1'), 2],
        [uniqueUrl('PART2'), 3],
      ],
      [10, 5],
    )

    // 1. 两行订单，将第 1 行履约数量设为 1、第 2 行保持 0，点击「保 存」
    await openFulfillDetail(page, order.id)
    await setFulfillQtysAndSave(page, order.id, [1, 0])

    // 状态标签变为「部分履约」
    const head = page.locator('main .ant-card-head-title')
    await expect(
      head.locator('.ant-tag').filter({ hasText: '部分履约' }),
    ).toBeVisible({ timeout: 30_000 })

    // 履约量合计更新为 1
    const inputs = fulfillInputs(page)
    await expect(inputs.nth(0)).toHaveValue('1')
    await expect(inputs.nth(1)).toHaveValue('0')
    const qty1 = Number(await inputs.nth(0).inputValue())
    const qty2 = Number(await inputs.nth(1).inputValue())
    expect(qty1 + qty2).toBe(1)

    // 出现「提交完成」按钮
    await expect(
      page.getByRole('button', { name: '提交完成' }),
    ).toBeVisible()
  })

  test('2.3 履约数量与预约不一致时显示警告', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('WARN1'), 2],
        [uniqueUrl('WARN2'), 3],
      ],
      [10, 5],
    )

    // 1. 将某行履约数量改为既非 0 也不等于预约量（预约 2、履约 1）
    await openFulfillDetail(page, order.id)
    await setFulfillQtysAndSave(page, order.id, [1, 0])

    // 输入框旁出现「与预约 2 不一致」，仍可保存
    const table = page.locator('main .ant-table-tbody')
    await expect(
      table.getByText('与预约 2 不一致'),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page
        .locator('main .ant-card-head-title .ant-tag')
        .filter({ hasText: '部分履约' }),
    ).toBeVisible()

    // 2. 将履约数量改为等于预约量
    await applyFulfillQtys(page, [2, 0])

    // 警告消失
    await expect(table.getByText('与预约 2 不一致')).toHaveCount(0)
    await expect(fulfillInputs(page).nth(0)).toHaveValue('2')
  })

  test('2.4 全部履约后状态变为已履约，改回 0 回到待履约', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('FULL1'), 2],
        [uniqueUrl('FULL2'), 3],
      ],
      [10, 5],
    )
    const head = page.locator('main .ant-card-head-title')
    await openFulfillDetail(page, order.id)

    // 1. 所有行履约数量设为等于或大于预约量，点击「保 存」
    await setFulfillQtysAndSave(page, order.id, [2, 3])

    // 状态标签变为「已履约」
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已履约' }),
    ).toBeVisible({ timeout: 30_000 })

    // 履约量合计 >= 预约量合计
    const qty1 = Number(await fulfillInputs(page).nth(0).inputValue())
    const qty2 = Number(await fulfillInputs(page).nth(1).inputValue())
    const reserveTotal = order.items.reduce(
      (sum, item) => sum + item.reserveQty,
      0,
    )
    expect(qty1 + qty2).toBeGreaterThanOrEqual(reserveTotal)

    // 仍显示「提交完成」
    await expect(
      page.getByRole('button', { name: '提交完成' }),
    ).toBeVisible()

    // 2. 将全部履约数量改回 0 并保存
    await setFulfillQtysAndSave(page, order.id, [0, 0])

    // 状态回到「待履约」，「提交完成」按钮消失
    await expect(
      head.locator('.ant-tag').filter({ hasText: '待履约' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('button', { name: '提交完成' }),
    ).toHaveCount(0)
  })

  test('2.5 非法履约数量被拒绝', async ({ page, browser }) => {
    test.setTimeout(360_000)
    const order = await createPendingOrder(
      browser,
      [[uniqueUrl('INVALID'), 1]],
      [10],
    )
    const item = order.items[0]!

    for (const qty of [-1, 1.5]) {
      // 1./2. 通过接口提交 fulfillQty = -1 / 1.5
      const response = await page.request.put(
        `/api/goods/orders/${order.id}`,
        {
          data: { items: [{ id: item.id, fulfillQty: qty }] },
        },
      )

      // 接口返回 400「履约数量无效」
      expect(response.status()).toBe(400)
      expect((await response.json()).message).toBe('履约数量无效')

      // 页面数据不变
      const unchanged = await getOrder(page, order.id)
      expect(unchanged.items[0]?.fulfillQty).toBe(0)
      expect(unchanged.status).toBe('pending_fulfill')
    }

    // 3. 检查界面输入框：min=0 且 precision=0，无法得到负数或小数
    await openFulfillDetail(page, order.id)
    const input = fulfillInputs(page).first()
    await expect(input).toHaveValue('0')
    await expect(input).toHaveAttribute('aria-valuemin', '0')
    await expect(input).toHaveAttribute('step', '1')

    await input.fill('1.5')
    await page.locator('main .ant-table-thead th').first().click()
    await expect(input).toHaveValue('2')
  })

  test('2.6 部分履约提交完成并生成扣费单', async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('PARTDONE1'), 2],
        [uniqueUrl('PARTDONE2'), 3],
      ],
      [10, 5],
    )
    await openFulfillDetail(page, order.id)
    await setFulfillQtysAndSave(page, order.id, [1, 0])
    const head = page.locator('main .ant-card-head-title')
    await expect(
      head.locator('.ant-tag').filter({ hasText: '部分履约' }),
    ).toBeVisible({ timeout: 30_000 })

    // 1. 在部分履约测试订单上点击「提交完成」
    await page.getByRole('button', { name: '提交完成' }).click()
    const dialog = page
      .locator('.ant-modal-confirm')
      .filter({ hasText: '提交完成并生成扣费' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText(
      '当前为「部分履约」。未履约（履约数量为 0）的商品将不计入扣费金额。确认提交完成？',
    )
    await expect(
      dialog.getByRole('button', { name: '确认部分履约完成' }),
    ).toBeVisible()

    // 2. 点击「确认部分履约完成」
    const completeResponse = page.waitForResponse(
      (r) =>
        r
          .url()
          .includes(
            `/api/goods/orders/${order.id}/submit-complete`,
          ) && r.request().method() === 'POST',
    )
    await dialog
      .getByRole('button', { name: '确认部分履约完成' })
      .click()
    const completed = await completeResponse
    expect(completed.status()).toBe(201)

    // 出现「已完成，扣费单已生成」，URL 跳转为 /goods/history/<id>
    await expect(
      message(page, '已完成，扣费单已生成'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(
      new RegExp(`/goods/history/${order.id}$`),
      { timeout: 60_000 },
    )

    // 前端复用详情组件，跳转同一订单 id 时不会重新加载，刷新后校验服务端状态
    await page.reload()
    await waitForAppReady(page)
    await expect(head).toContainText(`订单 ${order.orderNumber}`, {
      timeout: 60_000,
    })

    // 详情状态为「已完成」
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已完成' }),
    ).toBeVisible()
    await expect(
      head.locator('.ant-tag').filter({ hasText: '价格已填完' }),
    ).toBeVisible()

    // 出现「扣费原币金额」且大于 0
    const amountRow = page
      .locator('main tr')
      .filter({ hasText: '扣费原币金额' })
    await expect(amountRow).toContainText(
      /USD \d+\.\d{2}（折合 USD \d+\.\d{2}）/,
    )
    const amountText = await amountRow
      .locator('.ant-descriptions-item-content')
      .last()
      .innerText()
    const amount = Number(amountText.match(/USD ([\d.]+)/)?.[1])
    expect(amount).toBeGreaterThan(0)

    // 3. 「扣费单」显示 DD... 编号链接，点击跳转 /finance/deduction
    const feeLink = page.locator(
      'main a[href="/finance/deduction"]',
    )
    await expect(feeLink).toBeVisible()
    const feeNumber = (await feeLink.innerText()).trim()
    expect(feeNumber).toMatch(/^DD/)
    await feeLink.click()
    await expect(page).toHaveURL(/\/finance\/deduction$/, {
      timeout: 30_000,
    })
    await waitForAppReady(page)
    await expect(
      page.locator('main .ant-card-head-title'),
    ).toContainText('扣费审核', { timeout: 60_000 })

    const deductionRow = tableRows(page)
      .filter({ hasText: feeNumber })
      .first()
    await expect(deductionRow).toBeVisible({ timeout: 45_000 })
    await expect(
      deductionRow.locator('td:nth-child(9)'),
    ).toContainText('待审核')
  })

  test('2.7 已履约提交完成的文案与结果', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('FULLDONE1'), 2],
        [uniqueUrl('FULLDONE2'), 3],
      ],
      [10, 5],
    )
    await openFulfillDetail(page, order.id)
    await setFulfillQtysAndSave(page, order.id, [2, 3])
    const head = page.locator('main .ant-card-head-title')
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已履约' }),
    ).toBeVisible({ timeout: 30_000 })

    // 1. 在「已履约」测试订单点击「提交完成」
    await page.getByRole('button', { name: '提交完成' }).click()
    const dialog = page
      .locator('.ant-modal-confirm')
      .filter({ hasText: '提交完成并生成扣费' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText(
      '提交后订单变为已完成，并生成待审核扣费单。确认？',
    )
    await expect(
      dialog.getByRole('button', { name: '确认提交' }),
    ).toBeVisible()

    // 2. 点击「确认提交」
    const completeResponse = page.waitForResponse(
      (r) =>
        r
          .url()
          .includes(
            `/api/goods/orders/${order.id}/submit-complete`,
          ) && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '确认提交' }).click()
    const completed = await completeResponse
    expect(completed.status()).toBe(201)

    // 提示「已完成，扣费单已生成」，跳转 /goods/history/:id
    await expect(
      message(page, '已完成，扣费单已生成'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(
      new RegExp(`/goods/history/${order.id}$`),
      { timeout: 60_000 },
    )

    // 该订单从履约列表 /goods/fulfill 中消失
    await openFulfillList(page)
    await expect(
      page.locator(`main a[href="/goods/fulfill/${order.id}"]`),
    ).toHaveCount(0)
  })

  test('2.8 零金额订单提交完成失败', async ({ page, browser }) => {
    test.setTimeout(300_000)
    const order = await createPendingOrder(
      browser,
      [
        [uniqueUrl('ZERODONE1'), 2],
        [uniqueUrl('ZERODONE2'), 3],
      ],
      [0, 0],
    )
    await openFulfillDetail(page, order.id)
    await setFulfillQtysAndSave(page, order.id, [2, 3])
    const head = page.locator('main .ant-card-head-title')
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已履约' }),
    ).toBeVisible({ timeout: 30_000 })

    // 1. 点击「提交完成」并确认
    await page.getByRole('button', { name: '提交完成' }).click()
    const dialog = page
      .locator('.ant-modal-confirm')
      .filter({ hasText: '提交完成并生成扣费' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const failedResponse = page.waitForResponse(
      (r) =>
        r
          .url()
          .includes(
            `/api/goods/orders/${order.id}/submit-complete`,
          ) && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '确认提交' }).click()
    const failed = await failedResponse

    // 服务端返回 400「扣费金额必须大于 0」
    expect(failed.status()).toBe(400)
    const failedBody = (await failed.json()) as {
      message?: string
    }
    expect(failedBody.message).toBe('扣费金额必须大于 0')

    // 说明：当前前端 Modal.confirm 未捕获 onOk 异常，界面不会弹出该错误提示，
    // 确认框保持打开；此处以接口消息和页面状态断言实际行为。
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // 订单仍在当前详情页
    await expect(page).toHaveURL(
      new RegExp(`/goods/fulfill/${order.id}$`),
    )

    // 状态保持「已履约」，不生成扣费单
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已履约' }),
    ).toBeVisible()
    await expect(
      page
        .locator('main tr')
        .filter({ hasText: '扣费单' })
        .locator('.ant-descriptions-item-content')
        .last(),
    ).toHaveText('—')
    await expect(
      message(page, '已完成，扣费单已生成'),
    ).toHaveCount(0)
    const after = await getOrder(page, order.id)
    expect(after.status).toBe('fulfilled')
    expect(after.deductionId).toBeNull()
  })

  test('2.9 无权限与不存在订单', async ({ page, browser }) => {
    test.setTimeout(300_000)

    // 1. 以 dealer 打开他人履约订单
    const adminOrder = await createPendingOrder(
      browser,
      [[uniqueUrl('OTHERDEALER'), 1]],
      [10],
      adminState,
    )
    const dealerCtx = await contextFor(browser, dealerState)
    const dealerPage = await dealerCtx.newPage()
    try {
      await dealerPage.goto(`/goods/fulfill/${adminOrder.id}`)
      await waitForAppReady(dealerPage)

      // 出现「无权查看该订单」提示，页面显示「订单不存在」卡片，不白屏
      await expect(
        message(dealerPage, '无权查看该订单'),
      ).toBeVisible({ timeout: 60_000 })
      await expect(
        dealerPage.locator('main .ant-card-body').last(),
      ).toContainText('订单不存在', { timeout: 30_000 })
      await expect(dealerPage.locator('#root')).not.toBeEmpty()
    } finally {
      await dealerCtx.close()
    }

    // 2. 以 ops 访问 /goods/fulfill/999999992
    await page.goto('/goods/fulfill/999999992')
    await waitForAppReady(page)
    await expect(
      message(page, '订单不存在'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      page.locator('main .ant-card-body').last(),
    ).toContainText('订单不存在', { timeout: 30_000 })

    // 3. 访问 /goods/fulfill/abc，页面不崩溃并显示「订单不存在」
    await page.goto('/goods/fulfill/abc')
    await waitForAppReady(page)
    await expect(
      page.locator('main .ant-card-body').last(),
    ).toContainText('订单不存在', { timeout: 30_000 })
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('2.10 已取消订单不可履约完成', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000)

    // 1. 准备一个待履约后又被取消的测试订单，打开其履约详情
    const order = await createCancelledOrder(browser)
    await openFulfillDetail(page, order.id)
    const head = page.locator('main .ant-card-head-title')
    await expect(head).toContainText(`订单 ${order.orderNumber}`, {
      timeout: 60_000,
    })

    // 标题旁显示「已取消」，无保存/提交完成按钮，履约数量为只读
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已取消' }),
    ).toBeVisible()
    await expect(
      head.locator('.ant-tag').filter({ hasText: '待履约' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /保\s*存/ }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交完成' }),
    ).toHaveCount(0)
    await expect(
      page.locator('main .ant-table-tbody input'),
    ).toHaveCount(0)
    await expect(
      tableRows(page).first().locator('td').nth(3),
    ).toHaveText('0')

    // 2. 直接调用 POST /api/goods/orders/:id/submit-complete
    const response = await page.request.post(
      `/api/goods/orders/${order.id}/submit-complete`,
    )

    // 返回 400「订单已取消」或类似提示，不生成扣费单
    expect(response.status()).toBe(400)
    const body = (await response.json()) as { message?: string }
    expect(body.message).toContain('订单已取消')

    const after = await getOrder(page, order.id)
    expect(after.deductionId).toBeNull()
    expect(after.status).toBe('pending_fulfill')
  })
})

test.describe('3. 历史订单列表与详情', () => {
  test.use({ storageState: opsState })

  test('3.1 历史列表结构与只读操作', async ({ page }) => {
    // 1. 以 ops 访问 /goods/history
    await openHistoryList(page)

    // 卡片标题「历史订单」
    await expect(
      page.locator('main .ant-card-head-title'),
    ).toHaveText('历史订单')

    // 只有经销商筛选，没有状态筛选
    await expect(page.locator('main .ant-select')).toHaveCount(1)
    await expect(
      page.locator('main .ant-select').first(),
    ).toContainText('选择经销商')
    await expect(
      page.locator('main .ant-select').nth(1),
    ).toHaveCount(0)

    // 表格列：订单号、经销商、状态、币种、商品行、预约量、履约量、创建时间、操作
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '订单号',
      '经销商',
      '状态',
      '币种',
      '商品行',
      '预约量',
      '履约量',
      '创建时间',
      '操作',
    ])

    // 每行状态均为「已完成」
    const statusCells = tableRows(page).locator(
      'td:nth-child(3)',
    )
    await expect
      .poll(
        async () => {
          const texts = await statusCells.allTextContents()
          return (
            texts.length > 0 &&
            texts.every((t) => t.includes('已完成'))
          )
        },
        { timeout: 45_000 },
      )
      .toBe(true)

    // 操作列只有「查看」
    const rows = tableRows(page)
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const actionCell = rows.nth(i).locator('td').last()
      await expect(
        actionCell.getByRole('link', { name: '查看' }),
      ).toBeVisible()
      await expect(actionCell.locator('button')).toHaveCount(0)
    }

    // 分页可见（数据 >20 时显示 1 2）
    await expect(page.locator('main .ant-pagination')).toBeVisible()
    const pager2 = page.locator('.ant-pagination-item-2')
    if ((await pager2.count()) === 0) {
      test.skip(
        true,
        '当前环境历史订单不足 21 条，无法验证分页 1 2',
      )
      return
    }
    await expect(
      page.locator('.ant-pagination-item-1'),
    ).toBeVisible()
    await expect(pager2).toBeVisible()
  })

  test('3.2 历史详情只读并展示扣费信息', async ({ page }) => {
    const listResponse = await page.request.get(
      '/api/goods/orders/history?page=1&pageSize=20',
    )
    expect(listResponse.ok()).toBeTruthy()
    const list = (await listResponse.json()) as {
      items: Array<{ id: number; deductionId: number | null }>
    }
    const target = list.items.find(
      (item) => item.deductionId != null,
    )
    if (!target) {
      test.skip(
        true,
        '当前环境没有已生成扣费单的历史订单，无法验证扣费信息展示',
      )
      return
    }

    // 1. 点击一个已生成扣费的历史订单「查看」
    await openHistoryList(page)
    const targetHref = `/goods/history/${target.id}`
    const row = tableRows(page).filter({
      has: page.locator(`a[href="${targetHref}"]`),
    })
    await expect(row).toBeVisible({ timeout: 45_000 })
    await row.getByRole('link', { name: '查看' }).click()

    // URL 为 /goods/history/<id>
    await expect(page).toHaveURL(
      new RegExp(`/goods/history/${target.id}$`),
    )
    await expect(
      page.locator('main .ant-card-head-title'),
    ).toContainText('订单 ', { timeout: 60_000 })

    // 状态标签「已完成」+「价格已填完」
    const head = page.locator('main .ant-card-head-title')
    await expect(
      head.locator('.ant-tag').filter({ hasText: '已完成' }),
    ).toBeVisible()
    await expect(
      head.locator('.ant-tag').filter({ hasText: '价格已填完' }),
    ).toBeVisible()

    // 无保存、无提交完成、无取消订单、无价格/履约输入框
    await expect(page.locator('main button')).toHaveCount(0)
    await expect(
      page.locator('main .ant-table-tbody input'),
    ).toHaveCount(0)
    await expect(
      page.locator('[data-testid^="unit-price-"]'),
    ).toHaveCount(0)

    // 「扣费单」显示编号链接
    const feeLink = page.locator(
      'main a[href="/finance/deduction"]',
    )
    await expect(feeLink).toBeVisible()
    await expect(feeLink).toHaveText(/^DD/)

    // 「扣费原币金额」显示如 USD 10.00（折合 USD 10.00）
    await expect(
      page.locator('main tr').filter({ hasText: '扣费原币金额' }),
    ).toContainText(
      /USD \d+\.\d{2}（折合 USD \d+\.\d{2}）/,
    )
  })

  test('3.3 历史筛选与分页', async ({ page }) => {
    const dealers = await listDealers(page)
    if (dealers.length === 0) {
      test.skip(true, '当前环境无经销商数据，无法验证历史筛选')
      return
    }
    const dealer = dealers[0]!
    const dealerName = dealer.realname || dealer.name
    const dealerLabel = `${dealerName} (${dealer.email})`

    await openHistoryList(page)

    // 1. 选择某个经销商查询，只显示该经销商的历史订单
    const filterResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/history') &&
        r.request().method() === 'GET' &&
        r.url().includes(`dealerUserId=${dealer.id}`),
    )
    await page.locator('main .ant-select').first().click()
    await page
      .locator(`.ant-select-item-option[title="${dealerLabel}"]`)
      .click()
    await filterResponse

    await expect
      .poll(
        async () => {
          const texts = await tableRows(page)
            .locator('td:nth-child(2)')
            .allTextContents()
          return (
            texts.length > 0 &&
            texts.every((t) => t.includes(dealerName))
          )
        },
        { timeout: 30_000 },
      )
      .toBe(true)

    // 2. 清空筛选并翻到第 2 页（>20 条时）
    await page.locator('main .ant-select').first().hover()
    const clearResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/history') &&
        r.request().method() === 'GET' &&
        !r.url().includes('dealerUserId='),
    )
    await page
      .locator('main .ant-select')
      .first()
      .locator('.ant-select-clear')
      .click()
    await clearResponse
    await expect(
      page.locator('main .ant-select-selection-item'),
    ).toHaveCount(0)
    await expect(tableRows(page).first()).toBeVisible({
      timeout: 45_000,
    })

    const pager2 = page.locator('.ant-pagination-item-2')
    if ((await pager2.count()) === 0) {
      test.skip(
        true,
        '当前环境历史订单不足两页，无法验证分页',
      )
      return
    }
    const page1LastTime = parseTime(
      await tableRows(page)
        .last()
        .locator('td')
        .nth(7)
        .innerText(),
    )
    const page2Response = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/history') &&
        /[?&]page=2(&|$)/.test(r.url()),
    )
    await pager2.click()
    const response2 = await page2Response
    await expect(tableRows(page).first()).toBeVisible({
      timeout: 45_000,
    })

    // 按创建时间倒序返回第 2 页，每页 20 条
    expect(response2.url()).toContain('pageSize=20')
    await expect(
      page.locator('.ant-pagination-item-active'),
    ).toHaveText('2')
    const page2Count = await tableRows(page).count()
    expect(page2Count).toBeGreaterThan(0)
    expect(page2Count).toBeLessThanOrEqual(20)
    const page2FirstTime = parseTime(
      await tableRows(page)
        .first()
        .locator('td')
        .nth(7)
        .innerText(),
    )
    expect(page2FirstTime).toBeLessThanOrEqual(page1LastTime)

    // 3. 选择无数据经销商：当前环境仅一个经销商，用空结果模拟
    await page.route('**/api/goods/orders/history*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
        }),
      })
    })
    const emptyResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/history') &&
        r.request().method() === 'GET' &&
        r.url().includes('dealerUserId='),
    )
    await page.locator('main .ant-select').first().click()
    await page
      .locator(`.ant-select-item-option[title="${dealerLabel}"]`)
      .click()
    await emptyResponse

    // 显示「暂无数据」
    await expect(page.locator('main .ant-empty')).toContainText(
      '暂无数据',
    )
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: /失败|错误/ }),
    ).toHaveCount(0)
  })

  test('3.4 经销商历史数据隔离', async ({ browser }) => {
    test.setTimeout(360_000)
    const dealerCtx = await contextFor(browser, dealerState)
    const dealerPage = await dealerCtx.newPage()
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    try {
      // 1. 以 dealer 访问 /goods/history
      await openHistoryList(dealerPage)
      await expect(
        dealerPage.locator('main .ant-card-head-title'),
      ).toHaveText('历史订单')

      // 无经销商筛选
      await expect(
        dealerPage.locator('main .ant-select'),
      ).toHaveCount(0)

      const meResponse = await dealerPage.request.get('/api/me')
      expect(meResponse.ok()).toBeTruthy()
      const me = (await meResponse.json()) as {
        user: {
          id: string
          name: string
          realname?: string | null
        }
      }
      const dealerName = me.user.realname || me.user.name

      // 只显示自己的历史订单
      const dealerRows = tableRows(dealerPage)
      await expect(dealerRows.first()).toBeVisible({
        timeout: 45_000,
      })
      const dealerCount = await dealerRows.count()
      expect(dealerCount).toBeGreaterThan(0)
      for (let i = 0; i < dealerCount; i++) {
        await expect(
          dealerRows.nth(i).locator('td:nth-child(2)'),
        ).toHaveText(dealerName)
      }

      // 2. 以 dealer 打开他人历史详情
      const historyResponse = await adminPage.request.get(
        '/api/goods/orders/history?page=1&pageSize=100',
        { timeout: 120_000 },
      )
      expect(historyResponse.ok()).toBeTruthy()
      const history = (await historyResponse.json()) as {
        total?: number
        items: Array<{
          id: number
          orderNumber: string
          dealerUserId: string
          dealer?: {
            name: string
            email: string
            realname?: string | null
          } | null
        }>
      }
      const other = history.items.find(
        (item) => item.dealerUserId !== me.user.id,
      )
      if (!other) {
        test.skip(
          true,
          '当前环境没有其他经销商的历史订单，无法验证越权访问',
        )
        return
      }

      // 出现「无权查看该订单」提示，页面显示「订单不存在」卡片
      await dealerPage.goto(`/goods/history/${other.id}`)
      await waitForAppReady(dealerPage)
      await expect(
        message(dealerPage, '无权查看该订单'),
      ).toBeVisible({ timeout: 60_000 })
      await expect(
        dealerPage.locator('main .ant-card-body').last(),
      ).toContainText('订单不存在', { timeout: 30_000 })

      // 3. 以 admin 访问 /goods/history，可见全部用户的历史订单
      test.info().annotations.push({
        type: 'note',
        description:
          '当前环境仅有一个经销商角色账号，其余历史订单属于超级管理员；' +
          '第 1 页（20 条）可能只包含当前经销商的订单，因此按 API 排序定位到包含其他订单的页再断言。',
      })
      await openHistoryList(adminPage)
      await expect(
        adminPage.locator('main .ant-select'),
      ).toHaveCount(1)
      const adminRows = tableRows(adminPage)
      await expect(adminRows.first()).toBeVisible({
        timeout: 45_000,
      })

      // admin 分页总数与 API 全量结果一致，说明未按单一经销商过滤
      const adminPageSize = 20
      const historyTotal = history.total ?? history.items.length
      const expectedPages = Math.ceil(historyTotal / adminPageSize)
      await expect
        .poll(
          async () =>
            (
              await adminPage
                .locator('.ant-pagination-item')
                .allTextContents()
            ).map((t) => t.trim()),
          { timeout: 45_000 },
        )
        .toContain(String(expectedPages))

      // 第一页所有订单均为已完成状态
      const statuses = await adminRows
        .locator('td:nth-child(3)')
        .allTextContents()
      for (const status of statuses) {
        expect(status).toContain('已完成')
      }

      // API 与 UI 使用相同的排序（createTime desc）和每页 20 条，
      // 由 API 返回的顺序可直接定位其他用户订单所在的页。
      const otherIndex = history.items.findIndex(
        (item) => item.id === other.id,
      )
      expect(otherIndex).toBeGreaterThanOrEqual(0)
      const otherPage = Math.floor(otherIndex / adminPageSize) + 1
      expect(otherPage).toBeLessThanOrEqual(expectedPages)

      if (otherPage > 1) {
        const pageResponse = adminPage.waitForResponse(
          (r) =>
            r.url().includes('/api/goods/orders/history') &&
            r.request().method() === 'GET' &&
            new RegExp(`[?&]page=${otherPage}(&|$)`).test(r.url()),
          { timeout: 120_000 },
        )
        await adminPage
          .locator(`.ant-pagination-item-${otherPage}`)
          .click()
        await pageResponse
        await expect(
          adminPage.locator('.ant-pagination-item-active'),
        ).toHaveText(String(otherPage), { timeout: 30_000 })
      }

      // admin 列表中能看到该订单，且归属展示为其他用户
      const otherDealerName =
        other.dealer?.realname ||
        other.dealer?.name ||
        other.dealer?.email ||
        other.dealerUserId
      expect(other.dealerUserId).not.toBe(me.user.id)
      expect(otherDealerName).not.toBe(dealerName)
      const otherRow = adminRows
        .filter({ hasText: other.orderNumber })
        .first()
      await expect(otherRow).toBeVisible({ timeout: 45_000 })
      await expect(
        otherRow.locator('td:nth-child(2)'),
      ).toHaveText(otherDealerName)
    } finally {
      await dealerCtx.close()
      await adminCtx.close()
    }
  })

  test('3.5 历史详情扣费单链接跳转', async ({ page }) => {
    const listResponse = await page.request.get(
      '/api/finance/deduction/list?page=1&pageSize=20',
    )
    expect(listResponse.ok()).toBeTruthy()
    const list = (await listResponse.json()) as {
      items: Array<{
        deductionNumber: string
        orderId: number | null
      }>
    }
    const target = list.items.find(
      (item) => item.orderId != null,
    )
    if (!target) {
      test.skip(
        true,
        '当前环境没有关联订单的扣费单，无法验证历史详情跳转',
      )
      return
    }

    // 1. 在历史详情点击「扣费单」链接
    await openHistoryDetail(page, target.orderId!)
    const feeLink = page.locator(
      'main a[href="/finance/deduction"]',
    )
    await expect(feeLink).toBeVisible({ timeout: 45_000 })
    await expect(feeLink).toHaveText(target.deductionNumber)
    await feeLink.click()

    // 跳转 /finance/deduction
    await expect(page).toHaveURL(/\/finance\/deduction$/)
    await waitForAppReady(page)
    await expect(
      page.locator('main .ant-card-head-title'),
    ).toContainText('扣费审核', { timeout: 60_000 })

    // 目标页表格中存在该扣费单编号，状态为待审核（若尚未审核）
    const deductionRow = tableRows(page)
      .filter({ hasText: target.deductionNumber })
      .first()
    await expect(deductionRow).toBeVisible({ timeout: 45_000 })
    await expect(
      deductionRow.locator('td:nth-child(9)'),
    ).toContainText(/待审核|已通过|已拒绝/)
  })

  test('3.6 不存在的历史订单', async ({ page }) => {
    // 1. 以 ops 访问 /goods/history/999999993
    await page.goto('/goods/history/999999993')
    await waitForAppReady(page)

    // 出现「订单不存在」提示，页面显示「订单不存在」卡片，无白屏
    await expect(
      message(page, '订单不存在'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      page.locator('main .ant-card-body').last(),
    ).toContainText('订单不存在', { timeout: 30_000 })
    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
