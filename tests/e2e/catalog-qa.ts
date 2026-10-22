import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import { control } from './catalog-control'
import { createCatalogClient } from '../../lib/race-catalog/client'
import type { Query } from '../../lib/race-catalog/model'
export { expect }
export const catalog = createCatalogClient(process.env.E2E_API_URL ?? 'http://127.0.0.1:4000')
export const sizes = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]
export const test = base.extend<{ diagnostics: void }>({
  diagnostics: [
    async ({ page, browser }, use, info) => {
      // Each serial scenario gets a fresh anonymous API process/rate-limit bucket.
      // The same PostgreSQL fixture data is retained; production limits remain unchanged.
      await control('restart')
      const network: { status: number; path: string; query: string }[] = []
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        const url = new URL(response.url())
        if (url.pathname.startsWith('/api/racing-catalog/')) {
          network.push({ status: response.status(), path: url.pathname, query: url.search })
        }
      })
      await use()
      await info.attach('catalog-network-and-browser', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            chromium: browser.version(),
            platform: process.platform,
            viewport: page.viewportSize(),
            network,
            pageErrors: errors,
          },
          null,
          2,
        ),
      })
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})
export const results = (page: Page) =>
  page.getByRole('region', { name: '경주 조회 결과', exact: true })
export async function assertResults(page: Page, query: Query, total?: number) {
  const expected = await catalog.list({ page: 1, pageSize: 100, ...query })
  if (total !== undefined) {
    expect(expected.pagination.total).toBe(total)
  }
  for (const [key, value] of Object.entries(query)) {
    await expect.poll(() => new URL(page.url()).searchParams.get('rc_' + key)).toBe(String(value))
  }
  await expect(results(page).getByRole('status')).toContainText(
    `${expected.pagination.total}행 · ${expected.pagination.page} /`,
  )
  await expect
    .poll(() =>
      results(page)
        .locator('tbody button')
        .evaluateAll((items) => items.map((item) => item.id.slice('catalog-'.length))),
    )
    .toEqual(expected.data.map((race) => race.id))
  return expected
}
export async function reset(page: Page) {
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '개최국', exact: true })).toHaveValue('')
}
export async function apply(page: Page) {
  await page.getByRole('button', { name: '조건 적용 / 검색', exact: true }).click()
}
export async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await info.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
}
