import { test, expect } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { fixtureLifecycle } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'
import { paidCareer, paidDraft } from '../helpers/economy-fixture'

for (const width of [390, 1440]) {
  test(`Local economy ${width}: atomic paid entry, two tabs, failed completion/retry and retirement inheritance`, async ({
    page,
    context,
  }, info) => {
    const career = paidCareer()
    const lifecycle = applyCareer(
      { ...fixtureLifecycle(true), fundsKRW: 20_000_000, economyLedger: [], activeHorse: null },
      career,
    )
    await context.addInitScript(
      ({ career, lifecycle, key, width }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 1,
              revision: 1,
              localCareerId: 'economy-paid',
              career,
              lifecycle,
            }),
          )
        }
        localStorage.setItem('theme', width === 390 ? 'light' : 'dark')
      },
      { career, lifecycle, key: BROWSER_SAVE_KEY, width },
    )
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), BROWSER_SAVE_KEY)
    const funds = (target = page) => target.getByLabel('마방 자금', { exact: true })
    const home = () =>
      page.getByRole('button', { name: 'DERBY CAREER', exact: true }).first().click()
    const open = async (target: typeof page) => {
      await target.getByRole('button', { name: '육성 계속', exact: true }).click()
      await target
        .getByRole('group', { name: '월간 행동 선택' })
        .getByRole('button', { name: /^경주 / })
        .click()
      await target.getByRole('button', { name: '경주 출전 준비', exact: true }).click()
      await target.locator(`input[value="${paidDraft.raceId}"]`).check()
      await expect(target.locator('[data-entry-balance]')).toContainText('20,000,000')
    }
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(funds()).toHaveText('₩20,000,000')
    await open(page)
    const other = await context.newPage()
    await other.setViewportSize({ width, height: 900 })
    await other.goto('/')
    await open(other)
    const firstButton = await page
      .getByRole('button', { name: '출전 확정', exact: true })
      .elementHandle()
    const secondButton = await other
      .getByRole('button', { name: '출전 확정', exact: true })
      .elementHandle()
    await Promise.all([
      firstButton!.evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click()
        }
      }),
      secondButton!.evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click()
        }
      }),
    ])
    await expect(funds()).toHaveText('₩19,500,000')
    await expect(funds(other)).toHaveText('₩19,500,000')
    await expect(page.getByText('출전 정보 저장 완료 · 선택 잠김', { exact: true })).toBeVisible()
    const entered = await read()
    expect(entered.lifecycle.economyLedger).toHaveLength(1)
    const run = entered.career.raceRun
    expect(run.raceDefinitionSnapshot.entryFee).toBe(500_000)
    const prize = run.simulation.result.prizeMoney
    await info.attach('paid-entry-' + width, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await page.reload()
    await expect(funds()).toHaveText('₩19,500,000')
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
    await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
    await page.getByRole('button', { name: '경주 연출을 건너뛰고 결과 보기', exact: true }).click()
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem
      Object.defineProperty(window, 'rejectEconomySave', { value: true, writable: true })
      Storage.prototype.setItem = function (name, value) {
        if (name === key && Reflect.get(window, 'rejectEconomySave')) {
          throw new DOMException('Full', 'QuotaExceededError')
        }
        return original.call(this, name, value)
      }
    }, BROWSER_SAVE_KEY)
    await page.getByRole('button', { name: '결과 확정 · 다음 달 시작', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '저장 공간' })).toBeVisible()
    expect((await read()).career).toEqual(entered.career)
    expect((await read()).lifecycle.economyLedger).toEqual(entered.lifecycle.economyLedger)
    expect(
      await page.evaluate(
        (id) => localStorage.getItem('derby-race-log-v1:' + id) !== null,
        run.raceRunId,
      ),
    ).toBe(true)
    await page.evaluate(() => Reflect.set(window, 'rejectEconomySave', false))
    await page.getByRole('button', { name: '결과 확정 · 다음 달 시작', exact: true }).click()
    const text = `₩${(19_500_000 + prize).toLocaleString('ko-KR')}`
    await expect(page.locator('[data-settlement-balance]')).toHaveText(text)
    await expect(page.getByText('상금 지급 완료', { exact: true })).toBeVisible()
    await expect(funds(other)).toHaveText(text)
    const completed = await read()
    expect(completed.lifecycle.economyLedger).toHaveLength(2)
    expect(completed.lifecycle.economyLedger[1]).toEqual({
      raceRunId: run.raceRunId,
      kind: 'prize',
      amount: prize,
    })
    expect(completed.career.raceRecords).toHaveLength(career.raceRecords.length + 1)
    expect(completed.lifecycle.activeHorse.raceRecords).toEqual(completed.career.raceRecords)
    expect(completed.lifecycle.activeHorse.jockeyTrust).toEqual(completed.career.jockeyTrust)
    expect(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true)
    await info.attach('paid-settlement-' + width, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    await other.close()
    await page.getByRole('button', { name: '다음 달 육성으로', exact: true }).click()
    await page.reload()
    await expect(funds()).toHaveText(text)
    expect((await read()).lifecycle.economyLedger).toEqual(completed.lifecycle.economyLedger)
    await page.getByRole('button', { name: '육성 계속', exact: true }).click()
    await page.getByRole('button', { name: '현재 육성마 상세', exact: true }).click()
    await page.getByRole('button', { name: '은퇴', exact: true }).click()
    await page.getByRole('button', { name: '은퇴 확정', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Career Archive 보기', exact: true }),
    ).toBeVisible()
    expect((await read()).lifecycle.archive[0].raceRecords).toEqual(completed.career.raceRecords)
    await home()
    await page.getByRole('button', { name: /STABLE 마구간/ }).click()
    await expect(page.getByRole('region', { name: '마방 자금 현황' })).toContainText(text)
    await home()
    await page.getByRole('button', { name: '새 육성마 시작', exact: true }).click()
    await page.getByRole('heading', { name: '레드 코멧', exact: true }).click()
    await page.getByRole('button', { name: '이 말로 육성 시작', exact: true }).click()
    await expect(page.getByRole('group', { name: '월간 행동 선택' })).toBeVisible()
    await expect(funds()).toHaveText(text)
    const next = await read()
    expect(next.lifecycle.economyLedger).toEqual(completed.lifecycle.economyLedger)
    expect(next.career.raceRecords).toHaveLength(0)
    expect(next.lifecycle.archive[0].jockeyTrust).toEqual(completed.career.jockeyTrust)
  })
  test(`Local economy restrictions ${width}: zero funds, free entry, win/health gates and corrupt save`, async ({
    page,
  }, info) => {
    const career = paidCareer()
    const document = {
      version: 1,
      revision: 1,
      localCareerId: 'economy-restrictions',
      career,
      lifecycle: applyCareer(
        { ...fixtureLifecycle(false), fundsKRW: 0, economyLedger: [], activeHorse: null },
        career,
      ),
    }
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(
      ({ key, document }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify(document))
        }
      },
      { key: BROWSER_SAVE_KEY, document },
    )
    await page.goto('/')
    const open = async () => {
      await page.getByRole('button', { name: '육성 계속', exact: true }).click()
      await page
        .getByRole('group', { name: '월간 행동 선택' })
        .getByRole('button', { name: /^경주 / })
        .click()
    }
    await open()
    await page.getByRole('button', { name: '경주 출전 준비', exact: true }).click()
    await expect(page.locator(`input[value="${paidDraft.raceId}"]`)).toBeDisabled()
    await expect(
      page.locator('label').filter({ has: page.locator(`input[value="${paidDraft.raceId}"]`) }),
    ).toContainText('자금이 부족')
    await page.locator('input[value="DEV_M6_ONE_WIN_1800"]').check()
    await page.getByRole('button', { name: '출전 확정', exact: true }).click()
    await expect(page.locator('[data-entry-balance]')).toContainText('₩0')
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).lifecycle.economyLedger[0].amount,
        BROWSER_SAVE_KEY,
      ),
    ).toBe(0)
    document.career = { ...career, health: '중상', healthRecovery: 100 }
    await page.evaluate(
      ({ key, document }) => localStorage.setItem(key, JSON.stringify(document)),
      { key: BROWSER_SAVE_KEY, document },
    )
    await page.reload()
    await open()
    await expect(page.getByText(/경주 출전 제한 · 중상/)).toBeVisible()
    document.career = { ...career, raceRecords: [], record: '0전 0승', prize: '₩0' }
    document.lifecycle.fundsKRW = 20_000_000
    await page.evaluate(
      ({ key, document }) => localStorage.setItem(key, JSON.stringify(document)),
      { key: BROWSER_SAVE_KEY, document },
    )
    await page.reload()
    await open()
    await page.getByRole('button', { name: '경주 출전 준비', exact: true }).click()
    await expect(page.locator(`input[value="${paidDraft.raceId}"]`)).toBeDisabled()
    await expect(
      page.locator('label').filter({ has: page.locator(`input[value="${paidDraft.raceId}"]`) }),
    ).toContainText('1승 이상')
    document.lifecycle.fundsKRW = Number.MAX_SAFE_INTEGER
    await page.evaluate(
      ({ key, document }) => localStorage.setItem(key, JSON.stringify(document)),
      { key: BROWSER_SAVE_KEY, document },
    )
    await page.reload()
    await expect(page.getByLabel('마방 자금', { exact: true })).toHaveText(
      `₩${Number.MAX_SAFE_INTEGER.toLocaleString('ko-KR')}`,
    )
    expect(
      await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true)
    document.lifecycle.fundsKRW = -1
    await page.evaluate(
      ({ key, document }) => localStorage.setItem(key, JSON.stringify(document)),
      { key: BROWSER_SAVE_KEY, document },
    )
    await page.reload()
    await expect(page.getByRole('alert').filter({ hasText: '마방 자금' })).toBeVisible()
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).lifecycle.fundsKRW,
        BROWSER_SAVE_KEY,
      ),
    ).toBe(-1)
    await info.attach('economy-corrupt-preserved-' + width, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}
