import { trainings } from '../../../../../packages/shared/src/domain'
import { canTrain } from '../../../../../lib/career/health'
import type { EventDefinition } from '../../../../../packages/shared/src/events'

type EventContext = Pick<EventDefinition, 'timing' | 'conditions' | 'choices'>
export const effectSemanticCodes = [
  'LATE_ACTION_MODIFIER',
  'MISSING_SECONDARY_STAT',
  'GROWTH_BONUS_CONTEXT',
]

/** Apply identical execution rules to direct effects and every possible risk outcome. */
export function effectSemanticIssues(event: EventContext) {
  const issues: { code: string; path: string; detail: string }[] = []
  for (const [index, choice] of event.choices.entries()) {
    const sets = [
      { path: `choices.${index}.effects`, effects: choice.effects },
      ...Object.entries(choice.risk?.outcomes ?? {}).map(([outcome, effects]) => ({
        path: `choices.${index}.risk.outcomes.${outcome}`,
        effects,
      })),
    ]
    for (const { path, effects } of sets) {
      for (const [ordinal, effect] of effects.entries()) {
        const add = (code: string, detail: string) =>
          issues.push({ code, path: `${path}.${ordinal}`, detail })
        if (effect.type === 'action_modifier' && event.timing !== 'month_start') {
          add(
            'LATE_ACTION_MODIFIER',
            '확정 행동 결과 시점의 보정을 해당 행동에 소급 적용할 수 없음',
          )
        }
        if (
          effect.type === 'action_modifier' &&
          effect.field === 'secondaryGain' &&
          effect.training &&
          !trainings[effect.training].secondary
        ) {
          add('MISSING_SECONDARY_STAT', '지능 훈련에는 공유 규칙의 보조 성장 능력치가 없음')
        }
        if (
          effect.type === 'resolved_growth_bonus' &&
          (event.timing !== 'training_result' ||
            ![...event.conditions, ...choice.conditions].some(
              (condition) =>
                condition.type === 'action_is' &&
                condition.choices.length === 1 &&
                condition.choices[0] === effect.stat,
            ))
        ) {
          add('GROWTH_BONUS_CONTEXT', '동일 능력의 확정 훈련 결과 조건이 필요함')
        }
      }
    }
  }
  return issues
}

/** Month-start eligibility and the shared action model both require healthy training. */
export function unreachableTrainingResult(event: EventContext): boolean {
  if (event.timing !== 'training_result') {
    return false
  }
  const possible = (conditions: EventContext['conditions']) =>
    conditions.every(
      (condition) =>
        condition.type !== 'health_is' || condition.health.some((health) => canTrain(health)),
    )
  return !event.choices.some((choice) => possible([...event.conditions, ...choice.conditions]))
}
