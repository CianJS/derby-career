'use client'

import {
  careerProgress,
  contractedRoster,
  entryRestriction,
  localRacesForTurn,
  nextSeasonRaceTurn,
  raceEligibility,
  raceMonths,
  type Career,
  type RaceDefinitionSnapshot,
} from '@/packages/shared/src/domain'
import { countryName, type StableTravel } from '@/lib/career/local-travel'
import { stableTravel, useCareer } from '@/lib/career/store'
import { SeasonSummary } from './career-progress'

/** Presentation only. No hypothetical arrival or future eligibility is ever written to a Save. */
export function expeditionSchedule(
  career: Career,
  travel: StableTravel,
  country: string,
  funds?: number,
) {
  const currentTurn = career.careerTurnIndex
  const nextGlobal = nextSeasonRaceTurn(
    currentTurn + (career.action || career.raceRun ? 1 : 0),
    raceMonths,
  )
  const slots = raceMonths.filter((turn) =>
    localRacesForTurn(turn).some((race) => race.countryCode === country),
  )
  const nextLocal = nextSeasonRaceTurn(currentTurn + 1, slots)
  const at = (turn: number) => {
    const projected =
      turn === currentTurn
        ? career
        : {
            ...career,
            month: turn,
            careerTurnIndex: turn,
            age: careerProgress(turn).age,
            action: null,
            raceRun: undefined,
          }
    // Only location is projected for an arrival preview; no expedition, cost, result or approval is invented.
    const arrival = { ...travel, locationCountry: country }
    return localRacesForTurn(turn)
      .filter((race) => race.countryCode === country)
      .map((race) => ({
        race,
        reason:
          raceEligibility(projected, race, funds, arrival) ??
          entryRestriction(projected, funds, arrival) ??
          (contractedRoster(projected).length ? null : '계약 기수가 없습니다.'),
      }))
  }
  return { currentTurn, nextGlobal, nextLocal, at }
}

export function countryMismatch(
  travel: StableTravel | undefined | null,
  races: readonly RaceDefinitionSnapshot[],
) {
  if (
    !travel ||
    !races.length ||
    races.some((race) => (race.countryCode ?? 'KOR') === travel.locationCountry)
  ) {
    return null
  }
  const countries = [...new Set(races.map((race) => countryName(race.countryCode ?? 'KOR')))].join(
    ' · ',
  )
  return `현재 체류 국가(${countryName(travel.locationCountry)})와 표시된 게임 경주의 개최 국가(${countries})가 맞지 않습니다. 전적 부족과 별개로 국가 조건을 확인해야 합니다.`
}

export function TravelRaceNotice({
  races,
  travel: provided,
}: {
  races: readonly RaceDefinitionSnapshot[]
  travel?: StableTravel
}) {
  const snapshot = useCareer()
  const travel = provided ?? stableTravel(snapshot)
  const message = countryMismatch(travel, races)
  return message ? (
    <div role="status" className="mt-2 text-xs text-muted-foreground">
      <p>{message}</p>
      <a
        className="mt-1 inline-block font-semibold text-primary underline"
        href="#career-expedition"
      >
        {travel?.activeExpedition ? '귀국·원정 상태 보기' : '원정 상태 보기'}
      </a>
    </div>
  ) : null
}

export function ExpeditionAvailability({
  career,
  travel,
  country,
  funds,
  serverRaces,
}: {
  career: Career
  travel: StableTravel
  country: string
  funds?: number
  serverRaces?:
    | readonly {
        definition: RaceDefinitionSnapshot
        eligible: boolean
        restrictionReason: string | null
      }[]
    | null
}) {
  const plan = expeditionSchedule(career, travel, country, funds)
  const server = serverRaces !== undefined
  const currentRows = server
    ? (serverRaces ?? [])
        .filter((row) => (row.definition.countryCode ?? 'KOR') === country)
        .map((row) => ({
          race: row.definition,
          reason: row.eligible ? null : (row.restrictionReason ?? '서버 출전 조건 미충족'),
        }))
    : plan.at(plan.currentTurn)
  const groups = [
    {
      label: '현재 턴',
      turn: plan.currentTurn,
      rows: currentRows,
      known: !server || serverRaces !== null,
    },
    ...[
      ...new Set(
        [plan.nextGlobal, plan.nextLocal].filter(
          (turn): turn is number => turn !== null && turn !== plan.currentTurn,
        ),
      ),
    ].map((turn) => ({
      label: turn === plan.nextGlobal ? '다가오는 게임 경주 턴' : '선택 국가의 다음 등록 일정',
      turn,
      rows: plan.at(turn),
      known: true,
    })),
  ]
  return (
    <section
      aria-label="선택 국가 출전 일정"
      className="mt-3 rounded border border-border p-3 text-xs"
      aria-live="polite"
    >
      <h3 className="font-semibold">
        {countryName(country)} 게임용 출전 일정 ·{' '}
        {travel.activeExpedition ? '현지 일정 확인' : '출국 전 확인'}
      </h3>
      <p className="mt-1 text-muted-foreground">
        {server
          ? '현재 턴은 서버 출전 API의 현재 체류 기준입니다. 이후 일정은 공통 게임 정의의 참고 전망이며 서버의 미래 등록·자격은 확인되지 않았습니다.'
          : '등록된 Local 게임 경주 기준입니다. 자격은 도착 후를 가정한 현재 전적·잔액·건강·계약 기준이며 미래의 변화는 예측하지 않습니다.'}
      </p>
      <ul className="mt-2 space-y-3">
        {groups.map((group) => (
          <li key={group.turn}>
            <p className="font-medium">
              {group.label} · {group.turn}턴 ·{' '}
              <SeasonSummary progress={careerProgress(group.turn)} showAge={false} />
            </p>
            {!group.known ? (
              <p>서버 출전 정보를 확인하지 못했습니다. 경주 0개로 판단하지 않습니다.</p>
            ) : group.rows.length === 0 ? (
              <p className="mt-1 text-primary">
                {server && group.turn !== plan.currentTurn ? '공통 게임 정의 기준으로 ' : ''}이 턴에{' '}
                {countryName(country)}에서 개최되는 등록 게임 경주가 0개입니다. 전적·잔액 부족으로
                제외된 것이 아닙니다.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">
                {group.rows.map(({ race, reason }) => (
                  <li key={race.id}>
                    <p>
                      {race.name} · {countryName(race.countryCode ?? 'KOR')} · {race.distance}m ·
                      등록비 ₩{race.entryFee.toLocaleString('ko-KR')}
                    </p>
                    <p className="text-muted-foreground">
                      {server && group.turn !== plan.currentTurn
                        ? '서버 자격 미확인 · 해당 턴의 실제 출전 API에서 재확인'
                        : reason
                          ? `출전 제한 · ${reason}`
                          : server
                            ? '서버 현재 조건 충족'
                            : '도착 후 현재 조건 기준 자격 충족 · 출전 시 재확인'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {plan.nextLocal === null && (
        <p className="mt-2">
          공통 게임 정의에 이 국가의 반복 일정이 없습니다. 공식 참고 카탈로그를 출전 가능 경주로
          대체하지 않습니다.
        </p>
      )}
      <p className="mt-2 text-muted-foreground">
        원정 경주 선택 목록에는 현재 턴의 대상만 표시합니다. 이후 일정은 참고 전망입니다. 경주가
        없어도 기존 원정 신청은 가능합니다. 원정·귀국의 비용과 월 진행 정책은 바뀌지 않습니다.
      </p>
    </section>
  )
}
