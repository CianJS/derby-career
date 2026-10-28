import {
  test,
  expect,
  catalog,
  sizes,
  results,
  assertResults,
  reset,
  apply,
  capture,
} from './catalog-qa'
import type { Query, Race } from '../../lib/race-catalog/model'

for (const viewport of sizes) {
  test(`catalog filters ${viewport.width}: countries and individual fields use real filtered rows`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/?view=races&raceCatalog=reference')
    for (const [country, total] of [
      ['KOR', 51],
      ['JPN', 176],
      ['USA', 621],
    ] as const) {
      await page.getByRole('combobox', { name: '개최국', exact: true }).selectOption(country)
      const data = await assertResults(page, { country }, total)
      expect(data.data.every((race) => race.country === country)).toBe(true)
    }
    const selects: [string, string, Query, number?][] = [
      ['월', '9', { month: 9 }],
      ['등급', 'G1', { grade: 'G1' }],
      ['노면', 'turf', { surface: 'turf' }],
      ['경마장', 'RC_KOR_SEOUL', { racecourseId: 'RC_KOR_SEOUL' }],
      ['일정 상태', 'date_unconfirmed', { scheduleStatus: 'date_unconfirmed' }, 23],
      ['일정 상태', 'not_run', { scheduleStatus: 'not_run' }, 18],
    ]
    for (const [label, value, query, total] of selects) {
      await reset(page)
      await page.getByRole('combobox', { name: label, exact: true }).selectOption(value)
      const data = await assertResults(page, query, total)
      expect(data.pagination.total).toBeGreaterThan(0)
      for (const race of data.data) {
        if (query.month) {
          expect(race.raceDate?.slice(5, 7)).toBe('09')
        }
        if (query.grade) {
          expect(race.grade).toBe(query.grade)
        }
        if (query.surface) {
          expect(race.surface).toBe(query.surface)
        }
        if (query.racecourseId) {
          expect(race.racecourseId).toBe(query.racecourseId)
        }
        if (query.scheduleStatus) {
          expect(race.raceDate).toBe(null)
        }
      }
    }
    const inputs: [string, string, Query][] = [
      ['연도', '2026', { year: 2026 }],
      ['최소 거리 (m)', '1800', { minDistance: 1800 }],
      ['최대 거리 (m)', '1600', { maxDistance: 1600 }],
      ['경주명 검색', '코리아', { search: '코리아' }],
    ]
    for (const [label, value, query] of inputs) {
      await reset(page)
      await page.getByLabel(label, { exact: true }).fill(value)
      await apply(page)
      const data = await assertResults(page, query)
      expect(data.pagination.total).toBeGreaterThan(0)
      for (const race of data.data) {
        if (query.year) {
          expect(race.year).toBe(query.year)
        }
        if (query.minDistance) {
          expect(race.distanceMeters!).toBeGreaterThanOrEqual(query.minDistance)
        }
        if (query.maxDistance) {
          expect(race.distanceMeters!).toBeLessThanOrEqual(query.maxDistance)
        }
        if (query.search) {
          expect(race.name).toContain(query.search)
        }
      }
    }
    await capture(page, info, 'individual-filter-results')
  })

  test(`catalog compound ${viewport.width}: combined filters, resets, invalid bounds and empty results`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/?view=races&rc_country=USA&rc_page=3')
    await assertResults(page, { country: 'USA', page: 3 })
    await page
      .getByRole('combobox', { name: '경마장', exact: true })
      .selectOption('RC_USA_SARATOGA')
    await assertResults(page, { country: 'USA', racecourseId: 'RC_USA_SARATOGA', page: 1 })
    await page.getByRole('combobox', { name: '개최국', exact: true }).selectOption('KOR')
    await assertResults(page, { country: 'KOR', page: 1 }, 51)
    await expect(page.getByRole('combobox', { name: '경마장', exact: true })).toHaveValue('')
    for (const [label, value] of [
      ['월', '9'],
      ['등급', 'G1'],
      ['노면', 'sand'],
      ['경마장', 'RC_KOR_SEOUL'],
    ]) {
      await page.getByRole('combobox', { name: label, exact: true }).selectOption(value)
    }
    await page.getByLabel('연도', { exact: true }).fill('2026')
    await page.getByLabel('최소 거리 (m)', { exact: true }).fill('1200')
    await page.getByLabel('최대 거리 (m)', { exact: true }).fill('1800')
    await apply(page)
    const query: Query = {
      country: 'KOR',
      year: 2026,
      month: 9,
      grade: 'G1',
      surface: 'sand',
      racecourseId: 'RC_KOR_SEOUL',
      minDistance: 1200,
      maxDistance: 1800,
    }
    await assertResults(page, query, 2)
    await capture(page, info, 'combined-korean-filter')
    await page.getByLabel('최소 거리 (m)', { exact: true }).fill('2000')
    await apply(page)
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      '최소 거리는 최대 거리보다 클 수 없습니다.',
    )
    await expect(results(page).locator('tbody tr')).toHaveCount(2)
    await reset(page)
    await page.getByLabel('경주명 검색', { exact: true }).fill('QA_존재하지않는_경주')
    await apply(page)
    await assertResults(page, { search: 'QA_존재하지않는_경주' }, 0)
    await expect(results(page)).toContainText('조회 결과가 없습니다.')
    await capture(page, info, 'empty-results')
  })

  test(`catalog keyboard ${viewport.width}: filter change keeps keyboard focus and Tab order`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/?view=races&raceCatalog=reference')
    const country = page.getByRole('combobox', { name: '개최국', exact: true })
    await country.focus()
    await country.selectOption('USA')
    await assertResults(page, { country: 'USA' }, 621)
    await expect(country).toBeFocused()
    await page.getByLabel('경주명 검색', { exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '조건 적용 / 검색', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await assertResults(page, { country: 'USA' }, 621)
    await capture(page, info, 'keyboard-filter')
  })

  test(`catalog page history ${viewport.width}: Back and Forward restore filtered page`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/?view=races&rc_country=USA&rc_page=1&rc_pageSize=100')
    await assertResults(page, { country: 'USA', page: 1 })
    await page
      .getByRole('navigation', { name: '경주 목록 페이지', exact: true })
      .getByRole('button', { name: '다음', exact: true })
      .click()
    await assertResults(page, { country: 'USA', page: 2 })
    await page.goBack()
    await assertResults(page, { country: 'USA', page: 1 })
    await page.goForward()
    await assertResults(page, { country: 'USA', page: 2 })
    await capture(page, info, 'page-history')
  })

  test(`catalog return ${viewport.width}: selected row, vertical and horizontal scroll, direct filtered URL`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const query: Query = { country: 'USA', page: 2, surface: 'turf' }
    await page.goto('/?view=races&rc_country=USA&rc_page=2&rc_pageSize=100&rc_surface=turf')
    const data = await assertResults(page, query)
    const id = data.data[30].id
    const row = page.locator(`#catalog-${id}`)
    await row.scrollIntoViewIfNeeded()
    const table = page.getByRole('region', { name: '경주 목록 표, 가로 스크롤 가능' })
    await table.evaluate((el) => {
      el.scrollLeft = 180
    })
    await row.focus()
    const before = {
      y: await page.evaluate(() => scrollY),
      x: await table.evaluate((el) => el.scrollLeft),
    }
    const detail = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/race-schedule/' + id),
    )
    await page.keyboard.press('Enter')
    expect((await detail).status()).toBe(200)
    await expect(page.locator('dd').filter({ hasText: id })).toHaveText(id)
    await page.goBack()
    await assertResults(page, query)
    await expect(row).toBeFocused()
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.y, 0)
    expect(await table.evaluate((el) => el.scrollLeft)).toBe(before.x)
    await page.goForward()
    await expect(page.locator('dd').filter({ hasText: id })).toHaveText(id)
    await page.getByRole('button', { name: '← 경주 정보로 돌아가기', exact: true }).click()
    await assertResults(page, query)
    await expect(row).toBeFocused()
    await page.goto(
      `/?view=race&raceId=${id}&rc_country=USA&rc_page=2&rc_pageSize=100&rc_surface=turf`,
    )
    await page.reload()
    await expect(page.locator('dd').filter({ hasText: id })).toHaveText(id)
    await capture(page, info, 'direct-filtered-detail')
  })

  test(`catalog details ${viewport.width}: three currencies, absent fields, undated/not-run and duplicate groups`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const examples: Race[] = []
    for (const [country, currency] of [
      ['KOR', 'KRW'],
      ['JPN', 'JPY'],
      ['USA', 'USD'],
    ] as const) {
      const list = await catalog.list({ country, pageSize: 100 })
      examples.push(
        list.data.find((race) => race.prizeCurrency === currency && race.prizeMoney !== null)!,
      )
    }
    for (const status of ['date_unconfirmed', 'not_run'] as const) {
      examples.push((await catalog.list({ scheduleStatus: status, pageSize: 100 })).data[0])
    }
    examples.push(
      (await catalog.list({ country: 'JPN', racecourseId: 'RC_JPN_OI', pageSize: 100 })).data[0],
    )
    for (const search of ['EDDIE LOGAN', 'ROBERT J. FRANKEL', 'FIFTH SEASON']) {
      const list = await catalog.list({ search, pageSize: 100 })
      expect(list.pagination.total).toBe(1)
      expect(list.data[0].duplicateGroup).toBeTruthy()
      examples.push(...list.data)
    }
    const evidence = []
    for (const race of examples) {
      expect(race).toBeTruthy()
      const query: Query = { search: race.name }
      if (race.scheduleStatus !== 'dated') {
        query.scheduleStatus = race.scheduleStatus
      }
      const params = new URLSearchParams({ view: 'races', rc_search: race.name })
      if (query.scheduleStatus) {
        params.set('rc_scheduleStatus', query.scheduleStatus)
      }
      await page.goto('/?' + params)
      await assertResults(page, query)
      const row = page.locator(`#catalog-${race.id}`)
      await expect(row).toBeVisible()
      const response = page.waitForResponse((r) =>
        new URL(r.url()).pathname.endsWith('/race-schedule/' + race.id),
      )
      await row.click()
      expect((await response).status()).toBe(200)
      expect((await (await response).json()).id).toBe(race.id)
      await expect(
        page.getByRole('heading', { name: race.name, exact: true, level: 1 }),
      ).toBeVisible()
      const fact = (label: string) =>
        page
          .locator('dl > div')
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator('dd')
      await expect(fact('경주 ID')).toHaveText(race.id)
      await expect(fact('일정 / 상태')).toHaveText(
        race.scheduleStatus === 'dated'
          ? race.raceDate!
          : race.scheduleStatus === 'not_run'
            ? '취소 / 미개최'
            : '일정 미확정',
      )
      await expect(fact('상금 / 기준')).toHaveText(
        race.prizeMoney === null || race.prizeCurrency === null
          ? '미확인'
          : `${race.prizeCurrency} ${race.prizeMoney.toLocaleString('ko-KR')} · ${race.prizeBasis || '상금 기준 미확인'}`,
      )
      if (race.maxRunners === null) {
        await expect(fact('최대 출전두수')).toHaveText('미확인')
      }
      if (race.sexCondition === null) {
        await expect(fact('성별')).toHaveText('미확인')
      }
      if (race.courseId === null) {
        await expect(page.getByRole('heading', { name: '코스 미확인', exact: true })).toBeVisible()
      }
      if (race.duplicateGroup) {
        await expect(fact('중복 후보 그룹')).toContainText(race.duplicateGroup)
      }
      await expect(
        page.locator('dt').filter({ hasText: /날씨|부담중량|참가비|출전료|등록비|필요.*능력/ }),
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: /출전|참가 신청|등록하기/ })).toHaveCount(0)
      evidence.push({
        id: race.id,
        status: race.scheduleStatus,
        currency: race.prizeCurrency,
        prize: race.prizeMoney,
        duplicate: race.duplicateGroup,
      })
      if (
        ['USD', 'JPY', 'KRW'].includes(race.prizeCurrency ?? '') ||
        race.scheduleStatus !== 'dated'
      ) {
        await capture(page, info, race.id)
      }
    }
    await info.attach('selected-real-records', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    })
  })

  test(`catalog delayed ${viewport.width}: late USA response cannot replace latest KOR filter`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.goto('/?view=races&raceCatalog=reference')
    let release!: () => void
    let held!: () => void
    const gated = new Promise<void>((resolve) => {
      release = resolve
    })
    const received = new Promise<void>((resolve) => {
      held = resolve
    })
    let completed = false
    await page.route('**/api/racing-catalog/v1/race-schedule?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('country') !== 'USA') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      expect((await response.json()).pagination.total).toBe(621)
      held()
      await gated
      await route.fulfill({ response })
      completed = true
    })
    await page.getByRole('combobox', { name: '개최국', exact: true }).selectOption('USA')
    await received
    await expect(page.getByText('공개 경주 카탈로그 조회 중…', { exact: true })).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await page.getByRole('combobox', { name: '개최국', exact: true }).selectOption('KOR')
    await assertResults(page, { country: 'KOR' }, 51)
    release()
    await expect.poll(() => completed).toBe(true)
    await assertResults(page, { country: 'KOR' }, 51)
    await capture(page, info, 'late-response-ignored')
  })
}
