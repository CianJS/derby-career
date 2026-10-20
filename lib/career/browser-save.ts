import { assertCareer, type Career } from './model'
import { normalizeCareerAge } from './career-time'
import { assertLifecycleSave, type LifecycleSave } from './lifecycle-save'

export const BROWSER_SAVE_KEY = 'derby-career-browser-save-v1'
export const STORAGE_ACCESS_MESSAGE =
  '브라우저 저장소에 접근하지 못했습니다. 미리보기를 새 탭에서 열거나 이 사이트의 저장 권한을 확인해 주세요.'
type Save = {
  version: 1
  revision: number
  localCareerId?: string
  career?: Career | null
  lifecycle?: LifecycleSave
}

function storage(): Storage {
  try {
    if (!globalThis.localStorage) {
      throw new Error('Storage unavailable')
    }
    return globalThis.localStorage
  } catch {
    throw new Error(STORAGE_ACCESS_MESSAGE)
  }
}
function decode(text: string | null): Save {
  if (text === null) {
    return { version: 1, revision: 0 }
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('브라우저 저장 데이터가 손상되었습니다. 기존 기록은 유지됩니다.')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('revision' in value) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  ) {
    throw new Error('지원하지 않는 브라우저 저장 형식입니다. 기존 기록은 유지됩니다.')
  }
  if ('career' in value && value.career !== null) {
    assertCareer(value.career)
    value.career = normalizeCareerAge(value.career)
  }
  if ('lifecycle' in value) {
    assertLifecycleSave(value.lifecycle)
  }
  if (
    'localCareerId' in value &&
    (typeof value.localCareerId !== 'string' || !value.localCareerId)
  ) {
    throw new Error('육성 저장 식별자가 유효하지 않습니다.')
  }
  return value as Save
}
export function readBrowserSave(): Save {
  let text: string | null
  try {
    text = storage().getItem(BROWSER_SAVE_KEY)
  } catch {
    throw new Error(STORAGE_ACCESS_MESSAGE)
  }
  return decode(text)
}
/** Called inside the store's shared Web Lock. Both records commit in one atomic setItem. */
export function writeBrowserSave(patch: { career?: Career | null; lifecycle?: unknown }): void {
  const target = storage()
  let before: string | null
  try {
    before = target.getItem(BROWSER_SAVE_KEY)
  } catch {
    throw new Error(STORAGE_ACCESS_MESSAGE)
  }
  const current = decode(before)
  if (Object.hasOwn(patch, 'career') && patch.career !== null) {
    assertCareer(patch.career)
  }
  if (Object.hasOwn(patch, 'lifecycle')) {
    assertLifecycleSave(patch.lifecycle)
  }
  const next = { ...current, ...patch, revision: current.revision + 1 }
  if (next.career && (!current.career || !current.localCareerId)) {
    next.localCareerId = crypto.randomUUID()
  }
  let text: string
  try {
    text = JSON.stringify(next)
  } catch {
    throw new Error('저장 데이터를 변환하지 못했습니다. 기존 기록은 유지됩니다.')
  }
  decode(text)
  try {
    if (target.getItem(BROWSER_SAVE_KEY) !== before) {
      throw new Error('저장 상태가 변경되었습니다. 다시 불러와 주세요.')
    }
    target.setItem(BROWSER_SAVE_KEY, text)
    if (target.getItem(BROWSER_SAVE_KEY) !== text) {
      throw new Error('저장 확정에 실패했습니다. 다시 불러와 주세요.')
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'QuotaExceededError'
    ) {
      throw new Error('브라우저 저장 공간이 부족합니다. 기존 기록은 유지됩니다.', { cause: error })
    }
    if (error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError') {
      throw new Error(STORAGE_ACCESS_MESSAGE, { cause: error })
    }
    throw error
  }
}
/** Legacy cookies are read-only; blocked cookies never prevent a browser-storage save. */
export function legacyCookie(name: string): string | null {
  try {
    return (
      document.cookie
        .split(/;\s*/)
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1) ?? null
    )
  } catch {
    return null
  }
}
