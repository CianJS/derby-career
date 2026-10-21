import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NoticeCenter, NoticeList, NoticeDetails } from '../components/notices/notice-center'
import { updateNotices, noticeCenterDescription } from '../lib/notices/updates'
import type { Root } from 'react-dom/client'
import type { components } from '../packages/shared/src/generated/api'
import { horses } from '../lib/career/model'
import { buildFixture } from '../lib/career/fixtures'
import { parseSaveWorkspace, type SaveWorkspace } from '../lib/server-save/workspace'
import { validateRaceEntryOptions } from '../packages/shared/src/generated/save-validation.mjs'
import { BROWSER_SAVE_KEY, readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'
import { careerStore } from '../lib/career/store'
import { managementFixture } from './helpers/management-fixture'
import { contractedJockeys, racesForTurn } from '../lib/career/race-entry'

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
    await clickText('이 말로 육성 시작')
    await h.waitFor(() => !!readBrowserSave().career)
    assert.deepEqual(readBrowserSave().career!.contractedJockeyIds, ['KANG_HAJUN'])
    assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, ['KANG_HAJUN'])
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
      'KANG_HAJUN',
    )
    assert.equal(h.container.querySelectorAll('input[name="entry-tactic"]').length, 4)
    assert.equal(readBrowserSave().career!.raceRun, undefined)
    await clickText('DERBY CAREER')
    await clickText('JOCKEYS')
    assert.match(h.container.textContent!, /계약 기수 1/)
    assert.match(h.container.textContent!, /강하준/)
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
      throw new TypeError('Response lost')
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
    await clickText('이 말로 육성 시작')
    await h.waitFor(() => bodies.length === 1)
    assert.equal(bodies[0].starterJockeyId, 'CHOI_MINJAE')
    assert.equal(bodies[0].horseDefinitionId, horses[0].id)
    assert.equal(bodies[0].homeCountry, 'KOR')
    await clickText('같은 요청으로 다시 확인')
    await h.waitFor(() => bodies.length === 2)
    assert.deepEqual(bodies[1], bodies[0])
    assert.equal(h.dom.window.localStorage.getItem(BROWSER_SAVE_KEY), null)
  } finally {
    await h.close()
  }
})
