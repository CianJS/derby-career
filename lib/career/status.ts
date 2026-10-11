export const isStrained = (fatigue: number, bodyLoad: number) => fatigue >= 70 || bodyLoad >= 60
export const isHealthy = (health: string | undefined) => !health || ['정상', 'HEALTHY'].includes(health)
export const STRAIN_WARNING = '피로가 높습니다. 훈련 시 부상 위험이 증가할 수 있습니다.'
export const INJURY_NOTICE = '부상 중에는 훈련과 경주 출전이 제한됩니다. 휴식하거나 치료를 선택할 수 있습니다.'
