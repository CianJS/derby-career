import type { DerbyApiClient } from '../../packages/shared/src/client'
import { validHistory, type HistoryData, type HistoryPath } from './history-validation'
import {
  actionStory,
  raceStory,
  sortStory,
  storyDate,
  type CareerStoryEntry,
} from '../career/career-story'
import { countryName } from '../career/local-travel'
import type { components } from '../../packages/shared/src/generated/api'

type Models = components['schemas']
type HistoryApi = Pick<
  DerbyApiClient,
  'listActions' | 'listCareerEvents' | 'listRecords' | 'getExpeditionHistory' | 'getRetirement'
>
/** Read every page until an empty page; abort stale UI selections between requests. */
export async function readCareerStory(
  api: HistoryApi,
  careerId: string,
  retired: boolean,
  current: () => boolean = () => true,
): Promise<HistoryData> {
  const result: HistoryData = { actions: [], events: [], records: [], expeditions: [] }
  async function pages<T>(
    path: HistoryPath,
    load: (page: number) => Promise<{ data: T[]; page: number; pageSize: number }>,
  ): Promise<T[]> {
    const rows: T[] = []
    for (let page = 1; page <= 100000; page += 1) {
      if (!current()) {
        throw new Error('선택한 육성 기록이 변경되었습니다.')
      }
      const value = await load(page)
      if (!validHistory(path, value, careerId, page, 20)) {
        throw new Error('육성 이력 응답을 확인하지 못했습니다.')
      }
      if (!value.data.length) {
        return rows
      }
      rows.push(...value.data)
    }
    throw new Error('이력 마지막 페이지를 확인하지 못했습니다.')
  }
  const [actions, events, records, expeditions, retirement] = await Promise.all([
    pages('actions', (page) => api.listActions(careerId, { page, pageSize: 20 })),
    pages('events', (page) => api.listCareerEvents(careerId, { page, pageSize: 20 })),
    pages('records', (page) => api.listRecords(careerId, { page, pageSize: 20 })),
    pages('expeditions/history', (page) =>
      api.getExpeditionHistory(careerId, { page, pageSize: 20 }),
    ),
    retired ? api.getRetirement(careerId) : undefined,
  ])
  if (!current()) {
    throw new Error('선택한 육성 기록이 변경되었습니다.')
  }
  if (retirement && !validHistory('retirement', retirement, careerId)) {
    throw new Error('은퇴 기록의 육성 식별자가 일치하지 않습니다.')
  }
  return { ...result, actions, events, records, expeditions, retirement: retirement?.retirement }
}
export function serverStoryEntries(
  data: HistoryData,
  career: Models['Career'],
): CareerStoryEntry[] {
  const state = data.retirement?.snapshot.state ?? career.state
  const entries: CareerStoryEntry[] = []
  for (const row of data.actions) {
    if (row.kind === 'race') {
      continue
    } // The records endpoint supplies the actual race identity/rewards.
    const record = row.record
    if (row.result && 'changes' in row.result) {
      const entry = actionStory(
        {
          actionId: row.id,
          month: row.turn,
          actionType: row.kind,
          trainingType: record?.trainingType ?? null,
          result: row.result.changes,
          statusChanges: row.result.statusChanges,
        },
        state,
      )
      if (entry) {
        entries.push({ ...entry, id: `action:${row.id}` })
      }
    } else {
      entries.push({
        id: `action:${row.id}`,
        kind: row.kind,
        turn: row.turn,
        date: storyDate(state, row.turn),
        title: `${row.kind === 'training' ? '훈련' : row.kind === 'rest' ? '휴식' : '치료'} 기록`,
        details: ['실행 결과 미확인 · 성장·회복 완료로 표시하지 않습니다.'],
      })
    }
  }
  for (const event of data.events) {
    const confirmed =
      event.state !== 'pending' &&
      event.result !== null &&
      (event.choiceId !== null || event.state === 'applied')
    const label = {
      pending: '제시됨 · 미선택',
      selected: '선택됨 · 저장된 즉시 결과만 표시, 행동 보정 확정 전',
      applied: event.result ? '적용됨' : '적용 상태 · 결과 없음',
      expired: event.choiceId
        ? '선택 후 행동 보정 만료 · 저장된 즉시 결과는 별도 표시'
        : '미선택·만료',
    }[event.state]
    const choice = event.choiceId
      ? event.definition.choices.find((option) => option.id === event.choiceId)
      : undefined
    entries.push({
      id: `event:${event.id}`,
      kind: 'event',
      turn: event.turn,
      date: storyDate(state, event.turn),
      title: event.definition.name,
      details: [
        `월간 이벤트 · ${label}`,
        ...(event.choiceId
          ? [`실제 선택 ${event.choiceId}${choice ? ` · ${choice.label}` : ''}`]
          : []),
        ...(confirmed && event.result?.actionChanges?.length
          ? ['행동 보정은 해당 행동의 최종 변화량에 포함되어 있습니다.']
          : []),
      ],
      ...(confirmed
        ? { changes: event.result!.changes, trustChanges: event.result!.trustChanges }
        : {}),
    })
  }
  data.records.forEach((record, i) => entries.push(raceStory(record, i)))
  for (const trip of data.expeditions) {
    entries.push({
      id: `departure:${trip.id}`,
      kind: 'departure',
      turn: trip.startedTurn,
      date: storyDate(state, trip.startedTurn),
      title: `${countryName(trip.targetCountry)} 원정 출발`,
      details: [],
    })
    if (trip.status === 'returned' && trip.endedTurn !== null) {
      entries.push({
        id: `return:${trip.id}`,
        kind: 'return',
        turn: trip.endedTurn,
        date: storyDate(state, trip.endedTurn),
        title: `${countryName(trip.targetCountry)} 원정 ${trip.endReason === 'retirement' ? '은퇴로 종료' : '귀국'}`,
        details: [trip.endReason === 'retirement' ? '은퇴에 따른 자동 종료' : '귀국 명령으로 종료'],
      })
    }
  }
  if (data.retirement) {
    entries.push({
      id: `retirement:${data.retirement.careerId}`,
      kind: 'retirement',
      turn: state.careerTurnIndex,
      date: data.retirement.retiredOn,
      title: '은퇴',
      details: ['저장된 수동 은퇴 스냅샷입니다.'],
    })
  }
  return sortStory([...new Map(entries.map((entry) => [entry.id, entry])).values()])
}
