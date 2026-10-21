'use client'

import { useCareer, stableTravel, stableFunds } from '@/lib/career/store'
import {
  localRacesForTurn,
  raceEligibility,
  entryRestriction,
  raceMonths,
  nextSeasonRaceTurn,
  careerProgress,
  CAREER_SEASON_TURNS,
  careerOutlook,
  type Readiness,
} from '@/packages/shared/src/domain'
import { countryName } from '@/lib/career/local-travel'
import { CareerProgressView, SeasonSummary } from './career-progress'
import { CalendarClock, Flag, HeartPulse, TrendingUp } from 'lucide-react'
import type { Career } from '@/lib/career/model'
import { cn } from '@/lib/utils'

const readinessTone: Record<Readiness['level'], string> = {
  ready: 'text-sage',
  caution: 'text-primary',
  blocked: 'text-rose',
}

export function MonthOutlook({ career }: { career: Career }) {
  const state = useCareer()
  const travel = stableTravel(state)
  const { progress, nextRace, readiness, growth } = careerOutlook(career, {
    availableFunds: stableFunds(state) ?? undefined,
    travel: travel ?? undefined,
  })
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
  const raceCountries = (turn: number) =>
    [
      ...new Set(
        (state.mode === 'server' && turn === career.careerTurnIndex && state.raceOptions
          ? state.raceOptions.races.map((row) => row.definition)
          : localRacesForTurn(turn)
        ).map((race) => countryName(race.countryCode ?? 'KOR')),
      ),
    ].join(' · ')
  const nextSeasonStart = nextSeasonRaceTurn(progress.turn, [CAREER_SEASON_TURNS])! + 1
  const nextSeason = careerProgress(nextSeasonStart)
  const seasonSchedule = raceMonths.map((month) => nextSeasonRaceTurn(nextSeasonStart, [month])!)
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
          <dd>
            <CareerProgressView progress={progress} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Flag size={13} aria-hidden />
            다음 경주
          </dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums">
            {nextRace ? `${nextRace.month}턴 · ${raceLine}` : raceLine}
          </dd>
          {nextRace && (
            <p className="mt-0.5 text-muted-foreground">
              <SeasonSummary progress={careerProgress(nextRace.month)} showAge={false} /> · 개최국{' '}
              {raceCountries(nextRace.month)}
            </p>
          )}
          {nextRace && (
            <p className="mt-0.5 text-muted-foreground">
              {current
                ? count
                  ? `현재 출전 가능 ${count}개`
                  : '출전 조건 확인 중…'
                : `현재 조건 기준 전망 ${nextRace.openRaces} / ${nextRace.totalRaces}개 · 출전 시 국가·전적·잔액 조건을 다시 확인합니다.`}
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
      <details className="mt-3 border-t border-border pt-3 text-xs">
        <summary className="cursor-pointer font-semibold">
          다음 시즌 게임용 경주 일정 · {nextSeason.seasonIndex}년 차
        </summary>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {seasonSchedule.map((turn) => (
            <li key={turn}>
              {turn}턴 · <SeasonSummary progress={careerProgress(turn)} showAge={false} /> · 개최국{' '}
              {raceCountries(turn)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">
          기존 게임용 경주의 반복 일정입니다. 공식 참고 카탈로그와 별개이며 실제 출전 자격은 해당
          턴의 건강·계약·전적·자금·체류 상태로 확인합니다.
        </p>
      </details>
    </section>
  )
}
