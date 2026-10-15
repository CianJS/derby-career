import type { Career } from './model'
import { resolveAction } from './model'
import { withMonthEvent } from './events/director'
import { readCareer, writeCareer } from './repository'
import { readRaceLog, writeRaceLog } from './race-log-repository'
import { simulateRace, summarizeRaceLog, validateRaceLog, raceLogDigest } from './race-simulation'

// Saves written before the simulation engine, or a cleared browser log store, are repaired here so the
// playback screen only ever reads a persisted log. Re-simulation is deterministic and checked by digest.
function ensureRaceLog(career: Career): Career {
  const run = career.raceRun
  if (!run) {
    return career
  }
  if (!run.simulation) {
    const log = simulateRace(run)
    writeRaceLog(log)
    const next = { ...career, raceRun: { ...run, simulation: summarizeRaceLog(log) } }
    writeCareer(next)
    return next
  }
  let valid = false
  try {
    const cached = readRaceLog(run.raceRunId)
    validateRaceLog(cached, run)
    valid = true
  } catch {
    /* The derived cache can be repaired from the locked seed and digest. */
  }
  if (!valid) {
    const log = simulateRace(run, run.simulation.engineVersion)
    if (raceLogDigest(log) !== run.simulation.digest) {
      throw new Error('저장된 경주 기록을 복원하지 못했습니다.')
    }
    writeRaceLog(log)
  }
  return career
}

export function restoreLocalCareer(): Career | null {
  const saved = readCareer()
  if (!saved) {
    return null
  }
  const resolved = withMonthEvent(resolveAction(saved))
  if (resolved !== saved) {
    writeCareer(resolved)
  }
  return ensureRaceLog(resolved)
}
