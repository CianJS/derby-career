import { test, expect, sizes, capture } from './catalog-qa'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { buildFixture, fixtureLifecycle } from '../../lib/career/fixtures'
import { careerHealth } from '../../lib/career/health'
import { applyCareer } from '../../lib/career/lifecycle'

for (const viewport of sizes) {
  for (const [fixtureId, action, execute] of [
    ['normal', '훈련', '스피드 훈련 실행'],
    ['injured', '치료', '치료 실행'],
  ]) {
    test(`catalog local regression ${viewport.width} ${action}: catalog visit cannot change the saved monthly action or reload result`, async ({
      page,
    }, info) => {
      const career = { ...buildFixture(fixtureId).career!, event: null }
      const lifecycle = applyCareer(fixtureLifecycle(true), career)
      await page.setViewportSize(viewport)
      await page.addInitScript(
        ({ key, career, lifecycle }) => {
          if (!localStorage.getItem(key)) {
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                revision: 1,
                localCareerId: 'qa-game',
                career,
                lifecycle,
              }),
            )
          }
        },
        { key: BROWSER_SAVE_KEY, career, lifecycle },
      )
      await page.goto('/')
      await page.getByRole('button', { name: /RACE DATABASE 경주 정보/ }).click()
      await expect(page.getByRole('region', { name: '경주 조회 결과', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page
        .getByRole('group', { name: '월간 행동 선택' })
        .getByRole('button', { name: new RegExp('^' + action) })
        .click()
      await page.getByRole('button', { name: execute, exact: true }).click()
      await expect(page.getByRole('region', { name: '저장된 월간 행동 결과' })).toBeVisible()
      const saved = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).career, BROWSER_SAVE_KEY)
      const before = await saved()
      expect(before.action.result).not.toBeNull()
      if (action === '훈련') {
        expect(before.values.speed).toBeGreaterThan(career.values.speed)
      } else {
        expect(before.healthRecovery).toBeLessThan(careerHealth(career).recovery)
      }
      await page.reload()
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await expect(page.getByRole('region', { name: '저장된 월간 행동 결과' })).toBeVisible()
      expect(await saved()).toEqual(before)
      await capture(page, info, 'persisted-monthly-' + fixtureId)
    })
  }
}
