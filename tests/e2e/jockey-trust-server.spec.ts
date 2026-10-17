import { setTimeout as delay } from 'node:timers/promises'
import { test, expect } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'

test('real server trust/economy: Month 1–7, v4 replay/reload, lost completion receipt, duplicate completion and retirement', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  const base = process.env.E2E_SERVER_BASE_URL
  expect(base, 'Use the isolated development-session runner').toBeTruthy()
  const posts: { path: string; body: Record<string, unknown> }[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/api/server-save/')
    ) {
      posts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() })
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const get = () =>
    page.evaluate(async () => {
      const response = await fetch('/api/server-save/v1/careers/workspace?page=1&pageSize=20')
      if (!response.ok) {
        throw new Error(`Workspace HTTP ${response.status}`)
      }
      return response.json()
    })
  const home = () => page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
  await page.goto(base!)
  await page.getByRole('button', { name: '새 육성마 시작', exact: true }).click()
  await page.getByRole('heading', { name: '레드 코멧', exact: true }).click()
  await page.getByRole('button', { name: '이 말로 육성 시작', exact: true }).click()
  await expect.poll(async () => (await get()).career?.state.careerTurnIndex).toBe(1)
  let funds = (await get()).stable.funds
  expect(funds).toBe(20_000_000)
  const headerFunds = () => page.getByLabel('마방 자금', { exact: true })
  await expect(headerFunds()).toHaveText('₩20,000,000')
  for (let month = 1; month <= 6; month++) {
    if (month === 4) {
      // Six months of accelerated clicks plus development StrictMode reads can exceed
      // the real 120/minute API quota. Respect its window; never raise the server limit.
      const cooldownUntil = Date.now() + 61_000
      while (Date.now() < cooldownUntil) {
        await delay(Math.min(10_000, cooldownUntil - Date.now()))
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    if (month !== 3 && month !== 6) {
      await page
        .getByRole('group', { name: '월간 행동 선택' })
        .getByRole('button', { name: /^휴식/ })
        .click()
      await page.getByRole('button', { name: '휴식 실행', exact: true }).click()
      await page.getByRole('button', { name: '다음 달 시작', exact: true }).click()
      await expect.poll(async () => (await get()).career.state.careerTurnIndex).toBe(month + 1)
      continue
    }
    await page
      .getByRole('group', { name: '월간 행동 선택' })
      .getByRole('button', { name: /^경주 / })
      .click()
    await page.getByRole('button', { name: '경주 출전 준비', exact: true }).click()
    await expect(
      page.locator('[aria-label="출전 요약"] [data-trust-status="available"]'),
    ).toBeVisible()
    if (month === 3) {
      await page.locator('input[value="DEV_M3_SPRINT_1400"]').check()
    }
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await expect(page.getByText('출전 정보 저장 완료 · 선택 잠김', { exact: true })).toBeVisible()
    const before = await get()
    const run = before.career.state.raceRun
    const fee = run.raceDefinitionSnapshot.entryFee
    expect(fee).toBe(month === 3 ? 500_000 : 0)
    funds -= fee
    expect(before.stable.funds).toBe(funds)
    expect(before.career.funds).toBe(funds)
    await expect(headerFunds()).toHaveText(`₩${funds.toLocaleString('ko-KR')}`)
    expect(run.simulation.engineVersion).toBe('race-sim-v4')
    await page.reload()
    await expect(
      page.getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true }),
    ).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true }).click()
    const completePattern = '**/api/server-save/v1/careers/*/race-runs/*/complete'
    if (month === 3) {
      await page.route(
        completePattern,
        async (route) => {
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          await route.abort('failed')
        },
        { times: 1 },
      )
    }
    const advances = posts.filter((p) => p.path.endsWith('/advance')).length
    await page.getByRole('button', { name: '결과 확정 · 다음 달 시작', exact: true }).click()
    if (month === 3) {
      await expect(
        page.getByRole('button', { name: '완료 요청 다시 확인', exact: true }),
      ).toBeEnabled()
      const journal = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('derby-career-server-command-v1')!),
      )
      const first = posts.filter((p) => p.path.endsWith('/complete')).at(-1)!
      expect(journal.body).toEqual(first.body)
      await page.getByRole('button', { name: '완료 요청 다시 확인', exact: true }).click()
    }
    await expect(page.locator('[data-trust-change="confirmed"]')).toBeVisible()
    const after = await get()
    const record = after.career.state.raceRecords.find(
      (r: { raceRunId: string }) => r.raceRunId === run.raceRunId,
    )
    funds += record.prizeMoney
    expect(record.prizeMoney).toBe(run.simulation.result.prizeMoney)
    expect(after.stable.funds).toBe(funds)
    expect(after.career.funds).toBe(funds)
    await expect(headerFunds()).toHaveText(`₩${funds.toLocaleString('ko-KR')}`)
    await expect(page.locator('[data-settlement-balance]')).toHaveText(
      `₩${funds.toLocaleString('ko-KR')}`,
    )
    await expect(page.getByText('상금 지급 완료', { exact: true })).toBeVisible()
    const change = record.trustChange
    expect(after.career.state.jockeyTrust[record.jockeyId].trust).toBe(change.after)
    expect(change.before).toBe(run.player.jockeySnapshot.chemistry)
    await expect(page.locator('[data-trust-change="confirmed"]')).toContainText(
      change.delta === 0 ? '신뢰도 변화 없음' : `${change.before} → ${change.after}`,
    )
    expect(posts.filter((p) => p.path.endsWith('/advance'))).toHaveLength(advances)
    if (month === 3) {
      const sent = posts.filter((p) => p.path.endsWith('/complete'))
      expect(sent).toHaveLength(2)
      expect(sent[0]).toEqual(sent[1])
      const status = await page.evaluate(
        async ({ path, body }) =>
          (
            await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          ).status,
        sent[0],
      )
      expect(status).toBe(200)
      expect((await get()).career).toEqual(after.career)
    }
    await info.attach('server-confirmed-month-' + month, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: '다음 달 육성으로', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    const restored = await get()
    expect(restored.career.state.jockeyTrust).toEqual(after.career.state.jockeyTrust)
    expect(restored.stable.funds).toBe(funds)
    await expect(headerFunds()).toHaveText(`₩${funds.toLocaleString('ko-KR')}`)
  }
  const final = await get()
  expect(final.career.state.careerTurnIndex).toBe(7)
  expect(final.career.state.raceRecords).toHaveLength(2)
  await page.getByRole('button', { name: '현재 육성마 상세', exact: true }).click()
  await page.getByRole('button', { name: '은퇴', exact: true }).click()
  await page.getByRole('button', { name: '은퇴 확정', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Career Archive 보기', exact: true })).toBeVisible()
  await home()
  await page.getByRole('button', { name: /STABLE 마구간/ }).click()
  await page.locator('[data-archive-id]').first().click()
  await expect(page.locator('[data-trust-status="available"]').first()).toBeVisible()
  const retired = await get()
  expect(retired.retirements[0].snapshot.state.jockeyTrust).toEqual(final.career.state.jockeyTrust)
  expect(await page.evaluate((key) => localStorage.getItem(key), BROWSER_SAVE_KEY)).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(retired.stable.funds).toBe(funds)
  expect(retired.retirements[0].snapshot.funds).toBe(funds)
  await info.attach('server-retired-trust', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await home()
  await page.getByRole('button', { name: '새 육성마 시작', exact: true }).click()
  await page.getByRole('heading', { name: '레드 코멧', exact: true }).click()
  await page.getByRole('button', { name: '이 말로 육성 시작', exact: true }).click()
  await expect(headerFunds()).toHaveText(`₩${funds.toLocaleString('ko-KR')}`)
  expect((await get()).career.state.raceRecords).toHaveLength(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), BROWSER_SAVE_KEY)).toBeNull()
})
