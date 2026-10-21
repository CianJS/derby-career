import { legacyCareer as startCareer } from '../helpers/legacy-career'
import { setTimeout as delay } from 'node:timers/promises'
import { test, expect, type Page } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { fixtureLifecycle } from '../../lib/career/fixtures'


async function rest(page: Page) {
  await page
    .getByRole('group', { name: '월간 행동 선택' })
    .getByRole('button', { name: /^휴식/ })
    .click()
  await page.getByRole('button', { name: '휴식 실행', exact: true }).click()
  await page.getByRole('button', { name: '다음 달 시작', exact: true }).click()
  await expect(page.getByRole('group', { name: '월간 행동 선택' })).toBeVisible()
}
async function openEntry(page: Page) {
  await page
    .getByRole('group', { name: '월간 행동 선택' })
    .getByRole('button', { name: /^경주 / })
    .click()
  await page.getByRole('button', { name: '경주 출전 준비', exact: true }).click()
}
async function finish(page: Page) {
  await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
  await page.getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true }).click()
  await page.getByRole('button', { name: '결과 저장', exact: true }).click()
  await expect(page.getByText('상금 지급 완료', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '다음 달 육성으로', exact: true }).click()
}
for (const [target, width] of [
  ['JPN', 390],
  ['USA', 1440],
] as const) {
  test(`Local overseas ${target} ${width}: two tabs, foreign race/log/prize, return and domestic race`, async ({
    page,
    context,
  }, info) => {
    const base = startCareer('DEV_HORSE_RED_COMET')
    const career = { ...base, careerTurnIndex: 3, month: 3 }
    await context.addInitScript(
      ({ career, lifecycle, key, width }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              revision: 1,
              localCareerId: crypto.randomUUID(),
              career,
              lifecycle,
            }),
          )
        }
        localStorage.setItem('theme', width === 390 ? 'light' : 'dark')
      },
      {
        career,
        lifecycle: {
          ...fixtureLifecycle(true),
          country: '대한민국',
          fundsKRW: 20_000_000,
          economyLedger: [],
        },
        key: BROWSER_SAVE_KEY,
        width,
      },
    )
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await openEntry(page)
    const raceId = `DEV_${target}_M3_MILE_1600`
    await expect(page.locator(`input[value="${raceId}"]`)).toBeDisabled()
    await page.evaluate((key) => {
      const set = Storage.prototype.setItem
      Object.defineProperty(window, 'rejectTravelSave', { value: true, writable: true })
      Storage.prototype.setItem = function (name, value) {
        if (name === key && Reflect.get(window, 'rejectTravelSave')) {
          throw new DOMException('Full', 'QuotaExceededError')
        }
        return set.call(this, name, value)
      }
    }, BROWSER_SAVE_KEY)
    await page.getByRole('button', { name: '원정 신청', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '저장 공간' }).first()).toBeVisible()
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).lifecycle.travel.revision,
        BROWSER_SAVE_KEY,
      ),
    ).toBe(0)
    await page.evaluate(() => Reflect.set(window, 'rejectTravelSave', false))
    const other = await context.newPage()
    await other.goto('/')
    await other.getByRole('button', { name: '육성 계속', exact: true }).click()
    await page.getByLabel('원정 국가', { exact: true }).selectOption(target)
    await other
      .getByLabel('원정 국가', { exact: true })
      .selectOption(target === 'JPN' ? 'USA' : 'JPN')
    const a = await page.getByRole('button', { name: '원정 신청', exact: true }).elementHandle()
    const b = await other.getByRole('button', { name: '원정 신청', exact: true }).elementHandle()
    await Promise.all([
      a!.evaluate((el) => (el as HTMLButtonElement).click()),
      b!.evaluate((el) => (el as HTMLButtonElement).click()),
    ])
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), BROWSER_SAVE_KEY)
    await expect.poll(async () => (await read()).lifecycle.travel.revision).toBe(1)
    // Either tab may win the lock. Return once and explicitly choose the target under test.
    let current = await read()
    if (current.lifecycle.travel.locationCountry !== target) {
      await page.getByRole('button', { name: '귀국', exact: true }).click()
      await page.getByLabel('원정 국가', { exact: true }).selectOption(target)
      await page.getByRole('button', { name: '원정 신청', exact: true }).click()
    }
    await other.close()
    await expect(page.locator(`input[value="${raceId}"]`)).toBeEnabled()
    await expect(page.locator('input[value="DEV_M3_MILE_1600"]')).toBeDisabled()
    await page.locator(`input[value="${raceId}"]`).check()
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await expect(page.getByText('출전 정보 저장 완료 · 선택 잠김', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '귀국', exact: true })).toBeDisabled()
    current = await read()
    expect(current.career.raceRun.raceDefinitionSnapshot.countryCode).toBe(target)
    const prize = current.career.raceRun.simulation.result.prizeMoney
    await info.attach('overseas-entry', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await page.reload()
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
    await finish(page)
    current = await read()
    expect(current.lifecycle.fundsKRW).toBe(20_000_000 + prize)
    expect(current.career.careerTurnIndex).toBe(4)
    await page.getByRole('button', { name: '귀국', exact: true }).click()
    await expect(page.locator('[data-travel-location]')).toContainText('현재 체류 · 대한민국')
    await rest(page)
    await rest(page)
    await openEntry(page)
    await page
      .locator(
        'input[value="DEV_M6_ONE_WIN_1800"]:enabled, input[value="DEV_M6_MAIDEN_MILE_1600"]:enabled',
      )
      .first()
      .check()
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await finish(page)
    current = await read()
    expect(current.career.raceRecords).toHaveLength(2)
    expect(current.lifecycle.economyLedger).toHaveLength(4)
    expect(current.lifecycle.fundsKRW).toBe(
      20_000_000 +
        current.career.raceRecords.reduce(
          (sum: number, r: { prizeMoney: number }) => sum + r.prizeMoney,
          0,
        ),
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await info.attach('overseas-return-domestic', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}

for (const [target, width] of [
  ['JPN', 390],
  ['USA', 1440],
] as const) {
  test(`Server overseas ${target} ${width}: real HTTP, lost receipt/retry, foreign and domestic races`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000)
    const base = process.env.E2E_SERVER_BASE_URL
    expect(base).toBeTruthy()
    // The preceding server scenario shares this isolated owner. Respect the real request quota.
    await delay(61_000)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base!)
    const get = () =>
      page.evaluate(async () => {
        const response = await fetch('/api/server-save/v1/careers/workspace?page=1&pageSize=20')
        if (!response.ok) {
          throw new Error(`Workspace HTTP ${response.status}`)
        }
        return response.json()
      })
    await expect(page.getByText('서버 기록 연결됨', { exact: false }).first()).toBeVisible()
    let current = await get()
    if (current.career) {
      const status = await page.evaluate(
        async (c) =>
          (
            await fetch(`/api/server-save/v1/careers/${c.id}/retirement`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                commandId: crypto.randomUUID(),
                expectedRevision: c.revision,
              }),
            })
          ).status,
        current.career,
      )
      expect(status).toBe(200)
      await page.reload()
    }
    await page.getByRole('button', { name: '새 육성마 시작', exact: true }).click()
    await page.getByRole('heading', { name: '레드 코멧', exact: true }).click()
    await page.getByRole('button', { name: '이 말로 육성 시작', exact: true }).click()
    await expect(page.getByRole('group', { name: '월간 행동 선택' })).toBeVisible()
    await rest(page)
    await rest(page)
    current = await get()
    const initialFunds = current.stable.funds
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/expeditions')) {
        posts.push(r.postData()!)
      }
    })
    await page.getByLabel('원정 국가', { exact: true }).selectOption(target)
    await page.route(
      '**/api/server-save/v1/careers/*/expeditions',
      async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.abort('failed')
      },
      { times: 1 },
    )
    await page.getByRole('button', { name: '원정 신청', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '같은 요청으로 다시 확인', exact: true }).last(),
    ).toBeEnabled()
    await page.getByRole('button', { name: '같은 요청으로 다시 확인', exact: true }).last().click()
    await expect(page.locator('[data-travel-location]')).toContainText(
      `현재 체류 · ${target === 'JPN' ? '일본' : '미국'}`,
    )
    await expect(page.getByRole('region', { name: '월간 정보' })).toContainText(
      '현재 출전 가능 1 / 5개',
    )
    expect(posts).toHaveLength(2)
    expect(posts[0]).toBe(posts[1])
    current = await get()
    expect(current.stable.funds).toBe(initialFunds)
    expect(current.career.state.careerTurnIndex).toBe(3)
    await openEntry(page)
    await expect(page.locator('input[value="DEV_M3_MILE_1600"]')).toBeDisabled()
    await page.locator(`input[value="DEV_${target}_M3_MILE_1600"]`).check()
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await expect(page.getByText('출전 정보 저장 완료 · 선택 잠김', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '귀국', exact: true })).toBeDisabled()
    const run = (await get()).career.state.raceRun
    await info.attach('server-overseas-entry', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await page.reload()
    await page.getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true }).click()
    await page.getByRole('button', { name: '결과 저장', exact: true }).click()
    await expect(page.getByText('상금 지급 완료', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '다음 달 육성으로', exact: true }).click()
    current = await get()
    expect(current.stable.funds).toBe(initialFunds + run.simulation.result.prizeMoney)
    expect(current.career.travel.locationCountry).toBe(target)
    // Avoid the production API's 120/minute limit without changing it.
    await delay(61_000)
    await page.getByRole('button', { name: '귀국', exact: true }).click()
    await expect(page.locator('[data-travel-location]')).toContainText('현재 체류 · 대한민국')
    await rest(page)
    await rest(page)
    await openEntry(page)
    await page
      .locator(
        'input[value="DEV_M6_ONE_WIN_1800"]:enabled, input[value="DEV_M6_MAIDEN_MILE_1600"]:enabled',
      )
      .first()
      .check()
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await finish(page)
    current = await get()
    expect(current.career.state.careerTurnIndex).toBe(7)
    expect(current.career.state.raceRecords).toHaveLength(2)
    expect(current.stable.funds).toBe(
      initialFunds +
        current.career.state.raceRecords.reduce(
          (sum: number, r: { prizeMoney: number }) => sum + r.prizeMoney,
          0,
        ),
    )
    expect(current.career.travel.activeExpedition).toBeNull()
    expect(await page.evaluate((key) => localStorage.getItem(key), BROWSER_SAVE_KEY)).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByLabel('원정 국가', { exact: true }).selectOption(target)
    await page.getByRole('button', { name: '원정 신청', exact: true }).click()
    await expect(page.getByRole('button', { name: '귀국', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '현재 육성마 상세', exact: true }).click()
    await page.getByRole('button', { name: '은퇴', exact: true }).click()
    await page.getByRole('button', { name: '은퇴 확정', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Career Archive 보기', exact: true }),
    ).toBeVisible()
    const retired = await get()
    expect(retired.stable.travel.activeExpedition).toBeNull()
    expect(retired.stable.travel.locationCountry).toBe('KOR')
    expect(retired.stable.funds).toBe(current.stable.funds)
    await info.attach('server-overseas-return-domestic', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}
