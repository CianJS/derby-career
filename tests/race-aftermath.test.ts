import { legacyCareer as startCareer } from './helpers/legacy-career'
import { browserStorage } from './helpers/browser-storage'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceMonth,
  applyRaceResult,
  completeRace,
  horses,
  type Career,
} from '../lib/career/model'
import {
  contractedJockeys,
  lockRaceEntry,
  raceDefinitions,
  type RaceEntryDraft,
} from '../lib/career/race-entry'
import { postRaceChanges, raceAftermath } from '../lib/career/post-race'
import { readCareer, writeCareer } from '../lib/career/repository'
import { applyCareer } from '../lib/career/lifecycle'

const mile: RaceEntryDraft = {
  raceId: raceDefinitions[1].id,
  jockeyId: contractedJockeys[2].id,
  tactic: '선입',
}
const prepared = (): Career => {
  const career = startCareer(horses[1].id)
  return {
    ...career,
    month: 3,
    careerTurnIndex: 3,
    condition: '보통',
    values: { ...career.values, fatigue: 31, bodyLoad: 31 },
  }
}
const locked = () => lockRaceEntry(prepared(), mile)
const finish = (career: Career) => {
  const run = career.raceRun!
  const { placing, prizeMoney } = run.simulation!.result
  return {
    run,
    finished: completeRace(career, run.raceRunId, placing, prizeMoney),
    placing,
    prizeMoney,
  }
}

test('race result display matches the 31/31 example and the stored next-month state', () => {
  const career = locked()
  const changes = postRaceChanges(career, career.raceRun!)
  assert.deepEqual(
    changes.map((c) => [c.label, c.before, c.after]),
    [
      ['피로', '31', '56'],
      ['신체 부하', '31', '49'],
      ['컨디션', '보통', '나쁨'],
    ],
  )
  assert.ok(
    !changes.some((c) => c.label === '기수 호흡도'),
    'unpersisted jockey chemistry must not be shown as confirmed',
  )
  const { finished } = finish(career)
  assert.equal(finished.values.fatigue, 56)
  assert.equal(finished.values.bodyLoad, 49)
  assert.equal(finished.condition, '나쁨')
  assert.equal(finished.raceRun, undefined)
})

test('result application is idempotent on re-entry and survives reload', () => {
  browserStorage()
  const career = locked()
  const { run, finished, placing, prizeMoney } = finish(career)
  assert.equal(completeRace(finished, run.raceRunId, placing, prizeMoney), finished)
  const applied = applyRaceResult(career, run.raceRunId, placing, prizeMoney)
  assert.equal(applyRaceResult(applied, run.raceRunId, placing, prizeMoney), applied)
  assert.equal(applied.values.fatigue, 56)
  writeCareer(finished)
  const restored = readCareer()!
  assert.equal(completeRace(restored, run.raceRunId, placing, prizeMoney).values.fatigue, 56)
  assert.deepEqual(restored.values, finished.values)
  assert.equal(restored.condition, '나쁨')
})

test('aftermath uses the entry snapshot so display stays stable after the result is applied', () => {
  const career = locked()
  const before = raceAftermath(career, career.raceRun!)
  const applied = applyRaceResult(
    career,
    career.raceRun!.raceRunId,
    career.raceRun!.simulation!.result.placing,
    career.raceRun!.simulation!.result.prizeMoney,
  )
  assert.deepEqual(raceAftermath(applied, applied.raceRun!), before)
})

test('horse detail lifecycle reads the same post-race values as the training cockpit', () => {
  const { finished } = finish(locked())
  const detail = applyCareer<{ activeHorse: null; month: number }>(
    { activeHorse: null, month: 3 },
    finished,
  ) as unknown as { activeHorse: { fatigue: number; bodyLoad: number; condition: string } }
  assert.equal(detail.activeHorse.fatigue, finished.values.fatigue)
  assert.equal(detail.activeHorse.bodyLoad, finished.values.bodyLoad)
  assert.equal(detail.activeHorse.condition, finished.condition)
})

test('a light race on a fresh horse can leave condition unchanged and rest still recovers afterwards', () => {
  const fresh = { ...startCareer(horses[1].id), month: 3, careerTurnIndex: 3 }
  const career = lockRaceEntry(fresh, { ...mile, raceId: raceDefinitions[0].id })
  const { finished } = finish(career)
  assert.equal(finished.values.fatigue, 5 + 22)
  assert.equal(finished.values.bodyLoad, 5 + 16)
  assert.equal(finished.condition, '보통')
  assert.equal(advanceMonth(finished, 'none'), finished)
})
