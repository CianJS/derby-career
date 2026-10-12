import { BALANCE } from './balance'
import { healthSeverity } from './health'

type Load = { fatigue: number; bodyLoad: number }
export const isStrained = (fatigue: number, bodyLoad: number) => fatigue >= BALANCE.strain.fatigue || bodyLoad >= BALANCE.strain.bodyLoad
export const isHealthy = (health: string | undefined) => healthSeverity(health) === 0
export const STRAIN_WARNING = '피로가 높습니다. 훈련 시 부상 위험이 증가할 수 있습니다.'
export const INJURY_NOTICE = '부상 중에는 훈련할 수 없습니다. 경상·중등도 부상은 출전할 수 있지만 주행 능력이 떨어지고 악화될 수 있습니다. 중상은 출전할 수 없습니다.'

export function injuryRiskPercent({ fatigue, bodyLoad }: Load): number {
  const tier = BALANCE.injury.tiers.find(t => fatigue >= t.minFatigue || bodyLoad >= t.minBodyLoad)
  return tier?.percent ?? 0
}
export function rollsInjury(values: Load, seed: number): boolean {
  const percent = injuryRiskPercent(values)
  return percent > 0 && (seed >>> 16) % 100 < percent
}
export function deriveCondition(values: Load, health: string | undefined): string {
  if (!isHealthy(health) || isStrained(values.fatigue, values.bodyLoad)) return '나쁨'
  return values.fatigue <= BALANCE.condition.goodFatigue && values.bodyLoad <= BALANCE.condition.goodBodyLoad ? '좋음' : '보통'
}
