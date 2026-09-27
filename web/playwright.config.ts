import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5288',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w server',
      cwd: path.join(__dirname, '..'),
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -w web',
      cwd: path.join(__dirname, '..'),
      url: 'http://localhost:5288',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
