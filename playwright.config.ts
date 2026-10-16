import { defineConfig, devices } from '@playwright/test'

if (process.env.CI && process.env.E2E_CHROMIUM_EXECUTABLE_PATH) {
  throw new Error('CI must use the Chromium bundled with the pinned Playwright image')
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  // Full catalog filter/detail/history/outage matrices plus the existing game regressions.
  globalTimeout: 360_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: '.e2e-artifacts/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.e2e-artifacts/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: process.env.E2E_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
  ],
})
