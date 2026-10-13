import type { Choice, Stat } from './domain'

export const eventCategories = ['common', 'normal', 'special', 'accident', 'hidden'] as const
export type EventCategory = (typeof eventCategories)[number]
export const eventTimings = [
  'month_start',
  'training_result',
  'rest_result',
  'treatment_result',
  'before_race',
  'after_race',
] as const
export type EventTiming = (typeof eventTimings)[number]
export type EventCondition =
  | { type: 'always' }
  | { type: 'healthy' }
  | { type: 'training_available'; stat: Stat }
  | { type: 'action_is'; choices: Choice[] }
  | { type: 'value_range'; key: Stat | 'fatigue' | 'bodyLoad'; min?: number; max?: number }
  | { type: 'turn_range'; min?: number; max?: number }
export type EventEffect =
  | { type: 'value_delta'; key: Stat | 'fatigue' | 'bodyLoad'; amount: number }
  | {
      type: 'action_modifier'
      action: 'training' | 'rest' | 'treatment'
      training?: Stat
      field: 'primaryGain' | 'secondaryGain' | 'fatigue' | 'bodyLoad'
      operation: 'add' | 'multiply'
      value: number
    }
  | { type: 'resolved_growth_bonus'; stat: Stat; ratio: number }
export type EventChoice = {
  id: string
  label: string
  conditions: EventCondition[]
  effects: EventEffect[]
}
export type EventDefinition = {
  id: string
  name: string
  category: EventCategory
  subtype: string
  introduction: 'candidate' | 'followup' | 'hold'
  timing: EventTiming
  status: 'ready' | 'needs_mapping' | 'deferred'
  enabled: boolean
  weight: number
  revision: string
  balanceVersion: string
  description: string | null
  conditions: EventCondition[]
  choices: EventChoice[]
  automatic: boolean
  source: { url: string | null; conditionText: string; effectText: string; body?: string }
  mappingNotes: string[]
}
export type DirectorConfig = {
  version: 'event-director-v1'
  monthlyProbability: number
  pityAfterMisses: number
  monthStartShare: number
}
export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  version: 'event-director-v1',
  monthlyProbability: 0.3,
  pityAfterMisses: 3,
  monthStartShare: 0.5,
}
