import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Wait until ProtectedLayout Spin finishes and permission menus are painted. */
export async function waitForAppReady(page: Page) {
  await expect(page.locator('.ant-layout-sider')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.locator('.ant-spin-spinning'))
    .toHaveCount(0, { timeout: 30_000 })
    .catch(() => undefined)
  // After /api/me, every seeded role has at least one submenu (订单管理).
  await expect(
    page.locator('.ant-layout-sider .ant-menu-submenu').first(),
  ).toBeVisible({ timeout: 45_000 })
}

/** Expand collapsed Ant Design submenus so leaf links are in the DOM. */
export async function expandAllMenus(page: Page) {
  const titles = ['订单管理', '财务', '站点管理', '后台权限']
  for (const title of titles) {
    const submenu = page
      .locator('.ant-layout-sider .ant-menu-submenu')
      .filter({
        has: page.locator('.ant-menu-submenu-title', { hasText: title }),
      })
      .first()
    if ((await submenu.count()) === 0) continue
    const open = await submenu.evaluate((el) =>
      el.classList.contains('ant-menu-submenu-open'),
    )
    if (open) continue
    await submenu.locator('.ant-menu-submenu-title').click()
    await expect(submenu).toHaveClass(/ant-menu-submenu-open/, {
      timeout: 5_000,
    })
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
  if (visible) {
    await expandAllMenus(page)
    await expect(menuLink(page, labels[0]!)).toBeVisible({ timeout: 20_000 })
  }
  for (const label of labels) {
    const link = menuLink(page, label)
    if (visible) {
      await expect(link).toBeVisible({ timeout: 15_000 })
    } else {
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
