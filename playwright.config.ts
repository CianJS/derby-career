import { defineConfig, devices } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.env.CI && process.env.E2E_CHROMIUM_EXECUTABLE_PATH) {
  throw new Error('CI must use the Chromium bundled with the pinned Playwright image')
}

const chromium = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  launchOptions: process.env.E2E_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH }
    : {},
}

const testDirectory = new URL('./tests/e2e/', pathToFileURL(__filename))
const catalogSpecs = ['catalog-*.spec.ts', 'race-catalog.spec.ts', 'recording-ui.spec.ts']
const serverSpecs = ['jockey-trust-server.spec.ts', 'overseas-expedition.spec.ts']
const localSpecs = [
  'economy.spec.ts',
  'jockey-trust.spec.ts',
  'jockey-trust-completion.spec.ts',
  'race-spectate-layout.spec.ts',
  'overseas-expedition.spec.ts',
]
const classifiedSpecs = [...catalogSpecs, ...serverSpecs, ...localSpecs]
for (const file of readdirSync(testDirectory)) {
  if (!file.endsWith('.spec.ts')) {
    continue
  }
  const classified = classifiedSpecs.some((pattern) => {
    const wildcard = pattern.indexOf('*')
    return wildcard === -1
      ? file === pattern
      : file.startsWith(pattern.slice(0, wildcard)) && file.endsWith(pattern.slice(wildcard + 1))
  })
  if (!classified) {
    throw new Error(
      `Assign ${file} to catalogSpecs, serverSpecs or localSpecs in playwright.config.ts before running E2E`,
    )
  }
}

export default defineConfig({
  testDir: fileURLToPath(testDirectory),
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  // Full catalog filter/detail/history/outage matrices plus the existing game regressions.
  globalTimeout: 900_000,
  expect: { timeout: 10_000 },
  workers: 3,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: '.e2e-artifacts/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.e2e-artifacts/playwright-report', open: 'never' }],
    ['json', { outputFile: '.e2e-artifacts/results.json' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium-catalog',
      testMatch: catalogSpecs,
      // These scenarios deliberately stop/restart the same anonymous API.
      workers: 1,
      use: chromium,
    },
    {
      name: 'chromium-server',
      testMatch: serverSpecs,
      grep: /jockey-trust-server\.spec\.ts|Server overseas /,
      // The saved-career scenarios retain one owner and its database history.
      workers: 1,
      use: chromium,
    },
    {
      name: 'chromium-local',
      testMatch: localSpecs,
      grepInvert: /Server overseas /,
      fullyParallel: true,
      workers: 2,
      use: chromium,
    },
  ],
})
