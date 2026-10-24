import { BALANCE } from '../balance'
import { canTrain } from '../health'
import { localEventChoiceAvailability } from './availability'
import type { ActionRecord, Career } from '../model'
import { defaultEventCatalog, type EventCatalog } from './repository'
import { isEventActive, pendingEffects, appliesToAction } from './effects'
import type { CareerEvent, EventDefinition, EventEffect, EventLogEntry } from './types'

type DrawContext = { horseId: string; month: number; health: string; eventMisses: number; eventLog: readonly EventLogEntry[] }
type ResolvedAction = Pick<ActionRecord, 'actionId' | 'actionType' | 'trainingType' | 'seed'>

function hash(text: string): number {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}
const unit = (text: string) => hash(text) / 2 ** 32

/**
 * The monthly chance is split between the start of the month and the training/rest result so the two rolls together
 * land on `monthlyChance` instead of stacking. The result roll only happens when the start roll found nothing.
 */
export const startChance = () => BALANCE.events.startChance
export const resultChance = () => (BALANCE.events.monthlyChance - BALANCE.events.startChance) / (1 - BALANCE.events.startChance)

function recentIds(log: readonly EventLogEntry[]): Set<string> {
  return new Set(log.slice(-BALANCE.events.historyLimit).map(entry => entry.eventId))
}
function pickWeighted(pool: readonly EventDefinition[], seed: string): EventDefinition {
  const total = pool.reduce((sum, event) => sum + event.weight, 0)
  let cursor = unit(seed) * total
  for (const event of pool) { cursor -= event.weight; if (cursor < 0) return event }
  return pool[pool.length - 1]
}
function choose(candidates: readonly EventDefinition[], log: readonly EventLogEntry[], seed: string): EventDefinition | null {
  if (!candidates.length) return null
  const seen = recentIds(log)
  const fresh = candidates.filter(event => !seen.has(event.id))
  return pickWeighted(fresh.length ? fresh : candidates, seed)
}

export function isStartEligible(event: EventDefinition, health: string): boolean {
  if (event.timing !== 'month-start') return false
  return event.choices
    ? event.choices.some((choice) => localEventChoiceAvailability(event, choice.id, { health }).available)
    : localEventChoiceAvailability(event, undefined, { health }).available
}

export function drawMonthStartEvent(context: DrawContext, catalog: EventCatalog = defaultEventCatalog): CareerEvent | null {
  const base = `${context.horseId}:month-${context.month}:event-start:v1`
  const guaranteed = context.eventMisses >= BALANCE.events.guaranteeAfterMisses
  if (!guaranteed && unit(`${base}:roll`) >= startChance()) return null
  const picked = choose(catalog.list().filter(event => isStartEligible(event, context.health)), context.eventLog, `${base}:pick`)
  return picked ? { eventId: picked.id, month: context.month, seed: hash(base), status: 'offered' } : null
}

export function drawResultEvent(context: DrawContext, action: ResolvedAction, catalog: EventCatalog = defaultEventCatalog): CareerEvent | null {
  if (action.actionType === 'treatment' || (action.actionType === 'training' && !canTrain(context.health))) {
    return null
  }
  const base = `${action.actionId}:event-result:v1`
  if (unit(`${base}:roll`) >= resultChance()) return null
  const timing = action.actionType === 'rest' ? 'rest-result' : 'training-result'
  const candidates = catalog.list().filter(event => event.timing === timing && (action.actionType === 'rest' || event.condition.trainingStat === action.trainingType))
  const picked = choose(candidates, context.eventLog, `${base}:pick`)
  return picked ? { eventId: picked.id, month: context.month, seed: hash(base), status: 'offered' } : null
}

const drawContext = (career: Career, month = career.month, eventMisses = career.eventMisses ?? 0, eventLog: readonly EventLogEntry[] = career.eventLog ?? []): DrawContext =>
  ({ horseId: career.horse.id, month, health: career.health, eventMisses, eventLog })

export type ActionEventPlan = { event: CareerEvent | null | undefined; effects: EventEffect[]; definition?: EventDefinition }
/**
 * Decides what the month's event does to the action being resolved and what state the event ends in.
 * Careers saved before events existed (`event === undefined`) stay event-free until `withMonthEvent` enrolls them.
 */
export function planActionEvent(career: Career, action: ResolvedAction, catalog: EventCatalog = defaultEventCatalog): ActionEventPlan {
  const current = career.event
  if (current === undefined) return { event: undefined, effects: [] }
  if (current === null) {
    const drawn = drawResultEvent(drawContext(career), action, catalog)
    const definition = drawn ? catalog.find(drawn.eventId) : undefined
    if (!drawn || !definition) return { event: null, effects: [] }
    return { event: { ...drawn, status: 'applied' }, effects: definition.effects, definition }
  }
  const definition = catalog.find(current.eventId)
  if (current.status === 'applied' || current.status === 'expired') return { event: current, effects: [] }
  if (current.month !== career.month || !definition || !isEventActive(definition, current)) return { event: { ...current, status: 'expired' }, effects: [] }
  const effects = pendingEffects(definition, current).filter(
    (effect) => canTrain(career.health) || effect.scope === 'rest',
  )
  if (!effects.some(effect => appliesToAction(effect, action))) return { event: { ...current, status: 'expired' }, effects: [] }
  return { event: { ...current, status: 'applied' }, effects, definition }
}

/** Closes the finished month's event and draws the next month's. Skipped for careers that have not been enrolled in events. */
export function nextEventState(career: Career, catalog: EventCatalog = defaultEventCatalog): Pick<Career, 'event' | 'eventLog' | 'eventMisses'> | Record<string, never> {
  const prior = career.event
  if (prior === undefined) return {}
  const log = [...(career.eventLog ?? [])]
  if (prior) log.push({ eventId: prior.eventId, month: prior.month, status: prior.status === 'offered' || prior.status === 'chosen' ? 'expired' : prior.status, ...(prior.choice ? { choice: prior.choice } : {}) })
  const eventLog = log.slice(-BALANCE.events.historyLimit)
  const eventMisses = prior ? 0 : (career.eventMisses ?? 0) + 1
  return { event: drawMonthStartEvent(drawContext(career, career.month + 1, eventMisses, eventLog), catalog), eventLog, eventMisses }
}

/** Enrolls a career in the event system and draws the current month's event once. Saved results are never redrawn. */
export function withMonthEvent<T extends Career>(career: T, catalog: EventCatalog = defaultEventCatalog): T {
  if (career.event !== undefined) return career
  if (career.action || career.raceRun) return { ...career, event: null, eventLog: career.eventLog ?? [], eventMisses: career.eventMisses ?? 0 }
  const eventLog = career.eventLog ?? []
  const eventMisses = career.eventMisses ?? 0
  return { ...career, event: drawMonthStartEvent(drawContext(career, career.month, eventMisses, eventLog), catalog), eventLog, eventMisses }
}
