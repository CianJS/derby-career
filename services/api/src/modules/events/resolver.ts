import {
  BALANCE,
  deriveCondition,
  statKeys,
  trainings,
  applyActionEffects,
  type Career,
  type Choice,
  type Values,
  type Change,
} from '../../../../../packages/shared/src/domain'
import type { EventEffect as BrowserEffect } from '../../../../../lib/career/events/types'
import type { EventEffect } from '../../../../../packages/shared/src/events'

const bounded = (key: keyof Values, value: number) =>
  Math.max(
    0,
    Math.min(
      (statKeys as readonly string[]).includes(key) ? BALANCE.maxStat : Infinity,
      Math.round(value),
    ),
  )
export function changesBetween(before: Values, after: Values): Change[] {
  return (Object.keys(before) as (keyof Values)[])
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, before: before[key], after: after[key] }))
}
export function applyImmediateEffects(
  career: Career,
  effects: EventEffect[],
): { career: Career; modifiers: EventEffect[]; changes: Change[] } {
  const values = { ...career.values }
  const modifiers: EventEffect[] = []
  for (const effect of effects) {
    if (effect.type === 'action_modifier') {
      modifiers.push(effect)
      continue
    }
    if (effect.type === 'value_delta') {
      values[effect.key] = bounded(effect.key, values[effect.key] + effect.amount)
    } else {
      const action = career.action
      if (
        !action ||
        action.actionType !== 'training' ||
        action.trainingType !== effect.stat ||
        !action.result
      ) {
        throw new Error('Resolved growth bonus requires a locked matching training result')
      }
      const base = action.result.find((x) => x.key === effect.stat)
      const growth = base ? base.after - base.before : 0
      values[effect.stat] = bounded(
        effect.stat,
        values[effect.stat] + Math.round(growth * effect.ratio),
      )
    }
  }
  const changes = changesBetween(career.values, values)
  return {
    career: {
      ...career,
      values,
      condition: changes.length ? deriveCondition(values, career.health) : career.condition,
    },
    modifiers,
    changes,
  }
}
export function applyActionModifiers(
  before: Career,
  resolved: Career,
  choice: Choice,
  modifiers: EventEffect[],
) {
  const values = { ...resolved.values }
  const training = (statKeys as readonly string[]).includes(choice)
    ? (choice as keyof typeof trainings)
    : undefined
  const action = training ? 'training' : choice
  const matching = modifiers.filter(
    (e): e is Extract<EventEffect, { type: 'action_modifier' }> =>
      e.type === 'action_modifier' &&
      e.action === action &&
      (!e.training || e.training === training),
  )
  // Existing browser and server use the same primary-growth / signed-cost arithmetic.
  const common = matching.filter(
    (e) =>
      e.field !== 'secondaryGain' &&
      e.action !== 'treatment' &&
      (e.operation === 'add' || e.field === 'primaryGain'),
  )
  const effects: BrowserEffect[] = common.map((e) => ({
    scope: training ?? 'rest',
    ...(e.field === 'primaryGain'
      ? { growth: e.operation === 'multiply' ? { multiplier: e.value } : { flat: e.value } }
      : { [e.field]: e.value }),
  }))
  const base = {
    primary: training ? values[training] - before.values[training] : 0,
    fatigue: values.fatigue - before.values.fatigue,
    bodyLoad: values.bodyLoad - before.values.bodyLoad,
  }
  const applied = applyActionEffects(
    effects,
    {
      actionType: training ? 'training' : (choice as 'rest' | 'treatment'),
      trainingType: training ?? null,
    },
    base,
  )
  if (training) {
    values[training] = bounded(training, before.values[training] + applied.primary)
  }
  values.fatigue = bounded('fatigue', before.values.fatigue + applied.fatigue)
  values.bodyLoad = bounded('bodyLoad', before.values.bodyLoad + applied.bodyLoad)
  for (const effect of matching.filter((e) => !common.includes(e))) {
    const key =
      effect.field === 'primaryGain'
        ? training
        : effect.field === 'secondaryGain'
          ? training && trainings[training].secondary
          : effect.field
    if (!key) {
      continue
    }
    const delta = values[key] - before.values[key]
    const modified =
      effect.operation === 'multiply' ? Math.round(delta * effect.value) : delta + effect.value
    // Negative cost reductions cannot create healing during a training action.
    const finalDelta =
      training && (key === 'fatigue' || key === 'bodyLoad') ? Math.max(0, modified) : modified
    values[key] = bounded(key, before.values[key] + finalDelta)
  }
  const changes = changesBetween(resolved.values, values)
  return {
    career: {
      ...resolved,
      values,
      condition: changes.length ? deriveCondition(values, resolved.health) : resolved.condition,
    },
    changes,
  }
}
export function finalizeActionRecord(before: Career, after: Career): Career {
  if (!after.action) {
    return after
  }
  const statusChanges = [...(after.action.statusChanges ?? []).filter((c) => c.key !== 'condition')]
  if (before.condition !== after.condition) {
    statusChanges.push({ key: 'condition', before: before.condition, after: after.condition })
  }
  const keys = [
    ...new Set([
      ...(after.action.result ?? []).map((c) => c.key),
      ...statKeys,
      'fatigue',
      'bodyLoad',
    ] as (keyof Values)[]),
  ]
  const result = keys
    .filter((key) => before.values[key] !== after.values[key])
    .map((key) => ({ key, before: before.values[key], after: after.values[key] }))
  return { ...after, action: { ...after.action, result, statusChanges } }
}
