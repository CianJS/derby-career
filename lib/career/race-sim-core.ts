import type { RaceRunInput, RaceRunnerInput } from './race-entry'
import type { FinishRecord, InternalRaceEvent, PhaseMarker, RacePhase, RaceHighlight, RaceSample, RaceSimulationLog } from './race-simulation'
import type { RaceBalanceConfig, TacticPreference } from './race-balance'
import { healthSeverity } from './health'

export type RunnerStateV3 = {
  progressM: number
  lateralM: number
  actualSpeedMps: number
  targetSpeedMps: number
  effectiveMaxSpeedMps: number
  energy: number
  blocked: boolean
  sprintState: 'none' | 'prepare' | 'active'
}

type Runner = RunnerStateV3 & {
  id: string
  index: number
  tactic: string
  preference: TacticPreference
  rng: () => number
  baseMaxMps: number
  formMps: number
  conditionMps: number
  distanceMultiplier: number
  injuryMaxSpeed: number
  injuryDrain: number
  accelMps2: number
  staminaEfficiency: number
  gutsMitigation: number
  execution: number
  tacticExecution: number
  startDelayTicks: number
  startBoost: number
  noiseAmp: number
  noise: number
  noiseGoal: number
  reactTicks: number
  steerMps: number
  sprintSkill: number
  kick: number
  blockedTicks: number
  laneInitial: number
  laneGoal: number
  goalHoldTicks: number
  finishTime: number | null
}

function hashText(text: string): number {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}
function createRng(seedText: string) {
  let state = hashText(seedText)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const gradeOf = (runner: RaceRunnerInput, name: string) => runner.horseSnapshot.aptitude.find(([label]) => label === name)?.[1] ?? 'D'

function createRunner(run: RaceRunInput, runner: RaceRunnerInput, index: number, gate: number, count: number, cfg: RaceBalanceConfig, executionBonus: (runner: RaceRunnerInput) => number): Runner {
  const race = run.raceDefinitionSnapshot
  const D = race.distance
  const values = runner.horseSnapshot.values
  const jockey = runner.jockeySnapshot
  const rng = createRng(`${run.raceSeed}:v3:${race.id}:${runner.horseSnapshot.id}`)
  const distanceKey = D <= 1400 ? '단거리' : D <= 1600 ? '마일' : '중거리'
  const severity = healthSeverity(runner.horseSnapshot.health)
  const injury = cfg.injury[severity] ?? { maxSpeed: 1, accel: 1, drain: 1 }
  const preference = cfg.tactics[runner.tactic] ?? cfg.tactics['선입']
  const baseExecution = clamp(cfg.execution.base + (values.intelligence - cfg.execution.refIntelligence) * cfg.execution.perIntelligence + (jockey.stability - 75) * cfg.execution.perStability + (jockey.pace - 75) * cfg.execution.perPace, cfg.execution.min, cfg.execution.max)
  const bonus = executionBonus(runner)
  const execution = bonus === 0 ? baseExecution : clamp(baseExecution + bonus, cfg.execution.min, cfg.execution.max)
  const guts = clamp(cfg.energy.gutsBase + (values.guts - cfg.energy.refGuts) * cfg.energy.gutsPerPoint, 0, cfg.energy.gutsMax)
  const spacing = Math.min(cfg.track.laneSpacingM, (cfg.track.halfWidthM * 2 - 2) / Math.max(1, count - 1))
  const laneInitial = (gate - (count - 1) / 2) * spacing
  const surface = cfg.aptitude.speedMultiplier[gradeOf(runner, '잔디')] ?? 1
  return {
    progressM: 0,
    lateralM: laneInitial,
    actualSpeedMps: 0,
    targetSpeedMps: 0,
    effectiveMaxSpeedMps: 0,
    energy: cfg.energy.start,
    blocked: false,
    sprintState: 'none',
    id: runner.horseSnapshot.id,
    index,
    tactic: runner.tactic,
    preference,
    rng,
    baseMaxMps: cfg.speed.baseMps + (values.speed - cfg.speed.refPoint) * cfg.speed.perPoint,
    formMps: (rng() - 0.5) * cfg.speed.formSpreadMps,
    conditionMps: (Math.max(0, values.fatigue - cfg.speed.conditionFreePoints) + Math.max(0, values.bodyLoad - cfg.speed.conditionFreePoints)) * cfg.speed.conditionMpsPerPoint,
    distanceMultiplier: (cfg.aptitude.speedMultiplier[gradeOf(runner, distanceKey)] ?? 1) * surface,
    injuryMaxSpeed: injury.maxSpeed,
    injuryDrain: injury.drain,
    accelMps2: (cfg.accel.base + (values.power - cfg.accel.refPower) * cfg.accel.perPower) * injury.accel,
    staminaEfficiency: 1 + (values.stamina - cfg.energy.refStamina) * cfg.energy.staminaPerPoint,
    gutsMitigation: guts,
    execution,
    tacticExecution: cfg.aptitude.tacticExecution[gradeOf(runner, runner.tactic)] ?? 1,
    startDelayTicks: Math.round(clamp(cfg.start.delayBaseTicks - (jockey.start - 75) * cfg.start.perJockeyStart, 0, cfg.start.maxDelayTicks)),
    startBoost: 1 + (jockey.start - 75) * cfg.accel.startBoostPerJockey,
    noiseAmp: clamp(cfg.noise.base + (1 - execution) * cfg.noise.perMissingExecution, cfg.noise.min, cfg.noise.max),
    noise: 0,
    noiseGoal: 0,
    reactTicks: Math.max(cfg.path.reactMinTicks, Math.round(cfg.path.reactBaseTicks - (jockey.path - 75) * cfg.path.reactPerPath - (values.intelligence - cfg.execution.refIntelligence) * cfg.path.reactPerIntelligence)),
    steerMps: (cfg.path.steerBase + (jockey.path - 75) * cfg.path.steerPerPath) * (0.7 + 0.3 * execution),
    sprintSkill: (jockey.timing - 75) * cfg.sprint.perTiming + (values.intelligence - cfg.execution.refIntelligence) * cfg.sprint.perIntelligence,
    kick: (jockey.timing - 75) * cfg.sprint.kickPerTiming,
    blockedTicks: 0,
    laneInitial,
    laneGoal: laneInitial,
    goalHoldTicks: 0,
    finishTime: null,
  }
}

export function simulateRaceCore(run: RaceRunInput, cfg: RaceBalanceConfig, executionBonus: (runner: RaceRunnerInput) => number = () => 0): RaceSimulationLog {
  const race = run.raceDefinitionSnapshot
  const D = race.distance
  const n = run.runners.length
  const dt = cfg.tickSeconds
  const railLimit = cfg.track.halfWidthM - cfg.track.railMarginM
  const railTarget = -railLimit + 0.4
  const gateOrder = run.runners.map((runner, index) => ({ index, key: hashText(`${run.raceSeed}:gate:${runner.horseSnapshot.id}`) })).sort((a, b) => a.key - b.key || a.index - b.index)
  const gates = new Map(gateOrder.map((entry, gate) => [entry.index, gate]))
  const states = run.runners.map((runner, index) => createRunner(run, runner, index, gates.get(index)!, n, cfg, executionBonus))
  const nameOf = new Map(run.runners.map(runner => [runner.horseSnapshot.id, runner.horseSnapshot.name]))
  const player = states.find(state => state.id === run.playerHorseId)!
  const frontPressure = states.reduce((sum, state) => sum + (state.tactic === '도주' ? 1 : state.tactic === '선행' ? 0.6 : 0), 0) / n

  const drainRate = (runner: Runner, speed: number) => cfg.energy.drainPerSecond * Math.pow(speed / cfg.energy.refSpeedMps, cfg.energy.exponent) * runner.injuryDrain / runner.staminaEfficiency

  const samples: RaceSample[] = []
  const events: InternalRaceEvent[] = [{ id: 'start', tMs: 0, type: 'START', horseId: player.id, distance: D }]
  const phaseMarkers: PhaseMarker[] = [{ phase: 'START', tMs: 0, distance: D }]
  const phaseThresholds: [RacePhase, number][] = [['MID', 0.25], ['FINAL_CORNER', 0.62], ['STRETCH', 0.8]]
  let nextPhase = 0
  let lastOvertakeMs = -100000
  let lastBlockedMs = -100000
  const behind = new Set<string>()
  const passing = new Map<string, number>()

  const takeSample = (tMs: number) => samples.push({ tMs, runners: states.map(state => ({ horseId: state.id, distance: round1(Math.min(D, state.progressM)), lane: round1(state.lateralM / cfg.track.halfWidthM * 40) })) })
  takeSample(0)

  const rankOfPlayer = () => 1 + states.filter(other => other !== player && (other.progressM > player.progressM || (other.progressM === player.progressM && other.index < player.index))).length
  let previousBlockedTicks = 0
  let sprintAnnounced = false
  const trackPlayerEvents = (nextMs: number) => {
    const remaining = round1(D - player.progressM)
    if (player.blockedTicks === cfg.events.blockedAfterTicks && nextMs - lastBlockedMs >= cfg.events.blockedSpacingMs) {
      lastBlockedMs = nextMs
      events.push({ id: `blocked-${nextMs}`, tMs: nextMs, type: 'BLOCKED', horseId: player.id, distance: remaining })
    }
    if (previousBlockedTicks >= cfg.events.clearAfterTicks && player.blockedTicks === 0) events.push({ id: `clear-${nextMs}`, tMs: nextMs, type: 'PATH_CLEAR', horseId: player.id, distance: remaining })
    previousBlockedTicks = player.blockedTicks
    if (!sprintAnnounced && player.sprintState === 'active') {
      sprintAnnounced = true
      events.push({ id: `sprint-${nextMs}`, tMs: nextMs, type: 'SPRINT_START', horseId: player.id, distance: remaining })
    }
    for (const other of states) {
      if (other === player || other.finishTime !== null) continue
      const gap = player.progressM - other.progressM
      if (gap < -cfg.overtake.marginM) { behind.add(other.id); passing.delete(other.id) }
      else if (gap > cfg.overtake.marginM && behind.has(other.id)) {
        const held = (passing.get(other.id) ?? 0) + 1
        if (held >= cfg.overtake.holdTicks) {
          behind.delete(other.id)
          passing.delete(other.id)
          if (nextMs - lastOvertakeMs >= cfg.overtake.minSpacingMs) {
            lastOvertakeMs = nextMs
            events.push({ id: `overtake-${nextMs}`, tMs: nextMs, type: 'OVERTAKE', horseId: player.id, relatedHorseId: other.id, distance: remaining, rank: rankOfPlayer() })
          }
        } else passing.set(other.id, held)
      } else passing.delete(other.id)
    }
  }

  for (let tick = 0; tick < cfg.maxTicks; tick++) {
    const t = tick * dt
    const tMs = Math.round(t * 1000)
    const snap = states.map(state => ({ p: state.progressM, l: state.lateralM, v: state.actualSpeedMps, done: state.finishTime !== null }))
    const order = snap.map((_, i) => i).sort((a, b) => snap[b].p - snap[a].p || a - b)
    const rankFraction = new Array<number>(n)
    order.forEach((i, position) => { rankFraction[i] = n === 1 ? 0.5 : position / (n - 1) })
    const isAhead = (j: number, i: number) => snap[j].p > snap[i].p || (snap[j].p === snap[i].p && j < i)
    const nearestAhead = (i: number, lateral: number, maxGap: number) => {
      let best = -1
      let bestGap = Infinity
      for (let j = 0; j < n; j++) {
        if (j === i || snap[j].done || !isAhead(j, i)) continue
        if (Math.abs(snap[j].l - lateral) >= cfg.block.lateralClearM) continue
        const gap = snap[j].p - snap[i].p - cfg.track.horseLengthM
        if (gap < bestGap && gap <= maxGap) { best = j; bestGap = gap }
      }
      return { index: best, gap: bestGap }
    }
    const occupied = (i: number, lateral: number) => {
      for (let j = 0; j < n; j++) {
        if (j === i || snap[j].done) continue
        if (Math.abs(snap[j].p - snap[i].p) < cfg.path.sideWindowM && Math.abs(snap[j].l - lateral) < cfg.block.lateralClearM) return true
      }
      return false
    }

    const next = states.map(state => ({ v: state.actualSpeedMps, p: state.progressM, l: state.lateralM, e: state.energy }))
    states.forEach((s, i) => {
      const r1 = s.rng()
      s.rng()
      if (s.finishTime !== null) { next[i].v = Math.max(0, s.actualSpeedMps - cfg.accel.decel * dt); return }
      if (tick % cfg.noise.periodTicks === 0) s.noiseGoal = (r1 - 0.5) * 2 * s.noiseAmp
      s.noise += (s.noiseGoal - s.noise) * cfg.noise.smoothing
      if (tick < s.startDelayTicks) { s.targetSpeedMps = 0; s.blocked = false; return }

      const remaining = D - snap[i].p
      const progress = snap[i].p / D
      const effMax = (s.baseMaxMps + s.formMps) * s.distanceMultiplier * s.injuryMaxSpeed - s.conditionMps
      s.effectiveMaxSpeedMps = effMax

      const sprintSpeed = effMax * (cfg.speed.sprintFraction + s.preference.sprintBoost)
      if (s.sprintState === 'none' && remaining <= s.preference.sprintRemainingM + cfg.sprint.prepareExtraM) s.sprintState = 'prepare'
      if (s.sprintState === 'prepare') {
        const margin = clamp(1 + Math.max(0, cfg.sprint.marginSkillFree - s.sprintSkill), 1, cfg.sprint.maxMargin)
        const perMeter = drainRate(s, sprintSpeed) / sprintSpeed
        const affordable = s.energy / (perMeter * margin)
        if (remaining <= clamp(affordable, cfg.sprint.forceRemainingM, s.preference.sprintRemainingM)) s.sprintState = 'active'
      }

      const cruiseSpeed = effMax * cfg.speed.cruiseFraction
      const needed = remaining / cruiseSpeed * drainRate(s, cruiseSpeed) * cfg.pace.sprintReserve
      const surplus = (s.energy - needed) / cfg.energy.start
      const planned = clamp(surplus * cfg.pace.adaptGain, -cfg.pace.maxEase, cfg.pace.maxPush)
      const paceAdjust = (planned > 0 ? planned * s.execution : planned * (0.4 + 0.6 * s.execution)) + (progress < 0.5 ? (1 - s.execution) * cfg.pace.overpaceBias : 0)

      let fraction: number
      if (s.sprintState === 'active') fraction = cfg.speed.sprintFraction + s.preference.sprintBoost + s.kick
      else {
        fraction = cfg.speed.cruiseFraction + paceAdjust
        if (s.sprintState === 'none') {
          const weight = progress < cfg.position.earlyEnd ? 1 : progress < cfg.position.midEnd ? cfg.position.midWeight : 0
          const preferred = progress < cfg.position.earlyEnd ? s.preference.early : progress < cfg.position.midEnd ? s.preference.mid : s.preference.late
          fraction += clamp((rankFraction[i] - preferred) * s.preference.positionGain * s.execution * s.tacticExecution, -cfg.position.maxEase, cfg.position.maxPush) * weight
          fraction += cfg.pace.pressureSlope * (frontPressure - cfg.pace.pressureNeutral) * s.preference.paceExposure * Math.max(0, 1 - progress / cfg.pace.pressureEndProgress)
        }
      }
      let target = effMax * fraction + s.noise

      const lowRatio = s.energy / cfg.energy.start
      if (lowRatio < cfg.energy.lowRatio) {
        const penalty = cfg.energy.lowPenalty * (1 - lowRatio / cfg.energy.lowRatio) * (1 - s.gutsMitigation)
        target = Math.max(effMax * cfg.energy.floorFraction, target * (1 - penalty))
      }
      target = Math.max(0, target)

      const lookAhead = cfg.block.lookAheadBaseM + cfg.block.lookAheadPerMps * snap[i].v
      const front = nearestAhead(i, snap[i].l, lookAhead)
      let blocked = false
      if (front.index >= 0) {
        const allowed = snap[front.index].v + (front.gap - cfg.block.minGapM) * cfg.block.followGain
        if (allowed < target - cfg.block.releaseMps) { target = Math.max(0, allowed); blocked = true }
      }
      s.targetSpeedMps = target
      s.blockedTicks = blocked ? s.blockedTicks + 1 : 0
      s.blocked = blocked

      if (blocked && s.blockedTicks >= s.reactTicks) {
        const here = nearestAhead(i, snap[i].l, cfg.path.scanAheadM).gap
        let choice: { lateral: number; gap: number } | null = null
        for (const dir of [-1, 1]) {
          const lateral = clamp(snap[i].l + dir * cfg.path.stepM, -railLimit, railLimit)
          if (Math.abs(lateral - snap[i].l) < 0.3 || occupied(i, lateral)) continue
          const gap = nearestAhead(i, lateral, cfg.path.scanAheadM).gap
          if (gap > here + cfg.path.switchMarginM && (!choice || gap > choice.gap || (gap === choice.gap && r1 < 0.5))) choice = { lateral, gap }
        }
        if (choice) { s.laneGoal = choice.lateral; s.goalHoldTicks = 25 }
      }
      if (s.goalHoldTicks > 0) s.goalHoldTicks -= 1
      else {
        const settle = clamp((progress - cfg.path.settleStartProgress) / (cfg.path.settleEndProgress - cfg.path.settleStartProgress), 0, 1)
        s.laneGoal = s.laneInitial + (railTarget - s.laneInitial) * s.preference.railBias * settle
      }
      const step = clamp(s.laneGoal - snap[i].l, -s.steerMps * dt, s.steerMps * dt)
      const lateral = clamp(snap[i].l + step, -railLimit, railLimit)
      next[i].l = Math.abs(step) > 0 && occupied(i, lateral) ? snap[i].l : lateral

      const gapToTarget = target - snap[i].v
      const reaccel = gapToTarget > cfg.accel.reaccelGapMps && snap[i].p > cfg.accel.startZoneM ? cfg.accel.reaccelFactor : 1
      const startPush = snap[i].p < cfg.accel.startZoneM ? s.startBoost : 1
      const taper = 1 - cfg.accel.taper * clamp(snap[i].v / Math.max(1, target), 0, 1)
      const change = clamp(gapToTarget, -cfg.accel.decel * dt, s.accelMps2 * reaccel * startPush * taper * dt)
      next[i].v = Math.max(0, snap[i].v + change)

      const draft = front.index >= 0 && front.gap <= cfg.energy.draftGapM && snap[front.index].v >= snap[i].v * 0.97 ? cfg.energy.draftMultiplier : 1
      const accelCost = cfg.energy.accelDrain * Math.max(0, change / dt)
      next[i].e = Math.max(0, s.energy - (drainRate(s, Math.max(next[i].v, 0.1)) * draft + accelCost) * dt)
      next[i].p = snap[i].p + (snap[i].v + next[i].v) / 2 * dt
    })

    for (const [i, s] of states.entries()) {
      s.actualSpeedMps = next[i].v
      s.energy = next[i].e
      s.lateralM = next[i].l
      if (s.finishTime !== null) continue
      const before = snap[i].p
      const after = next[i].p
      if (after >= D) {
        s.finishTime = t + dt * (D - before) / Math.max(0.0001, after - before)
        s.progressM = D
      } else s.progressM = after
    }

    const nextMs = Math.round((tick + 1) * dt * 1000)
    const leader = Math.max(...states.map(state => state.progressM))
    while (nextPhase < phaseThresholds.length && leader >= phaseThresholds[nextPhase][1] * D) {
      phaseMarkers.push({ phase: phaseThresholds[nextPhase][0], tMs: nextMs, distance: round1(D - leader) })
      nextPhase += 1
    }

    if (player.finishTime === null) trackPlayerEvents(nextMs)

    if ((tick + 1) % cfg.samplesEveryTicks === 0) {
      takeSample(nextMs)
      if (states.every(state => state.finishTime !== null)) break
    }
  }

  const finishOrderStates = states.slice().sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || a.index - b.index)
  const winnerTime = finishOrderStates[0].finishTime ?? 0
  const PRIZE_SHARES = [1, 0.4, 0.25, 0.15, 0.1]
  const finishOrder: FinishRecord[] = finishOrderStates.map((state, i) => ({
    horseId: state.id,
    horseName: nameOf.get(state.id)!,
    placing: i + 1,
    finishTime: round2(state.finishTime ?? cfg.maxTicks * dt),
    marginToWinner: round2((state.finishTime ?? cfg.maxTicks * dt) - winnerTime),
    prizeMoney: Math.round(race.prize * (PRIZE_SHARES[i] ?? 0)),
  }))
  for (const record of finishOrder) events.push({ id: `finish-${record.horseId}`, tMs: Math.round(record.finishTime * 1000), type: 'FINISH', horseId: record.horseId, distance: 0, rank: record.placing })
  events.sort((a, b) => a.tMs - b.tMs)
  phaseMarkers.push({ phase: 'FINISH', tMs: Math.round(finishOrder[0].finishTime * 1000), distance: 0 })
  const playerRecord = finishOrder.find(record => record.horseId === player.id)!
  const playerName = nameOf.get(player.id)!
  const highlights: RaceHighlight[] = []
  for (const event of events) {
    const id = `highlight-${event.id}`
    if (event.type === 'START') highlights.push({ id, tMs: event.tMs, type: event.type, priority: 1, templateKey: 'race.start', values: { horseName: playerName, gate: (gates.get(player.index) ?? 0) + 1 } })
    else if (event.type === 'BLOCKED') highlights.push({ id, tMs: event.tMs, type: event.type, priority: 3, templateKey: 'race.blocked.player', values: { horseName: playerName } })
    else if (event.type === 'PATH_CLEAR') highlights.push({ id, tMs: event.tMs, type: event.type, priority: 3, templateKey: 'race.pathClear.player', values: { horseName: playerName } })
    else if (event.type === 'OVERTAKE') highlights.push({ id, tMs: event.tMs, type: event.type, priority: 4, templateKey: 'race.overtake.player', values: { horseName: playerName, rank: event.rank ?? 0, rivalName: event.relatedHorseId ? nameOf.get(event.relatedHorseId) ?? '' : '' } })
    else if (event.type === 'SPRINT_START') highlights.push({ id, tMs: event.tMs, type: event.type, priority: 3, templateKey: 'race.sprint.player', values: { horseName: playerName } })
    else if (event.type === 'FINISH' && event.horseId === player.id) highlights.push({ id, tMs: event.tMs, type: event.type, priority: 5, templateKey: 'race.finish.player', values: { horseName: playerName, placing: playerRecord.placing, finishTime: playerRecord.finishTime } })
    else if (event.type === 'FINISH' && event.rank === 1) highlights.push({ id, tMs: event.tMs, type: event.type, priority: 4, templateKey: 'race.finish.winner', values: { horseName: finishOrder[0].horseName, finishTime: finishOrder[0].finishTime } })
  }
  return {
    raceRunId: run.raceRunId,
    engineVersion: cfg.version,
    seed: run.raceSeed,
    raceDistance: D,
    durationMs: samples[samples.length - 1].tMs,
    samples,
    events,
    highlights,
    phaseMarkers,
    finishOrder,
    result: { playerHorseId: run.playerHorseId, placing: playerRecord.placing, finishTime: playerRecord.finishTime, marginToWinner: playerRecord.marginToWinner, prizeMoney: playerRecord.prizeMoney },
  }
}
