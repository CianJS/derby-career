import {
  BALANCE,
  deriveCondition,
  statKeys,
  trainings,
  applyActionEffects,
  type Career,
  type Values,
  type Change,
  type ActionRecord,
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
export function modifyActionDeltas(
  before: Career,
  deltas: Readonly<Partial<Values>>,
  action: Readonly<ActionRecord>,
  modifiers: EventEffect[],
) {
  const adjusted = { ...deltas }
  const training = action.actionType === 'training' ? action.trainingType : null
  const matching = modifiers.filter(
    (e): e is Extract<EventEffect, { type: 'action_modifier' }> =>
      e.type === 'action_modifier' &&
      e.action === action.actionType &&
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
    primary: training ? (deltas[training] ?? 0) : 0,
    fatigue: deltas.fatigue ?? 0,
    bodyLoad: deltas.bodyLoad ?? 0,
  }
  const applied = applyActionEffects(effects, action, base)
  if (training) {
    adjusted[training] = applied.primary
  }
  adjusted.fatigue = applied.fatigue
  adjusted.bodyLoad = applied.bodyLoad
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
    const delta = adjusted[key] ?? 0
    const modified =
      effect.operation === 'multiply' ? Math.round(delta * effect.value) : delta + effect.value
    // Negative cost reductions cannot create healing during a training action.
    const finalDelta =
      training && (key === 'fatigue' || key === 'bodyLoad') ? Math.max(0, modified) : modified
    adjusted[key] = finalDelta
  }
  const baseValues = { ...before.values }
  const modifiedValues = { ...before.values }
  for (const key of Object.keys(adjusted) as (keyof Values)[]) {
    adjusted[key] = Math.round(adjusted[key]!)
    baseValues[key] = bounded(key, before.values[key] + (deltas[key] ?? 0))
    modifiedValues[key] = bounded(key, before.values[key] + adjusted[key]!)
  }
  return { deltas: adjusted, changes: changesBetween(baseValues, modifiedValues) }
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
