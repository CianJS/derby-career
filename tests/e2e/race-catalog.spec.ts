import { test as base, expect, type Page } from '@playwright/test'
import { createCatalogClient } from '../../lib/race-catalog/client'

const catalog = createCatalogClient(process.env.E2E_API_URL ?? 'http://127.0.0.1:4000')
const raceId = 'RACE_KOR_2026_KOREA_CUP'

// Anonymous local fixture traffic only: no headers, cookies, storage state or HAR attachments.
const test = base.extend<{ diagnostics: void }>({
  diagnostics: [
    async ({ context }, use, testInfo) => {
      const events: string[] = []
      context.on('page', (page) => {
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') {
            events.push(`console ${message.type()}: ${message.text()}`)
          }
        })
        page.on('pageerror', (error) => events.push(`pageerror: ${error.message}`))
        page.on('response', (response) => {
          const url = new URL(response.url())
          if (url.pathname.startsWith('/api/racing-catalog/')) {
            events.push(`${response.status()} ${url.pathname}${url.search}`)
          }
        })
        page.on('requestfailed', (request) => {
          const url = new URL(request.url())
          events.push(`requestfailed: ${url.pathname} ${request.failure()?.errorText}`)
        })
      })
      await use()
      await testInfo.attach('browser-diagnostics', {
        body: events
          .join('\n')
          .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database redacted]')
          .replace(/(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[header redacted]'),
        contentType: 'text/plain',
      })
    },
    { auto: true },
  ],
})

async function assertDetail(page: Page) {
  const race = await catalog.race(raceId)
  const venue = await catalog.venue(race.racecourseId)
  await expect(page).toHaveURL(new RegExp(`view=race(?:&|$).*raceId=${raceId}`))
  await expect(page.getByRole('heading', { level: 1, name: race.name, exact: true })).toBeVisible()
  const fact = (label: string) =>
    page
      .locator('dl > div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator('dd')
  await expect(fact('경주 ID')).toHaveText(race.id)
  await expect(fact('개최국 / 기준연도')).toHaveText(`한국 / ${race.year}`)
  await expect(fact('경마장')).toHaveText(venue.racecourse.name)
  await expect(fact('연령')).toHaveText(race.ageCondition || '미확인')
  await expect(fact('성별')).toHaveText(race.sexCondition || '미확인')
  await expect(fact('원문 참가 조건')).toHaveText(race.originalEligibility || '미확인')
  await expect(fact('거리 / 원문')).toContainText(
    `${race.distanceMeters?.toLocaleString('ko-KR')}m`,
  )
  await expect(fact('상금 / 기준')).toContainText(race.prizeCurrency ?? '미확인')
  await expect(page.getByRole('heading', { name: /사츠키상/ })).toHaveCount(0)
  await expect(page.locator('dt').filter({ hasText: /날씨|부담중량|참가비|출전료/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /출전|참가 신청|등록하기/ })).toHaveCount(0)
  return { raceId: race.id, title: race.name, venue: venue.racecourse.name, url: page.url() }
}

test('real catalog: 848 distinct races, 90 venues and 48 matching DOM rows on page nine', async ({
  page,
  browser,
}, testInfo) => {
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === '/api/racing-catalog/v1/race-schedule' &&
      url.searchParams.get('page') === '1'
    )
  })
  const venueResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/racing-catalog/v1/racecourses',
  )
  await page.goto('/?view=races')
  expect((await listResponse).status()).toBe(200)
  expect((await venueResponse).status()).toBe(200)
  const list = await (await listResponse).json()
  const venues = await (await venueResponse).json()
  expect(list.pagination.total).toBe(848)
  expect(venues.pagination.total).toBe(90)
  expect(venues.data).toHaveLength(90)
  await expect(
    page.getByRole('combobox', { name: '경마장', exact: true }).locator('option'),
  ).toHaveCount(91)
  const results = page.getByRole('region', { name: '경주 조회 결과', exact: true })
  await expect(results.getByRole('status')).toContainText('848행 · 1 / 9페이지')
  await expect(results.locator('tbody tr')).toHaveCount(100)

  const lastPage = await catalog.list({ page: 9, pageSize: 100 })
  expect(lastPage.pagination.total).toBe(848)
  expect(lastPage.data).toHaveLength(48)
  await page.getByRole('spinbutton', { name: '경주 목록 페이지 이동' }).fill('9')
  await page
    .getByRole('navigation', { name: '경주 목록 페이지' })
    .getByRole('button', { name: '이동', exact: true })
    .click()
  await expect(results.getByRole('status')).toContainText('848행 · 9 / 9페이지')
  await expect(results.locator('tbody tr')).toHaveCount(48)
  const renderedIds = await results
    .locator('tbody button[id^="catalog-"]')
    .evaluateAll((buttons) => buttons.map((button) => button.id.slice('catalog-'.length)))
  expect(renderedIds).toEqual(lastPage.data.map((race) => race.id))
  await expect(page).toHaveURL(/rc_page=9(?:&|$)/)
  await testInfo.attach('page-nine', { body: await page.screenshot(), contentType: 'image/png' })
  await testInfo.attach('catalog-evidence', {
    body: JSON.stringify(
      {
        chromium: browser.version(),
        total: list.pagination.total,
        venues: venues.pagination.total,
        page: 9,
        renderedIds,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})

test('actual row opens API detail and browser Back/Forward restores the catalog', async ({
  page,
}, testInfo) => {
  await page.goto('/?view=races')
  await expect(page.getByRole('heading', { level: 1, name: '경주 정보' })).toBeVisible()
  await page.getByRole('combobox', { name: '개최국', exact: true }).selectOption('KOR')
  const row = page.locator(`#catalog-${raceId}`)
  await expect(row).toBeVisible()
  const detailResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/racing-catalog/v1/race-schedule/${raceId}`,
  )
  await row.click()
  const response = await detailResponse
  expect(response.status()).toBe(200)
  expect((await response.json()).id).toBe(raceId)
  const evidence = await assertDetail(page)
  await testInfo.attach('detail', { body: await page.screenshot(), contentType: 'image/png' })
  await page.goBack()
  await expect(page).toHaveURL(/view=races(?:&|$)/)
  await expect(page.getByRole('heading', { level: 1, name: '경주 정보' })).toBeVisible()
  await expect(row).toBeVisible()
  await expect(page.getByRole('combobox', { name: '개최국', exact: true })).toHaveValue('KOR')
  await page.goForward()
  await assertDetail(page)
  await testInfo.attach('navigation-evidence', {
    body: JSON.stringify({ ...evidence, backForward: 'passed' }),
    contentType: 'application/json',
  })
})

test('direct detail URL survives hydration and reload in a fresh tab', async ({
  context,
}, testInfo) => {
  const page = await context.newPage()
  await page.goto(`/?view=race&raceId=${raceId}`)
  await assertDetail(page)
  await page.reload()
  const evidence = await assertDetail(page)
  await testInfo.attach('direct-url-evidence', {
    body: JSON.stringify({ ...evidence, reload: 'passed' }),
    contentType: 'application/json',
  })
})
