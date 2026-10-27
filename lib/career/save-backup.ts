import { BROWSER_SAVE_KEY, STORAGE_ACCESS_MESSAGE, parseBrowserSaveSnapshot } from './browser-save'
import { readRaceLog } from './race-log-repository'
import { validateRaceLog, type RaceSimulationLog } from './race-simulation'
import { validateRaceLogResponse } from '../../packages/shared/src/generated/save-validation.mjs'

type Save = ReturnType<typeof parseBrowserSaveSnapshot>
export type BackupContext = {
  mode: 'local' | 'server' | null
  ready: boolean
  busy: boolean
  pending: boolean
}
export type LocalSaveSnapshot =
  | { status: 'absent'; legacy: 'present' | 'absent' | 'unknown' }
  | {
      status: 'valid'
      save: Save
      raw: string
      log: RaceSimulationLog | null
      raceError: string | null
    }
export const BACKUP_LIMIT =
  '현재 앱에는 백업 가져오기·복원 기능이 없으며, 파일만으로 자동 복구되지는 않습니다.'
const changed = () =>
  new Error('저장 상태가 변경되었습니다. 저장 상태를 다시 확인한 뒤 내보내 주세요.')
const raceFailure = () =>
  new Error(
    '진행 중 경주 로그를 읽거나 검증하지 못해 완전한 백업을 내보낼 수 없습니다. 로그 누락·손상·접근 오류를 확인해 주세요. 원본은 변경하지 않았습니다. 기존 경주 화면의 기록 복구 경로를 확인해 주세요.',
  )

function checkedLog(save: Save, log: unknown): RaceSimulationLog | null {
  if (!save.career?.raceRun) {
    return null
  }
  if (!validateRaceLogResponse({ log })) {
    throw raceFailure()
  }
  try {
    validateRaceLog(log, save.career.raceRun)
  } catch {
    throw raceFailure()
  }
  return log
}
/** Pure builder: the save is the exact parsed source JSON, never a normalized live aggregate. */
export function buildLocalBackup(raw: string, activeRaceLog: unknown, exportedAt: string) {
  const save = parseBrowserSaveSnapshot(raw)
  if (
    !Number.isFinite(Date.parse(exportedAt)) ||
    new Date(exportedAt).toISOString() !== exportedAt
  ) {
    throw new Error('내보내기 시각을 확인하지 못했습니다.')
  }
  const log = checkedLog(save, activeRaceLog)
  const payload = {
    format: 'derby-career-local-backup' as const,
    formatVersion: 1 as const,
    exportedAt,
    save,
    ...(log ? { activeRaceLog: log } : {}),
  }
  const json = JSON.stringify(payload, null, 2)
  const copy = JSON.parse(json) as typeof payload
  if (
    JSON.stringify(copy.save) !== JSON.stringify(JSON.parse(raw)) ||
    copy.format !== 'derby-career-local-backup' ||
    copy.formatVersion !== 1 ||
    (log && JSON.stringify(copy.activeRaceLog) !== JSON.stringify(log))
  ) {
    throw new Error('백업 사본의 일치 여부를 확인하지 못했습니다.')
  }
  return {
    json,
    filename: `derby-career-local-backup-${exportedAt.slice(0, 10).replaceAll('-', '')}-${exportedAt.slice(11, 16).replace(':', '')}.json`,
    payload,
  }
}
function legacyPresence(): 'present' | 'absent' | 'unknown' {
  try {
    const names = document.cookie.split(/;\s*/).map((cookie) => cookie.split('=', 1)[0])
    return names.some((name) =>
      [
        'derby-career-lifecycle',
        'derby-career-lifecycle-v2',
        'derby-career-lifecycle-checkpoint-1',
      ].some((prefix) => name === prefix || name.startsWith(prefix + '-')),
    )
      ? 'present'
      : 'absent'
  } catch {
    return 'unknown'
  }
}
function assertContext(context: BackupContext) {
  if (context.mode !== 'local') {
    throw new Error('Local 저장 모드에서만 백업을 내보낼 수 있습니다.')
  }
  if (!context.ready || context.busy || context.pending) {
    throw new Error(
      '저장 상태를 확인하거나 명령을 처리하는 중입니다. 완료된 뒤 다시 확인해 주세요.',
    )
  }
}
/** Only reads under the same lock as writes. It never invokes recovery, migration or save commands. */
export async function captureLocalSave(
  getContext: () => BackupContext,
): Promise<LocalSaveSnapshot> {
  const expected = getContext()
  assertContext(expected)
  if (!navigator.locks?.request) {
    throw new Error(
      '안전한 백업을 위해 Web Lock을 지원하는 최신 Chromium 브라우저의 HTTPS 환경이 필요합니다.',
    )
  }
  try {
    return await navigator.locks.request('derby-career-checkpoint-1', () => {
      if (getContext() !== expected) {
        throw changed()
      }
      assertContext(getContext())
      let raw: string | null
      try {
        raw = localStorage.getItem(BROWSER_SAVE_KEY)
      } catch {
        throw new Error(STORAGE_ACCESS_MESSAGE)
      }
      if (raw === null) {
        return { status: 'absent', legacy: legacyPresence() }
      }
      const save = parseBrowserSaveSnapshot(raw)
      let log: RaceSimulationLog | null = null
      let raceError: string | null = null
      if (save.career?.raceRun) {
        try {
          log = checkedLog(save, readRaceLog(save.career.raceRun.raceRunId))
        } catch {
          raceError = raceFailure().message
        }
      }
      try {
        if (localStorage.getItem(BROWSER_SAVE_KEY) !== raw) {
          throw changed()
        }
        if (
          log &&
          JSON.stringify(readRaceLog(save.career!.raceRun!.raceRunId)) !== JSON.stringify(log)
        ) {
          throw changed()
        }
      } catch (error) {
        if (error instanceof Error && error.message === changed().message) {
          throw error
        }
        throw new Error(STORAGE_ACCESS_MESSAGE, { cause: error })
      }
      if (getContext() !== expected) {
        throw changed()
      }
      assertContext(getContext())
      return { status: 'valid', save, raw, log, raceError }
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'SecurityError') {
      throw new Error(STORAGE_ACCESS_MESSAGE, { cause: error })
    }
    if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name)) {
      throw new Error(
        '저장 잠금을 사용할 수 없습니다. 잠시 후 안전한 브라우저 환경에서 다시 확인해 주세요.',
        { cause: error },
      )
    }
    throw error
  }
}
