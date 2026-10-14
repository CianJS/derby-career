import {
  hashSeed,
  isHealthy,
  canonicalHealth,
  statKeys,
  type Career,
  type Choice,
} from '../../../../../packages/shared/src/domain'
import type {
  DirectorConfig,
  EventDefinition,
  EventCondition,
  EventTiming,
} from '../../../../../packages/shared/src/events'

import {
  CATEGORY_WEIGHTS,
  isEventReviewed,
  eventCategories,
} from '../../../../../packages/shared/src/events'

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
        return !context.career.action && !context.career.raceRun && isHealthy(context.career.health)
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
const random = (seed: string, label: string) => hashSeed(`${seed}:${label}`) / 4294967296
export type DrawPlan = { gatePassed: boolean; deferredToResult: boolean }
export function planDraw(
  seed: string,
  misses: number,
  pool: EventDefinition[],
  config: DirectorConfig,
): DrawPlan {
  const pity = misses >= config.pityAfterMisses
  const gatePassed = pity || random(seed, `${config.version}:gate`) < config.monthlyProbability
  const hasStart = pool.some((e) => e.timing === 'month_start')
  const hasResult = pool.some((e) =>
    ['training_result', 'rest_result', 'treatment_result'].includes(e.timing),
  )
  // A pity month uses its available start pool immediately. The gate is rolled exactly once per month.
  return {
    gatePassed,
    deferredToResult:
      hasResult &&
      (!hasStart || (!pity && random(seed, `${config.version}:timing`) >= config.monthStartShare)),
  }
}
export function drawEvent(
  pool: EventDefinition[],
  timing: EventTiming,
  context: EventContext,
  seed: string,
  version: string,
): EventDefinition | undefined {
  let eligible = pool
    .filter(
      (e) =>
        e.enabled &&
        e.status === 'ready' &&
        (version === 'event-director-v1' || isEventReviewed(e)) &&
        (e.category !== 'hidden' || e.conditions.filter((c) => c.type !== 'always').length >= 2) &&
        e.timing === timing &&
        conditionsMatch(e.conditions, context) &&
        e.choices.some((c) => conditionsMatch(c.conditions, context)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (version === 'event-director-v2') {
    const categories = eventCategories.filter((category) =>
      eligible.some((e) => e.category === category),
    )
    let target =
      random(seed, `${version}:${timing}:category`) *
      categories.reduce((sum, category) => sum + CATEGORY_WEIGHTS[category], 0)
    let selected: (typeof eventCategories)[number] | undefined
    for (const category of categories) {
      target -= CATEGORY_WEIGHTS[category]
      if (target < 0) {
        selected = category
        break
      }
    }
    eligible = eligible.filter((e) => e.category === selected)
  }
  const total = eligible.reduce((sum, e) => sum + e.weight, 0)
  let target = random(seed, `${version}:${timing}:pool`) * total
  for (const event of eligible) {
    target -= event.weight
    if (target < 0) {
      return event
    }
  }
  return undefined
}
