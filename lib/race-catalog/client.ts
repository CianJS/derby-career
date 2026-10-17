import { createApiClient, DerbyApiError } from '../../packages/shared/src/client'
import {
  validateRaceSchedule,
  validateRaceScheduleList,
  validateRacecourseList,
  validateRacecourseDetail,
} from '../../packages/shared/src/generated/save-validation.mjs'
import type { Query, VenueQuery } from './model'
export class CatalogResponseValidationError extends Error {
  constructor() {
    super('경주 카탈로그 응답이 계약과 일치하지 않습니다.')
  }
}
function invalid(): never {
  throw new CatalogResponseValidationError()
}
export function createCatalogClient(
  baseUrl = '/api/racing-catalog',
  perform: typeof fetch = globalThis.fetch,
) {
  const api = createApiClient({ baseUrl, fetch: perform })
  return {
    async list(query: Query) {
      const value: unknown = await api.listRaceSchedule(query)
      if (!validateRaceScheduleList(value)) {
        invalid()
      }
      const p = value.pagination
      if (
        p.page !== (query.page ?? 1) ||
        p.pageSize !== (query.pageSize ?? 20) ||
        p.total < 0 ||
        p.totalPages !== Math.ceil(p.total / p.pageSize) ||
        value.data.length > p.pageSize ||
        new Set(value.data.map((race) => race.id)).size !== value.data.length
      ) {
        invalid()
      }
      return value
    },
    async race(id: string) {
      const value: unknown = await api.getRaceSchedule(id)
      if (!validateRaceSchedule(value) || value.id !== id) {
        invalid()
      }
      return value
    },
    async venues(query: VenueQuery) {
      const value: unknown = await api.listRacecourses(query)
      if (!validateRacecourseList(value) || value.data.length > (query.pageSize ?? 20)) {
        invalid()
      }
      return value
    },
    async venue(id: string) {
      const value: unknown = await api.getRacecourse(id)
      if (
        !validateRacecourseDetail(value) ||
        value.racecourse.id !== id ||
        value.courses.some((course) => course.racecourseId !== id)
      ) {
        invalid()
      }
      return value
    },
  }
}
export type Client = ReturnType<typeof createCatalogClient>
export type Resource<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
/** Both cancellation and active guards are needed when an upstream ignores AbortSignal. */
export function startRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  publish: (value: Resource<T>) => void,
) {
  const controller = new AbortController()
  let active = true
  publish({ status: 'loading' })
  void load(controller.signal)
    .then((data) => {
      if (active) {
        publish({ status: 'ready', data })
      }
    })
    .catch((error: unknown) => {
      const message =
        error instanceof DerbyApiError && error.status === 404
          ? '조회 API 또는 선택한 경주를 찾을 수 없습니다.'
          : error instanceof DerbyApiError && error.status === 429
            ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
            : '경주 카탈로그를 불러오지 못했습니다. API 연결과 수집 상태를 확인한 뒤 다시 시도해 주세요.'
      if (active) {
        publish({ status: 'error', message })
      }
    })
  return () => {
    active = false
    controller.abort()
  }
}
