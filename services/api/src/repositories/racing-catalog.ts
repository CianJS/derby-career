import { withReferencePlayability } from '../../../../packages/shared/src/race-playability'
import type { Database, Query } from '../db'
import {
  resolveOfficialEntry,
  officialReferencePlayability,
} from '../modules/racing/official-entry'
import type { operations } from '../../../../packages/shared/src/generated/api'
import type { Racecourse, Course, RaceSchedule } from '../modules/racing/catalog'
import { correctedReferenceFacts } from '../modules/racing/reference-corrections'
import { ApiError } from '../errors'
export type RacecourseQuery = NonNullable<operations['listRacecourses']['parameters']['query']> & {
  page: number
  pageSize: number
}
export type RaceScheduleQuery = NonNullable<
  operations['listRaceSchedule']['parameters']['query']
> & { page: number; pageSize: number }
export class RacingCatalogRepository {
  constructor(private db: Database) {}
  private async referenceWithPlayability(tx: Query, race: RaceSchedule): Promise<RaceSchedule> {
    const official = await resolveOfficialEntry(tx, race.id)
    const corrected = correctedReferenceFacts(race)
    return official
      ? { ...corrected, playability: officialReferencePlayability(official) }
      : withReferencePlayability(corrected)
  }
  private async list<T>(
    table: 'racecourses' | 'race_schedules',
    query: RacecourseQuery | RaceScheduleQuery,
  ) {
    const values: unknown[] = []
    const filters: string[] = []
    const bind = (value: unknown) => {
      values.push(value)
      return '$' + values.length
    }
    if (query.country) {
      filters.push(
        `payload->>'${table === 'racecourses' ? 'countryCode' : 'country'}'=${bind(query.country)}`,
      )
    }
    if (query.verificationStatus) {
      filters.push(`payload->>'verificationStatus'=${bind(query.verificationStatus)}`)
    }
    if (query.search !== undefined) {
      if (!query.search.trim()) {
        throw new ApiError(400, 'INVALID_FILTER', '검색어를 입력해 주세요.')
      }
      const term = bind('%' + query.search.trim().replace(/[\\%_]/g, '\\$&') + '%')
      filters.push(
        `(payload->>'name' ILIKE ${term}${table === 'racecourses' ? ` OR payload->>'officialName' ILIKE ${term}` : ''})`,
      )
    }
    if (table === 'race_schedules') {
      const q = query as RaceScheduleQuery
      if (
        q.minDistance !== undefined &&
        q.maxDistance !== undefined &&
        q.minDistance > q.maxDistance
      ) {
        throw new ApiError(400, 'INVALID_FILTER', '최소 거리가 최대 거리보다 클 수 없습니다.')
      }
      for (const key of ['year', 'grade', 'surface', 'scheduleStatus'] as const) {
        if (q[key] !== undefined) {
          filters.push(`payload->>'${key}'=${bind(String(q[key]))}`)
        }
      }
      if (q.month !== undefined) {
        filters.push(`EXTRACT(MONTH FROM race_date)=${bind(q.month)}`)
      }
      if (q.racecourseId) {
        filters.push(`racecourse_id=${bind(q.racecourseId)}`)
      }
      for (const [key, op] of [
        ['minDistance', '>='],
        ['maxDistance', '<='],
      ] as const) {
        if (q[key] !== undefined) {
          filters.push(`(payload->>'distanceMeters')::numeric${op}${bind(q[key])}`)
        }
      }
    }
    const where = filters.length ? ' WHERE ' + filters.join(' AND ') : ''
    // Hide explicitly flagged duplicate groups without deleting imported source rows.
    // Filtering happens first so a group's matching member is not discarded.
    const source =
      table === 'race_schedules'
        ? `(SELECT DISTINCT ON (COALESCE(NULLIF(payload->>'duplicateGroup', ''), id))
              id, race_date, payload FROM race_schedules${where}
            ORDER BY COALESCE(NULLIF(payload->>'duplicateGroup', ''), id),
              (race_date IS NULL) ASC, race_date ASC NULLS LAST, id COLLATE "C" ASC) AS catalog_rows`
        : `${table}${where}`
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const total = Number(
        (await tx.query(`SELECT count(*) AS n FROM ${source}`, values)).rows[0].n,
      )
      const order =
        table === 'race_schedules'
          ? 'race_date ASC NULLS LAST,id COLLATE "C" ASC'
          : 'id COLLATE "C" ASC'
      const rows = (
        await tx.query(
          `SELECT payload FROM ${source} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, query.pageSize, (query.page - 1) * query.pageSize],
        )
      ).rows
      const data = await Promise.all(
        rows.map(
          async (r) =>
            (table === 'race_schedules'
              ? await this.referenceWithPlayability(tx, r.payload as RaceSchedule)
              : r.payload) as T,
        ),
      )
      return {
        data,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      }
    })
  }
  listRacecourses(query: RacecourseQuery) {
    return this.list<Racecourse>('racecourses', query)
  }
  listSchedule(query: RaceScheduleQuery) {
    return this.list<RaceSchedule>('race_schedules', query)
  }
  async getRacecourse(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const racecourse = (await tx.query('SELECT payload FROM racecourses WHERE id=$1', [id]))
        .rows[0]?.payload as Racecourse | undefined
      if (!racecourse) {
        return undefined
      }
      const courses = (
        await tx.query(
          'SELECT payload FROM racecourse_courses WHERE racecourse_id=$1 ORDER BY id COLLATE "C"',
          [id],
        )
      ).rows.map((r) => r.payload as Course)
      return { racecourse, courses }
    })
  }
  async getSchedule(id: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const race = (await tx.query('SELECT payload FROM race_schedules WHERE id=$1', [id])).rows[0]
        ?.payload as RaceSchedule | undefined
      return race ? this.referenceWithPlayability(tx, race) : undefined
    })
  }
}
