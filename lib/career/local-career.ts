import { startCareer, type Career } from './model'
import { readLifecycleSave } from './lifecycle-repository'
import { assertLifecycleSave } from './lifecycle-save'
import { applyCareer, archiveActiveHorse } from './lifecycle'
import { writeBrowserSave } from './browser-save'

export function startLocalCareer(horseId: string, current: Career | null): Career {
  if (current) {
    throw new Error('현재 커리어를 먼저 은퇴해 주세요.')
  }
  const lifecycle = readLifecycleSave()
  const next = startCareer(horseId)
  if (lifecycle === null) {
    return next
  }
  assertLifecycleSave(lifecycle)
  return { ...next, calendarDate: { year: lifecycle.year ?? 2028, month: lifecycle.month ?? 4 } }
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
      year: career.calendarDate.year,
      month: career.calendarDate.month,
    },
    career,
  )
  const retired = archiveActiveHorse(projected, career.horse.id, crypto.randomUUID())
  // The archive and retirement tombstone are durable together or neither is changed.
  writeBrowserSave({ career: null, lifecycle: retired })
  return retired
}
