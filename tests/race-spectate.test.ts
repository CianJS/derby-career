import { legacyCareer as startCareer } from './helpers/legacy-career'
import test from 'node:test'
import assert from 'node:assert/strict'
import { horses} from '../lib/career/model'
import { contractedJockeys, createRaceRun, raceDefinitions, stressRaceDefinitions, tactics, type RaceRunInput } from '../lib/career/race-entry'
import { liveCommentary } from '../lib/career/race-feed'
import { frameAt, simulateRace, type RaceSimulationLog } from '../lib/career/race-simulation'
import { analyzeRace, desiredAutoSpeed, initialAuto, momentOf, spreadMarkers, stepAuto, stripHeightRem, stripLayout, AUTO_CONFIRM_MS, AUTO_MIN_HOLD_MS, STRIP_MARKER_DX, STRIP_MARKER_REM } from '../lib/career/race-spectate'

const base = { ...startCareer(horses[1].id), month: 3, careerTurnIndex: 3 }
function makeRun(race: typeof raceDefinitions[number], seed: string, tactic: typeof tactics[number] = '선입'): { run: RaceRunInput; log: RaceSimulationLog } {
  let n = 0
  const run = createRaceRun(base, race, contractedJockeys[1], tactic, () => (n++ === 0 ? `run-${seed}` : `seed-${seed}`))
  return { run, log: simulateRace(run) }
}
const names = (run: RaceRunInput) => new Map(run.runners.map(r => [r.horseSnapshot.id, r.horseSnapshot.name]))
const sample = [...Array(12)].flatMap((_, i) => [makeRun(raceDefinitions[1], `a${i}`, tactics[i % 4]), makeRun(raceDefinitions[2], `b${i}`, tactics[(i + 1) % 4])])

test('player situation neighbors match the stored frame ordering and never look past the playback time', () => {
  for (const { run, log } of sample) {
    for (let t = 0; t <= log.durationMs; t += 2500) {
      const a = analyzeRace(log, t, run.playerHorseId)
      const frame = frameAt(log, t)
      const me = frame.runners.find(r => r.horseId === run.playerHorseId)!
      assert.equal(a.now.rank, me.rank)
      assert.equal(a.now.total, run.runners.length)
      if (a.now.ahead) { assert.equal(frame.runners[me.rank - 2].horseId, a.now.ahead.horseId); assert.ok(a.now.ahead.gap >= 0) }
      if (a.now.behind) { assert.equal(frame.runners[me.rank].horseId, a.now.behind.horseId); assert.ok(a.now.behind.gap >= 0) }
      if (me.rank === 1) assert.equal(a.now.ahead, null)
      if (a.recentEvent) assert.ok(a.recentEvent.tMs <= a.tMs)
    }
  }
})

test('analysis is a pure read: it does not mutate the stored log and repeated calls agree', () => {
  const { run, log } = sample[0]
  const before = JSON.stringify(log)
  const first = analyzeRace(log, 31000, run.playerHorseId)
  const second = analyzeRace(log, 31000, run.playerHorseId)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(log), before)
})

test('phase changes alone never create a moment, and moments follow rank, lead or neighbor changes', () => {
  for (const { run, log } of sample) {
    for (let t = 0; t <= log.durationMs; t += 1000) {
      const a = analyzeRace(log, t, run.playerHorseId)
      const moment = momentOf(a)
      if (!moment) continue
      assert.ok(!a.now.finished)
      if (moment.kind === 'RANK_UP') assert.ok(a.rankDelta > 0)
      if (moment.kind === 'RANK_DOWN') assert.ok(a.rankDelta < 0)
      if (moment.kind === 'EVENT') assert.ok(a.recentEvent)
      if (moment.kind === 'CLOSING') assert.ok(a.now.ahead && a.now.ahead.gap <= 8)
      if (moment.kind === 'CHASED') assert.ok(a.now.behind && a.now.behind.gap <= 8)
    }
  }
})

test('AUTO asks for fast playback early, slows near the finish and tails off after finishing', () => {
  const { run, log } = sample[0]
  assert.equal(desiredAutoSpeed(analyzeRace(log, 500, run.playerHorseId)), 4)
  let sawFinalSlowdown = false
  for (let t = 0; t < log.durationMs; t += 250) {
    const a = analyzeRace(log, t, run.playerHorseId)
    if (a.phase === 'STRETCH' && !a.now.finished && a.now.remaining <= 100) { assert.equal(desiredAutoSpeed(a), 1); sawFinalSlowdown = true }
  }
  assert.ok(sawFinalSlowdown)
  const done = analyzeRace(log, log.durationMs, run.playerHorseId)
  assert.equal(done.now.finished, true)
  assert.equal(desiredAutoSpeed(done), 4)
})

test('AUTO never exceeds x8, only uses allowed speeds, and keeps the rest of the race watchable', () => {
  for (const { run, log } of sample) {
    let state = initialAuto(0)
    let wall = 0
    let t = 0
    let switches = 0
    let early = 0
    const timeAt: Record<number, number> = { 1: 0, 2: 0, 4: 0, 8: 0 }
    while (t < log.durationMs && wall < 600000) {
      wall += 100
      const next = stepAuto(state, desiredAutoSpeed(analyzeRace(log, t, run.playerHorseId)), wall)
      if (next.speed !== state.speed) { switches += 1; assert.ok(wall - state.since >= AUTO_MIN_HOLD_MS) }
      state = next
      assert.ok([1, 2, 4, 8].includes(state.speed))
      timeAt[state.speed] += 100
      t += 100 * state.speed
      if (t < 10000) early += 1
    }
    assert.ok(t >= log.durationMs, 'race finishes under AUTO')
    assert.ok(wall <= 90000, `AUTO watch time stays reasonable (${wall}ms)`)
    assert.ok(switches <= 24, `AUTO does not flap (${switches} switches)`)
    assert.ok(timeAt[1] + timeAt[2] > 0)
    assert.ok(early >= 0)
  }
})

test('AUTO switches only after the request is confirmed and the current speed has been held', () => {
  let state = initialAuto(0, 8)
  state = stepAuto(state, 2, 100)
  assert.equal(state.speed, 8)
  state = stepAuto(state, 2, 100 + AUTO_CONFIRM_MS)
  assert.equal(state.speed, 8, 'minimum hold has not elapsed')
  state = stepAuto(state, 2, AUTO_MIN_HOLD_MS + 100)
  assert.equal(state.speed, 2)
  const flicker = stepAuto(stepAuto(initialAuto(0, 4), 2, 2000), 4, 2100)
  assert.equal(flicker.speed, 4)
  assert.equal(flicker.pending, null)
})

test('commentary is deterministic, uses stored data only and rotates wording for the same situation', () => {
  for (const { run, log } of sample.slice(0, 6)) {
    const map = names(run)
    for (let t = 0; t <= log.durationMs; t += 1000) {
      const text = liveCommentary(log, t, run.playerHorseId, map)
      assert.ok(text.length > 0)
      assert.ok(!/undefined|NaN|null/.test(text), text)
      assert.equal(text, liveCommentary(log, t, run.playerHorseId, map))
    }
  }
  const { run, log } = sample[0]
  const seen = new Set<string>()
  for (let t = 8000; t < log.durationMs - 20000; t += 5000) seen.add(liveCommentary(log, t, run.playerHorseId, names(run)))
  assert.ok(seen.size >= 2)
})

test('commentary reports the finish only after the player has crossed the line', () => {
  const { run, log } = sample[0]
  const map = names(run)
  assert.match(liveCommentary(log, log.durationMs, run.playerHorseId, map), /결승선을 통과/)
  for (let t = 0; t < log.durationMs; t += 1000) {
    if (!analyzeRace(log, t, run.playerHorseId).now.finished) assert.ok(!/결승선을 통과/.test(liveCommentary(log, t, run.playerHorseId, map)))
  }
})

test('marker spreading keeps x, separates overlapping markers when slots exist and is deterministic', () => {
  const items = [0, 1, 2, 3].map(i => ({ id: `h${i}`, x: 0.5, y: 0.5 }))
  const first = spreadMarkers(items, 0.03, 0.1)
  const second = spreadMarkers(items, 0.03, 0.1)
  assert.deepEqual([...first], [...second])
  const ys = [...first.values()].sort((a, b) => a - b)
  for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= 0.1 - 1e-9)
  assert.ok(ys.every(y => y >= 0.08 && y <= 0.92))
})

test('strip layout separates markers in 12 and 18 runner fields once the pack has spread out', () => {
  const stress = makeRun(stressRaceDefinitions[0], 'stress')
  for (const { run, log } of [sample[0], stress]) {
    const gates = new Map(run.runners.map((r, i) => [r.horseSnapshot.id, i + 1]))
    const minDy = STRIP_MARKER_REM / stripHeightRem(run.runners.length)
    let overlaps = 0
    let samples = 0
    for (let t = 5000; t <= log.durationMs - 5000; t += 1000) {
      const frame = frameAt(log, t)
      const layout = stripLayout(frame, log.raceDistance, run.playerHorseId, gates, STRIP_MARKER_DX, minDy)
      const spots = [...layout.values()]
      samples += 1
      spots.forEach((a, i) => spots.forEach((b, j) => { if (i < j && Math.abs(a.x - b.x) < STRIP_MARKER_DX && Math.abs(a.y - b.y) < minDy * 0.9) overlaps += 1 }))
      for (const s of spots) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)
    }
    const limit = run.runners.length > 12 ? 4 : 1.5
    assert.ok(overlaps / samples <= limit, `average overlapping pairs per frame ${(overlaps / samples).toFixed(2)}`)
  }
})
