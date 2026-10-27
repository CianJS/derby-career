import { readBrowserSave, writeBrowserSave, legacyCookie } from './browser-save'
import { assertLifecycleSave } from './lifecycle-save'
import { applyCareer } from './lifecycle'
import { migrateTravel } from './local-travel'
import { migrateEconomy } from './local-economy'
import type { StarterJockeyId } from './jockey-catalog'

export type StarterDraftChange = { expectedStarterJockeyId: StarterJockeyId | undefined }

const key = 'derby-career-lifecycle-v2'
export function readLifecycleSave(): unknown {
  const saved = readBrowserSave()
  if (saved.lifecycle !== undefined) {
    return saved.lifecycle
  }
  const pointer = legacyCookie(key)
  let value: unknown
  if (!pointer) {
    const legacy = legacyCookie('derby-career-lifecycle')
    if (!legacy) {
      return null
    }
    value = JSON.parse(decodeURIComponent(legacy))
  } else {
    const [generation, countText, extra] = pointer.split('.')
    const count = Number(countText)
    if (
      extra !== undefined ||
      !/^[a-zA-Z0-9-]+$/.test(generation) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 32
    ) {
      throw new Error('마방 저장 정보를 읽을 수 없습니다. 기존 기록은 유지됩니다.')
    }
    let payload = ''
    for (let i = 0; i < count; i++) {
      const chunk = legacyCookie(`${key}-${generation}-${i}`)
      if (chunk === null) {
        throw new Error('마방 저장 기록 일부를 읽을 수 없습니다.')
      }
      payload += chunk
    }
    const envelope: unknown = JSON.parse(decodeURIComponent(payload))
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('version' in envelope) ||
      envelope.version !== 2 ||
      !('state' in envelope)
    ) {
      throw new Error('지원하지 않는 마방 저장 형식입니다.')
    }
    value = envelope.state
  }
  assertLifecycleSave(value)
  return value
}
export function writeLifecycleSave(value: unknown, draftChange?: StarterDraftChange): void {
  assertLifecycleSave(value)
  const saved = readBrowserSave()
  if (draftChange) {
    if (saved.career || saved.lifecycle?.contractedJockeyIds !== undefined) {
      throw new Error('기존 마방의 기수 계약은 초기 선택으로 변경할 수 없습니다.')
    }
    if (
      !value.starterJockeyId ||
      (saved.lifecycle?.starterJockeyId !== draftChange.expectedStarterJockeyId &&
        saved.lifecycle?.starterJockeyId !== value.starterJockeyId)
    ) {
      throw new Error('다른 탭에서 초기 기수 선택이 변경되었습니다. 다시 불러와 주세요.')
    }
  } else if (
    saved.lifecycle?.starterJockeyId !== undefined &&
    value.starterJockeyId !== undefined &&
    saved.lifecycle.starterJockeyId !== value.starterJockeyId
  ) {
    throw new Error('다른 탭에서 초기 기수 선택을 확정했습니다. 다시 불러와 주세요.')
  }
  const economy = migrateEconomy(saved.lifecycle ?? value)
  // A stale tab may update presentation metadata, but cannot erase an immutable archive.
  let next = {
    ...value,
    ...(saved.lifecycle?.starterJockeyId && !draftChange
      ? { starterJockeyId: saved.lifecycle.starterJockeyId }
      : {}),
    ...(saved.lifecycle?.contractedJockeyIds
      ? { contractedJockeyIds: saved.lifecycle.contractedJockeyIds }
      : {}),
    travel:
      saved.lifecycle?.stableName || saved.career
        ? migrateTravel(saved.lifecycle ?? value).travel
        : migrateTravel({ ...value, travel: undefined }).travel,
    country: saved.lifecycle?.stableName ? saved.lifecycle.country : value.country,
    fundsKRW: economy.fundsKRW,
    economyLedger: economy.economyLedger,
    ...(saved.lifecycle?.archive ? { archive: saved.lifecycle.archive } : {}),
    ...(saved.lifecycle?.lastRetiredId ? { lastRetiredId: saved.lifecycle.lastRetiredId } : {}),
  }
  if (Object.hasOwn(saved, 'career')) {
    next = saved.career
      ? applyCareer(
          {
            ...next,
            activeHorse: saved.lifecycle?.activeHorse ?? next.activeHorse ?? null,
            month: next.month ?? 4,
          },
          saved.career,
        )
      : {
          ...next,
          activeHorse: null,
          month: saved.lifecycle?.month ?? next.month,
          year: saved.lifecycle?.year ?? next.year,
        }
  }
  // Projection effects in two tabs must not bounce identical writes back and forth.
  if (JSON.stringify(next) !== JSON.stringify(saved.lifecycle)) {
    writeBrowserSave({ lifecycle: next })
  }
}
