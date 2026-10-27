'use client'
import { useState } from 'react'
import { labels, statKeys } from '@/lib/career/model'
import { summarizeRecords } from '@/lib/career/records'
import { useCareerStory } from '@/lib/career/use-career-story'
import type { CareerStoryEntry, StoryKind } from '@/lib/career/career-story'
import type { CareerHorse } from './legacy-types'
import { EventTrustChanges } from './jockey-trust'

const kindLabels: Record<StoryKind, string> = {
  start: '육성',
  training: '훈련',
  rest: '휴식',
  treatment: '치료',
  event: '월간 이벤트',
  race: '경주',
  departure: '원정',
  return: '원정 종료',
  retirement: '은퇴',
}
export function CareerTimeline({
  horse,
  archived = false,
  selectedRaceRunId,
}: {
  horse: CareerHorse
  archived?: boolean
  selectedRaceRunId?: string
}) {
  const data = useCareerStory(horse, archived)
  return (
    <TimelineContent
      key={data.key}
      horse={horse}
      data={data}
      selectedRaceRunId={selectedRaceRunId}
    />
  )
}
function TimelineContent({
  horse,
  data,
  selectedRaceRunId,
}: {
  horse: CareerHorse
  data: ReturnType<typeof useCareerStory>
  selectedRaceRunId?: string
}) {
  const [visible, setVisible] = useState(20)
  const selectedIndex = selectedRaceRunId
    ? data.entries.findIndex((entry) => entry.raceRunId === selectedRaceRunId)
    : -1
  const shown = Math.max(visible, selectedIndex + 1)
  const summary = summarizeRecords(horse.raceRecords)
  if (data.status === 'loading') {
    return (
      <p role="status" className="py-4 text-sm">
        육성 이력의 전체 페이지를 불러오는 중…
      </p>
    )
  }
  if (data.status === 'unavailable') {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        육성 식별자를 확인하지 못해 이력을 표시할 수 없습니다.
      </p>
    )
  }
  if (data.status === 'error') {
    return (
      <div className="py-4">
        <p role="alert" className="text-sm">
          {data.error}
        </p>
        <button
          onClick={data.retry}
          className="ui-secondary-control mt-3 rounded-lg border border-border px-4 py-2 text-sm"
        >
          육성 이력 다시 조회
        </button>
      </div>
    )
  }
  const gains = Object.fromEntries(
    statKeys.map((key) => [
      key,
      data.entries
        .filter((entry) => entry.kind === 'training')
        .reduce(
          (sum, entry) =>
            sum +
            (entry.changes ?? [])
              .filter((change) => change.key === key)
              .reduce((n, change) => n + change.after - change.before, 0),
          0,
        ),
    ]),
  )
  const hasTraining = data.entries.some((entry) => entry.kind === 'training' && entry.changes)
  return (
    <div data-career-story={data.key} className="min-w-0 space-y-5 text-sm">
      <p className="leading-7 text-muted-foreground">
        {data.server
          ? '선택한 Career의 서버 이력 전체 페이지를 확인했습니다. 저장되기 전 누락된 사건이나 최초 능력치는 복원하지 않습니다.'
          : data.story?.coverage === 'complete'
            ? '육성 시작부터 성공적으로 저장한 실제 사건을 보존합니다.'
            : '부분 기록입니다. 이전 저장에 없거나 이미 잘린 행동·이벤트·원정 및 육성 시작 시점은 복원할 수 없습니다.'}
      </p>
      <p className="leading-7">
        확인된 출전 {summary.totalStarts}회 · {summary.wins}승 · 2착 {summary.seconds}회 · 3착{' '}
        {summary.thirds}회 · 확정 누적 상금 ₩{summary.totalPrizeMoney.toLocaleString('ko-KR')}
      </p>
      {data.story?.initialStats ? (
        <div>
          <p className="font-semibold">실제로 저장한 최초 능력치 → 현재 스냅샷</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {statKeys.map((key) => {
              const first = data.story!.initialStats![key]
              const final = horse.stats.find(([label]) => label === labels[key])?.[1]
              return first !== undefined && final !== undefined ? (
                <li key={key}>
                  {labels[key]} {first} → {final} ({final - first > 0 ? '+' : ''}
                  {final - first})
                </li>
              ) : null
            })}
          </ul>
        </div>
      ) : hasTraining ? (
        <div>
          <p className="font-semibold">기록에 남은 훈련 최종 변화 합계</p>
          <p className="mt-1 text-muted-foreground">
            이벤트 보정 포함 · 전체 기간의 성장량이나 최초 대비 수치가 아닙니다.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {statKeys.map((key) => (
              <li key={key}>
                {labels[key]} {gains[key] > 0 ? '+' : ''}
                {gains[key]}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">
          확인 가능한 최초 능력치·훈련 결과가 없어 성장 비교를 생략합니다.
        </p>
      )}
      <p className="text-xs leading-6 text-muted-foreground">
        같은 턴은 유형과 원본 ID 순으로 정렬합니다. 월 안의 실제 실행 순서를 뜻하지 않습니다.
        신뢰도는 저장된 변화만 표시하며 경주·행동에 포함된 이벤트 보정은 다시 합산하지 않습니다.
        {data.server && ' 현역의 여러 페이지 조회 중 새 행동이 발생하면 다시 조회해 주세요.'}
      </p>
      {data.entries.length ? (
        <>
          <p className="text-muted-foreground">
            총 {data.entries.length}건 중 {Math.min(shown, data.entries.length)}건 표시
          </p>
          <ol aria-label="실제 육성 사건 타임라인" className="space-y-3">
            {data.entries.slice(0, shown).map((entry) => (
              <StoryCard
                key={entry.id}
                entry={entry}
                selected={!!selectedRaceRunId && entry.raceRunId === selectedRaceRunId}
              />
            ))}
          </ol>
          {shown < data.entries.length && (
            <button
              onClick={() => setVisible(shown + 20)}
              className="ui-secondary-control rounded-lg border border-border px-4 py-3"
            >
              기록 더 보기
            </button>
          )}
        </>
      ) : (
        <p className="py-4 text-muted-foreground">
          확인 가능한 사건 기록이 없습니다. 기록이 없는 기간에 사건이 없었다고 단정할 수 없습니다.
        </p>
      )}
    </div>
  )
}
function StoryCard({ entry, selected }: { entry: CareerStoryEntry; selected: boolean }) {
  const when = entry.date
    ? `${entry.date.year}.${String(entry.date.month).padStart(2, '0')}`
    : entry.dateText
  return (
    <li
      data-story-id={entry.id}
      data-story-race-run-id={entry.raceRunId}
      data-selected-story={selected || undefined}
      className={`min-w-0 rounded-xl border p-4 leading-7 [overflow-wrap:anywhere] ${selected || ['treatment', 'departure', 'retirement'].includes(entry.kind) ? 'border-primary/60 bg-primary/5' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{kindLabels[entry.kind]}</span>
        {entry.turn && <span>육성 {entry.turn}턴</span>}
        {when && (
          <time
            dateTime={
              entry.date
                ? `${entry.date.year}-${String(entry.date.month).padStart(2, '0')}`
                : undefined
            }
          >
            {when}
          </time>
        )}
      </div>
      <p className="mt-1 font-semibold text-foreground">{entry.title}</p>
      {entry.details.map((detail, i) => (
        <p key={i} className="text-muted-foreground">
          {detail}
        </p>
      ))}
      {!!entry.changes?.length && (
        <ul aria-label="실제로 확정된 변화" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {entry.changes.map((change, i) => (
            <li key={i}>
              {labels[change.key]} {change.before} → {change.after} (
              {change.after - change.before > 0 ? '+' : ''}
              {change.after - change.before})
            </li>
          ))}
        </ul>
      )}
      <EventTrustChanges changes={entry.trustChanges} />
    </li>
  )
}
