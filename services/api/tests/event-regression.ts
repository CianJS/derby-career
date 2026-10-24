import { legacyCareer as startCareer } from '../../../tests/helpers/legacy-career'
import { commitAction, resolveAction, type Choice } from '../../../packages/shared/src/domain'
import {
  DEFAULT_DIRECTOR_CONFIG,
  type EventDefinition,
  type EventTiming,
} from '../../../packages/shared/src/events'
import {
  conditionsMatch,
  drawEvent,
  planDraw,
  type EventContext,
} from '../src/modules/events/director'
import { applyImmediateEffects } from '../src/modules/events/resolver'
import { digest } from '../src/services/identity'

/** Frozen observations of the existing director and resolver, independent of import implementation. */
export function eventRegressionDigest(
  pool: EventDefinition[],
  scope: 'all' | 'unaffected' = 'all',
) {
  const observations: unknown[] = []
  const timings: EventTiming[] = [
    'month_start',
    'training_result',
    'rest_result',
    'treatment_result',
  ]
  for (const horse of [
    'DEV_HORSE_RED_COMET',
    'DEV_HORSE_SERENE_STEP',
    'DEV_HORSE_NORTHERN_RIVER',
  ]) {
    const base = startCareer(horse)
    const contexts: EventContext[] = [
      { career: base },
      { career: { ...base, values: { ...base.values, fatigue: 70, bodyLoad: 60 } } },
      { career: { ...base, health: '경상', healthRecovery: 2 } },
      ...(
        ['speed', 'stamina', 'power', 'guts', 'intelligence', 'rest', 'treatment'] as Choice[]
      ).map((choice) => {
        const beforeAction =
          choice === 'treatment' ? { ...base, health: '경상', healthRecovery: 2 } : base
        return { career: resolveAction(commitAction(beforeAction, choice)), choice, beforeAction }
      }),
    ]
    for (let index = 0; index < contexts.length; index++) {
      for (let i = 0; i < 32; i++) {
        const seed = `p1-event-regression:${horse}:${index}:${i}`
        observations.push(
          [0, 2, 3].map((misses) => planDraw(seed, misses, pool, DEFAULT_DIRECTOR_CONFIG)),
        )
        for (const timing of timings) {
          // The old full golden also probes impossible result-before-action/start-after-action
          // draws and injured training choices. UX-12 deliberately changes those observations.
          if (scope === 'unaffected') {
            const context = contexts[index]
            const actualTiming =
              context.choice === 'rest'
                ? 'rest_result'
                : context.choice === 'treatment'
                  ? 'treatment_result'
                  : 'training_result'
            if (
              index === 2 ||
              (context.choice ? timing !== actualTiming : timing !== 'month_start')
            ) {
              continue
            }
          }
          const event = drawEvent(
            pool,
            timing,
            contexts[index],
            seed,
            DEFAULT_DIRECTOR_CONFIG.version,
          )
          observations.push(
            event
              ? {
                  id: event.id,
                  revision: event.revision,
                  choices: event.choices
                    .filter((choice) => conditionsMatch(choice.conditions, contexts[index]))
                    .map((choice) => ({
                      id: choice.id,
                      result: applyImmediateEffects(contexts[index].career, choice.effects),
                    })),
                }
              : null,
          )
        }
      }
    }
  }
  return digest(observations)
}
