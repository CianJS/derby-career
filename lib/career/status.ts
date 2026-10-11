import { BALANCE } from './balance'

type Load = { fatigue: number; bodyLoad: number }
export const isStrained = (fatigue: number, bodyLoad: number) => fatigue >= BALANCE.strain.fatigue || bodyLoad >= BALANCE.strain.bodyLoad
export const isHealthy = (health: string | undefined) => !health || ['정상', 'HEALTHY'].includes(health)
export const STRAIN_WARNING = '피로가 높습니다. 훈련 시 부상 위험이 증가할 수 있습니다.'
export const INJURY_NOTICE = '부상 중에는 훈련과 경주 출전이 제한됩니다. 휴식하거나 치료를 선택할 수 있습니다.'

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
