/** Transport envelope checks only. The Adapter checks the locked run and log digest against
 * the validated workspace before any playback. Replace with generated race validators when supplied. */
export function validateRaceReadResponse(value: unknown, log: boolean): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  if (log) {
    if (!('log' in value) || !value.log || typeof value.log !== 'object') {
      return false
    }
    const saved = value.log
    return (
      'raceRunId' in saved &&
      typeof saved.raceRunId === 'string' &&
      'engineVersion' in saved &&
      ['race-sim-v1', 'race-sim-v2'].includes(String(saved.engineVersion)) &&
      'samples' in saved &&
      Array.isArray(saved.samples) &&
      'finishOrder' in saved &&
      Array.isArray(saved.finishOrder) &&
      'events' in saved &&
      Array.isArray(saved.events) &&
      'highlights' in saved &&
      Array.isArray(saved.highlights) &&
      'phaseMarkers' in saved &&
      Array.isArray(saved.phaseMarkers) &&
      'durationMs' in saved &&
      typeof saved.durationMs === 'number' &&
      Number.isFinite(saved.durationMs) &&
      saved.durationMs > 0
    )
  }
  if (
    !('raceRun' in value) ||
    !value.raceRun ||
    typeof value.raceRun !== 'object' ||
    !('metadata' in value) ||
    !value.metadata ||
    typeof value.metadata !== 'object'
  ) {
    return false
  }
  const metadata = value.metadata
  return (
    'digest' in metadata &&
    typeof metadata.digest === 'string' &&
    'engineVersion' in metadata &&
    ['race-sim-v1', 'race-sim-v2'].includes(String(metadata.engineVersion)) &&
    'healthAtEntry' in value &&
    typeof value.healthAtEntry === 'string'
  )
}
