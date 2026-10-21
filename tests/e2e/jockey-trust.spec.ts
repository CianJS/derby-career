import { expect, test } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { buildFixture } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'
import { managementFixture } from '../helpers/management-fixture'

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark']) {
    test(`local trust ${viewport.width} ${theme}: actual relationships remain distinct from missing archive data through list, detail, archive and race replay`, async ({
      page,
    }, info) => {
      const racing = buildFixture('playback-12')
      const career = racing.career!
      const fixture = managementFixture()
      const lifecycle = applyCareer(fixture.lifecycle, career)
      await page.setViewportSize(viewport)
      await page.addInitScript(
        ({ key, career, lifecycle, log, theme }) => {
          localStorage.setItem('theme', theme)
          if (!localStorage.getItem(key)) {
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                revision: 1,
                localCareerId: 'trust-e2e',
                career,
                lifecycle,
              }),
            )
            localStorage.setItem(`derby-race-log-v1:${log.raceRunId}`, JSON.stringify(log))
          }
        },
        { key: BROWSER_SAVE_KEY, career, lifecycle, log: racing.log!, theme },
      )
      const noOverflow = async () =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      const home = () =>
        page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
      await page.goto('/')
      await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
      await expect(page.locator('[data-trust-status="available"]')).toHaveCount(3)
      await expect(page.locator('[data-trust-status="unavailable"]')).toHaveCount(0)
      await expect(page.getByText(/호흡도|chemistry/i)).toHaveCount(0)
      await page.getByRole('button', { name: /한도윤/ }).click()
      await expect(
        page.getByRole('heading', { name: '말과 기수의 신뢰도', exact: true }),
      ).toBeVisible()
      await expect(page.locator('[data-trust-status]')).toHaveText('0 / 100')
      await noOverflow()
      await info.attach('jockey-trust-detail', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      await page.reload()
      await page.getByRole('button', { name: /JOCKEYS 기수/ }).click()
      await page.getByRole('button', { name: /서지안/ }).click()
      await expect(page.locator('[data-trust-status]')).toHaveText('0 / 100')
      await home()
      await page.getByRole('button', { name: /STABLE 마구간/ }).click()
      await page.locator('[data-archive-id]').first().click()
      await expect(page.locator('[data-trust-status="unavailable"]').first()).toBeVisible()
      await expect(page.getByText(/Chemistry/)).toHaveCount(0)
      await noOverflow()
      await home()
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
      await expect(page.locator('[data-trust-status="available"]')).toHaveCount(1)
      await noOverflow()
      await info.attach('entry-trust', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      const records = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).career.raceRecords,
        BROWSER_SAVE_KEY,
      )
      await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
      await page
        .getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true })
        .click()
      await expect(page.getByText('서지안 · 신뢰도 변화 정보 없음', { exact: true })).toBeVisible()
      await expect(page.getByText('신뢰도 변화 없음', { exact: true })).toHaveCount(0)
      await page.reload()
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
      await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
      await page
        .getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true })
        .click()
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).career.raceRecords,
          BROWSER_SAVE_KEY,
        ),
      ).toEqual(records)
      await noOverflow()
      await info.attach('race-trust-information-missing', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    })
  }
}
