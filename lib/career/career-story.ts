import { labels, statKeys, type ActionRecord, type Career, type Change } from './model'
import { calendarDate, type CalendarDate, type HorseRaceRecord } from './records'
import { defaultEventCatalog } from './events/repository'
import { careerJockeyRelations, type TrustEventChange } from './jockey-trust'

export type StoryKind =
  | 'start'
  | 'training'
  | 'rest'
  | 'treatment'
  | 'event'
  | 'race'
  | 'departure'
  | 'return'
  | 'retirement'
export type CareerStoryEntry = {
  id: string
  kind: StoryKind
  turn?: number
  date?: CalendarDate
  dateText?: string
  title: string
  details: string[]
  changes?: Change[]
  trustChanges?: TrustEventChange[]
  raceRunId?: string
}
export type CareerStory = {
  version: 1
  careerId: string
  horseId: string
  coverage: 'complete' | 'partial'
  initialStats?: Partial<Record<Change['key'], number>>
  entries: CareerStoryEntry[]
}
const order: Record<StoryKind, number> = {
  start: 0,
  departure: 1,
  event: 2,
  training: 3,
  rest: 3,
  treatment: 3,
  race: 4,
  return: 5,
  retirement: 6,
}
/** Equal-turn type/ID order is deterministic, not a claim about exact within-month chronology. */
export function sortStory(entries: readonly CareerStoryEntry[]) {
  const dateKey = (entry: CareerStoryEntry) => {
    if (entry.date) {
      return entry.date.year * 12 + entry.date.month
    }
    const match = /^(\d{4})[.-](\d{1,2})(?:$|[.-])/.exec(entry.dateText ?? '')
    return match ? Number(match[1]) * 12 + Number(match[2]) : null
  }
  return [...entries].sort((a, b) => {
    const first = dateKey(a)
    const second = dateKey(b)
    const difference =
      a.turn !== undefined && b.turn !== undefined
        ? a.turn - b.turn
        : first !== null && second !== null
          ? first - second
          : (a.turn ?? Number.MAX_SAFE_INTEGER) - (b.turn ?? Number.MAX_SAFE_INTEGER)
    return difference || order[a.kind] - order[b.kind] || a.id.localeCompare(b.id)
  })
}

export function storyDate(career: Pick<Career, 'calendarDate' | 'careerTurnIndex'>, turn: number) {
  return calendarDate(
    career.calendarDate.year,
    career.calendarDate.month - (career.careerTurnIndex - turn),
  )
}
export function actionStory(
  action: Pick<
    ActionRecord,
    'actionId' | 'month' | 'actionType' | 'trainingType' | 'result' | 'statusChanges'
  >,
  career: Pick<Career, 'calendarDate' | 'careerTurnIndex'>,
): CareerStoryEntry | null {
  if (action.result === null) {
    return null
  }
  return {
    id: `action:${action.actionId}`,
    kind: action.actionType,
    turn: action.month,
    date: storyDate(career, action.month),
    title:
      action.actionType === 'training'
        ? `${action.trainingType ? labels[action.trainingType] : ''} 훈련`
        : action.actionType === 'rest'
          ? '휴식'
          : '치료',
    changes: structuredClone(action.result),
    details: (action.statusChanges ?? []).map(
      (change) =>
        `${change.key === 'health' ? '건강' : change.key === 'recovery' ? '회복 필요량' : '컨디션'} ${change.before} → ${change.after}`,
    ),
  }
}
export function raceStory(record: HorseRaceRecord, index = 0): CareerStoryEntry {
  const trust = record.trustChange
  const confirmedTrust =
    trust &&
    [trust.before, trust.after, trust.delta].every(Number.isFinite) &&
    trust.delta === trust.after - trust.before
  return {
    id: `race:${record.raceRunId ?? `${record.date}:${index}`}`,
    kind: 'race',
    turn: record.month,
    dateText: record.date,
    title: `${record.race} · ${record.result}`,
    raceRunId: record.raceRunId,
    details: [
      record.prizeMoney === undefined
        ? '상금 기록 없음'
        : `확정 상금 ₩${record.prizeMoney.toLocaleString('ko-KR')}`,
      ...(record.jockeyName || record.jockeyId
        ? [`기수 ${record.jockeyName ?? record.jockeyId}`]
        : []),
      ...(confirmedTrust && trust
        ? [
            `경주 신뢰도 ${trust.before} → ${trust.after} (${trust.delta > 0 ? '+' : ''}${trust.delta})`,
          ]
        : []),
    ],
  }
}
export function newStory(career: Career, careerId: string, started = false): CareerStory {
  return {
    version: 1,
    careerId,
    horseId: career.horse.id,
    coverage: started ? 'complete' : 'partial',
    ...(started
      ? { initialStats: Object.fromEntries(statKeys.map((key) => [key, career.values[key]])) }
      : {}),
    entries: started
      ? [
          {
            id: 'start',
            kind: 'start',
            turn: career.careerTurnIndex,
            date: career.calendarDate,
            title: '육성 시작',
            details: ['실제로 육성을 시작할 때 저장한 기록입니다.'],
          },
        ]
      : [],
  }
}
/** Only saved rows are imported. No event redraw, travel inference or initial-stat reconstruction. */
export function captureCareer(
  story: CareerStory,
  career: Career,
  before?: Career | null,
): CareerStory {
  const entries = new Map(story.entries.map((entry) => [entry.id, entry]))
  for (const action of [...career.recent, ...(career.action ? [career.action] : [])]) {
    const entry = actionStory(action, career)
    if (entry && !entries.has(entry.id)) {
      entries.set(entry.id, entry)
    }
  }
  career.raceRecords.forEach((record, i) => {
    const entry = raceStory(record, i)
    if (!entries.has(entry.id)) {
      entries.set(entry.id, entry)
    }
  })
  for (const event of [...(career.eventLog ?? []), ...(career.event ? [career.event] : [])]) {
    const id = `event:${event.month}:${event.eventId}`
    const old = entries.get(id)
    const state = {
      offered: '제시됨 · 아직 적용되지 않음',
      chosen: '선택 확정 · 행동 보정 적용 여부는 행동 결과 참고',
      applied: '적용 기록 있음',
      expired: event.choice
        ? '선택 후 행동 보정 만료 · 확정된 즉시 변화는 별도 기록'
        : '미선택·만료',
    }[event.status]
    const entry: CareerStoryEntry = {
      ...old,
      id,
      kind: 'event',
      turn: event.month,
      date: storyDate(career, event.month),
      title:
        old?.title ??
        (event.month < career.month
          ? `이벤트 ${event.eventId}`
          : (defaultEventCatalog.find(event.eventId)?.name ?? event.eventId)),
      details: [
        `월간 이벤트 · ${state}`,
        ...(event.choice ? [`선택 ${event.choice}`] : []),
        ...(old?.details.filter((text) => text.startsWith('확인된 행동 보정')) ?? []),
      ],
    }
    const applied = [...career.recent, ...(career.action ? [career.action] : [])].find(
      (action) => action.month === event.month && action.event?.eventId === event.eventId,
    )?.event
    if (applied) {
      entry.details = entry.details
        .filter((text) => !text.startsWith('확인된 행동 보정'))
        .concat(
          '확인된 행동 보정: 이벤트 적용 기록이 있습니다. 상·하한을 반영한 실제 변화량은 같은 턴의 행동 결과에서 확인하세요.',
        )
    }
    const selectedNow =
      before &&
      (event.status === 'chosen' || event.status === 'applied') &&
      before.event?.status === 'offered' &&
      before.event.eventId === event.eventId &&
      before.month === career.month &&
      !before.action &&
      !career.action
    const resolvedNow =
      before?.action &&
      before.action.result === null &&
      career.action?.actionId === before.action.actionId &&
      career.action.result !== null &&
      career.action.event?.eventId === event.eventId &&
      career.action.month === event.month
    if (selectedNow) {
      entry.changes = (['fatigue', 'bodyLoad'] as const)
        .filter((key) => before.values[key] !== career.values[key])
        .map((key) => ({ key, before: before.values[key], after: career.values[key] }))
    }
    if (selectedNow || resolvedNow) {
      entry.trustChanges = measuredTrustChanges(before!, career)
    }
    entries.set(id, entry)
  }
  return { ...story, entries: sortStory([...entries.values()]) }
}
function measuredTrustChanges(before: Career, after: Career): TrustEventChange[] {
  const prior = careerJockeyRelations(before)
  const next = careerJockeyRelations(after)
  return Object.entries(next).flatMap(([jockeyId, relation]) => {
    const value = prior[jockeyId]?.trust ?? 0
    return value !== relation.trust
      ? [{ jockeyId, before: value, after: relation.trust, delta: relation.trust - value }]
      : []
  })
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
export function assertCareerStory(value: unknown): asserts value is CareerStory {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.careerId !== 'string' ||
    !value.careerId ||
    typeof value.horseId !== 'string' ||
    !['complete', 'partial'].includes(String(value.coverage)) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error('저장된 육성 이야기 형식이 유효하지 않습니다. 기존 기록은 유지됩니다.')
  }
  if (
    value.initialStats !== undefined &&
    (!object(value.initialStats) ||
      Object.entries(value.initialStats).some(
        ([key, n]) => !statKeys.includes(key as (typeof statKeys)[number]) || !finite(n),
      ))
  ) {
    throw new Error('최초 능력치 기록이 유효하지 않습니다.')
  }
  const ids = new Set<string>()
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      !Object.hasOwn(order, String(entry.kind)) ||
      typeof entry.title !== 'string' ||
      !Array.isArray(entry.details) ||
      entry.details.some((text) => typeof text !== 'string') ||
      (entry.turn !== undefined && (!Number.isSafeInteger(entry.turn) || Number(entry.turn) < 1))
    ) {
      throw new Error('육성 이야기 항목이 유효하지 않습니다.')
    }
    ids.add(entry.id)
    if (
      entry.date !== undefined &&
      (!object(entry.date) ||
        !Number.isSafeInteger(entry.date.year) ||
        Number(entry.date.year) < 1 ||
        !Number.isInteger(entry.date.month) ||
        Number(entry.date.month) < 1 ||
        Number(entry.date.month) > 12)
    ) {
      throw new Error('육성 이야기 날짜가 유효하지 않습니다.')
    }
    for (const key of ['dateText', 'raceRunId']) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        throw new Error('육성 이야기 식별자가 유효하지 않습니다.')
      }
    }
    if (
      entry.changes !== undefined &&
      (!Array.isArray(entry.changes) ||
        entry.changes.some(
          (change) =>
            !object(change) ||
            !Object.hasOwn(labels, String(change.key)) ||
            !finite(change.before) ||
            !finite(change.after),
        ))
    ) {
      throw new Error('육성 변화 기록이 유효하지 않습니다.')
    }
    if (
      entry.trustChanges !== undefined &&
      (!Array.isArray(entry.trustChanges) ||
        entry.trustChanges.some(
          (change) =>
            !object(change) ||
            typeof change.jockeyId !== 'string' ||
            !finite(change.before) ||
            !finite(change.after) ||
            !finite(change.delta) ||
            change.delta !== Number(change.after) - Number(change.before),
        ))
    ) {
      throw new Error('신뢰도 변화 기록이 유효하지 않습니다.')
    }
  }
}
