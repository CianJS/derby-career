import type { components, operations } from '../../packages/shared/src/generated/api'

export type Race = components['schemas']['RaceSchedule']
export type Venue = components['schemas']['Racecourse']
export type Course = components['schemas']['Course']
export type Query = NonNullable<operations['listRaceSchedule']['parameters']['query']>
export type VenueQuery = NonNullable<operations['listRacecourses']['parameters']['query']>
export const countries = { KOR: '한국', JPN: '일본', USA: '미국' } as const
export const surfaces = {
  turf: '잔디',
  dirt: '더트',
  sand: '모래',
  synthetic: '합성',
  other: '기타',
  unknown: '미확인',
} as const
export const statuses = {
  dated: '일정 확정',
  date_unconfirmed: '일정 미확정',
  not_run: '취소 / 미개최',
} as const
export const grades = ['G1', 'G2', 'G3', 'Listed', '기타'] as const
export const idPattern = /^[A-Z][A-Z0-9_]{1,119}$/
export const defaultQuery: Query = { page: 1, pageSize: 100 }
const numeric: Record<string, [number, number]> = {
  page: [1, 1000000],
  pageSize: [1, 100],
  year: [1900, 2200],
  month: [1, 12],
  minDistance: [0, 100000],
  maxDistance: [0, 100000],
}
const choices: Record<string, readonly string[]> = {
  country: Object.keys(countries),
  surface: Object.keys(surfaces),
  grade: grades,
  scheduleStatus: Object.keys(statuses),
  verificationStatus: ['verified', 'partial', 'conflict', 'unverified', 'review_required'],
}
const commonKeys = ['page', 'pageSize', 'country', 'verificationStatus', 'search']
const scheduleKeys = [
  ...commonKeys,
  'year',
  'month',
  'racecourseId',
  'grade',
  'surface',
  'minDistance',
  'maxDistance',
  'scheduleStatus',
]

/** Query validation follows OpenAPI; it does not evaluate Career eligibility. */
export function readQuery(params: URLSearchParams, venue = false): Query {
  const query: Record<string, string | number> = {}
  for (const [key, value] of params) {
    if (!(venue ? commonKeys : scheduleKeys).includes(key) || params.getAll(key).length !== 1) {
      throw new Error('지원하지 않거나 중복된 조회 조건입니다.')
    }
    if (numeric[key]) {
      const number = Number(value)
      const [min, max] = numeric[key]
      if (
        !/^\d+(\.\d+)?$/.test(value) ||
        number < min ||
        number > max ||
        (!key.endsWith('Distance') && !Number.isInteger(number))
      ) {
        throw new Error('연도·월·거리·페이지 범위를 확인해 주세요.')
      }
      query[key] = number
    } else {
      if (
        (choices[key] && !choices[key].includes(value)) ||
        (key === 'racecourseId' && !idPattern.test(value)) ||
        (key === 'search' && (!value.trim() || value.length > 120))
      ) {
        throw new Error('조회 조건을 확인해 주세요.')
      }
      query[key] = value
    }
  }
  if (Number(query.minDistance ?? 0) > Number(query.maxDistance ?? 100000)) {
    throw new Error('최소 거리는 최대 거리보다 클 수 없습니다.')
  }
  // All supported keys and bounds have been checked against the generated Query contract.
  return query as Query
}
export function queryParams(query: Query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value))
    }
  }
  return params
}
export function applyFilters(params: URLSearchParams, previous: Query) {
  if (params.get('country') !== (previous.country ?? null)) {
    params.delete('racecourseId')
  }
  return { ...readQuery(params), page: 1, pageSize: previous.pageSize ?? 100 }
}
export function readLocation(search: string) {
  const params = new URLSearchParams(search),
    filters = new URLSearchParams()
  params.forEach((value, key) => {
    if (key.startsWith('rc_')) {
      filters.append(key.slice(3), value)
    }
  })
  const id = params.get('raceId')
  return {
    query: { ...defaultQuery, ...readQuery(filters) },
    id: id && idPattern.test(id) ? id : null,
  }
}
export function catalogUrl(href: string, query: Query, id: string | null = null) {
  const url = new URL(href)
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('rc_') || key === 'raceId') {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.set('view', id ? 'race' : 'races')
  queryParams(query).forEach((value, key) => url.searchParams.set('rc_' + key, value))
  if (id) {
    url.searchParams.set('raceId', id)
  }
  return url
}
export function dateText(race: Race) {
  return race.scheduleStatus === 'dated' && race.raceDate
    ? race.raceDate
    : statuses[race.scheduleStatus]
}
export function prizeText(race: Race) {
  return race.prizeMoney === null || race.prizeCurrency === null
    ? '미확인'
    : `${race.prizeCurrency} ${race.prizeMoney.toLocaleString('ko-KR')} · ${race.prizeBasis || '상금 기준 미확인'}`
}
export function gradeText(race: Race) {
  return `${race.originalGrade || race.grade} · ${race.gradeSystem}${race.internationalGrade ? ` · 국제 ${race.internationalGrade}` : ''}`
}
export function distanceText(race: Race) {
  const original = race.originalDistance
    ? `${race.originalDistance}${race.originalDistanceUnit ? ' ' + race.originalDistanceUnit : ''}`
    : null
  const meters =
    race.distanceMeters === null
      ? null
      : `${race.distanceMeters.toLocaleString('ko-KR')}m${race.distanceBasis === 'nominal_conversion' ? ' 명목 환산' : ''}`
  return [original, meters].filter(Boolean).join(' / ') || '미확인'
}
export function selectedCourse(race: Race, courses: Course[]) {
  return race.courseId === null
    ? null
    : (courses.find(
        (course) => course.id === race.courseId && course.racecourseId === race.racecourseId,
      ) ?? null)
}
