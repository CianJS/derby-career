import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { browserStorage } from './helpers/browser-storage'
import { BROWSER_SAVE_KEY } from '../lib/career/browser-save'
import { readCareer, writeCareer } from '../lib/career/repository'
import { commitAction, resolveAction } from '../lib/career/model'
import { withMonthEvent } from '../lib/career/events/director'
import { buildFixture } from '../lib/career/fixtures'
import { readRaceLog, writeRaceLog } from '../lib/career/race-log-repository'
import { raceLogDigest, simulateRace, summarizeRaceLog } from '../lib/career/race-simulation'
import { restoreLocalCareer } from '../lib/career/local-recovery'

function raceCareer() {
  const career = buildFixture('playback-12').career
  assert.ok(career?.raceRun)
  return withMonthEvent(career)
}

test('local recovery leaves an empty save empty and persists a locked action exactly once', () => {
  const storage = browserStorage()
  assert.equal(restoreLocalCareer(), null)
  assert.equal(storage.data.size, 0)
  const committed = commitAction(startCareer('DEV_HORSE_SERENE_STEP'), 'speed')
  writeCareer(committed)
  const expected = withMonthEvent(resolveAction(committed))
  assert.deepEqual(restoreLocalCareer(), expected)
  assert.deepEqual(readCareer(), expected)
  const persisted = storage.data.get(BROWSER_SAVE_KEY)
  assert.deepEqual(restoreLocalCareer(), expected)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), persisted)
})

for (const engine of ['race-sim-v1', 'race-sim-v2', 'race-sim-v3', 'race-sim-v4']) {
  test(`local recovery restores a missing ${engine} cache from its locked Seed and digest`, () => {
    const storage = browserStorage()
    const career = raceCareer()
    assert.ok(career.raceRun)
    const log = simulateRace(career.raceRun, engine)
    career.raceRun.simulation = summarizeRaceLog(log)
    writeCareer(career)
    const persisted = storage.data.get(BROWSER_SAVE_KEY)
    const first = restoreLocalCareer()
    assert.deepEqual(first, career)
    assert.equal(JSON.stringify(readRaceLog(log.raceRunId)), JSON.stringify(log))
    assert.equal(storage.data.get(BROWSER_SAVE_KEY), persisted)
    storage.rejectWrites(true)
    assert.deepEqual(restoreLocalCareer(), career, 'valid cached logs require no writes')
  })
}

test('pre-engine saved entries gain one persisted summary without changing their locked inputs', () => {
  browserStorage()
  const career = raceCareer()
  assert.ok(career.raceRun)
  delete career.raceRun.simulation
  const lockedRun = structuredClone(career.raceRun)
  writeCareer(career)
  const restored = restoreLocalCareer()
  assert.ok(restored?.raceRun?.simulation)
  assert.deepEqual(
    { ...restored.raceRun, simulation: undefined },
    { ...lockedRun, simulation: undefined },
  )
  const log = readRaceLog(lockedRun.raceRunId)
  assert.ok(log)
  assert.equal(restored.raceRun.simulation.digest, raceLogDigest(log))
  assert.deepEqual(readCareer(), restored)
})

test('mismatched authoritative digest fails without replacing saved state or derived cache', () => {
  const storage = browserStorage()
  const career = raceCareer()
  assert.ok(career.raceRun?.simulation)
  career.raceRun.simulation.digest = 'mismatched-digest'
  writeCareer(career)
  const persisted = storage.data.get(BROWSER_SAVE_KEY)
  assert.throws(() => restoreLocalCareer(), /경주 기록을 복원하지 못했습니다/)
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), persisted)
  assert.equal(readRaceLog(career.raceRun.raceRunId), null)
})

test('a malformed derived cache is repaired; storage failures preserve the authoritative save', () => {
  const storage = browserStorage()
  const career = raceCareer()
  assert.ok(career.raceRun)
  const log = simulateRace(career.raceRun)
  writeCareer(career)
  writeRaceLog(log)
  const key = [...storage.data.keys()].find((key) => key !== BROWSER_SAVE_KEY)
  assert.ok(key)
  storage.data.set(key, 'invalid JSON')
  const persisted = storage.data.get(BROWSER_SAVE_KEY)
  storage.rejectWrites(true)
  assert.throws(() => restoreLocalCareer())
  assert.equal(storage.data.get(BROWSER_SAVE_KEY), persisted)
  assert.equal(storage.data.get(key), 'invalid JSON')
  storage.rejectWrites(false)
  assert.deepEqual(restoreLocalCareer(), career)
  assert.equal(JSON.stringify(readRaceLog(log.raceRunId)), JSON.stringify(log))
})
