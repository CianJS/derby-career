import { travelRestriction, type StableTravel } from './local-travel'
import { jockeyCatalog } from './jockey-catalog'
import { careerProgress, CAREER_SEASON_TURNS } from './career-time'
export { jockeyCatalog, starterJockeyOptions } from './jockey-catalog'
import {
  jockeyTrust,
  createTrustContext,
  assertTrust,
  type TrustContext,
} from './jockey-trust'
import type { Career, Horse, Values } from './model'
import { summarizeRecords } from './records'
import { canRace, careerHealth } from './health'
import { simulateRace, summarizeRaceLog, type RaceSimulationLog, type RaceSimulationSummary } from './race-simulation'
import { sapporoPilot } from '../../packages/shared/src/sapporo-pilot'
import { approvedPlayableDefinitions, approvedPlayableById, approvedPlayableByRevision } from '../../packages/shared/src/approved-playable'

export const tactics = ['도주', '선행', '선입', '추입'] as const
export type RunningTactic = typeof tactics[number]
export type RaceClass = '미승리' | '1승' | 'Listed' | 'G3'
// minWins / maxWins are optional so snapshots saved before month-six races existed stay valid.
export type RaceDefinitionSnapshot = { countryCode?: string; id: string; name: string; month: number; surface: 'Turf'; distance: number; raceClass: RaceClass; runners: number; courseProfile: string; prize: number; entryFee: number; minWins?: number; maxWins?: number; minAge?: number; maxAge?: number }
export type JockeySnapshot = { id: string; name: string; start: number; pace: number; path: number; timing: number; stability: number; chemistry: number; style: string }
export type HorseSnapshot = { id: string; name: string; age: number; values: Values; aptitude: Horse['aptitude']; health: string; healthRecovery?: number; condition: string; record: string }
export type RaceRunnerInput = { horseSnapshot: HorseSnapshot; jockeySnapshot: JockeySnapshot; tactic: RunningTactic }
export type OpponentProfile = 'shared-development-v1' | 'sapporo-g3-2yo-v1'
export type RaceRunInput = { raceRunId: string; month: number; raceDefinitionSnapshot: RaceDefinitionSnapshot; playerHorseId: string; runners: RaceRunnerInput[]; player: RaceRunnerInput; raceSeed: string; engineVersion: string; opponentProfile?: OpponentProfile; mappingRevision?: string; simulation?: RaceSimulationSummary; trustContext?: TrustContext }
export type RaceEntryDraft = { raceId: string | null; jockeyId: string | null; tactic: RunningTactic | null }
export const raceDefinitions: RaceDefinitionSnapshot[] = [
  { id: 'DEV_M3_SPRINT_1400', name: '스프린트 트라이얼', month: 3, surface: 'Turf', distance: 1400, raceClass: '미승리', runners: 10, courseProfile: '짧은 직선 / 완만한 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M3_MILE_1600', name: '마일 트라이얼', month: 3, surface: 'Turf', distance: 1600, raceClass: '미승리', runners: 12, courseProfile: '표준 직선 / 표준 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M3_MIDDLE_2000', name: '미들 트라이얼', month: 3, surface: 'Turf', distance: 2000, raceClass: '미승리', runners: 12, courseProfile: '긴 직선 / 중간 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M6_MAIDEN_MILE_1600', name: '미승리 마일', month: 6, surface: 'Turf', distance: 1600, raceClass: '미승리', runners: 12, courseProfile: '표준 직선 / 표준 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M6_MAIDEN_MIDDLE_2200', name: '미승리 중거리', month: 6, surface: 'Turf', distance: 2200, raceClass: '미승리', runners: 12, courseProfile: '긴 직선 / 완만한 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M6_ONE_WIN_1800', name: '1승 조건전', month: 6, surface: 'Turf', distance: 1800, raceClass: '1승', runners: 12, courseProfile: '표준 직선 / 중간 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M6_ONE_WIN_LONG_2400', name: '1승 장거리 도전', month: 6, surface: 'Turf', distance: 2400, raceClass: '1승', runners: 10, courseProfile: '긴 직선 / 큰 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M6_LISTED_2000', name: 'Listed 챌린지', month: 6, surface: 'Turf', distance: 2000, raceClass: 'Listed', runners: 14, courseProfile: '긴 직선 / 중간 코너', prize: 50000000, entryFee: 500000, minWins: 1 },
  // Development fixtures for months 9 and 12, not real courses or official races. Each month keeps free entry paths for
  // maiden and winning careers; the Listed races charge an entry fee and stay closed until the Economy stage.
  { id: 'DEV_M9_MAIDEN_SPRINT_1400', name: '미승리 스프린트', month: 9, surface: 'Turf', distance: 1400, raceClass: '미승리', runners: 10, courseProfile: '짧은 직선 / 급한 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M9_MAIDEN_MIDDLE_1800', name: '미승리 중거리', month: 9, surface: 'Turf', distance: 1800, raceClass: '미승리', runners: 12, courseProfile: '표준 직선 / 중간 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M9_ONE_WIN_1600', name: '1승 마일 조건전', month: 9, surface: 'Turf', distance: 1600, raceClass: '1승', runners: 12, courseProfile: '표준 직선 / 표준 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M9_ONE_WIN_2000', name: '1승 중거리 조건전', month: 9, surface: 'Turf', distance: 2000, raceClass: '1승', runners: 12, courseProfile: '긴 직선 / 중간 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M9_LISTED_1800', name: 'Listed 가을 챌린지', month: 9, surface: 'Turf', distance: 1800, raceClass: 'Listed', runners: 14, courseProfile: '표준 직선 / 중간 코너', prize: 50000000, entryFee: 500000, minWins: 1 },
  { id: 'DEV_M12_MAIDEN_MIDDLE_2000', name: '미승리 연말 중거리', month: 12, surface: 'Turf', distance: 2000, raceClass: '미승리', runners: 12, courseProfile: '긴 직선 / 완만한 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
  { id: 'DEV_M12_ONE_WIN_1600', name: '1승 연말 마일', month: 12, surface: 'Turf', distance: 1600, raceClass: '1승', runners: 12, courseProfile: '표준 직선 / 표준 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M12_ONE_WIN_LONG_2400', name: '1승 연말 장거리', month: 12, surface: 'Turf', distance: 2400, raceClass: '1승', runners: 10, courseProfile: '긴 직선 / 큰 코너', prize: 12000000, entryFee: 0, minWins: 1 },
  { id: 'DEV_M12_LISTED_2200', name: 'Listed 연말 챌린지', month: 12, surface: 'Turf', distance: 2200, raceClass: 'Listed', runners: 14, courseProfile: '긴 직선 / 중간 코너', prize: 50000000, entryFee: 500000, minWins: 1 },
]
// Local-only equivalents of the two Backend development fixtures. Never seeded as official schedules.
export const localOverseasRaces: RaceDefinitionSnapshot[] = ['JPN', 'USA'].map(countryCode => ({
  ...raceDefinitions.find(r => r.id === 'DEV_M3_MILE_1600')!,
  id: `DEV_${countryCode}_M3_MILE_1600`,
  name: `${countryCode === 'JPN' ? '일본' : '미국'} 원정 마일 (개발용)`, countryCode,
}))
/** Catalog month is a seasonal slot; returned/saved month is the absolute Career turn. */
export function raceOccurrenceForTurn(
  race: RaceDefinitionSnapshot,
  turn: number,
): RaceDefinitionSnapshot | null {
  if (
    !Number.isSafeInteger(turn) || turn < 1 ||
    !Number.isInteger(race.month) || race.month < 1 || race.month > CAREER_SEASON_TURNS ||
    race.month !== careerProgress(turn).seasonTurn
  ) {
    return null
  }
  return race.month === turn ? race : { ...race, month: turn }
}
const occurrences = (definitions: readonly RaceDefinitionSnapshot[], turn: number) =>
  definitions.flatMap((race) => {
    const occurrence = raceOccurrenceForTurn(race, turn)
    return occurrence ? [occurrence] : []
  })
export const localRacesForTurn = (turn: number) => occurrences([
  ...raceDefinitions.map(r => ({ ...r, countryCode: r.countryCode ?? 'KOR' })),
  ...localOverseasRaces,
  ...approvedPlayableDefinitions.map(entry => entry.definition),
], turn)
export const raceMonths = [...new Set(raceDefinitions.map(r => r.month))].sort((a, b) => a - b)
export const isRaceTurn = (turn: number) =>
  Number.isSafeInteger(turn) && turn > 0 && raceMonths.includes(careerProgress(turn).seasonTurn)
export const racesForTurn = (turn: number) => occurrences(raceDefinitions, turn)
/** @deprecated Compatibility catalog subsets only. Read actual contracts with contractedRoster. */
export const contractedJockeys = jockeyCatalog.slice(0, 3)
/** @deprecated A catalog subset, not an authoritative free-agent/contract list. */
export const freeAgentJockeys = jockeyCatalog.slice(3)
export const jockeyProfiles: Record<string, { age: number; nationality: string }> = {
  HAN_DOYUN: { age: 29, nationality: '대한민국' },
  SEO_JIAN: { age: 33, nationality: '대한민국' },
  YOON_TAESUNG: { age: 41, nationality: '대한민국' },
  PARK_SEOYUN: { age: 27, nationality: '대한민국' },
  CHOI_MINJAE: { age: 35, nationality: '일본' },
  KANG_HAJUN: { age: 31, nationality: '대한민국' },
}
// Only reachable through saved state, never listed in the entry screen; lets the 18-runner layout be exercised.
export const stressRaceDefinitions: RaceDefinitionSnapshot[] = [
  { id: 'DEV_M3_FULL_GATE_1600', name: '풀게이트 마일', month: 3, surface: 'Turf', distance: 1600, raceClass: '미승리', runners: 18, courseProfile: '표준 직선 / 표준 코너', prize: 8000000, entryFee: 0, maxWins: 0 },
]
export const contractedRoster = (career: Career) =>
  jockeyCatalog
    .filter(j => career.contractedJockeyIds.includes(j.id))
    .map(j => ({ ...j, chemistry: jockeyTrust(career, j.id) }))
export const winCount = (career: Career) => summarizeRecords(career.raceRecords).wins
export const maiden = (career: Career) => winCount(career) === 0
export function raceEligibility(career: Career, race: RaceDefinitionSnapshot, availableFunds?: number, travel?: StableTravel): string | null {
  if (approvedPlayableById(race.id) && (!travel || !travel.activeExpedition || travel.locationCountry !== 'JPN')) return '일본 원정 중에만 출전할 수 있습니다.'
  if (travel) {
    const reason = travelRestriction(travel, race.countryCode ?? (raceDefinitions.some(r => r.id === race.id) ? 'KOR' : undefined))
    if (reason) return reason
  }
  if (race.month !== career.careerTurnIndex) return '현재 월에 개최되는 경주가 아닙니다.'
  if ((race.minAge !== undefined && (!Number.isSafeInteger(race.minAge) || race.minAge < 2)) ||
      (race.maxAge !== undefined && (!Number.isSafeInteger(race.maxAge) || race.maxAge < 2)) ||
      (race.minAge !== undefined && race.maxAge !== undefined && race.maxAge < race.minAge)) return '경주 연령 조건을 확인할 수 없습니다.'
  const age = careerProgress(career.careerTurnIndex).age
  if ((race.minAge !== undefined && age < race.minAge) || (race.maxAge !== undefined && age > race.maxAge)) return '출전 가능한 연령이 아닙니다.'
  const wins = winCount(career)
  if (race.maxWins !== undefined && wins > race.maxWins) return '미승리 경주마만 출전할 수 있습니다.'
  if (race.minWins !== undefined && wins < race.minWins) return `${race.minWins}승 이상 경주마만 출전할 수 있습니다.`
  // Transactional callers supply authoritative funds; omission preserves the legacy paid-entry gate.
  if (availableFunds !== undefined) {
    if (!Number.isSafeInteger(race.entryFee) || race.entryFee < 0 || !Number.isSafeInteger(availableFunds) || availableFunds < 0) return '등록비 또는 잔액을 확인할 수 없습니다.'
    if (race.entryFee > availableFunds) return '마방 자금이 부족하여 등록비를 낼 수 없습니다.'
    return null
  }
  if (race.entryFee > 0) return `등록비 ₩${race.entryFee.toLocaleString('ko-KR')} 정산은 후속 Economy 단계에서 지원됩니다. 지금은 유료 경주에 출전할 수 없습니다.`
  return null
}
export function entryRestriction(career: Career, availableFunds?: number, travel?: StableTravel): string | null {
  if (career.raceRun || career.action) return '이번 달 행동을 이미 확정했습니다.'
  if (!isRaceTurn(career.careerTurnIndex)) return `경주 출전은 ${raceMonths.map(m => `${m}개월 차`).join(', ')}에 열립니다.`
  if (!canRace(career.health)) return '중상 상태에서는 출전할 수 없습니다. 치료나 휴식으로 먼저 회복해 주세요.'
  if ((travel ? localRacesForTurn(career.careerTurnIndex) : racesForTurn(career.careerTurnIndex)).every(race => raceEligibility(career, race, availableFunds, travel))) return '현재 전적으로 출전할 수 있는 경주가 없습니다.'
  return null
}
// Same bucketing the race simulation uses, so the displayed aptitude matches what the engine applies.
export const distanceAptitude = (distance: number) => distance <= 1400 ? '단거리' : distance <= 1600 ? '마일' : '중거리'
export function grade(aptitude: Horse['aptitude'], name: string) { return aptitude.find(([label]) => label === name)?.[1] ?? 'D' }
export function ridingFit(career: Career, race: RaceDefinitionSnapshot | undefined, jockey: JockeySnapshot, tactic: RunningTactic | null) {
  if (!race || !tactic) return { score: null, label: '보통', explanation: '경주와 전술을 선택하면 조합을 확인할 수 있습니다.' }
  const early = tactic === '도주' || tactic === '선행'
  const ability = early ? (jockey.start + jockey.pace) / 2 : (jockey.path + jockey.timing) / 2
  const horseGrade = grade(career.horse.aptitude, tactic)
  const distanceGrade = grade(career.horse.aptitude, distanceAptitude(race.distance))
  const long = race.distance >= 2000
  const score = ability + (horseGrade === 'A' ? 5 : horseGrade === 'B' ? 0 : -8) + (distanceGrade === 'A' ? 3 : distanceGrade === 'B' ? 0 : -6) + (long ? (jockey.stability - 75) / 3 : (jockey.start - 75) / 3)
  return { score, label: score >= 85 ? '매우 좋음' : score >= 78 ? '좋음' : score >= 70 ? '보통' : '주의', explanation: `${tactic} 전술에서는 ${early ? '스타트·페이스' : '진로·승부 타이밍'} 능력을 중시합니다. 말의 전술 ${horseGrade}·거리 ${distanceGrade} 적성과 ${long ? '장거리 전개 안정성' : '초반 전개'}을 함께 반영했습니다.` }
}
const opponentNames = ['새벽빛', '은빛 바람', '푸른 물결', '해오름', '별빛 길', '가을 하늘', '솔바람', '붉은 노을', '초록 언덕', '달빛 강', '첫눈']
// Opponent count follows the race definition; names beyond the list are numbered so every runner id stays unique.
// Strength spans the same stat range as the starter horses. Even-numbered runners lean on speed and odd-numbered ones
// on stamina, so distance changes who is strong instead of only how strong everyone is.
export function opponentProfileForRace(race: RaceDefinitionSnapshot): OpponentProfile {
  return race.id === sapporoPilot.definition.id && race.raceClass === 'G3'
    ? 'sapporo-g3-2yo-v1'
    : 'shared-development-v1'
}
export function buildOpponents(race: RaceDefinitionSnapshot, raceSeed = ''): RaceRunnerInput[] {
  const count = race.runners - 1
  const sapporoG3 = opponentProfileForRace(race) === 'sapporo-g3-2yo-v1'
  let seedHash = 2166136261
  for (const char of raceSeed) seedHash = Math.imul(seedHash ^ char.charCodeAt(0), 16777619) >>> 0
  return Array.from({ length: count }, (_, i): RaceRunnerInput => {
    const t = count > 1 ? i / (count - 1) : 0.5
    const staying = i % 2 === 1
    const g3Bonus = sapporoG3 ? 60 + ((seedHash + i * 7) % 21) : 0
    const values = { speed: Math.round(460 + 110 * (staying ? 1 - t : t)) + g3Bonus, stamina: Math.round(450 + 110 * (staying ? t : 1 - t)) + g3Bonus, power: Math.round(470 + 90 * t) + g3Bonus, guts: 450 + (i % 3) * 35 + g3Bonus, intelligence: 470 + (i % 5) * 12 + g3Bonus, fatigue: 5, bodyLoad: 5 }
    return {
      horseSnapshot: { id: `${race.id}_RUNNER_${i + 1}`, name: opponentNames[i] ?? `출전마 ${i + 1}`, age: 2, values, aptitude: [['잔디', 'A'], ['단거리', 'B'], ['마일', 'B'], ['중거리', 'B'], ['장거리', 'C'], ...tactics.map(t => [t, 'B'] as [string, string])], health: 'HEALTHY', condition: '보통', record: '0전 0승' },
      jockeySnapshot: { id: `FIELD_JOCKEY_${i + 1}`, name: `참가 기수 ${i + 1}`, start: 75, pace: 75, path: 75, timing: 75, stability: 75, chemistry: 0, style: '균형' }, tactic: tactics[i % tactics.length],
    }
  })
}
// Builds the immutable RaceRun snapshot only; callers are responsible for eligibility checks.
export function createRaceRun(career: Career, race: RaceDefinitionSnapshot, jockey: JockeySnapshot, tactic: RunningTactic, identity: () => string): RaceRunInput {
  const { health, recovery } = careerHealth(career)
  const horseSnapshot: HorseSnapshot = { id: career.horse.id, name: career.horse.name, age: careerProgress(career.careerTurnIndex).age, values: { ...career.values }, aptitude: career.horse.aptitude, health, healthRecovery: recovery, condition: career.condition, record: career.record }
  const player: RaceRunnerInput = { horseSnapshot, jockeySnapshot: jockey, tactic }
  const raceRunId = identity()
  const raceSeed = identity()
  const opponentProfile = opponentProfileForRace(race)
  const approved = approvedPlayableById(race.id)
  return structuredClone({ raceRunId, month: career.careerTurnIndex, raceDefinitionSnapshot: race, playerHorseId: career.horse.id, player, runners: [player, ...buildOpponents(race, raceSeed)], raceSeed, engineVersion: 'entry-contract-v1', ...(opponentProfile === 'sapporo-g3-2yo-v1' ? { opponentProfile } : {}), ...(approved ? { mappingRevision: approved.revision } : {}) })
}
export function lockRaceEntry(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID()): Career {
  return lockRaceEntryWithLog(career, draft, identity).career
}
export function lockRaceEntryWithLog(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID(), availableFunds?: number, travel?: StableTravel): { career: Career; log: RaceSimulationLog | null } {
  if (career.raceRun) return { career, log: null }
  const reason = entryRestriction(career, availableFunds, travel)
  if (reason) throw new Error(reason)
  const race = (travel ? localRacesForTurn(career.careerTurnIndex) : racesForTurn(career.careerTurnIndex)).find(r => r.id === draft.raceId)
  if (!race || !draft.jockeyId || !draft.tactic || !tactics.includes(draft.tactic)) throw new Error('경주·기수·전술을 모두 선택해 주세요.')
  const ineligible = raceEligibility(career, race, availableFunds, travel)
  if (ineligible) throw new Error(ineligible)
  const jockey = jockeyCatalog.find(j => j.id === draft.jockeyId)
  if (!jockey || !career.contractedJockeyIds.includes(jockey.id)) throw new Error('계약하지 않은 기수는 출전시킬 수 없습니다.')
  const raceRun = createRaceRun(
    career,
    race,
    { ...jockey, chemistry: jockeyTrust(career, jockey.id) },
    draft.tactic,
    identity,
  )
  raceRun.trustContext = createTrustContext(raceRun)
  const log = simulateRace(raceRun)
  return { career: { ...career, raceRun: { ...raceRun, simulation: summarizeRaceLog(log) } }, log }
}
export function assertRaceRun(run: RaceRunInput, career: Career) {
  const fail = () => { throw new Error('저장된 출전 정보를 읽을 수 없습니다. 기존 저장은 유지됩니다.') }
  const approved = approvedPlayableByRevision(run?.raceDefinitionSnapshot?.id, run?.mappingRevision)
  const definition = [...raceDefinitions, ...localOverseasRaces, ...stressRaceDefinitions].find(r => r.id === run?.raceDefinitionSnapshot?.id) ?? approved?.definition
  const known = definition && raceOccurrenceForTurn(definition, run.month)
  if (!run || !run.raceRunId || !run.raceSeed || run.engineVersion !== 'entry-contract-v1' || !known || run.month !== known.month || career.careerTurnIndex !== run.month || career.action || run.playerHorseId !== career.horse.id || !run.player || run.player.horseSnapshot?.id !== run.playerHorseId || run.raceDefinitionSnapshot.month !== known.month || run.raceDefinitionSnapshot.runners !== known.runners || !Array.isArray(run.runners) || run.runners.length !== known.runners) fail()
  if (known && (run.opponentProfile !== undefined || opponentProfileForRace(known) === 'sapporo-g3-2yo-v1') && run.opponentProfile !== opponentProfileForRace(known)) fail()
  if (approved && (!known || run.mappingRevision !== approved.revision || run.opponentProfile !== approved.opponentProfile || JSON.stringify(Object.entries(run.raceDefinitionSnapshot).sort()) !== JSON.stringify(Object.entries(known).sort()))) fail()
  if (
    run.trustContext !== undefined && (
      run.trustContext.version !== 'jockey-trust-v1' ||
      typeof run.trustContext.favorite !== 'boolean' ||
      !Number.isFinite(run.trustContext.playerRating) ||
      !Number.isFinite(run.trustContext.strongestOpponentRating) ||
      run.trustContext.playerRating < 0 ||
      run.trustContext.strongestOpponentRating < 0
    )
  ) {
    fail()
  }
  const summary = run.simulation
  if (summary !== undefined && (!summary.digest || !summary.engineVersion || !summary.result || summary.result.playerHorseId !== run.playerHorseId || !Number.isInteger(summary.result.placing) || summary.result.placing < 1 || summary.result.placing > run.runners.length || !Number.isFinite(summary.result.prizeMoney) || summary.result.prizeMoney < 0)) fail()
  for (const runner of run.runners) {
    if (!runner?.horseSnapshot?.id || !runner.horseSnapshot.name || typeof runner.horseSnapshot.health !== 'string' || (runner.horseSnapshot.healthRecovery !== undefined && !Number.isFinite(runner.horseSnapshot.healthRecovery)) || !Array.isArray(runner.horseSnapshot.aptitude) || !runner.horseSnapshot.values || !runner.jockeySnapshot?.id || !tactics.includes(runner.tactic)) fail()
    for (const key of ['speed', 'stamina', 'power', 'guts', 'intelligence', 'fatigue', 'bodyLoad'] as const) if (!Number.isFinite(runner.horseSnapshot.values[key]) || runner.horseSnapshot.values[key] < 0) fail()
    assertTrust(runner.jockeySnapshot.chemistry)
    for (const key of ['start', 'pace', 'path', 'timing', 'stability', 'chemistry'] as const) if (!Number.isFinite(runner.jockeySnapshot[key])) fail()
  }
  if (new Set(run.runners.map(r => r.horseSnapshot.id)).size !== run.runners.length || JSON.stringify(run.runners.find(r => r.horseSnapshot.id === run.playerHorseId)) !== JSON.stringify(run.player)) fail()
}
