import type { ActionRecord } from '../model'
import type { CareerEvent, EventDefinition, EventEffect } from './types'

type ActionKind = Pick<ActionRecord, 'actionType' | 'trainingType'>
export type ActionCost = { primary: number; fatigue: number; bodyLoad: number }

/** True when the event effect belongs to this action. `immediate` effects never ride on an action. */
export function appliesToAction(effect: EventEffect, action: ActionKind): boolean {
  if (effect.scope === 'immediate') return false
  if (effect.scope === 'rest') return action.actionType === 'rest'
  if (action.actionType !== 'training') return false
  return effect.scope === 'training' || effect.scope === action.trainingType
}

/** Focus events wait for a matching action once offered; pick-one events only count after an option is chosen. */
export function isEventActive(definition: EventDefinition, event: CareerEvent): boolean {
  return event.status === 'chosen' || (event.status === 'offered' && !definition.choices)
}

export function pendingEffects(definition: EventDefinition, event: CareerEvent): EventEffect[] {
  const effects = definition.choices ? definition.choices.find(choice => choice.id === event.choice)?.effects ?? [] : definition.effects
  return effects.filter(effect => effect.scope !== 'immediate')
}
export function immediateEffects(effects: readonly EventEffect[]): EventEffect[] {
  return effects.filter(effect => effect.scope === 'immediate')
}

/**
 * Applies every matching effect to the action's base cost. Training fatigue/body load never drops below 0;
 * a rest cost is already negative, so a lighter value there means more recovery.
 */
export function applyActionEffects(effects: readonly EventEffect[], action: ActionKind, base: ActionCost): ActionCost & { matched: boolean } {
  const matching = effects.filter(effect => appliesToAction(effect, action))
  if (!matching.length) return { ...base, matched: false }
  let growth = 0
  let fatigue = 0
  let bodyLoad = 0
  for (const effect of matching) {
    const { multiplier = 1, ratio = 0, flat = 0 } = effect.growth ?? {}
    growth += base.primary * (multiplier - 1) + base.primary * ratio + flat
    fatigue += effect.fatigue ?? 0
    bodyLoad += effect.bodyLoad ?? 0
  }
  const training = action.actionType === 'training'
  const settle = (value: number) => (training ? Math.max(0, value) : value)
  return {
    primary: base.primary + Math.round(growth),
    fatigue: settle(base.fatigue + fatigue),
    bodyLoad: settle(base.bodyLoad + bodyLoad),
    matched: true,
  }
}
