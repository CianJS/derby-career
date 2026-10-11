import type { RaceRunInput, RaceRunnerInput } from './race-entry'

export const SIMULATION_ENGINE_VERSION = 'race-sim-v1'
export type RacePhase = 'START' | 'MID' | 'FINAL_CORNER' | 'STRETCH' | 'FINISH'
export type RaceSample = { tMs: number; runners: { horseId: string; distance: number; lane: number }[] }
export type InternalRaceEvent = { id: string; tMs: number; type: 'START' | 'BLOCKED' | 'PATH_CLEAR' | 'OVERTAKE' | 'SPRINT_START' | 'FINISH'; horseId?: string; relatedHorseId?: string; distance: number; rank?: number }
export type RaceHighlight = { id: string; tMs: number; type: InternalRaceEvent['type']; priority: number; templateKey: string; values: Record<string, string | number> }
export type PhaseMarker = { phase: RacePhase; tMs: number; distance: number }
export type FinishRecord = { horseId: string; horseName: string; placing: number; finishTime: number; marginToWinner: number; prizeMoney: number }
export type RaceSimulationResult = { playerHorseId: string; placing: number; finishTime: number; marginToWinner: number; prizeMoney: number }
export type RaceSimulationLog = {
  raceRunId: string
  engineVersion: string
  seed: string
  raceDistance: number
  durationMs: number
  samples: RaceSample[]
  events: InternalRaceEvent[]
  highlights: RaceHighlight[]
  phaseMarkers: PhaseMarker[]
  finishOrder: FinishRecord[]
  result: RaceSimulationResult
}
export type RaceSimulationSummary = { engineVersion: string; digest: string; durationMs: number; result: RaceSimulationResult }

const STEP_SECONDS = 0.25
const STEPS_PER_SAMPLE = 4
const PRIZE_SHARES = [1, 0.4, 0.25, 0.15, 0.1]
const GRADE_BONUS: Record<string, number> = { A: 0.18, B: 0.06, C: -0.08, D: -0.25 }
const EARLY_BONUS: Record<string, number> = { 도주: 0.55, 선행: 0.3, 선입: -0.1, 추입: -0.35 }
const MID_BONUS: Record<string, number> = { 도주: 0.1, 선행: 0.1, 선입: 0, 추입: -0.05 }
const LATE_BONUS: Record<string, number> = { 도주: -0.4, 선행: -0.1, 선입: 0.2, 추입: 0.5 }

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

type RunnerState = {
  id: string
  index: number
  base: number
  tactic: string
  stamina: number
  required: number
  jockeyStart: number
  jockeyTiming: number
  noiseAmp: number
  blockProbability: number
  rng: () => number
  noise: number
  drift: number
  laneOrigin: number
  latch: number
  blockedSince: number | null
  distance: number
  speed: number
  finishTime: number | null
}

function createRunnerState(run: RaceRunInput, runner: RaceRunnerInput, index: number, gate: number): RunnerState {
  const D = run.raceDefinitionSnapshot.distance
  const rng = createRng(`${run.raceSeed}:${run.raceDefinitionSnapshot.id}:${runner.horseSnapshot.id}`)
  const values = runner.horseSnapshot.values
  const distanceKey = D <= 1400 ? '단거리' : D <= 1600 ? '마일' : '중거리'
  const form = (rng() - 0.5) * 0.5
  const condition = Math.max(0, values.fatigue - 30) * 0.01 + Math.max(0, values.bodyLoad - 30) * 0.01
  const base = 14.6 + values.speed * 0.002 + values.power * 0.0008 + (GRADE_BONUS[gradeOf(runner, distanceKey)] ?? 0) + (GRADE_BONUS[gradeOf(runner, runner.tactic)] ?? 0) * 0.6 + form - condition
  const jockey = runner.jockeySnapshot
  return {
    id: runner.horseSnapshot.id,
    index,
    base,
    tactic: runner.tactic,
    stamina: values.stamina + (values.guts - 450) * 0.3 + (jockey.pace - 75) * 0.4,
    required: 400 + D * 0.06,
    jockeyStart: (jockey.start - 75) * 0.004,
    jockeyTiming: (jockey.timing - 75) * 0.003,
    noiseAmp: clamp(0.22 - (values.intelligence - 480) * 0.0003 - (jockey.stability - 75) * 0.0012, 0.08, 0.3),
    blockProbability: clamp(0.55 - (jockey.path - 75) * 0.01, 0.1, 0.8),
    rng,
    noise: 0,
    drift: 0,
    laneOrigin: (gate - 5.5) / 5.5 * 36,
    latch: 0,
    blockedSince: null,
    distance: 0,
    speed: 0,
    finishTime: null,
  }
}

function targetSpeed(state: RunnerState, progress: number): number {
  const early = progress < 0.4 ? EARLY_BONUS[state.tactic] ?? 0 : progress < 0.7 ? MID_BONUS[state.tactic] ?? 0 : LATE_BONUS[state.tactic] ?? 0
  const lateness = Math.max(0, (progress - 0.6) / 0.4)
  const fade = Math.max(0, state.required - state.stamina) * 0.004 * lateness
  const startBoost = progress < 0.15 ? state.jockeyStart : 0
  const kick = progress > 0.7 ? state.jockeyTiming : 0
  return state.base + early + startBoost + kick - fade + state.noise
}

export function raceLogDigest(log: RaceSimulationLog): string {
  return hashText(JSON.stringify(log)).toString(36)
}
export function summarizeRaceLog(log: RaceSimulationLog): RaceSimulationSummary {
  return { engineVersion: log.engineVersion, digest: raceLogDigest(log), durationMs: log.durationMs, result: log.result }
}

export function simulateRace(run: RaceRunInput): RaceSimulationLog {
  const race = run.raceDefinitionSnapshot
  const D = race.distance
  const n = run.runners.length
  const gateOrder = run.runners.map((runner, index) => ({ index, key: hashText(`${run.raceSeed}:gate:${runner.horseSnapshot.id}`) })).sort((a, b) => a.key - b.key || a.index - b.index)
  const gates = new Map(gateOrder.map((entry, gate) => [entry.index, gate]))
  const states = run.runners.map((runner, index) => createRunnerState(run, runner, index, n === 1 ? 5.5 : (gates.get(index)! * 11) / (n - 1)))
  const nameOf = new Map(run.runners.map(runner => [runner.horseSnapshot.id, runner.horseSnapshot.name]))
  const player = states.find(state => state.id === run.playerHorseId)!
  const samples: RaceSample[] = []
  const events: InternalRaceEvent[] = [{ id: 'start', tMs: 0, type: 'START', horseId: player.id, distance: D }]
  const phaseMarkers: PhaseMarker[] = [{ phase: 'START', tMs: 0, distance: D }]
  const phaseThresholds: [RacePhase, number][] = [['MID', 0.25], ['FINAL_CORNER', 0.62], ['STRETCH', 0.8]]
  let nextPhase = 0
  let sprintStarted = false
  let lastOvertakeMs = -10000
  let lastBlockedMs = -10000
  let previousRank = 0
  let step = 0
  const rankOf = (id: string) => states.slice().sort((a, b) => b.distance - a.distance || a.index - b.index).findIndex(state => state.id === id) + 1

  const takeSample = (tMs: number) => {
    samples.push({ tMs, runners: states.map(state => ({ horseId: state.id, distance: round1(Math.min(D, state.distance)), lane: round1(clamp(state.laneOrigin * (1 - 0.45 * Math.min(1, state.distance / D)) + state.drift, -40, 40)) })) })
  }
  takeSample(0)
  previousRank = rankOf(player.id)

  while (step < 4000) {
    const tMs = Math.round(step * STEP_SECONDS * 1000)
    const t = step * STEP_SECONDS
    for (const state of states) {
      if (step % 8 === 0) state.noise = (state.rng() - 0.5) * 2 * state.noiseAmp
      else state.rng()
      state.drift = state.drift * 0.98 + (state.rng() - 0.5) * 0.8
    }
    const draws = states.map(state => state.rng())
    for (const state of states) state.speed = state.finishTime === null ? targetSpeed(state, state.distance / D) : 0
    const ordered = states.slice().sort((a, b) => b.distance - a.distance || a.index - b.index)
    ordered.forEach((state, position) => {
      if (state.finishTime !== null) return
      const ahead = ordered.slice(0, position).reverse().find(other => other.finishTime === null)
      if (ahead && ahead.distance - state.distance < 2 && ahead.speed < state.speed && draws[state.index] < state.blockProbability && state.latch <= 0) state.latch = 4
      if (state.latch > 0) {
        state.latch -= 1
        if (ahead) state.speed = Math.min(state.speed, ahead.speed)
        if (state.blockedSince === null) state.blockedSince = tMs
      } else if (state.blockedSince !== null) {
        if (state.id === player.id && tMs - state.blockedSince >= 1000) events.push({ id: `clear-${tMs}`, tMs, type: 'PATH_CLEAR', horseId: state.id, distance: round1(D - state.distance) })
        state.blockedSince = null
      }
      if (state.id === player.id && state.blockedSince === tMs && tMs - lastBlockedMs >= 3000) {
        lastBlockedMs = tMs
        events.push({ id: `blocked-${tMs}`, tMs, type: 'BLOCKED', horseId: state.id, distance: round1(D - state.distance) })
      }
    })
    for (const state of states) {
      if (state.finishTime !== null) continue
      const next = state.distance + state.speed * STEP_SECONDS
      if (next >= D) {
        state.finishTime = t + (STEP_SECONDS * (D - state.distance)) / Math.max(0.0001, next - state.distance)
        state.distance = D
      } else state.distance = next
    }
    step += 1
    const nextMs = Math.round(step * STEP_SECONDS * 1000)
    const leader = Math.max(...states.map(state => state.distance))
    while (nextPhase < phaseThresholds.length && leader >= phaseThresholds[nextPhase][1] * D) {
      phaseMarkers.push({ phase: phaseThresholds[nextPhase][0], tMs: nextMs, distance: round1(D - leader) })
      nextPhase += 1
    }
    if (!sprintStarted && player.finishTime === null && player.distance >= 0.75 * D) {
      sprintStarted = true
      events.push({ id: `sprint-${nextMs}`, tMs: nextMs, type: 'SPRINT_START', horseId: player.id, distance: round1(D - player.distance) })
    }
    if (step % STEPS_PER_SAMPLE === 0) {
      takeSample(nextMs)
      if (player.finishTime === null) {
        const rank = rankOf(player.id)
        if (rank < previousRank && nextMs - lastOvertakeMs >= 4000) {
          const passed = states.filter(state => state.id !== player.id && state.distance < player.distance).sort((a, b) => b.distance - a.distance || a.index - b.index)[0]
          lastOvertakeMs = nextMs
          events.push({ id: `overtake-${nextMs}`, tMs: nextMs, type: 'OVERTAKE', horseId: player.id, relatedHorseId: passed?.id, distance: round1(D - player.distance), rank })
        }
        previousRank = rank
      }
      if (states.every(state => state.finishTime !== null)) break
    }
  }

  const finishOrderStates = states.slice().sort((a, b) => a.finishTime! - b.finishTime! || a.index - b.index)
  const winnerTime = finishOrderStates[0].finishTime!
  const finishOrder: FinishRecord[] = finishOrderStates.map((state, i) => ({
    horseId: state.id,
    horseName: nameOf.get(state.id)!,
    placing: i + 1,
    finishTime: round2(state.finishTime!),
    marginToWinner: round2(state.finishTime! - winnerTime),
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
    engineVersion: SIMULATION_ENGINE_VERSION,
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

const highlightTemplates: Record<string, (values: Record<string, string | number>) => string> = {
  'race.start': v => `${v.gate}번 게이트에서 ${v.horseName}이(가) 출발합니다.`,
  'race.blocked.player': v => `${v.horseName}의 앞길이 막혔습니다.`,
  'race.pathClear.player': v => `${v.horseName}이(가) 진로를 확보합니다.`,
  'race.overtake.player': v => `${v.horseName}이(가) ${v.rivalName ? `${v.rivalName}을(를) 제치고 ` : ''}${v.rank}위로 올라섭니다.`,
  'race.sprint.player': v => `${v.horseName}이(가) 직선에서 스퍼트를 시작합니다.`,
  'race.finish.player': v => `${v.horseName}이(가) ${v.placing}착으로 결승선을 통과합니다. (${Number(v.finishTime).toFixed(2)}초)`,
  'race.finish.winner': v => `${v.horseName}이(가) 1착으로 결승선을 통과합니다.`,
}
export const highlightText = (highlight: RaceHighlight) => highlightTemplates[highlight.templateKey]?.(highlight.values) ?? ''

export type FrameRunner = { horseId: string; distance: number; lane: number; rank: number; finished: boolean }
export type RaceFrame = { tMs: number; phase: RacePhase; remaining: number; runners: FrameRunner[] }

export function frameAt(log: RaceSimulationLog, tMs: number): RaceFrame {
  const time = clamp(tMs, 0, log.durationMs)
  let index = 0
  while (index < log.samples.length - 2 && log.samples[index + 1].tMs <= time) index += 1
  const from = log.samples[index]
  const to = log.samples[Math.min(index + 1, log.samples.length - 1)]
  const span = Math.max(1, to.tMs - from.tMs)
  const ratio = clamp((time - from.tMs) / span, 0, 1)
  const placing = new Map(log.finishOrder.map(record => [record.horseId, record]))
  const runners = from.runners.map((runner, i) => {
    const target = to.runners[i]
    const record = placing.get(runner.horseId)!
    const finished = time >= Math.round(record.finishTime * 1000)
    const distance = finished ? log.raceDistance : Math.min(log.raceDistance - 0.1, runner.distance + (target.distance - runner.distance) * ratio)
    return { horseId: runner.horseId, distance, lane: runner.lane + (target.lane - runner.lane) * ratio, rank: 0, finished }
  })
  runners.sort((a, b) => {
    if (a.finished || b.finished) return a.finished && b.finished ? placing.get(a.horseId)!.placing - placing.get(b.horseId)!.placing : a.finished ? -1 : 1
    return b.distance - a.distance
  })
  runners.forEach((runner, i) => { runner.rank = i + 1 })
  const marker = log.phaseMarkers.filter(m => m.tMs <= time).at(-1) ?? log.phaseMarkers[0]
  const leader = runners[0]?.distance ?? 0
  return { tMs: time, phase: marker.phase, remaining: Math.max(0, Math.round(log.raceDistance - leader)), runners }
}

export function validateRaceLog(log: unknown, run: RaceRunInput): asserts log is RaceSimulationLog {
  const value = log as RaceSimulationLog
  if (!value || value.raceRunId !== run.raceRunId || value.seed !== run.raceSeed || value.result?.playerHorseId !== run.playerHorseId || !Array.isArray(value.samples) || value.samples.length < 2 || !Array.isArray(value.finishOrder) || value.finishOrder.length !== run.runners.length || value.samples[0].runners.length !== run.runners.length) throw new Error('저장된 경주 기록이 출전 정보와 일치하지 않습니다.')
  if (run.simulation && raceLogDigest(value) !== run.simulation.digest) throw new Error('저장된 경주 기록이 손상되었습니다.')
}
