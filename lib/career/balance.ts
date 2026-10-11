import type { Stat } from './model'

/**
 * Central balance table for the monthly career loop. Every gameplay number used by training,
 * rest, treatment, strain warnings and injury risk lives here so a later balance pass only edits this file.
 * Components never compute stats themselves; they read results produced by `resolveAction`.
 */
export const BALANCE = {
  maxStat: 1000,
  training: {
    primary: { base: 14, spread: 5 },
    secondary: { base: 4, spread: 3 },
    cost: {
      speed: { fatigue: 13, bodyLoad: 13 },
      stamina: { fatigue: 16, bodyLoad: 8 },
      power: { fatigue: 13, bodyLoad: 13 },
      guts: { fatigue: 16, bodyLoad: 10 },
      intelligence: { fatigue: 6, bodyLoad: 4 },
    } satisfies Record<Stat, { fatigue: number; bodyLoad: number }>,
  },
  rest: { fatigue: -35, bodyLoad: -25 },
  treatment: { fatigue: 0, bodyLoad: -15, healthAfter: '정상' },
  strain: { fatigue: 70, bodyLoad: 60 },
  injury: {
    health: '경상',
    // First matching tier wins. Risk is evaluated on the values the horse had BEFORE the training and
    // rolled from the stored action seed, so the same actionId and seed always produce the same outcome.
    tiers: [
      { minFatigue: 85, minBodyLoad: 80, percent: 30 },
      { minFatigue: 70, minBodyLoad: 60, percent: 15 },
    ],
  },
  condition: { goodFatigue: 10, goodBodyLoad: 10 },
} as const
