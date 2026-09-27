import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { waitForAppReady } from './nav'

/** Ant Design InputNumber ignores Playwright fill(); type via keyboard. */
async function fillInputNumber(
  page: Page,
  input: ReturnType<Page['locator']>,
  value: string | number,
) {
  await input.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(String(value), { delay: 20 })
  await input.blur()
}

async function pickDealerInModal(
  modal: ReturnType<Page['locator']>,
  page: Page,
) {
  const dealerItem = modal.locator('.ant-form-item').filter({ hasText: '经销商' })
  await dealerItem.locator('.ant-select').click()
  const dropdown = page.locator(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  )
  await expect(dropdown).toBeVisible({ timeout: 15_000 })
  const byEmail = dropdown.getByText('dealer@local.dev')
  if (await byEmail.count()) {
    await byEmail.first().click()
  } else {
    await dropdown.locator('.ant-select-item-option').first().click()
  }
  await expect(dropdown).toBeHidden({ timeout: 5_000 }).catch(() => undefined)
}

async function waitForRemarkRow(page: Page, remark: string) {
  await page.getByRole('button', { name: /查\s*询/ }).click()
  const row = page
    .locator('.ant-table-tbody tr')
    .filter({ hasText: remark })
    .first()
  await expect(row).toBeVisible({ timeout: 45_000 })
  return row
}

export async function createRecharge(
  page: Page,
  amount: number,
  remark = 'pw-recharge',
) {
  await page.goto('/finance/recharge')
  await waitForAppReady(page)
  await page.getByRole('button', { name: '新增充值' }).click()
  const modal = page.locator('.ant-modal').filter({ hasText: '新增充值' })
  await expect(modal).toBeVisible()
  await pickDealerInModal(modal, page)
  await fillInputNumber(
    page,
    modal.locator('.ant-input-number-input').first(),
    amount,
  )
  await modal.locator('textarea').first().fill(remark)
  await modal.getByRole('button', { name: /确\s*定/ }).click()
  await expect(page.getByText(/已提交/)).toBeVisible({ timeout: 20_000 })
  await waitForRemarkRow(page, remark)
}

export async function createDeduction(
  page: Page,
  amount: number,
  remark = 'pw-deduct',
) {
  await page.goto('/finance/deduction')
  await waitForAppReady(page)
  await page.getByRole('button', { name: '新增扣费' }).click()
  const modal = page.locator('.ant-modal').filter({ hasText: '新增扣费' })
  await expect(modal).toBeVisible()
  await pickDealerInModal(modal, page)
  await fillInputNumber(
    page,
    modal.locator('.ant-input-number-input').first(),
    amount,
  )
  await modal.locator('textarea').first().fill(remark)
  await modal.getByRole('button', { name: /确\s*定/ }).click()
  await expect(page.getByText(/已提交/)).toBeVisible({ timeout: 20_000 })
  await waitForRemarkRow(page, remark)
}

export async function auditRowByRemark(
  page: Page,
  remark: string,
  approve: boolean,
) {
  const row = await waitForRemarkRow(page, remark)
  await row.getByRole('button', { name: '审核' }).click()
  const modal = page.locator('.ant-modal').filter({ hasText: /审核/ })
  await expect(modal).toBeVisible()
  await modal.getByText(approve ? '通过' : '拒绝').click()
  await modal.getByRole('button', { name: /确\s*定/ }).click()
  await expect(page.getByText('审核完成')).toBeVisible({ timeout: 15_000 })
}
