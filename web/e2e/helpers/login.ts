import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const SEED = {
  admin: {
    email: 'admin@local.dev',
    password: process.env.ADMIN_SEED_PASSWORD || 'Admin@123456',
  },
  ops: {
    email: 'ops@local.dev',
    password: process.env.OPS_SEED_PASSWORD || 'Ops@123456',
  },
  dealer: {
    email: 'dealer@local.dev',
    password: process.env.DEALER_SEED_PASSWORD || 'Dealer@123456',
  },
} as const

/** Login via Vite-proxied auth so cookies are scoped to :5288. */
export async function loginViaApi(page: Page, email: string, password: string) {
  const res = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
    headers: {
      Origin: 'http://localhost:5288',
      'Content-Type': 'application/json',
    },
  })
  expect(res.ok(), `sign-in ${email}: ${res.status()} ${await res.text()}`).toBe(
    true,
  )
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
}

/** Full UI form login (for login-page tests). */
export async function loginViaUi(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto('/login')
  await page.getByPlaceholder('邮箱').fill(email)
  await page.getByPlaceholder('密码').fill(password)
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
    page.getByRole('button', { name: /登\s*录/ }).click(),
  ])
}
