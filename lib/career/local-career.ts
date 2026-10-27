import { migrateTravel, closeLocalTravel, supportedCountry } from './local-travel'
import { startCareer, type Career } from './model'
import { readLifecycleSave } from './lifecycle-repository'
import { assertLifecycleSave } from './lifecycle-save'
import { applyCareer, archiveActiveHorse } from './lifecycle'
import { writeBrowserSave } from './browser-save'

export function startLocalCareer(
  horseId: string,
  current: Career | null,
  starterJockeyId?: string,
): Career {
  if (current) {
    throw new Error('현재 커리어를 먼저 은퇴해 주세요.')
  }
  const lifecycle = readLifecycleSave()
  if (lifecycle !== null) {
    assertLifecycleSave(lifecycle)
  }
  const savedContracts = lifecycle?.contractedJockeyIds
  if (savedContracts === undefined && starterJockeyId === undefined) {
    throw new Error('초기 후보 기수 중 한 명을 선택해 주세요.')
  }
  const next = startCareer(horseId, { starterJockeyId, contractedJockeyIds: savedContracts })
  if (lifecycle === null) {
    return next
  }
  assertLifecycleSave(lifecycle)
  if (!supportedCountry(migrateTravel(lifecycle).travel.homeCountry)) {
    throw new Error('이 마방의 소속 국가는 신규 육성을 지원하지 않습니다.')
  }
  return {
    ...next,
    calendarDate: { year: lifecycle.year ?? 2028, month: lifecycle.month ?? 4 },
  }
}
export function retireLocalCareer(career: Career) {
  if (career.raceRun) {
    throw new Error('확정한 경주를 완료한 뒤 은퇴해 주세요.')
  }
  if (career.action && career.action.result === null) {
    throw new Error('확정한 행동을 완료한 뒤 은퇴해 주세요.')
  }
  const saved = readLifecycleSave() ?? {}
  assertLifecycleSave(saved)
  const projected = applyCareer(
    {
      ...saved,
      activeHorse: saved.activeHorse ?? null,
      archive: saved.archive ?? [],
      contractedJockeyIds: [...career.contractedJockeyIds],
      year: career.calendarDate.year,
      month: career.calendarDate.month,
    },
    career,
  )
  const retired = {
    ...archiveActiveHorse(projected, career.horse.id, crypto.randomUUID()),
    travel: closeLocalTravel(migrateTravel(saved).travel),
  }
  // The archive and retirement tombstone are durable together or neither is changed.
  const committed = writeBrowserSave({ career: null, lifecycle: retired })
  return {
    ...retired,
    ...committed.lifecycle,
    archive: committed.lifecycle?.archive ?? retired.archive,
  }
}
