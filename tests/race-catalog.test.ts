import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  RaceCatalogList,
  RaceCatalogDetail,
  CatalogStatus,
} from '../components/career/race-catalog'
import { RaceCatalogFilters } from '../components/career/race-catalog-filters'
import { createCatalogClient, startRequest, type Resource } from '../lib/race-catalog/client'
import {
  catalogUrl,
  readLocation,
  readQuery,
  applyFilters,
  dateText,
  prizeText,
  gradeText,
  selectedCourse,
  type Race,
  type Venue,
} from '../lib/race-catalog/model'
import { withReferencePlayability } from '../packages/shared/src/race-playability'
import { readRaceBrowser } from '../components/career/game-race-browser'
import { handleCatalog } from '../lib/race-catalog/proxy'
const seed: { races: Race[]; racecourses: Venue[] } = JSON.parse(
  readFileSync(new URL('../services/api/seeds/racing.catalog.json', import.meta.url), 'utf8'),
)
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('server filters and reload/detail/back URL preserve countries, year/month, distances and page; invalid filters reject', () => {
  for (const country of ['KOR', 'JPN', 'USA']) {
    const query = readQuery(
      new URLSearchParams(
        `country=${country}&year=2026&month=9&grade=G1&surface=sand&racecourseId=RC_KOR_SEOUL&minDistance=1200&maxDistance=1800&search=컵&page=9&pageSize=100`,
      ),
    )
    assert.equal(query.country, country)
    assert.equal(query.year, 2026)
    const url = catalogUrl('https://example.test/?other=preserve', query, 'RACE_KOR_2026_KOREA_CUP')
    assert.equal(url.searchParams.get('other'), 'preserve')
    assert.deepEqual(readLocation(url.search), { query, id: 'RACE_KOR_2026_KOREA_CUP' })
    assert.deepEqual(readLocation(catalogUrl(url.href, query).search), { query, id: null })
  }
  const changed = applyFilters(
    new URLSearchParams('country=USA&racecourseId=RC_KOR_SEOUL&grade=G1'),
    { country: 'KOR', page: 9, pageSize: 100 },
  )
  assert.deepEqual(changed, { country: 'USA', grade: 'G1', page: 1, pageSize: 100 })
  for (const params of [
    'page=0',
    'pageSize=851',
    'country=JP',
    'country=KOR&country=USA',
    'month=13',
    'year=2028.5',
    'weight=57',
    'minDistance=2000&maxDistance=1000',
    'surface=mock',
  ]) {
    assert.throws(() => readQuery(new URLSearchParams(params)), params)
  }
})
test('851 source rows preserve null dates, 3 duplicate pairs, national grade and original currencies', () => {
  assert.equal(seed.races.length, 851)
  assert.equal(seed.races.filter((r) => r.scheduleStatus === 'not_run').length, 18)
  assert.equal(seed.races.filter((r) => r.scheduleStatus === 'date_unconfirmed').length, 23)
  for (const row of seed.races.filter((r) => r.raceDate === null)) {
    assert.doesNotMatch(dateText(row), /2026-/)
  }
  const groups = new Map<string, number>()
  for (const row of seed.races) {
    if (row.duplicateGroup) {
      groups.set(row.duplicateGroup, (groups.get(row.duplicateGroup) ?? 0) + 1)
    }
  }
  assert.deepEqual([...groups.values()], [2, 2, 2])
  for (const currency of ['KRW', 'JPY', 'USD']) {
    const row = seed.races.find((r) => r.prizeCurrency === currency && r.prizeMoney !== null)!
    assert.match(prizeText(row), new RegExp(currency))
    assert.ok(prizeText(row).includes(row.prizeBasis || '상금 기준 미확인'))
    assert.ok(gradeText(row).includes(row.grade))
    assert.equal(selectedCourse({ ...row, courseId: null }, []), null)
  }
  assert.equal(prizeText({ ...seed.races[0], prizeMoney: null }), '미확인')
  const before = JSON.stringify(seed.races)
  for (const country of ['KOR', 'JPN', 'USA']) {
    const source = seed.races.find((race) => race.country === country)!
    const race = withReferencePlayability(source)
    const detail = renderToStaticMarkup(
      createElement(RaceCatalogDetail, { race, venue: null, course: null }),
    )
    assert.match(detail, /연결 보류 · 실제 출전 대상이 아닙니다/)
    assert.match(detail, /Game Definition ID/)
    assert.match(detail, /미연결/)
    assert.ok(detail.includes(source.id))
    assert.match(detail, /게임 등록비·상금 미승인/)
    assert.doesNotMatch(detail, /<button/)
    const unknown = renderToStaticMarkup(
      createElement(RaceCatalogDetail, { race: source, venue: null, course: null }),
    )
    assert.match(unknown, /연결 정보를 확인하지 못했습니다/)
  }
  assert.equal(JSON.stringify(seed.races), before)
  assert.equal(readRaceBrowser('?view=races').reference, false)
  assert.equal(readRaceBrowser('?view=races&rc_page=9').reference, true)
  assert.equal(readRaceBrowser('?view=race&raceId=RACE_KOR_2026_KOREA_CUP').reference, true)
  assert.equal(readRaceBrowser('?view=races&raceCatalog=game&rc_page=9').reference, false)
})
test('catalog grades consistently distinguish actual classification, original notation and optional international fields', () => {
  const before = JSON.stringify(seed.races)
  for (const [country, system, grade, expected] of [
    ['KOR', 'KRA_domestic', 'G2', 'G2 · 한국 국내'],
    ['JPN', 'JRA', 'G1', 'G1 · 일본 JRA'],
    ['JPN', 'JRA', 'G2', 'G2 · 일본 JRA'],
    ['JPN', 'NAR', '기타', '기타 · 일본 NAR'],
    ['USA', 'USA', 'G1', 'G1 · 미국 · 원문 1'],
    ['USA', 'USA', 'G3', 'G3 · 미국 · 원문 3'],
    ['USA', 'USA', 'Listed', 'Listed · 미국 · 원문 LR'],
  ] as const) {
    const race = seed.races.find(
      (row) => row.country === country && row.gradeSystem === system && row.grade === grade,
    )!
    assert.equal(gradeText(race), expected)
    const list = renderToStaticMarkup(
      createElement(RaceCatalogList, {
        page: { data: [race], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } },
        venues: [],
        onSelect: () => {},
        onPage: () => {},
      }),
    )
    const detail = renderToStaticMarkup(
      createElement(RaceCatalogDetail, { race, venue: null, course: null }),
    )
    assert.ok(list.includes(expected))
    assert.ok(detail.includes(expected))
  }
  const international = seed.races.find((row) => row.internationalGrade === 'IGⅢ')!
  assert.equal(gradeText(international), 'G1 · 한국 국내 · 국제 IGⅢ')
  const noOriginal = seed.races.find((row) => row.originalGrade === null)!
  assert.doesNotMatch(gradeText(noOriginal), /원문|국제/)
  assert.equal(
    gradeText({ ...noOriginal, grade: '', originalGrade: null, internationalGrade: null }),
    '등급 미확인 · 미국',
  )
  assert.equal(
    gradeText({ ...noOriginal, grade: '', originalGrade: '원문 조건전', internationalGrade: ' ' }),
    '등급 미확인 · 미국 · 원문 원문 조건전',
  )
  assert.equal(JSON.stringify(seed.races), before)
})
test('review identifiers remain in collapsed detail only, with duplicate rows and public source preserved', () => {
  const races = seed.races.filter((row) => row.duplicateGroup)
  const before = JSON.stringify(races)
  const list = renderToStaticMarkup(
    createElement(RaceCatalogList, {
      page: {
        data: races,
        pagination: { page: 1, pageSize: 100, total: races.length, totalPages: 1 },
      },
      venues: [],
      onSelect: () => {},
      onPage: () => {},
    }),
  )
  assert.equal((list.match(/scope="row"/g) ?? []).length, races.length)
  assert.equal((list.match(/중복 검토 후보/g) ?? []).length, races.length)
  for (const race of races) {
    assert.ok(!list.includes(race.duplicateGroup!))
    const detail = renderToStaticMarkup(
      createElement(RaceCatalogDetail, { race, venue: null, course: null }),
    )
    const review = detail.match(/<details\b[^>]*>[\s\S]*?<\/details>/)![0]
    assert.match(review, /<summary[^>]*>내부 검토 정보/)
    assert.doesNotMatch(review.split('>')[0], /\bopen\b/)
    assert.ok(review.includes(race.duplicateGroup!))
    assert.ok(review.includes(race.id))
    assert.ok(review.includes(race.verificationStatus))
    assert.doesNotMatch(detail.replace(review, ''), new RegExp(race.duplicateGroup!))
    assert.match(detail.replace(review, ''), /원본 출처 보기/)
    assert.match(review, /break-all/)
  }
  assert.equal(JSON.stringify(races), before)
})
test('shared client accepts bounded raw-source fixture pages and the selected ID, rejecting oversized/invalid/mismatched responses', async () => {
  const seen: string[] = []
  const client = createCatalogClient(
    'https://example.test/api/racing-catalog',
    async (input, init) => {
      const url = new URL(String(input))
      seen.push(url.pathname + url.search)
      assert.equal(init?.credentials, 'omit')
      assert.equal((init?.headers as Record<string, string>).Authorization, undefined)
      const page = Number(url.searchParams.get('page'))
      return Response.json(
        url.pathname.endsWith('/race-schedule')
          ? {
              data: seed.races.slice((page - 1) * 100, page * 100),
              pagination: { page, pageSize: 100, total: 851, totalPages: 9 },
            }
          : seed.races[123],
      )
    },
  )
  const ids = new Set<string>()
  for (let page = 1; page <= 9; page++) {
    ;(await client.list({ page, pageSize: 100 })).data.forEach((row) => ids.add(row.id))
  }
  assert.equal(ids.size, 851)
  assert.equal((await client.race(seed.races[123].id)).id, seed.races[123].id)
  assert.ok(seen.at(-1)?.endsWith(seed.races[123].id))
  const bad = createCatalogClient('https://bad', async () =>
    Response.json({
      data: seed.races,
      pagination: { page: 1, pageSize: 100, total: 851, totalPages: 9 },
    }),
  )
  await assert.rejects(bad.list({ pageSize: 100 }))
  await assert.rejects(client.race('OTHER_ID'))
  await assert.rejects(
    createCatalogClient('https://bad', async () => Response.json({ mock: true })).list({}),
  )
})
test('rendered table/detail expose API totals and currencies without fabricated details; accessible states/filters remain usable', () => {
  const page = {
    data: seed.races.slice(0, 100),
    pagination: { page: 1, pageSize: 100, total: 848, totalPages: 9 },
  }
  const markup = renderToStaticMarkup(
    createElement(RaceCatalogList, {
      page,
      venues: seed.racecourses,
      onSelect: () => {},
      onPage: () => {},
    }),
  )
  assert.match(markup, /참고 원본 848행/)
  assert.match(markup, /scope="col"/)
  assert.match(markup, /overflow-x-auto/)
  assert.equal((markup.match(/scope="row"/g) ?? []).length, 100)
  assert.ok(markup.includes(seed.races[0].id))
  assert.ok(!markup.includes(seed.races[200].id))
  const race = { ...seed.races[123], maxRunners: null, originalEligibility: null, courseId: null }
  const detail = renderToStaticMarkup(
    createElement(RaceCatalogDetail, { race, venue: null, course: null }),
  )
  assert.ok(detail.includes(race.id))
  assert.match(detail, /코스 미확인/)
  assert.match(detail, /미확인/)
  assert.doesNotMatch(detail, /4월 28일|정량 57kg|날씨|주요 요구 능력|등록료|출전하기/)
  const filters = renderToStaticMarkup(
    createElement(RaceCatalogFilters, {
      query: { page: 9 },
      venues: seed.racecourses,
      onChange: () => {},
    }),
  )
  for (const label of ['한국', '일본', '미국', '경주명 검색', '최소', '일정 상태']) {
    assert.ok(filters.includes(label), label)
  }
  const empty = renderToStaticMarkup(
    createElement(RaceCatalogList, {
      page: { data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } },
      venues: [],
      onSelect: () => {},
      onPage: () => {},
    }),
  )
  assert.match(empty, /수집된 자료가 없습니다/)
  assert.match(
    renderToStaticMarkup(
      createElement(CatalogStatus, {
        resource: { status: 'error', message: 'API 미연결' },
        retry: () => {},
      }),
    ),
    /role="alert"[\s\S]*다시 시도/,
  )
})
test('late response cannot replace newer selection even when abort ignored, and failed requests can retry', async () => {
  let resolve!: (value: string) => void
  const seen: Resource<string>[] = []
  const cancel = startRequest(
    () =>
      new Promise<string>((done) => {
        resolve = done
      }),
    (value) => seen.push(value),
  )
  cancel()
  startRequest(
    async () => 'latest',
    (value) => seen.push(value),
  )
  await flush()
  resolve('stale')
  await flush()
  assert.deepEqual(
    seen.filter((value) => value.status === 'ready'),
    [{ status: 'ready', data: 'latest' }],
  )
  startRequest(
    async () => {
      throw new Error('network down')
    },
    (value) => seen.push(value),
  )
  await flush()
  assert.equal(seen.at(-1)?.status, 'error')
  startRequest(
    async () => 'retry succeeded',
    (value) => seen.push(value),
  )
  await flush()
  assert.deepEqual(seen.at(-1), { status: 'ready', data: 'retry succeeded' })
})
test('protected upstream credentials stay server-side on success and failure without forwarding browser headers or redirects', async () => {
  const bypassToken = 'test-server-only-bypass'
  const trustedOidcToken = 'test-server-only-oidc'
  const headers = {
    'x-vercel-protection-bypass': bypassToken,
    'x-vercel-trusted-oidc-idp-token': trustedOidcToken,
    'set-cookie': `private=${bypassToken}`,
    location: `https://other.example.test/${trustedOidcToken}`,
  }
  for (const status of [200, 401, 500]) {
    const response = await handleCatalog(
      new Request('https://frontend.test/api/racing-catalog/v1/race-schedule?pageSize=1', {
        headers: {
          cookie: 'browser-cookie',
          authorization: 'Bearer browser-session',
          'x-vercel-protection-bypass': 'browser-bypass',
          'x-vercel-trusted-oidc-idp-token': 'browser-identity',
        },
      }),
      ['v1', 'race-schedule'],
      {
        baseUrl: 'https://api.example.test',
        bypassToken,
        trustedOidcToken,
        fetch: async (_url, init) => {
          const actual = new Headers(init?.headers)
          assert.equal(actual.get('x-vercel-protection-bypass'), bypassToken)
          assert.equal(actual.get('x-vercel-trusted-oidc-idp-token'), trustedOidcToken)
          assert.equal(actual.has('authorization'), false)
          assert.equal(actual.has('cookie'), false)
          assert.equal(init?.credentials, 'omit')
          assert.equal(init?.redirect, 'error')
          return Response.json(
            status === 200
              ? {
                  data: [seed.races[0]],
                  pagination: { page: 1, pageSize: 1, total: 848, totalPages: 848 },
                }
              : { error: { code: 'PROTECTED', message: `${bypassToken} ${trustedOidcToken}` } },
            { status, headers },
          )
        },
      },
    )
    assert.equal(response.status, status === 200 ? 200 : 502)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    for (const name of Object.keys(headers)) {
      assert.equal(response.headers.has(name), false)
    }
    const body = await response.text()
    assert.ok(!body.includes(bypassToken))
    assert.ok(!body.includes(trustedOidcToken))
    if (status === 200) {
      assert.equal(JSON.parse(body).pagination.total, 848)
    }
  }
})
test('public proxy restricts paths and filters, protects credentials and returns honest error/not configured/timeout states', async () => {
  const request = (query = '') =>
    new Request('http://frontend/api/racing-catalog/v1/race-schedule' + query, {
      headers: { Authorization: 'Bearer private', Cookie: 'private' },
    })
  const path = ['v1', 'race-schedule']
  assert.equal((await handleCatalog(request(), path, {})).status, 503)
  assert.equal(
    (await handleCatalog(request(), ['v1', 'careers'], { baseUrl: 'http://api' })).status,
    404,
  )
  assert.equal(
    (await handleCatalog(request('?weight=57'), path, { baseUrl: 'http://api' })).status,
    400,
  )
  const trusted = await handleCatalog(request(), path, {
    baseUrl: 'https://api.example.test',
    trustedOidcToken: 'vercel-test-identity',
    bypassToken: 'vercel-test-bypass',
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('x-vercel-trusted-oidc-idp-token'), 'vercel-test-identity')
      assert.equal(headers.get('x-vercel-protection-bypass'), 'vercel-test-bypass')
      assert.equal(headers.has('authorization'), false)
      assert.equal(headers.has('cookie'), false)
      assert.equal(init?.credentials, 'omit')
      return Response.json(
        { error: { code: 'FAIL', message: 'upstream private detail' } },
        { status: 500 },
      )
    },
  })
  assert.equal(trusted.status, 502)
  for (const credentials of [{ bypassToken: 'secret' }, { trustedOidcToken: 'secret' }]) {
    assert.equal(
      (
        await handleCatalog(request(), path, {
          baseUrl: 'http://api',
          ...credentials,
          fetch: async () => {
            assert.fail('Server credentials must not be sent over plaintext HTTP')
          },
        })
      ).status,
      503,
    )
  }
  for (const status of [404, 429, 500]) {
    const response = await handleCatalog(request(), [...path, 'RACE_NOT_FOUND'], {
      baseUrl: 'http://api',
      fetch: async (_url, init) => {
        assert.equal((init?.headers as Record<string, string>).Authorization, undefined)
        assert.equal((init?.headers as Record<string, string>).Cookie, undefined)
        assert.equal(init?.credentials, 'omit')
        return Response.json(
          { error: { code: 'FAIL', message: 'upstream private detail' } },
          { status },
        )
      },
    })
    assert.equal(response.status, status === 500 ? 502 : status)
    if (status === 500) {
      assert.equal(response.headers.get('X-Derby-Catalog-Failure'), 'upstream_http')
      assert.equal(response.headers.get('X-Derby-Catalog-Upstream-Status'), '500')
    }
    assert.doesNotMatch(await response.text(), /upstream private detail/)
  }
  for (const [name, perform, phase, upstreamStatus] of [
    [
      'upstream login HTML',
      async () =>
        new Response('<html>protected</html>', {
          status: 401,
          headers: { 'Content-Type': 'text/html' },
        }),
      'invalid_json',
      '401',
    ],
    [
      'response mismatch',
      async () => Response.json({ unexpected: 'private detail' }),
      'response_contract',
      null,
    ],
    [
      'network failure',
      async () => {
        throw new Error('secret internal detail')
      },
      'network',
      null,
    ],
  ] as const) {
    const result = await handleCatalog(request(), path, { baseUrl: 'http://api', fetch: perform })
    assert.equal(result.status, 502, name)
    assert.equal(result.headers.get('X-Derby-Catalog-Failure'), phase, name)
    assert.equal(result.headers.get('X-Derby-Catalog-Upstream-Status'), upstreamStatus, name)
    assert.doesNotMatch(await result.text(), /private detail|secret internal detail|protected/)
  }
  const response = await handleCatalog(request(), path, {
    baseUrl: 'http://api',
    timeoutMs: 1,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init!.signal!
        signal.addEventListener('abort', () => reject(signal.reason))
        setTimeout(() => reject(new Error('timeout fallback')), 20)
      }),
  })
  assert.equal(response.status, 504)
})
