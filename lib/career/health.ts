import { BALANCE } from './balance'

export type Severity = 0 | 1 | 2 | 3
export const healthLabels: Record<Severity, string> = {
  0: '정상',
  1: '경상',
  2: '중등도 부상',
  3: '중상',
}

const aliases: Record<string, Severity> = {
  정상: 0,
  HEALTHY: 0,
  경상: 1,
  경미: 1,
  MINOR: 1,
  중등도: 2,
  '중등도 부상': 2,
  MODERATE: 2,
  중상: 3,
  중증: 3,
  SEVERE: 3,
}

/** Reads any health value ever saved (legacy or current) as a severity. Unknown values count as 경상 so a horse is never silently healed. */
export function healthSeverity(health: string | undefined | null): Severity {
  if (!health) {
    return 0
  }
  return Object.hasOwn(aliases, health) ? aliases[health] : 1
}
export const canonicalHealth = (health: string | undefined | null): string =>
  healthLabels[healthSeverity(health)]
export const canTrain = (health: string | undefined | null) => healthSeverity(health) === 0
export const canRace = (health: string | undefined | null) => healthSeverity(health) < 3
export const recoveryNeeded = (severity: Severity) =>
  severity === 0 ? 0 : BALANCE.health.recoveryNeeded[severity]

export type HealthState = { health: string; recovery: number }
/** A save without a recovery value gets the full amount for its severity, so old injured horses need real care too. */
export function normalizeHealth(
  health: string | undefined | null,
  recovery: number | undefined,
): HealthState {
  const severity = healthSeverity(health)
  if (severity === 0) {
    return { health: healthLabels[0], recovery: 0 }
  }
  const needed = recoveryNeeded(severity)
  return {
    health: healthLabels[severity],
    recovery:
      Number.isFinite(recovery) && recovery! > 0 ? Math.min(needed, Math.round(recovery!)) : needed,
  }
}
/** The health a career currently has, filling in the recovery amount for saves written before recovery existed. */
export const careerHealth = (career: { health: string; healthRecovery?: number }): HealthState =>
  normalizeHealth(career.health, career.healthRecovery)
export function injure(severity: Severity): HealthState {
  return { health: healthLabels[severity], recovery: recoveryNeeded(severity) }
}
/** Spends recovery points. Reaching zero is the only way back to 정상; the severity label does not step down on the way. */
export function recoverBy(state: HealthState, amount: number): HealthState {
  if (healthSeverity(state.health) === 0) {
    return { health: healthLabels[0], recovery: 0 }
  }
  const recovery = Math.max(0, state.recovery - amount)
  return recovery === 0
    ? { health: healthLabels[0], recovery: 0 }
    : { health: canonicalHealth(state.health), recovery }
}
export function turnsToRecover(state: HealthState, amountPerTurn: number): number {
  return healthSeverity(state.health) === 0 ? 0 : Math.ceil(state.recovery / amountPerTurn)
}

function seedPercent(seedText: string): number {
  let value = 2166136261
  for (const char of seedText) {
    value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  }
  return (value >>> 0) % 100
}
export function worsenChancePercent(severity: Severity, fatigue: number): number {
  if (severity === 0 || severity === 3) {
    return 0
  }
  const { minFatigue, percent } = BALANCE.health.worsenFatiguePercent
  return BALANCE.health.worsenPercent[severity] + (fatigue >= minFatigue ? percent : 0)
}
/** Outcome of racing hurt. Depends only on the stored race seed and the entry snapshot, so reloading cannot reroll it. */
export function healthAfterRace(
  snapshot: HealthState,
  fatigue: number,
  raceSeed: string,
): HealthState {
  const severity = healthSeverity(snapshot.health)
  const chance = worsenChancePercent(severity, fatigue)
  if (chance === 0 || seedPercent(`${raceSeed}:injury-aftermath:v1`) >= chance) {
    return snapshot
  }
  return injure((severity + 1) as Severity)
}
