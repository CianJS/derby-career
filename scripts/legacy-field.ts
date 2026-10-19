import { tactics, type RaceDefinitionSnapshot, type RaceRunnerInput } from '../lib/career/race-entry'

/** The opponent field used before race-sim-v2. Kept so the frozen v1 engine can still be audited and verified. */
const names = ['새벽빛', '은빛 바람', '푸른 물결', '해오름', '별빛 길', '가을 하늘', '솔바람', '붉은 노을', '초록 언덕', '달빛 강', '첫눈']
export function legacyFieldV1(race: RaceDefinitionSnapshot): RaceRunnerInput[] {
  return Array.from({ length: race.runners - 1 }, (_, i): RaceRunnerInput => ({
    horseSnapshot: { id: `${race.id}_RUNNER_${i + 1}`, name: names[i] ?? `출전마 ${i + 1}`, age: 2, values: { speed: 480 + i * 6, stamina: 470 + i * 5, power: 480 + i * 4, guts: 460 + i * 5, intelligence: 490 + i * 3, fatigue: 5, bodyLoad: 5 }, aptitude: [['잔디', 'A'], ['단거리', 'B'], ['마일', 'B'], ['중거리', 'B'], ['장거리', 'C'], ...tactics.map(t => [t, 'B'] as [string, string])], health: 'HEALTHY', condition: '보통', record: '0전 0승' },
    jockeySnapshot: { id: `FIELD_JOCKEY_${i + 1}`, name: `참가 기수 ${i + 1}`, start: 75, pace: 75, path: 75, timing: 75, stability: 75, chemistry: 0, style: '균형' }, tactic: tactics[i % tactics.length],
  }))
}
