import { BALANCE } from './balance'

export const RACE_SIM_V3_VERSION = 'race-sim-v3'

export type TacticPreference = {
  /** Preferred field position as a fraction of the field: 0 = leading, 1 = last. */
  early: number
  mid: number
  late: number
  /** How strongly the tactic reacts to being on the wrong side of its preferred position. */
  positionGain: number
  /** 0..1 pull toward the inside rail while the field settles. */
  railBias: number
  /** How much the field's front pressure changes this tactic's race pace. */
  paceExposure: number
  /** Farthest-out remaining distance (m) where this tactic is willing to start its sprint. */
  sprintRemainingM: number
  /** Extra speed fraction held through the sprint; paid for with energy the tactic saved earlier. */
  sprintBoost: number
}

/**
 * Every number race-sim-v3 uses. A stored race remembers `race-sim-v3`, so editing a value here changes how that engine version
 * replays old logs: tune by adding a new config and version instead of editing a shipped one.
 */
export type RaceBalanceConfig = {
  version: string
  tickSeconds: number
  samplesEveryTicks: number
  maxTicks: number
  track: { halfWidthM: number; railMarginM: number; laneSpacingM: number; horseLengthM: number; horseWidthM: number }
  /** Speed stat -> Base Max Speed only. */
  speed: { baseMps: number; perPoint: number; refPoint: number; cruiseFraction: number; sprintFraction: number; formSpreadMps: number; conditionMpsPerPoint: number; conditionFreePoints: number }
  /** Power stat -> Acceleration / Reacceleration. */
  accel: { base: number; perPower: number; refPower: number; taper: number; reaccelFactor: number; reaccelGapMps: number; decel: number; startBoostPerJockey: number; startZoneM: number }
  /** Stamina stat -> Energy consumption efficiency. Guts stat -> low-energy mitigation. */
  energy: { start: number; drainPerSecond: number; refSpeedMps: number; exponent: number; staminaPerPoint: number; refStamina: number; accelDrain: number; draftMultiplier: number; draftGapM: number; lowRatio: number; lowPenalty: number; gutsBase: number; gutsPerPoint: number; refGuts: number; gutsMax: number; floorFraction: number }
  /** Distance/surface grade scales effective max speed; tactic grade scales how well the tactic is executed. */
  aptitude: { speedMultiplier: Record<string, number>; tacticExecution: Record<string, number> }
  /** Intelligence + jockey -> how steadily pace, path and tactic are executed. */
  execution: { base: number; perIntelligence: number; refIntelligence: number; perStability: number; perPace: number; min: number; max: number }
  noise: { base: number; perMissingExecution: number; min: number; max: number; periodTicks: number; smoothing: number }
  pace: { adaptGain: number; maxEase: number; maxPush: number; overpaceBias: number; pressureSlope: number; pressureNeutral: number; pressureEndProgress: number; sprintReserve: number }
  position: { earlyEnd: number; midEnd: number; midWeight: number; maxEase: number; maxPush: number }
  tactics: Record<string, TacticPreference>
  block: { lookAheadBaseM: number; lookAheadPerMps: number; minGapM: number; lateralClearM: number; followGain: number; releaseMps: number }
  path: { stepM: number; reactBaseTicks: number; reactPerPath: number; reactPerIntelligence: number; reactMinTicks: number; steerBase: number; steerPerPath: number; sideWindowM: number; scanAheadM: number; switchMarginM: number; settleStartProgress: number; settleEndProgress: number }
  sprint: { prepareExtraM: number; forceRemainingM: number; marginBase: number; marginSkillFree: number; perTiming: number; perIntelligence: number; kickPerTiming: number; maxMargin: number }
  start: { delayBaseTicks: number; perJockeyStart: number; maxDelayTicks: number }
  overtake: { holdTicks: number; marginM: number; minSpacingMs: number }
  events: { blockedAfterTicks: number; blockedSpacingMs: number; clearAfterTicks: number }
  /** Per injury severity: multipliers applied to the injured runner. */
  injury: Record<number, { maxSpeed: number; accel: number; drain: number }>
}

export const RACE_BALANCE_V3: RaceBalanceConfig = {
  version: RACE_SIM_V3_VERSION,
  tickSeconds: 0.1,
  samplesEveryTicks: 10,
  maxTicks: 4000,
  track: { halfWidthM: 15, railMarginM: 0.8, laneSpacingM: 1.5, horseLengthM: 2.4, horseWidthM: 1.1 },
  speed: { baseMps: 16.9, perPoint: 0.002, refPoint: 500, cruiseFraction: 0.955, sprintFraction: 1.0, formSpreadMps: 0.3, conditionMpsPerPoint: 0.01, conditionFreePoints: 30 },
  accel: { base: 3, perPower: 0.0075, refPower: 480, taper: 0.5, reaccelFactor: 0.9, reaccelGapMps: 0.8, decel: 2.2, startBoostPerJockey: 0.012, startZoneM: 60 },
  // Drain grows with speed^4 per second, so a 1% faster cruise costs about 3% more energy over the same distance.
  energy: { start: 1000, drainPerSecond: 10, refSpeedMps: 16.9, exponent: 4, staminaPerPoint: 0.0016, refStamina: 500, accelDrain: 0.5, draftMultiplier: 0.94, draftGapM: 3.5, lowRatio: 0.22, lowPenalty: 0.14, gutsBase: 0.2, gutsPerPoint: 0.0022, refGuts: 450, gutsMax: 0.75, floorFraction: 0.8 },
  aptitude: { speedMultiplier: { A: 1, B: 0.994, C: 0.982, D: 0.96 }, tacticExecution: { A: 1, B: 0.9, C: 0.75, D: 0.55 } },
  execution: { base: 0.55, perIntelligence: 0.0012, refIntelligence: 480, perStability: 0.004, perPace: 0.003, min: 0.2, max: 1 },
  noise: { base: 0.05, perMissingExecution: 0.3, min: 0.05, max: 0.3, periodTicks: 20, smoothing: 0.08 },
  pace: { adaptGain: 0.5, maxEase: 0.12, maxPush: 0.02, overpaceBias: 0.014, pressureSlope: 0.05, pressureNeutral: 0.4, pressureEndProgress: 0.6, sprintReserve: 1.06 },
  position: { earlyEnd: 0.35, midEnd: 0.7, midWeight: 0.5, maxEase: 0.022, maxPush: 0.024 },
  tactics: {
    도주: { early: 0, mid: 0.05, late: 0.15, positionGain: 0.05, railBias: 1, paceExposure: 1, sprintRemainingM: 520, sprintBoost: 0 },
    선행: { early: 0.2, mid: 0.2, late: 0.25, positionGain: 0.04, railBias: 0.8, paceExposure: 0.8, sprintRemainingM: 480, sprintBoost: 0.004 },
    선입: { early: 0.5, mid: 0.5, late: 0.45, positionGain: 0.03, railBias: 0.5, paceExposure: 0.3, sprintRemainingM: 420, sprintBoost: 0.014 },
    추입: { early: 0.85, mid: 0.8, late: 0.7, positionGain: 0.03, railBias: 0.25, paceExposure: 0.1, sprintRemainingM: 360, sprintBoost: 0.028 },
  },
  block: { lookAheadBaseM: 3, lookAheadPerMps: 0.4, minGapM: 0.8, lateralClearM: 1.6, followGain: 1.2, releaseMps: 0.1 },
  path: { stepM: 1.8, reactBaseTicks: 6, reactPerPath: 0.12, reactPerIntelligence: 0.02, reactMinTicks: 2, steerBase: 1, steerPerPath: 0.02, sideWindowM: 2.6, scanAheadM: 18, switchMarginM: 4, settleStartProgress: 0.04, settleEndProgress: 0.2 },
  sprint: { prepareExtraM: 120, forceRemainingM: 110, marginBase: 1, marginSkillFree: 0.22, perTiming: 0.004, perIntelligence: 0.0004, kickPerTiming: 0.0008, maxMargin: 1.3 },
  start: { delayBaseTicks: 4, perJockeyStart: 0.12, maxDelayTicks: 10 },
  overtake: { holdTicks: 5, marginM: 1, minSpacingMs: 3000 },
  events: { blockedAfterTicks: 8, blockedSpacingMs: 3000, clearAfterTicks: 10 },
  injury: BALANCE.health.raceEffect,
}
