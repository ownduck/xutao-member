import { test } from '@playwright/test'
import { SEED, loginViaApi } from './helpers/login'
import { waitForAppReady } from './helpers/nav'

test('seed', async ({ page }) => {
  await loginViaApi(page, SEED.admin.email, SEED.admin.password)
  await waitForAppReady(page)
})
