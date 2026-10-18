import type { components } from '../../packages/shared/src/generated/api'
import { validateStableTravel } from '../../packages/shared/src/generated/save-validation.mjs'
import type { LifecycleSave } from './lifecycle-save'

export type StableTravel = components['schemas']['StableTravel']
export const supportedCountries = ['KOR', 'JPN', 'USA'] as const
export type SupportedCountry = (typeof supportedCountries)[number]
export const countryCode = (value: string) =>
  ({ 대한민국: 'KOR', 한국: 'KOR', 일본: 'JPN', 미국: 'USA', 영국: 'GBR' })[value] ?? value
export const countryName = (value: string) =>
  ({ KOR: '대한민국', JPN: '일본', USA: '미국', GBR: '영국' })[value] ?? value
export const supportedCountry = (value: string): value is SupportedCountry =>
  supportedCountries.some((code) => code === value)
export function assertTravel(value: unknown): asserts value is StableTravel {
  if (!validateStableTravel(value)) {
    throw new Error('저장된 원정 기록이 유효하지 않습니다. 기존 기록은 유지됩니다.')
  }
  const active = value.activeExpedition
  if (
    !Number.isSafeInteger(value.revision) ||
    (active
      ? active.status !== 'active' ||
        active.endReason !== null ||
        active.endedAt !== null ||
        active.endedTurn !== null ||
        active.targetCountry !== value.locationCountry ||
        active.targetCountry === value.homeCountry ||
        active.startedRevision > value.revision
      : value.locationCountry !== value.homeCountry)
  ) {
    throw new Error('저장된 원정 상태가 일치하지 않습니다. 기존 기록은 유지됩니다.')
  }
}
export function migrateTravel(saved: LifecycleSave): LifecycleSave & { travel: StableTravel } {
  if (saved.travel !== undefined) {
    assertTravel(saved.travel)
    return saved as LifecycleSave & { travel: StableTravel }
  }
  const homeCountry = countryCode(saved.country ?? '대한민국')
  return {
    ...saved,
    travel: { homeCountry, locationCountry: homeCountry, revision: 0, activeExpedition: null },
  }
}
export function closeLocalTravel(travel: StableTravel): StableTravel {
  return travel.activeExpedition
    ? {
        ...travel,
        revision: travel.revision + 1,
        locationCountry: travel.homeCountry,
        activeExpedition: null,
      }
    : travel
}
export function travelRestriction(
  travel: StableTravel,
  raceCountry: string | undefined,
): string | null {
  if (!supportedCountry(travel.homeCountry)) {
    return '이 마방의 소속 국가는 현재 출전·원정을 지원하지 않습니다.'
  }
  if (!raceCountry || !supportedCountry(raceCountry)) {
    return '개최 국가가 확인되지 않은 경주입니다.'
  }
  if (raceCountry !== travel.locationCountry) {
    return `${countryName(raceCountry)} 경주입니다. 해당 국가 원정 또는 귀국이 필요합니다.`
  }
  return null
}
