import type { RaceRunInput } from './race-entry'
import type { RaceSimulationLog } from './race-simulation'
import { RACE_BALANCE_V3, type RaceBalanceConfig } from './race-balance'
import { simulateRaceCore } from './race-sim-core'

export type { RunnerStateV3 } from './race-sim-core'

/** Frozen v3 rules: the shared core receives no trust bonus. */
export function simulateRaceV3(run: RaceRunInput, cfg: RaceBalanceConfig = RACE_BALANCE_V3): RaceSimulationLog {
  return simulateRaceCore(run, cfg)
}
