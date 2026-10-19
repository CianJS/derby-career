import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { browserStorage } from './helpers/browser-storage'
import { BROWSER_SAVE_KEY, readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'
import { fixtureLifecycle } from '../lib/career/fixtures'

import { careerStore } from '../lib/career/store'
import { migrateTravel, assertTravel, countryCode } from '../lib/career/local-travel'
import { localRacesForTurn, raceEligibility } from '../lib/career/race-entry'
import { readRaceLog } from '../lib/career/race-log-repository'
import { writeLifecycleSave } from '../lib/career/lifecycle-repository'

async function setup(country = '대한민국') {
  const storage = browserStorage()
  let tail = Promise.resolve<unknown>(undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, fn: () => unknown) => {
          const result = tail.then(fn)
          tail = result.catch(() => {})
          return result
        },
      },
    },
  })
  const base = startCareer('DEV_HORSE_RED_COMET')
  const career = { ...base, month: 3, careerTurnIndex: 3, event: undefined }
  writeBrowserSave({
    career,
    lifecycle: { ...fixtureLifecycle(true), country, fundsKRW: 20_000_000, economyLedger: [] },
  })
  careerStore.configure('local')
  await careerStore.refresh()
  return { storage, career }
}
for (const country of ['JPN', 'USA'] as const) {
  test(`Local ${country}: actual log/prize/trust, country gates, locked return, reload and retirement inheritance`, async () => {
    const { career } = await setup()
    const raceId = `DEV_${country}_M3_MILE_1600`
    const draft = { raceId, jockeyId: 'HAN_DOYUN', tactic: '선행' } as const
    assert.equal(await careerStore.lockRace(draft, career.horse.id, 3), false)
    assert.equal(await careerStore.startExpedition(country, 0, raceId), true)
    const abroad = readBrowserSave()
    assert.equal(abroad.lifecycle!.travel!.locationCountry, country)
    assert.equal(abroad.lifecycle!.fundsKRW, 20_000_000)
    assert.equal(abroad.career!.careerTurnIndex, 3)
    const domestic = localRacesForTurn(3).find((r) => r.id === 'DEV_M3_MILE_1600')!
    assert.match(raceEligibility(career, domestic, 20_000_000, abroad.lifecycle!.travel)!, /귀국/)
    assert.equal(await careerStore.startExpedition(country, 0), false)
    await careerStore.refresh()
    assert.equal(await careerStore.lockRace(draft, career.horse.id, 3), true)
    const locked = readBrowserSave()
    const travel = locked.lifecycle!.travel!
    assert.equal(
      await careerStore.returnExpedition(travel.activeExpedition!.id, travel.revision),
      false,
    )
    assert.deepEqual(readBrowserSave(), locked)
    const log = readRaceLog(locked.career!.raceRun!.raceRunId)!
    assert.equal(await careerStore.completeRace(log.raceRunId, log.result), true)
    const completed = readBrowserSave()
    assert.equal(completed.lifecycle!.fundsKRW, 20_000_000 + log.result.prizeMoney)
    assert.equal(completed.career!.raceRecords.length, 1)
    assert.equal(
      await careerStore.returnExpedition(travel.activeExpedition!.id, travel.revision),
      true,
    )
    const returned = readBrowserSave()
    assert.equal(returned.lifecycle!.travel!.locationCountry, 'KOR')
    assert.equal(
      await careerStore.returnExpedition(travel.activeExpedition!.id, travel.revision),
      true,
    )
    assert.deepEqual(readBrowserSave(), returned)
    assert.equal(await careerStore.startExpedition(country, 2), true)
    const second = readBrowserSave()
    assert.equal(await careerStore.returnExpedition(travel.activeExpedition!.id, 3), false)
    assert.deepEqual(readBrowserSave(), second)
    writeLifecycleSave({ ...second.lifecycle, travel: abroad.lifecycle!.travel })
    assert.deepEqual(readBrowserSave().lifecycle!.travel, second.lifecycle!.travel)
    assert.ok(await careerStore.release())
    const retired = readBrowserSave()
    assert.equal(retired.lifecycle!.travel!.activeExpedition, null)
    assert.equal(retired.lifecycle!.travel!.locationCountry, 'KOR')
    assert.equal(await careerStore.select('DEV_HORSE_SERENE_STEP'), true)
    assert.equal(readBrowserSave().lifecycle!.fundsKRW, retired.lifecycle!.fundsKRW)
    assert.deepEqual(readBrowserSave().lifecycle!.archive, retired.lifecycle!.archive)
  })
}
test('legacy country migration preserves all four countries and corrupt travel never overwrites the save', async () => {
  for (const country of ['대한민국', '일본', '미국', '영국']) {
    const { storage } = await setup(country)
    assert.equal(readBrowserSave().lifecycle!.travel!.homeCountry, countryCode(country))
    if (country === '영국') {
      const before = storage.data.get(BROWSER_SAVE_KEY)
      assert.equal(await careerStore.startExpedition('JPN', 0), false)
      assert.equal(storage.data.get(BROWSER_SAVE_KEY), before)
    }
  }
  const travel = migrateTravel({ country: '영국' }).travel
  assert.equal(travel.homeCountry, 'GBR')
  assert.throws(() => assertTravel({ ...travel, locationCountry: 'KOR' }))
  assert.throws(() => assertTravel({ ...travel, revision: -1 }))
})
test('parallel departure/entry, revision conflicts and quota failure preserve one atomic travel document', async () => {
  const { storage, career } = await setup()
  const before = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.equal(await careerStore.startExpedition('JPN', 0), false)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), before)
  storage.rejectWrites(false)
  await Promise.all([careerStore.startExpedition('JPN', 0), careerStore.startExpedition('USA', 0)])
  const saved = readBrowserSave()
  assert.equal(saved.lifecycle!.travel!.revision, 1)
  assert.equal(saved.lifecycle!.travel!.activeExpedition!.targetCountry, 'JPN')
  const t = saved.lifecycle!.travel!
  storage.rejectWrites(true)
  assert.equal(await careerStore.returnExpedition(t.activeExpedition!.id, 1), false)
  assert.deepEqual(readBrowserSave(), saved)
  storage.rejectWrites(false)
  await Promise.all([
    careerStore.lockRace(
      { raceId: 'DEV_JPN_M3_MILE_1600', jockeyId: 'HAN_DOYUN', tactic: '선행' },
      career.horse.id,
      3,
    ),
    careerStore.returnExpedition(t.activeExpedition!.id, 1),
  ])
  const end = readBrowserSave()
  assert.ok(
    end.career!.raceRun
      ? end.lifecycle!.travel!.locationCountry === 'JPN'
      : end.lifecycle!.travel!.locationCountry === 'KOR',
  )
})

test('Japanese and US home stables enter their own fixture without an expedition and reject Korea until departure', async () => {
  for (const [label, code] of [
    ['일본', 'JPN'],
    ['미국', 'USA'],
  ] as const) {
    const { career } = await setup(label)
    const travel = readBrowserSave().lifecycle!.travel!
    const local = localRacesForTurn(3).find((r) => r.countryCode === code)!
    const korea = localRacesForTurn(3).find((r) => r.id === 'DEV_M3_MILE_1600')!
    assert.equal(raceEligibility(career, local, 20_000_000, travel), null)
    assert.match(raceEligibility(career, korea, 20_000_000, travel)!, /대한민국/)
    assert.equal(
      await careerStore.lockRace(
        { raceId: local.id, jockeyId: 'HAN_DOYUN', tactic: '선행' },
        career.horse.id,
        3,
      ),
      true,
    )
    assert.equal(readBrowserSave().career!.raceRun!.raceDefinitionSnapshot.countryCode, code)
  }
})

test('a stale tab refreshes the committed travel after a revision conflict without retrying its command', async () => {
  await setup()
  const saved = readBrowserSave()
  // A distinct tab commits a valid departure while this tab still holds revision zero.
  const travel = saved.lifecycle!.travel!
  writeBrowserSave({
    lifecycle: {
      ...saved.lifecycle,
      travel: {
        ...travel,
        revision: 1,
        locationCountry: 'JPN',
        activeExpedition: {
          id: crypto.randomUUID(),
          careerId: saved.localCareerId!,
          targetCountry: 'JPN',
          targetRaceDefinitionId: null,
          status: 'active',
          startedRevision: 1,
          startedTurn: 3,
          endedTurn: null,
          endReason: null,
          createdAt: new Date().toISOString(),
          endedAt: null,
        },
      },
    },
  })
  const durable = readBrowserSave()
  assert.equal(await careerStore.startExpedition('USA', 0), false)
  assert.deepEqual(readBrowserSave(), durable)
  assert.deepEqual(careerStore.getSnapshot().lifecycle!.travel, durable.lifecycle!.travel)
  assert.match(careerStore.getSnapshot().error!, /변경/)
})

test('retirement abroad preserves the actual stable jockey contracts for the next horse', async () => {
  await setup()
  const saved = readBrowserSave()
  writeBrowserSave({ career: { ...saved.career!, contractedJockeyIds: ['HAN_DOYUN'] } })
  await careerStore.refresh()
  assert.equal(await careerStore.startExpedition('JPN', 0), true)
  assert.ok(await careerStore.release())
  assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, ['HAN_DOYUN'])
  assert.equal(await careerStore.select('DEV_HORSE_SERENE_STEP'), true)
  assert.deepEqual(readBrowserSave().career!.contractedJockeyIds, ['HAN_DOYUN'])
  assert.equal(readBrowserSave().lifecycle!.travel!.activeExpedition, null)
})
