import { hashSeed } from '../../../../../packages/shared/src/domain'
import type {
  DirectorConfig,
  EventDefinition,
  EventTiming,
} from '../../../../../packages/shared/src/events'

import {
  CATEGORY_WEIGHTS,
  isEventReviewed,
  eventCategories,
} from '../../../../../packages/shared/src/events'

export {
  conditionsMatch,
  trustChoiceAvailable,
} from '../../../../../packages/shared/src/event-availability'
import { serverEventAvailable } from '../../../../../packages/shared/src/event-availability'
import type { EventContext } from '../../../../../packages/shared/src/event-availability'
export type { EventContext } from '../../../../../packages/shared/src/event-availability'
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
        serverEventAvailable(e, context),
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
