import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { components } from '../../../../../packages/shared/src/generated/api'
import {
  validateRacecourse,
  validateCourse,
  validateRaceSchedule,
} from '../../../../../packages/shared/src/generated/save-validation.mjs'

type Models = components['schemas']
export type Racecourse = Models['Racecourse']
export type Course = Models['Course']
export type RaceSchedule = Models['RaceSchedule']
type Row = Record<string, unknown>
const packetSchema = z
  .object({
    sourceVersion: z.literal(1),
    capturedAt: z.iso.date(),
    racecourses: z.array(z.record(z.string(), z.unknown())).min(1),
    courses: z.array(z.record(z.string(), z.unknown())),
    races: z.array(z.record(z.string(), z.unknown())),
  })
  .strict()
const idSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/)
const countries = { 한국: 'KOR', 일본: 'JPN', 미국: 'USA' } as const
const surfaces = {
  잔디: 'turf',
  더트: 'dirt',
  모래: 'sand',
  합성: 'synthetic',
  기타: 'other',
  미확인: 'unknown',
} as const
const verification = {
  '공식 확인': 'verified',
  '공식 제원 확인': 'verified',
  '부분 확인': 'partial',
  '출처 충돌': 'conflict',
  미확인: 'unverified',
  재검토: 'review_required',
} as const
function value(row: Row, key: string): string | null {
  const v = row[key]
  if (v === undefined || v === null || v === '') {
    return null
  }
  return z.string().min(1).parse(v)
}
function required(row: Row, key: string) {
  const result = value(row, key)
  if (result === null) {
    throw new Error(`Missing required field: ${key}`)
  }
  return result
}
function number(row: Row, key: string): number | null {
  const v = row[key]
  return v === undefined || v === null || v === ''
    ? null
    : z.number().finite().nonnegative().parse(v)
}
function mapped<T extends string>(row: Row, key: string, map: Record<string, T>): T {
  const input = required(row, key)
  if (!Object.hasOwn(map, input)) {
    throw new Error(`Unsupported ${key}: ${input}`)
  }
  return map[input]
}
function common(row: Row, status: string, source: string) {
  const sourceUrl = value(row, source)
  if (sourceUrl && !/^https?:\/\//.test(sourceUrl)) {
    throw new Error(`Invalid source URL: ${sourceUrl}`)
  }
  return {
    sourceUrl,
    verificationStatus: mapped(row, status, verification),
    gameEnabled: false as const,
    notes: value(row, '메모') ?? '',
    reviewIssues: [] as string[],
  }
}
function assertModel<T>(model: unknown, validate: (x: unknown) => x is T): T {
  if (!validate(model)) {
    throw new Error('Normalized catalog record violates OpenAPI contract')
  }
  return model
}
export function digest(value: unknown): string {
  // Canonical key ordering makes repeated imports independent of JSON property ordering.
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(canonical)
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      )
    }
    return v
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
export function normalizeRacingCatalog(input: unknown) {
  const source = packetSchema.parse(input)
  const racecourses = source.racecourses.map((r) => {
    const countryCode = mapped(r, '국가', countries)
    if (value(r, '국가 코드') !== countryCode) {
      throw new Error('Racecourse country code mismatch')
    }
    return assertModel(
      {
        id: idSchema.parse(r['경마장 ID']),
        name: required(r, '경마장'),
        officialName: value(r, '공식 명칭'),
        country: required(r, '국가'),
        countryCode,
        region: value(r, '지역'),
        city: value(r, '도시'),
        operator: value(r, '운영 체계'),
        operationalStatus: value(r, '운영 상태'),
        racingType: value(r, '경주 유형'),
        ...common(r, '자료 상태', '대표 출처'),
      },
      validateRacecourse,
    )
  })
  const byId = new Map(racecourses.map((r) => [r.id, r]))
  const aliases = new Map<string, string[]>()
  for (const [i, r] of racecourses.entries()) {
    for (const alias of [r.id, r.name, r.officialName, value(source.racecourses[i], 'url')]) {
      if (alias) {
        aliases.set(alias, [...new Set([...(aliases.get(alias) ?? []), r.id])])
      }
    }
  }
  function relation(r: Row): string {
    const raw = required(r, '경마장')
    const links: unknown = raw.startsWith('[') ? JSON.parse(raw) : [raw]
    const [link] = z.array(z.string()).length(1).parse(links)
    // Standard Notion CSV relations may include the linked page URL after the title.
    const csvLink = link.match(/^(.*) \((https:\/\/[^)]+)\)$/)
    const resolved =
      aliases.get(link) ??
      (csvLink ? (aliases.get(csvLink[2]) ?? aliases.get(csvLink[1])) : undefined)
    if (!resolved || resolved.length !== 1) {
      throw new Error(`Missing or ambiguous racecourse relation: ${link}`)
    }
    const id = resolved[0]
    const explicit = value(r, '경마장 ID')
    if (
      (explicit && explicit !== id) ||
      mapped(r, '국가', countries) !== byId.get(id)!.countryCode
    ) {
      throw new Error(`Conflicting racecourse relation: ${id}`)
    }
    return id
  }
  const courses = source.courses.map((r) => {
    const course = assertModel(
      {
        id: idSchema.parse(r['코스 ID']),
        racecourseId: relation(r),
        name: required(r, '코스'),
        surface: mapped(r, '노면', surfaces),
        configuration: value(r, '구성'),
        layout: value(r, '형태'),
        direction: value(r, '회전 방향'),
        straightLength: number(r, '결승 직선 m'),
        trackLength: number(r, '1주 길이 m'),
        widthMin: number(r, '폭 최소 m'),
        widthMax: number(r, '폭 최대 m'),
        elevationDifference: number(r, '고저차 m'),
        originalSpecifications: value(r, '원본 제원'),
        confirmedDistances: value(r, '확인된 경주 거리'),
        ...common(r, '자료 상태', '대표 출처'),
      },
      validateCourse,
    )
    if (course.widthMin !== null && course.widthMax !== null && course.widthMin > course.widthMax) {
      throw new Error(`Invalid course width: ${course.id}`)
    }
    if (course.trackLength === null) {
      course.reviewIssues.push('track_length_unconfirmed')
    }
    return course
  })
  const races = source.races.map((r) => {
    const id = idSchema.parse(r['경주 ID'])
    const country = mapped(r, '국가', countries)
    const notes = value(r, '메모') ?? ''
    const raceDate = value(r, 'date:실제 개최일:start')
    if (raceDate) {
      z.iso.date().parse(raceDate)
    }
    const year = z.number().int().min(1900).max(2200).parse(r['기준연도'])
    if (raceDate && Number(raceDate.slice(0, 4)) !== year) {
      throw new Error(`Date/year mismatch: ${id}`)
    }
    const originalDate = notes.match(/원문 일자 "([^"]+)"/)?.[1] ?? raceDate
    const notRun = originalDate?.toLowerCase() === 'not run'
    if (notRun && raceDate) {
      throw new Error(`Not-run row cannot have a race date: ${id}`)
    }
    const eligibility = value(r, '연령·성별 조건')
    const parsedEligibility = eligibility?.match(
      /^(\d세(?: 이상)?)(?:\s*(?:·\s*)?(암말|수말·암말|암수|암))?$/,
    )
    const age = parsedEligibility?.[1] ?? null
    const sex = parsedEligibility?.[2] ?? null
    const distance = number(r, '거리(m)')
    const furlongs = notes.match(/원문 거리 (\d+(?:\.\d+)?)f\b/)?.[1]
    const miles = notes.match(/원문 거리 ([\d¼½¾]+)마일/)?.[1]
    const originalGrade =
      country === 'USA' && id.includes('TOBA')
        ? (notes.match(/원문 등급 ([^;]+);/)?.[1] ?? null)
        : required(r, '등급')
    const race = assertModel(
      {
        id,
        name: required(r, '경주명'),
        year,
        raceDate,
        scheduleStatus: notRun ? 'not_run' : raceDate ? 'dated' : 'date_unconfirmed',
        country,
        racecourseId: relation(r),
        courseId: null,
        grade: z.enum(['G1', 'G2', 'G3', 'Listed', '기타']).parse(r['등급']),
        originalGrade,
        gradeSystem:
          country === 'KOR'
            ? 'KRA_domestic'
            : country === 'USA'
              ? 'USA'
              : id.includes('_NAR_')
                ? 'NAR'
                : 'JRA',
        internationalGrade: notes.match(/국제 등급 (IG[ⅠⅡⅢ]+)/)?.[1] ?? null,
        surface: mapped(r, '노면', surfaces),
        distanceMeters: distance,
        originalDistance:
          furlongs ?? miles ?? (country !== 'USA' && distance !== null ? String(distance) : null),
        originalDistanceUnit: furlongs
          ? 'furlong'
          : miles
            ? 'mile'
            : country !== 'USA' && distance !== null
              ? 'm'
              : null,
        distanceBasis:
          country === 'USA'
            ? distance === null
              ? 'unconfirmed'
              : 'nominal_conversion'
            : 'source_meters',
        originalDate,
        ageCondition: age,
        sexCondition: sex,
        originalEligibility: eligibility,
        maxRunners: number(r, '최대 출전두수'),
        prizeMoney: number(r, '공식 상금액'),
        prizeCurrency: value(r, '상금 통화'),
        prizeBasis: value(r, '상금 기준'),
        gamePrizeMoney: number(r, '게임 1착상금 KRW'),
        entryFee: number(r, '게임 등록비 KRW'),
        entryEligibility: 'not_evaluated',
        duplicateGroup: null,
        ...common(r, '검토 상태', '공식 출처'),
      },
      validateRaceSchedule,
    )
    race.reviewIssues.push('game_activation_not_approved', 'course_not_assigned')
    if (!raceDate) {
      race.reviewIssues.push(notRun ? 'not_run' : 'date_unconfirmed')
    }
    if (!eligibility) {
      race.reviewIssues.push('entry_conditions_unconfirmed')
    } else if (!parsedEligibility) {
      race.reviewIssues.push('entry_conditions_unparsed')
    }
    if (!originalGrade) {
      race.reviewIssues.push('original_grade_unconfirmed')
    }
    if (!race.originalDistance) {
      race.reviewIssues.push('original_distance_unconfirmed')
    }
    if (race.gradeSystem === 'NAR' && race.grade === '기타') {
      race.reviewIssues.push('nar_grade_unconfirmed')
    }
    return race
  })
  const groups = new Map<string, RaceSchedule[]>()
  for (const race of races) {
    const key = JSON.stringify([race.country, race.year, race.name, race.racecourseId, race.grade])
    groups.set(key, [...(groups.get(key) ?? []), race])
  }
  for (const [key, group] of groups) {
    if (group.length > 1) {
      for (const race of group) {
        race.duplicateGroup = digest(key)
        race.reviewIssues.push('duplicate_combination_review')
      }
    }
  }
  for (const rows of [racecourses, courses, races]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) {
      throw new Error('Duplicate source ID')
    }
  }
  return { source, racecourses, courses, races }
}
