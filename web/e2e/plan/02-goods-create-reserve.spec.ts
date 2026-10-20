// spec: specs/02-goods-create-reserve.plan.md
// seed: e2e/seed.spec.ts

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildGoodsXlsxPath,
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

// 开发环境后端单请求实测 3-17s（import/详情/保存/提交），整个预约流程可达 90s+。
// 显式放宽本文件超时，避免慢响应被误判为功能失败。
test.describe.configure({ timeout: 240_000 })

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

function reserveRow(page: Page, orderId: number) {
  return tableRows(page).filter({
    has: page.locator(`a[href="/goods/reserve/${orderId}"]`),
  })
}

function uniqueUrl(tag: string) {
  const stamp = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
  return `https://www.amazon.com/dp/${tag}-${stamp}`
}

async function openReserveList(page: Page) {
  await page.goto('/goods/reserve')
  await waitForAppReady(page)
  await expect(page.locator('main .ant-table')).toBeVisible({
    timeout: 90_000,
  })
  if ((await page.locator('main .ant-empty').count()) > 0) {
    await page.getByRole('button', { name: /查\s*询/ }).click()
  }
  await expect(tableRows(page).first()).toBeVisible({ timeout: 90_000 })
}

async function selectStatus(page: Page, label: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/goods/orders/reserve') &&
      r.request().method() === 'GET',
  )
  await page.locator('main .ant-select').click()
  await page.locator(`.ant-select-item-option[title="${label}"]`).click()
  await response
}

async function getOrder(page: Page, orderId: number) {
  // 直连订单接口在开发环境实测 3-6s，留足余量避免默认 30s 请求超时。
  const response = await page.request.get(`/api/goods/orders/${orderId}`, {
    timeout: 90_000,
  })
  return (await response.json()) as {
    orderNumber: string
    currencyCode: string
  }
}

test.describe('1. 创建预约页面与文件解析', () => {
  test.use({ storageState: dealerState })

  test('1.1 创建预约页初始结构与空态', async ({ page }) => {
    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 确认页面 Header 与卡片标题均为「创建预约」
    await expect(
      page
        .locator('.ant-layout-header')
        .getByRole('heading', { level: 4 }),
    ).toHaveText('创建预约')
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      '创建预约',
    )

    // 3. 确认 Alert 说明文案
    await expect(page.locator('main .ant-alert')).toContainText(
      '上传 Amazon 商品下单 Excel（表头：url、数量）。创建后订单状态为「预约中」，请在预约订单中补全单价后再提交履约。',
    )

    // 4. 确认「下载模板」「选择 Excel」按钮与「备注」输入框
    await expect(page.getByRole('button', { name: '下载模板' })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: /选择\s*Excel/ }),
    ).toBeVisible()
    await expect(page.getByPlaceholder('备注')).toBeVisible()

    // 5. 确认空态提示与「确认创建」禁用
    await expect(page.locator('main .ant-table-placeholder')).toContainText(
      '请先上传并解析 Excel',
    )
    await expect(page.getByRole('button', { name: '确认创建' })).toBeDisabled()
  })

  test('1.2 下载 Excel 模板', async ({ page }) => {
    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 点击「下载模板」，等待下载事件并校验文件名
    const downloadPromise = page.waitForEvent('download', {
      timeout: 30_000,
    })
    await page.getByRole('button', { name: '下载模板' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('goods-reserve-template.xlsx')

    // 3. 确认按钮仍可用、页面无错误提示
    await expect(page.getByRole('button', { name: '下载模板' })).toBeEnabled()
    await expect(page).toHaveURL(/\/goods\/create$/)
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: /下载失败|失败/ }),
    ).toHaveCount(0)
  })

  test('1.3 上传合法 Excel 后解析预览并可删除', async ({ page }) => {
    const urlA = uniqueUrl('UPLOAD1')
    const urlB = uniqueUrl('UPLOAD2')
    const filePath = buildGoodsXlsxPath(
      [
        [urlA, 2],
        [urlB, 3],
      ],
      'pw-goods-valid.xlsx',
    )

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 上传包含两行合法数据的 Excel 文件
    await page.setInputFiles('input[type="file"]', filePath)

    // 3. 校验「已解析 2 行」、预览两行、确认创建可用、文件列表 1 个
    await expect(message(page, '已解析 2 行')).toBeVisible({
      timeout: 15_000,
    })
    await expect(tableRows(page)).toHaveCount(2)
    await expect(tableRows(page).first()).toContainText(urlA)
    await expect(tableRows(page).nth(1)).toContainText(urlB)
    await expect(
      page.getByRole('button', { name: '确认创建' }),
    ).toBeEnabled()
    const uploadItems = page.locator('.ant-upload-list-item')
    await expect(uploadItems).toHaveCount(1)
    await expect(uploadItems).toContainText('pw-goods-valid.xlsx')

    // 4. 点击删除文件，校验表格清空与「确认创建」恢复禁用
    await page.getByRole('button', { name: '删除文件' }).click()
    await expect(tableRows(page)).toHaveCount(0)
    await expect(uploadItems).toHaveCount(0)
    await expect(page.locator('main .ant-table-placeholder')).toContainText(
      '请先上传并解析 Excel',
    )
    await expect(page.getByRole('button', { name: '确认创建' })).toBeDisabled()
  })

  test('1.4 再次上传会替换已选文件', async ({ page }) => {
    const urlA = uniqueUrl('REPLACEA')
    const urlB = uniqueUrl('REPLACEB')
    const fileA = buildGoodsXlsxPath(
      [
        [urlA, 2],
        [uniqueUrl('REPLACEA2'), 2],
      ],
      'pw-goods-a.xlsx',
    )
    const fileB = buildGoodsXlsxPath([[urlB, 1]], 'pw-goods-b.xlsx')

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 上传文件 A（两行）并确认解析结果
    await page.setInputFiles('input[type="file"]', fileA)
    await expect(message(page, '已解析 2 行')).toBeVisible({
      timeout: 15_000,
    })
    await expect(tableRows(page)).toHaveCount(2)

    // 3. 再上传文件 B（一行），校验文件列表只剩 1 个、预览只剩 1 行
    await page.setInputFiles('input[type="file"]', fileB)
    await expect(message(page, '已解析 1 行')).toBeVisible({
      timeout: 15_000,
    })
    const uploadItems = page.locator('.ant-upload-list-item')
    await expect(uploadItems).toHaveCount(1)
    await expect(uploadItems).toContainText('pw-goods-b.xlsx')
    await expect(uploadItems).not.toContainText('pw-goods-a.xlsx')
    await expect(tableRows(page)).toHaveCount(1)
    await expect(tableRows(page).first()).toContainText(urlB)
    await expect(tableRows(page).first()).not.toContainText(urlA)
    await expect(
      page.getByRole('button', { name: '确认创建' }),
    ).toBeEnabled()
  })
})

test.describe('2. 创建预约校验与提交', () => {
  test.use({ storageState: dealerState })

  test('2.1 非 Excel 文件解析失败', async ({ page }) => {
    const notExcel = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'seed.spec.ts',
    )

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 确认文件选择器仅接受 .xlsx / .xls
    const input = page.locator('input[type="file"]')
    await expect(input).toHaveAttribute('accept', /\.xlsx/)
    await expect(input).toHaveAttribute('accept', /\.xls/)

    // 3. 上传非 Excel 文件，校验解析失败提示
    await page.setInputFiles('input[type="file"]', notExcel)
    await expect(
      message(page, /解析失败|缺少|没有有效/),
    ).toBeVisible({ timeout: 15_000 })

    // 4. 校验表格为空、确认创建禁用、未跳转
    await expect(tableRows(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '确认创建' })).toBeDisabled()
    await expect(page).toHaveURL(/\/goods\/create$/)
  })

  test('2.2 缺少 url 提示行号', async ({ page }) => {
    const filePath = buildGoodsXlsxPath([['', 1]], 'pw-goods-no-url.xlsx')

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 上传 URL 为空、数量为 1 的文件
    await page.setInputFiles('input[type="file"]', filePath)

    // 3. 校验「第 2 行缺少 url」，不生成订单且不跳转
    await expect(message(page, '第 2 行缺少 url')).toBeVisible({
      timeout: 15_000,
    })
    await expect(tableRows(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '确认创建' })).toBeDisabled()
    await expect(page).toHaveURL(/\/goods\/create$/)
  })

  test('2.3 数量非法拒绝', async ({ page }) => {
    const invalidQtys: Array<[string, number]> = [
      ['0', 0],
      ['负数', -1],
      ['小数', 1.5],
      ['非数字', 'abc' as unknown as number],
    ]

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    for (const [label, qty] of invalidQtys) {
      // 2. 分别上传数量为 0、-1、1.5、abc 的文件
      const filePath = buildGoodsXlsxPath(
        [[uniqueUrl(`QTY-${label}`), qty]],
        `pw-goods-qty-${label}.xlsx`,
      )
      await page.setInputFiles('input[type="file"]', filePath)

      // 3. 校验「第 2 行数量必须为正整数」、预览清空、确认创建禁用
      await expect(message(page, '第 2 行数量必须为正整数')).toBeVisible({
        timeout: 15_000,
      })
      await expect(tableRows(page)).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '确认创建' }),
      ).toBeDisabled()
      await expect(page).toHaveURL(/\/goods\/create$/)
    }
  })

  test('2.4 只有表头无数据', async ({ page }) => {
    const filePath = buildGoodsXlsxPath([], 'pw-goods-header-only.xlsx')

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 上传只有表头的 Excel
    await page.setInputFiles('input[type="file"]', filePath)

    // 3. 校验「没有有效数据行」且不跳转
    await expect(message(page, '没有有效数据行')).toBeVisible({
      timeout: 15_000,
    })
    await expect(tableRows(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '确认创建' })).toBeDisabled()
    await expect(page).toHaveURL(/\/goods\/create$/)
  })

  test('2.5 备注与合法数据创建成功跳转详情', async ({ page }) => {
    const urlA = uniqueUrl('CREATE1')
    const urlB = uniqueUrl('CREATE2')
    const remark = `pw-create-${Date.now()}`
    const filePath = buildGoodsXlsxPath(
      [
        [urlA, 2],
        [urlB, 3],
      ],
      'pw-goods-create.xlsx',
    )

    // 延迟创建请求，便于观察提交中的 loading 状态
    await page.route('**/api/goods/orders/import', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })

    // 1. dealer 访问 /goods/create
    await page.goto('/goods/create')
    await waitForAppReady(page)

    // 2. 上传两行合法数据并填写备注
    await page.setInputFiles('input[type="file"]', filePath)
    await expect(message(page, '已解析 2 行')).toBeVisible({
      timeout: 15_000,
    })
    await page.getByPlaceholder('备注').fill(remark)

    // 3. 点击「确认创建」，校验 loading、成功提示与详情跳转
    await page.getByRole('button', { name: '确认创建' }).click()
    await expect(page.locator('main button.ant-btn-loading')).toBeVisible({
      timeout: 5_000,
    })
    await expect(message(page, '预约订单已创建')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page).toHaveURL(/\/goods\/reserve\/\d+/, {
      timeout: 60_000,
    })

    // 4. 校验详情标题、状态、价格标签、备注与两行数据
    const orderId = Number(page.url().match(/\/goods\/reserve\/(\d+)/)?.[1])
    const order = await getOrder(page, orderId)
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      `订单 ${order.orderNumber}`,
      { timeout: 60_000 },
    )
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '预约中' }),
    ).toBeVisible()
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '价格未齐' }),
    ).toBeVisible()

    const labels = page.locator('main .ant-descriptions-item-label')
    await expect(labels).toHaveText([
      '经销商',
      '币种',
      '创建时间',
      '扣费单',
      '经销商备注',
    ])
    const remarkRow = page
      .locator('main tr')
      .filter({ hasText: '经销商备注' })
    await expect(remarkRow.locator('textarea')).toHaveValue(remark)
    const feeRow = page.locator('main tr').filter({ hasText: '扣费单' })
    await expect(
      feeRow.locator('.ant-descriptions-item-content').last(),
    ).toHaveText('—')
    await expect(page.getByText('扣费原币金额')).toHaveCount(0)

    const rows = tableRows(page)
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText(urlA)
    await expect(rows.nth(1)).toContainText(urlB)
    await expect(
      rows.first().locator('td').nth(1).locator('input'),
    ).toHaveValue('2')
    await expect(
      rows.nth(1).locator('td').nth(1).locator('input'),
    ).toHaveValue('3')
  })

  test('2.6 后端 500 留在当前页', async ({ page }) => {
    const filePath = buildGoodsXlsxPath(
      [[uniqueUrl('FAIL500'), 1]],
      'pw-goods-500.xlsx',
    )

    await page.route('**/api/goods/orders/import', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '服务器错误' }),
      })
    })

    // 1. dealer 访问 /goods/create 并上传合法文件
    await page.goto('/goods/create')
    await waitForAppReady(page)
    await page.setInputFiles('input[type="file"]', filePath)
    await expect(message(page, '已解析 1 行')).toBeVisible({
      timeout: 15_000,
    })

    // 2. 点击「确认创建」，校验 loading 与错误提示
    await page.getByRole('button', { name: '确认创建' }).click()
    await expect(page.locator('main button.ant-btn-loading')).toBeVisible({
      timeout: 5_000,
    })
    await expect(message(page, '服务器错误')).toBeVisible({
      timeout: 30_000,
    })

    // 3. 校验 loading 结束、仍停留在创建页、预览与文件保留
    await expect(page.locator('main button.ant-btn-loading')).toHaveCount(0, {
      timeout: 30_000,
    })
    await expect(page).toHaveURL(/\/goods\/create$/)
    await expect(tableRows(page)).toHaveCount(1)
    const uploadItems = page.locator('.ant-upload-list-item')
    await expect(uploadItems).toHaveCount(1)
    await expect(uploadItems).toContainText('pw-goods-500.xlsx')
    await expect(
      page.getByRole('button', { name: '确认创建' }),
    ).toBeEnabled()
  })

  test('2.7 ops 直接访问创建页无法真正创建', async ({ browser }) => {
    const ctx = await contextFor(browser, opsState)
    const page = await ctx.newPage()
    const filePath = buildGoodsXlsxPath(
      [[uniqueUrl('OPSDENY'), 1]],
      'pw-goods-ops.xlsx',
    )

    // 1. ops 访问 /goods/create，确认页面正常渲染
    await page.goto('/goods/create')
    await waitForAppReady(page)
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      '创建预约',
    )
    await expectMenuVisible(page, ['创建预约', '预约订单'], false)

    // 2. ops 上传合法 Excel 完成本地解析
    await page.setInputFiles('input[type="file"]', filePath)
    await expect(message(page, '已解析 1 行')).toBeVisible({
      timeout: 15_000,
    })

    // 3. 点击「确认创建」，校验权限提示、无跳转、无订单生成
    await page.getByRole('button', { name: '确认创建' }).click()
    await expect(
      message(page, /Insufficient permission|权限不足|无权创建/),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/goods\/create$/)
    await expect(page.locator('main button.ant-btn-loading')).toHaveCount(0, {
      timeout: 30_000,
    })

    await ctx.close()
  })
})

test.describe('3. 预约订单列表', () => {
  test.use({ storageState: dealerState })

  test('3.1 列表结构与筛选控件', async ({ page }) => {
    // 1. dealer 访问 /goods/reserve
    await openReserveList(page)

    // 2. 校验加载完成后表格与分页器可见
    await expect(page.locator('main .ant-table-tbody')).toBeVisible({
      timeout: 45_000,
    })
    await expect(page.locator('main .ant-pagination')).toBeVisible()

    // 3. 校验列头顺序
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '订单号',
      '经销商',
      '状态',
      '价格',
      '币种',
      '商品行',
      '预约量',
      '履约量',
      '创建时间',
      '操作',
    ])

    // 4. 校验仅有状态筛选框，无经销商筛选
    await expect(page.locator('main .ant-select')).toHaveCount(1)
    await expect(page.locator('main .ant-select')).toContainText('状态')
    await expect(page.getByText('选择经销商')).toHaveCount(0)
  })

  test('3.2 按状态筛选并清空', async ({ page }) => {
    // 1. dealer 访问 /goods/reserve
    await openReserveList(page)

    // 2. 选择「预约中」，校验自动请求、页码重置与每行状态
    await selectStatus(page, '预约中')
    const statusCells = tableRows(page).locator('td:nth-child(3)')
    await expect
      .poll(async () => {
        const texts = await statusCells.allTextContents()
        return texts.length > 0 && texts.every((t) => t.includes('预约中'))
      }, { timeout: 30_000 })
      .toBe(true)
    await expect(page.locator('.ant-pagination-item-active')).toHaveText('1')

    // 3. 切换为「待履约」，校验结果
    await selectStatus(page, '待履约')
    await expect
      .poll(async () => {
        const texts = await statusCells.allTextContents()
        return texts.length > 0 && texts.every((t) => t.includes('待履约'))
      }, { timeout: 30_000 })
      .toBe(true)

    // 4. 清除状态筛选，校验恢复全部状态
    await page.locator('main .ant-select').hover()
    const clearResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/goods/orders/reserve') &&
        r.request().method() === 'GET',
    )
    await page.locator('main .ant-select-clear').click()
    await clearResponse
    await expect(
      page.locator('main .ant-select-selection-item'),
    ).toHaveCount(0)
    await expect
      .poll(async () => {
        const texts = await statusCells.allTextContents()
        return new Set(texts.map((t) => t.trim())).size > 1
      }, { timeout: 30_000 })
      .toBe(true)
  })

  test('3.3 查看订单详情', async ({ page }) => {
    const orderId = await createReserveOrder(page, [[uniqueUrl('VIEW'), 1]])

    // 1. dealer 访问 /goods/reserve
    await openReserveList(page)

    // 2. 在列表中找到新建订单并读取订单号
    const row = reserveRow(page, orderId)
    await expect(row).toBeVisible({ timeout: 45_000 })
    const orderNumber = (await row.locator('td').first().innerText()).trim()

    // 3. 点击「查看」跳转详情，校验标题与字段
    await row.getByRole('link', { name: '查看' }).click()
    await expect(page).toHaveURL(new RegExp(`/goods/reserve/${orderId}$`))
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      `订单 ${orderNumber}`,
      { timeout: 60_000 },
    )
    await expect(
      page.locator('main .ant-descriptions-item-label'),
    ).toHaveText(['经销商', '币种', '创建时间', '扣费单', '经销商备注'])
    await expect(page.locator('main .ant-table')).toBeVisible()
  })

  test('3.4 从列表取消订单并显示已取消', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('CANCELLIST'), 1],
    ])
    await openReserveList(page)
    const row = reserveRow(page, orderId)
    await expect(row).toBeVisible({ timeout: 60_000 })
    const orderNumber = (await row.locator('td').first().innerText()).trim()

    // 1. 点击行内「取消」，校验确认框标题与文案
    await row.getByRole('button', { name: '取消' }).click()
    const dialog = page.locator('.ant-modal-confirm')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('取消订单')
    await expect(dialog).toContainText(
      `确认取消订单 ${orderNumber}？取消后不可恢复。`,
    )
    await expect(
      dialog.getByRole('button', { name: /返\s*回/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: '确认取消' }),
    ).toBeVisible()

    // 2. 点击「确认取消」，校验提示、灰色已取消标签、取消按钮消失
    await dialog.getByRole('button', { name: '确认取消' }).click()
    await expect(message(page, '订单已取消')).toBeVisible({
      timeout: 90_000,
    })
    const cancelledRow = reserveRow(page, orderId)
    await expect(
      cancelledRow.locator('.ant-tag').filter({ hasText: '已取消' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      cancelledRow.getByRole('button', { name: '取消' }),
    ).toHaveCount(0)

    // 3. 打开详情，校验状态为已取消且无编辑操作
    await page.goto(`/goods/reserve/${orderId}`)
    await waitForAppReady(page)
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      `订单 ${orderNumber}`,
      { timeout: 90_000 },
    )
    await expect(
      page
        .locator('main .ant-card-head-title .ant-tag')
        .filter({ hasText: '已取消' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '取消订单' }),
    ).toHaveCount(0)
  })

  test('3.5 取消确认框点返回', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('CANCELBACK'), 1],
    ])
    await openReserveList(page)
    const row = reserveRow(page, orderId)
    await expect(row).toBeVisible({ timeout: 45_000 })

    // 1. 点击「取消」打开确认框
    await row.getByRole('button', { name: '取消' }).click()
    const dialog = page.locator('.ant-modal-confirm')
    await expect(dialog).toBeVisible()

    // 2. 点击「返回」，校验弹窗关闭、订单仍可取消、无取消成功提示
    await dialog.getByRole('button', { name: /返\s*回/ }).click()
    await expect(dialog).toBeHidden()
    const currentRow = reserveRow(page, orderId)
    await expect(
      currentRow.getByRole('button', { name: '取消' }),
    ).toBeVisible()
    await expect(currentRow.locator('td:nth-child(3)')).toContainText('预约中')
    await expect(
      currentRow.locator('.ant-tag').filter({ hasText: '已取消' }),
    ).toHaveCount(0)
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: '订单已取消' }),
    ).toHaveCount(0)
  })

  test('3.6 已履约订单不显示取消', async ({ page }) => {
    // 1. dealer 访问 /goods/reserve
    await openReserveList(page)

    // 2. 按「已履约」筛选
    await selectStatus(page, '已履约')
    const rows = tableRows(page)
    const statusCells = rows.locator('td:nth-child(3)')

    // 等待筛选结果稳定，避免在表格重渲染期间读取行数。
    await expect
      .poll(
        async () => {
          const texts = await statusCells.allTextContents()
          if (texts.length === 0) return 'empty'
          return texts.every((t) => t.includes('已履约'))
            ? 'ready'
            : 'pending'
        },
        { timeout: 30_000 },
      )
      .not.toBe('pending')
    if ((await rows.count()) === 0) {
      test.skip(true, '当前环境没有已履约订单，无法验证取消按钮隐藏')
    }

    // 3. 校验每行状态为已履约且操作列只有「查看」，无取消按钮
    const count = await rows.count()
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      await expect(row.locator('td:nth-child(3)')).toContainText('已履约')
      await expect(row.locator('td:nth-child(10)')).toContainText('查看')
      await expect(row.locator('button.ant-btn-dangerous')).toHaveCount(0)
      await expect(row.getByRole('button', { name: '取消' })).toHaveCount(0)
    }
  })

  test('3.7 分页切换', async ({ page }) => {
    // 1. dealer 访问 /goods/reserve
    await openReserveList(page)
    await expect(tableRows(page)).toHaveCount(20)

    // 2. 点击第 2 页，校验请求参数、页码高亮与 20 条数据
    const pager2 = page.locator('.ant-pagination-item-2')
    if ((await pager2.count()) === 0) {
      test.skip(true, '当前环境数据不足两页，无法验证分页')
    }
    const page2Request = page.waitForRequest(
      (r) =>
        r.url().includes('/api/goods/orders/reserve') &&
        /[?&]page=2(&|$)/.test(r.url()),
    )
    await pager2.click()
    const request2 = await page2Request
    expect(request2.url()).toContain('pageSize=20')
    await expect(page.locator('.ant-pagination-item-active')).toHaveText('2')
    await expect(tableRows(page)).toHaveCount(20)
    const page2First = (
      await tableRows(page).first().locator('td').first().innerText()
    ).trim()

    // 3. 返回第 1 页，校验请求参数与首行内容变化
    const page1Request = page.waitForRequest(
      (r) =>
        r.url().includes('/api/goods/orders/reserve') &&
        /[?&]page=1(&|$)/.test(r.url()),
    )
    await page.locator('.ant-pagination-item-1').click()
    await page1Request
    await expect(page.locator('.ant-pagination-item-active')).toHaveText('1')
    await expect(tableRows(page)).toHaveCount(20)
    const page1First = (
      await tableRows(page).first().locator('td').first().innerText()
    ).trim()
    expect(page1First).not.toBe(page2First)
  })

  test('3.8 筛选无结果空态', async ({ page }) => {
    await page.route('**/api/goods/orders/reserve*', async (route) => {
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

    // 1. dealer 访问 /goods/reserve
    await page.goto('/goods/reserve')
    await waitForAppReady(page)
    await expect(page.locator('main .ant-table')).toBeVisible({
      timeout: 45_000,
    })

    // 2. 选择「已履约」触发空结果
    await selectStatus(page, '已履约')

    // 3. 校验「暂无数据」、分页器隐藏且无错误提示
    await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: /失败|错误/ }),
    ).toHaveCount(0)
  })

  test.fixme('3.9 经销商数据隔离', async () => {
    // 依赖第二个经销商账号：本次执行不允许在 RBAC 后台创建/持久化共享登录账号。
    // 另实测 server/src/goods/goods.service.ts 的 listOrders 对 scope=reserve
    // 无条件追加 dealerUserId=actorId 条件，admin 的预约列表也只能看到自己的订单，
    // 与计划步骤 3（admin 能看到全部经销商订单）不一致。
  })
})

test.describe('4. 预约订单详情', () => {
  test.use({ storageState: dealerState })

  test('4.1 详情结构与可编辑区域', async ({ page }) => {
    const urlA = uniqueUrl('DETAIL1')
    const urlB = uniqueUrl('DETAIL2')
    const orderId = await createReserveOrder(page, [
      [urlA, 2],
      [urlB, 3],
    ])
    const order = await getOrder(page, orderId)

    // 1. dealer 打开预约中订单详情
    await openReserveDetail(page, orderId)

    // 2. 校验卡片标题、状态标签与价格标签
    const head = page.locator('main .ant-card-head-title')
    await expect(head).toContainText(`订单 ${order.orderNumber}`, {
      timeout: 60_000,
    })
    await expect(
      head.locator('.ant-tag').filter({ hasText: '预约中' }),
    ).toBeVisible()
    await expect(
      head.locator('.ant-tag').filter({ hasText: '价格未齐' }),
    ).toBeVisible()

    // 3. 校验描述字段：经销商、币种、创建时间、扣费单为「—」且无扣费金额
    await expect(
      page.locator('main .ant-descriptions-item-label'),
    ).toHaveText(['经销商', '币种', '创建时间', '扣费单', '经销商备注'])
    const feeRow = page.locator('main tr').filter({ hasText: '扣费单' })
    await expect(
      feeRow.locator('.ant-descriptions-item-content').last(),
    ).toHaveText('—')
    await expect(page.getByText('扣费原币金额')).toHaveCount(0)

    // 4. 校验明细表列、两行商品与操作按钮
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      'Amazon URL',
      '预约数量',
      `单价 (${order.currencyCode})`,
      '履约数量',
    ])
    const rows = tableRows(page)
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText(urlA)
    await expect(rows.nth(1)).toContainText(urlB)
    await expect(page.getByRole('button', { name: /保\s*存/ })).toBeVisible()
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '取消订单' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '同步全部价格' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '同步未填价格' }),
    ).toBeVisible()
  })

  test('4.2 填写单价保存', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('PRICE1'), 2],
      [uniqueUrl('PRICE2'), 3],
    ])
    await openReserveDetail(page, orderId)
    const priceInputs = page.locator(
      '[data-testid^="unit-price-"] input',
    )

    // 1. 在单价输入框中填写 10 与 5
    await priceInputs.nth(0).fill('10')
    await priceInputs.nth(1).fill('5')
    await expect(priceInputs.nth(0)).toHaveValue(/^10(\.00)?$/)
    await expect(priceInputs.nth(1)).toHaveValue(/^5(\.00)?$/)

    // 2. 校验修改后出现「恢复」「确定」，点击「保存」
    await expect(
      page.getByRole('button', { name: /恢\s*复/ }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /确\s*定/ }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: /保\s*存/ }).click()

    // 3. 校验「已保存」、价格已填完标签、刷新后单价保留
    await expect(message(page, '已保存')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '价格已填完' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.reload()
    await waitForAppReady(page)
    await expect(page.locator('main .ant-card-head-title')).toBeVisible({
      timeout: 60_000,
    })
    await expect(priceInputs.nth(0)).toHaveValue('10.00', {
      timeout: 30_000,
    })
    await expect(priceInputs.nth(1)).toHaveValue('5.00', {
      timeout: 30_000,
    })
  })

  test('4.3 修改单价恢复与确定', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('RESTORE1'), 2],
      [uniqueUrl('RESTORE2'), 3],
    ])
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 5])

    const rows = tableRows(page)
    const priceInputs = page.locator(
      '[data-testid^="unit-price-"] input',
    )

    // 1. 将第一行单价由 10 改为 12，校验出现「恢复」「确定」
    await priceInputs.nth(0).fill('12')
    await expect(priceInputs.nth(0)).toHaveValue('12')
    await expect(
      rows.first().getByRole('button', { name: /恢\s*复/ }),
    ).toBeVisible()
    await expect(
      rows.first().getByRole('button', { name: /确\s*定/ }),
    ).toBeVisible()

    // 2. 点击「恢复」，校验单价回到 10、按钮消失
    await rows.first().getByRole('button', { name: /恢\s*复/ }).click()
    await expect(priceInputs.nth(0)).toHaveValue('10.00')
    await expect(
      rows.first().getByRole('button', { name: /恢\s*复/ }),
    ).toHaveCount(0)
    await expect(
      rows.first().getByRole('button', { name: /确\s*定/ }),
    ).toHaveCount(0)

    // 3. 再次改为 12 并点击「确定」，校验单价保持 12、按钮消失
    await priceInputs.nth(0).fill('12')
    await rows.first().getByRole('button', { name: /确\s*定/ }).click()
    await expect(priceInputs.nth(0)).toHaveValue('12.00')
    await expect(
      rows.first().getByRole('button', { name: /恢\s*复/ }),
    ).toHaveCount(0)
    await expect(
      rows.first().getByRole('button', { name: /确\s*定/ }),
    ).toHaveCount(0)
  })

  test('4.4 修改预约数量保存', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('QTYEDIT'), 2],
    ])
    await openReserveDetail(page, orderId)
    const reserveInput = tableRows(page)
      .first()
      .locator('td')
      .nth(1)
      .locator('input')
    await expect(reserveInput).toHaveAttribute('aria-valuemin', '1')
    await expect(reserveInput).toHaveAttribute('step', '1')

    // 1. 将预约数量由 2 改为 3 并保存
    await reserveInput.fill('3')
    await page.getByRole('button', { name: /保\s*存/ }).click()
    await expect(message(page, '已保存')).toBeVisible({ timeout: 30_000 })

    // 2. 校验保存后数量为 3，输入框仍限制 min=1、整数精度
    await expect(reserveInput).toHaveValue('3', { timeout: 30_000 })
    await expect(reserveInput).toHaveAttribute('aria-valuemin', '1')
    await expect(reserveInput).toHaveAttribute('step', '1')

    // 3. 输入 0 与 -1，失焦后自动修正为 1
    await reserveInput.fill('0')
    await page.locator('main .ant-table-thead th:first-child').click()
    await expect(reserveInput).toHaveValue('1')
    await reserveInput.fill('-1')
    await page.locator('main .ant-table-thead th:first-child').click()
    await expect(reserveInput).toHaveValue('1')
  })

  test('4.5 未填全部单价提交履约被阻止', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('NOPRICE'), 1],
    ])
    await openReserveDetail(page, orderId)

    // 1. 未填写单价直接点击「提交履约」
    await page.getByRole('button', { name: '提交履约' }).click()

    // 2. 校验提示「请填写全部商品单价」、无确认框、状态仍为预约中
    await expect(message(page, '请填写全部商品单价')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('.ant-modal-confirm')).toHaveCount(0)
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '预约中' }),
    ).toBeVisible()
  })

  test('4.6 填价后提交履约', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('FULFILL1'), 2],
      [uniqueUrl('FULFILL2'), 3],
    ])
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 5])

    // 1. 点击「提交履约」，校验确认框标题与文案
    await page.getByRole('button', { name: '提交履约' }).click()
    const dialog = page.locator('.ant-modal-confirm')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText('提交履约')
    await expect(dialog).toContainText(
      '提交后订单进入「待履约」，单价将不可再修改。确认？',
    )

    // 2. 点击「确定」，校验成功提示与待履约状态
    // onOk 串行执行 保存(PUT+GET) -> 提交(POST+GET)，后端慢时整条链路可达 30s+。
    await dialog.getByRole('button', { name: /确\s*定|OK/i }).click()
    await expect(message(page, '已提交履约')).toBeVisible({
      timeout: 120_000,
    })
    await expect(dialog).toBeHidden({ timeout: 60_000 })
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '待履约' }),
    ).toBeVisible({ timeout: 60_000 })

    // 3. 校验单价输入框与提交/同步操作消失
    await expect(
      page.locator('[data-testid^="unit-price-"] input'),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '同步价格' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '同步全部价格' }),
    ).toHaveCount(0)
  })

  test('4.7 详情页取消订单', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('CANCELDETAIL'), 1],
    ])
    await openReserveDetail(page, orderId)

    // 1. 点击「取消订单」，校验确认框文案与按钮
    await page.getByRole('button', { name: '取消订单' }).click()
    const dialog = page.locator('.ant-modal-confirm')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('取消订单')
    await expect(dialog).toContainText('取消后不可恢复。')
    await expect(
      dialog.getByRole('button', { name: /返\s*回/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: '确认取消' }),
    ).toBeVisible()

    // 2. 点击「确认取消」，校验状态与操作按钮
    await dialog.getByRole('button', { name: '确认取消' }).click()
    await expect(message(page, '订单已取消')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page
        .locator('main .ant-card-head-title .ant-tag')
        .filter({ hasText: '已取消' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '取消订单' }),
    ).toHaveCount(0)
  })

  test('4.8 单行同步价格', async ({ page }) => {
    test.setTimeout(180_000)
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('SYNCITEM'), 1],
    ])
    await openReserveDetail(page, orderId)
    const syncBtn = tableRows(page)
      .first()
      .getByRole('button', { name: '同步价格' })

    // 1. 点击单行「同步价格」，等待抓取成功或失败提示
    await syncBtn.click()
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({
          hasText: /已抓取|未能解析|失败|未配置|503|Service/,
        })
        .first(),
    ).toBeVisible({ timeout: 120_000 })

    // 2. 校验按钮恢复可用、页面可继续编辑、无崩溃
    await expect(syncBtn).toBeEnabled({ timeout: 30_000 })
    await expect(
      page.locator('[data-testid^="unit-price-"] input').first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toBeVisible()
    await expect(page.locator('main .ant-card-head-title')).toContainText(
      '订单 ',
    )
  })

  test('4.9 批量同步价格', async ({ page }) => {
    test.setTimeout(240_000)
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('SYNCALL1'), 2],
      [uniqueUrl('SYNCALL2'), 3],
    ])
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 5])

    // 1. 全部单价已填时点击「同步未填价格」，校验提示
    await page.getByRole('button', { name: '同步未填价格' }).click()
    await expect(message(page, '没有需要同步的商品行')).toBeVisible({
      timeout: 15_000,
    })

    // 2. 点击「同步全部价格」，校验成功或失败提示
    await page.getByRole('button', { name: '同步全部价格' }).click()
    await expect(
      page
        .locator('.ant-message-notice-title')
        .filter({ hasText: /已同步 \d+ 行价格|行失败/ })
        .first(),
    ).toBeVisible({ timeout: 120_000 })

    // 3. 校验同步结束后按钮恢复可用
    await expect(
      page.getByRole('button', { name: '同步全部价格' }),
    ).toBeEnabled({ timeout: 30_000 })
    await expect(
      page.getByRole('button', { name: '同步未填价格' }),
    ).toBeEnabled({ timeout: 30_000 })
  })

  test('4.10 待履约只读仍可取消', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('READONLY1'), 2],
      [uniqueUrl('READONLY2'), 3],
    ])
    await openReserveDetail(page, orderId)
    await fillUnitPricesAndSave(page, [10, 5])
    await submitFulfill(page)

    // 1. 校验待履约订单明细为只读文本，无输入框
    const rows = tableRows(page)
    await expect(rows).toHaveCount(2)
    await expect(rows.first().locator('td').nth(1)).toHaveText('2')
    await expect(rows.first().locator('td').nth(2)).toContainText('USD 10.00')
    await expect(rows.nth(1).locator('td').nth(1)).toHaveText('3')
    await expect(rows.nth(1).locator('td').nth(2)).toContainText('USD 5.00')
    await expect(
      page.locator('main .ant-table-tbody input'),
    ).toHaveCount(0)

    // 2. 校验无保存/提交/同步按钮，但仍显示「取消订单」
    await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '同步价格' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '取消订单' }),
    ).toBeVisible()
  })

  test('4.11 权限越权与不存在订单', async ({ browser, page }) => {
    const dealerOrderId = await createReserveOrder(page, [
      [uniqueUrl('PERMDEALER'), 1],
    ])
    const dealerOrder = await getOrder(page, dealerOrderId)

    // 1. ops 打开经销商订单详情：可查看但只读，不出现 403
    const opsCtx = await contextFor(browser, opsState)
    const opsPage = await opsCtx.newPage()
    await opsPage.goto(`/goods/reserve/${dealerOrderId}`)
    await waitForAppReady(opsPage)
    await expect(opsPage.locator('main .ant-card-head-title')).toContainText(
      `订单 ${dealerOrder.orderNumber}`,
      { timeout: 90_000 },
    )
    await expect(opsPage.locator('main .ant-table')).toBeVisible()
    await expect(
      opsPage.locator('main .ant-table-tbody input'),
    ).toHaveCount(0)
    await expect(
      opsPage.getByRole('button', { name: /保\s*存/ }),
    ).toHaveCount(0)
    await expect(
      opsPage.getByRole('button', { name: '提交履约' }),
    ).toHaveCount(0)
    await expect(
      opsPage.getByRole('button', { name: '取消订单' }),
    ).toHaveCount(0)
    await expect(
      opsPage
        .locator('.ant-message-notice-title')
        .filter({ hasText: /Insufficient permission|无权查看/ }),
    ).toHaveCount(0)
    await opsCtx.close()

    // 2. admin 创建订单，dealer 打开时提示无权查看且不白屏
    const adminCtx = await contextFor(browser, adminState)
    const adminPage = await adminCtx.newPage()
    const adminOrderId = await createReserveOrder(adminPage, [
      [uniqueUrl('PERMADMIN'), 1],
    ])
    await page.goto(`/goods/reserve/${adminOrderId}`)
    await waitForAppReady(page)
    await expect(message(page, '无权查看该订单')).toBeVisible({
      timeout: 90_000,
    })
    // 空态由 GoodsOrderDetailPage 直接渲染 <Card>订单不存在</Card>，
    // 用 main 兜底，避免依赖 Card 内部 class 结构。
    await expect(page.locator('main')).toContainText('订单不存在', {
      timeout: 60_000,
    })
    await expect(page.locator('#root')).not.toBeEmpty()

    // 3. admin 访问不存在的订单 id，显示「订单不存在」且无白屏
    await adminPage.goto('/goods/reserve/999999991')
    await waitForAppReady(adminPage)
    await expect(adminPage.locator('main')).toContainText('订单不存在', {
      timeout: 90_000,
    })
    await expect(adminPage.locator('#root')).not.toBeEmpty()

    // 4. 访问非法订单 id，同样展示不存在空态且不崩溃
    await adminPage.goto('/goods/reserve/not-a-number')
    await waitForAppReady(adminPage)
    await expect(adminPage.locator('main')).toContainText('订单不存在', {
      timeout: 60_000,
    })
    await expect(adminPage.locator('#root')).not.toBeEmpty()
    await adminCtx.close()
  })

  test('4.12 零单价边界', async ({ page }) => {
    const orderId = await createReserveOrder(page, [
      [uniqueUrl('ZERO1'), 2],
      [uniqueUrl('ZERO2'), 3],
    ])
    await openReserveDetail(page, orderId)
    const priceInputs = page.locator(
      '[data-testid^="unit-price-"] input',
    )

    // 1. 将两行单价都填为 0 并保存
    await priceInputs.nth(0).fill('0')
    await priceInputs.nth(1).fill('0')
    await expect(priceInputs.nth(0)).toHaveValue(/^0(\.00)?$/)
    await expect(priceInputs.nth(1)).toHaveValue(/^0(\.00)?$/)
    await page.getByRole('button', { name: /保\s*存/ }).click()

    // 2. 校验保存成功与价格已填完标签
    await expect(message(page, '已保存')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('main .ant-tag').filter({ hasText: '价格已填完' }),
    ).toBeVisible({ timeout: 30_000 })

    // 3. 提交履约，校验零单价订单进入待履约
    await submitFulfill(page)
    const rows = tableRows(page)
    await expect(rows.first().locator('td').nth(2)).toContainText('USD 0.00')
    await expect(rows.nth(1).locator('td').nth(2)).toContainText('USD 0.00')
  })
})
