import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as setup, expect } from '@playwright/test'
import { SEED, loginViaApi } from './helpers/login'
import { waitForAppReady } from './helpers/nav'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const authDir = path.join(__dirname, '.auth')
mkdirSync(authDir, { recursive: true })

async function authAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  out: string,
) {
  await loginViaApi(page, email, password)
  await waitForAppReady(page)
  await page.context().storageState({ path: out })
}

setup('authenticate as admin', async ({ page }) => {
  await authAs(
    page,
    SEED.admin.email,
    SEED.admin.password,
    path.join(authDir, 'admin.json'),
  )
})

setup('authenticate as ops', async ({ page }) => {
  await authAs(
    page,
    SEED.ops.email,
    SEED.ops.password,
    path.join(authDir, 'ops.json'),
  )
})

setup('authenticate as dealer', async ({ page }) => {
  await authAs(
    page,
    SEED.dealer.email,
    SEED.dealer.password,
    path.join(authDir, 'dealer.json'),
  )
})
