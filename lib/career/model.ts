import { localEventChoiceAvailability } from './events/availability'
import {
  careerJockeyRelations,
  raceTrustChange,
  applyTrustEvent,
  assertJockeyRelations,
  type JockeyRelations,
} from './jockey-trust'
import { initialJockeyContracts, type CareerJockeySelection } from './jockey-catalog'
import { careerProgress } from './career-time'
import { assertRaceRun, type RaceRunInput } from './race-entry'
import { BALANCE } from './balance'
import { deriveCondition, isHealthy, rollsInjury } from './status'
import { raceAftermath } from './post-race'
import { canonicalHealth, canTrain, careerHealth, injure, recoverBy } from './health'
import { assertRaceRecords } from './lifecycle-save'
import { nextEventState, planActionEvent } from './events/director'
import {
  appliesToAction,
  applyActionEffects,
  immediateEffects,
  isEventActive,
  pendingEffects,
} from './events/effects'
import { defaultEventCatalog, type EventCatalog } from './events/repository'
import type { AppliedEvent, CareerEvent, EventChoiceId, EventLogEntry } from './events/types'

export const statKeys = ['speed', 'stamina', 'power', 'guts', 'intelligence'] as const
export type Stat = (typeof statKeys)[number]
export const labels: Record<Stat | 'fatigue' | 'bodyLoad', string> = {
  speed: '속도',
  stamina: '지구력',
  power: '파워',
  guts: '근성',
  intelligence: '지능',
  fatigue: '피로',
  bodyLoad: '신체 부하',
}
export type Values = Record<Stat | 'fatigue' | 'bodyLoad', number>
export type Horse = {
  id: string
  name: string
  growth: string
  description: string
  stats: Record<Stat, number>
  aptitude: [string, string][]
}
const aptitudeNames = ['잔디', '단거리', '마일', '중거리', '장거리', '도주', '선행', '선입', '추입']
const aptitudes = (grades: string): [string, string][] =>
  aptitudeNames.map((name, i) => [name, grades[i]])
export const horses: Horse[] = [
  {
    id: 'DEV_HORSE_RED_COMET',
    name: '레드 코멧',
    growth: '조숙',
    description: '빠른 출발과 가속이 강점인 단거리·마일형',
    stats: { speed: 600, stamina: 455, power: 575, guts: 430, intelligence: 470 },
    aptitude: aptitudes('AAACDAACD'),
  },
  {
    id: 'DEV_HORSE_SERENE_STEP',
    name: '세레네 스텝',
    growth: '표준',
    description: '전개 안정성과 균형이 강점인 마일·중거리형',
    stats: { speed: 555, stamina: 500, power: 485, guts: 460, intelligence: 575 },
    aptitude: aptitudes('ABAACCAAB'),
  },
  {
    id: 'DEV_HORSE_NORTHERN_RIVER',
    name: '노던 리버',
    growth: '만성',
    description: '지구력과 후반 버티기가 강점인 중·장거리형',
    stats: { speed: 470, stamina: 590, power: 480, guts: 560, intelligence: 455 },
    aptitude: aptitudes('ADCAADCAA'),
  },
]
export const trainings: Record<
  Stat,
  {
    name: string
    secondary?: Stat
    preview: string
    fatigue: number
    bodyLoad: number
    fatigueLabel: string
    loadLabel: string
  }
> = {
  speed: {
    name: '스피드 훈련',
    secondary: 'power',
    preview: '속도 ↑↑ · 파워 ↑',
    ...BALANCE.training.cost.speed,
    fatigueLabel: '보통',
    loadLabel: '높음',
  },
  stamina: {
    name: '스태미나 훈련',
    secondary: 'guts',
    preview: '지구력 ↑↑ · 근성 ↑',
    ...BALANCE.training.cost.stamina,
    fatigueLabel: '높음',
    loadLabel: '보통',
  },
  power: {
    name: '파워 훈련',
    secondary: 'speed',
    preview: '파워 ↑↑ · 속도 ↑',
    ...BALANCE.training.cost.power,
    fatigueLabel: '보통',
    loadLabel: '높음',
  },
  guts: {
    name: '근성 훈련',
    secondary: 'stamina',
    preview: '근성 ↑↑ · 지구력 ↑',
    ...BALANCE.training.cost.guts,
    fatigueLabel: '높음',
    loadLabel: '보통~높음',
  },
  intelligence: {
    name: '지능 훈련',
    preview: '지능 ↑↑',
    ...BALANCE.training.cost.intelligence,
    fatigueLabel: '낮음',
    loadLabel: '낮음',
  },
}
export type Choice = Stat | 'rest' | 'treatment'
export type ActionType = 'training' | 'rest' | 'treatment'
export type Change = { key: keyof Values; before: number; after: number }
export type StatusChange = {
  key: 'condition' | 'health' | 'recovery'
  before: string
  after: string
}
export type ActionRecord = {
  actionId: string
  horseId: string
  month: number
  actionType: ActionType
  trainingType: Stat | null
  seed: number
  result: Change[] | null
  statusChanges?: StatusChange[]
  event?: AppliedEvent
}
export type AdjustActionDeltas = (
  deltas: Readonly<Partial<Values>>,
  action: Readonly<ActionRecord>,
) => Partial<Values>
export type GameTime = { calendarDate: { year: number; month: number }; careerTurnIndex: number }
import { summarizeRecords, type HorseRaceRecord } from './records'
export type { HorseRaceRecord } from './records'

export function applyRaceResult(
  career: Career,
  raceRunId: string,
  placing: number,
  prizeMoney: number,
): Career {
  if (career.raceRecords.some((record) => record.raceRunId === raceRunId)) {
    return career
  }
  const run = career.raceRun
  if (!run || run.raceRunId !== raceRunId || run.playerHorseId !== career.horse.id) {
    throw new Error('출전 기록이 일치하지 않습니다.')
  }
  if (
    !Number.isInteger(placing) ||
    placing < 1 ||
    placing > run.runners.length ||
    !Number.isFinite(prizeMoney) ||
    prizeMoney < 0
  ) {
    throw new Error('유효하지 않은 경주 결과입니다.')
  }
  const expected = run.simulation?.result
  if (expected && (expected.placing !== placing || expected.prizeMoney !== prizeMoney)) {
    throw new Error('저장된 시뮬레이션 결과와 일치하지 않습니다.')
  }
  const trustChange = raceTrustChange(run, placing)
  const jockeyId = run.player.jockeySnapshot.id
  const relations = careerJockeyRelations(career)
  const previous = relations[jockeyId] ?? { starts: 0, trust: 0 }
  const jockeyRelations = {
    ...relations,
    [jockeyId]: { starts: previous.starts + 1, trust: trustChange.after },
  }
  const raceRecords = [
    ...career.raceRecords,
    {
      raceRunId,
      month: career.month,
      race: run.raceDefinitionSnapshot.name,
      result: `${placing}착`,
      date: `${career.calendarDate.year}.${String(career.calendarDate.month).padStart(2, '0')}`,
      placing,
      prizeMoney,
      jockeyId: run.player.jockeySnapshot.id,
      jockeyName: run.player.jockeySnapshot.name,
      trustChange,
      distance: run.raceDefinitionSnapshot.distance,
      grade: run.raceDefinitionSnapshot.raceClass,
    },
  ]
  const { after } = raceAftermath(career, run)
  const values = {
    ...career.values,
    fatigue: after.values.fatigue,
    bodyLoad: after.values.bodyLoad,
  }
  return {
    ...career,
    values,
    condition: after.condition,
    health: after.health.health,
    healthRecovery: after.health.recovery,
    raceRecords,
    jockeyTrust: jockeyRelations,
    ...summarizeRecords(raceRecords),
  }
}
export function completeRace(
  career: Career,
  raceRunId: string,
  placing: number,
  prizeMoney: number,
): Career {
  const run = career.raceRun
  const recorded = career.raceRecords.some((record) => record.raceRunId === raceRunId)
  if (!run || run.raceRunId !== raceRunId) {
    if (recorded) {
      return career
    }
    throw new Error('출전 기록이 일치하지 않습니다.')
  }
  const applied = applyRaceResult(career, raceRunId, placing, prizeMoney)
  const next: Career = { ...applied, action: null, ...nextTime(applied) }
  delete next.raceRun
  return next
}
function nextTime(
  state: Career,
): Pick<Career, 'month' | 'calendarDate' | 'careerTurnIndex' | 'age'> &
  Partial<Pick<Career, 'event' | 'eventLog' | 'eventMisses'>> {
  const rollsYear = state.calendarDate.month === 12
  return {
    age: careerProgress(state.careerTurnIndex + 1).age,
    month: state.month + 1,
    careerTurnIndex: state.careerTurnIndex + 1,
    calendarDate: {
      year: rollsYear ? state.calendarDate.year + 1 : state.calendarDate.year,
      month: rollsYear ? 1 : state.calendarDate.month + 1,
    },
    ...nextEventState(state),
  }
}
/** `event`, `eventLog` and `eventMisses` are absent on saves from before events: `undefined` means "not enrolled yet", `null` means "no event this month". */
export type Career = {
  version: 1
  /** Absent on legacy saves; no retroactive trust growth is inferred. */
  jockeyTrust?: JockeyRelations
  event?: CareerEvent | null
  eventLog?: EventLogEntry[]
  eventMisses?: number
  horse: Horse
  age: number
  month: number
  calendarDate: { year: number; month: number }
  careerTurnIndex: number
  contractedJockeyIds: string[]
  values: Values
  condition: string
  health: string
  healthRecovery?: number
  record: string
  prize: string
  raceRecords: readonly HorseRaceRecord[]
  action: ActionRecord | null
  recent: ActionRecord[]
  raceRun?: RaceRunInput
}
export function startCareer(horseId: string, selection: CareerJockeySelection = {}): Career {
  const horse = horses.find((h) => h.id === horseId)
  if (!horse) {
    throw new Error('육성마를 선택해 주세요.')
  }
  return {
    version: 1,
    horse,
    age: 2,
    month: 1,
    calendarDate: { year: 2028, month: 4 },
    careerTurnIndex: 1,
    contractedJockeyIds: initialJockeyContracts(selection),
    values: { ...horse.stats, fatigue: 5, bodyLoad: 5 },
    condition: '보통',
    health: '정상',
    healthRecovery: 0,
    record: '0전 0승',
    prize: '₩0',
    raceRecords: [],
    action: null,
    recent: [],
  }
}
export function hashSeed(text: string): number {
  let value = 2166136261
  for (const char of text) {
    value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  }
  return value >>> 0
}
export function commitAction(state: Career, choice: Choice): Career {
  if (state.action || state.raceRun) {
    return state
  }
  const isTraining = choice !== 'rest' && choice !== 'treatment'
  if (isTraining && !statKeys.includes(choice)) {
    throw new Error('지원하지 않는 행동입니다.')
  }
  if (isTraining && !canTrain(state.health)) {
    throw new Error('부상 중에는 훈련할 수 없습니다. 휴식하거나 치료를 선택해 주세요.')
  }
  if (choice === 'treatment' && isHealthy(state.health)) {
    throw new Error('치료할 부상이 없습니다.')
  }
  const actionId = `${state.horse.id}:month-${state.month}`
  return {
    ...state,
    action: {
      actionId,
      horseId: state.horse.id,
      month: state.month,
      actionType: isTraining ? 'training' : choice,
      trainingType: isTraining ? choice : null,
      seed: hashSeed(`${actionId}:${choice}:v1`),
      result: null,
    },
  }
}
/** Shared state bounds for resolved actions and read-only previews. Status costs have no upper cap. */
function actionValueAfter(key: keyof Values, before: number, delta: number): number {
  return Math.min(
    statKeys.includes(key as Stat) ? BALANCE.maxStat : Infinity,
    Math.max(0, before + delta),
  )
}

/** Only already-visible, active Local effects are previewed. Never draws result events or consumes a seed. */
export function trainingPreview(
  state: Pick<Career, 'values' | 'event'>,
  type: Stat,
  catalog: EventCatalog = defaultEventCatalog,
) {
  const event = state.event
  const definition = event ? catalog.find(event.eventId) : undefined
  const action = { actionType: 'training', trainingType: type } as const
  const effects =
    event && definition && isEventActive(definition, event)
      ? pendingEffects(definition, event).filter((effect) => appliesToAction(effect, action))
      : []
  // Costs are independent of the seeded primary gain; growth is intentionally not predicted here.
  const base = { primary: 0, fatigue: trainings[type].fatigue, bodyLoad: trainings[type].bodyLoad }
  const applied = applyActionEffects(effects, action, base)
  return {
    effects,
    costs: (['fatigue', 'bodyLoad'] as const).map((key) => ({
      key,
      base: base[key],
      event: applied[key] - base[key],
      final: applied[key],
      before: state.values[key],
      after: actionValueAfter(key, state.values[key], applied[key]),
    })),
  }
}

export function resolveAction(
  state: Career,
  catalog: EventCatalog = defaultEventCatalog,
  adjustDeltas?: AdjustActionDeltas,
): Career {
  const action = state.action
  if (!action || action.result !== null) {
    return state
  }
  const deltas: Partial<Values> = {}
  const healthBefore = careerHealth(state)
  let healthState = healthBefore
  if (action.actionType === 'rest') {
    deltas.fatigue = BALANCE.rest.fatigue
    deltas.bodyLoad = BALANCE.rest.bodyLoad
    healthState = recoverBy(healthBefore, BALANCE.health.recovery.rest)
  } else if (action.actionType === 'treatment') {
    deltas.fatigue = BALANCE.treatment.fatigue
    deltas.bodyLoad = BALANCE.treatment.bodyLoad
    healthState = recoverBy(healthBefore, BALANCE.health.recovery.treatment)
  } else {
    const type = action.trainingType!
    const training = trainings[type]
    const { primary, secondary } = BALANCE.training
    deltas[type] = primary.base + (action.seed % primary.spread)
    if (training.secondary) {
      deltas[training.secondary] = secondary.base + ((action.seed >>> 8) % secondary.spread)
    }
    deltas.fatigue = training.fatigue
    deltas.bodyLoad = training.bodyLoad
    if (rollsInjury(state.values, action.seed)) {
      healthState = injure(BALANCE.health.trainingInjurySeverity)
    }
  }
  const plan = planActionEvent(state, action, catalog)
  let appliedEvent: AppliedEvent | undefined
  if (action.actionType !== 'treatment') {
    const type = action.trainingType
    const base = {
      primary: type ? deltas[type]! : 0,
      fatigue: deltas.fatigue!,
      bodyLoad: deltas.bodyLoad!,
    }
    const applied = applyActionEffects(plan.effects, action, base)
    if (applied.matched && plan.definition && plan.event) {
      if (type) {
        deltas[type] = applied.primary
      }
      deltas.fatigue = applied.fatigue
      deltas.bodyLoad = applied.bodyLoad
      appliedEvent = {
        eventId: plan.definition.id,
        kind: plan.definition.kind,
        ...(plan.event.choice ? { choice: plan.event.choice } : {}),
        growth: applied.primary - base.primary,
        fatigue: applied.fatigue - base.fatigue,
        bodyLoad: applied.bodyLoad - base.bodyLoad,
      }
    }
  }
  // A server event adjusts raw action deltas before the shared 0/1000 bounds. Clamped results lose
  // the original recovery/growth amount and cannot be used as the base for penalties or multipliers.
  const finalDeltas = adjustDeltas ? adjustDeltas(deltas, action) : deltas
  const values = { ...state.values }
  const result: Change[] = []
  for (const key of Object.keys(finalDeltas) as (keyof Values)[]) {
    const before = values[key]
    const after = actionValueAfter(key, before, finalDeltas[key]!)
    values[key] = after
    if (before !== after) {
      result.push({ key, before, after })
    }
  }
  let related = state
  for (const effect of plan.effects) {
    if (effect.trust) {
      related = applyTrustEvent(related, effect.trust).career
    }
  }
  const health = healthState.health
  const condition = deriveCondition(values, health)
  const statusChanges: StatusChange[] = []
  const healthLabelBefore = canonicalHealth(state.health)
  if (health !== healthLabelBefore) {
    statusChanges.push({ key: 'health', before: healthLabelBefore, after: health })
  } else if (healthState.recovery !== healthBefore.recovery) {
    statusChanges.push({
      key: 'recovery',
      before: String(healthBefore.recovery),
      after: String(healthState.recovery),
    })
  }
  if (condition !== state.condition) {
    statusChanges.push({ key: 'condition', before: state.condition, after: condition })
  }
  return {
    ...state,
    values,
    health,
    healthRecovery: healthState.recovery,
    condition,
    ...(related.jockeyTrust ? { jockeyTrust: related.jockeyTrust } : {}),
    ...(plan.event !== undefined ? { event: plan.event } : {}),
    action: { ...action, result, statusChanges, ...(appliedEvent ? { event: appliedEvent } : {}) },
  }
}
/** Picks A or B on a pick-one event. Immediate effects apply here exactly once; a repeated call changes nothing. */
export function chooseEvent(
  state: Career,
  eventId: string,
  choiceId: EventChoiceId,
  catalog: EventCatalog = defaultEventCatalog,
): Career {
  const event = state.event
  if (!event || event.eventId !== eventId) {
    throw new Error('선택할 이벤트가 없습니다.')
  }
  if (event.status !== 'offered') {
    return state
  }
  if (event.month !== state.month || state.action || state.raceRun) {
    throw new Error('이번 달 행동을 시작한 뒤에는 이벤트를 선택할 수 없습니다.')
  }
  const choice = catalog.find(eventId)?.choices?.find((option) => option.id === choiceId)
  if (!choice) {
    throw new Error('선택할 수 없는 이벤트 항목입니다.')
  }
  if (!localEventChoiceAvailability(catalog.find(eventId)!, choiceId, state).available) {
    throw new Error(
      '현재 상태에서는 실행할 수 없는 이벤트 선택입니다. 휴식하거나 치료를 선택해 주세요.',
    )
  }
  if (choice.effects.some((effect) => effect.trust && effect.scope !== 'immediate')) {
    throw new Error('선택지의 신뢰도 효과는 즉시 적용으로 선언해야 합니다.')
  }
  const chosen: CareerEvent = { ...event, choice: choiceId }
  const immediate = immediateEffects(choice.effects)
  const values = { ...state.values }
  const spent = { fatigue: 0, bodyLoad: 0 }
  for (const key of ['fatigue', 'bodyLoad'] as const) {
    const before = values[key]
    values[key] = Math.max(
      0,
      before + immediate.reduce((sum, effect) => sum + (effect[key] ?? 0), 0),
    )
    spent[key] = values[key] - before
  }
  let related = state
  for (const effect of immediate) {
    if (effect.trust) {
      related = applyTrustEvent(related, effect.trust).career
    }
  }
  const definition = catalog.find(eventId)!
  const status = pendingEffects(definition, chosen).length ? 'chosen' : 'applied'
  return {
    ...state,
    values,
    condition: deriveCondition(values, state.health),
    ...(related.jockeyTrust ? { jockeyTrust: related.jockeyTrust } : {}),
    event: { ...chosen, status, ...(immediate.length ? { immediate: spent } : {}) },
  }
}
export function advanceMonth(state: Career, expectedActionId: string): Career {
  if (
    state.raceRun ||
    !state.action ||
    state.action.actionId !== expectedActionId ||
    state.action.result === null
  ) {
    return state
  }
  return {
    ...state,
    ...nextTime(state),
    action: null,
    recent: [state.action, ...state.recent].slice(0, 3),
  }
}
export function actionName(action: ActionRecord): string {
  return action.actionType === 'rest'
    ? '휴식'
    : action.actionType === 'treatment'
      ? '치료'
      : trainings[action.trainingType!].name
}
export function changeText(change: Change): string {
  const delta = change.after - change.before
  return `${labels[change.key]} ${delta > 0 ? '+' : ''}${delta}`
}
export const statusLabels: Record<StatusChange['key'], string> = {
  condition: '컨디션',
  health: '건강',
  recovery: '회복 필요량',
}
export function statusChangeText(change: StatusChange): string {
  return `${statusLabels[change.key]} ${change.before} → ${change.after}`
}
export function actionSummary(action: ActionRecord): string {
  return (
    [
      ...(action.result ?? []).map(changeText),
      ...(action.statusChanges ?? []).map(statusChangeText),
    ].join(' / ') || '변경 없음'
  )
}
const eventStatuses = ['offered', 'chosen', 'applied', 'expired']
function validEntry(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const entry = value as Record<string, unknown>
  return (
    typeof entry.eventId === 'string' &&
    Number.isInteger(entry.month) &&
    eventStatuses.includes(entry.status as string) &&
    (entry.choice === undefined || entry.choice === 'A' || entry.choice === 'B')
  )
}
function assertEventState(state: Career) {
  const { event, eventLog, eventMisses } = state
  const broken =
    (event !== undefined &&
      event !== null &&
      (!validEntry(event) || !Number.isInteger(event.seed))) ||
    (eventLog !== undefined && (!Array.isArray(eventLog) || !eventLog.every(validEntry))) ||
    (eventMisses !== undefined && (!Number.isInteger(eventMisses) || eventMisses < 0))
  if (broken) {
    throw new Error('저장된 이벤트 데이터가 유효하지 않습니다.')
  }
}
export function assertCareer(value: unknown): asserts value is Career {
  const state = value as Career
  if (
    !state ||
    state.version !== 1 ||
    !state.horse?.id ||
    !state.horse.name ||
    typeof state.horse.id !== 'string' ||
    typeof state.horse.name !== 'string' ||
    typeof state.horse.growth !== 'string' ||
    typeof state.horse.description !== 'string' ||
    !Number.isInteger(state.age) ||
    state.age < 1 ||
    typeof state.health !== 'string' ||
    typeof state.condition !== 'string' ||
    !Array.isArray(state.horse.aptitude) ||
    !Array.isArray(state.contractedJockeyIds) ||
    !Number.isInteger(state.month) ||
    state.month < 1 ||
    !state.calendarDate ||
    !Number.isInteger(state.calendarDate.year) ||
    state.calendarDate.year < 1 ||
    !Number.isInteger(state.calendarDate.month) ||
    state.calendarDate.month < 1 ||
    state.calendarDate.month > 12 ||
    !Number.isInteger(state.careerTurnIndex) ||
    state.careerTurnIndex < 1 ||
    !Array.isArray(state.raceRecords) ||
    !state.values ||
    !Array.isArray(state.recent) ||
    state.recent.length > 3 ||
    (state.action !== null &&
      (!state.action || typeof state.action !== 'object' || Array.isArray(state.action)))
  ) {
    throw new Error('저장된 육성 데이터를 읽을 수 없습니다. 기존 저장은 유지됩니다.')
  }
  assertRaceRecords(state.raceRecords)
  if (state.jockeyTrust !== undefined) {
    assertJockeyRelations(state.jockeyTrust)
  }
  if (
    !state.horse.stats ||
    statKeys.some((key) => !Number.isFinite(state.horse.stats[key]) || state.horse.stats[key] < 0)
  ) {
    throw new Error('저장된 말의 능력치가 유효하지 않습니다.')
  }
  if (
    state.horse.aptitude.some(
      (row) =>
        !Array.isArray(row) || row.length !== 2 || row.some((item) => typeof item !== 'string'),
    ) ||
    state.contractedJockeyIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('저장된 말 또는 기수 정보가 유효하지 않습니다.')
  }
  for (const key of [...statKeys, 'fatigue', 'bodyLoad'] as (keyof Values)[]) {
    if (!Number.isFinite(state.values[key]) || state.values[key] < 0) {
      throw new Error('저장된 능력치가 유효하지 않습니다.')
    }
  }
  if (
    state.healthRecovery !== undefined &&
    (!Number.isFinite(state.healthRecovery) || state.healthRecovery < 0)
  ) {
    throw new Error('저장된 건강 상태가 유효하지 않습니다.')
  }
  assertEventState(state)
  if (state.raceRun !== undefined) {
    if (!state.raceRun || typeof state.raceRun !== 'object' || Array.isArray(state.raceRun)) {
      throw new Error('저장된 경주 정보가 유효하지 않습니다.')
    }
    assertRaceRun(state.raceRun, state)
  }
  for (const action of [...state.recent, ...(state.action ? [state.action] : [])]) {
    if (!action || typeof action !== 'object') {
      throw new Error('저장된 행동 기록이 유효하지 않습니다.')
    }
    if (
      !action.actionId ||
      action.horseId !== state.horse.id ||
      !Number.isInteger(action.month) ||
      !Number.isInteger(action.seed) ||
      !['training', 'rest', 'treatment'].includes(action.actionType) ||
      (action.actionType === 'training' && !statKeys.includes(action.trainingType!)) ||
      (action.result !== null &&
        (!Array.isArray(action.result) ||
          action.result.some(
            (c) =>
              !c ||
              typeof c !== 'object' ||
              !Object.hasOwn(labels, c.key) ||
              !Number.isFinite(c.before) ||
              !Number.isFinite(c.after),
          ))) ||
      (action.statusChanges !== undefined &&
        (!Array.isArray(action.statusChanges) ||
          action.statusChanges.some(
            (c) =>
              !c ||
              typeof c !== 'object' ||
              !Object.hasOwn(statusLabels, c.key) ||
              typeof c.before !== 'string' ||
              typeof c.after !== 'string',
          ))) ||
      (action.event !== undefined &&
        (!action.event ||
          typeof action.event !== 'object' ||
          typeof action.event.eventId !== 'string' ||
          ![action.event.growth, action.event.fatigue, action.event.bodyLoad].every(
            Number.isFinite,
          )))
    ) {
      throw new Error('저장된 행동 기록이 유효하지 않습니다.')
    }
  }
}
