import { assertRaceRun, type RaceRunInput } from './race-entry'

export const statKeys = ['speed', 'stamina', 'power', 'guts', 'intelligence'] as const
export type Stat = typeof statKeys[number]
export const labels: Record<Stat | 'fatigue' | 'bodyLoad', string> = { speed: '속도', stamina: '지구력', power: '파워', guts: '근성', intelligence: '지능', fatigue: '피로', bodyLoad: '신체 부하' }
export type Values = Record<Stat | 'fatigue' | 'bodyLoad', number>
export type Horse = { id: string; name: string; growth: string; description: string; stats: Record<Stat, number>; aptitude: [string, string][] }
const aptitudeNames = ['잔디', '단거리', '마일', '중거리', '장거리', '도주', '선행', '선입', '추입']
const aptitudes = (grades: string): [string, string][] => aptitudeNames.map((name, i) => [name, grades[i]])
export const horses: Horse[] = [
  { id: 'DEV_HORSE_RED_COMET', name: '레드 코멧', growth: '조숙', description: '빠른 출발과 가속이 강점인 단거리·마일형', stats: { speed: 600, stamina: 455, power: 575, guts: 430, intelligence: 470 }, aptitude: aptitudes('AAACDAACD') },
  { id: 'DEV_HORSE_SERENE_STEP', name: '세레네 스텝', growth: '표준', description: '전개 안정성과 균형이 강점인 마일·중거리형', stats: { speed: 555, stamina: 500, power: 485, guts: 460, intelligence: 575 }, aptitude: aptitudes('ABAACCAAB') },
  { id: 'DEV_HORSE_NORTHERN_RIVER', name: '노던 리버', growth: '만성', description: '지구력과 후반 버티기가 강점인 중·장거리형', stats: { speed: 470, stamina: 590, power: 480, guts: 560, intelligence: 455 }, aptitude: aptitudes('ADCAADCAA') },
]
export const trainings: Record<Stat, { name: string; secondary?: Stat; preview: string; fatigue: number; bodyLoad: number; fatigueLabel: string; loadLabel: string }> = {
  speed: { name: '스피드 훈련', secondary: 'power', preview: '속도 ↑↑ · 파워 ↑', fatigue: 13, bodyLoad: 13, fatigueLabel: '보통', loadLabel: '높음' },
  stamina: { name: '스태미나 훈련', secondary: 'guts', preview: '지구력 ↑↑ · 근성 ↑', fatigue: 16, bodyLoad: 8, fatigueLabel: '높음', loadLabel: '보통' },
  power: { name: '파워 훈련', secondary: 'speed', preview: '파워 ↑↑ · 속도 ↑', fatigue: 13, bodyLoad: 13, fatigueLabel: '보통', loadLabel: '높음' },
  guts: { name: '근성 훈련', secondary: 'stamina', preview: '근성 ↑↑ · 지구력 ↑', fatigue: 16, bodyLoad: 10, fatigueLabel: '높음', loadLabel: '보통~높음' },
  intelligence: { name: '지능 훈련', preview: '지능 ↑↑', fatigue: 6, bodyLoad: 4, fatigueLabel: '낮음', loadLabel: '낮음' },
}
export type Choice = Stat | 'rest'
export type Change = { key: keyof Values; before: number; after: number }
export type ActionRecord = { actionId: string; horseId: string; month: number; actionType: 'training' | 'rest'; trainingType: Stat | null; seed: number; result: Change[] | null }
export type GameTime = { calendarDate: { year: number; month: number }; careerTurnIndex: number }
export type Career = { version: 1; horse: Horse; age: number; month: number; calendarDate: { year: number; month: number }; careerTurnIndex: number; values: Values; condition: string; health: string; record: string; prize: string; raceRecords: readonly { race: string; result: string; date: string; placing?: number; prizeMoney?: number; jockeyId?: string; jockeyName?: string }[]; action: ActionRecord | null; recent: ActionRecord[]; raceRun?: RaceRunInput }
export function startCareer(horseId: string): Career {
  const horse = horses.find(h => h.id === horseId)
  if (!horse) throw new Error('육성마를 선택해 주세요.')
  return { version: 1, horse, age: 2, month: 1, calendarDate: { year: 2028, month: 4 }, careerTurnIndex: 1, values: { ...horse.stats, fatigue: 5, bodyLoad: 5 }, condition: '보통', health: '정상', record: '0전 0승', prize: '₩0', raceRecords: [], action: null, recent: [] }
}
export function hashSeed(text: string): number {
  let value = 2166136261
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}
export function commitAction(state: Career, choice: Choice): Career {
  if (state.action || state.raceRun) return state
  if (choice !== 'rest' && !statKeys.includes(choice)) throw new Error('지원하지 않는 행동입니다.')
  const actionId = `${state.horse.id}:month-${state.month}`
  return { ...state, action: { actionId, horseId: state.horse.id, month: state.month, actionType: choice === 'rest' ? 'rest' : 'training', trainingType: choice === 'rest' ? null : choice, seed: hashSeed(`${actionId}:${choice}:v1`), result: null } }
}
export function resolveAction(state: Career): Career {
  const action = state.action
  if (!action || action.result !== null) return state
  const deltas: Partial<Values> = {}
  if (action.actionType === 'rest') {
    deltas.fatigue = -35
    deltas.bodyLoad = -25
  } else {
    const type = action.trainingType!
    const training = trainings[type]
    deltas[type] = 14 + action.seed % 5
    if (training.secondary) deltas[training.secondary] = 4 + (action.seed >>> 8) % 3
    deltas.fatigue = training.fatigue
    deltas.bodyLoad = training.bodyLoad
  }
  const values = { ...state.values }
  const result: Change[] = []
  for (const key of Object.keys(deltas) as (keyof Values)[]) {
    const before = values[key]
    const after = Math.max(0, before + deltas[key]!)
    values[key] = after
    if (before !== after) result.push({ key, before, after })
  }
  return { ...state, values, action: { ...action, result } }
}
export function advanceMonth(state: Career, expectedActionId: string): Career {
  if (state.raceRun || !state.action || state.action.actionId !== expectedActionId || state.action.result === null) return state
  const nextMonth = state.calendarDate.month === 12 ? 1 : state.calendarDate.month + 1
const nextYear = state.calendarDate.month === 12 ? state.calendarDate.year + 1 : state.calendarDate.year
return { ...state, month: state.month + 1, calendarDate: { year: nextYear, month: nextMonth }, careerTurnIndex: state.careerTurnIndex + 1, action: null, recent: [state.action, ...state.recent].slice(0, 3) }
}
export function actionName(action: ActionRecord): string { return action.actionType === 'rest' ? '휴식' : trainings[action.trainingType!].name }
export function changeText(change: Change): string { const delta = change.after - change.before; return `${labels[change.key]} ${delta > 0 ? '+' : ''}${delta}` }
export function assertCareer(value: unknown): asserts value is Career {
  const state = value as Career
  if (!state || state.version !== 1 || !state.horse?.id || !state.horse.name || !Array.isArray(state.horse.aptitude) || !Number.isInteger(state.month) || state.month < 1 || !state.calendarDate || !Number.isInteger(state.calendarDate.year) || !Number.isInteger(state.calendarDate.month) || state.calendarDate.month < 1 || state.calendarDate.month > 12 || !Number.isInteger(state.careerTurnIndex) || state.careerTurnIndex < 1 || !Array.isArray(state.raceRecords) || !state.values || !Array.isArray(state.recent) || state.recent.length > 3) throw new Error('저장된 육성 데이터를 읽을 수 없습니다. 기존 저장은 유지됩니다.')
  for (const key of [...statKeys, 'fatigue', 'bodyLoad'] as (keyof Values)[]) if (!Number.isFinite(state.values[key]) || state.values[key] < 0) throw new Error('저장된 능력치가 유효하지 않습니다.')
  if (state.raceRun !== undefined) assertRaceRun(state.raceRun, state)
  for (const action of [...state.recent, ...(state.action ? [state.action] : [])]) {
    if (!action.actionId || action.horseId !== state.horse.id || !Number.isInteger(action.month) || !Number.isInteger(action.seed) || !['training', 'rest'].includes(action.actionType) || (action.actionType === 'training' && !statKeys.includes(action.trainingType!)) || (action.result !== null && (!Array.isArray(action.result) || action.result.some(c => !(c.key in labels) || !Number.isFinite(c.before) || !Number.isFinite(c.after))))) throw new Error('저장된 행동 기록이 유효하지 않습니다.')
  }
}
