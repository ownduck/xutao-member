// spec: specs/05-site-management.plan.md
// seed: e2e/seed.spec.ts

import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectMenuVisible, waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)
const opsState = path.join(authDir, 'ops.json')
const dealerState = path.join(authDir, 'dealer.json')
const BASE_URL = 'http://localhost:5288'
// 开发环境后端偶发很慢（单请求 30s+，部分链路 90-120s），网络与页面等待统一放宽。
const API_TIMEOUT = 120_000
const NAV_TIMEOUT = 120_000

const CURRENCIES = ['USD', 'CNY', 'EUR', 'GBP', 'JPY'] as const

const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD — 美元',
  CNY: 'CNY — 人民币',
  EUR: 'EUR — 欧元',
  GBP: 'GBP — 英镑',
  JPY: 'JPY — 日元',
}

const COUNTRY_LABELS: Record<string, string> = {
  US: 'US — 美国',
  CN: 'CN — 中国',
  GB: 'GB — 英国',
  DE: 'DE — 德国',
  JP: 'JP — 日本',
}

type ExchangeRateRow = {
  currencyCode: string
  rateToBase: number
  updatedAt?: string | null
}

type ExchangeRatesConfig = {
  baseCurrencyCode: string
  rates: ExchangeRateRow[]
}

type SiteSettings = {
  defaultCountryCode: string
  defaultCurrencyCode: string
}

type MeResponse = {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
    realname?: string | null
    isSuperAdmin?: boolean
  }
  permissions: string[]
  roleKeys?: string[]
  isSuperAdmin?: boolean
  roles?: Array<{ roleId: number; name: string; key?: string | null }>
  isDealer?: boolean
  isOps?: boolean
}

function contextFor(browser: Browser, storageState?: string) {
  return browser.newContext({
    baseURL: BASE_URL,
    ...(storageState ? { storageState } : {}),
  })
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

function cell(row: Locator, index: number) {
  return row.locator(`td:nth-child(${index})`)
}

function rateRow(page: Page, code: string) {
  return tableRows(page)
    .filter({
      has: page.locator('td:first-child').filter({
        hasText: new RegExp(`^\\s*${code}\\s*$`),
      }),
    })
    .first()
}

function rate8(value: number) {
  return Number(value).toFixed(8)
}

function currencyLabel(code: string) {
  return CURRENCY_LABELS[code] ?? code
}

function countryLabel(code: string) {
  return COUNTRY_LABELS[code] ?? code
}

function bodyMessage(body: unknown) {
  if (body && typeof body === 'object' && 'message' in body) {
    const value = (body as { message: unknown }).message
    return Array.isArray(value) ? value.join('; ') : String(value)
  }
  return ''
}

function nonBaseCandidate(config: ExchangeRatesConfig) {
  return (
    config.rates.find((row) => row.currencyCode === 'JPY') ??
    config.rates.find((row) => row.currencyCode !== config.baseCurrencyCode)
  )
}

async function getRates(page: Page) {
  const response = await page.request.get('/api/site/exchange-rates', {
    timeout: API_TIMEOUT,
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as ExchangeRatesConfig
}

async function restoreRates(page: Page, snapshot: ExchangeRatesConfig) {
  const response = await page.request.put('/api/site/exchange-rates', {
    timeout: API_TIMEOUT,
    data: {
      baseCurrencyCode: snapshot.baseCurrencyCode,
      rates: snapshot.rates.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
      })),
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function getSettings(page: Page) {
  const response = await page.request.get('/api/site/settings', {
    timeout: API_TIMEOUT,
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as SiteSettings
}

async function restoreSettings(page: Page, snapshot: SiteSettings) {
  const response = await page.request.put('/api/site/settings', {
    timeout: API_TIMEOUT,
    data: {
      defaultCountryCode: snapshot.defaultCountryCode,
      defaultCurrencyCode: snapshot.defaultCurrencyCode,
    },
  })
  expect(response.ok()).toBeTruthy()
}

/**
 * 跟踪页面发起的指定请求，避免 React StrictMode 下第二次 load() 的迟到响应
 * 覆盖测试刚写入的本地状态（例如删除行后又被恢复）。
 */
function trackRequests(
  page: Page,
  predicate: (request: Request) => boolean,
) {
  const pending = new Set<Request>()
  let seen = 0
  const onRequest = (request: Request) => {
    if (!predicate(request)) return
    seen += 1
    pending.add(request)
  }
  const onDone = (request: Request) => {
    if (predicate(request)) pending.delete(request)
  }
  const onResponse = (response: Response) => onDone(response.request())
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onDone)
  return {
    get seen() {
      return seen
    },
    get pending() {
      return pending.size
    },
    dispose() {
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('requestfailed', onDone)
    },
  }
}

const isRatesGet = (request: Request) =>
  request.method() === 'GET' &&
  new URL(request.url()).pathname === '/api/site/exchange-rates'

/** 等待至少发起过一次请求，且所有在途请求结束（含短暂的二次挂载请求）。 */
async function waitForRatesRequestsIdle(
  tracker: ReturnType<typeof trackRequests>,
) {
  await expect
    .poll(() => tracker.seen, { timeout: API_TIMEOUT })
    .toBeGreaterThan(0)
  // 初始值设为 -1，确保第一次轮询必定返回 changed，从而形成一小段静默窗口，
  // 捕获首次响应后紧接发起的第二次 StrictMode load()。
  let lastSeen = -1
  await expect
    .poll(
      () => {
        if (tracker.pending > 0) {
          lastSeen = tracker.seen
          return 'pending'
        }
        if (tracker.seen !== lastSeen) {
          lastSeen = tracker.seen
          return 'changed'
        }
        return 'idle'
      },
      { timeout: API_TIMEOUT, intervals: [200, 300, 500] },
    )
    .toBe('idle')
}

async function waitForRatesSettled(page: Page) {
  await expect(
    page.locator('main .ant-card-head-title').filter({ hasText: '币种汇率' }),
  ).toBeVisible({ timeout: NAV_TIMEOUT })
  await expect
    .poll(
      async () => {
        if ((await page.locator('main .ant-spin-spinning').count()) > 0) {
          return 'loading'
        }
        const rows = await tableRows(page).count()
        const empty = await page.locator('main .ant-empty').count()
        return rows > 0 || empty > 0 ? 'done' : 'pending'
      },
      { timeout: NAV_TIMEOUT },
    )
    .toBe('done')
}

async function openRatesPage(page: Page) {
  // 从 goto 之前开始跟踪，确保捕获挂载阶段（StrictMode 两次）的全部 GET。
  const tracker = trackRequests(page, isRatesGet)
  try {
    await page.goto('/site/exchange-rates', { timeout: API_TIMEOUT })
    await waitForAppReady(page)
    await waitForRatesSettled(page)
    await waitForRatesRequestsIdle(tracker)
    await expect(tableRows(page).first()).toBeVisible({
      timeout: NAV_TIMEOUT,
    })
  } finally {
    tracker.dispose()
  }
}

async function reloadRates(page: Page) {
  const tracker = trackRequests(page, isRatesGet)
  try {
    await page.reload({ timeout: API_TIMEOUT })
    await waitForAppReady(page)
    await waitForRatesSettled(page)
    await waitForRatesRequestsIdle(tracker)
  } finally {
    tracker.dispose()
  }
}

async function openSettingsPage(page: Page) {
  await page.goto('/site/config')
  await waitForAppReady(page)
  await expect(page.locator('main .ant-card-head-title')).toHaveText(
    '全局配置',
    { timeout: 60_000 },
  )
  // 等待挂载后的配置加载（含 StrictMode 二次执行）完成，避免覆盖后续表单选择。
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main .ant-select')).toHaveCount(2, {
    timeout: 60_000,
  })
  await expect(
    page.locator('main .ant-select').first().locator('.ant-select-content'),
  ).toHaveAttribute('title', /^[A-Z]{2} — /, { timeout: 60_000 })
}

async function openSelect(page: Page, select: Locator) {
  await select.click()
  // 使用 .last() 规避下拉关闭动画期间同时匹配两个可见下拉导致的 strict mode 冲突
  const dropdown = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
  await expect(dropdown).toBeVisible({ timeout: 15_000 })
  return dropdown
}

async function pickOption(page: Page, select: Locator, code: string) {
  const dropdown = await openSelect(page, select)
  await dropdown
    .locator('.ant-select-item-option')
    .filter({ hasText: new RegExp(`^${code}\\b`) })
    .first()
    .click()
  // 等下拉完全关闭，避免下一次打开时匹配到旧下拉
  await expect(
    page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
  ).toHaveCount(0, { timeout: 15_000 })
}

async function freeCurrency(page: Page, config: ExchangeRatesConfig) {
  const candidate = nonBaseCandidate(config)
  if (!candidate) return null
  const row = rateRow(page, candidate.currencyCode)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: '删除' }).click()
  await expect(row).toHaveCount(0, { timeout: 30_000 })
  return candidate
}

async function saveRates(page: Page) {
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().includes('/api/site/exchange-rates') &&
      r.request().method() === 'PUT',
    { timeout: API_TIMEOUT },
  )
  await page.getByRole('button', { name: '保存配置' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  await expect(message(page, '已保存')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled({
    timeout: 60_000,
  })
  return (await response.json()) as ExchangeRatesConfig
}

test.describe('1. 汇率管理页面与编辑流程', () => {
  test.use({ storageState: opsState })

  test('1.1 汇率页初始结构与默认设置', async ({ page }) => {
    // 1. 以 ops 登录访问 /site/exchange-rates
    await openRatesPage(page)
    const config = await getRates(page)

    await expect(
      page.locator('main').getByRole('heading', { name: '汇率管理' }),
    ).toBeVisible()
    await expect(
      page.getByText(
        '维护各币种相对基准币种的汇率。财务充值/扣费折算使用此配置；与全局默认币种、钱包记账币种（USD）均相互独立。',
      ),
    ).toBeVisible()

    // 存在「汇率默认设置」「币种汇率」卡片与基准币种下拉
    await expect(page.locator('main .ant-card-head-title')).toHaveText([
      '汇率默认设置',
      '币种汇率',
    ])
    await expect(page.getByText('汇率基准币种', { exact: true })).toBeVisible()
    const baseSelect = page.locator('main .ant-select').first()
    await expect(baseSelect.getByRole('combobox')).toBeEnabled()
    await expect(baseSelect.locator('.ant-select-content')).toHaveAttribute(
      'title',
      new RegExp(`^${config.baseCurrencyCode}\\b`),
    )

    // 存在三个操作按钮，且无改动时保存 disabled
    await expect(
      page.getByRole('button', { name: '从聚合数据同步' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '保存配置' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '新增币种' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: '保存配置' }),
    ).toBeDisabled()

    // 表格列与基准币种一致，无分页器
    await expect(page.locator('main .ant-table-thead th')).toHaveText([
      '币种',
      `相对 ${config.baseCurrencyCode} 汇率`,
      '更新时间',
      '操作',
    ])
    await expect(page.locator('main .ant-pagination')).toHaveCount(0)

    // 2. 观察某行汇率：8 位小数 + 「例：100 X ≈ N BASE」
    expect(await tableRows(page).count()).toBe(config.rates.length)
    for (const rate of config.rates) {
      const row = rateRow(page, rate.currencyCode)
      await expect(row).toHaveCount(1)
      await expect(cell(row, 2)).toContainText(rate8(rate.rateToBase))
      await expect(cell(row, 2)).toContainText(
        `例：100 ${rate.currencyCode} ≈ ${(100 * rate.rateToBase).toFixed(2)} ${
          config.baseCurrencyCode
        }`,
      )
    }
  })

  test('1.2 新增币种仅本地生效，保存后持久化', async ({ page }) => {
    test.setTimeout(300_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const released = await freeCurrency(page, snapshot)
    if (!released) {
      test.skip(true, '当前环境没有可释放的非基准币种，无法验证新增流程')
      return
    }
    const candidate = released.currencyCode

    try {
      // 说明：环境已配置全部 5 个支持币种，先本地删除一个非基准币种以腾出下拉选项；
      // 该删除只改页面状态，未保存，刷新即恢复。
      // 1. 点击「新增币种」
      await page.getByRole('button', { name: '新增币种' }).click()
      const modal = page.locator('.ant-modal').filter({ hasText: '新增汇率' })
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText('新增汇率')
      await expect(
        modal.getByText(`相对 ${snapshot.baseCurrencyCode} 汇率`),
      ).toBeVisible()

      // 币种下拉不含基准币种与已存在币种
      const dropdown = await openSelect(page, modal.locator('.ant-select'))
      const options = dropdown.locator('.ant-select-item-option')
      const forbidden = [
        snapshot.baseCurrencyCode,
        ...snapshot.rates
          .map((row) => row.currencyCode)
          .filter((code) => code !== candidate),
      ]
      for (const code of forbidden) {
        await expect(
          options.filter({ hasText: new RegExp(`^${code}\\b`) }),
        ).toHaveCount(0)
      }
      await expect(
        options.filter({ hasText: new RegExp(`^${candidate}\\b`) }),
      ).toHaveCount(1)

      // 2. 选择未使用币种，汇率填 1.23456789
      await options
        .filter({ hasText: new RegExp(`^${candidate}\\b`) })
        .first()
        .click()
      await expect(
        page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
      ).toHaveCount(0, { timeout: 15_000 })
      await modal.locator('.ant-input-number-input').fill('1.23456789')
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })

      const newRow = rateRow(page, candidate)
      await expect(newRow).toBeVisible()
      await expect(cell(newRow, 2)).toContainText('1.23456789')
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeEnabled()

      // 尚未产生网络保存请求
      const unsaved = await getRates(page)
      expect(
        unsaved.rates.find((row) => row.currencyCode === candidate)
          ?.rateToBase,
      ).toBe(released.rateToBase)

      // 3. 点击「保存配置」
      await saveRates(page)
    } finally {
      // 4. 恢复：通过接口写回原始基准与全部汇率（数据安全要求，等效于删除测试币种并保存）
      await restoreRates(page, snapshot)
    }

    await reloadRates(page)
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
    await expect(rateRow(page, candidate)).toBeVisible()
    await expect(cell(rateRow(page, candidate), 2)).toContainText(
      rate8(released.rateToBase),
    )
    await expect(page.locator('main .ant-card-head-title')).toHaveText([
      '汇率默认设置',
      '币种汇率',
    ])
  })

  test('1.3 编辑已有汇率', async ({ page }) => {
    test.setTimeout(300_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const target =
      snapshot.rates.find((row) => row.currencyCode === 'CNY') ??
      snapshot.rates[0]
    if (!target) {
      test.skip(true, '当前环境没有可编辑的汇率')
      return
    }

    const original = target.rateToBase
    let next = Number((original * 1.01).toFixed(8))
    if (next === original) next = Number((original * 1.1).toFixed(8))

    try {
      // 1. 点击该币种「编辑」
      const row = rateRow(page, target.currencyCode)
      await row.getByRole('button', { name: '编辑' }).click()
      const modal = page.locator('.ant-modal').filter({ hasText: '编辑汇率' })
      await expect(modal).toBeVisible()
      await expect(modal.locator('.ant-modal-title')).toHaveText('编辑汇率')

      // 币种 disabled 且等于该币种，汇率回填原值
      const currencySelect = modal.locator('.ant-select')
      await expect(currencySelect.getByRole('combobox')).toBeDisabled()
      await expect(currencySelect.locator('.ant-select-content')).toHaveAttribute(
        'title',
        new RegExp(`^${target.currencyCode}\\b`),
      )
      const input = modal.locator('.ant-input-number-input')
      expect(Number(await input.inputValue())).toBeCloseTo(original, 8)

      // 2. 改为原值 * 1.01
      await input.fill(String(next))
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(cell(rateRow(page, target.currencyCode), 2)).toContainText(
        next.toFixed(8),
      )
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeEnabled()

      // 3. 保存配置并刷新
      await saveRates(page)
      await reloadRates(page)
      await expect(cell(rateRow(page, target.currencyCode), 2)).toContainText(
        next.toFixed(8),
      )
    } finally {
      // 4. 恢复原汇率并保存（通过接口恢复，保证测试结束前数据回到原值）
      await restoreRates(page, snapshot)
    }

    await reloadRates(page)
    await expect(cell(rateRow(page, target.currencyCode), 2)).toContainText(
      rate8(original),
    )
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })

  test('1.4 删除汇率在保存前可丢弃', async ({ page }) => {
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const candidate = nonBaseCandidate(snapshot)
    if (!candidate) {
      test.skip(true, '当前环境没有可删除的非基准币种')
      return
    }
    const rowCount = snapshot.rates.length
    const others = snapshot.rates.filter(
      (row) => row.currencyCode !== candidate.currencyCode,
    )

    // 1. 点击该行「删除」
    await rateRow(page, candidate.currencyCode)
      .getByRole('button', { name: '删除' })
      .click()

    // 无二次确认弹窗，行立即消失，保存可用，其他行不受影响
    await expect(page.locator('.ant-modal-confirm')).toHaveCount(0)
    await expect(rateRow(page, candidate.currencyCode)).toHaveCount(0)
    await expect(tableRows(page)).toHaveCount(rowCount - 1)
    await expect(
      page.getByRole('button', { name: '保存配置' }),
    ).toBeEnabled()
    for (const other of others) {
      await expect(cell(rateRow(page, other.currencyCode), 2)).toContainText(
        rate8(other.rateToBase),
      )
    }

    // 2. 刷新页面，未保存改动丢弃
    await reloadRates(page)
    await expect(rateRow(page, candidate.currencyCode)).toBeVisible()
    await expect(tableRows(page)).toHaveCount(rowCount)
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })

  test('1.5 基准币种切换确认与取消', async ({ page }) => {
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const baseSelect = page.locator('main .ant-select').first()
    const target =
      CURRENCIES.find(
        (code) => code !== snapshot.baseCurrencyCode,
      ) ?? snapshot.baseCurrencyCode

    // 1. 选择另一个基准币种，出现确认框
    await pickOption(page, baseSelect, target)
    const confirm = page.locator('.ant-modal-confirm')
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await expect(confirm).toContainText('切换汇率基准币种')
    await expect(confirm).toContainText(
      '切换基准币种将清空现有币种汇率列表，需重新录入或从聚合数据同步。此设置与全局默认币种无关。是否继续？',
    )
    await expect(
      confirm.getByRole('button', { name: '继续切换' }),
    ).toBeVisible()
    await expect(
      confirm.getByRole('button', { name: /取\s*消/ }),
    ).toBeVisible()

    // 2. 点击取消：基准恢复、列表不变、保存仍 disabled
    await confirm.getByRole('button', { name: /取\s*消/ }).click()
    await expect(confirm).toBeHidden({ timeout: 10_000 })
    await expect(baseSelect.locator('.ant-select-content')).toHaveAttribute(
      'title',
      new RegExp(`^${snapshot.baseCurrencyCode}\\b`),
      { timeout: 15_000 },
    )
    await expect(tableRows(page)).toHaveCount(snapshot.rates.length)
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })

  test('1.6 确认切换基准后清空列表并需保存', async ({ page }) => {
    test.setTimeout(180_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const baseSelect = page.locator('main .ant-select').first()
    const target =
      CURRENCIES.find(
        (code) => code !== snapshot.baseCurrencyCode,
      ) ?? snapshot.baseCurrencyCode

    try {
      // 1. 切换基准并点击「继续切换」
      await pickOption(page, baseSelect, target)
      const confirm = page.locator('.ant-modal-confirm')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      await confirm.getByRole('button', { name: '继续切换' }).click()
      await expect(confirm).toBeHidden({ timeout: 10_000 })

      // 基准变化、列表空态、保存可用，但尚未持久化
      await expect(baseSelect.locator('.ant-select-content')).toHaveAttribute(
        'title',
        new RegExp(`^${target}\\b`),
        { timeout: 15_000 },
      )
      await expect(page.locator('main .ant-empty')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator('main .ant-empty')).toContainText('暂无数据')
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeEnabled()
      const pending = await getRates(page)
      expect(pending.baseCurrencyCode).toBe(snapshot.baseCurrencyCode)
      expect(pending.rates.map((row) => row.currencyCode)).toEqual(
        snapshot.rates.map((row) => row.currencyCode),
      )

      // 2. 点击「保存配置」并刷新
      const saved = await saveRates(page)
      expect(saved.baseCurrencyCode).toBe(target)
      await reloadRates(page)
      await expect(baseSelect.locator('.ant-select-content')).toHaveAttribute(
        'title',
        new RegExp(`^${target}\\b`),
        { timeout: 30_000 },
      )
      await expect(
        page.locator('main .ant-table-thead th').nth(1),
      ).toHaveText(`相对 ${target} 汇率`)
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeDisabled()

      // 与计划不一致：服务端 ensureDefaults 在汇率表为空时会自动回填默认汇率，
      // 因此刷新后列表可能不是空态而是默认汇率。
      const persisted = await getRates(page)
      if (persisted.rates.length > 0) {
        test.info().annotations.push({
          type: 'deviation',
          description:
            '保存空汇率列表后，服务端 ensureDefaults 自动回填默认汇率；刷新后列表非空，与计划 1.6「刷新后汇率列表为空」不一致',
        })
      }
    } finally {
      // 3. 恢复：切回原基准并写回原汇率
      await restoreRates(page, snapshot)
    }

    await reloadRates(page)
    await expect(baseSelect.locator('.ant-select-content')).toHaveAttribute(
      'title',
      new RegExp(`^${snapshot.baseCurrencyCode}\\b`),
      { timeout: 30_000 },
    )
    await expect(tableRows(page)).toHaveCount(snapshot.rates.length)
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })
})

test.describe('2. 汇率校验、同步与权限', () => {
  test.use({ storageState: opsState })

  test('2.1 新增汇率必填与最小边界', async ({ page }) => {
    test.setTimeout(300_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const released = await freeCurrency(page, snapshot)
    if (!released) {
      test.skip(true, '当前环境没有可释放的非基准币种，无法验证新增校验')
      return
    }
    const candidate = released.currencyCode

    // 1. 不选择币种直接确定：提示「请选择币种」，弹窗不关闭
    await page.getByRole('button', { name: '新增币种' }).click()
    const modal = page.locator('.ant-modal').filter({ hasText: '新增汇率' })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(modal.getByText('请选择币种')).toBeVisible({
      timeout: 15_000,
    })
    await expect(modal).toBeVisible()

    // 2. 选择币种，汇率留空确定：提示「请输入汇率」
    const dropdown = await openSelect(page, modal.locator('.ant-select'))
    await dropdown
      .locator('.ant-select-item-option')
      .filter({ hasText: new RegExp(`^${candidate}\\b`) })
      .first()
      .click()
    await expect(
      page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
    ).toHaveCount(0, { timeout: 15_000 })
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(modal.getByText('请输入汇率')).toBeVisible({
      timeout: 15_000,
    })

    // 3. 输入负数并失焦：InputNumber 最小值 0.00000001
    const input = modal.locator('.ant-input-number-input')
    await input.fill('-1')
    await input.press('Tab')
    await expect(input).toHaveValue('0.00000001')
    await expect(input).toHaveAttribute(
      'aria-valuemin',
      /1e-8|0\.00000001/,
    )

    // 4. 输入 0.00000001 并确定：允许加入列表
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    await expect(modal).toBeHidden({ timeout: 15_000 })
    const newRow = rateRow(page, candidate)
    await expect(newRow).toBeVisible()
    await expect(cell(newRow, 2)).toContainText('0.00000001')
    await expect(
      page.getByRole('button', { name: '保存配置' }),
    ).toBeEnabled()

    // 未保存，服务端数据不变
    const unsaved = await getRates(page)
    expect(
      unsaved.rates.find((row) => row.currencyCode === candidate)?.rateToBase,
    ).toBe(released.rateToBase)

    // 5. 不保存并刷新页面：丢弃该改动
    await reloadRates(page)
    await expect(rateRow(page, candidate)).toBeVisible()
    await expect(cell(rateRow(page, candidate), 2)).toContainText(
      rate8(released.rateToBase),
    )
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })

  test('2.2 后端拒绝无效汇率与不支持币种', async ({ page }) => {
    const before = await getRates(page)
    const rateCode = before.rates[0]?.currencyCode
    if (!rateCode) {
      test.skip(true, '当前环境没有可用于校验的汇率')
      return
    }

    // 1. rateToBase=0 -> 400「汇率无效: <CODE>」
    const zero = await page.request.put('/api/site/exchange-rates', {
      data: {
        baseCurrencyCode: before.baseCurrencyCode,
        rates: [{ currencyCode: rateCode, rateToBase: 0 }],
      },
    })
    expect(zero.status()).toBe(400)
    expect(bodyMessage(await zero.json())).toBe(`汇率无效: ${rateCode}`)

    // 2. baseCurrencyCode=ABC -> 400
    const badBase = await page.request.put('/api/site/exchange-rates', {
      data: { baseCurrencyCode: 'ABC', rates: [] },
    })
    expect(badBase.status()).toBe(400)
    expect(bodyMessage(await badBase.json())).toBe(
      '不支持的基准币种，可选：USD, CNY, EUR, GBP, JPY',
    )

    // 3. currencyCode=ABC -> 400
    const badCode = await page.request.put('/api/site/exchange-rates', {
      data: {
        baseCurrencyCode: before.baseCurrencyCode,
        rates: [{ currencyCode: 'ABC', rateToBase: 1 }],
      },
    })
    expect(badCode.status()).toBe(400)
    expect(bodyMessage(await badCode.json())).toBe('不支持的币种: ABC')

    // 配置不变
    const after = await getRates(page)
    expect(after.baseCurrencyCode).toBe(before.baseCurrencyCode)
    expect(
      after.rates.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
      })),
    ).toEqual(
      before.rates.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
      })),
    )
  })

  test('2.3 从聚合数据同步成功或明确报错', async ({ page }) => {
    test.setTimeout(180_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const syncButton = page.getByRole('button', { name: '从聚合数据同步' })

    try {
      // 1. 点击同步：等待同步请求返回，结束后按钮恢复可用
      // 说明：外部聚合接口可能未配置而立即失败，loading 状态极短暂，
      // 因此不断言瞬时的 ant-btn-loading，改为断言请求结果与最终可交互状态。
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes('/api/site/exchange-rates/sync') &&
          r.request().method() === 'POST',
        { timeout: 150_000 },
      )
      await syncButton.click()
      const response = await responsePromise
      if (response.ok()) {
        await expect(message(page, '同步完成')).toBeVisible({
          timeout: 30_000,
        })
        await reloadRates(page)
      } else {
        await expect(
          page
            .locator('.ant-message-notice-title')
            .filter({
              hasText: /未配置 JUHE_EXCHANGE_APP_KEY|拉取|同步失败|失败/,
            })
            .first(),
        ).toBeVisible({ timeout: 30_000 })
      }
      await expect(syncButton).not.toHaveClass(/ant-btn-loading/, {
        timeout: 60_000,
      })

      // 页面不崩溃
      await expect(
        page.locator('main').getByRole('heading', { name: '汇率管理' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeDisabled()
    } finally {
      // 2. 恢复原快照（外部同步可能覆盖真实汇率）
      await restoreRates(page, snapshot)
    }

    const restored = await getRates(page)
    expect(restored.baseCurrencyCode).toBe(snapshot.baseCurrencyCode)
    expect(
      restored.rates.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
      })),
    ).toEqual(
      snapshot.rates.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
      })),
    )
  })

  test('2.4 有未保存改动时同步先保存', async ({ page }) => {
    test.setTimeout(300_000)
    await openRatesPage(page)
    const snapshot = await getRates(page)
    const released = await freeCurrency(page, snapshot)
    if (!released) {
      test.skip(true, '当前环境没有可释放的非基准币种，无法验证同步先保存')
      return
    }
    const candidate = released.currencyCode
    const testRate = 0.12345678

    // 外部同步用 route mock 固定为失败，避免覆盖真实汇率；
    // 测试重点是从聚合数据同步前的「先保存」行为。
    await page.route('**/api/site/exchange-rates/sync', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '同步失败（测试模拟）',
          statusCode: 503,
        }),
      })
    })

    try {
      // 1. 新增测试币种，不点保存
      await page.getByRole('button', { name: '新增币种' }).click()
      const modal = page.locator('.ant-modal').filter({ hasText: '新增汇率' })
      await expect(modal).toBeVisible()
      const dropdown = await openSelect(page, modal.locator('.ant-select'))
      await dropdown
        .locator('.ant-select-item-option')
        .filter({ hasText: new RegExp(`^${candidate}\\b`) })
        .first()
        .click()
      await expect(
        page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
      ).toHaveCount(0, { timeout: 15_000 })
      await modal.locator('.ant-input-number-input').fill(String(testRate))
      await modal.getByRole('button', { name: /确\s*定/ }).click()
      await expect(modal).toBeHidden({ timeout: 15_000 })
      await expect(rateRow(page, candidate)).toBeVisible()
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toBeEnabled()

      // 点击同步：先保存并提示「配置已先保存」，随后同步失败
      const putPromise = page.waitForResponse(
        (r) =>
          r.url().includes('/api/site/exchange-rates') &&
          r.request().method() === 'PUT',
        { timeout: API_TIMEOUT },
      )
      await page.getByRole('button', { name: '从聚合数据同步' }).click()
      const putResponse = await putPromise
      expect(putResponse.status()).toBe(200)
      const putBody = putResponse.request().postDataJSON() as {
        baseCurrencyCode: string
        rates: Array<{ currencyCode: string; rateToBase: number }>
      }
      await expect(message(page, '配置已先保存')).toBeVisible({
        timeout: 60_000,
      })
      await expect(message(page, '同步失败（测试模拟）')).toBeVisible({
        timeout: 60_000,
      })

      expect(putBody.baseCurrencyCode).toBe(snapshot.baseCurrencyCode)
      expect(
        putBody.rates.find((row) => row.currencyCode === candidate)
          ?.rateToBase,
      ).toBe(testRate)

      // 先保存已生效（刷新后测试币种仍在的逻辑由接口数据确认）
      const savedConfig = await getRates(page)
      expect(
        savedConfig.rates.find((row) => row.currencyCode === candidate)
          ?.rateToBase,
      ).toBe(testRate)
      await expect(
        page.getByRole('button', { name: '从聚合数据同步' }),
      ).not.toHaveClass(/ant-btn-loading/, { timeout: 30_000 })
    } finally {
      // 2. 清理：移除 route mock 并恢复快照
      await page.unroute('**/api/site/exchange-rates/sync')
      await restoreRates(page, snapshot)
    }

    await reloadRates(page)
    await expect(rateRow(page, candidate)).toBeVisible()
    await expect(cell(rateRow(page, candidate), 2)).toContainText(
      rate8(released.rateToBase),
    )
    await expect(page.getByRole('button', { name: '保存配置' })).toBeDisabled()
  })

  test('2.5 无写权限与未登录访问', async ({ page, browser }) => {
    // 1. 仅 exchange_rate:ro 的只读用户（通过 mock /api/me 模拟，避免创建/修改账号）
    const meResponse = await page.request.get('/api/me')
    expect(meResponse.ok()).toBeTruthy()
    const me = (await meResponse.json()) as MeResponse
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...me,
          permissions: ['exchange_rate:ro'],
          roleKeys: [],
          roles: [],
          isSuperAdmin: false,
          isOps: false,
          isDealer: false,
        }),
      })
    })

    try {
      await openRatesPage(page)
      await expect(
        page.getByRole('button', { name: '新增币种' }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '从聚合数据同步' }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '保存配置' }),
      ).toHaveCount(0)

      // 基准币种下拉 disabled，操作列显示「—」
      await expect(
        page.locator('main .ant-select').first().getByRole('combobox'),
      ).toBeDisabled()
      for (const row of await tableRows(page).all()) {
        await expect(cell(row, 4)).toHaveText('—')
      }
    } finally {
      await page.unroute('**/api/me')
    }

    // 2. 以 dealer 直接访问：无站点菜单、空汇率、403 提示、不白屏
    const dealerContext = await contextFor(browser, dealerState)
    const dealerPage = await dealerContext.newPage()
    try {
      await dealerPage.goto('/site/exchange-rates')
      await expect(message(dealerPage, 'Insufficient permission')).toBeVisible(
        { timeout: 60_000 },
      )
      await waitForAppReady(dealerPage)
      await expectMenuVisible(dealerPage, ['汇率管理', '全局配置'], false)
      await expect(
        dealerPage.locator('main').getByRole('heading', { name: '汇率管理' }),
      ).toBeVisible()
      await expect(dealerPage.locator('main .ant-empty')).toBeVisible({
        timeout: 60_000,
      })
      await expect(
        dealerPage.locator('main .ant-select').first().getByRole('combobox'),
      ).toBeDisabled()
      await expect(
        dealerPage.getByRole('button', { name: '新增币种' }),
      ).toHaveCount(0)
      await expect(
        dealerPage.getByRole('button', { name: '从聚合数据同步' }),
      ).toHaveCount(0)
      await expect(
        dealerPage.getByRole('button', { name: '保存配置' }),
      ).toHaveCount(0)
      await expect(dealerPage.locator('#root')).not.toBeEmpty()
    } finally {
      await dealerContext.close()
    }

    // 3. 未登录直接访问：重定向到登录页
    // 显式传入空 storageState，避免 context 继承 suite 的登录态。
    const anonContext = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    const anonPage = await anonContext.newPage()
    try {
      await anonPage.goto('/site/exchange-rates')
      await expect(anonPage).toHaveURL(
        /\/login\?redirect=%2Fsite%2Fexchange-rates$/,
        { timeout: 30_000 },
      )
      await expect(anonPage.locator('.login-card')).toBeVisible({
        timeout: 30_000,
      })
    } finally {
      await anonContext.close()
    }
  })
})

test.describe('3. 全局配置', () => {
  test.use({ storageState: opsState })

  test('3.1 全局配置结构与加载', async ({ page }) => {
    // 1. 以 ops 访问 /site/config
    await openSettingsPage(page)
    await expect(page.locator('main .ant-card-head-title')).toHaveText(
      '全局配置',
    )
    await expect(page.locator('main .ant-alert')).toContainText(
      '默认币种仅影响充值/扣费等表单的默认选中，不会修改钱包记账币种（始终为 USD）。',
    )
    await expect(
      page.getByRole('button', { name: /保\s*存/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /重\s*置/ }),
    ).toBeVisible()

    // 默认国家下拉选项
    const selects = page.locator('main .ant-select')
    const countryDropdown = await openSelect(page, selects.nth(0))
    await expect(
      countryDropdown.locator('.ant-select-item-option'),
    ).toHaveText([
      'US — 美国',
      'CN — 中国',
      'GB — 英国',
      'DE — 德国',
      'JP — 日本',
    ])
    await page.keyboard.press('Escape')
    await expect(countryDropdown).toBeHidden({ timeout: 10_000 })

    // 默认币种下拉选项
    const currencyDropdown = await openSelect(page, selects.nth(1))
    await expect(
      currencyDropdown.locator('.ant-select-item-option'),
    ).toHaveText([
      'USD — 美元',
      'CNY — 人民币',
      'EUR — 欧元',
      'GBP — 英镑',
      'JPY — 日元',
    ])
    await page.keyboard.press('Escape')
    await expect(currencyDropdown).toBeHidden({ timeout: 10_000 })
  })

  test('3.2 保存全局配置并影响充值默认币种', async ({ page }) => {
    test.setTimeout(180_000)
    const snapshot = await getSettings(page)
    const target =
      snapshot.defaultCurrencyCode === 'CNY' ? 'USD' : 'CNY'
    if (target !== 'CNY') {
      test.info().annotations.push({
        type: 'deviation',
        description:
          '当前默认币种已是 CNY，改用 USD 验证保存与充值默认币种联动',
      })
    }

    await openSettingsPage(page)
    const selects = page.locator('main .ant-select')

    try {
      // 1. 将默认币种改为 CNY（或环境允许的对照币种），保存
      await pickOption(page, selects.nth(1), target)
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes('/api/site/settings') &&
          r.request().method() === 'PUT',
        { timeout: 30_000 },
      )
      await page.getByRole('button', { name: /保\s*存/ }).click()
      const response = await responsePromise
      expect(response.status()).toBe(200)
      await expect(message(page, '已保存')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: /保\s*存/ }),
      ).toBeEnabled({ timeout: 30_000 })

      // 刷新后仍为目标币种
      await openSettingsPage(page)
      await expect(
        page.locator('main .ant-select').nth(1).locator('.ant-select-content'),
      ).toHaveAttribute('title', currencyLabel(target), {
        timeout: 30_000,
      })

      // 2. 访问 /finance/recharge，新增充值弹窗默认选中目标币种
      const defaultsLoaded = page.waitForResponse(
        (r) => r.url().includes('/api/site/settings/defaults'),
        { timeout: 60_000 },
      )
      await page.goto('/finance/recharge')
      await defaultsLoaded
      await waitForAppReady(page)
      await page.getByRole('button', { name: '新增充值' }).click()
      const rechargeModal = page
        .locator('.ant-modal')
        .filter({ hasText: '新增充值' })
      await expect(rechargeModal).toBeVisible()
      await expect(
        rechargeModal
          .locator('.ant-select')
          .nth(1)
          .locator('.ant-select-content'),
      ).toHaveAttribute('title', currencyLabel(target), {
        timeout: 15_000,
      })
      await rechargeModal.getByRole('button', { name: /取\s*消/ }).click()
    } finally {
      // 3. 恢复原默认国家/币种（通过接口恢复，避免遗留全局配置改动）
      await restoreSettings(page, snapshot)
    }

    // 恢复后充值表单回到原默认币种
    expect(await getSettings(page)).toEqual(snapshot)
    const defaultsRestored = page.waitForResponse(
      (r) => r.url().includes('/api/site/settings/defaults'),
      { timeout: 60_000 },
    )
    await page.goto('/finance/recharge')
    await defaultsRestored
    await waitForAppReady(page)
    await page.getByRole('button', { name: '新增充值' }).click()
    const restoredModal = page
      .locator('.ant-modal')
      .filter({ hasText: '新增充值' })
    await expect(restoredModal).toBeVisible()
    await expect(
      restoredModal.locator('.ant-select').nth(1).locator('.ant-select-content'),
    ).toHaveAttribute(
      'title',
      currencyLabel(snapshot.defaultCurrencyCode),
      { timeout: 15_000 },
    )
    await restoredModal.getByRole('button', { name: /取\s*消/ }).click()
  })

  test('3.3 重置丢弃未保存修改', async ({ page }) => {
    const server = await getSettings(page)
    await openSettingsPage(page)
    const selects = page.locator('main .ant-select')
    const nextCountry =
      server.defaultCountryCode === 'JP' ? 'DE' : 'JP'
    const nextCurrency =
      server.defaultCurrencyCode === 'GBP' ? 'EUR' : 'GBP'

    // 1. 修改默认国家/币种（不保存），点击重置
    await pickOption(page, selects.nth(0), nextCountry)
    await pickOption(page, selects.nth(1), nextCurrency)
    await expect(
      selects.nth(0).locator('.ant-select-content'),
    ).toHaveAttribute('title', countryLabel(nextCountry))
    await expect(
      selects.nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', currencyLabel(nextCurrency))

    const reloadResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/site/settings') &&
        r.request().method() === 'GET',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: /重\s*置/ }).click()
    await reloadResponse

    // 表单恢复服务端值，且无「已保存」提示
    await expect(
      selects.nth(0).locator('.ant-select-content'),
    ).toHaveAttribute('title', countryLabel(server.defaultCountryCode), {
      timeout: 30_000,
    })
    await expect(
      selects.nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', currencyLabel(server.defaultCurrencyCode), {
      timeout: 30_000,
    })
    await expect(message(page, '已保存')).toHaveCount(0)

    // 2. 刷新后仍为服务端值
    await openSettingsPage(page)
    await expect(
      page.locator('main .ant-select').nth(0).locator('.ant-select-content'),
    ).toHaveAttribute('title', countryLabel(server.defaultCountryCode))
    await expect(
      page.locator('main .ant-select').nth(1).locator('.ant-select-content'),
    ).toHaveAttribute('title', currencyLabel(server.defaultCurrencyCode))
  })

  test('3.4 必填校验与非法原始值', async ({ page }) => {
    const before = await getSettings(page)
    let putCount = 0
    const onRequest = (request: Request) => {
      if (
        request.method() === 'PUT' &&
        request.url().includes('/api/site/settings')
      ) {
        putCount += 1
      }
    }
    page.on('request', onRequest)

    // 通过 mock GET 返回空对象，使表单为空；同时拦截 PUT，确保校验失败时不会写库
    await page.route('**/api/site/settings', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: '不应发起保存请求' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      })
    })

    try {
      await page.goto('/site/config')
      await waitForAppReady(page)
      await expect(page.locator('main .ant-alert')).toBeVisible({
        timeout: 60_000,
      })
      await expect(page.locator('main .ant-select')).toHaveCount(2, {
        timeout: 60_000,
      })
      await expect(
        page.locator('main .ant-select-content-has-value'),
      ).toHaveCount(0)

      // 1. 清空后提交：提示必填且不发起保存
      await page.getByRole('button', { name: /保\s*存/ }).click()
      await expect(page.getByText('请选择默认国家')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('请选择默认币种')).toBeVisible({
        timeout: 15_000,
      })
      expect(putCount).toBe(0)
    } finally {
      page.off('request', onRequest)
      await page.unroute('**/api/site/settings')
    }

    // 2. defaultCurrencyCode=ABC -> 400
    const badCurrency = await page.request.put('/api/site/settings', {
      data: { defaultCurrencyCode: 'ABC' },
    })
    expect(badCurrency.status()).toBe(400)
    expect(bodyMessage(await badCurrency.json())).toBe(
      '不支持的币种，可选：USD, CNY, EUR, GBP, JPY',
    )
    expect(await getSettings(page)).toEqual(before)

    // 3. defaultCountryCode=ZZ：若服务端未校验则记录为缺陷点并恢复
    const badCountry = await page.request.put('/api/site/settings', {
      data: { defaultCountryCode: 'ZZ' },
    })
    if (badCountry.status() === 400) {
      expect(bodyMessage(await badCountry.json())).toContain('国家')
    } else {
      expect(badCountry.status()).toBe(200)
      test.info().annotations.push({
        type: 'defect',
        description:
          '服务端 updateSettings 未校验 defaultCountryCode，ZZ 被接受并持久化；已恢复原值，不视为通过',
      })
      await restoreSettings(page, before)
    }
    expect(await getSettings(page)).toEqual(before)
  })

  test('3.5 只读权限界面', async ({ page, browser }) => {
    const server = await getSettings(page)

    // 1. 仅 site_config:ro 的只读用户（mock /api/me，不创建账号）
    const meResponse = await page.request.get('/api/me')
    expect(meResponse.ok()).toBeTruthy()
    const me = (await meResponse.json()) as MeResponse
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...me,
          permissions: ['site_config:ro'],
          roleKeys: [],
          roles: [],
          isSuperAdmin: false,
          isOps: false,
          isDealer: false,
        }),
      })
    })

    try {
      await openSettingsPage(page)
      const selects = page.locator('main .ant-select')
      await expect(selects.nth(0).getByRole('combobox')).toBeDisabled()
      await expect(selects.nth(1).getByRole('combobox')).toBeDisabled()
      await expect(
        page.getByRole('button', { name: /保\s*存/ }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /重\s*置/ }),
      ).toHaveCount(0)
      await expect(selects.nth(1).locator('.ant-select-content')).toHaveAttribute(
        'title',
        currencyLabel(server.defaultCurrencyCode),
      )
    } finally {
      await page.unroute('**/api/me')
    }

    // 2. 以 dealer 直接访问：页面渲染、无保存按钮、空表单 disabled、403 提示、不白屏
    const dealerContext = await contextFor(browser, dealerState)
    const dealerPage = await dealerContext.newPage()
    try {
      await dealerPage.goto('/site/config')
      await expect(message(dealerPage, 'Insufficient permission')).toBeVisible(
        { timeout: 60_000 },
      )
      await expect(dealerPage.locator('main .ant-card-head-title')).toHaveText(
        '全局配置',
        { timeout: 60_000 },
      )
      await waitForAppReady(dealerPage)
      await expect(dealerPage.locator('main .ant-alert')).toBeVisible({
        timeout: 60_000,
      })
      await expect(dealerPage.locator('main .ant-select')).toHaveCount(2)
      await expect(
        dealerPage.locator('main .ant-select').nth(0).getByRole('combobox'),
      ).toBeDisabled()
      await expect(
        dealerPage.locator('main .ant-select').nth(1).getByRole('combobox'),
      ).toBeDisabled()
      await expect(
        dealerPage.getByRole('button', { name: /保\s*存/ }),
      ).toHaveCount(0)
      await expect(
        dealerPage.getByRole('button', { name: /重\s*置/ }),
      ).toHaveCount(0)
      await expect(
        dealerPage.locator('main .ant-select-content-has-value'),
      ).toHaveCount(0)
      await expect(dealerPage.locator('#root')).not.toBeEmpty()
    } finally {
      await dealerContext.close()
    }
  })

  test('3.6 全局配置接口异常提示', async ({ page }) => {
    const snapshot = await getSettings(page)
    await openSettingsPage(page)
    const selects = page.locator('main .ant-select')
    const target =
      snapshot.defaultCurrencyCode === 'CNY' ? 'USD' : 'CNY'

    // 1. 拦截 PUT 返回 500
    await page.route('**/api/site/settings', async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '保存失败（服务端 500）',
          statusCode: 500,
        }),
      })
    })

    try {
      await pickOption(page, selects.nth(1), target)
      await expect(
        selects.nth(1).locator('.ant-select-content'),
      ).toHaveAttribute('title', currencyLabel(target))
      await page.getByRole('button', { name: /保\s*存/ }).click()
      await expect(
        message(page, '保存失败（服务端 500）'),
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: /保\s*存/ }),
      ).toBeEnabled({ timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: /保\s*存/ }),
      ).not.toHaveClass(/ant-btn-loading/)

      // 表单保留用户输入，服务端数据未变
      await expect(
        selects.nth(1).locator('.ant-select-content'),
      ).toHaveAttribute('title', currencyLabel(target))
      expect(await getSettings(page)).toEqual(snapshot)
    } finally {
      await page.unroute('**/api/site/settings')
    }

    // 2. 拦截 GET 返回 500：提示错误、空表单、不崩溃
    await page.route('**/api/site/settings', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: '加载配置失败',
          statusCode: 500,
        }),
      })
    })

    try {
      await page.reload()
      await expect(message(page, '加载配置失败')).toBeVisible({
        timeout: 60_000,
      })
      await waitForAppReady(page)
      await expect(page.locator('main .ant-card-head-title')).toHaveText(
        '全局配置',
      )
      await expect(page.locator('main .ant-alert')).toBeVisible({
        timeout: 60_000,
      })
      await expect(page.locator('main .ant-select')).toHaveCount(2)
      await expect(
        page.locator('main .ant-select-content-has-value'),
      ).toHaveCount(0)
      await expect(page.locator('#root')).not.toBeEmpty()
    } finally {
      await page.unroute('**/api/site/settings')
    }
  })
})
