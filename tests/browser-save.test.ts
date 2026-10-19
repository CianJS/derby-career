import test from 'node:test'
import assert from 'node:assert/strict'
import { compressToEncodedURIComponent } from 'lz-string'
import { BROWSER_SAVE_KEY, readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'
import { readCareer, writeCareer, clearCareer } from '../lib/career/repository'
import { readLifecycleSave, writeLifecycleSave } from '../lib/career/lifecycle-repository'
import { startLocalCareer, retireLocalCareer } from '../lib/career/local-career'
import { applyCareer } from '../lib/career/lifecycle'
import {
  assertCareer,
  startCareer,
  commitAction,
  resolveAction,
  advanceMonth,
} from '../lib/career/model'
import { buildFixture, fixtureLifecycle } from '../lib/career/fixtures'
import { readRaceLog, writeRaceLog } from '../lib/career/race-log-repository'
import { raceLogDigest } from '../lib/career/race-simulation'
import { careerStore } from '../lib/career/store'
import { browserStorage } from './helpers/browser-storage'

const base = () => startCareer('DEV_HORSE_SERENE_STEP')
function locks() {
  let queue = Promise.resolve<unknown>(undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, callback: () => unknown) => {
          const result = queue.then(callback)
          queue = result.catch(() => {})
          return result
        },
      },
    },
  })
}
function legacyChunks(storage: ReturnType<typeof browserStorage>, key: string, text: string) {
  const chunks = text.match(/.{1,2800}/g)!
  storage.cookies.set(key, `old-generation.${chunks.length}`)
  chunks.forEach((chunk, index) => storage.cookies.set(`${key}-old-generation-${index}`, chunk))
}
async function storeFixture(career = base()) {
  const storage = browserStorage()
  locks()
  writeBrowserSave({
    career,
    lifecycle: {
      ...fixtureLifecycle(true),
      ...applyCareer({ activeHorse: null, month: 4 }, career),
    },
  })
  careerStore.configure('local')
  await careerStore.refresh()
  return storage
}

test('blocked cookie reads/writes do not prevent browser-save creation and reload', () => {
  const storage = browserStorage()
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie() {
        throw new DOMException('Blocked', 'SecurityError')
      },
      set cookie(_value: string) {
        throw new Error('Cookie write attempted')
      },
    },
  })
  assert.equal(readCareer(), null)
  writeLifecycleSave(fixtureLifecycle(true))
  writeCareer(base())
  const reloaded = JSON.parse(storage.data.get(BROWSER_SAVE_KEY)!)
  assert.equal(reloaded.lifecycle.archive.length, 2)
  assert.deepEqual(readCareer(), base())
  assert.ok(readBrowserSave().localCareerId)
})

test('browser storage and quota failures never claim a successful save or replace prior data', () => {
  const storage = browserStorage()
  writeCareer(base())
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.throws(() => writeCareer(resolveAction(commitAction(base(), 'speed'))), /저장 공간/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  storage.rejectWrites(false)
  storage.ignoreWrites(true)
  assert.throws(() => writeCareer(resolveAction(commitAction(base(), 'rest'))), /저장 확정/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Blocked', 'SecurityError')
    },
  })
  assert.throws(() => readCareer(), /새 탭/)
  assert.throws(() => writeLifecycleSave(fixtureLifecycle(true)), /새 탭/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
})

test('old compressed career and multi-cookie lifecycle migrate without modifying any cookie', () => {
  const storage = browserStorage()
  const career = resolveAction(commitAction(base(), 'power'))
  const lifecycle = { ...fixtureLifecycle(true), year: 2031, month: 12 }
  legacyChunks(
    storage,
    'derby-career-lifecycle-checkpoint-1',
    'z1:' + compressToEncodedURIComponent(JSON.stringify(career)),
  )
  legacyChunks(
    storage,
    'derby-career-lifecycle-v2',
    encodeURIComponent(JSON.stringify({ version: 2, state: lifecycle })),
  )
  const previous = new Map(storage.cookies)
  assert.deepEqual(readLifecycleSave(), lifecycle)
  assert.deepEqual(readCareer(), career)
  writeLifecycleSave(lifecycle)
  assert.deepEqual(storage.cookies, previous)
  assert.equal(readBrowserSave().career!.action!.actionId, career.action!.actionId)
  assert.equal(readBrowserSave().lifecycle!.archive!.length, 2)
})

test('retirement tombstone prevents legacy active horse resurrection', () => {
  const storage = browserStorage()
  const life = {
    ...fixtureLifecycle(true),
    ...applyCareer({ activeHorse: null, month: 4 }, base()),
  }
  storage.cookies.set('derby-career-lifecycle', encodeURIComponent(JSON.stringify(life)))
  assert.equal(readCareer()!.horse.id, base().horse.id)
  clearCareer()
  assert.equal(readCareer(), null)
  assert.ok(storage.cookies.has('derby-career-lifecycle'))
})

test('missing chunks, malformed pointers, unsupported schemas and invalid records preserve source data', () => {
  const badCareer = {
    ...base(),
    raceRecords: [{ race: 'bad', result: '1착', date: '2028.04', prizeMoney: -1 }],
  }
  for (const bad of [
    '{',
    '{}',
    JSON.stringify({ version: 2, revision: 0 }),
    JSON.stringify({ version: 1, revision: 0, lifecycle: { archive: 'broken' } }),
    JSON.stringify({ version: 1, revision: 0, career: badCareer }),
  ]) {
    const storage = browserStorage()
    storage.data.set(BROWSER_SAVE_KEY, bad)
    assert.throws(() => readBrowserSave())
    assert.throws(() => writeCareer(base()))
    assert.equal(storage.data.get(BROWSER_SAVE_KEY), bad)
  }
  const storage = browserStorage()
  storage.cookies.set('derby-career-lifecycle-checkpoint-1', 'old-generation.1')
  assert.throws(() => readCareer(), /일부/)
  assert.equal(storage.data.size, 0)
  storage.cookies.set('derby-career-lifecycle-checkpoint-1', 'old-generation.1.extra')
  assert.throws(() => readCareer(), /손상/)
  assert.equal(storage.data.size, 0)
})

test('legacy migration retains world year, race records and earned prize summary', () => {
  const storage = browserStorage()
  const current = {
    ...base(),
    raceRecords: [
      {
        raceRunId: 'legacy-run',
        race: '신마전',
        result: '1착',
        placing: 1,
        date: '2030.11',
        prizeMoney: 12000,
      },
    ],
  }
  const life = {
    ...fixtureLifecycle(true),
    ...applyCareer({ activeHorse: null, month: 4 }, current),
    year: 2030,
    month: 12,
  }
  storage.cookies.set('derby-career-lifecycle', encodeURIComponent(JSON.stringify(life)))
  const migrated = readCareer()!
  assert.deepEqual(migrated.calendarDate, { year: 2030, month: 12 })
  assert.deepEqual(migrated.raceRecords, current.raceRecords)
  assert.equal(migrated.record, '1전 1승')
  assert.equal(migrated.prize, '₩12,000')
})

test('retirement is one atomic write; failed archive save retains active career', () => {
  const storage = browserStorage()
  const career = resolveAction(
    commitAction({ ...base(), calendarDate: { year: 2030, month: 12 } }, 'rest'),
  )
  writeBrowserSave({ career, lifecycle: fixtureLifecycle(true) })
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.throws(() => retireLocalCareer(career), /저장 공간/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  assert.deepEqual(readCareer(), career)
  storage.rejectWrites(false)
  retireLocalCareer(career)
  const retired = readBrowserSave()
  assert.equal(retired.career, null)
  assert.equal(retired.lifecycle!.archive!.length, 3)
  assert.equal(retired.lifecycle!.activeHorse, null)
  assert.ok(retired.lifecycle!.lastRetiredId)
  const next = startLocalCareer(career.horse.id, null)
  assert.deepEqual(next.calendarDate, { year: 2030, month: 12 })
  const january = advanceMonth(
    resolveAction(commitAction(next, 'rest')),
    resolveAction(commitAction(next, 'rest')).action!.actionId,
  )
  assert.deepEqual(january.calendarDate, { year: 2031, month: 1 })
})

test('store retirement returns the committed archive and survives reload and repeated confirmation', async () => {
  const career = resolveAction(commitAction(startCareer('DEV_HORSE_RED_COMET'), 'speed'))
  await storeFixture(career)
  const receipt = await careerStore.release()
  assert.ok(receipt && receipt.mode === 'local')
  const retired = receipt.lifecycle
  assert.equal(retired.activeHorse, null)
  assert.equal(retired.lifecycleView, 'careerComplete')
  assert.equal(retired.archive!.length, 3)
  assert.equal(retired.archive![0].id, retired.lastRetiredId)
  assert.equal(retired.archive![0].name, career.horse.name)
  assert.equal(
    retired.archive![0].stats.find(([label]) => label === '속도')![1],
    career.values.speed,
  )
  assert.deepEqual(readBrowserSave().lifecycle, JSON.parse(JSON.stringify(retired)))
  assert.equal(careerStore.getSnapshot().career, null)
  assert.equal(careerStore.getSnapshot().busy, false)
  assert.equal(careerStore.getSnapshot().error, null)
  const committed = readBrowserSave()
  assert.equal(await careerStore.release(), false)
  assert.deepEqual(readBrowserSave(), committed)
  await careerStore.refresh()
  assert.equal(careerStore.getSnapshot().career, null)
  assert.equal(await careerStore.select(career.horse.id), true)
  assert.deepEqual(readCareer()!.calendarDate, career.calendarDate)
  assert.deepEqual(readBrowserSave().lifecycle!.archive, committed.lifecycle!.archive)
})

test('failed store retirement is visible and retry archives exactly once', async () => {
  const storage = await storeFixture()
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.equal(await careerStore.release(), false)
  assert.match(careerStore.getSnapshot().error!, /저장 공간/)
  assert.equal(careerStore.getSnapshot().busy, false)
  assert.ok(careerStore.getSnapshot().career)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  storage.rejectWrites(false)
  const receipt = await careerStore.release()
  assert.ok(receipt && receipt.mode === 'local')
  assert.equal(receipt.lifecycle.archive!.length, 3)
  assert.equal(careerStore.getSnapshot().error, null)
})

test('durable retirement supplies completion data even when subsequent storage reads are denied', async () => {
  const storage = await storeFixture(startCareer('DEV_HORSE_RED_COMET'))
  const getItem = storage.target.getItem
  let denyReads = false
  storage.target.getItem = (key) => {
    if (denyReads) {
      throw new DOMException('Blocked', 'SecurityError')
    }
    const value = getItem(key)
    if (key === BROWSER_SAVE_KEY && value && JSON.parse(value).career === null) {
      // The atomic write's verification succeeds; a new UI read would now fail.
      denyReads = true
    }
    return value
  }
  const receipt = await careerStore.release()
  assert.ok(receipt && receipt.mode === 'local')
  assert.equal(receipt.lifecycle.activeHorse, null)
  assert.equal(receipt.lifecycle.archive![0].name, '레드 코멧')
  assert.equal(careerStore.getSnapshot().error, null)
  assert.throws(() => readLifecycleSave(), /저장소/)
  const persisted = JSON.parse(storage.data.get(BROWSER_SAVE_KEY)!)
  assert.equal(persisted.lifecycle.lastRetiredId, receipt.lifecycle.lastRetiredId)
})

test('simultaneous retirement confirmations commit only one archive snapshot', async () => {
  await storeFixture()
  let unlock!: () => void
  const gate = new Promise<void>((resolve) => {
    unlock = resolve
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, callback: () => unknown) => {
          await gate
          return callback()
        },
      },
    },
  })
  const first = careerStore.release()
  assert.equal(careerStore.getSnapshot().busy, true)
  assert.equal(await careerStore.release(), false)
  unlock()
  const receipt = await first
  assert.ok(receipt && receipt.mode === 'local')
  assert.equal(readBrowserSave().lifecycle!.archive!.length, 3)
  assert.equal(careerStore.getSnapshot().busy, false)
})

test('career-only saves can retire, and large archives reload beyond legacy cookie limits', () => {
  const storage = browserStorage()
  writeCareer(base())
  retireLocalCareer(readCareer()!)
  const archived = readBrowserSave().lifecycle!.archive![0]
  const archive = Array.from({ length: 150 }, (_, index) => ({
    ...archived,
    id: `archive-${index}`,
  }))
  writeBrowserSave({ lifecycle: { ...readBrowserSave().lifecycle, archive } })
  assert.ok(storage.data.get(BROWSER_SAVE_KEY)!.length > 90000)
  assert.deepEqual(readLifecycleSave(), readBrowserSave().lifecycle)
  assert.equal(readBrowserSave().lifecycle!.archive!.length, 150)
  assert.equal(storage.cookies.size, 0)
})

test('serialization failure preserves the previous durable save', () => {
  const storage = browserStorage()
  writeCareer(base())
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.throws(() => writeBrowserSave({ lifecycle: circular }), /변환/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
})

test('legacy injury recovery and two-column aptitude survive migration', () => {
  const storage = browserStorage()
  writeBrowserSave({
    lifecycle: {
      ...fixtureLifecycle(true),
      ...applyCareer({ activeHorse: null, month: 4 }, base()),
    },
  })
  const life = {
    ...readBrowserSave().lifecycle!,
    activeHorse: {
      ...readBrowserSave().lifecycle!.activeHorse!,
      health: '경상',
      healthRecovery: 1,
      aptitude: [['잔디', '좋음']],
    },
  }
  storage.cookies.set('derby-career-lifecycle', encodeURIComponent(JSON.stringify(life)))
  storage.data.clear()
  const migrated = readCareer()!
  assert.equal(migrated.health, '경상')
  assert.equal(migrated.healthRecovery, 1)
  assert.deepEqual(migrated.horse.aptitude, [['잔디', '좋음']])
})

test('missing or denied Web Locks block mutation and preserve durable saves', async () => {
  const storage = await storeFixture()
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  assert.equal(await careerStore.commit('speed', 1), false)
  assert.match(careerStore.getSnapshot().error!, /HTTPS/)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request() {
          throw new DOMException('Blocked', 'SecurityError')
        },
      },
    },
  })
  assert.equal(await careerStore.release(), false)
  assert.match(careerStore.getSnapshot().error!, /새 탭/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
})

test('queued local retirement cannot execute or overwrite state after switching to server mode', async () => {
  const storage = await storeFixture()
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  let unlock!: () => void
  const gate = new Promise<void>((resolve) => {
    unlock = resolve
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, callback: () => unknown) => {
          await gate
          return callback()
        },
      },
    },
  })
  const previousFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  })
  globalThis.fetch = async () =>
    Response.json({ error: { code: 'UNAVAILABLE', message: 'retry' } }, { status: 503 })
  try {
    const pending = careerStore.release()
    careerStore.configure('server')
    unlock()
    assert.equal(await pending, false)
    await careerStore.refresh()
    assert.equal(careerStore.getSnapshot().mode, 'server')
    assert.equal(await careerStore.release(), false)
    assert.match(careerStore.getSnapshot().error!, /서버 육성 기록/)
    assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  } finally {
    globalThis.fetch = previousFetch
    locks()
    careerStore.configure('local')
    await careerStore.refresh()
  }
})

test('locked race and unresolved action cannot retire; active career cannot be replaced', () => {
  const storage = browserStorage()
  const racing = buildFixture('playback-12').career!
  writeBrowserSave({ career: racing, lifecycle: fixtureLifecycle(true) })
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  assert.throws(() => retireLocalCareer(racing), /경주/)
  assert.throws(() => retireLocalCareer(commitAction(base(), 'speed')), /행동/)
  assert.throws(() => startLocalCareer('DEV_HORSE_RED_COMET', racing), /은퇴/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
})

test('store retirement waits for locked race completion and archives its exact result', async () => {
  const fixture = buildFixture('playback-12')
  const storage = await storeFixture(fixture.career!)
  const previous = storage.data.get(BROWSER_SAVE_KEY)
  assert.equal(await careerStore.release(), false)
  assert.match(careerStore.getSnapshot().error!, /확정한 경주를 완료/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), previous)
  assert.equal(await careerStore.completeRace(fixture.log!.raceRunId, fixture.log!.result), true)
  const completed = readCareer()!
  const receipt = await careerStore.release()
  assert.ok(receipt && receipt.mode === 'local')
  assert.deepEqual(receipt.lifecycle.archive![0].raceRecords, completed.raceRecords)
  assert.equal(receipt.lifecycle.archive![0].prize, completed.prize)
  assert.equal(readCareer(), null)
})

test('stale lifecycle metadata cannot erase retirement or overwrite authoritative horse growth', () => {
  browserStorage()
  const old = { ...fixtureLifecycle(true), ...applyCareer({ activeHorse: null, month: 4 }, base()) }
  const raised = resolveAction(commitAction(base(), 'speed'))
  writeBrowserSave({ career: raised, lifecycle: old })
  writeLifecycleSave(old)
  const active = readBrowserSave().lifecycle!.activeHorse!
  assert.equal(active.stats.find(([label]) => label === '속도')![1], raised.values.speed)
  retireLocalCareer(raised)
  const retired = readBrowserSave().lifecycle!
  writeLifecycleSave(old)
  assert.equal(readBrowserSave().lifecycle!.activeHorse, null)
  assert.deepEqual(readBrowserSave().lifecycle!.archive, retired.archive)
  assert.equal(readBrowserSave().lifecycle!.lastRetiredId, retired.lastRetiredId)
})

test('failed race-log write retains old log; cleanup failure does not reject a durable new log', () => {
  const storage = browserStorage()
  const first = buildFixture('playback-12').log!
  const second = buildFixture('playback-18').log!
  writeRaceLog(first)
  storage.rejectWrites(true)
  assert.throws(() => writeRaceLog(second))
  assert.deepEqual(readRaceLog(first.raceRunId), first)
  storage.rejectWrites(false)
  storage.rejectRemovals(true)
  assert.doesNotThrow(() => writeRaceLog(second))
  assert.equal(raceLogDigest(readRaceLog(second.raceRunId)!), raceLogDigest(second))
  assert.deepEqual(readRaceLog(first.raceRunId), first)
})

test('store repairs a corrupt derived race log from the exact locked digest', async () => {
  const fixture = buildFixture('playback-12')
  const storage = await storeFixture(fixture.career!)
  const id = fixture.career!.raceRun!.raceRunId
  storage.data.set('derby-race-log-v1:' + id, '{')
  const original = storage.data.get(BROWSER_SAVE_KEY)
  await careerStore.refresh()
  assert.equal(careerStore.getSnapshot().error, null)
  assert.equal(raceLogDigest(readRaceLog(id)!), fixture.career!.raceRun!.simulation!.digest)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), original)
})

test('store rejects stale-tab mutations after the same horse definition starts another career', async () => {
  await storeFixture()
  const staleId = careerStore.getSnapshot().localCareerId
  retireLocalCareer(readCareer()!)
  writeCareer(startLocalCareer(base().horse.id, null))
  assert.notEqual(readBrowserSave().localCareerId, staleId)
  assert.equal(await careerStore.commit('speed', 1), false)
  assert.equal(readCareer()!.action, null)
  assert.equal(await careerStore.release(), false)
  await careerStore.refresh()
  assert.equal(await careerStore.commit('speed', 1), true)
  assert.ok(readCareer()!.action?.result)
})

test('a failed resolved-action write keeps its commitment and retry grows exactly once', async () => {
  const storage = await storeFixture()
  const native = storage.target.setItem
  let writes = 0
  storage.target.setItem = (key, value) => {
    if (key === BROWSER_SAVE_KEY && ++writes === 2) {
      throw new DOMException('Full', 'QuotaExceededError')
    }
    native(key, value)
  }
  assert.equal(await careerStore.commit('speed', 1), false)
  const committed = readCareer()!
  assert.equal(committed.action!.result, null)
  assert.deepEqual(committed.values, base().values)
  storage.target.setItem = native
  await careerStore.refresh()
  assert.deepEqual(readCareer()!.values, resolveAction(committed).values)
  await careerStore.refresh()
  assert.deepEqual(readCareer()!.values, resolveAction(committed).values)
})

test('save validation rejects unsafe data shapes rather than crashing presentation or overwriting storage', () => {
  browserStorage()
  writeCareer(base())
  for (const field of [
    { age: 0 },
    { health: null },
    { contractedJockeyIds: [null] },
    { horse: { ...base().horse, aptitude: [null] } },
    { raceRecords: [{ race: 'x', result: null, date: '2028.04' }] },
  ]) {
    assert.throws(() => assertCareer({ ...base(), ...field }))
  }
  const before = readBrowserSave()
  const action = commitAction(base(), 'rest').action!
  for (const fields of [
    { action: false },
    { eventLog: [null] },
    { event: [] },
    { raceRun: null },
    { action: { ...action, event: null } },
  ]) {
    assert.throws(
      () => assertCareer({ ...base(), ...fields }),
      (error) =>
        error instanceof Error && !(error instanceof TypeError) && /저장된/.test(error.message),
    )
  }
  assert.throws(() => writeBrowserSave({ career: undefined }))
  assert.throws(() => writeBrowserSave({ lifecycle: undefined }))
  for (const bad of [
    null,
    [],
    { archive: 'wrong' },
    { activeHorse: {} },
    { year: '2028' },
    { month: 13 },
    { recentActivity: [null] },
    { postRace: { committed: true } },
  ]) {
    assert.throws(() => writeLifecycleSave(bad))
    assert.deepEqual(readBrowserSave(), before)
  }
})

test('trust survives durable Local reload and retirement without leaking into a new career', () => {
  browserStorage()
  const career = {
    ...base(),
    jockeyTrust: { SEO_JIAN: { starts: 3, trust: 40 }, HAN_DOYUN: { starts: 1, trust: 15 } },
  }
  writeCareer(career)
  assert.deepEqual(readCareer()?.jockeyTrust, career.jockeyTrust)
  const archived = retireLocalCareer(readCareer()!)
  assert.deepEqual(archived.archive[0].jockeyTrust, career.jockeyTrust)
  assert.deepEqual(readBrowserSave().lifecycle?.archive?.[0].jockeyTrust, career.jockeyTrust)
  assert.equal(readCareer(), null)
  writeCareer(startLocalCareer(career.horse.id, null))
  assert.deepEqual(readCareer()?.jockeyTrust ?? {}, {})
  assert.deepEqual(readBrowserSave().lifecycle?.archive?.[0].jockeyTrust, career.jockeyTrust)
})
