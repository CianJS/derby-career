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
  treatment: { fatigue: 0, bodyLoad: -15 },
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
  health: {
    // Severity 1..3. Recovery points are the remaining amount of care a horse needs before it returns to 정상.
    recoveryNeeded: { 1: 40, 2: 80, 3: 140 } as Record<number, number>,
    recovery: { rest: 10, treatment: 30 },
    // Injury a training session can cause (the roll itself stays in `injury.tiers`).
    trainingInjurySeverity: 1,
    // Applied inside race-sim-v3 when a horse starts while injured. Severity 3 never starts.
    raceEffect: {
      1: { maxSpeed: 0.985, accel: 0.93, drain: 1.06 },
      2: { maxSpeed: 0.965, accel: 0.84, drain: 1.14 },
    } as Record<number, { maxSpeed: number; accel: number; drain: number }>,
    // Chance an injured horse gets worse after racing. Rolled from the stored race seed, never from Math.random.
    worsenPercent: { 1: 18, 2: 30 } as Record<number, number>,
    worsenFatiguePercent: { minFatigue: 40, percent: 10 },
  },
  events: {
    monthlyChance: 0.3,
    // Share of the monthly chance rolled at the start of a month. The result-time roll is derived so both rolls
    // together land on `monthlyChance` instead of stacking on top of it.
    startChance: 0.2,
    guaranteeAfterMisses: 3,
    historyLimit: 6,
  },
  race: {
    // Cost a race adds to the horse by distance; unknown distances use `fallbackCost`.
    cost: {
      1400: { fatigue: 22, bodyLoad: 16 },
      1600: { fatigue: 25, bodyLoad: 18 },
      2000: { fatigue: 30, bodyLoad: 22 },
    } as Record<number, { fatigue: number; bodyLoad: number }>,
    fallbackCost: { fatigue: 25, bodyLoad: 18 },
    // A race this tiring pushes the derived condition down one step (never below 나쁨).
    tiredFatigue: 40,
  },
} as const
