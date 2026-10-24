import {
  careerJockeyRelations,
  isHealthy,
  canonicalHealth,
  statKeys,
  canTrain,
  eventActionAvailable,
  eventEffectsAvailability,
  type Career,
  type Choice,
  type EventAvailability,
  type EventEffectUse,
} from './domain'
import type { EventDefinition, EventCondition, EventChoice, EventEffect } from './events'

export type EventContext = { career: Career; choice?: Choice; beforeAction?: Career }
export function conditionsMatch(conditions: EventCondition[], context: EventContext): boolean {
  return conditions.every((condition) => {
    switch (condition.type) {
      case 'aptitude_any':
        return context.career.horse.aptitude.some(
          ([name, grade]) => condition.names.includes(name) && condition.grades.includes(grade),
        )
      case 'growth_is':
        return context.career.horse.growth === condition.growth
      case 'health_is':
        return condition.health.includes(canonicalHealth(context.career.health))
      case 'record_range': {
        const value =
          condition.metric === 'starts'
            ? context.career.raceRecords.length
            : context.career.raceRecords.filter((r) => r.placing === 1).length
        return (
          (condition.min === undefined || value >= condition.min) &&
          (condition.max === undefined || value <= condition.max)
        )
      }
      case 'stat_summary': {
        const values = statKeys.map((key) => context.career.values[key])
        if (condition.metric === 'count' && condition.threshold === undefined) {
          return false
        }
        const value =
          condition.metric === 'spread'
            ? Math.max(...values) - Math.min(...values)
            : values.filter((v) => v >= condition.threshold!).length
        return (
          (condition.min === undefined || value >= condition.min) &&
          (condition.max === undefined || value <= condition.max)
        )
      }
      case 'always':
        return true
      case 'healthy':
        return isHealthy(context.career.health)
      case 'training_available':
        return eventActionAvailable(context.career, 'training')
      case 'action_is':
        return !!context.choice && condition.choices.includes(context.choice)
      case 'value_range': {
        const value = context.career.values[condition.key]
        return (
          (condition.min === undefined || value >= condition.min) &&
          (condition.max === undefined || value <= condition.max)
        )
      }
      case 'turn_range':
        return (
          (condition.min === undefined || context.career.careerTurnIndex >= condition.min) &&
          (condition.max === undefined || context.career.careerTurnIndex <= condition.max)
        )
    }
  })
}
/** Reject an unavailable explicit target before drawing/offering a choice, including any risk branch. */
export function trustChoiceAvailable(choice: EventChoice, career: Career): boolean {
  if (
    !choice.effects.some((e) => e.type === 'jockey_trust') &&
    !Object.values(choice.risk?.outcomes ?? {}).some((effects) =>
      effects.some((e) => e.type === 'jockey_trust'),
    )
  ) {
    return true
  }
  if (career.raceRun) {
    return false
  }
  const relations = careerJockeyRelations(career)
  return [...choice.effects, ...Object.values(choice.risk?.outcomes ?? {}).flat()].every(
    (effect) =>
      effect.type !== 'jockey_trust' ||
      career.contractedJockeyIds.includes(effect.jockeyId) ||
      Object.hasOwn(relations, effect.jockeyId),
  )
}

/** Check every possible risk branch before drawing; never roll to discover whether a choice can execute. */
export function serverEventChoiceAvailability(
  event: EventDefinition,
  choice: EventChoice,
  context: EventContext,
): EventAvailability {
  if (!event.choices.some((option) => option.id === choice.id)) {
    return { available: false, reason: 'invalid_choice' }
  }
  if (event.timing === 'month_start' && (context.career.action || context.career.raceRun)) {
    return { available: false, reason: 'action_unavailable' }
  }
  const branches = [choice.effects, ...Object.values(choice.risk?.outcomes ?? {})]
  for (const effects of branches) {
    const result = serverEffectsAvailability(effects, context.career)
    if (!result.available) {
      return result
    }
  }
  const conditions = [...event.conditions, ...choice.conditions]
  if (
    conditions.some((condition) => condition.type === 'training_available') &&
    !eventActionAvailable(context.career, 'training')
  ) {
    return { available: false, reason: 'training_unavailable' }
  }
  if (!conditionsMatch(conditions, context)) {
    return { available: false, reason: 'conditions_not_met' }
  }
  if (!trustChoiceAvailable(choice, context.career)) {
    return { available: false, reason: 'trust_unavailable' }
  }
  return { available: true, reason: null }
}

function serverEffectsAvailability(effects: EventEffect[], career: Career): EventAvailability {
  if (
    effects.some(
      (effect) =>
        effect.type === 'resolved_growth_bonus' &&
        (!career.action?.result ||
          career.action.actionType !== 'training' ||
          career.action.trainingType !== effect.stat),
    )
  ) {
    return { available: false, reason: 'invalid_result' }
  }
  const uses: EventEffectUse[] = effects.map((effect) =>
    effect.type === 'action_modifier' ? effect.action : 'immediate',
  )
  return eventEffectsAvailability(uses, career)
}

/** Only old month-start snapshots blocked by injury may expire as part of a successful rest/treatment. */
export function injuryBlockedPendingEvent(event: EventDefinition, career: Career): boolean {
  return (
    event.timing === 'month_start' &&
    !canTrain(career.health) &&
    event.choices.length > 0 &&
    event.choices.every(
      (choice) =>
        serverEventChoiceAvailability(event, choice, { career }).reason === 'training_unavailable',
    )
  )
}

export function serverEventAvailable(event: EventDefinition, context: EventContext): boolean {
  const choices = event.automatic ? event.choices.slice(0, 1) : event.choices
  return choices.some((choice) => serverEventChoiceAvailability(event, choice, context).available)
}
