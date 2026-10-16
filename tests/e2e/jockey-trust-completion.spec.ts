import { test, expect } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { applyCareer } from '../../lib/career/lifecycle'
import { fixtureLifecycle } from '../../lib/career/fixtures'
import { trustFixture } from '../helpers/trust-fixture'

for (const width of [390, 1440]) {
  for (const kind of ['growth', 'decline', 'zero'] as const) {
    test(`confirmed trust ${width} ${kind}: v4 completion, reload, archive and independent new horse`, async ({
      page,
    }, info) => {
      const { career, log, completed, change } = trustFixture(kind)
      expect(log.engineVersion).toBe('race-sim-v4')
      expect(Math.sign(change.delta)).toBe(kind === 'growth' ? 1 : kind === 'decline' ? -1 : 0)
      const lifecycle = applyCareer({ ...fixtureLifecycle(true), archive: [] }, career)
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(
        ({ key, career, lifecycle, log }) => {
          if (!localStorage.getItem(key)) {
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                revision: 1,
                localCareerId: 'trust-confirmed',
                career,
                lifecycle,
              }),
            )
            localStorage.setItem(`derby-race-log-v1:${log.raceRunId}`, JSON.stringify(log))
          }
        },
        { key: BROWSER_SAVE_KEY, career, lifecycle, log },
      )
      const home = () =>
        page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
      const read = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), BROWSER_SAVE_KEY)
      await page.goto('/')
      await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
      await expect(
        page.getByRole('button', { name: /서지안/ }).locator('[data-trust-status]'),
      ).toHaveText(`${change.before} / 100`)
      for (const [name, value] of [
        ['한도윤', 0],
        ['서지안', change.before],
        ['한도윤', 0],
      ] as const) {
        await page.getByRole('button', { name: new RegExp(name) }).click()
        await expect(page.locator('[data-trust-status]')).toHaveText(`${value} / 100`)
        await home()
        await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
      }
      await home()
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
      await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
      await page
        .getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true })
        .click()
      await expect(page.locator('[data-trust-change]')).toHaveText('신뢰도 변화 정보 없음')
      await page.getByRole('button', { name: '결과 확정 · 다음 달 시작', exact: true }).click()
      const receipt = page.locator('[data-trust-change="confirmed"]')
      await expect(receipt).toHaveText(
        change.delta === 0
          ? `신뢰도 변화 없음 (${change.after} / 100)`
          : `신뢰도 ${change.before} → ${change.after} (${change.delta > 0 ? '+' : ''}${change.delta})`,
      )
      expect((await read()).career).toEqual(completed)
      await info.attach('confirmed-trust-' + kind, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      await page.getByRole('button', { name: '다음 달 육성으로', exact: true }).click()
      await page.reload()
      expect((await read()).career).toEqual(completed)
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page.getByRole('button', { name: '현재 육성마 상세', exact: true }).click()
      await expect(page.locator('[data-trust-change="confirmed"]')).toHaveCount(1)
      expect((await read()).career.raceRecords).toHaveLength(1)
      await page.getByRole('button', { name: '은퇴', exact: true }).click()
      await page.getByRole('button', { name: '은퇴 확정', exact: true }).click()
      await expect.poll(async () => (await read()).career).toBeNull()
      const retired = await read()
      expect(retired.career).toBeNull()
      expect(retired.lifecycle.archive[0].jockeyTrust).toEqual(completed.jockeyTrust)
      await home()
      await page.getByRole('button', { name: /STABLE 마구간/ }).click()
      await page.locator('[data-archive-id]').first().click()
      await expect(page.locator('[data-trust-status="available"]')).toHaveText(
        `${change.after} / 100`,
      )
      await expect(page.locator('[data-trust-change="confirmed"]')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await info.attach('retired-trust-' + kind, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      await page.reload()
      await page.getByRole('button', { name: '새 육성마 시작', exact: true }).click()
      await page.getByRole('heading', { name: '레드 코멧', exact: true }).click()
      await page.getByRole('button', { name: '이 말로 육성 시작', exact: true }).click()
      await home()
      await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
      await expect(
        page.getByRole('button', { name: /서지안/ }).locator('[data-trust-status]'),
      ).toHaveText('0 / 100')
      expect((await read()).lifecycle.archive[0].jockeyTrust).toEqual(completed.jockeyTrust)
    })
  }
}
