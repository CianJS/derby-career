import type { RaceRunInput } from './race-entry'
import { RACE_BALANCE_V3 } from './race-balance'
import { simulateRaceCore } from './race-sim-core'
import { assertTrust } from './jockey-trust'

export const RACE_SIM_V4_VERSION = 'race-sim-v4'
export function trustExecutionBonus(trust: number): number {
  assertTrust(trust)
  return 0.08 * (trust / 100)
}
/** All v3 physics and random streams are preserved; only bounded execution receives trust. */
export function simulateRaceV4(run: RaceRunInput) {
  return simulateRaceCore(run, { ...RACE_BALANCE_V3, version: RACE_SIM_V4_VERSION }, (runner) =>
    trustExecutionBonus(runner.jockeySnapshot.chemistry),
  )
}
