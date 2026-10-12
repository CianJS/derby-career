import { frameAt, type InternalRaceEvent, type RaceFrame, type RacePhase, type RaceSimulationLog } from './race-simulation'

/**
 * Spectator-only derivations. Everything here READS the stored simulation log at or before the
 * requested playback time. Nothing re-simulates, nothing looks ahead, and nothing is written back.
 */

export const LOOKBACK_MS = 3000
const GAP_MOMENTS_FROM_MS = 6000
const TREND_MIN_M = 1
const CLOSE_GAP_M = 2
const NEAR_GAP_M = 8
const FINISH_ZONE_M = 150
const RECENT_EVENT_MS = 3000
const SPECTATE_EVENTS: InternalRaceEvent['type'][] = ['OVERTAKE', 'BLOCKED', 'PATH_CLEAR', 'SPRINT_START']

export type Neighbor = { horseId: string; gap: number }
export type PlayerSituation = {
  rank: number
  total: number
  /** Meters the player still has to run. */
  remaining: number
  finished: boolean
  ahead: Neighbor | null
  behind: Neighbor | null
}

export function situationFrom(frame: RaceFrame, playerHorseId: string, raceDistance: number): PlayerSituation {
  const index = frame.runners.findIndex(runner => runner.horseId === playerHorseId)
  const player = frame.runners[index]
  const finished = player.finished
  const above = frame.runners[index - 1]
  const below = frame.runners[index + 1]
  const gapTo = (distance: number) => Math.round(Math.abs(distance - player.distance) * 10) / 10
  return {
    rank: player.rank,
    total: frame.runners.length,
    remaining: Math.max(0, Math.round(raceDistance - player.distance)),
    finished,
    ahead: !finished && above && !above.finished ? { horseId: above.horseId, gap: gapTo(above.distance) } : null,
    behind: !finished && below && !below.finished ? { horseId: below.horseId, gap: gapTo(below.distance) } : null,
  }
}

export type RaceAnalysis = {
  tMs: number
  phase: RacePhase
  frame: RaceFrame
  now: PlayerSituation
  /** Positive = moved up, negative = dropped, relative to LOOKBACK_MS ago. 0 when there is no earlier frame to compare. */
  rankDelta: number
  previousRank: number | null
  /** Meters closed on the current horse ahead over the lookback window. Positive = closing in. */
  aheadTrend: number | null
  /** Meters the horse right behind closed on the player over the lookback window. Positive = it is catching up. */
  behindTrend: number | null
  leaderChanged: boolean
  recentEvent: InternalRaceEvent | null
  phaseAgeMs: number
}

export function analyzeRace(log: RaceSimulationLog, tMs: number, playerHorseId: string): RaceAnalysis {
  const frame = frameAt(log, tMs)
  const time = frame.tMs
  const now = situationFrom(frame, playerHorseId, log.raceDistance)
  const past = time >= LOOKBACK_MS ? frameAt(log, time - LOOKBACK_MS) : null
  const distanceOf = (target: RaceFrame, horseId: string) => target.runners.find(runner => runner.horseId === horseId)!.distance
  const playerThen = past ? distanceOf(past, playerHorseId) : 0
  const aheadTrend = past && now.ahead ? distanceOf(past, now.ahead.horseId) - playerThen - now.ahead.gap : null
  const behindTrend = past && now.behind ? now.behind.gap - (playerThen - distanceOf(past, now.behind.horseId)) : null
  const previousRank = past ? past.runners.find(runner => runner.horseId === playerHorseId)!.rank : null
  const recentEvent = [...log.events].reverse().find(event => SPECTATE_EVENTS.includes(event.type) && event.tMs <= time && time - event.tMs <= RECENT_EVENT_MS) ?? null
  const marker = log.phaseMarkers.filter(item => item.tMs <= time).at(-1) ?? log.phaseMarkers[0]
  return {
    tMs: time,
    phase: frame.phase,
    frame,
    now,
    rankDelta: previousRank === null ? 0 : previousRank - now.rank,
    previousRank,
    aheadTrend: aheadTrend === null ? null : Math.round(-aheadTrend * 10) / 10,
    behindTrend: behindTrend === null ? null : Math.round(-behindTrend * 10) / 10,
    leaderChanged: !!past && past.runners[0].horseId !== frame.runners[0].horseId,
    recentEvent,
    phaseAgeMs: time - marker.tMs,
  }
}

export type MomentKind = 'EVENT' | 'LEAD_CHANGE' | 'RANK_UP' | 'RANK_DOWN' | 'CLOSING' | 'CHASED'
export type Moment = { kind: MomentKind; label: string }
const EVENT_LABEL: Partial<Record<InternalRaceEvent['type'], string>> = { OVERTAKE: '추월', BLOCKED: '진로 막힘', PATH_CLEAR: '진로 확보', SPRINT_START: '스퍼트' }

/** A moment exists only when the stored positions or events say so. Reaching a phase alone never counts. */
export function momentOf(analysis: RaceAnalysis): Moment | null {
  const { now, recentEvent } = analysis
  if (now.finished) return null
  if (recentEvent) return { kind: 'EVENT', label: EVENT_LABEL[recentEvent.type] ?? '주요 상황' }
  if (analysis.leaderChanged) return { kind: 'LEAD_CHANGE', label: '선두 교체' }
  if (analysis.rankDelta > 0) return { kind: 'RANK_UP', label: '순위 상승' }
  if (analysis.rankDelta < 0) return { kind: 'RANK_DOWN', label: '순위 하락' }
  if (analysis.tMs < GAP_MOMENTS_FROM_MS) return null
  const { ahead, behind } = now
  if (ahead && (ahead.gap <= CLOSE_GAP_M || (analysis.aheadTrend !== null && analysis.aheadTrend >= TREND_MIN_M && ahead.gap <= NEAR_GAP_M))) return { kind: 'CLOSING', label: '앞말 근접' }
  if (behind && (behind.gap <= CLOSE_GAP_M || (analysis.behindTrend !== null && analysis.behindTrend >= TREND_MIN_M && behind.gap <= NEAR_GAP_M))) return { kind: 'CHASED', label: '뒷말 근접' }
  return null
}

export const AUTO_SPEEDS = [1, 2, 4, 8] as const
export type AutoSpeed = typeof AUTO_SPEEDS[number]

/** Speed the situation asks for. The controller below decides whether to actually switch. */
export function desiredAutoSpeed(analysis: RaceAnalysis): AutoSpeed {
  const { now, phase } = analysis
  if (now.finished) return 4
  const nearFinish = Math.min(now.remaining, analysis.frame.remaining) <= FINISH_ZONE_M
  if (phase === 'STRETCH' && nearFinish) return 1
  if (phase === 'STRETCH' || phase === 'FINAL_CORNER') return 2
  if (momentOf(analysis)) return 2
  return phase === 'START' ? 4 : 8
}

export const AUTO_CONFIRM_MS = 400
export const AUTO_MIN_HOLD_MS = 1500
export type AutoState = { speed: AutoSpeed; since: number; pending: AutoSpeed | null; pendingSince: number }
export const initialAuto = (now: number, speed: AutoSpeed = 4): AutoState => ({ speed, since: now, pending: null, pendingSince: now })

/** A new speed must be asked for continuously for AUTO_CONFIRM_MS and the current one must have run for AUTO_MIN_HOLD_MS. */
export function stepAuto(state: AutoState, desired: AutoSpeed, now: number): AutoState {
  if (desired === state.speed) return state.pending === null ? state : { ...state, pending: null }
  if (state.pending !== desired) return { ...state, pending: desired, pendingSince: now }
  if (now - state.pendingSince >= AUTO_CONFIRM_MS && now - state.since >= AUTO_MIN_HOLD_MS) return { speed: desired, since: now, pending: null, pendingSince: now }
  return state
}

export const STRIP_MARKER_REM = 1.1
export const STRIP_MARKER_DX = 0.014
/** Strip height grows with the field so every runner keeps a vertical slot once the pack bunches up. */
export const stripHeightRem = (runners: number) => Math.min(24, Math.max(11, runners * 1.45))

export type MarkerSpot = { id: string; x: number; y: number }

/**
 * Vertical overlap avoidance. Markers whose x values chain within minDx form a cluster; each cluster is sorted by its
 * preferred y and pushed apart to at least minDy with the smallest total movement (isotonic regression on y - i * minDy),
 * then shifted into [yMin, yMax]. x is never changed. A cluster taller than the strip is compressed evenly.
 */
export function spreadMarkers(items: MarkerSpot[], minDx: number, minDy: number, yMin = 0.08, yMax = 0.92): Map<string, number> {
  const result = new Map<string, number>()
  const byX = items.map((item, order) => ({ ...item, order })).sort((a, b) => a.x - b.x || a.order - b.order)
  const clusters: typeof byX[] = []
  for (const item of byX) {
    const last = clusters[clusters.length - 1]
    if (last && item.x - last[last.length - 1].x < minDx) last.push(item)
    else clusters.push([item])
  }
  for (const cluster of clusters) {
    const sorted = cluster.slice().sort((a, b) => a.y - b.y || a.order - b.order)
    const blocks: { sum: number; count: number }[] = []
    sorted.forEach((item, i) => {
      blocks.push({ sum: Math.min(yMax, Math.max(yMin, item.y)) - i * minDy, count: 1 })
      while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].count > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count) {
        const top = blocks.pop()!
        blocks[blocks.length - 1].sum += top.sum
        blocks[blocks.length - 1].count += top.count
      }
    })
    const ys = blocks.flatMap(block => Array(block.count).fill(block.sum / block.count) as number[]).map((q, i) => q + i * minDy)
    const span = ys[ys.length - 1] - ys[0]
    const room = yMax - yMin
    const squeeze = span > room ? room / span : 1
    let offset = 0
    const low = ys[0]
    const high = low + span * squeeze
    if (low < yMin) offset = yMin - low
    else if (high > yMax) offset = yMax - high
    sorted.forEach((item, i) => result.set(item.id, low + (ys[i] - low) * squeeze + offset))
  }
  return result
}

export function stripLayout(frame: RaceFrame, raceDistance: number, playerHorseId: string, gateOf: Map<string, number>, minDx: number, minDy: number): Map<string, { x: number; y: number }> {
  const items = frame.runners
    .map(runner => ({ id: runner.horseId, x: Math.min(1, Math.max(0, runner.distance / raceDistance)), y: (runner.lane + 40) / 80 }))
    .sort((a, b) => (a.id === playerHorseId ? -1 : 0) - (b.id === playerHorseId ? -1 : 0) || (gateOf.get(a.id) ?? 0) - (gateOf.get(b.id) ?? 0))
  const ys = spreadMarkers(items, minDx, minDy)
  return new Map(items.map(item => [item.id, { x: item.x, y: ys.get(item.id)! }]))
}
