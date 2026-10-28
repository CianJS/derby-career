'use client'

import type { ReactNode } from 'react'
import { careerProgress } from '@/packages/shared/src/domain'
import { SeasonSummary } from './career-progress'
import { actionName, actionSummary } from '@/lib/career/model'
import { careerStore, useCareer } from '@/lib/career/store'
import { InitialJockeyGate } from './starter-jockey-selection'
import { HorseSelection } from './horse-selection'
import { HorseFocus } from './horse-focus'
import { MonthlyDecision } from './monthly-decision'
import { MonthOutlook } from './month-outlook'

export function CareerCheckpoint({
  onHome,
  raceEntry,
  horseSummary,
  selectionHistoryUnknown,
  expedition,
}: {
  onHome: () => void
  onHorse: () => void
  raceEntry: ReactNode
  horseSummary?: ReactNode
  selectionHistoryUnknown?: boolean
  expedition?: ReactNode
}) {
  const { ready, career, busy, pending, error } = useCareer()
  const activities = career
    ? [
        ...career.raceRecords.map((record) => ({
          key: `race-${record.raceRunId ?? record.date}`,
          month: record.month ?? 0,
          label: record.month ? `${record.month}턴` : record.date,
          title: `${record.race} · ${record.result}`,
          detail: `상금 ₩${(record.prizeMoney ?? 0).toLocaleString('ko-KR')}`,
          race: true,
        })),
        ...[...(career.action?.result ? [career.action] : []), ...career.recent].map((action) => ({
          key: action.actionId,
          month: action.month,
          label: `${action.month}턴`,
          title: actionName(action),
          detail: actionSummary(action),
          race: false,
        })),
      ]
        .sort((a, b) => b.month - a.month || Number(b.race) - Number(a.race))
        .slice(0, 3)
    : []
  return (
    <div className="lab-training training-workspace">
      <div className="mx-auto max-w-[1380px] px-4 py-4 md:px-8">
        <button
          onClick={onHome}
          className="mb-2 text-xs text-muted-foreground hover:text-foreground"
        >
          ← 홈
        </button>
        {error && (
          <div role="alert" className="ui-error-state mb-5">
            <span>{error}</span>
            <button
              disabled={busy}
              onClick={() => void careerStore.refresh()}
              className="ui-secondary-control rounded-lg border border-border px-4 py-2 text-xs"
            >
              다시 불러오기
            </button>
            <a href="/" target="_blank" rel="noreferrer" className="text-xs underline">
              새 탭에서 열기
            </a>
          </div>
        )}
        {!ready ? (
          <p role="status" className="py-16 text-center text-sm text-muted-foreground">
            육성 기록을 불러오는 중…
          </p>
        ) : !career ? (
          error ? null : (
            <InitialJockeyGate busy={busy || pending}>
              {(starterJockeyId) => (
                <HorseSelection
                  busy={busy || pending}
                  starterJockeyId={starterJockeyId}
                  historyUnknown={selectionHistoryUnknown}
                />
              )}
            </InitialJockeyGate>
          )
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h1 className="text-2xl font-bold">이번 달 육성</h1>
                <p className="text-sm text-muted-foreground">
                  {career.calendarDate.year}년 {career.calendarDate.month}월 · 육성{' '}
                  {career.careerTurnIndex}턴 ·{' '}
                  <SeasonSummary progress={careerProgress(career.careerTurnIndex)} /> ·{' '}
                  {career.raceRun
                    ? '출전 확정 · 관전 대기'
                    : career.action?.result
                      ? '결과 저장 · 다음 달 진행'
                      : career.action
                        ? '행동 확정 · 저장 결과 확인 중'
                        : '행동 하나를 선택하세요'}
                </p>
              </div>
            </div>
            <div className="training-dashboard">
              {horseSummary ?? <HorseFocus career={career} />}
              <MonthlyDecision
                key={`${career.horse.id}:${career.month}`}
                career={career}
                busy={busy || pending}
                raceEntry={raceEntry}
              />
              <div className="training-information">
                <MonthOutlook career={career} />
                {expedition}
              </div>
              <details className="training-recent lab-recent px-4 py-3 md:px-5">
                <summary id="recent-activity" className="cursor-pointer text-sm font-semibold">
                  최근 활동
                </summary>
                {activities.length ? (
                  <ul className="mt-2 grid gap-x-6 gap-y-2 md:grid-cols-3">
                    {activities.map((item) => (
                      <li key={item.key} className="min-w-0 text-xs">
                        <p className="truncate">
                          <span className="text-muted-foreground">{item.label}</span>{' '}
                          <span
                            className={`ml-1 text-sm ${item.race ? 'font-semibold text-primary' : 'font-medium'}`}
                          >
                            {item.title}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-muted-foreground">{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    아직 완료한 월간 기록이 없습니다.
                  </p>
                )}
              </details>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
