import { actionName, changeText, statKeys, type Career, type Stat } from './model'
import { canRace } from './health'
import { healthGuidance, RACE_ELIGIBILITY_NOTICE } from './health-presentation'
import {
  raceEligibility,
  raceMonths,
  racesForTurn,
  localRacesForTurn,
  contractedRoster,
} from './race-entry'
import {
  careerProgress,
  nextSeasonRaceTurn,
  CAREER_SEASON_TURNS,
  type CareerProgress,
} from './career-time'
import type { StableTravel } from './local-travel'

/** Compatibility alias for a season's length, not a Career limit. */
export const CAREER_YEAR_MONTHS = CAREER_SEASON_TURNS
const STRAIN_AT = 40

export type Readiness = { level: 'ready' | 'caution' | 'blocked'; label: string; detail: string }
export type NextRaceOutlook = {
  month: number
  monthsAway: number
  openRaces: number
  totalRaces: number
}
export type RecentGrowth = { month: number; name: string; changes: string[] }

/** Facts for the month panel. It never picks a race or an action for the player. */
export type CareerOutlook = {
  month: number
  yearMonths: number
  progress: CareerProgress
  nextRace: NextRaceOutlook | null
  readiness: Readiness
  growth: RecentGrowth[]
}
export type RaceOutlookContext = { availableFunds?: number; travel?: StableTravel }

export function readiness(career: Career): Readiness {
  const health = healthGuidance(career)
  const tired = career.values.fatigue >= STRAIN_AT
  const loaded = career.values.bodyLoad >= STRAIN_AT
  const strain =
    tired || loaded
      ? `${[tired && '피로', loaded && '신체 부하'].filter(Boolean).join('·')}가 높아 경주 성적에 영향을 줄 수 있습니다.`
      : ''
  if (!health.racingAllowed) {
    return {
      level: 'blocked',
      label: '건강 조건상 출전 불가',
      detail:
        `건강 ${health.health} · 훈련·출전 제한 중이며 추가 회복이 필요합니다. ${strain} ${RACE_ELIGIBILITY_NOTICE}`.trim(),
    }
  }
  if (!health.trainingAllowed || strain) {
    return {
      level: 'caution',
      label: '주의',
      detail: [
        !health.trainingAllowed
          ? `건강 ${health.health} · ${health.raceText}. ${health.caution}`
          : '',
        strain,
        RACE_ELIGIBILITY_NOTICE,
      ]
        .filter(Boolean)
        .join(' '),
    }
  }
  return {
    level: 'ready',
    label: '준비 양호',
    detail: `건강·피로·신체 부하 기준으로 특이사항이 없습니다. ${RACE_ELIGIBILITY_NOTICE}`,
  }
}

export function nextRaceOutlook(
  career: Career,
  context: RaceOutlookContext = {},
): NextRaceOutlook | null {
  const month = nextSeasonRaceTurn(
    career.careerTurnIndex + (career.action || career.raceRun ? 1 : 0),
    raceMonths,
  )
  if (month === null) {
    return null
  }
  const races = context.travel ? localRacesForTurn(month) : racesForTurn(month)
  const projected = { ...career, month, careerTurnIndex: month, age: careerProgress(month).age }
  const openRaces =
    canRace(career.health) && contractedRoster(career).length > 0
      ? races.filter((r) => !raceEligibility(projected, r, context.availableFunds, context.travel))
          .length
      : 0
  return { month, monthsAway: month - career.careerTurnIndex, openRaces, totalRaces: races.length }
}

export function recentGrowth(career: Career): RecentGrowth[] {
  return career.recent.slice(0, 3).map((action) => ({
    month: action.month,
    name: actionName(action),
    changes: (action.result ?? [])
      .filter(
        (change) =>
          (statKeys as readonly string[]).includes(change.key as Stat) &&
          change.after !== change.before,
      )
      .map(changeText),
  }))
}

export function careerOutlook(career: Career, context: RaceOutlookContext = {}): CareerOutlook {
  return {
    month: career.careerTurnIndex,
    yearMonths: CAREER_YEAR_MONTHS,
    progress: careerProgress(career.careerTurnIndex),
    nextRace: nextRaceOutlook(career, context),
    readiness: readiness(career),
    growth: recentGrowth(career),
  }
}
