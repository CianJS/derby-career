import test from 'node:test'
import assert from 'node:assert/strict'
import { horses, startCareer } from '../lib/career/model'
import { contractedJockeys, createRaceRun, raceDefinitions, buildOpponents, tactics } from '../lib/career/race-entry'
import { ENGINE_PROFILES, SIMULATION_ENGINE_VERSION, raceLogDigest, simulateRace } from '../lib/career/race-simulation'
import { legacyFieldV1 } from '../scripts/legacy-field'
import { spreadMarkers } from '../lib/career/race-spectate'

const base = { ...startCareer(horses[1].id), month: 3, careerTurnIndex: 3 }
const make = (seed: string, tactic: typeof tactics[number] = '선입') => {
  let n = 0
  return createRaceRun(base, raceDefinitions[1], contractedJockeys[1], tactic, () => (n++ === 0 ? `run-${seed}` : `seed-${seed}`))
}

test('new races use race-sim-v3 while v1 and v2 stay replayable and deterministic', () => {
  assert.equal(SIMULATION_ENGINE_VERSION, 'race-sim-v3')
  const run = make('v')
  assert.equal(simulateRace(run).engineVersion, 'race-sim-v3')
  assert.equal(simulateRace(run, 'race-sim-v2').engineVersion, 'race-sim-v2')
  assert.equal(raceLogDigest(simulateRace(run, 'race-sim-v2')), raceLogDigest(simulateRace(run, 'race-sim-v2')))
  const old = { ...run, runners: [run.runners[0], ...legacyFieldV1(run.raceDefinitionSnapshot)] }
  const first = simulateRace(old, 'race-sim-v1')
  assert.equal(first.engineVersion, 'race-sim-v1')
  assert.equal(raceLogDigest(first), raceLogDigest(simulateRace(old, 'race-sim-v1')))
  assert.notEqual(raceLogDigest(first), raceLogDigest(simulateRace(old)))
})

test('v2 tactic bonuses average to zero across phases so no tactic gets free speed', () => {
  const p = ENGINE_PROFILES['race-sim-v2']
  for (const t of tactics) assert.ok(Math.abs(p.earlyBonus[t] * 0.35 + p.midBonus[t] * 0.35 + p.lateBonus[t] * 0.3) < 0.05, t)
})

test('opponent field is deterministic, unique and mixes speed-leaning and stamina-leaning runners', () => {
  const race = raceDefinitions[1]
  const a = buildOpponents(race)
  assert.deepEqual(a, buildOpponents(race))
  assert.equal(new Set(a.map(r => r.horseSnapshot.id)).size, race.runners - 1)
  const speed = a.map(r => r.horseSnapshot.values.speed)
  assert.ok(Math.max(...speed) - Math.min(...speed) >= 80)
  assert.ok(a.some(r => r.horseSnapshot.values.speed > r.horseSnapshot.values.stamina + 20))
  assert.ok(a.some(r => r.horseSnapshot.values.stamina > r.horseSnapshot.values.speed + 20))
})

test('marker spreading separates a dense cluster without moving x and stays inside the strip', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, x: 0.5 + i * 0.001, y: 0.45 + (i % 3) * 0.01 }))
  const ys = spreadMarkers(items, 0.014, 0.06)
  const sorted = [...ys.values()].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 0.06 - 1e-9)
  assert.ok(sorted[0] >= 0.08 - 1e-9 && sorted[sorted.length - 1] <= 0.92 + 1e-9)
})
