import type { Career, Horse, Values } from './model'
import { summarizeRecords } from './records'
import { canRace, careerHealth } from './health'
import { simulateRace, summarizeRaceLog, type RaceSimulationLog, type RaceSimulationSummary } from './race-simulation'

export const tactics = ['도주', '선행', '선입', '추입'] as const
export type RunningTactic = typeof tactics[number]
export type RaceClass = '미승리' | '1승' | 'Listed'
// minWins / maxWins are optional so snapshots saved before month-six races existed stay valid.
export type RaceDefinitionSnapshot = { id: string; name: string; month: number; surface: 'Turf'; distance: number; raceClass: RaceClass; runners: number; courseProfile: string; prize: number; entryFee: number; minWins?: number; maxWins?: number }
export type JockeySnapshot = { id: string; name: string; start: number; pace: number; path: number; timing: number; stability: number; chemistry: number; style: string }
export type HorseSnapshot = { id: string; name: string; age: number; values: Values; aptitude: Horse['aptitude']; health: string; healthRecovery?: number; condition: string; record: string }
export type RaceRunnerInput = { horseSnapshot: HorseSnapshot; jockeySnapshot: JockeySnapshot; tactic: RunningTactic }
export type RaceRunInput = { raceRunId: string; month: number; raceDefinitionSnapshot: RaceDefinitionSnapshot; playerHorseId: string; runners: RaceRunnerInput[]; player: RaceRunnerInput; raceSeed: string; engineVersion: string; simulation?: RaceSimulationSummary }
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
export const raceMonths = [...new Set(raceDefinitions.map(r => r.month))].sort((a, b) => a - b)
export const isRaceTurn = (turn: number) => raceMonths.includes(turn)
export const racesForTurn = (turn: number) => raceDefinitions.filter(r => r.month === turn)
export const contractedJockeys: JockeySnapshot[] = [
  { id: 'HAN_DOYUN', name: '한도윤', start: 86, pace: 78, path: 63, timing: 68, stability: 76, chemistry: 0, style: '도주·선행 / 초반 강점' },
  { id: 'SEO_JIAN', name: '서지안', start: 70, pace: 76, path: 88, timing: 84, stability: 72, chemistry: 0, style: '선입·추입 / 진로·승부 강점' },
  { id: 'YOON_TAESUNG', name: '윤태성', start: 74, pace: 82, path: 76, timing: 76, stability: 88, chemistry: 0, style: '균형 / 안정' },
]
export const freeAgentJockeys: JockeySnapshot[] = [
  { id: 'PARK_SEOYUN', name: '박서윤', start: 80, pace: 72, path: 70, timing: 74, stability: 79, chemistry: 0, style: '선행 / 안정적인 기승' },
  { id: 'CHOI_MINJAE', name: '최민재', start: 66, pace: 80, path: 82, timing: 79, stability: 70, chemistry: 0, style: '선입 / 페이스 판단 강점' },
  { id: 'KANG_HAJUN', name: '강하준', start: 72, pace: 69, path: 74, timing: 88, stability: 68, chemistry: 0, style: '추입 / 승부 타이밍 강점' },
]
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
export const jockeyCatalog: JockeySnapshot[] = [...contractedJockeys, ...freeAgentJockeys]
export const contractedRoster = (career: Career) => jockeyCatalog.filter(j => career.contractedJockeyIds.includes(j.id))
export const winCount = (career: Career) => summarizeRecords(career.raceRecords).wins
export const maiden = (career: Career) => winCount(career) === 0
export function raceEligibility(career: Career, race: RaceDefinitionSnapshot): string | null {
  const wins = winCount(career)
  if (race.maxWins !== undefined && wins > race.maxWins) return '미승리 경주마만 출전할 수 있습니다.'
  if (race.minWins !== undefined && wins < race.minWins) return `${race.minWins}승 이상 경주마만 출전할 수 있습니다.`
  if (race.entryFee > 0) return `등록비 ₩${race.entryFee.toLocaleString('ko-KR')} 정산은 후속 Economy 단계에서 지원됩니다. 지금은 유료 경주에 출전할 수 없습니다.`
  return null
}
export function entryRestriction(career: Career): string | null {
  if (career.raceRun || career.action) return '이번 달 행동을 이미 확정했습니다.'
  if (!isRaceTurn(career.careerTurnIndex)) return `경주 출전은 ${raceMonths.map(m => `${m}개월 차`).join(', ')}에 열립니다.`
  if (!canRace(career.health)) return '중상 상태에서는 출전할 수 없습니다. 치료나 휴식으로 먼저 회복해 주세요.'
  if (racesForTurn(career.careerTurnIndex).every(race => raceEligibility(career, race))) return '현재 전적으로 출전할 수 있는 경주가 없습니다.'
  return null
}
// Same bucketing the race simulation uses, so the displayed aptitude matches what the engine applies.
export const distanceAptitude = (distance: number) => distance <= 1400 ? '단거리' : distance <= 1600 ? '마일' : '중거리'
export function grade(aptitude: Horse['aptitude'], name: string) { return aptitude.find(([label]) => label === name)?.[1] ?? 'D' }
export function ridingFit(career: Career, race: RaceDefinitionSnapshot | undefined, jockey: JockeySnapshot, tactic: RunningTactic | null) {
  if (!race || !tactic) return { label: '보통', explanation: '경주와 전술을 선택하면 조합을 확인할 수 있습니다.' }
  const early = tactic === '도주' || tactic === '선행'
  const ability = early ? (jockey.start + jockey.pace) / 2 : (jockey.path + jockey.timing) / 2
  const horseGrade = grade(career.horse.aptitude, tactic)
  const distanceGrade = grade(career.horse.aptitude, distanceAptitude(race.distance))
  const long = race.distance >= 2000
  const score = ability + (horseGrade === 'A' ? 5 : horseGrade === 'B' ? 0 : -8) + (distanceGrade === 'A' ? 3 : distanceGrade === 'B' ? 0 : -6) + (long ? (jockey.stability - 75) / 3 : (jockey.start - 75) / 3)
  return { label: score >= 85 ? '매우 좋음' : score >= 78 ? '좋음' : score >= 70 ? '보통' : '주의', explanation: `${tactic} 전술에서는 ${early ? '스타트·페이스' : '진로·승부 타이밍'} 능력을 중시합니다. 말의 전술 ${horseGrade}·거리 ${distanceGrade} 적성과 ${long ? '장거리 전개 안정성' : '초반 전개'}을 함께 반영했습니다.` }
}
const opponentNames = ['새벽빛', '은빛 바람', '푸른 물결', '해오름', '별빛 길', '가을 하늘', '솔바람', '붉은 노을', '초록 언덕', '달빛 강', '첫눈']
// Opponent count follows the race definition; names beyond the list are numbered so every runner id stays unique.
// Strength spans the same stat range as the starter horses. Even-numbered runners lean on speed and odd-numbered ones
// on stamina, so distance changes who is strong instead of only how strong everyone is.
export function buildOpponents(race: RaceDefinitionSnapshot): RaceRunnerInput[] {
  const count = race.runners - 1
  return Array.from({ length: count }, (_, i): RaceRunnerInput => {
    const t = count > 1 ? i / (count - 1) : 0.5
    const staying = i % 2 === 1
    const values = { speed: Math.round(460 + 110 * (staying ? 1 - t : t)), stamina: Math.round(450 + 110 * (staying ? t : 1 - t)), power: Math.round(470 + 90 * t), guts: 450 + (i % 3) * 35, intelligence: 470 + (i % 5) * 12, fatigue: 5, bodyLoad: 5 }
    return {
      horseSnapshot: { id: `${race.id}_RUNNER_${i + 1}`, name: opponentNames[i] ?? `출전마 ${i + 1}`, age: 2, values, aptitude: [['잔디', 'A'], ['단거리', 'B'], ['마일', 'B'], ['중거리', 'B'], ['장거리', 'C'], ...tactics.map(t => [t, 'B'] as [string, string])], health: 'HEALTHY', condition: '보통', record: '0전 0승' },
      jockeySnapshot: { id: `FIELD_JOCKEY_${i + 1}`, name: `참가 기수 ${i + 1}`, start: 75, pace: 75, path: 75, timing: 75, stability: 75, chemistry: 0, style: '균형' }, tactic: tactics[i % tactics.length],
    }
  })
}
// Builds the immutable RaceRun snapshot only; callers are responsible for eligibility checks.
export function createRaceRun(career: Career, race: RaceDefinitionSnapshot, jockey: JockeySnapshot, tactic: RunningTactic, identity: () => string): RaceRunInput {
  const { health, recovery } = careerHealth(career)
  const horseSnapshot: HorseSnapshot = { id: career.horse.id, name: career.horse.name, age: career.age, values: { ...career.values }, aptitude: career.horse.aptitude, health, healthRecovery: recovery, condition: career.condition, record: career.record }
  const player: RaceRunnerInput = { horseSnapshot, jockeySnapshot: jockey, tactic }
  return structuredClone({ raceRunId: identity(), month: career.careerTurnIndex, raceDefinitionSnapshot: race, playerHorseId: career.horse.id, player, runners: [player, ...buildOpponents(race)], raceSeed: identity(), engineVersion: 'entry-contract-v1' })
}
export function lockRaceEntry(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID()): Career {
  return lockRaceEntryWithLog(career, draft, identity).career
}
export function lockRaceEntryWithLog(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID()): { career: Career; log: RaceSimulationLog | null } {
  if (career.raceRun) return { career, log: null }
  const reason = entryRestriction(career)
  if (reason) throw new Error(reason)
  const race = raceDefinitions.find(r => r.id === draft.raceId && r.month === career.careerTurnIndex)
  if (!race || !draft.jockeyId || !draft.tactic || !tactics.includes(draft.tactic)) throw new Error('경주·기수·전술을 모두 선택해 주세요.')
  const ineligible = raceEligibility(career, race)
  if (ineligible) throw new Error(ineligible)
  const jockey = jockeyCatalog.find(j => j.id === draft.jockeyId)
  if (!jockey || !career.contractedJockeyIds.includes(jockey.id)) throw new Error('계약하지 않은 기수는 출전시킬 수 없습니다.')
  const raceRun = createRaceRun(career, race, jockey, draft.tactic, identity)
  const log = simulateRace(raceRun)
  return { career: { ...career, raceRun: { ...raceRun, simulation: summarizeRaceLog(log) } }, log }
}
export function assertRaceRun(run: RaceRunInput, career: Career) {
  const fail = () => { throw new Error('저장된 출전 정보를 읽을 수 없습니다. 기존 저장은 유지됩니다.') }
  const known = [...raceDefinitions, ...stressRaceDefinitions].find(r => r.id === run?.raceDefinitionSnapshot?.id)
  if (!run || !run.raceRunId || !run.raceSeed || run.engineVersion !== 'entry-contract-v1' || !known || run.month !== known.month || career.careerTurnIndex !== run.month || career.action || run.playerHorseId !== career.horse.id || !run.player || run.player.horseSnapshot?.id !== run.playerHorseId || run.raceDefinitionSnapshot.month !== known.month || run.raceDefinitionSnapshot.runners !== known.runners || !Array.isArray(run.runners) || run.runners.length !== known.runners) fail()
  const summary = run.simulation
  if (summary !== undefined && (!summary.digest || !summary.engineVersion || !summary.result || summary.result.playerHorseId !== run.playerHorseId || !Number.isInteger(summary.result.placing) || summary.result.placing < 1 || summary.result.placing > run.runners.length || !Number.isFinite(summary.result.prizeMoney) || summary.result.prizeMoney < 0)) fail()
  for (const runner of run.runners) {
    if (!runner?.horseSnapshot?.id || !runner.horseSnapshot.name || typeof runner.horseSnapshot.health !== 'string' || (runner.horseSnapshot.healthRecovery !== undefined && !Number.isFinite(runner.horseSnapshot.healthRecovery)) || !Array.isArray(runner.horseSnapshot.aptitude) || !runner.horseSnapshot.values || !runner.jockeySnapshot?.id || !tactics.includes(runner.tactic)) fail()
    for (const key of ['speed', 'stamina', 'power', 'guts', 'intelligence', 'fatigue', 'bodyLoad'] as const) if (!Number.isFinite(runner.horseSnapshot.values[key]) || runner.horseSnapshot.values[key] < 0) fail()
    for (const key of ['start', 'pace', 'path', 'timing', 'stability', 'chemistry'] as const) if (!Number.isFinite(runner.jockeySnapshot[key])) fail()
  }
  if (new Set(run.runners.map(r => r.horseSnapshot.id)).size !== run.runners.length || JSON.stringify(run.runners.find(r => r.horseSnapshot.id === run.playerHorseId)) !== JSON.stringify(run.player)) fail()
}
