import { canTrain, type Career, type EventAvailability } from '@/packages/shared/src/domain'
import {
  injuryBlockedPendingEvent,
  serverEventChoiceAvailability,
} from '@/packages/shared/src/event-availability'
import type { SaveWorkspace } from '@/lib/server-save/workspace'

const reasons: Record<NonNullable<EventAvailability['reason']>, string> = {
  training_unavailable: '부상 중에는 훈련할 수 없어 이 훈련 보상을 사용할 수 없습니다.',
  action_unavailable: '현재 행동 상태에서는 이 선택지의 보상을 사용할 수 없습니다.',
  conditions_not_met: '현재 말의 건강·적성·전적 또는 행동이 이 선택지의 조건을 충족하지 않습니다.',
  invalid_choice: '저장된 이벤트에서 확인할 수 없는 선택지입니다. 기록을 다시 불러와 주세요.',
  invalid_result: '이 선택지에 필요한 해당 훈련의 확정 결과가 없습니다.',
  trust_unavailable: '이 선택지의 기수 신뢰도 효과를 적용할 수 있는 계약·관계가 없습니다.',
}

export function eventChoiceReason(availability: EventAvailability, career: Pick<Career, 'health'>) {
  if (availability.reason === 'training_unavailable' && canTrain(career.health)) {
    return '현재 행동 상태에서는 훈련을 실행할 수 없어 이 훈련 보상을 사용할 수 없습니다.'
  }
  return availability.reason ? reasons[availability.reason] : null
}

/** Read the owned snapshot only; choices and expiry are still confirmed by the server. */
export function serverMonthEventAvailability(saved: SaveWorkspace['career']) {
  if (!saved?.event) {
    return null
  }
  const { event, state: career } = saved
  const current = event.turn === career.careerTurnIndex
  const choice =
    career.action?.trainingType ??
    (career.action?.actionType === 'rest'
      ? 'rest'
      : career.action?.actionType === 'treatment'
        ? 'treatment'
        : undefined)
  return {
    event,
    career,
    current,
    choices: event.definition.choices.map((option) => ({
      choice: option,
      availability: serverEventChoiceAvailability(event.definition, option, { career, choice }),
    })),
    recoveryPending:
      current &&
      event.state === 'pending' &&
      !career.action &&
      !career.raceRun &&
      injuryBlockedPendingEvent(event.definition, career),
  }
}
