import { startCareer, type Career } from './model'
import { summarizeRecords, type HorseRaceRecord } from './records'
import { buildOpponents, raceDefinitions, stressRaceDefinitions, contractedJockeys, type RaceDefinitionSnapshot, type RaceRunInput, type RaceRunnerInput } from './race-entry'
import { simulateRace, summarizeRaceLog, type RaceSimulationLog } from './race-simulation'

export type FixtureView = 'home' | 'training' | 'raceplay' | 'result' | 'careerComplete' | 'candidates' | 'jockeys' | 'races'
export type FixtureState = { id: string; label: string; view: FixtureView; career: Career | null; log?: RaceSimulationLog; archive: boolean }

const baseHorse = () => startCareer('DEV_HORSE_SERENE_STEP')

function raceCareer(def: RaceDefinitionSnapshot, kind: string, outcome: 'any' | 'win' | 'lose'): { career: Career; log: RaceSimulationLog } {
  const career = baseHorse()
  const raised = outcome === 'win' ? { speed: 760, stamina: 720, power: 740, guts: 700, intelligence: 730 } : outcome === 'lose' ? { speed: 380, stamina: 360, power: 380, guts: 350, intelligence: 370 } : {}
  const values = { ...career.values, ...raised, fatigue: 16, bodyLoad: 10 }
  const horseSnapshot = { id: career.horse.id, name: career.horse.name, age: career.age, values, aptitude: career.horse.aptitude, health: 'HEALTHY' as const, condition: '좋음', record: '0전 0승' }
  const player: RaceRunnerInput = { horseSnapshot, jockeySnapshot: contractedJockeys[1], tactic: '선입' }
  let run!: RaceRunInput
  let log!: RaceSimulationLog
  for (let i = 0; i < 300; i++) {
    run = structuredClone({ raceRunId: `FIXTURE_RUN_${kind}`, month: 3, raceDefinitionSnapshot: def, playerHorseId: career.horse.id, player, runners: [player, ...buildOpponents(def)], raceSeed: `fixture-${kind}-${i}`, engineVersion: 'entry-contract-v1' }) as RaceRunInput
    log = simulateRace(run)
    const placing = log.result.placing
    if (outcome === 'any' || (outcome === 'win' && placing === 1) || (outcome === 'lose' && placing >= Math.ceil(def.runners * 0.6))) break
  }
  const ready: Career = { ...career, month: 3, careerTurnIndex: 3, calendarDate: { year: 2028, month: 6 }, values, condition: '좋음', raceRun: { ...run, simulation: summarizeRaceLog(log) } }
  return { career: ready, log }
}

export function buildFixture(id: string): FixtureState {
  const mile = raceDefinitions[1]
  switch (id) {
    case 'normal': return { id, label: '육성 · 일반', view: 'training', career: baseHorse(), archive: true }
    case 'active-home': return { id, label: '홈 · 육성마 있음', view: 'home', career: baseHorse(), archive: true }
    case 'high-fatigue': { const c = baseHorse(); return { id, label: '육성 · 피로 높음', view: 'training', career: { ...c, condition: '피로 높음', values: { ...c.values, fatigue: 84, bodyLoad: 80 } }, archive: true } }
    case 'injured': { const c = baseHorse(); return { id, label: '육성 · 부상', view: 'training', career: { ...c, month: 3, careerTurnIndex: 3, calendarDate: { year: 2028, month: 6 }, health: '경상', condition: '치료 중', values: { ...c.values, fatigue: 48, bodyLoad: 66 } }, archive: true } }
    case 'later-month': { const c = startCareer('DEV_HORSE_RED_COMET'); return { id, label: '육성 · 경주 달', view: 'training', career: { ...c, month: 3, careerTurnIndex: 3, calendarDate: { year: 2028, month: 6 } }, archive: true } }
    case 'playback-12': { const { career, log } = raceCareer(mile, 'PLAYBACK_12', 'any'); return { id, label: '경주 · 12두', view: 'raceplay', career, log, archive: true } }
    case 'playback-18': { const { career, log } = raceCareer(stressRaceDefinitions[0], 'PLAYBACK_18', 'any'); return { id, label: '경주 · 18두', view: 'raceplay', career, log, archive: true } }
    case 'result-win': { const { career, log } = raceCareer(mile, 'RESULT_WIN', 'win'); return { id, label: '결과 · 1착', view: 'result', career, log, archive: true } }
    case 'result-lose': { const { career, log } = raceCareer(mile, 'RESULT_LOSE', 'lose'); return { id, label: '결과 · 하위권', view: 'result', career, log, archive: true } }
    case 'retired': return { id, label: '은퇴 직후', view: 'careerComplete', career: null, archive: true }
    case 'new-career': return { id, label: '새 육성마 선택', view: 'candidates', career: null, archive: true }
    case 'no-horse': return { id, label: '기수 · 육성마 없음', view: 'jockeys', career: null, archive: true }
    default: throw new Error(`Unknown fixture: ${id}`)
  }
}

export const fixtureIds = ['normal', 'active-home', 'high-fatigue', 'injured', 'later-month', 'playback-12', 'playback-18', 'result-win', 'result-lose', 'retired', 'new-career', 'no-horse'] as const

const retiredRecords = (horse: string, entries: [string, string, number, string, string, number][]): HorseRaceRecord[] => entries.map(([race, date, placing, jockeyId, jockeyName, prizeMoney]) => ({ race, date, placing, result: `${placing}착`, jockeyId, jockeyName, prizeMoney, grade: placing === 1 ? 'G3' : 'OP', raceRunId: `${horse}-${date}` }))

export function fixtureLifecycle(archive: boolean) {
  const horse = (id: string, name: string, retiredAt: string, records: HorseRaceRecord[]) => ({
    id, name, age: '5세', sex: '수말', growth: '표준', growthNote: '꾸준히 성장한 경주마',
    stats: [['속도', 702], ['지구력', 655], ['파워', 688], ['근성', 640], ['지능', 671]],
    aptitude: [['마장', '잔디', 'A'], ['거리', '마일', 'A'], ['각질', '선입', 'B']],
    retiredAt, raceRecords: records, ...summarizeRecords(records),
  })
  const horses = archive ? [
    horse('fixture-archive-2', '새벽의 약속', '2028.04', retiredRecords('a', [['한신 컵', '2027.11', 1, 'SEO_JIAN', '서지안', 60000000], ['사츠키상', '2028.02', 3, 'SEO_JIAN', '서지안', 12000000], ['마일 챔피언십', '2028.03', 5, 'HAN_DOYUN', '한도윤', 0]])),
    horse('fixture-archive-1', '푸른 연대기', '2027.06', retiredRecords('b', [['신마전', '2026.12', 2, 'YOON_TAESUNG', '윤태성', 16000000], ['스프링 스테이크스', '2027.04', 1, 'HAN_DOYUN', '한도윤', 45000000]])),
  ] : []
  return { stableName: '청람 마방', country: '대한민국', funds: '₩42,800,000', activeHorse: null, archive: horses, month: 6, year: 2028, postRace: null, lifecycleView: 'home', lastRetiredId: horses[0]?.id }
}
