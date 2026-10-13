import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { horses } from '../lib/career/model'
import { tactics } from '../lib/career/race-entry'
import { simulateRace, raceLogDigest } from '../lib/career/race-simulation'
import { AUDIT_RACES, AUDIT_SEEDS, makeAuditRun } from '../scripts/race-audit'

test('frozen v1 engine matches every stored golden digest across horses, distances, tactics and seeds', async () => {
  const expected: Record<string, string> = JSON.parse(
    await readFile(new URL('./fixtures/race-sim-v1.digests.json', import.meta.url), 'utf8'),
  )
  const seen = new Set<string>()
  for (let horse = 0; horse < horses.length; horse++) {
    for (let race = 0; race < AUDIT_RACES.length; race++) {
      for (const tactic of tactics) {
        for (let seed = 0; seed < AUDIT_SEEDS; seed++) {
          const { key, run } = makeAuditRun(horse, race, tactic, seed, 'v1')
          assert.equal(raceLogDigest(simulateRace(run, 'race-sim-v1')), expected[key], key)
          seen.add(key)
        }
      }
    }
  }
  assert.equal(seen.size, 432)
  assert.equal(seen.size, Object.keys(expected).length)
})
