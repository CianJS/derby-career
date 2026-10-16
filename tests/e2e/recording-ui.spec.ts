import { expect, test, type Page } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { buildFixture } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'
import { frameAt, simulateRace, summarizeRaceLog } from '../../lib/career/race-simulation'
import { buildFeedTimeline, feedAt } from '../../lib/career/race-feed'
import { managementFixture } from '../helpers/management-fixture'

async function seed(
  page: Page,
  fixture = managementFixture(),
  log?: ReturnType<typeof simulateRace>,
) {
  await page.addInitScript(
    ({ key, fixture, log }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            revision: 1,
            localCareerId: 'browser-ui-fixture',
            ...fixture,
          }),
        )
        if (log) {
          localStorage.setItem(`derby-race-log-v1:${log.raceRunId}`, JSON.stringify(log))
        }
      }
    },
    { key: BROWSER_SAVE_KEY, fixture, log },
  )
}
async function saved(page: Page) {
  return page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key)!)
    return {
      career: value.career,
      archive: value.lifecycle.archive,
      name: value.lifecycle.stableName,
    }
  }, BROWSER_SAVE_KEY)
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function checkTextContrast(page: Page) {
  const ratio = await page
    .locator('.lab-management p.text-muted-foreground')
    .first()
    .evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d')!
      const luminance = (color: string) => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
          const s = value / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      const foreground = luminance(getComputedStyle(element).color)
      const background = luminance(getComputedStyle(document.body).backgroundColor)
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`saved UI ${viewport.width}: settings, duplicate archives, search/sort, contracts and monthly decisions`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const fixture = managementFixture()
    await seed(page, fixture)
    await page.goto('/')
    await expect(page.getByRole('button', { name: '육성 계속', exact: true })).toBeVisible()
    const before = await saved(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: '설정' })).toBeVisible()
    await expect(page.getByText('보존할 마방', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /마방 생성|최초 등록/ })).toHaveCount(0)
    await expect(page.getByLabel('마방 자금', { exact: true })).toHaveText('자금 미구현')
    expect(await saved(page)).toEqual(before)
    const settings = await page.getByRole('button', { name: '설정', exact: true }).boundingBox()
    expect(settings!.width).toBeGreaterThanOrEqual(44)
    expect(settings!.height).toBeGreaterThanOrEqual(44)
    await noOverflow(page)
    for (const theme of ['다크', '라이트']) {
      await page.getByRole('button', { name: '테마 선택', exact: true }).click()
      await page.getByRole('button', { name: theme, exact: true }).click()
      await expect(page.locator('html')).toHaveClass(
        new RegExp(theme === '다크' ? 'dark' : 'light'),
      )
      await checkTextContrast(page)
    }
    await page.reload()
    expect(await saved(page)).toEqual(before)
    await page.getByRole('button', { name: /STABLE 마구간/ }).click()
    const archive = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '은퇴 경주마', exact: true }) })
    const rows = archive.locator('[data-archive-id]')
    await expect(rows).toHaveCount(2)
    expect(
      await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-archive-id'))),
    ).toEqual(fixture.lifecycle.archive.map((horse) => horse.id))
    await page.getByPlaceholder('말 이름 검색').fill('같은')
    await expect(rows).toHaveCount(2)
    await page.getByPlaceholder('말 이름 검색').fill('5세')
    await expect(rows).toHaveCount(0)
    await page.getByPlaceholder('말 이름 검색').fill('같은 이름')
    for (const sort of ['name', 'wins', 'prize', 'recent']) {
      await page.getByRole('combobox', { name: '정렬', exact: true }).selectOption(sort)
      await expect(rows).toHaveCount(2)
    }
    expect(await rows.first().getAttribute('data-archive-id')).toBe(fixture.lifecycle.archive[0].id)
    for (const horse of fixture.lifecycle.archive) {
      await archive.locator(`[data-archive-id="${horse.id}"]`).click()
      await expect(
        page.getByRole('heading', { level: 1, name: '같은 이름', exact: true }),
      ).toBeVisible()
      const basic = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: '기본 정보 · 커리어', exact: true }) })
      await expect(basic.getByText(horse.retiredAt!, { exact: true })).toBeVisible()
      await expect(
        page.getByText(horse.raceRecords![0].race, { exact: true }).first(),
      ).toBeVisible()
      await page.getByRole('button', { name: '← 마구간으로', exact: true }).click()
    }
    await page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
    await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
    await page.getByRole('button', { name: /한도윤/ }).click()
    await expect(page.getByText('만료일 정보 없음', { exact: true })).toBeVisible()
    await expect(page.getByText('2029년 12월까지', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await expect(page.getByRole('region', { name: '이벤트 확인', exact: true })).toBeVisible()
    await page
      .getByRole('group', { name: '월간 행동 선택' })
      .getByRole('button', { name: /^휴식/ })
      .click()
    await page.getByRole('button', { name: '휴식 실행', exact: true }).click()
    await expect(page.getByRole('region', { name: '저장된 월간 행동 결과' })).toBeVisible()
    await expect(page.getByRole('button', { name: '다음 달 시작', exact: true })).toBeEnabled()
    await noOverflow(page)
    await info.attach(`monthly-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test(`notices ${viewport.width}: one modal, keyboard containment, Escape and focus restoration`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const trigger = page.getByRole('button', { name: '공지 및 업데이트', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCount(1)
    const item = dialog.locator('.lab-notice-item').nth(1)
    await item.click()
    await expect(dialog.locator('.lab-notice-list')).toHaveCount(0)
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i < 3 ? 'Tab' : 'Shift+Tab')
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))),
      ).toBe(true)
    }
    await info.attach(`notice-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(item).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByRole('button', { name: '공지 목록 닫기', exact: true }).click()
    await expect(trigger).toBeFocused()
    await noOverflow(page)
  })

  test(`catalog failure ${viewport.width}: a single error and retry restores real API rows`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.route('**/api/racing-catalog/**', (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'API_NOT_CONFIGURED', message: '일시 연결 실패' } },
      }),
    )
    await page.goto('/?view=races')
    // Next.js has its own empty route-announcer alert outside main.
    const errors = page.getByRole('main').getByRole('alert')
    await expect(errors).toHaveCount(1)
    await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toHaveCount(1)
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await page.unroute('**/api/racing-catalog/**')
    await page.getByRole('button', { name: '다시 시도', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(100)
    await expect(errors).toHaveCount(0)
    await noOverflow(page)
  })
}

for (const version of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4'] as const) {
  test(`stored ${version}: marker centres, rank panels, both remaining distances and feed agree`, async ({
    page,
  }, info) => {
    if (version === 'race-sim-v3') {
      await page.setViewportSize({ width: 390, height: 844 })
    }
    const fixture = managementFixture()
    const racing = buildFixture('playback-12')
    const run = racing.career!.raceRun!
    const log = simulateRace(run, version)
    const career = { ...racing.career!, raceRun: { ...run, simulation: summarizeRaceLog(log) } }
    await seed(
      page,
      { career, lifecycle: { ...fixture.lifecycle, ...applyCareer(fixture.lifecycle, career) } },
      log,
    )
    await page.goto('/')
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
    await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
    await page.getByRole('button', { name: '일시정지', exact: true }).click()
    await page.getByRole('button', { name: 'x8', exact: true }).click()
    const ranks = new Set<number>()
    const names = new Map(
      run.runners.map((runner) => [runner.horseSnapshot.id, runner.horseSnapshot.name]),
    )
    const timeline = buildFeedTimeline(log, names)
    const initialRank = frameAt(log, 5000).runners.find(
      (runner) => runner.horseId === run.playerHorseId,
    )!.rank
    const change = log.samples.find(
      (sample) =>
        sample.tMs > 5000 &&
        sample.tMs < log.durationMs - 3000 &&
        frameAt(log, sample.tMs).runners.find((runner) => runner.horseId === run.playerHorseId)!
          .rank !== initialRank,
    )
    const step = Math.ceil(Math.max(20000, (change?.tMs ?? 0) + 1000) / 4)
    for (let i = 0; i < 5; i++) {
      const snapshot = await page.locator('.lab-playback').evaluate((stage) => {
        const focus = stage.querySelector<HTMLElement>('.race-focus')!
        return {
          time: Number(stage.getAttribute('data-frame-ms')),
          rank: Number(focus.dataset.rank),
          remaining: Number(focus.dataset.remaining),
          leaderRemaining: Number(
            stage.querySelector('[data-leader-remaining]')?.getAttribute('data-leader-remaining'),
          ),
          historyRank: Number(
            stage.querySelector('[data-player-rank]')?.getAttribute('data-player-rank'),
          ),
          panelTimes: [...stage.querySelectorAll('[data-frame-ms]')].map((el) =>
            Number(el.getAttribute('data-frame-ms')),
          ),
          markers: [...stage.querySelectorAll<HTMLElement>('.race-strip-runner')].map((el) => ({
            id: el.dataset.horseId!,
            rank: Number(el.dataset.rank),
            distance: Number(el.dataset.distance),
            x: Number(el.style.getPropertyValue('--strip-x')),
            centre:
              el.querySelector('b')!.getBoundingClientRect().x +
              el.querySelector('b')!.getBoundingClientRect().width / 2,
          })),
          board: [...stage.querySelectorAll<HTMLElement>('.race-board li')].map((el) => ({
            id: el.dataset.horseId,
            rank: Number(el.dataset.rank),
          })),
          feed: [...stage.querySelectorAll('.race-feed-list li')].map(
            (el) => el.lastElementChild!.textContent,
          ),
        }
      })
      const frame = frameAt(log, snapshot.time)
      const me = frame.runners.find((runner) => runner.horseId === run.playerHorseId)!
      expect(snapshot.rank).toBe(me.rank)
      expect(snapshot.historyRank).toBe(me.rank)
      expect(snapshot.remaining).toBe(Math.max(0, Math.round(log.raceDistance - me.distance)))
      expect(snapshot.leaderRemaining).toBe(frame.remaining)
      expect(snapshot.panelTimes.every((time) => time === frame.tMs)).toBe(true)
      for (const marker of snapshot.markers) {
        const runner = frame.runners.find((runner) => runner.horseId === marker.id)!
        expect(marker.rank).toBe(runner.rank)
        expect(marker.x).toBeCloseTo(runner.distance / log.raceDistance, 8)
        expect(snapshot.board.find((row) => row.id === marker.id)?.rank).toBe(runner.rank)
      }
      const distances = [...snapshot.markers].sort((a, b) => a.distance - b.distance)
      for (let index = 1; index < distances.length; index++) {
        expect(distances[index].centre + 0.1).toBeGreaterThanOrEqual(distances[index - 1].centre)
      }
      expect(snapshot.feed).toEqual(feedAt(timeline, frame.tMs).map((item) => item.text))
      ranks.add(me.rank)
      if (i < 4) {
        await page.getByRole('button', { name: '계속', exact: true }).click()
        await expect
          .poll(async () =>
            Number(await page.locator('.lab-playback').getAttribute('data-frame-ms')),
          )
          .toBeGreaterThan(snapshot.time + step)
        await page.getByRole('button', { name: '일시정지', exact: true }).click()
      }
    }
    expect(ranks.size).toBeGreaterThan(1)
    await noOverflow(page)
    await info.attach(`${version}-synchronized`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
}
