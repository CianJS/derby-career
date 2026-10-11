import type { Career, Horse, Values } from './model'
import { simulateRace, summarizeRaceLog, type RaceSimulationLog, type RaceSimulationSummary } from './race-simulation'

export const tactics = ['도주', '선행', '선입', '추입'] as const
export type RunningTactic = typeof tactics[number]
export type RaceDefinitionSnapshot = { id: string; name: string; month: number; surface: 'Turf'; distance: number; raceClass: '미승리'; runners: number; courseProfile: string; prize: number; entryFee: number }
export type JockeySnapshot = { id: string; name: string; start: number; pace: number; path: number; timing: number; stability: number; chemistry: number; style: string }
export type HorseSnapshot = { id: string; name: string; age: number; values: Values; aptitude: Horse['aptitude']; health: 'HEALTHY'; condition: string; record: string }
export type RaceRunnerInput = { horseSnapshot: HorseSnapshot; jockeySnapshot: JockeySnapshot; tactic: RunningTactic }
export type RaceRunInput = { raceRunId: string; month: number; raceDefinitionSnapshot: RaceDefinitionSnapshot; playerHorseId: string; runners: RaceRunnerInput[]; player: RaceRunnerInput; raceSeed: string; engineVersion: string; simulation?: RaceSimulationSummary }
export type RaceEntryDraft = { raceId: string | null; jockeyId: string | null; tactic: RunningTactic | null }
export const raceDefinitions: RaceDefinitionSnapshot[] = [
  { id: 'DEV_M3_SPRINT_1400', name: '스프린트 트라이얼', month: 3, surface: 'Turf', distance: 1400, raceClass: '미승리', runners: 10, courseProfile: '짧은 직선 / 완만한 코너', prize: 8000000, entryFee: 0 },
  { id: 'DEV_M3_MILE_1600', name: '마일 트라이얼', month: 3, surface: 'Turf', distance: 1600, raceClass: '미승리', runners: 12, courseProfile: '표준 직선 / 표준 코너', prize: 8000000, entryFee: 0 },
  { id: 'DEV_M3_MIDDLE_2000', name: '미들 트라이얼', month: 3, surface: 'Turf', distance: 2000, raceClass: '미승리', runners: 12, courseProfile: '긴 직선 / 중간 코너', prize: 8000000, entryFee: 0 },
]
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
// Only reachable through saved state, never listed in the entry screen; lets the 18-runner layout be exercised.
export const stressRaceDefinitions: RaceDefinitionSnapshot[] = [
  { id: 'DEV_M3_FULL_GATE_1600', name: '풀게이트 마일', month: 3, surface: 'Turf', distance: 1600, raceClass: '미승리', runners: 18, courseProfile: '표준 직선 / 표준 코너', prize: 8000000, entryFee: 0 },
]
export const healthy = (career: Career) => ['정상', 'HEALTHY'].includes(career.health)
export const maiden = (career: Career) => /(?:^|\s)0승(?:\s|$)/.test(career.record)
export function entryRestriction(career: Career): string | null {
  if (career.raceRun || career.action) return '이번 달 행동을 이미 확정했습니다.'
  if (career.careerTurnIndex !== 3 || !raceDefinitions.some(r => r.month === 3)) return '경주 출전은 3개월 차에 열립니다.'
  if (!healthy(career)) return '건강이 정상일 때 출전할 수 있습니다.'
  if (!maiden(career)) return '미승리 경주마만 출전할 수 있습니다.'
  return null
}
export function grade(aptitude: Horse['aptitude'], name: string) { return aptitude.find(([label]) => label === name)?.[1] ?? 'D' }
export function ridingFit(career: Career, race: RaceDefinitionSnapshot | undefined, jockey: JockeySnapshot, tactic: RunningTactic | null) {
  if (!race || !tactic) return { label: '보통', explanation: '경주와 전술을 선택하면 조합을 확인할 수 있습니다.' }
  const early = tactic === '도주' || tactic === '선행'
  const ability = early ? (jockey.start + jockey.pace) / 2 : (jockey.path + jockey.timing) / 2
  const horseGrade = grade(career.horse.aptitude, tactic)
  const distanceGrade = grade(career.horse.aptitude, race.distance === 1400 ? '단거리' : race.distance === 1600 ? '마일' : '중거리')
  const score = ability + (horseGrade === 'A' ? 5 : horseGrade === 'B' ? 0 : -8) + (distanceGrade === 'A' ? 3 : distanceGrade === 'B' ? 0 : -6) + (race.distance === 2000 ? (jockey.stability - 75) / 3 : (jockey.start - 75) / 3)
  return { label: score >= 85 ? '매우 좋음' : score >= 78 ? '좋음' : score >= 70 ? '보통' : '주의', explanation: `${tactic} 전술에서는 ${early ? '스타트·페이스' : '진로·승부 타이밍'} 능력을 중시합니다. 말의 전술 ${horseGrade}·거리 ${distanceGrade} 적성과 ${race.distance === 2000 ? '장거리 전개 안정성' : '초반 전개'}을 함께 반영했습니다.` }
}
export function lockRaceEntry(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID()): Career {
  return lockRaceEntryWithLog(career, draft, identity).career
}
export function lockRaceEntryWithLog(career: Career, draft: RaceEntryDraft, identity: () => string = () => crypto.randomUUID()): { career: Career; log: RaceSimulationLog | null } {
  if (career.raceRun) return { career, log: null }
  const reason = entryRestriction(career)
  if (reason) throw new Error(reason)
  const race = raceDefinitions.find(r => r.id === draft.raceId && r.month === career.careerTurnIndex)
  const jockey = contractedJockeys.find(j => j.id === draft.jockeyId && career.contractedJockeyIds.includes(j.id))
  if (!race || !jockey || !draft.tactic || !tactics.includes(draft.tactic)) throw new Error('경주·기수·전술을 모두 선택해 주세요.')
  const horseSnapshot: HorseSnapshot = { id: career.horse.id, name: career.horse.name, age: career.age, values: { ...career.values }, aptitude: career.horse.aptitude, health: 'HEALTHY', condition: career.condition, record: career.record }
  const player: RaceRunnerInput = { horseSnapshot, jockeySnapshot: jockey, tactic: draft.tactic }
  const names = ['새벽빛', '은빛 바람', '푸른 물결', '해오름', '별빛 길', '가을 하늘', '솔바람', '붉은 노을', '초록 언덕', '달빛 강', '첫눈']
  const opponents: RaceRunnerInput[] = names.slice(0, race.runners - 1).map((name, i) => ({
    horseSnapshot: { id: `${race.id}_RUNNER_${i + 1}`, name, age: 2, values: { speed: 480 + i * 6, stamina: 470 + i * 5, power: 480 + i * 4, guts: 460 + i * 5, intelligence: 490 + i * 3, fatigue: 5, bodyLoad: 5 }, aptitude: [['잔디', 'A'], ['단거리', 'B'], ['마일', 'B'], ['중거리', 'B'], ['장거리', 'C'], ...tactics.map(t => [t, 'B'] as [string, string])], health: 'HEALTHY', condition: '보통', record: '0전 0승' },
    jockeySnapshot: { id: `FIELD_JOCKEY_${i + 1}`, name: `참가 기수 ${i + 1}`, start: 75, pace: 75, path: 75, timing: 75, stability: 75, chemistry: 0, style: '균형' }, tactic: tactics[i % tactics.length],
  }))
  const raceRun: RaceRunInput = structuredClone({ raceRunId: identity(), month: career.careerTurnIndex, raceDefinitionSnapshot: race, playerHorseId: career.horse.id, player, runners: [player, ...opponents], raceSeed: identity(), engineVersion: 'entry-contract-v1' })
  const log = simulateRace(raceRun)
  return { career: { ...career, raceRun: { ...raceRun, simulation: summarizeRaceLog(log) } }, log }
}
export function assertRaceRun(run: RaceRunInput, career: Career) {
  const fail = () => { throw new Error('저장된 출전 정보를 읽을 수 없습니다. 기존 저장은 유지됩니다.') }
  if (!run || !run.raceRunId || !run.raceSeed || run.engineVersion !== 'entry-contract-v1' || run.month !== 3 || career.careerTurnIndex !== run.month || career.action || run.playerHorseId !== career.horse.id || !run.player || run.player.horseSnapshot?.id !== run.playerHorseId || !run.raceDefinitionSnapshot || ![...raceDefinitions, ...stressRaceDefinitions].some(r => r.id === run.raceDefinitionSnapshot.id) || run.raceDefinitionSnapshot.month !== run.month || !Array.isArray(run.runners) || run.runners.length !== run.raceDefinitionSnapshot.runners || ![10, 12, 18].includes(run.runners.length)) fail()
  const summary = run.simulation
  if (summary !== undefined && (!summary.digest || !summary.engineVersion || !summary.result || summary.result.playerHorseId !== run.playerHorseId || !Number.isInteger(summary.result.placing) || summary.result.placing < 1 || summary.result.placing > run.runners.length || !Number.isFinite(summary.result.prizeMoney) || summary.result.prizeMoney < 0)) fail()
  for (const runner of run.runners) {
    if (!runner?.horseSnapshot?.id || !runner.horseSnapshot.name || runner.horseSnapshot.health !== 'HEALTHY' || !Array.isArray(runner.horseSnapshot.aptitude) || !runner.horseSnapshot.values || !runner.jockeySnapshot?.id || !tactics.includes(runner.tactic)) fail()
    for (const key of ['speed', 'stamina', 'power', 'guts', 'intelligence', 'fatigue', 'bodyLoad'] as const) if (!Number.isFinite(runner.horseSnapshot.values[key]) || runner.horseSnapshot.values[key] < 0) fail()
    for (const key of ['start', 'pace', 'path', 'timing', 'stability', 'chemistry'] as const) if (!Number.isFinite(runner.jockeySnapshot[key])) fail()
  }
  if (new Set(run.runners.map(r => r.horseSnapshot.id)).size !== run.runners.length || JSON.stringify(run.runners.find(r => r.horseSnapshot.id === run.playerHorseId)) !== JSON.stringify(run.player)) fail()
}
