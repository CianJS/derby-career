import { canTrain } from '../health'
import { isHealthy } from '../status'
import type { Career } from '../model'
import type { EventDefinition, EventEffect } from './types'

export type EventAvailability = {
  available: boolean
  reason:
    | 'training_unavailable'
    | 'action_unavailable'
    | 'conditions_not_met'
    | 'invalid_choice'
    | 'invalid_result'
    | 'trust_unavailable'
    | null
}
export type EventActionContext = Pick<Career, 'health'> &
  Partial<Pick<Career, 'action' | 'raceRun'>>
export type EventEffectUse = 'immediate' | 'training' | 'rest' | 'treatment'

/** The same monthly action rules used by commitAction, independent of either event format. */
export function eventActionAvailable(
  career: EventActionContext,
  action: Exclude<EventEffectUse, 'immediate'>,
): boolean {
  if (career.action || career.raceRun) {
    return false
  }
  return action === 'training'
    ? canTrain(career.health)
    : action === 'treatment'
      ? !isHealthy(career.health)
      : true
}

/** Mixed choices remain useful when at least one effect can run. An explicit no-effect choice is allowed. */
export function eventEffectsAvailability(
  uses: readonly EventEffectUse[],
  career: EventActionContext,
): EventAvailability {
  if (
    !uses.length ||
    uses.some((use) => use === 'immediate' || eventActionAvailable(career, use))
  ) {
    return { available: true, reason: null }
  }
  return {
    available: false,
    reason:
      uses.every((use) => use === 'training') && !canTrain(career.health)
        ? 'training_unavailable'
        : 'action_unavailable',
  }
}

export function localEventEffectsAvailability(
  effects: readonly EventEffect[],
  career: EventActionContext,
): EventAvailability {
  return eventEffectsAvailability(
    effects.map((effect) =>
      effect.scope === 'immediate' || effect.scope === 'rest' ? effect.scope : 'training',
    ),
    career,
  )
}

/** FE may call this for each option; callers still check saved status/month before sending a command. */
export function localEventChoiceAvailability(
  event: EventDefinition,
  choiceId: string | undefined,
  career: EventActionContext,
): EventAvailability {
  if (career.action || career.raceRun) {
    return { available: false, reason: 'action_unavailable' }
  }
  if (event.condition.trainingStat && !eventActionAvailable(career, 'training')) {
    return { available: false, reason: 'training_unavailable' }
  }
  const choice = event.choices?.find((option) => option.id === choiceId)
  if (event.choices && !choice) {
    return { available: false, reason: 'invalid_choice' }
  }
  return localEventEffectsAvailability(choice?.effects ?? event.effects, career)
}
