import { control } from './catalog-control'
import { test, expect, assertResults, capture } from './catalog-qa'

test('catalog actual outage: stopped Fastify returns one error, no mock rows and retry recovers the same real DB', async ({
  page,
}, info) => {
  await control('stop')
  try {
    const failed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/racing-catalog/v1/race-schedule',
    )
    await page.goto('/?view=races&rc_country=KOR')
    expect((await failed).status()).toBe(502)
    const alerts = page.getByRole('main').getByRole('alert')
    await expect(alerts).toHaveCount(1)
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1)
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await capture(page, info, 'real-api-stopped')
  } finally {
    await control('start')
  }
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  await assertResults(page, { country: 'KOR' }, 51)
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
  await capture(page, info, 'real-api-recovered')
})

test('catalog missing ID: real 404 and retry cannot substitute a hardcoded detail', async ({
  page,
}, info) => {
  const path = '/api/racing-catalog/v1/race-schedule/RACE_QA_NOT_FOUND'
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === path)
  await page.goto('/?view=race&raceId=RACE_QA_NOT_FOUND')
  expect((await response).status()).toBe(404)
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1)
  await expect(page.locator('dd')).toHaveCount(0)
  const again = page.waitForResponse((r) => new URL(r.url()).pathname === path)
  await page.getByRole('button', { name: '다시 시도', exact: true }).click()
  expect((await again).status()).toBe(404)
  await expect(page.locator('dd')).toHaveCount(0)
  await capture(page, info, 'real-detail-not-found')
})
