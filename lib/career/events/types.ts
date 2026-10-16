import type { TrustEventEffect } from '../jockey-trust'
import type { Stat } from '../model'

export type EventKind = 'focus' | 'breakthrough' | 'discovery' | 'recovery' | 'life'
export type EventTiming = 'month-start' | 'training-result' | 'rest-result'
export const eventKindLabels: Record<EventKind, string> = { focus: '집중 조교', breakthrough: '훈련 대성공', discovery: '돌발 발견', recovery: '상태·회복', life: '생활·마방' }

/**
 * Where an effect applies.
 * - immediate: changes the horse the moment the event is accepted.
 * - training: any training this month. A stat key: only that stat's training. rest: only a rest action.
 */
export type EventScope = 'immediate' | 'training' | 'rest' | Stat
/**
 * `growth` adjusts the primary stat gain of the matching training: `multiplier` scales it, `ratio` adds that share of
 * the base gain on top, `flat` adds points. `fatigue` and `bodyLoad` are signed deltas of the action's cost
 * (positive adds load, negative lightens it). All of them are optional and combine additively.
 */
export type EventEffect = { trust?: TrustEventEffect; scope: EventScope; growth?: { multiplier?: number; ratio?: number; flat?: number }; fatigue?: number; bodyLoad?: number }
export type EventChoiceId = 'A' | 'B'
export type EventChoice = { id: EventChoiceId; effects: EventEffect[] }
/** `trainingStat` needs that training to be possible (month-start) or performed (training-result). `action: 'rest'` needs a rest action. */
export type EventCondition = { trainingStat?: Stat; action?: 'rest' }
export type EventDefinition = {
  id: string
  name: string
  description: string
  kind: EventKind
  timing: EventTiming
  condition: EventCondition
  weight: number
  /** Month-start events disappear at the end of the month they appear in. */
  limitedToMonth: boolean
  effects: EventEffect[]
  /** Present on pick-one events. Their `effects` stay empty and the chosen option's effects apply instead. */
  choices?: [EventChoice, EventChoice]
}

export type EventStatus = 'offered' | 'chosen' | 'applied' | 'expired'
/** What a Career save keeps about the month's event: ids, seed and outcome only, never the definition. */
export type CareerEvent = { eventId: string; month: number; seed: number; status: EventStatus; choice?: EventChoiceId; immediate?: { fatigue: number; bodyLoad: number } }
export type EventLogEntry = { eventId: string; month: number; status: EventStatus; choice?: EventChoiceId }
/** The event's measured contribution to one resolved action, stored on the ActionRecord. */
export type AppliedEvent = { eventId: string; kind: EventKind; choice?: EventChoiceId; growth: number; fatigue: number; bodyLoad: number }
