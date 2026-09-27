import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Wait until ProtectedLayout Spin finishes and shell is visible. */
export async function waitForAppReady(page: Page) {
  await expect(page.locator('.ant-layout-sider')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.locator('.ant-spin-spinning'))
    .toHaveCount(0, { timeout: 30_000 })
    .catch(() => undefined)
}

/** Expand collapsed Ant Design submenus so leaf links are in the DOM. */
export async function expandAllMenus(page: Page) {
  for (let guard = 0; guard < 8; guard++) {
    const closed = page.locator(
      '.ant-layout-sider .ant-menu-submenu:not(.ant-menu-submenu-open) > .ant-menu-submenu-title',
    )
    if ((await closed.count()) === 0) break
    await closed.first().click()
  }
}

/** Ant Design menu link by visible text (leaf items). */
export function menuLink(page: Page, name: string | RegExp) {
  return page.locator('.ant-layout-sider').getByRole('link', { name })
}

export async function expectMenuVisible(
  page: Page,
  labels: string[],
  visible: boolean,
) {
  if (visible) await expandAllMenus(page)
  for (const label of labels) {
    const link = menuLink(page, label)
    if (visible) {
      await expect(link).toBeVisible({ timeout: 15_000 })
    } else {
      // still expand so we don't miss a hidden-but-present link wrongly
      await expandAllMenus(page)
      await expect(link).toHaveCount(0)
    }
  }
}

export async function openProfileMenu(page: Page) {
  await page
    .locator('.ant-layout-header')
    .locator('.ant-dropdown-trigger')
    .click()
}
