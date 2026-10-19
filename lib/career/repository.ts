import { assertCareer, type Career, type Horse, type Stat, labels, statKeys } from './model'
import { summarizeRecords } from './records'
import { readLifecycleSave } from './lifecycle-repository'
import { decompressFromEncodedURIComponent } from 'lz-string'
import { readBrowserSave, writeBrowserSave, legacyCookie } from './browser-save'
import { assertRaceRecords, assertLifecycleSave } from './lifecycle-save'

const key = 'derby-career-lifecycle-checkpoint-1'
export function clearCareer(): void {
  // Keep a tombstone so a retired career cannot be resurrected from a legacy cookie.
  writeBrowserSave({ career: null })
}
export function readCareer(): Career | null {
  const primary = readBrowserSave()
  if (Object.hasOwn(primary, 'career')) {
    return primary.career ?? null
  }
  const pointer = legacyCookie(key)
  if (!pointer) {
    return migrateLegacy()
  }
  const [generation, countText, extra] = pointer.split('.')
  const count = Number(countText)
  if (
    extra !== undefined ||
    !/^[a-zA-Z0-9-]+$/.test(generation) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 16
  ) {
    throw new Error('저장 정보가 손상되었습니다. 저장 데이터는 덮어쓰지 않습니다.')
  }
  let payload = ''
  for (let i = 0; i < count; i++) {
    const chunk = legacyCookie(`${key}-${generation}-${i}`)
    if (chunk === null) {
      throw new Error('저장 데이터 일부를 읽을 수 없습니다. 쿠키 설정을 확인해 주세요.')
    }
    payload += chunk
  }
  const decoded = payload.startsWith('z1:')
    ? decompressFromEncodedURIComponent(payload.slice(3))
    : decodeURIComponent(payload)
  if (!decoded) {
    throw new Error('저장된 육성 데이터를 읽을 수 없습니다. 기존 저장은 유지됩니다.')
  }
  const state = normalizeSavedCareer(JSON.parse(decoded))
  assertCareer(state)
  writeCareer(state)
  return state
}
export function writeCareer(state: Career): void {
  assertCareer(state)
  writeBrowserSave({ career: state })
}
function normalizeSavedCareer(value: unknown): Career {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('저장된 육성 데이터를 읽을 수 없습니다. 기존 저장은 유지됩니다.')
  }
  const state = value as Partial<Career> & { month?: number }
  assertRaceRecords(state.raceRecords ?? [])
  const { record, prize } = summarizeRecords(state.raceRecords)
  return {
    ...state,
    record,
    prize,
    calendarDate: state.calendarDate ?? { year: 2028, month: 4 },
    careerTurnIndex: state.careerTurnIndex ?? state.month ?? 1,
    contractedJockeyIds: state.contractedJockeyIds ?? ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG'],
    raceRecords: state.raceRecords ?? [],
  } as Career
}
function migrateLegacy(): Career | null {
  const legacy = readLifecycleSave()
  if (!legacy) {
    return null
  }
  assertLifecycleSave(legacy)
  if (!legacy.activeHorse) {
    return null
  }
  const old = legacy.activeHorse
  const stats = Object.fromEntries(
    statKeys.map((stat) => [
      stat,
      old.stats?.find(([label]: [string, number]) => label === labels[stat])?.[1],
    ]),
  ) as Record<Stat, number>
  const horse: Horse = {
    id: old.id,
    name: old.name,
    growth: old.growth,
    description: old.growthNote || '',
    stats,
    aptitude: (old.aptitude || []).map((row: readonly string[]) =>
      row.length === 2 ? [row[0], row[1]] : [row[1], row[2]],
    ),
  }
  const calendarDate = { year: legacy.year ?? 2028, month: legacy.month ?? 4 }
  const state: Career = {
    version: 1,
    horse,
    age: parseInt(old.age) || 2,
    month: legacy.month || 1,
    calendarDate,
    careerTurnIndex: legacy.month || 1,
    contractedJockeyIds: ['HAN_DOYUN', 'SEO_JIAN', 'YOON_TAESUNG'],
    values: { ...stats, fatigue: old.fatigue ?? 5, bodyLoad: old.bodyLoad ?? 5 },
    condition: old.condition || '보통',
    health: old.health ?? '정상',
    healthRecovery: old.healthRecovery,
    record: summarizeRecords(legacy.activeHorse.raceRecords).record,
    prize: summarizeRecords(legacy.activeHorse.raceRecords).prize,
    raceRecords: legacy.activeHorse.raceRecords ?? [],
    ...(old.jockeyTrust ? { jockeyTrust: old.jockeyTrust } : {}),
    action: null,
    recent: [],
  }
  assertCareer(state)
  writeCareer(state)
  return state
}
