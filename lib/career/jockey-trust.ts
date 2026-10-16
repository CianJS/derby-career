import type { Career } from './model'
import type { RaceRunInput, RaceRunnerInput } from './race-entry'
import { simulateRaceV3 } from './race-sim-v3'

export const TRUST_RULE_VERSION = 'jockey-trust-v1' as const
export const TRUST_EVENT_AMOUNTS = [-12, -8, -5, 5, 8, 12] as const
export type TrustEventAmount = (typeof TRUST_EVENT_AMOUNTS)[number]
export type JockeyRelation = { starts: number; trust: number }
export type JockeyRelations = Record<string, JockeyRelation>
export type TrustContext = {
  version: typeof TRUST_RULE_VERSION
  favorite: boolean
  playerRating: number
  strongestOpponentRating: number
}
export type TrustChange = {
  version: typeof TRUST_RULE_VERSION
  before: number
  after: number
  delta: number
  reason: 'growth' | 'decline'
  favorite: boolean
  rated: boolean
  lossProbability: number
  roll: number
}
export type TrustEventEffect = { jockeyId: string; amount: TrustEventAmount }
export type TrustEventChange = { jockeyId: string; before: number; after: number; delta: number }

export function assertTrust(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw new Error('신뢰도는 0~100 사이의 정수여야 합니다.')
  }
}
export function assertJockeyRelations(value: unknown): asserts value is JockeyRelations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('기수 신뢰도 기록을 읽을 수 없습니다.')
  }
  for (const [id, relation] of Object.entries(value)) {
    if (
      !id ||
      !relation ||
      typeof relation !== 'object' ||
      !Number.isInteger(relation.starts) ||
      relation.starts < 0
    ) {
      throw new Error('기수 기승 기록이 유효하지 않습니다.')
    }
    assertTrust(relation.trust)
  }
}
/** Legacy saves retain zero trust. Only identifiable, unique completed runs contribute starts. */
export function careerJockeyRelations(
  career: Pick<Career, 'jockeyTrust' | 'raceRecords'>,
): JockeyRelations {
  if (career.jockeyTrust !== undefined) {
    assertJockeyRelations(career.jockeyTrust)
    return structuredClone(career.jockeyTrust)
  }
  const relations: JockeyRelations = Object.create(null)
  const seen = new Set<string>()
  for (const record of career.raceRecords) {
    if (!record.raceRunId || !record.jockeyId || seen.has(record.raceRunId)) {
      continue
    }
    seen.add(record.raceRunId)
    const previous = relations[record.jockeyId] ?? { starts: 0, trust: 0 }
    relations[record.jockeyId] = { starts: previous.starts + 1, trust: 0 }
  }
  return relations
}
export function jockeyTrust(
  career: Pick<Career, 'jockeyTrust' | 'raceRecords'>,
  jockeyId: string,
): number {
  return careerJockeyRelations(career)[jockeyId]?.trust ?? 0
}

/** Three fixed v3 calibration races: only locked pre-entry data, never the actual seed/result. */
function fieldTrustRatings(run: RaceRunInput): Map<string, number> {
  const benchmark = structuredClone(run)
  delete benchmark.simulation
  delete benchmark.trustContext
  benchmark.raceRunId = 'trust-rating-v1'
  const ids = run.runners.map((r) => r.horseSnapshot.id)
  benchmark.runners.forEach((runner, index) => {
    runner.horseSnapshot.id = `TRUST_RATING_${index}`
    runner.jockeySnapshot.chemistry = 0
  })
  const playerIndex = ids.indexOf(run.playerHorseId)
  if (playerIndex < 0) {
    throw new Error('신뢰도 평가의 육성마가 없습니다.')
  }
  benchmark.player = benchmark.runners[playerIndex]
  benchmark.playerHorseId = benchmark.player.horseSnapshot.id
  const seconds = new Map<string, number>()
  for (let sample = 0; sample < 3; sample++) {
    benchmark.raceSeed = `trust-rating-v1:${sample}`
    for (const result of simulateRaceV3(benchmark).finishOrder) {
      seconds.set(result.horseId, (seconds.get(result.horseId) ?? 0) + result.finishTime)
    }
  }
  return new Map(
    ids.map((id, index) => [
      id,
      run.raceDefinitionSnapshot.distance / (seconds.get(`TRUST_RATING_${index}`)! / 3),
    ]),
  )
}
export function runnerTrustRating(run: RaceRunInput, runner: RaceRunnerInput): number {
  const rating = fieldTrustRatings(run).get(runner.horseSnapshot.id)
  if (rating === undefined) {
    throw new Error('출전하지 않은 말의 전력을 평가할 수 없습니다.')
  }
  return rating
}
export function createTrustContext(run: RaceRunInput): TrustContext {
  const ratings = fieldTrustRatings(run)
  const playerRating = ratings.get(run.playerHorseId)!
  const strongestOpponentRating = Math.max(
    0,
    ...[...ratings].filter(([id]) => id !== run.playerHorseId).map(([, rating]) => rating),
  )
  return {
    version: TRUST_RULE_VERSION,
    favorite: strongestOpponentRating > 0 && playerRating >= strongestOpponentRating * 1.02,
    playerRating,
    strongestOpponentRating,
  }
}
/** Independent, namespaced random stream; it never consumes a simulation/director RNG draw. */
export function trustRaceRoll(run: Pick<RaceRunInput, 'raceRunId' | 'raceSeed'>): number {
  let state = 2166136261
  for (const char of `${TRUST_RULE_VERSION}:${run.raceRunId}:${run.raceSeed}:decline`) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619)
  }
  state = (state + 0x6d2b79f5) >>> 0
  let value = Math.imul(state ^ (state >>> 15), state | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}
export function trustLossRule(placing: number, runners: number, favorite: boolean) {
  if (
    !Number.isInteger(runners) ||
    runners < 1 ||
    !Number.isInteger(placing) ||
    placing < 1 ||
    placing > runners
  ) {
    throw new Error('신뢰도 판정의 순위 또는 출전 두수가 유효하지 않습니다.')
  }
  if (placing === 1) {
    return { probability: 0, amount: 0 }
  }
  if (placing === 2) {
    return { probability: favorite ? 0.01 : 0.005, amount: 2 }
  }
  if (placing === 3) {
    return { probability: favorite ? 0.02 : 0.01, amount: 2 }
  }
  if (placing <= Math.ceil(runners / 2)) {
    return { probability: favorite ? 0.07 : 0.04, amount: 4 }
  }
  return { probability: favorite ? 0.12 : 0.08, amount: 6 }
}
export function trustAfterRace(
  before: number,
  placing: number,
  runners: number,
  favorite: boolean,
  roll: number,
): Omit<TrustChange, 'rated'> {
  assertTrust(before)
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('신뢰도 난수가 유효하지 않습니다.')
  }
  const rule = trustLossRule(placing, runners, favorite)
  const declined = roll < rule.probability
  const growth = before < 40 ? 15 : before < 70 ? 10 : before < 100 ? 5 : 0
  const change = declined ? -Math.min(rule.amount, before >= 70 ? 3 : rule.amount) : growth
  const after = Math.min(100, Math.max(0, before + change))
  return {
    version: TRUST_RULE_VERSION,
    before,
    after,
    delta: after - before,
    reason: declined ? 'decline' : 'growth',
    favorite,
    lossProbability: rule.probability,
    roll,
  }
}
export function raceTrustChange(run: RaceRunInput, placing: number): TrustChange {
  const context = run.trustContext
  return {
    ...trustAfterRace(
      run.player.jockeySnapshot.chemistry,
      placing,
      run.runners.length,
      context?.favorite ?? false,
      trustRaceRoll(run),
    ),
    rated: context !== undefined,
  }
}
export function applyTrustEvent(
  career: Career,
  effect: TrustEventEffect,
): { career: Career; change: TrustEventChange } {
  if (!effect.jockeyId || !TRUST_EVENT_AMOUNTS.includes(effect.amount)) {
    throw new Error('지원하지 않는 신뢰도 이벤트 효과입니다.')
  }
  if (career.raceRun) {
    throw new Error('경주 확정 후에는 신뢰도를 변경할 수 없습니다.')
  }
  const relations = careerJockeyRelations(career)
  if (
    !career.contractedJockeyIds.includes(effect.jockeyId) &&
    !Object.hasOwn(relations, effect.jockeyId)
  ) {
    throw new Error('현재 말과 관계가 없는 기수의 신뢰도는 변경할 수 없습니다.')
  }
  const previous = relations[effect.jockeyId] ?? { starts: 0, trust: 0 }
  const after = Math.min(100, Math.max(0, previous.trust + effect.amount))
  return {
    career: {
      ...career,
      jockeyTrust: { ...relations, [effect.jockeyId]: { ...previous, trust: after } },
    },
    change: {
      jockeyId: effect.jockeyId,
      before: previous.trust,
      after,
      delta: after - previous.trust,
    },
  }
}
