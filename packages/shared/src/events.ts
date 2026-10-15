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
  | { type: 'aptitude_any'; names: string[]; grades: string[] }
  | { type: 'growth_is'; growth: '조숙' | '표준' | '만성' }
  | { type: 'health_is'; health: string[] }
  | { type: 'record_range'; metric: 'starts' | 'wins'; min?: number; max?: number }
  | {
      type: 'stat_summary'
      metric: 'spread' | 'count'
      threshold?: number
      min?: number
      max?: number
    }
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
export const riskOutcomes = ['great_success', 'success', 'failure', 'disaster'] as const
export type RiskOutcome = (typeof riskOutcomes)[number]
export type EventChoice = {
  risk?: { version: 'event-risk-v1'; outcomes: Record<RiskOutcome, EventEffect[]> }
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
  review?: {
    sourceDigest: string
    converted: boolean
    executable: boolean
    contentReviewed: boolean
    balanceReviewed: boolean
    groupId: string | null
    representativeId: string | null
  }
  mappingNotes: string[]
}
export type DirectorConfig = {
  version: 'event-director-v1' | 'event-director-v2'
  monthlyProbability: number
  pityAfterMisses: number
  monthStartShare: number
}
/** Internal provenance stays in the immutable catalog; responses expose game descriptions only. */
export function publicEventDefinition(event: EventDefinition): EventDefinition {
  return {
    ...event,
    source: {
      url: null,
      conditionText: '',
      effectText: '',
    },
  }
}
export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  version: 'event-director-v1',
  monthlyProbability: 0.3,
  pityAfterMisses: 3,
  monthStartShare: 0.5,
}

/** Frozen v1 remains available for old draw snapshots and regression fixtures. */
export const CURRENT_DIRECTOR_CONFIG: DirectorConfig = {
  ...DEFAULT_DIRECTOR_CONFIG,
  version: 'event-director-v2',
}
export const CATEGORY_WEIGHTS = {
  common: 45,
  normal: 35,
  special: 12,
  accident: 6,
  hidden: 2,
} as const
export const RISK_WEIGHTS = { great_success: 15, success: 55, failure: 25, disaster: 5 } as const
export function isEventReviewed(event: EventDefinition): boolean {
  return !event.review
    ? event.category === 'common' && !/^(GEN|SPC|ACC|HID)-/.test(event.id)
    : event.review.converted &&
        event.review.executable &&
        event.review.contentReviewed &&
        event.review.balanceReviewed
}
