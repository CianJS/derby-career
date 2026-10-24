import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StarterJockeySelection } from '../components/career/starter-jockey-selection'
import {
  jockeyAbilities,
  starterCombination,
  starterComparison,
  tacticDescriptions,
} from '../components/career/starter-jockey-guidance'
import { horses } from '../lib/career/model'
import assert from 'node:assert/strict'
import { startCareer } from '../lib/career/model'
import {
  initialJockeyContracts,
  jockeyCatalog,
  starterJockeyOptions,
} from '../lib/career/jockey-catalog'
import { contractedRoster, lockRaceEntry, tactics } from '../lib/career/race-entry'
import { browserStorage } from './helpers/browser-storage'
import { careerStore } from '../lib/career/store'
import { readBrowserSave, writeBrowserSave } from '../lib/career/browser-save'

test('new career definitions never grant an implicit roster; explicit starters keep abilities and all tactics', () => {
  assert.deepEqual(startCareer('DEV_HORSE_RED_COMET').contractedJockeyIds, [])
  assert.equal(jockeyCatalog.length, 6)
  assert.deepEqual(
    starterJockeyOptions.map((x) => x.specialty),
    [...tactics],
  )
  for (const { jockeyId } of starterJockeyOptions) {
    const career = {
      ...startCareer('DEV_HORSE_RED_COMET', { starterJockeyId: jockeyId }),
      month: 3,
      careerTurnIndex: 3,
    }
    assert.deepEqual(career.contractedJockeyIds, [jockeyId])
    assert.equal(contractedRoster(career)[0].chemistry, 0)
    for (const tactic of tactics) {
      assert.equal(
        lockRaceEntry(career, { raceId: 'DEV_M3_MILE_1600', jockeyId, tactic }).raceRun!.player
          .jockeySnapshot.id,
        jockeyId,
      )
    }
    assert.throws(
      () =>
        lockRaceEntry(career, { raceId: 'DEV_M3_MILE_1600', jockeyId: 'SEO_JIAN', tactic: '선입' }),
      /계약하지 않은/,
    )
  }
  assert.throws(() => initialJockeyContracts({ starterJockeyId: 'SEO_JIAN' }), /초기 후보/)
  assert.deepEqual(initialJockeyContracts({ contractedJockeyIds: [] }), [])
  const old = ['YOON_TAESUNG', 'SEO_JIAN', 'HAN_DOYUN']
  assert.deepEqual(initialJockeyContracts({ contractedJockeyIds: old }), old)
  assert.throws(
    () => initialJockeyContracts({ starterJockeyId: 'PARK_SEOYUN', contractedJockeyIds: old }),
    /기존 마방/,
  )
})

test('local starter and first career commit together, survive retirement and next horse, and quota failure grants nothing', async () => {
  const storage = browserStorage()
  let queue = Promise.resolve<unknown>(undefined)
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name: string, work: () => unknown) => {
          const result = queue.then(work)
          queue = result.catch(() => {})
          return result
        },
      },
    },
  })
  writeBrowserSave({ career: null, lifecycle: { stableName: '새 마방', archive: [] } })
  careerStore.configure('local')
  await careerStore.refresh()
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET'), false)
  const before = readBrowserSave()
  storage.rejectWrites(true)
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET', undefined, 'KANG_HAJUN'), false)
  assert.deepEqual(readBrowserSave(), before)
  storage.rejectWrites(false)
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET', undefined, 'KANG_HAJUN'), true)
  const saved = readBrowserSave()
  assert.deepEqual(saved.career!.contractedJockeyIds, ['KANG_HAJUN'])
  assert.deepEqual(saved.lifecycle!.contractedJockeyIds, ['KANG_HAJUN'])
  const retired = await careerStore.release()
  assert.ok(retired)
  assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, ['KANG_HAJUN'])
  assert.equal(await careerStore.select('DEV_HORSE_SERENE_STEP', undefined, 'PARK_SEOYUN'), false)
  assert.equal(await careerStore.select('DEV_HORSE_SERENE_STEP'), true)
  assert.deepEqual(readBrowserSave().career!.contractedJockeyIds, ['KANG_HAJUN'])
  assert.equal(contractedRoster(readBrowserSave().career!)[0].chemistry, 0)
})

test('Local confirmed starter draft survives stale projections and cannot be silently replaced by another tab', async () => {
  browserStorage()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: async (_name: string, work: () => unknown) => work() } },
  })
  writeBrowserSave({ career: null, lifecycle: { stableName: '선택 저장 마방', archive: [] } })
  careerStore.configure('local')
  await careerStore.refresh()
  const before = readBrowserSave().lifecycle!
  await careerStore.saveLifecycle({ ...before, starterJockeyId: 'PARK_SEOYUN' })
  await assert.rejects(
    careerStore.saveLifecycle({ ...before, starterJockeyId: 'KANG_HAJUN' }),
    /다른 탭/,
  )
  assert.equal(readBrowserSave().lifecycle!.starterJockeyId, 'PARK_SEOYUN')
  assert.equal(readBrowserSave().lifecycle!.contractedJockeyIds, undefined)
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET', undefined, 'KANG_HAJUN'), false)
  assert.equal(readBrowserSave().career, null)
  assert.equal(await careerStore.select('DEV_HORSE_RED_COMET', undefined, 'PARK_SEOYUN'), true)
  const saved = readBrowserSave()
  assert.deepEqual(saved.career!.contractedJockeyIds, ['PARK_SEOYUN'])
  await assert.rejects(
    careerStore.saveLifecycle({ ...saved.lifecycle, starterJockeyId: 'SEO_JIAN' }),
    /유효하지/,
  )
  assert.deepEqual(readBrowserSave(), saved)
})

test('starter explanations and candidate combinations use catalog abilities and actual tactic aptitude only', () => {
  const before = JSON.stringify({ jockeyCatalog, starterJockeyOptions, horses })
  const markup = renderToStaticMarkup(
    createElement(StarterJockeySelection, { busy: false, onConfirm: async () => {} }),
  )
  assert.match(markup, /아직 육성마를 선택하지 않았습니다/)
  assert.match(markup, /초안 저장/)
  assert.match(markup, /모든 기수는 네 전술을 모두/)
  for (const { jockeyId, specialty } of starterJockeyOptions) {
    const jockey = jockeyCatalog.find((j) => j.id === jockeyId)!
    assert.ok(markup.includes(tacticDescriptions[specialty]))
    assert.ok(markup.includes(starterComparison(jockeyId)!))
    for (const ability of jockeyAbilities) {
      assert.ok(markup.includes(ability.label))
      assert.ok(markup.includes(ability.description))
      assert.ok(markup.includes(`>${jockey[ability.key]}</dd>`))
    }
    for (const horse of horses) {
      const combination = starterCombination(jockeyId, horse.aptitude)!
      assert.equal(combination.grade, horse.aptitude.find(([tactic]) => tactic === specialty)![1])
      assert.equal(combination.specialty, specialty)
      assert.equal(combination.jockey, jockey)
    }
    for (const [grade, phrase] of [
      ['A', '높아'],
      ['B', '양호'],
      ['C', '낮으므로'],
      ['D', '낮으므로'],
    ] as const) {
      assert.ok(starterCombination(jockeyId, [[specialty, grade]])!.guidance.includes(phrase))
    }
    assert.equal(starterCombination(jockeyId, undefined)!.grade, null)
    assert.match(starterCombination(jockeyId, [])!.guidance, /적성 확인 불가/)
  }
  assert.equal(JSON.stringify({ jockeyCatalog, starterJockeyOptions, horses }), before)
})

test('Local draft changes compare the previous draft atomically and never replace existing contracts', async () => {
  const storage = browserStorage()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: async (_name: string, work: () => unknown) => work() } },
  })
  writeBrowserSave({ career: null, lifecycle: { stableName: '변경 초안 마방', archive: [] } })
  careerStore.configure('local')
  await careerStore.refresh()
  await careerStore.saveLifecycle(
    { ...readBrowserSave().lifecycle, starterJockeyId: 'HAN_DOYUN' },
    { expectedStarterJockeyId: undefined },
  )
  const before = readBrowserSave()
  storage.rejectWrites(true)
  await assert.rejects(
    careerStore.saveLifecycle(
      { ...before.lifecycle, starterJockeyId: 'PARK_SEOYUN' },
      { expectedStarterJockeyId: 'HAN_DOYUN' },
    ),
    /저장 공간/,
  )
  assert.deepEqual(readBrowserSave(), before)
  storage.rejectWrites(false)
  await careerStore.saveLifecycle(
    { ...before.lifecycle, starterJockeyId: 'PARK_SEOYUN' },
    { expectedStarterJockeyId: 'HAN_DOYUN' },
  )
  const changed = readBrowserSave()
  await assert.rejects(
    careerStore.saveLifecycle(
      { ...before.lifecycle, starterJockeyId: 'KANG_HAJUN' },
      { expectedStarterJockeyId: 'HAN_DOYUN' },
    ),
    /다른 탭/,
  )
  assert.deepEqual(readBrowserSave(), changed)
  assert.equal(await careerStore.select(horses[0].id, undefined, 'HAN_DOYUN'), false)
  assert.equal(await careerStore.select(horses[0].id, undefined, 'PARK_SEOYUN'), true)
  const contracted = readBrowserSave()
  await assert.rejects(
    careerStore.saveLifecycle(
      { ...contracted.lifecycle, starterJockeyId: 'KANG_HAJUN' },
      { expectedStarterJockeyId: 'PARK_SEOYUN' },
    ),
    /기존 마방/,
  )
  assert.deepEqual(readBrowserSave(), contracted)
  // Explicitly empty legacy contracts also prevent starter replacement.
  writeBrowserSave({
    career: null,
    lifecycle: { ...contracted.lifecycle, contractedJockeyIds: [] },
  })
  await assert.rejects(
    careerStore.saveLifecycle(
      { ...readBrowserSave().lifecycle, starterJockeyId: 'KANG_HAJUN' },
      { expectedStarterJockeyId: 'PARK_SEOYUN' },
    ),
    /기존 마방/,
  )
  assert.deepEqual(readBrowserSave().lifecycle!.contractedJockeyIds, [])
})
