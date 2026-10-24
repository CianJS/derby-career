import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NoticeCenter, NoticeList, NoticeDetails } from '../components/notices/notice-center'
import { expeditionControls } from '../components/career/expedition-panel'
import { migrateTravel } from '../lib/career/local-travel'
import { stableActiveState } from '../components/career/stable'
import { catalogGameplayTarget } from '../components/career/catalog-gameplay-bridge'
import { gameplayUrl, readGameplayView } from '../lib/race-catalog/model'
import { updateNotices, noticeCenterDescription } from '../lib/notices/updates'
import type { Root } from 'react-dom/client'
import type { components } from '../packages/shared/src/generated/api'
import { horses, commitAction, startCareer } from '../lib/career/model'
import { buildFixture } from '../lib/career/fixtures'
import { parseSaveWorkspace, type SaveWorkspace } from '../lib/server-save/workspace'
import { validateRaceEntryOptions } from '../packages/shared/src/generated/save-validation.mjs'
import { BROWSER_SAVE_KEY, readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'
import { careerStore } from '../lib/career/store'
import { managementFixture } from './helpers/management-fixture'
import { contractedJockeys, racesForTurn, localRacesForTurn } from '../lib/career/race-entry'

type Models = components['schemas']

test('notice content is undated feature guidance, with no fabricated release feed or unread indicator', () => {
  const list = renderToStaticMarkup(createElement(NoticeList, { onSelect: () => {} }))
  assert.equal((list.match(/class="lab-notice-item"/g) ?? []).length, updateNotices.length)
  assert.ok(updateNotices.length > 1, 'list and detail navigation remain available')
  for (const notice of updateNotices) {
    assert.equal(notice.category, '이용 안내')
    assert.equal('date' in notice, false)
    const detail = renderToStaticMarkup(createElement(NoticeDetails, { notice }))
    for (const text of notice.details) {
      assert.ok(detail.includes(text))
    }
    assert.doesNotMatch(
      detail,
      /ChatGPT Sites|API 서버가.*배포되어 있지|임시 예시|화면 확인용|2026-10-/,
    )
  }
  assert.doesNotMatch(list, /<time|2026-10-/)
  assert.match(noticeCenterDescription, /운영 공지·업데이트 내역이 없습니다/)
  const center = renderToStaticMarkup(createElement(NoticeCenter))
  assert.match(center, /aria-haspopup="dialog"/)
  assert.match(center, /aria-describedby=/)
  assert.doesNotMatch(center, /<i\b|size-1\.5|화면 확인용/)
})
const catalog: {
  races: Models['RaceSchedule'][]
  racecourses: Models['Racecourse'][]
  courses: Models['Course'][]
} = JSON.parse(
  readFileSync(new URL('../services/api/seeds/racing.catalog.json', import.meta.url), 'utf8'),
)
const raceId = 'RACE_KOR_2026_KOREA_CUP'
const detailPath = `/?view=race&raceId=${raceId}&rc_page=9&rc_pageSize=100&rc_country=KOR&other=keep`

let activeFetch: typeof fetch
const routeFetch: typeof fetch = (input, init) => activeFetch(input, init)

async function harness(
  mode: 'local' | 'server',
  path: string,
  workspace?: SaveWorkspace,
  seed?: () => void,
  raceOptions?: Models['RaceEntryOptions'],
) {
  if (workspace?.career) {
    workspace.career.state.jockeyTrust ??= {}
  }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://derby.test' + path,
    pretendToBeVisual: true,
  })
  const descriptors = new Map<string, PropertyDescriptor | undefined>()
  const install = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  for (const key of [
    'window',
    'document',
    'navigator',
    'history',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'HTMLSelectElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
    'PopStateEvent',
    'StorageEvent',
    'MutationObserver',
  ] as const) {
    install(key, dom.window[key])
  }
  install('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window))
  install('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window))
  install('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(dom.window.navigator, 'locks', {
    value: { request: async (_name: string, fn: () => unknown) => fn() },
  })
  dom.window.scrollTo = () => {}
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  seed?.()
  const requests: string[] = []
  install('fetch', routeFetch)
  activeFetch = async (input) => {
    const url = new URL(String(input), dom.window.location.href)
    requests.push(url.pathname + url.search)
    if (workspace && url.pathname.endsWith('/careers/workspace')) {
      return Response.json(workspace)
    }
    if (workspace?.stable?.travel && url.pathname.endsWith('/expedition')) {
      return Response.json({ travel: workspace.stable.travel })
    }
    if (workspace && url.pathname.endsWith('/catalog/horses')) {
      return Response.json({ data: [] })
    }
    if (workspace?.career && url.pathname.endsWith('/jockey-relations')) {
      const current = workspace.career
      return Response.json({
        careerId: current.id,
        ownedHorseId: current.ownedHorseId,
        revision: current.revision,
        status: current.status,
        data: Object.entries(current.state.jockeyTrust ?? {}).map(([jockeyId, row]) => ({
          jockeyId,
          ...row,
        })),
      })
    }
    if (workspace && url.pathname.endsWith('/race-entries')) {
      const options = raceOptions ?? {
        career: workspace.career,
        defaultEngineVersion: 'race-sim-v3',
        restrictionReason: '이미 확정된 출전입니다.',
        races: [],
        jockeys: [],
        tactics: ['도주', '선행', '선입', '추입'],
      }
      assert.ok(validateRaceEntryOptions(options))
      return Response.json(options)
    }
    if (url.pathname.startsWith('/api/racing-catalog/v1/race-schedule/')) {
      return Response.json(catalog.races.find((race) => race.id === url.pathname.split('/').at(-1)))
    }
    if (url.pathname.endsWith('/race-schedule')) {
      const page = Number(url.searchParams.get('page') ?? 1),
        pageSize = Number(url.searchParams.get('pageSize') ?? 20)
      return Response.json({
        data: catalog.races.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: 851, totalPages: Math.ceil(851 / pageSize) },
      })
    }
    if (url.pathname.endsWith('/racecourses')) {
      return Response.json({
        data: catalog.racecourses,
        pagination: { page: 1, pageSize: 100, total: 90, totalPages: 1 },
      })
    }
    if (url.pathname.includes('/racecourses/')) {
      const id = url.pathname.split('/').at(-1)
      return Response.json({
        racecourse: catalog.racecourses.find((venue) => venue.id === id),
        courses: catalog.courses.filter((course) => course.racecourseId === id),
      })
    }
    return Response.json(
      { error: { code: 'API_NOT_CONFIGURED', message: '저장 서버 미연결 테스트' } },
      { status: 503 },
    )
  }
  if (seed) {
    careerStore.configure(mode)
    await careerStore.refresh()
  }
  // Hydrate the actual App's server markup; effects, store subscriptions and History run in a DOM.
  const [{ default: App }, { hydrateRoot }, { renderToString }] = await Promise.all([
    import('../components/legacy-career'),
    import('react-dom/client'),
    import('react-dom/server'),
  ])
  const container = dom.window.document.getElementById('root')!
  let root: Root | null = null
  const mount = async () => {
    container.innerHTML = renderToString(createElement(App, { saveMode: mode }))
    await act(async () => {
      root = hydrateRoot(container, createElement(App, { saveMode: mode }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  const tick = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  const waitFor = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (check()) {
        return
      }
      await tick()
    }
    assert.ok(check(), container.textContent?.slice(-1000))
  }
  await mount()
  return {
    dom,
    container,
    requests,
    waitFor,
    reload: async () => {
      await act(async () => root!.unmount())
      await mount()
    },
    close: async () => {
      await act(async () => root?.unmount())
      dom.window.close()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor)
        } else {
          Reflect.deleteProperty(globalThis, key)
        }
      }
    },
  }
}

test('actual App: server trust agrees across list/detail/entry, jockey selection and reload; read failure hides old values', async () => {
  const workspace = activeServerWorkspace()
  delete workspace.career!.state.raceRun
  workspace.career!.state.jockeyTrust = Object.fromEntries(
    contractedJockeys.map((j, i) => [j.id, { starts: i, trust: [0, 72, 100][i] }]),
  )
  const options: Models['RaceEntryOptions'] = {
    career: workspace.career!,
    defaultEngineVersion: 'race-sim-v3',
    restrictionReason: null,
    races: racesForTurn(3).map((definition) => ({
      sourceKind: 'development_fixture',
      definition,
      eligible: true,
      restrictionReason: null,
    })),
    jockeys: contractedJockeys.map((j, i) => ({ ...j, chemistry: [0, 72, 100][i] })),
    tactics: ['도주', '선행', '선입', '추입'],
  }
  const h = await harness('server', '/', workspace, undefined, options)
  const clickText = async (text: string) => {
    const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )
    assert.ok(button, text)
    await act(async () => button.click())
  }
  try {
    await h.waitFor(() => h.container.textContent!.includes('육성 계속'))
    await clickText('JOCKEYS')
    await h.waitFor(
      () => h.container.querySelectorAll('[data-trust-status="available"]').length === 3,
    )
    for (const [name, value] of [
      ['한도윤', '0'],
      ['서지안', '72'],
    ] as const) {
      const card = [...h.container.querySelectorAll('main button')].find((b) =>
        b.textContent?.includes(name),
      )!
      assert.equal(card.querySelector('[data-trust-status]')!.textContent, `${value} / 100`)
      await clickText(name)
      assert.equal(h.container.querySelector('[data-trust-status]')!.textContent, `${value} / 100`)
      assert.match(h.container.textContent!, /말과 기수의 신뢰도/)
      await clickText('← 기수 목록')
    }
    await h.reload()
    await clickText('JOCKEYS')
    await h.waitFor(
      () => h.container.querySelectorAll('[data-trust-status="available"]').length === 3,
    )
    await clickText('DERBY CAREER')
    await clickText('육성 계속')
    await clickText('경주')
    await clickText('경주 출전 준비')
    const select = async (id: string, value: string) => {
      const radio = h.container.querySelector<HTMLInputElement>(
        `input[name="entry-jockey"][value="${id}"]`,
      )!
      await act(async () => radio.click())
      const summary = h.container.querySelector('[aria-label="출전 요약"]')!
      assert.equal(summary.querySelector('[data-trust-status]')!.textContent, `${value} / 100`)
    }
    await select('HAN_DOYUN', '0')
    await select('SEO_JIAN', '72')
    assert.doesNotMatch(h.container.textContent!, /호흡도|chemistry/i)
    const previousFetch = activeFetch
    activeFetch = async () => {
      throw new Error('신뢰도 조회 실패 테스트')
    }
    await act(async () => {
      await careerStore.refresh()
    })
    assert.equal(h.container.querySelectorAll('[data-trust-status="available"]').length, 0)
    assert.ok(h.container.querySelector('[data-trust-status="error"]'))
    activeFetch = previousFetch
    await act(async () => {
      await careerStore.refresh()
    })
    assert.equal(
      h.container.querySelector('[aria-label="출전 요약"] [data-trust-status]')!.textContent,
      '72 / 100',
    )
    assert.equal(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY), null)
  } finally {
    await h.close()
  }
})

test('actual App: settings preserves active career and duplicate-name archives; archive selection uses its saved identity', async () => {
  const fixture = managementFixture()
  const h = await harness('local', '/', undefined, () => writeBrowserSave(fixture))
  const click = async (selector: string) => {
    const element = h.container.querySelector<HTMLButtonElement>(selector)
    assert.ok(element, selector)
    await act(async () => element.click())
  }
  try {
    await h.waitFor(() => h.container.textContent!.includes('육성 계속'))
    const before = readBrowserSave()
    await click('button[aria-label="설정"]')
    assert.equal(h.container.querySelector('h1')?.textContent, '설정')
    assert.match(h.container.textContent!, /보존할 마방/)
    assert.doesNotMatch(h.container.textContent!, /마방 생성|최초 등록/)
    assert.equal(
      h.container.querySelector('[aria-label="마방 자금"]')?.textContent?.trim(),
      '₩42,800,000',
    )
    assert.deepEqual(readBrowserSave().career, before.career)
    assert.deepEqual(readBrowserSave().lifecycle?.archive, before.lifecycle?.archive)
    assert.equal(readBrowserSave().lifecycle?.stableName, before.lifecycle?.stableName)
    await click('header button')
    const stableButton = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('STABLE'),
    )!
    await act(async () => stableButton.click())
    // The list and recent cards both carry the same immutable IDs.
    for (const horse of fixture.lifecycle.archive) {
      await click(`[data-archive-id="${horse.id}"]`)
      assert.match(h.container.textContent!, new RegExp(horse.retiredAt!))
      assert.match(h.container.textContent!, new RegExp(horse.raceRecords![0].race))
      const back = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('← 마구간으로'),
      )!
      await act(async () => back.click())
    }
    assert.equal(h.container.querySelectorAll('[data-archive-id]').length, 4)
    assert.equal(
      h.container.querySelectorAll('[data-archive-id]')[2].getAttribute('data-archive-id'),
      fixture.lifecycle.archive[0].id,
    )
    const sort = h.container.querySelector<HTMLSelectElement>('select')!
    assert.equal(sort.value, 'recent')
    await act(async () => {
      sort.value = 'prize'
      sort.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }))
    })
    await act(async () => {
      sort.value = 'recent'
      sort.dispatchEvent(new h.dom.window.Event('change', { bubbles: true }))
    })
    assert.equal(
      h.container.querySelectorAll('[data-archive-id]')[2].getAttribute('data-archive-id'),
      fixture.lifecycle.archive[0].id,
    )
    const jockeyNav = [...h.container.querySelectorAll<HTMLButtonElement>('aside nav button')].find(
      (b) => b.textContent?.includes('기수'),
    )!
    await act(async () => jockeyNav.click())
    const jockey = [...h.container.querySelectorAll<HTMLButtonElement>('main button')].find((b) =>
      b.textContent?.includes('한도윤'),
    )!
    await act(async () => jockey.click())
    assert.match(h.container.textContent!, /만료일 정보 없음/)
    assert.doesNotMatch(h.container.textContent!, /2029년|12월까지/)
    const rows = [...h.container.querySelectorAll<HTMLElement>('[data-riding-record]')]
    const archivedRow = rows.find((row) =>
      fixture.lifecycle.archive.some((horse) => horse.id === row.dataset.horseId),
    )!
    assert.ok(archivedRow)
    const originalHorse = fixture.lifecycle.archive.find(
      (horse) => horse.id === archivedRow.dataset.horseId,
    )!
    const originalRun = archivedRow.dataset.raceRunId
    await act(async () =>
      archivedRow.querySelector<HTMLButtonElement>('[data-record-link="race"]')!.click(),
    )
    assert.equal(h.container.querySelector('h1')?.textContent, originalHorse.name)
    assert.match(h.container.textContent!, /마구간에 보존된 은퇴 경주마/)
    if (originalRun) {
      assert.equal(
        h.container.querySelector<HTMLElement>('[data-selected-record]')?.dataset.recordRaceRunId,
        originalRun,
      )
    }
    assert.doesNotMatch(h.container.textContent!, /선택한 경주 ID가 없습니다/)
    assert.deepEqual(readBrowserSave().lifecycle?.archive, before.lifecycle?.archive)
    await h.reload()
    assert.deepEqual(readBrowserSave().career, before.career)
    assert.deepEqual(readBrowserSave().lifecycle?.archive, before.lifecycle?.archive)
    assert.ok(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY))
  } finally {
    await h.close()
  }
})

test('actual App: header uses current authoritative server funds rather than local lifecycle money', async () => {
  const workspace = activeServerWorkspace()
  workspace.career = null
  workspace.stable!.funds = 12345
  const h = await harness('server', '/', workspace)
  try {
    await h.waitFor(
      () =>
        h.container.querySelector('[aria-label="마방 자금"]')?.textContent?.includes('12,345') ===
        true,
    )
    workspace.stable!.funds = 98765
    await act(async () => {
      await careerStore.refresh()
    })
    assert.match(h.container.querySelector('[aria-label="마방 자금"]')!.textContent!, /98,765/)
    assert.equal(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY), null)
  } finally {
    await h.close()
  }
})
for (const mode of ['local', 'server'] as const) {
  test(`actual App ${mode}: direct detail URL survives initialization and reload without deleting ID or filters`, async () => {
    const h = await harness(mode, detailPath)
    try {
      await h.waitFor(
        () =>
          h.container.querySelector('h1')?.textContent ===
          catalog.races.find((r) => r.id === raceId)!.name,
      )
      assert.equal(h.dom.window.location.search, '?' + detailPath.split('?')[1])
      assert.ok(h.requests.some((path) => path.endsWith('/race-schedule/' + raceId)))
      await h.reload()
      await h.waitFor(
        () =>
          h.container.querySelector('h1')?.textContent ===
          catalog.races.find((r) => r.id === raceId)!.name,
      )
      assert.equal(h.dom.window.location.search, '?' + detailPath.split('?')[1])
    } finally {
      await h.close()
    }
  })
  test(`actual App ${mode}: page 9, selected detail, Back/Forward and explicit home navigation keep the right URL context`, async () => {
    const h = await harness(mode, '/?view=races&rc_page=9&rc_pageSize=100')
    try {
      await h.waitFor(() => !!h.container.querySelector('tbody button'))
      assert.equal(h.container.querySelector('h1')?.textContent, '경주 정보')
      assert.ok(h.requests.some((path) => path.includes('page=9')))
      const selected = h.container.querySelector<HTMLButtonElement>('tbody button')!
      const selectedId = selected.id.slice('catalog-'.length)
      await act(async () => selected.click())
      await h.waitFor(() => h.dom.window.location.search.includes('view=race&'))
      await h.waitFor(
        () =>
          h.container.querySelector('h1')?.textContent ===
          catalog.races.find((r) => r.id === selectedId)!.name,
      )
      await act(async () => {
        h.dom.window.history.back()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(() => h.container.querySelector('h1')?.textContent === '경주 정보')
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('rc_page'), '9')
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('raceId'), null)
      await act(async () => {
        h.dom.window.history.forward()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(
        () =>
          h.container.querySelector('h1')?.textContent ===
          catalog.races.find((r) => r.id === selectedId)!.name,
      )
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('raceId'), selectedId)
      const home = h.container.querySelector<HTMLButtonElement>('header button')!
      await act(async () => home.click())
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('view'), null)
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('raceId'), null)
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('rc_page'), '9')
    } finally {
      await h.close()
    }
  })
}

function activeServerWorkspace() {
  const state = buildFixture('playback-12').career!
  const stableId = randomUUID()
  return parseSaveWorkspace({
    stable: { id: stableId, funds: 42800000, calendarDate: state.calendarDate },
    career: {
      id: randomUUID(),
      stableId,
      ownedHorseId: randomUUID(),
      horseDefinitionId: state.horse.id,
      status: 'active',
      revision: 1,
      authority: 'server',
      funds: 42800000,
      state,
      event: null,
    },
    confirmedActionId: null,
    retirements: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  })
}

test('catalog gameplay destinations use current Local/Server authority and keep unknown states unconfirmed', () => {
  const fixture = managementFixture()
  const career = { ...fixture.career, month: 3, careerTurnIndex: 3 }
  const local: ReturnType<typeof careerStore.getSnapshot> = {
    ready: true,
    busy: false,
    pending: false,
    error: null,
    mode: 'local',
    career,
    workspace: null,
    raceOptions: null,
    candidates: [],
    localCareerId: 'local',
    lifecycle: {
      ...fixture.lifecycle,
      lifecycleView: 'home',
      fundsKRW: 20_000_000,
      travel: {
        homeCountry: 'KOR',
        locationCountry: 'KOR',
        activeExpedition: null,
        revision: 0,
      },
    },
  }
  const before = JSON.stringify(local)
  assert.equal(catalogGameplayTarget(local).view, 'entry')
  assert.equal(
    catalogGameplayTarget({ ...local, career: commitAction(career, 'rest') }).view,
    'training',
  )
  assert.equal(catalogGameplayTarget({ ...local, career: null }).view, 'home')
  assert.match(catalogGameplayTarget({ ...local, career: null }).reason, /육성마가 필요/)
  assert.equal(
    catalogGameplayTarget({ ...local, career: { ...career, month: 4, careerTurnIndex: 4 } }).view,
    'training',
  )
  assert.equal(
    catalogGameplayTarget({ ...local, career: { ...career, contractedJockeyIds: [] } }).view,
    'training',
  )
  assert.equal(
    catalogGameplayTarget({ ...local, career: { ...career, health: '중상' } }).view,
    'training',
  )
  assert.equal(
    catalogGameplayTarget({ ...local, career: buildFixture('playback-12').career! }).view,
    'training',
  )
  assert.equal(catalogGameplayTarget({ ...local, ready: false }).disabled, true)
  assert.equal(catalogGameplayTarget({ ...local, pending: true }).disabled, true)
  const workspace = activeServerWorkspace()
  delete workspace.career!.state.raceRun
  const server = { ...local, mode: 'server' as const, workspace, career: workspace.career!.state }
  assert.equal(catalogGameplayTarget(server).view, 'training')
  assert.match(catalogGameplayTarget(server).reason, /아직 확인하지 못/)
  const options: Models['RaceEntryOptions'] = {
    career: workspace.career!,
    defaultEngineVersion: 'race-sim-v3',
    restrictionReason: null,
    races: racesForTurn(3).map((definition) => ({
      sourceKind: 'development_fixture',
      definition,
      eligible: true,
      restrictionReason: null,
    })),
    jockeys: contractedJockeys,
    tactics: ['도주', '선행', '선입', '추입'],
  }
  assert.equal(catalogGameplayTarget({ ...server, raceOptions: options }).view, 'entry')
  assert.equal(
    catalogGameplayTarget({
      ...server,
      raceOptions: { ...options, races: options.races.map((row) => ({ ...row, eligible: false })) },
    }).view,
    'training',
  )
  assert.equal(
    catalogGameplayTarget({
      ...server,
      raceOptions: { ...options, restrictionReason: '서버 제한' },
    }).reason,
    '서버 제한',
  )
  assert.equal(catalogGameplayTarget({ ...server, workspace: null }).disabled, true)
  assert.equal(
    catalogGameplayTarget({ ...server, error: '연결 실패', raceOptions: options }).view,
    'training',
  )
  assert.match(catalogGameplayTarget({ ...server, error: '연결 실패' }).reason, /연결 실패/)
  assert.equal(JSON.stringify(local), before)
  const url = gameplayUrl('https://derby.test' + detailPath)
  assert.equal(url.searchParams.has('raceId'), false)
  assert.equal(url.searchParams.has('view'), false)
  assert.equal(url.searchParams.get('rc_page'), '9')
  assert.equal(url.searchParams.get('other'), 'keep')
  assert.equal(readGameplayView('race'), null)
})

for (const mode of ['local', 'server'] as const) {
  test(`actual App ${mode}: reference list/detail bridge reaches real entry and restores catalog URL, focus and scroll`, async () => {
    const fixture = managementFixture()
    const career = { ...fixture.career, month: 3, careerTurnIndex: 3 }
    const workspace = activeServerWorkspace()
    workspace.career!.state = {
      ...workspace.career!.state,
      month: 3,
      careerTurnIndex: 3,
      action: null,
    }
    delete workspace.career!.state.raceRun
    const options: Models['RaceEntryOptions'] = {
      career: workspace.career!,
      defaultEngineVersion: 'race-sim-v3',
      restrictionReason: null,
      races: racesForTurn(3).map((definition) => ({
        sourceKind: 'development_fixture',
        definition,
        eligible: true,
        restrictionReason: null,
      })),
      jockeys: contractedJockeys,
      tactics: ['도주', '선행', '선입', '추입'],
    }
    const h = await harness(
      mode,
      '/?view=races&rc_page=9&rc_pageSize=100&other=keep',
      mode === 'server' ? workspace : undefined,
      mode === 'local'
        ? () => writeBrowserSave({ career, lifecycle: fixture.lifecycle })
        : undefined,
      options,
    )
    try {
      await h.waitFor(() => !!h.container.querySelector('tbody button'))
      await h.waitFor(
        () =>
          h.container
            .querySelector<HTMLButtonElement>('#catalog-gameplay-bridge')
            ?.textContent?.trim() === '게임 경주 출전 준비',
      )
      const before = readBrowserSave()
      const scrolls: number[] = []
      h.dom.window.scrollTo = (_x?: number | ScrollToOptions, y?: number) => {
        if (y !== undefined) {
          scrolls.push(y)
        }
      }
      Object.defineProperty(h.dom.window, 'scrollY', { value: 321, configurable: true })
      h.container.querySelector<HTMLElement>('#race-catalog-table')!.scrollLeft = 27
      await act(async () =>
        h.container.querySelector<HTMLButtonElement>('#catalog-gameplay-bridge')!.click(),
      )
      await h.waitFor(() => !!h.container.querySelector('input[name="entry-race"]'))
      assert.equal(new URLSearchParams(h.dom.window.location.search).has('raceId'), false)
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('rc_page'), '9')
      assert.ok(
        [...h.container.querySelectorAll<HTMLInputElement>('input[name="entry-race"]')].every(
          (input) => input.value.startsWith('DEV_'),
        ),
      )
      assert.deepEqual(readBrowserSave(), before)
      await act(async () => {
        h.dom.window.history.back()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(() => !!h.container.querySelector('tbody button'))
      await h.waitFor(() => h.dom.window.document.activeElement?.id === 'catalog-gameplay-bridge')
      assert.equal(h.container.querySelector<HTMLElement>('#race-catalog-table')!.scrollLeft, 27)
      assert.ok(scrolls.includes(321))
      const selected = h.container.querySelector<HTMLButtonElement>('tbody button')!
      const selectedId = selected.id.slice('catalog-'.length)
      await act(async () => selected.click())
      await h.waitFor(
        () =>
          h.container.querySelector('h1')?.textContent ===
          catalog.races.find((row) => row.id === selectedId)!.name,
      )
      const detailUrl = h.dom.window.location.href
      await act(async () =>
        h.container.querySelector<HTMLButtonElement>('#catalog-gameplay-bridge')!.click(),
      )
      await h.waitFor(() => !!h.container.querySelector('input[name="entry-race"]'))
      assert.equal(new URLSearchParams(h.dom.window.location.search).get('raceId'), null)
      await act(async () => {
        h.dom.window.history.back()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(() => h.dom.window.document.activeElement?.id === 'catalog-gameplay-bridge')
      assert.equal(h.dom.window.location.href, detailUrl)
      await act(async () => {
        h.dom.window.history.forward()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(() => !!h.container.querySelector('input[name="entry-race"]'))
      await h.reload()
      await h.waitFor(() => !!h.container.querySelector('input[name="entry-race"]'))
      assert.deepEqual(readBrowserSave(), before)
      // Public catalog failure cannot block the independent, already-confirmed gameplay state.
      await act(async () => {
        h.dom.window.history.back()
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      await h.waitFor(() => !!h.container.querySelector('#catalog-gameplay-bridge'))
      const delegate = activeFetch
      activeFetch = async (input, init) =>
        String(input).includes('/api/racing-catalog/')
          ? Response.json(
              { error: { code: 'CATALOG_UNAVAILABLE', message: '참고 도감 연결 실패' } },
              { status: 503 },
            )
          : delegate(input, init)
      await h.reload()
      await h.waitFor(() => !!h.container.querySelector('[role="alert"]'))
      assert.match(h.container.textContent!, /현재 게임 출전 대상 아님/)
      const bridge = h.container.querySelector<HTMLButtonElement>('#catalog-gameplay-bridge')!
      assert.equal(bridge.disabled, false)
      await act(async () => bridge.click())
      await h.waitFor(() => !!h.container.querySelector('input[name="entry-race"]'))
      assert.deepEqual(readBrowserSave(), before)
    } finally {
      await h.close()
    }
  })
}

for (const mode of ['local', 'server'] as const) {
  test(`actual App ${mode}: stable active card routes without commands and stays separate from retirement records`, async () => {
    const fixture = managementFixture()
    const workspace = activeServerWorkspace()
    delete workspace.career!.state.raceRun
    const h = await harness(
      mode,
      '/',
      mode === 'server' ? workspace : undefined,
      mode === 'local' ? () => writeBrowserSave(fixture) : undefined,
    )
    const clickText = async (text: string) => {
      const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      )
      assert.ok(button, text)
      await act(async () => button.click())
    }
    const openStable = async () => {
      const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('STABLE'),
      )!
      await act(async () => button.click())
      await h.waitFor(() => !!h.container.querySelector('#stable-current-horse'))
    }
    try {
      await h.waitFor(() => !!careerStore.getSnapshot().career)
      const before = readBrowserSave()
      const beforeServer = JSON.stringify(workspace)
      assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]').length, 0)
      assert.equal(
        [...h.container.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === '기수 변경',
        ),
        false,
      )
      await openStable()
      const current = h.container.querySelector('section[aria-labelledby="stable-current-horse"]')!
      assert.match(current.textContent!, /육성 계속/)
      const savedCareer = mode === 'server' ? workspace.career!.state : readBrowserSave().career!
      assert.ok(current.textContent!.includes(savedCareer.horse.name))
      assert.ok(current.textContent!.includes(`${savedCareer.age}세`))
      assert.ok(current.textContent!.includes(`${savedCareer.careerTurnIndex}턴`))
      if (mode === 'server') {
        assert.match(h.container.textContent!, /아직 기록된 은퇴 경주마가 없습니다/)
        const snapshot = careerStore.getSnapshot()
        const stale = { ...snapshot, career: fixture.career }
        assert.equal(stableActiveState(stale, 'server').horse?.id, workspace.career!.ownedHorseId)
        assert.equal(
          stableActiveState({ ...snapshot, workspace: null }, 'server').status,
          'loading',
        )
      }
      const detail = current.querySelector<HTMLButtonElement>('button')!
      await act(async () => detail.click())
      await h.waitFor(
        () =>
          h.container.textContent!.includes(savedCareer.horse.name) &&
          !h.container.querySelector('#stable-current-horse'),
      )
      await act(async () => h.container.querySelector<HTMLButtonElement>('header button')!.click())
      await openStable()
      await clickText('육성 계속')
      await h.waitFor(() => !!h.container.querySelector('[aria-labelledby="month-outlook"]'))
      await clickText('← 홈')
      await openStable()
      assert.deepEqual(readBrowserSave(), before)
      assert.equal(JSON.stringify(workspace), beforeServer)
      await h.reload()
      await h.waitFor(() => !!careerStore.getSnapshot().career)
      await openStable()
      assert.ok(
        h.container
          .querySelector('section[aria-labelledby="stable-current-horse"]')!
          .textContent!.includes(savedCareer.horse.name),
      )
      if (mode === 'local') {
        await act(async () =>
          h.container
            .querySelector<HTMLButtonElement>(
              'section[aria-labelledby="stable-current-horse"] button',
            )!
            .click(),
        )
        await clickText('은퇴')
        await clickText('은퇴 확정')
        await h.waitFor(() => !careerStore.getSnapshot().career)
        await act(async () =>
          h.container.querySelector<HTMLButtonElement>('header button')!.click(),
        )
        await openStable()
        assert.match(
          h.container.querySelector('section[aria-labelledby="stable-current-horse"]')!
            .textContent!,
          /현재 육성 중인 경주마가 없습니다/,
        )
        const retired = readBrowserSave().lifecycle!.archive![0]
        assert.ok(h.container.querySelector(`[data-archive-id="${retired.id}"]`))
        const archive = JSON.stringify(readBrowserSave().lifecycle!.archive)
        await act(async () => {
          await careerStore.select(savedCareer.horse.id)
        })
        await h.waitFor(
          () =>
            !!h.container.querySelector('section[aria-labelledby="stable-current-horse"] button'),
        )
        assert.match(
          h.container.querySelector('section[aria-labelledby="stable-current-horse"]')!
            .textContent!,
          /0전 0승/,
        )
        assert.equal(JSON.stringify(readBrowserSave().lifecycle!.archive), archive)
      } else {
        const current = careerStore.getSnapshot()
        for (const patch of [{ pending: true }, { busy: true }, { error: '서버 연결 오류' }]) {
          assert.equal(stableActiveState({ ...current, ...patch }, 'server').horse, null)
        }
        assert.equal(
          stableActiveState(
            { ...current, career: null, workspace: { ...current.workspace!, career: null } },
            'server',
          ).status,
          'empty',
        )
      }
    } finally {
      await h.close()
    }
  })
}

test('actual App restores a saved server raceplay after initial workspace load and on reload', async () => {
  const h = await harness('server', '/', activeServerWorkspace())
  try {
    await h.waitFor(() => h.requests.some((path) => path.includes('/race-runs/')))
    assert.ok(h.container.textContent?.includes('육성으로 돌아가기'))
    const previous = h.requests.filter((path) => path.includes('/race-runs/')).length
    await h.reload()
    await h.waitFor(
      () => h.requests.filter((path) => path.includes('/race-runs/')).length > previous,
    )
    assert.ok(h.container.textContent?.includes('육성으로 돌아가기'))
  } finally {
    await h.close()
  }
})

test('actual App keeps a public detail route when a server race exists, including an already-loaded workspace on remount', async () => {
  const h = await harness('server', detailPath, activeServerWorkspace())
  try {
    const name = catalog.races.find((race) => race.id === raceId)!.name
    await h.waitFor(() => h.container.querySelector('h1')?.textContent === name)
    await h.reload()
    await h.waitFor(() => h.container.querySelector('h1')?.textContent === name)
    assert.equal(new URLSearchParams(h.dom.window.location.search).get('raceId'), raceId)
    assert.ok(!h.requests.some((path) => path.includes('/race-runs/')))
  } finally {
    await h.close()
  }
})

test('actual App: new Local starter is explicit, recovers failed draft saves/reload and reaches one-jockey race entry', async () => {
  const h = await harness('local', '/', undefined, () =>
    writeBrowserSave({
      career: null,
      lifecycle: { stableName: '초기 선택 마방', country: '대한민국', archive: [] },
    }),
  )
  const clickText = async (text: string) => {
    const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )
    assert.ok(button, text)
    await act(async () => button.click())
  }
  const storagePrototype = h.dom.window.Storage.prototype
  const originalWrite = storagePrototype.setItem
  try {
    await clickText('새 육성마 시작')
    await h.waitFor(() => h.container.querySelectorAll('input[name="starter-jockey"]').length === 4)
    assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]:checked').length, 0)
    assert.equal(h.container.querySelectorAll('input[name="horse"]').length, 0)
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[value="KANG_HAJUN"]')!.click(),
    )
    const before = readBrowserSave()
    storagePrototype.setItem = () => {
      throw new h.dom.window.DOMException('Full', 'QuotaExceededError')
    }
    await clickText('이 기수 선택 확정')
    assert.match(h.container.querySelector('[role="alert"]')!.textContent!, /저장 공간/)
    assert.deepEqual(readBrowserSave(), before)
    assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]:checked').length, 1)
    storagePrototype.setItem = originalWrite
    await clickText('이 기수 선택 확정')
    await h.waitFor(() => h.container.querySelectorAll('input[name="horse"]').length === 3)
    assert.equal(readBrowserSave().lifecycle!.starterJockeyId, 'KANG_HAJUN')
    assert.equal(readBrowserSave().lifecycle!.contractedJockeyIds, undefined)
    assert.equal(readBrowserSave().career, null)
    await h.reload()
    await clickText('새 육성마 시작')
    await h.waitFor(() => h.container.querySelectorAll('input[name="horse"]').length === 3)
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[name="horse"]')!.click(),
    )
    const selectedHorseId = h.container.querySelector<HTMLInputElement>(
      'input[name="horse"]:checked',
    )!.value
    await clickText('기수 변경')
    assert.equal(h.dom.window.document.activeElement?.id, 'starter-jockey-title')
    assert.equal(
      h.container.querySelector<HTMLInputElement>('input[name="starter-jockey"]:checked')!.value,
      'KANG_HAJUN',
    )
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[value="PARK_SEOYUN"]')!.click(),
    )
    const beforeChange = readBrowserSave()
    storagePrototype.setItem = () => {
      throw new h.dom.window.DOMException('Full', 'QuotaExceededError')
    }
    await clickText('이 기수 선택 확정')
    assert.deepEqual(readBrowserSave(), beforeChange)
    assert.equal(
      h.container.querySelector<HTMLInputElement>('input[name="starter-jockey"]:checked')!.value,
      'PARK_SEOYUN',
    )
    storagePrototype.setItem = originalWrite
    await clickText('이 기수 선택 확정')
    await h.waitFor(() => h.container.querySelectorAll('input[name="horse"]').length === 3)
    assert.equal(readBrowserSave().lifecycle!.starterJockeyId, 'PARK_SEOYUN')
    assert.equal(readBrowserSave().lifecycle!.contractedJockeyIds, undefined)
    assert.equal(h.container.querySelectorAll('input[name="horse"]:checked').length, 0)
    assert.match(h.container.textContent!, /박서윤의 선행 특화/)
    await act(async () =>
      h.container
        .querySelector<HTMLInputElement>(`input[name="horse"][value="${selectedHorseId}"]`)!
        .click(),
    )
    const combination = h.container.querySelector(
      '[aria-label="선택한 말과 초기 기수 조합"]',
    )!.textContent!
    const actualHorse = horses.find((horse) => horse.id === selectedHorseId)!
    assert.ok(combination.includes(actualHorse.name))
    assert.ok(combination.includes('박서윤'))
    assert.ok(
      combination.includes(
        `전술 적성 ${actualHorse.aptitude.find(([tactic]) => tactic === '선행')![1]}`,
      ),
    )
    const startButton = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('이 말로 육성 시작'),
    )!
    await act(async () => {
      startButton.click()
      startButton.click()
    })
    await h.waitFor(() => !!readBrowserSave().career)
    assert.deepEqual(readBrowserSave().career!.contractedJockeyIds, ['PARK_SEOYUN'])
    assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, ['PARK_SEOYUN'])
    assert.doesNotMatch(h.container.textContent!, /다른 탭에서 초기 기수 선택/)
    await act(async () => {
      for (const month of [1, 2]) {
        await careerStore.commit('rest', month)
        await careerStore.next(readBrowserSave().career!.action!.actionId)
      }
    })
    await clickText('경주')
    await clickText('경주 출전 준비')
    assert.equal(h.container.querySelectorAll('input[name="entry-jockey"]').length, 1)
    assert.equal(
      h.container.querySelector<HTMLInputElement>('input[name="entry-jockey"]')!.value,
      'PARK_SEOYUN',
    )
    assert.equal(h.container.querySelectorAll('input[name="entry-tactic"]').length, 4)
    assert.equal(readBrowserSave().career!.raceRun, undefined)
    await clickText('DERBY CAREER')
    await clickText('JOCKEYS')
    assert.match(h.container.textContent!, /계약 기수 1/)
    assert.match(h.container.textContent!, /박서윤/)
    assert.doesNotMatch(h.container.textContent!, /한도윤|서지안|윤태성|최대 3명/)
    await clickText('미계약 기수')
    assert.match(h.container.textContent!, /추후 영입 예정/)
    assert.match(h.container.textContent!, /한도윤/)
  } finally {
    storagePrototype.setItem = originalWrite
    await h.close()
  }
})

test('actual App: a fresh Local lobby starts with stable creation before starter or horse selection', async () => {
  const h = await harness('local', '/', undefined, () => {})
  try {
    const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('새 육성마 시작'),
    )!
    await act(async () => button.click())
    await h.waitFor(() => h.container.textContent!.includes('마방을 시작합니다.'))
    assert.equal(
      h.container.querySelectorAll('input[name="starter-jockey"], input[name="horse"]').length,
      0,
    )
    assert.equal(readBrowserSave().career, undefined)
    const input = h.container.querySelector<HTMLInputElement>(
      'input[placeholder="마방 이름을 입력하세요"]',
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(h.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '첫 계약 마방',
      )
      input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }))
    })
    const create = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === '마방 생성',
    )!
    assert.equal(create.disabled, false)
    await act(async () => create.click())
    await h.waitFor(() => h.container.querySelectorAll('input[name="starter-jockey"]').length === 4)
    assert.equal(readBrowserSave().lifecycle!.stableName, '첫 계약 마방')
    assert.equal(readBrowserSave().lifecycle!.contractedJockeyIds, undefined)
    assert.equal(h.container.querySelectorAll('input[name="horse"]').length, 0)
  } finally {
    await h.close()
  }
})

test('actual App: developer Server creation submits the explicit starter and preserves the same journal request after response loss', async () => {
  const workspace = parseSaveWorkspace({
    stable: null,
    career: null,
    confirmedActionId: null,
    retirements: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  })
  const h = await harness('server', '/', workspace)
  const delegate = activeFetch
  const bodies: Models['CreateCareer'][] = []
  activeFetch = async (input, init) => {
    if (String(input).endsWith('/catalog/horses')) {
      return Response.json({
        data: horses.map((definition) => ({ sourceKind: 'development_fixture', definition })),
      })
    }
    if (init?.method === 'POST' && String(input).endsWith('/careers')) {
      bodies.push(JSON.parse(String(init.body)))
      if (bodies.length === 1) {
        const template = activeServerWorkspace()
        const receipt = parseSaveWorkspace({
          ...template,
          career: {
            ...template.career,
            id: bodies[0].careerId,
            horseDefinitionId: bodies[0].horseDefinitionId,
            state: startCareer(bodies[0].horseDefinitionId, {
              starterJockeyId: bodies[0].starterJockeyId,
            }),
          },
        })
        receipt.career!.state.jockeyTrust = {}
        receipt.stable!.contractedJockeyIds = [...receipt.career!.state.contractedJockeyIds]
        Object.assign(workspace, receipt)
        throw new TypeError('Response lost')
      }
      return Response.json({ career: workspace.career })
    }
    return delegate(input, init)
  }
  const clickText = async (text: string) => {
    const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )
    assert.ok(button, text)
    await act(async () => button.click())
  }
  try {
    await act(async () => {
      await careerStore.refresh()
    })
    await clickText('새 육성마 시작')
    await h.waitFor(() => h.container.querySelectorAll('input[name="starter-jockey"]').length === 4)
    assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]:checked').length, 0)
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[value="CHOI_MINJAE"]')!.click(),
    )
    await clickText('이 기수 선택 확정')
    assert.equal(h.container.querySelectorAll('input[name="horse"]').length, 3)
    assert.equal(bodies.length, 0)
    assert.equal(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY), null)
    await h.reload()
    await clickText('새 육성마 시작')
    await h.waitFor(() => h.container.querySelectorAll('input[name="horse"]').length === 3)
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[name="horse"]')!.click(),
    )
    await clickText('기수 변경')
    assert.equal(
      h.container.querySelector<HTMLInputElement>('input[name="starter-jockey"]:checked')!.value,
      'CHOI_MINJAE',
    )
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[value="HAN_DOYUN"]')!.click(),
    )
    const key = 'derby-career-server-starter-selection-v1'
    const storagePrototype = h.dom.window.Storage.prototype
    const originalWrite = storagePrototype.setItem
    storagePrototype.setItem = function (name, value) {
      if (name === key) {
        throw new h.dom.window.DOMException('세션 저장 접근 실패', 'SecurityError')
      }
      originalWrite.call(this, name, value)
    }
    try {
      await clickText('이 기수 선택 확정')
      assert.match(h.container.querySelector('[role="alert"]')!.textContent!, /세션 저장 접근 실패/)
      assert.equal(h.dom.window.sessionStorage.getItem(key), 'CHOI_MINJAE')
      assert.equal(
        h.container.querySelector<HTMLInputElement>('input[name="starter-jockey"]:checked')!.value,
        'HAN_DOYUN',
      )
    } finally {
      storagePrototype.setItem = originalWrite
    }
    await clickText('이 기수 선택 확정')
    assert.equal(h.dom.window.sessionStorage.getItem(key), 'HAN_DOYUN')
    assert.equal(h.container.querySelectorAll('input[name="horse"]:checked').length, 0)
    assert.match(h.container.textContent!, /한도윤의 도주 특화/)
    assert.equal(bodies.length, 0)
    await act(async () =>
      h.container.querySelector<HTMLInputElement>('input[name="horse"]')!.click(),
    )
    await clickText('이 말로 육성 시작')
    await h.waitFor(() => bodies.length === 1)
    assert.equal(bodies[0].starterJockeyId, 'HAN_DOYUN')
    assert.equal(bodies[0].horseDefinitionId, horses[0].id)
    assert.equal(bodies[0].homeCountry, 'KOR')
    await clickText('같은 요청으로 다시 확인')
    await h.waitFor(() => bodies.length === 2)
    assert.deepEqual(bodies[1], bodies[0])
    await h.waitFor(() => !!careerStore.getSnapshot().career)
    assert.deepEqual(careerStore.getSnapshot().career!.contractedJockeyIds, ['HAN_DOYUN'])
    assert.deepEqual(careerStore.getSnapshot().workspace!.stable!.contractedJockeyIds, [
      'HAN_DOYUN',
    ])
    assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]').length, 0)
    assert.equal(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY), null)
  } finally {
    await h.close()
  }
})

for (const mode of ['local', 'server'] as const) {
  for (const country of ['KOR', 'JPN', 'USA'] as const) {
    test(`actual App ${mode} ${country}: common expedition status, readonly navigation and country-warning focus preserve saves`, async () => {
      const fixture = managementFixture()
      fixture.career.month = 6
      fixture.career.careerTurnIndex = 6
      const travel = migrateTravel({ country: fixture.lifecycle.country }).travel
      if (country !== 'KOR') {
        travel.locationCountry = country
        travel.revision = 2
        travel.activeExpedition = {
          id: randomUUID(),
          careerId: randomUUID(),
          targetCountry: country,
          targetRaceDefinitionId: `DEV_${country}_M3_MILE_1600`,
          status: 'active',
          startedTurn: 3,
          startedRevision: 1,
          endedTurn: null,
          endReason: null,
          createdAt: '2035-01-01T00:00:00Z',
          endedAt: null,
        }
      }
      const workspace = activeServerWorkspace()
      delete workspace.career!.state.raceRun
      workspace.stable!.travel = travel
      const h = await harness(
        mode,
        '/',
        mode === 'server' ? workspace : undefined,
        mode === 'local'
          ? () => writeBrowserSave({ ...fixture, lifecycle: { ...fixture.lifecycle, travel } })
          : undefined,
        mode === 'server'
          ? {
              career: workspace.career!,
              defaultEngineVersion: 'race-sim-v3',
              restrictionReason: null,
              races: localRacesForTurn(workspace.career!.state.careerTurnIndex)
                .filter((r) => r.countryCode === 'KOR')
                .map((definition) => ({
                  sourceKind: 'development_fixture',
                  definition,
                  eligible: false,
                  restrictionReason: '국가별 출전 조건을 확인해 주세요.',
                })),
              jockeys: contractedJockeys.map((j) => ({ ...j, chemistry: 0 })),
              tactics: ['도주', '선행', '선입', '추입'],
            }
          : undefined,
      )
      const click = async (label: string) => {
        const button = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === label,
        )
        assert.ok(button, label)
        await act(async () => button.click())
      }
      const panel = () => h.container.querySelector<HTMLElement>('#career-expedition')!
      try {
        await h.waitFor(() => !!careerStore.getSnapshot().career)
        const saved = readBrowserSave()
        const serverSaved = JSON.stringify(workspace)
        await act(async () =>
          h.container.querySelector<HTMLButtonElement>('[aria-label="설정"]')!.click(),
        )
        await h.waitFor(() => !!panel())
        const status = panel().querySelector('[data-travel-location]')!.textContent
        assert.equal(panel().querySelector('select'), null)
        assert.match(panel().textContent!, country === 'KOR' ? /소속국 체류 중/ : /원정 중/)
        if (country !== 'KOR') {
          assert.ok(panel().textContent!.includes(travel.activeExpedition!.targetRaceDefinitionId!))
        }
        await click('원정 관리 · 육성 화면에서 원정·귀국')
        assert.equal(h.dom.window.document.activeElement, panel())
        assert.equal(h.container.querySelectorAll('#career-expedition').length, 1)
        assert.ok(
          panel().classList.contains('scroll-mt-20'),
          '80px scroll margin clears the 56px sticky header',
        )
        assert.equal(panel().querySelector('[data-travel-location]')!.textContent, status)
        const action = [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === (country === 'KOR' ? '원정 신청' : '귀국'),
        )!
        assert.equal(action.disabled, false)
        assert.equal(panel().querySelector('details')!.open, false)
        assert.ok(
          action.compareDocumentPosition(panel().querySelector('details')!) &
            h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
        )
        const current = careerStore.getSnapshot()
        for (const patch of [{ busy: true }, { pending: true }, { ready: false }]) {
          assert.equal(expeditionControls({ ...current, ...patch }, mode).blocked, true)
        }
        assert.equal(
          expeditionControls(current, mode === 'local' ? 'server' : 'local').travel,
          null,
        )
        assert.equal(expeditionControls(current, mode, false, '저장 오류').blocked, true)
        assert.equal(expeditionControls({ ...current, career: null }, mode).blocked, true)
        if (mode === 'server') {
          assert.equal(expeditionControls({ ...current, raceOptions: null }, mode).blocked, true)
          assert.equal(expeditionControls({ ...current, workspace: null }, mode).travel, null)
          assert.equal(expeditionControls({ ...current, error: '연결 오류' }, mode).blocked, true)
        } else {
          // Local failed writes remain retryable through the existing atomic command path.
          assert.equal(
            expeditionControls({ ...current, error: '저장 공간 부족' }, mode).blocked,
            false,
          )
        }
        const locked = {
          ...current,
          career: { ...current.career!, raceRun: activeServerWorkspace().career!.state.raceRun },
        }
        assert.equal(expeditionControls(locked, mode).blocked, true)
        await click('← 홈')
        await act(async () =>
          [...h.container.querySelectorAll<HTMLButtonElement>('button')]
            .find((b) => b.textContent?.includes('STABLE'))!
            .click(),
        )
        await h.waitFor(() => !!h.container.querySelector('#stable-current-horse'))
        assert.equal(panel().querySelector('[data-travel-location]')!.textContent, status)
        assert.equal(panel().querySelector('select'), null)
        await click('원정 관리 · 육성 화면에서 원정·귀국')
        assert.equal(h.dom.window.document.activeElement, panel())
        await act(async () =>
          [
            ...h.container.querySelectorAll<HTMLButtonElement>(
              '[aria-label="월간 행동 선택"] button',
            ),
          ]
            .find((b) => b.textContent?.startsWith('경주'))!
            .click(),
        )
        await click('경주 출전 준비')
        assert.equal(panel().querySelector('[data-travel-location]')!.textContent, status)
        if (country !== 'KOR') {
          await h.waitFor(() => !!h.container.querySelector('a[href="#career-expedition"]'))
          const link = h.container.querySelector<HTMLAnchorElement>('a[href="#career-expedition"]')!
          await act(async () => link.click())
          assert.equal(h.dom.window.document.activeElement, panel())
          assert.equal(h.dom.window.location.hash, '')
          assert.equal(panel().querySelector('[data-travel-location]')!.textContent, status)
        }
        assert.deepEqual(readBrowserSave(), saved)
        assert.equal(JSON.stringify(workspace), serverSaved)
      } finally {
        await h.close()
      }
    })
  }
}

for (const mode of ['local', 'server'] as const) {
  test(`actual App ${mode}: confirmed race allows readonly expedition navigation while commands stay locked`, async () => {
    const fixture = managementFixture()
    const workspace = activeServerWorkspace()
    fixture.career = structuredClone(workspace.career!.state)
    const travel = migrateTravel({ country: '대한민국' }).travel
    workspace.stable!.travel = travel
    const h = await harness(
      mode,
      '/',
      mode === 'server' ? workspace : undefined,
      mode === 'local'
        ? () => writeBrowserSave({ ...fixture, lifecycle: { ...fixture.lifecycle, travel } })
        : undefined,
    )
    const panel = () => h.container.querySelector<HTMLElement>('#career-expedition')!
    const clickButton = async (button: HTMLButtonElement | undefined | null) => {
      assert.ok(button)
      assert.equal(button.disabled, false)
      await act(async () => button.click())
    }
    try {
      await h.waitFor(() => !!careerStore.getSnapshot().career?.raceRun)
      const saved = readBrowserSave()
      const serverSaved = JSON.stringify(workspace)
      let scrolls = 0
      h.dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
        assert.equal(this.id, 'career-expedition')
        assert.deepEqual(options, { block: 'start' })
        assert.ok(this.classList.contains('scroll-mt-20'))
        scrolls++
      }
      for (const view of ['settings', 'stable']) {
        if (view === 'settings') {
          await clickButton(h.container.querySelector<HTMLButtonElement>('[aria-label="설정"]'))
        } else {
          await clickButton(h.container.querySelector<HTMLButtonElement>('header button'))
          await clickButton(
            [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
              b.textContent?.includes('STABLE'),
            ),
          )
        }
        await h.waitFor(() => !!panel())
        assert.match(panel().textContent!, /확정한 경주를 완료한 뒤/)
        const manage = [...panel().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
          b.textContent?.includes('원정 관리'),
        )
        await clickButton(manage)
        assert.equal(h.dom.window.document.activeElement, panel())
        assert.equal(h.container.querySelectorAll('#career-expedition').length, 1)
        const start = [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === '원정 신청',
        )!
        assert.ok(start)
        assert.equal(start.disabled, true)
        await act(async () => start.click())
        assert.match(panel().textContent!, /확정한 경주를 완료한 뒤/)
      }
      assert.equal(scrolls, 2)
      const snapshot = careerStore.getSnapshot()
      for (const patch of [{ busy: true }, { pending: true }, { error: '연결 오류' }]) {
        assert.equal(expeditionControls({ ...snapshot, ...patch }, mode).canManage, true)
        assert.equal(expeditionControls({ ...snapshot, ...patch }, mode).blocked, true)
      }
      assert.equal(expeditionControls({ ...snapshot, career: null }, mode).canManage, false)
      assert.equal(expeditionControls({ ...snapshot, ready: false }, mode).canManage, false)
      assert.equal(
        expeditionControls(snapshot, mode === 'local' ? 'server' : 'local').canManage,
        false,
      )
      assert.equal(expeditionControls(snapshot, mode, true).canManage, false)
      if (mode === 'server') {
        assert.equal(expeditionControls({ ...snapshot, workspace: null }, mode).canManage, false)
        assert.equal(expeditionControls({ ...snapshot, raceOptions: null }, mode).canManage, true)
      }
      assert.deepEqual(readBrowserSave(), saved)
      assert.equal(JSON.stringify(workspace), serverSaved)
      assert.equal(
        h.requests.some((path) => path.includes('/return')),
        false,
      )
    } finally {
      await h.close()
    }
  })
}

for (const mode of ['local', 'server'] as const) {
  test(`actual App ${mode}: empty existing contracts skip starter changes and never invent candidate combinations`, async () => {
    const workspace = activeServerWorkspace()
    workspace.career = null
    workspace.stable!.contractedJockeyIds = []
    const h = await harness(
      mode,
      '/',
      mode === 'server' ? workspace : undefined,
      mode === 'local'
        ? () =>
            writeBrowserSave({
              career: null,
              lifecycle: { stableName: '기존 빈 계약 마방', contractedJockeyIds: [], archive: [] },
            })
        : undefined,
    )
    try {
      const start = [...h.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('새 육성마 시작'),
      )!
      await act(async () => start.click())
      assert.equal(h.container.querySelectorAll('input[name="starter-jockey"]').length, 0)
      assert.equal(
        [...h.container.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === '기수 변경',
        ),
        false,
      )
      assert.equal(h.container.querySelectorAll('[data-starter-combination]').length, 0)
      if (mode === 'server') {
        assert.equal(h.container.querySelectorAll('input[name="horse"]').length, 0)
        assert.match(h.container.textContent!, /서버에 표시할 육성마 후보가 없습니다/)
      } else {
        assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, [])
      }
    } finally {
      await h.close()
    }
  })
}
