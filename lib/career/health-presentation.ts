import { BALANCE } from './balance'
import { canRace, canTrain, careerHealth, recoverBy } from './health'

export type HealthSource = { health: string; healthRecovery?: number }
export const INJURED_RACE_CAUTION =
  '부상 상태로 출전하면 경기력이 떨어지고 부상이 악화될 수 있습니다.'
export const RACE_ELIGIBILITY_NOTICE =
  '실제 등록은 경주 일정·국가·전적·자금·계약 기수·월간 행동 및 출전 조건을 별도로 확인해야 합니다.'

/** Display only. All severity, legacy recovery and action estimates come from shared game rules. */
export function healthGuidance(career: HealthSource) {
  const current = careerHealth(career)
  const trainingAllowed = canTrain(current.health)
  const racingAllowed = canRace(current.health)
  return {
    ...current,
    trainingAllowed,
    racingAllowed,
    trainingText: trainingAllowed ? '건강 기준 훈련 가능' : '부상 중 훈련 불가',
    raceText: racingAllowed ? '건강 조건상 출전 가능' : '건강 조건상 출전 불가',
    caution: !trainingAllowed && racingAllowed ? INJURED_RACE_CAUTION : null,
  }
}

export function recoveryGuidance(career: HealthSource, action: 'rest' | 'treatment') {
  const before = careerHealth(career)
  const amount = BALANCE.health.recovery[action]
  const after = recoverBy(before, amount)
  const outcome = canTrain(after.health)
    ? canTrain(before.health)
      ? '정상 상태 유지 예상입니다.'
      : `정상 복귀 예상입니다. 예상대로 회복되면 다음 달부터 ${canRace(before.health) ? '건강 기준 훈련 제한' : '건강 기준 훈련·출전 제한'}이 해제됩니다.`
    : canRace(after.health)
      ? `부상 유지 예상으로 훈련 제한은 계속됩니다. 건강 조건상 출전은 원래 가능한 상태이며, ${INJURED_RACE_CAUTION}`
      : '중상 유지 예상으로 훈련·출전 제한이 계속됩니다. 추가 회복이 필요합니다.'
  return { before, after, amount, outcome }
}
