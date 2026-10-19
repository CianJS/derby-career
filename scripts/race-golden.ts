/**
 * Prints the stored-log digest of every audit run for one engine version. Used to pin a frozen engine:
 *   pnpm dlx tsx scripts/race-golden.ts race-sim-v1 > tests/fixtures/race-sim-v1.digests.json
 */
import { horses } from '../lib/career/model'
import { tactics } from '../lib/career/race-entry'
import { raceLogDigest, simulateRace } from '../lib/career/race-simulation'
import { AUDIT_RACES, AUDIT_SEEDS, makeAuditRun } from './race-audit'

const version = process.argv[2]
const digests: Record<string, string> = {}
for (let h = 0; h < horses.length; h += 1) for (let r = 0; r < AUDIT_RACES.length; r += 1) for (const tactic of tactics) for (let seed = 0; seed < AUDIT_SEEDS; seed += 1) {
  const { key, run } = makeAuditRun(h, r, tactic, seed, 'v1')
  digests[key] = raceLogDigest(simulateRace(run, version))
}
console.log(JSON.stringify(digests, null, 1))
