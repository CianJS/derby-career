'use client'

import { useCareer, stableTravel, stableFunds } from '@/lib/career/store'
import { localRacesForTurn, raceEligibility, entryRestriction } from '@/lib/career/race-entry'
import { CalendarClock, Flag, HeartPulse, TrendingUp } from 'lucide-react'
import { careerOutlook, type Readiness } from '@/lib/career/outlook'
import type { Career } from '@/lib/career/model'
import { cn } from '@/lib/utils'

const readinessTone: Record<Readiness['level'], string> = {
  ready: 'text-sage',
  caution: 'text-primary',
  blocked: 'text-rose',
}

export function MonthOutlook({ career }: { career: Career }) {
  const { month, yearMonths, nextRace, readiness, growth } = careerOutlook(career)
  const state = useCareer()
  const travel = stableTravel(state)
  const current = nextRace?.monthsAway === 0
  const localRaces = localRacesForTurn(career.careerTurnIndex)
  const count =
    state.mode === 'server'
      ? state.raceOptions
        ? `${state.raceOptions.races.filter((row) => row.eligible).length} / ${state.raceOptions.races.length}`
        : null
      : state.mode === 'local'
        ? travel
          ? `${entryRestriction(career, stableFunds(state) ?? undefined, travel) ? 0 : localRaces.filter((race) => !raceEligibility(career, race, stableFunds(state) ?? undefined, travel)).length} / ${localRaces.length}`
          : null
        : nextRace
          ? `${nextRace.openRaces} / ${nextRace.totalRaces}`
          : null
  const progress = Math.min(100, (month / yearMonths) * 100)
  const raceLine = !nextRace
    ? '예정된 경주가 없습니다.'
    : nextRace.monthsAway === 0
      ? '이번 달'
      : `${nextRace.monthsAway}개월 뒤`
  return (
    <section aria-labelledby="month-outlook" className="lab-recent px-4 py-3 md:px-5">
      <div className="flex items-baseline gap-3">
        <h2 id="month-outlook" className="text-sm font-bold">
          월간 정보
        </h2>
        <p className="ui-label">MONTH OUTLOOK</p>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-3 text-xs md:grid-cols-4">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock size={13} aria-hidden />
            육성 진행
          </dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {month} / {yearMonths}개월
          </dd>
          <div aria-hidden className="lab-meter mt-1.5">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Flag size={13} aria-hidden />
            다음 경주
          </dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {nextRace ? `${nextRace.month}개월 차 · ${raceLine}` : raceLine}
          </dd>
          {nextRace && (
            <p className="mt-0.5 text-muted-foreground">
              {current
                ? count
                  ? `현재 출전 가능 ${count}개`
                  : '출전 조건 확인 중…'
                : '출전 시 국가·전적·잔액 조건을 확인합니다.'}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <HeartPulse size={13} aria-hidden />
            출전 준비 상태
          </dt>
          <dd className={cn('mt-1 text-sm font-semibold', readinessTone[readiness.level])}>
            {readiness.label}
          </dd>
          <p className="mt-0.5 text-muted-foreground">{readiness.detail}</p>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp size={13} aria-hidden />
            최근 성장
          </dt>
          {growth.length ? (
            <dd>
              <ul className="mt-1 flex flex-col gap-0.5">
                {growth.map((item) => (
                  <li key={`${item.month}-${item.name}`} className="truncate">
                    <span className="text-muted-foreground">Month {item.month}</span>{' '}
                    {item.changes.length ? item.changes.join(' · ') : item.name}
                  </li>
                ))}
              </ul>
            </dd>
          ) : (
            <dd className="mt-1 text-muted-foreground">아직 기록이 없습니다.</dd>
          )}
        </div>
      </dl>
    </section>
  )
}
