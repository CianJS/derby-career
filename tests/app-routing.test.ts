import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import type { components } from '../packages/shared/src/generated/api'
import { buildFixture } from '../lib/career/fixtures'
import { parseSaveWorkspace, type SaveWorkspace } from '../lib/server-save/workspace'
import { validateRaceEntryOptions } from '../packages/shared/src/generated/save-validation.mjs'

type Models = components['schemas']
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

async function harness(mode: 'local' | 'server', path: string, workspace?: SaveWorkspace) {
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
    if (workspace && url.pathname.endsWith('/race-entries')) {
      const options = {
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
