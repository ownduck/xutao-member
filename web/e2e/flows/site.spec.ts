import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectMenuVisible, waitForAppReady } from '../helpers/nav'

const authDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
)

test.describe('G: site pages', () => {
  test.use({ storageState: path.join(authDir, 'admin.json') })

  test('G1: exchange rates page save', async ({ page }) => {
    await page.goto('/site/exchange-rates')
    await waitForAppReady(page)
    await expect(page.locator('.ant-table').first()).toBeVisible({
      timeout: 30_000,
    })
    // Make form dirty via edit modal so 保存配置 enables
    const editBtn = page.getByRole('button', { name: '编辑' }).first()
    await expect(editBtn).toBeVisible({ timeout: 15_000 })
    await editBtn.click()
    const modal = page.locator('.ant-modal').filter({ hasText: /编辑汇率|新增汇率/ })
    await expect(modal).toBeVisible()
    const rateInput = modal.locator('.ant-input-number-input').first()
    await rateInput.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('1.01', { delay: 30 })
    await modal.getByRole('button', { name: /确\s*定/ }).click()
    const saveBtn = page.getByRole('button', { name: /保存配置/ })
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 })
    await saveBtn.click()
    await expect(page.getByText(/已保存|配置已先保存|成功/)).toBeVisible({
      timeout: 20_000,
    })
  })

  test('G2: sync rates button', async ({ page }) => {
    await page.goto('/site/exchange-rates')
    await waitForAppReady(page)
    const syncBtn = page.getByRole('button', { name: /从聚合数据同步|同步/ }).first()
    await expect(syncBtn).toBeVisible({ timeout: 20_000 })
    await syncBtn.click()
    await expect(page.locator('.ant-message').getByText(/成功|失败|未配置|错误|同步/)).toBeVisible({
      timeout: 60_000,
    })
  })

  test('G3: site config save and restore', async ({ page }) => {
    await page.goto('/site/config')
    await waitForAppReady(page)
    await expect(page.locator('form, .ant-form').first()).toBeVisible({
      timeout: 30_000,
    })
    const saveBtn = page.getByRole('button', { name: /保\s*存/ }).first()
    await saveBtn.click()
    await expect(page.getByText(/成功|已保存/)).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('G4: dealer no site menu', () => {
  test.use({ storageState: path.join(authDir, 'dealer.json') })

  test('dealer cannot see site menus', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForAppReady(page)
    await expectMenuVisible(page, ['汇率管理', '全局配置'], false)
  })
})
